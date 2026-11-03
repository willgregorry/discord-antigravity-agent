const { GoogleGenAI, Type } = require('@google/genai');
const { ToolManager } = require('./tools');

const TOOL_DECLARATIONS = [
  {
    name: 'execute_command',
    description: 'Execute a PowerShell command in the current working directory. Use for git, npm, python, tests, dir, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'PowerShell command string to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filepath: { type: Type.STRING, description: 'Relative path or absolute file path' },
        startLine: { type: Type.INTEGER, description: 'Start line (1-indexed)' },
        endLine: { type: Type.INTEGER, description: 'End line (1-indexed)' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filepath: { type: Type.STRING, description: 'Relative path or absolute file path' },
        content: { type: Type.STRING, description: 'Full text content to write to the file' }
      },
      required: ['filepath', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Relative or absolute directory path (defaults to current directory)' }
      }
    }
  },
  {
    name: 'change_directory',
    description: 'Change the current workspace working directory to a new path',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Target directory path on Windows' }
      },
      required: ['path']
    }
  }
];

class ChannelSession {
  constructor(channelId, initialDir, defaultModel, apiKey) {
    this.channelId = channelId;
    this.modelName = defaultModel || 'gemini-2.5-flash';
    this.apiKey = apiKey;
    this.toolManager = new ToolManager(initialDir);
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    this.initChat();
  }

  getSystemInstruction() {
    return `You are Antigravity Discord Agent, an elite AI coding assistant running locally on the user's Windows laptop.
The user is prompting you remotely from their mobile device via Discord.
Current Working Directory: ${this.toolManager.getCwd()}
Operating System: Windows (PowerShell shell).

Guidelines:
1. You have full access to execute commands, read files, edit/write files, and explore directories.
2. Be proactive: if asked to fix a bug or run a script, use tools to inspect files and execute commands.
3. Keep responses clear and concise, optimized for Discord mobile view.
4. Format code using Discord markdown syntax with language tags.
5. If changing directories, inform the user clearly of the new working directory.`;
  }

  initChat() {
    this.chat = this.ai.chats.create({
      model: this.modelName,
      config: {
        systemInstruction: this.getSystemInstruction(),
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
      }
    });
  }

  setModel(newModel) {
    this.modelName = newModel;
    this.initChat();
  }

  setCwd(newPath) {
    const updated = this.toolManager.setCwd(newPath);
    this.initChat();
    return updated;
  }

  getCwd() {
    return this.toolManager.getCwd();
  }

  clearHistory() {
    this.initChat();
  }

  async prompt(userText, onProgress) {
    let response = await this.chat.sendMessage({ message: userText });
    let loopCount = 0;
    const MAX_LOOPS = 12;

    while (response.functionCalls && response.functionCalls.length > 0 && loopCount < MAX_LOOPS) {
      loopCount++;
      const functionResponses = [];

      for (const call of response.functionCalls) {
        const { name, args } = call;
        if (onProgress) {
          await onProgress({ type: 'tool_start', name, args });
        }

        let result;
        try {
          if (name === 'execute_command') {
            result = await this.toolManager.executeCommand(args.command);
          } else if (name === 'read_file') {
            result = this.toolManager.readFile(args.filepath, args.startLine, args.endLine);
          } else if (name === 'write_file') {
            result = this.toolManager.writeFile(args.filepath, args.content);
          } else if (name === 'list_directory') {
            result = this.toolManager.listDirectory(args.path || '.');
          } else if (name === 'change_directory') {
            const newDir = this.setCwd(args.path);
            result = { success: true, cwd: newDir };
          } else {
            result = { error: `Unknown tool: ${name}` };
          }
        } catch (err) {
          result = { error: err.message };
        }

        if (onProgress) {
          await onProgress({ type: 'tool_finish', name, result });
        }

        functionResponses.push({
          functionResponse: {
            name: name,
            response: { output: result }
          }
        });
      }

      response = await this.chat.sendMessage({ message: functionResponses });
    }

    return response.text || '';
  }
}

class AgentManager {
  constructor(apiKey, defaultConfig) {
    this.apiKey = apiKey;
    this.config = defaultConfig;
    this.sessions = new Map();
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.sessions.clear();
  }

  getOrCreateSession(channelId, channelName = '') {
    if (!this.sessions.has(channelId)) {
      let initialDir = (this.config.channel_directories && this.config.channel_directories[channelName.toLowerCase()]) || 
                       (this.config.channel_directories && this.config.channel_directories['general']) || 
                       process.env.DEFAULT_DIR || 
                       process.cwd();

      const session = new ChannelSession(channelId, initialDir, this.config.default_model, this.apiKey);
      this.sessions.set(channelId, session);
    }
    return this.sessions.get(channelId);
  }
}

module.exports = { AgentManager };
