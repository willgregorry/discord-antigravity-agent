const fs = require('fs');
const path = require('path');

/**
 * Represents the isolated coding state (working directory, active model,
 * conversation history, and running process handle) for a single Discord channel.
 */
class ChannelSession {
  constructor(channelId, cwd, model = 'gemini-3.8-flash-medium') {
    this.channelId = channelId;
    this.cwd = cwd;
    this.model = model;
    this.conversationId = null;
    this.activeProcess = null;
    this.currentBrowsePath = null;
    this.typingInterval = null;
    this.timeoutTimer = null;
  }

  clearTimers() {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  stopActiveProcess() {
    this.clearTimers();
    if (this.activeProcess) {
      if (typeof this.activeProcess.killTree === 'function') {
        this.activeProcess.killTree();
      } else {
        this.activeProcess.kill();
      }
      this.activeProcess = null;
    }
  }

  setCwd(newPath) {
    const resolved = path.resolve(newPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    this.cwd = resolved;
    this.currentBrowsePath = null;
    return this.cwd;
  }
}

/**
 * Manages configuration loading, channel-to-directory resolution,
 * and JSON persistence for all active `ChannelSession` instances.
 */
class SessionManager {
  constructor(rootDir, configPath) {
    this.rootDir = rootDir;
    this.configPath = configPath;
    this.sessionsPath = path.join(rootDir, 'sessions.json');
    this.sessions = new Map();
    this.config = this.loadConfig();
    this.loadSessions();
  }

  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      const exampleConfig = path.join(path.dirname(this.configPath), 'config.example.json');
      if (fs.existsSync(exampleConfig)) {
        try {
          fs.copyFileSync(exampleConfig, this.configPath);
        } catch (_) {}
      }
    }

    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (_) {
      return {
        default_model: 'gemini-3.8-flash-medium',
        available_models: [],
        channel_directories: {},
        favorite_projects: []
      };
    }
  }

  loadSessions() {
    if (!fs.existsSync(this.sessionsPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionsPath, 'utf8'));
      for (const [id, val] of Object.entries(raw)) {
        const session = new ChannelSession(id, val.cwd, val.model);
        session.conversationId = val.conversationId;
        this.sessions.set(id, session);
      }
      console.log(`💾 Loaded ${this.sessions.size} saved channel sessions from sessions.json`);
    } catch (e) {
      console.error('Failed to load sessions.json:', e);
    }
  }

  saveSessions() {
    const data = {};
    for (const [id, s] of this.sessions.entries()) {
      data[id] = {
        cwd: s.cwd,
        model: s.model,
        conversationId: s.conversationId
      };
    }
    fs.writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2), 'utf8');
  }

  getOrCreateSession(channelId, channelName = '') {
    if (!this.sessions.has(channelId)) {
      const lowerName = channelName.toLowerCase();
      let mappedDir = null;

      if (this.config.channel_directories) {
        for (const [key, dir] of Object.entries(this.config.channel_directories)) {
          if (lowerName.includes(key.toLowerCase())) {
            mappedDir = dir;
            break;
          }
        }
      }

      if (!mappedDir) {
        mappedDir =
          (this.config.channel_directories && this.config.channel_directories.general) ||
          process.env.DEFAULT_DIR ||
          process.cwd();
      }

      this.sessions.set(channelId, new ChannelSession(channelId, mappedDir, this.config.default_model));
      this.saveSessions();
    }

    return this.sessions.get(channelId);
  }

  getFirstChannelId() {
    return Array.from(this.sessions.keys())[0] || null;
  }
}

module.exports = { ChannelSession, SessionManager };
