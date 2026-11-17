const path = require('path');
const { execFile } = require('child_process');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder
} = require('discord.js');

const { SessionManager } = require('./core/session-manager');
const { QuotaService } = require('./services/quota-service');
const { TunnelService } = require('./services/tunnel-service');
const { SystemService } = require('./services/system-service');
const { GitService } = require('./services/git-service');
const { NotesService } = require('./services/notes-service');
const { WatchdogService } = require('./services/watchdog-service');
const { VoiceService } = require('./services/voice-service');
const { AccountService } = require('./services/account-service');
const { EnhancementService } = require('./services/enhancement-service');
const { UpdateService } = require('./services/update-service');
const { CommandRouter } = require('./commands/router');
const { getCommandModules } = require('./commands');
const { executeAiPrompt } = require('./commands/ai-runner.helper');

const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Thin Discord bot orchestrator responsible only for lifecycle management,
 * service composition (Dependency Injection), and top-level event wiring.
 */
class DiscordAntigravityBot {
  constructor(token, configPath) {
    this.token = token;
    this._cachedModels = null;
    this._cachedModelsTime = 0;

    this.sessionManager = new SessionManager(ROOT_DIR, configPath);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ],
      partials: [Partials.Channel, Partials.Message]
    });

    const quotaService = new QuotaService();
    const systemService = new SystemService();
    const updateService = new UpdateService(ROOT_DIR);

    // Explicit DI context injected into all command modules.
    this.ctx = {
      rootDir: ROOT_DIR,
      client: this.client,
      config: this.sessionManager.config,
      sessionManager: this.sessionManager,
      quotaService,
      tunnelService: new TunnelService(),
      systemService,
      gitService: new GitService(),
      notesService: new NotesService(path.join(ROOT_DIR, 'notes.json')),
      watchdogService: new WatchdogService(),
      voiceService: new VoiceService(),
      accountService: new AccountService(ROOT_DIR),
      enhancementService: new EnhancementService(ROOT_DIR),
      updateService,
      pendingEnhancements: new Map(),
      pendingQuestions: new Map(),
      getAvailableModels: () => this.getAvailableModels(),
      clearModelCache: () => { this._cachedModels = null; }
    };

    this.router = new CommandRouter(getCommandModules(), this.ctx);
    this.setupEvents();
  }

  /**
   * Fetches available LLM models from the active `agy` CLI account with a 60s cache.
   */
  async getAvailableModels() {
    if (this._cachedModels && Date.now() - this._cachedModelsTime < 60000) {
      return this._cachedModels;
    }

    try {
      const models = await new Promise((resolve, reject) => {
        execFile('agy', ['models'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
          if (err) return reject(err);
          const list = [];
          for (const line of stdout.split(/\r?\n/)) {
            if (!line.trim() || line.includes('Fetching available models')) continue;
            const parts = line.split('\t');
            if (parts.length >= 2) {
              list.push({ value: parts[0].trim(), label: parts[1].trim() });
            }
          }
          if (list.length > 0) resolve(list);
          else reject(new Error('No models parsed from CLI'));
        });
      });

      this._cachedModels = models;
      this._cachedModelsTime = Date.now();
      return models;
    } catch (_) {
      return this.ctx.config.available_models || [
        { label: 'Gemini 3.8 Flash (Medium)', value: 'gemini-3.8-flash-medium' },
        { label: 'Gemini 3.8 Flash (High Reasoning)', value: 'gemini-3.8-flash-high' },
        { label: 'Claude Sonnet 4.6 (Thinking)', value: 'claude-sonnet-4-6' },
        { label: 'Claude Opus 4.6 (Thinking)', value: 'claude-opus-4-6-thinking' },
        { label: 'GPT-OSS 120B (Medium)', value: 'gpt-oss-120b-medium' }
      ];
    }
  }

  setupEvents() {
    this.client.once('ready', async () => {
      console.log(`🤖 Antigravity CLI Bridge is online as ${this.client.user.tag}!`);
      await this.router.registerSlashCommands(this.token, this.client);

      for (const [, guild] of this.client.guilds.cache) {
        await this.ctx.updateService.sendWelcomeToGuild(guild);
      }

      setTimeout(() => this.ctx.updateService.broadcastUpdateIfAvailable(this.client), 15000);
      setInterval(() => this.ctx.updateService.broadcastUpdateIfAvailable(this.client), 2 * 60 * 60 * 1000);

      this.ctx.systemService.startBatteryWatcher(async (stats) => {
        console.log('[BATTERY WATCHER] Low battery alert:', stats.BatteryPercent);
        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('⚠️ Peringatan Baterai Laptop Lemah!')
          .setDescription(`Sisa baterai laptop kamu tinggal **${stats.BatteryPercent}%** dan tidak terhubung ke charger.\nSegera tancapkan charger atau gunakan \`/sleep\` / \`/shutdown\` dari HP jika kamu sedang di luar!`)
          .setTimestamp();

        try {
          if (process.env.BATTERY_ALERT_CHANNEL_ID) {
            const ch = await this.client.channels.fetch(process.env.BATTERY_ALERT_CHANNEL_ID);
            if (ch) {
              await ch.send({ embeds: [embed] });
              return;
            }
          }

          let sent = false;
          for (const [, guild] of this.client.guilds.cache) {
            const targetChannel = this.ctx.updateService.findAnnouncementChannel(guild);
            if (targetChannel) {
              await targetChannel.send({ embeds: [embed] });
              sent = true;
            }
          }

          if (!sent) {
            const fallbackId = this.sessionManager.getFirstChannelId();
            if (fallbackId) {
              const ch = await this.client.channels.fetch(fallbackId);
              if (ch) await ch.send({ embeds: [embed] });
            }
          }
        } catch (e) {
          console.error('Battery alert send error:', e);
        }
      });
    });

    this.client.on('guildCreate', async (guild) => {
      console.log(`[GUILD JOIN] Bergabung ke server baru: ${guild.name} (${guild.id})`);
      await this.ctx.updateService.sendWelcomeToGuild(guild);
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        const session = this.sessionManager.getOrCreateSession(interaction.channelId, interaction.channel?.name || '');
        await this.router.dispatchInteraction(interaction, session);
      } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true }).catch(() => {});
        }
      }
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (allowedUsers.length > 0 && !allowedUsers.includes(message.author.id)) {
        return;
      }

      const session = this.sessionManager.getOrCreateSession(message.channelId, message.channel?.name || '');
      if (message.content.trim().startsWith('!')) {
        await this.router.dispatchPrefix(message, session);
        return;
      }

      await executeAiPrompt({
        channel: message.channel,
        replyMessage: message,
        session,
        promptText: message.content,
        ctx: this.ctx,
        mode: 'chat'
      });
    });
  }

  start() {
    this.client.login(this.token);
  }
}

module.exports = { DiscordAntigravityBot };
