function formatDiscordText(text) {
  if (!text) return '';

  // 1. Convert markdown file:/// links: [Name](file:///...) -> `Name`
  let formatted = text.replace(/\[([^\]]+)\]\(file:\/\/\/[^\)]+\)/g, '`$1`');

  // 2. Convert bare file:/// links
  formatted = formatted.replace(/file:\/\/\/[^\s\)]+/g, match => {
    try {
      const decoded = decodeURIComponent(match.replace('file:///', ''));
      return '`' + decoded + '`';
    } catch (_) {
      return '`' + match + '`';
    }
  });

  return formatted;
}

function renderProgressBar(fraction, length = 10) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  let statusEmoji = '🟢';
  if (pct <= 20) statusEmoji = '🔴';
  else if (pct <= 50) statusEmoji = '🟡';
  return `${statusEmoji} \`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${pct}%**`;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const timestamp = Math.floor(new Date(isoString).getTime() / 1000);
  if (isNaN(timestamp)) return '';
  return `<t:${timestamp}:R> (<t:${timestamp}:t>)`;
}

function sanitizeFolderName(name) {
  if (!name) return 'general';
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'general';
}

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { AgyRunner } = require('./core/agy-runner');
const { QuotaService } = require('./services/quota-service');
const { TunnelService } = require('./services/tunnel-service');
const { SystemService } = require('./services/system-service');
const { GitService } = require('./services/git-service');
const { NotesService } = require('./services/notes-service');
const { WatchdogService } = require('./services/watchdog-service');
const { VoiceService } = require('./services/voice-service');
const ROOT_DIR = path.resolve(__dirname, '..');

class ChannelSession {
  constructor(channelId, cwd, model = 'gemini-3.8-flash-medium') {
    this.channelId = channelId;
    this.cwd = cwd;
    this.model = model;
    this.conversationId = null;
    this.activeProcess = null;
    this.currentBrowsePath = null;
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

class DiscordAntigravityBot {
  constructor(token, configPath) {
    this.token = token;
    this.configPath = configPath;
    this.sessions = new Map();
    this.quotaService = new QuotaService();
    this.tunnelService = new TunnelService();
    this.systemService = new SystemService();
    this.gitService = new GitService();
    this.notesService = new NotesService(path.join(ROOT_DIR, 'notes.json'));
    this.watchdogService = new WatchdogService();
    this.voiceService = new VoiceService();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ],
      partials: [Partials.Channel, Partials.Message]
    });

    this.loadConfig();
    this.loadSessions();
    this.setupEvents();
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
      this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (_) {
      this.config = { default_model: 'gemini-3.8-flash-medium', available_models: [], channel_directories: {}, favorite_projects: [] };
    }
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
        mappedDir = (this.config.channel_directories && this.config.channel_directories['general']) || process.env.DEFAULT_DIR || process.cwd();
      }
      this.sessions.set(channelId, new ChannelSession(channelId, mappedDir, this.config.default_model));
      this.saveSessions();
    }
    return this.sessions.get(channelId);
  }

  async registerSlashCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName('usage')
        .setDescription('Cek sisa kuota Gemini & model AI Antigravity realtime'),
      new SlashCommandBuilder()
        .setName('cd')
        .setDescription('Pindah direktori kerja untuk channel ini')
        .addStringOption(opt => opt.setName('path').setDescription('Path direktori baru').setRequired(true)),
      new SlashCommandBuilder()
        .setName('pwd')
        .setDescription('Cek direktori kerja, model Antigravity, dan status channel ini'),
      new SlashCommandBuilder()
        .setName('projects')
        .setDescription('Pilih folder project dari daftar favorit via dropdown menu'),
      new SlashCommandBuilder()
        .setName('model')
        .setDescription('Pilih model Antigravity (Gemini 3.8 Flash, Claude Sonnet 4.6, dll)'),
      new SlashCommandBuilder()
        .setName('send')
        .setDescription('Kirim file dari laptop kamu ke channel Discord ini')
        .addStringOption(opt => opt.setName('path').setDescription('Path file di laptop (contoh: ./README.md atau ./src/index.js)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Mulai sesi percakapan baru di channel ini'),
      new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Batalkan proses Antigravity yang sedang berjalan di channel ini'),
      new SlashCommandBuilder()
        .setName('help')
        .setDescription('Panduan lengkap semua fitur & perintah Antigravity Discord Agent'),
      
      // 1. Web Preview (Auto-Tunnel)
      new SlashCommandBuilder()
        .setName('preview')
        .setDescription('Buka URL publik live untuk web server lokal via Cloudflare Tunnel')
        .addIntegerOption(opt => opt.setName('port').setDescription('Port server lokal (contoh: 3000, 5173, 8080)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('stop-preview')
        .setDescription('Tutup web preview tunnel untuk channel ini'),

      // 2. Interactive Terminal
      new SlashCommandBuilder()
        .setName('exec')
        .setDescription('Jalankan perintah PowerShell cepat langsung di folder channel ini')
        .addStringOption(opt => opt.setName('command').setDescription('Perintah terminal (contoh: git status, npm test, dir)').setRequired(true)),

      // 3. Git Manager
      new SlashCommandBuilder()
        .setName('git')
        .setDescription('Menu interaktif Git (Status, Diff, Commit, Push, Pull)'),

      // 4. Server Crash Watchdog
      new SlashCommandBuilder()
        .setName('watch-server')
        .setDescription('Jalankan dev server dengan pemantau crash otomatis (1-Click AI Fix)')
        .addStringOption(opt => opt.setName('command').setDescription('Perintah dev server (contoh: npm run dev, python app.py)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('stop-server')
        .setDescription('Hentikan dev server yang sedang dipantau di channel ini'),

      // 5. Remote Laptop Control & Status
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Cek status hardware laptop (CPU, RAM, Disks, Baterai, Uptime)'),
      new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Kunci layar laptop (Lock Workstation)'),
      new SlashCommandBuilder()
        .setName('screen-off')
        .setDescription('Matikan monitor laptop untuk hemat daya'),
      new SlashCommandBuilder()
        .setName('sleep')
        .setDescription('Tidurkan laptop (Sleep Mode)'),
      new SlashCommandBuilder()
        .setName('shutdown')
        .setDescription('Matikan laptop secara remote (dengan konfirmasi)'),

      // 6. Screenshot
      new SlashCommandBuilder()
        .setName('screen')
        .setDescription('Ambil tangkapan layar live monitor laptop saat ini'),
      new SlashCommandBuilder()
        .setName('screenshot')
        .setDescription('Ambil tangkapan layar live monitor laptop saat ini'),

      // 7. Interactive File Explorer
      new SlashCommandBuilder()
        .setName('browse')
        .setDescription('File explorer interaktif untuk melihat dan mengunduh file project')
        .addStringOption(opt => opt.setName('path').setDescription('Sub-folder yang ingin dibuka (opsional)').setRequired(false)),

      // 8. Project Scratchpad & Notes
      new SlashCommandBuilder()
        .setName('notes')
        .setDescription('Catatan / Scratchpad untuk channel ini (otomatis dibaca AI)')
        .addStringOption(opt => opt.setName('action')
          .setDescription('Pilih aksi')
          .addChoices(
            { name: 'Lihat Catatan (View)', value: 'view' },
            { name: 'Tambah Catatan (Add)', value: 'add' },
            { name: 'Hapus Semua Catatan (Clear)', value: 'clear' }
          )
          .setRequired(false))
        .addStringOption(opt => opt.setName('text').setDescription('Isi catatan yang ingin ditambahkan (jika pilih add)').setRequired(false)),

      // 9. Voice Channel Assistant & Announcer
      new SlashCommandBuilder()
        .setName('join-vc')
        .setDescription('Perintahkan bot untuk bergabung ke Voice Channel tempat kamu berada'),
      new SlashCommandBuilder()
        .setName('leave-vc')
        .setDescription('Keluarkan bot dari Voice Channel'),
      new SlashCommandBuilder()
        .setName('say')
        .setDescription('Ucapkan pesan suara TTS di Voice Channel')
        .addStringOption(opt => opt.setName('text').setDescription('Teks yang ingin diucapkan bot').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(this.token);
    try {
      console.log('Registering slash commands...');
      await rest.put(
        Routes.applicationCommands(this.client.user.id),
        { body: commands.map(c => c.toJSON()) }
      );
      console.log('Slash commands registered successfully!');
    } catch (err) {
      console.error('Failed to register slash commands:', err);
    }
  }

  loadSessions() {
    const p = path.join(ROOT_DIR, 'sessions.json');
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const [id, val] of Object.entries(raw)) {
          const s = new ChannelSession(id, val.cwd, val.model);
          s.conversationId = val.conversationId;
          this.sessions.set(id, s);
        }
        console.log('💾 Loaded ' + this.sessions.size + ' saved channel sessions from sessions.json');
      } catch (e) {
        console.error('Failed to load sessions.json:', e);
      }
    }
  }

  saveSessions() {
    const p = path.join(ROOT_DIR, 'sessions.json');
    const data = {};
    for (const [id, s] of this.sessions.entries()) {
      data[id] = {
        cwd: s.cwd,
        model: s.model,
        conversationId: s.conversationId
      };
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  }

  setupEvents() {
    this.client.once('ready', async () => {
      console.log(`🤖 Antigravity CLI Bridge is online as ${this.client.user.tag}!`);
      await this.registerSlashCommands();

      // Battery Watcher Alert
      this.systemService.startBatteryWatcher(async (stats) => {
        console.log('[BATTERY WATCHER] Low battery alert:', stats.BatteryPercent);
        const targetChannelId = Array.from(this.sessions.keys())[0];
        if (targetChannelId) {
          try {
            const ch = await this.client.channels.fetch(targetChannelId);
            if (ch) {
              const embed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('⚠️ Peringatan Baterai Laptop Lemah!')
                .setDescription(`Sisa baterai laptop kamu tinggal **${stats.BatteryPercent}%** dan tidak terhubung ke charger.\nSegera tancapkan charger atau gunakan \`/sleep\` / \`/shutdown\` dari HP jika kamu sedang di luar!`)
                .setTimestamp();
              await ch.send({ embeds: [embed] });
            }
          } catch (e) {
            console.error('Battery alert send error:', e);
          }
        }
      });
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleSlashCommand(interaction);
        } else if (interaction.isStringSelectMenu()) {
          await this.handleSelectMenu(interaction);
        } else if (interaction.isButton()) {
          await this.handleButton(interaction);
        } else if (interaction.isModalSubmit()) {
          await this.handleModalSubmit(interaction);
        }
      } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
        }
      }
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (allowedUsers.length > 0 && !allowedUsers.includes(message.author.id)) {
        return;
      }

      const content = message.content.trim();
      if (content.startsWith('!')) {
        await this.handlePrefixCommand(message);
        return;
      }

      await this.handlePromptMessage(message);
    });
  }

  buildUsageEmbed(quotaData) {
    const { quotaSummary, userStatus } = quotaData;
    const planName = userStatus?.userTier?.name || 'Google AI Pro';
    const planUpgradeText = userStatus?.userTier?.upgradeSubscriptionText || 'Tersedia kuota model standar untuk tier aktif.';

    const embed = new EmbedBuilder()
      .setColor(0x4285F4)
      .setTitle('📊 Models & Quota Usage')
      .setDescription('Pantau sisa kuota rate limit dan kredit akun Google AI kamu secara realtime.')
      .addFields({
        name: '👑 Subscription Plan',
        value: `**Plan:** \`${planName}\`\n> *${planUpgradeText}*`,
        inline: false
      });

    if (quotaSummary && quotaSummary.groups) {
      for (const group of quotaSummary.groups) {
        const lines = [];
        for (const bucket of group.buckets || []) {
          const bar = renderProgressBar(bucket.remainingFraction ?? 1);
          const resetStr = formatRelativeTime(bucket.resetTime);
          lines.push(`• **${bucket.displayName}**\n  ${bar}${resetStr ? `\n  ↳ *Reset: ${resetStr}*` : ''}`);
        }
        embed.addFields({
          name: `${group.displayName.includes('Gemini') ? '✨' : '🧠'} ${group.displayName}`,
          value: lines.length > 0 ? lines.join('\n\n') : '*(Tidak ada informasi kuota)*',
          inline: false
        });
      }
    } else {
      embed.addFields({
        name: 'ℹ️ Informasi Quota',
        value: 'Tidak ada detail kuota yang dikembalikan oleh Language Server.',
        inline: false
      });
    }

    embed.setFooter({ text: 'Antigravity IDE • Google AI Pro • Live Language Server' })
      .setTimestamp(new Date());

    return embed;
  }

  async buildGitEmbed(cwd) {
    const gitInfo = await this.gitService.getStatus(cwd);
    if (!gitInfo.isRepo) {
      return {
        embed: new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('📂 Git Status: Bukan Git Repository')
          .setDescription(`Folder saat ini bukan repository git:\n\`\`\`${cwd}\`\`\``),
        components: []
      };
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`🌿 Git Repository: ${path.basename(cwd)}`)
      .setDescription(`📍 **Branch:** \`${gitInfo.branch}\`\n📌 **Last Commit:** \`${gitInfo.lastCommit}\``)
      .addFields(
        { name: '📊 Perubahan File', value: `• **Modified:** ${gitInfo.modified}\n• **Untracked:** ${gitInfo.untracked}\n• **Staged:** ${gitInfo.staged}`, inline: true },
        { name: '📁 Status Ringkas', value: `\`\`\`${gitInfo.rawStatus.slice(0, 300) || 'Clean'}\`\`\``, inline: false }
      )
      .setFooter({ text: 'Gunakan tombol di bawah untuk interaksi cepat Git dari HP!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('git_diff').setLabel('🔍 View Diff').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('git_commit_btn').setLabel('📝 Commit All').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('git_push').setLabel('🚀 Push').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('git_pull').setLabel('📥 Pull').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('git_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row] };
  }

  async buildBrowseComponents(targetDir) {
    if (!fs.existsSync(targetDir)) {
      throw new Error(`Directory tidak ditemukan: ${targetDir}`);
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const folders = [];
    const files = [];

    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // skip hidden
      if (ent.isDirectory()) {
        folders.push(ent.name);
      } else {
        files.push(ent.name);
      }
    }

    folders.sort();
    files.sort();

    const options = [];

    // Option to go up
    const parentDir = path.dirname(targetDir);
    if (parentDir && parentDir !== targetDir) {
      options.push({
        label: '.. (Kembali ke folder atas)',
        description: parentDir.slice(-50),
        value: `dir:${parentDir}`,
        emoji: '⬆️'
      });
    }

    // Add folders
    for (const f of folders) {
      if (options.length >= 24) break;
      options.push({
        label: f.slice(0, 50),
        description: 'Folder',
        value: `dir:${path.join(targetDir, f)}`,
        emoji: '📁'
      });
    }

    // Add files
    for (const fl of files) {
      if (options.length >= 25) break;
      const fullPath = path.join(targetDir, fl);
      let sizeStr = '';
      try {
        const sz = fs.statSync(fullPath).size;
        sizeStr = sz > 1024 * 1024 ? `${(sz / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(sz / 1024)}KB`;
      } catch (_) {}
      options.push({
        label: fl.slice(0, 50),
        description: `File (${sizeStr})`,
        value: `file:${fullPath}`,
        emoji: '📄'
      });
    }

    if (options.length === 0) {
      options.push({
        label: '(Folder kosong)',
        description: 'Tidak ada file atau folder lain',
        value: `empty:${targetDir}`,
        emoji: 'ℹ️'
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_browse_item')
        .setPlaceholder('Pilih folder untuk masuk, atau file untuk dibuka/unduh...')
        .addOptions(options)
    );

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('📂 Interactive File Explorer')
      .setDescription(`📍 Lokasi saat ini:\n\`\`\`${targetDir}\`\`\`\n• **${folders.length}** folder\n• **${files.length}** file`)
      .setFooter({ text: 'Klik file untuk melihat isinya atau mengunduhnya langsung ke HP.' });

    return { embed, components: [row] };
  }

  async handleSlashCommand(interaction) {
    const session = this.getOrCreateSession(interaction.channelId, interaction.channel?.name || '');
    const { commandName } = interaction;

    if (commandName === 'usage') {
      await interaction.deferReply();
      try {
        const data = await this.quotaService.fetchQuotaAndStatus();
        const embed = this.buildUsageEmbed(data);
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply(`❌ Gagal mengambil data usage: ${err.message}`);
      }
    } else if (commandName === 'pwd') {
      const isRunning = session.activeProcess ? '⚡ Sedang Berjalan (Active Task)' : '💤 Idle (Siap menerima prompt)';
      const activeTunnel = this.tunnelService.getTunnel(interaction.channelId);
      const isWatching = this.watchdogService.isWatching(interaction.channelId);
      const notes = this.notesService.getNotes(interaction.channelId);

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('📍 Status Workspace Channel')
        .addFields(
          { name: '📁 Working Directory', value: `\`\`\`${session.cwd}\`\`\`` },
          { name: '🧠 Antigravity Model', value: `\`\`\`${session.model}\`\`\`` },
          { name: '🔄 Status Antigravity', value: isRunning },
          { name: '🌐 Web Preview', value: activeTunnel ? `🔗 [${activeTunnel.url}](${activeTunnel.url}) (Port ${activeTunnel.port})` : '*(Tidak aktif)*' },
          { name: '🛡️ Server Watchdog', value: isWatching ? `Active: \`${this.watchdogService.getServerInfo(interaction.channelId).command}\`` : '*(Tidak aktif)*' },
          { name: '📝 Scratchpad Notes', value: notes ? `\`\`\`\n${notes.slice(0, 200)}\`\`\`` : '*(Kosong)*' },
          { name: '💬 Conversation ID', value: session.conversationId ? `\`\`\`${session.conversationId}\`\`\`` : '*(Baru / Belum ada riwayat)*' }
        )
        .setFooter({ text: 'Beda channel = beda working directory. Kamu bisa prompt di banyak channel sekaligus!' });

      await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'cd') {
      const targetPath = interaction.options.getString('path');
      try {
        const newDir = session.setCwd(targetPath);
        this.saveSessions();
        await interaction.reply(`✅ Working directory channel ini berhasil diubah ke:\n📁 \`\`\`${newDir}\`\`\``);
      } catch (err) {
        await interaction.reply(`❌ Gagal pindah folder: ${err.message}`);
      }
    } else if (commandName === 'projects') {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_project')
          .setPlaceholder('Pilih Project Workspace...')
          .addOptions(
            this.config.favorite_projects.map(p => ({
              label: p.name,
              description: p.path.slice(-50),
              value: p.path
            }))
          )
      );

      await interaction.reply({
        content: `📁 **Pilih folder kerja untuk channel ini:**\nSaat ini: \`\`\`${session.cwd}\`\`\``,
        components: [row]
      });
    } else if (commandName === 'model') {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_model')
          .setPlaceholder('Pilih Model Antigravity...')
          .addOptions(
            this.config.available_models.map(m => ({
              label: m.label,
              value: m.value,
              default: m.value === session.model
            }))
          )
      );

      await interaction.reply({
        content: `🧠 **Pilih model Antigravity untuk channel ini:**\nModel aktif: \`\`\`${session.model}\`\`\``,
        components: [row]
      });
    } else if (commandName === 'send') {
      const rawPath = interaction.options.getString('path').trim().replace(/^["']|["']$/g, '');
      const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(session.cwd, rawPath);

      if (!fs.existsSync(resolved)) {
        await interaction.reply({ content: `❌ File tidak ditemukan di laptop:\n\`\`\`${resolved}\`\`\``, ephemeral: true });
        return;
      }
      const stats = fs.statSync(resolved);
      if (stats.isDirectory()) {
        await interaction.reply({ content: `❌ Path tersebut adalah folder, bukan file:\n\`\`\`${resolved}\`\`\``, ephemeral: true });
        return;
      }
      if (stats.size > 24 * 1024 * 1024) {
        await interaction.reply({ content: `❌ File melebihi batas 24MB Discord (${(stats.size / (1024 * 1024)).toFixed(1)} MB).`, ephemeral: true });
        return;
      }

      await interaction.deferReply();
      const attachment = new AttachmentBuilder(resolved);
      const sizeStr = stats.size > 1024 * 1024 ? `${(stats.size / (1024 * 1024)).toFixed(2)} MB` : `${(stats.size / 1024).toFixed(1)} KB`;
      await interaction.editReply({
        content: `📤 **File dari laptop:** \`${path.basename(resolved)}\` (${sizeStr})\n📁 \`${resolved}\``,
        files: [attachment]
      });
    } else if (commandName === 'clear') {
      session.conversationId = null;
      this.saveSessions();
      await interaction.reply('🧹 Sesi percakapan di channel ini telah di-reset (konteks baru dimulai)!');
    } else if (commandName === 'stop') {
      if (session.activeProcess) {
        session.activeProcess.kill();
        session.activeProcess = null;
        await interaction.reply('🛑 Proses Antigravity di channel ini telah dihentikan.');
      } else {
        await interaction.reply('ℹ️ Tidak ada proses yang sedang berjalan di channel ini.');
      }
    } else if (commandName === 'preview') {
      const port = interaction.options.getInteger('port');
      await interaction.deferReply();
      try {
        const tunnelUrl = await this.tunnelService.startTunnel(interaction.channelId, port);
        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('🌐 Web Preview Aktif (Cloudflare Tunnel)')
          .setDescription(`Web server lokal port **${port}** sekarang dapat diakses secara publik dari browser HP kamu!\n\n🔗 **Link Preview:**\n### [${tunnelUrl}](${tunnelUrl})\n\n> 💡 *Klik link di atas untuk preview tampilan website langsung di layar HP kamu.*`)
          .setFooter({ text: 'Ketik /stop-preview untuk menutup tunnel.' })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply(`❌ Gagal membuat tunnel preview: ${err.message}`);
      }
    } else if (commandName === 'stop-preview') {
      const stopped = this.tunnelService.stopTunnel(interaction.channelId);
      if (stopped) {
        await interaction.reply('🛑 Web preview tunnel channel ini berhasil ditutup.');
      } else {
        await interaction.reply('ℹ️ Tidak ada tunnel web preview yang sedang aktif di channel ini.');
      }
    } else if (commandName === 'exec') {
      const cmd = interaction.options.getString('command');
      await interaction.deferReply();
      exec(cmd, { cwd: session.cwd, shell: 'powershell.exe', maxBuffer: 1024 * 1024 * 2 }, async (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '') || (err ? err.message : '(Command executed with no output)');
        const cleanOutput = output.trim();
        if (cleanOutput.length > 1900) {
          const channelFolder = sanitizeFolderName(interaction.channel?.name || 'exec');
          const tempDir = path.join(ROOT_DIR, 'temp_downloads', channelFolder);
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempFile = path.join(tempDir, `exec_${Date.now()}.txt`);
          fs.writeFileSync(tempFile, cleanOutput, 'utf8');
          await interaction.editReply({
            content: `💻 Perintah: \`${cmd}\`\n📁 \`${session.cwd}\`\nOutput terlalu panjang, dikirim sebagai file:`,
            files: [new AttachmentBuilder(tempFile)]
          });
        } else {
          await interaction.editReply({
            content: `💻 Perintah: \`${cmd}\`\n📁 \`${session.cwd}\`\n\`\`\`powershell\n${cleanOutput}\n\`\`\``
          });
        }
      });
    } else if (commandName === 'git') {
      await interaction.deferReply();
      try {
        const { embed, components } = await this.buildGitEmbed(session.cwd);
        await interaction.editReply({ embeds: [embed], components });
      } catch (err) {
        await interaction.editReply(`❌ Gagal membaca git: ${err.message}`);
      }
    } else if (commandName === 'watch-server') {
      const cmd = interaction.options.getString('command');
      await interaction.deferReply();

      this.watchdogService.startWatch(
        interaction.channelId,
        cmd,
        session.cwd,
        async (crashInfo) => {
          // Crash event callback
          try {
            const ch = await this.client.channels.fetch(crashInfo.channelId);
            if (ch) {
              const crashEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('🚨 Server Crash Terdeteksi!')
                .setDescription(`Server dev di channel ini mengalami crash atau error fatal!\n\n💻 **Perintah:** \`${crashInfo.command}\`\n📁 **Workspace:** \`${crashInfo.cwd}\`\n\n**🛑 Error Log Terakhir:**\n\`\`\`\n${crashInfo.fullTail.slice(-1200)}\n\`\`\``)
                .setFooter({ text: 'Klik tombol di bawah untuk perbaikan otomatis dengan AI!' });

              const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`fix_crash_${crashInfo.channelId}`)
                  .setLabel('🔘 Perbaiki dengan Antigravity AI (1-Click Fix)')
                  .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                  .setCustomId(`stop_crash_${crashInfo.channelId}`)
                  .setLabel('🛑 Stop Server')
                  .setStyle(ButtonStyle.Secondary)
              );

              await ch.send({ embeds: [crashEmbed], components: [actionRow] });
            }
          } catch (e) {
            console.error('Failed to notify crash:', e);
          }
        }
      );

      await interaction.editReply(`🛡️ **Server Crash Watchdog Aktif!**\n💻 Perintah: \`${cmd}\`\n📁 Folder: \`${session.cwd}\`\n> Bot akan otomatis memantau terminal ini. Jika terjadi crash atau unhandled error, kamu akan langsung diberi notifikasi darurat di HP lengkap dengan tombol **1-Click AI Fix**!`);
    } else if (commandName === 'stop-server') {
      const stopped = this.watchdogService.stopWatch(interaction.channelId);
      if (stopped) {
        await interaction.reply('🛑 Dev server watchdog di channel ini berhasil dihentikan.');
      } else {
        await interaction.reply('ℹ️ Tidak ada server yang sedang dipantau di channel ini.');
      }
    } else if (commandName === 'status') {
      await interaction.deferReply();
      try {
        const stats = await this.systemService.getStatus();
        const ramUsed = stats.TotalRamMB - stats.FreeRamMB;
        const ramPct = Math.round((ramUsed / stats.TotalRamMB) * 100);
        const ramBar = renderProgressBar(stats.FreeRamMB / stats.TotalRamMB);

        let batteryInfo = '*(Desktop / Tanpa Baterai)*';
        if (stats.BatteryPercent !== null) {
          const isCharging = stats.BatteryStatus === 2 ? '⚡ (Charging)' : '🔋 (Discharging)';
          batteryInfo = `${stats.BatteryPercent}% ${isCharging}`;
        }

        const diskLines = (stats.Disks || []).map(d => {
          const used = Math.round(d.TotalGB - d.FreeGB);
          return `• **Drive ${d.Drive}** ${d.FreeGB} GB free / ${d.TotalGB} GB (${Math.round((d.FreeGB / d.TotalGB) * 100)}% free)`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setColor(0x1abc9c)
          .setTitle('💻 Hardware & System Status Laptop')
          .addFields(
            { name: '⚙️ CPU Load', value: `\`${stats.CpuLoad}%\``, inline: true },
            { name: '🧠 RAM Usage', value: `${(ramUsed / 1024).toFixed(1)} GB / ${(stats.TotalRamMB / 1024).toFixed(1)} GB (${ramPct}%)\n${ramBar}`, inline: false },
            { name: '🔋 Baterai', value: batteryInfo, inline: true },
            { name: '⏱️ Last Boot', value: formatRelativeTime(stats.BootTime), inline: true },
            { name: '💾 Penyimpanan Disks', value: diskLines || '*(Tidak ada disk terdeteksi)*', inline: false }
          )
          .setFooter({ text: 'Antigravity Remote System Controller' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply(`❌ Gagal mengambil status sistem: ${err.message}`);
      }
    } else if (commandName === 'screen' || commandName === 'screenshot') {
      await interaction.deferReply();
      try {
        const channelFolder = sanitizeFolderName(interaction.channel?.name || 'screenshots');
        const tempDir = path.join(ROOT_DIR, 'temp_downloads', channelFolder);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const filePath = path.join(tempDir, `screen_${Date.now()}.png`);
        await this.systemService.captureScreenshot(filePath);
        const attachment = new AttachmentBuilder(filePath);
        await interaction.editReply({
          content: '📸 **Tangkapan Layar Live Monitor Laptop:**',
          files: [attachment]
        });
      } catch (err) {
        await interaction.editReply(`❌ Gagal mengambil screenshot: ${err.message}`);
      }
    } else if (commandName === 'lock') {
      this.systemService.lockWorkstation();
      await interaction.reply('🔒 Layar laptop berhasil dikunci (Lock Workstation)!');
    } else if (commandName === 'screen-off') {
      this.systemService.turnOffMonitor();
      await interaction.reply('🌑 Monitor laptop dimatikan untuk hemat daya. (Layar akan kembali menyala saat ada input mouse/keyboard).');
    } else if (commandName === 'sleep') {
      await interaction.reply('💤 Memerintahkan laptop untuk masuk ke Sleep Mode...');
      setTimeout(() => {
        this.systemService.sleepLaptop();
      }, 1000);
    } else if (commandName === 'shutdown') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_shutdown').setLabel('⚠️ Ya, Matikan Sekarang').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_shutdown').setLabel('Batal').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        content: '⚠️ **KONFIRMASI REMOTE SHUTDOWN:**\nApakah kamu yakin ingin mematikan laptop kamu secara remote dari Discord?\n*(Jika laptop mati, kamu harus menekan tombol power secara fisik di laptop untuk menyalakannya kembali).*',
        components: [row]
      });
    } else if (commandName === 'browse') {
      const subPath = interaction.options.getString('path') || '';
      const targetDir = subPath ? path.resolve(session.cwd, subPath) : session.cwd;
      session.currentBrowsePath = targetDir;
      await interaction.deferReply();
      try {
        const { embed, components } = await this.buildBrowseComponents(targetDir);
        await interaction.editReply({ embeds: [embed], components });
      } catch (err) {
        await interaction.editReply(`❌ Gagal menjelajahi direktori: ${err.message}`);
      }
    } else if (commandName === 'notes') {
      const action = interaction.options.getString('action') || 'view';
      const text = interaction.options.getString('text');

      if (action === 'add') {
        if (!text) {
          await interaction.reply({ content: '❌ Mohon sertakan parameter `text` untuk catatan yang ingin ditambahkan.', ephemeral: true });
          return;
        }
        const updated = this.notesService.appendNote(interaction.channelId, text);
        await interaction.reply(`✅ Catatan berhasil ditambahkan!\n📝 **Catatan Channel Saat Ini:**\n\`\`\`\n${updated}\n\`\`\`\n> 💡 *Catatan ini otomatis dibaca oleh Antigravity setiap kali kamu prompt di channel ini!*`);
      } else if (action === 'clear') {
        this.notesService.clearNotes(interaction.channelId);
        await interaction.reply('🧹 Catatan scratchpad untuk channel ini telah dibersihkan.');
      } else {
        const current = this.notesService.getNotes(interaction.channelId);
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('📝 Project Scratchpad & Notes')
          .setDescription(current ? `\`\`\`\n${current}\n\`\`\`` : '*(Belum ada catatan untuk channel ini)*\n\nGunakan `/notes action:Tambah Catatan text:...` untuk menambah catatan baru.')
          .setFooter({ text: 'Konteks scratchpad otomatis diikutsertakan dalam prompt Antigravity AI!' });
        await interaction.reply({ embeds: [embed] });
      }
    } else if (commandName === 'join-vc') {
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        await interaction.reply({ content: '❌ Kamu harus berada di dalam sebuah Voice Channel terlebih dahulu agar bot bisa bergabung!', ephemeral: true });
        return;
      }
      try {
        this.voiceService.join(voiceChannel);
        await interaction.reply(`🔊 Berhasil bergabung ke Voice Channel **${voiceChannel.name}**!\n> 💡 *Notifikasi tugas selesai, peringatan sistem, dan dev server akan diumumkan lewat suara.*`);
        this.voiceService.speak(interaction.guildId, `Halo ${member.displayName || 'Willy'}! Aku sudah bergabung di voice channel ya. Nanti kalau ada tugas coding yang selesai atau server error, langsung aku kabarin lewat sini!`);
      } catch (err) {
        await interaction.reply({ content: `❌ Gagal bergabung ke Voice Channel: ${err.message}`, ephemeral: true });
      }
    } else if (commandName === 'leave-vc') {
      const success = this.voiceService.leave(interaction.guildId);
      if (success) {
        await interaction.reply('👋 Berhasil keluar dari Voice Channel.');
      } else {
        await interaction.reply({ content: 'ℹ️ Bot sedang tidak berada di Voice Channel mana pun pada server ini.', ephemeral: true });
      }
    } else if (commandName === 'say') {
      const text = interaction.options.getString('text');
      if (!this.voiceService.isConnected(interaction.guildId)) {
        await interaction.reply({ content: '⚠️ Bot belum bergabung di Voice Channel. Gunakan `/join-vc` terlebih dahulu!', ephemeral: true });
        return;
      }
      this.voiceService.speak(interaction.guildId, text);
      await interaction.reply(`🗣️ Mengucapkan: *"${text}"* di Voice Channel.`);
    } else if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🛠️ Panduan Lengkap Antigravity Discord Agent')
        .setDescription('Kendalikan pengembangan dan laptop kamu sepenuhnya dari HP!')
        .addFields(
          { name: '🤖 Antigravity AI', value: '• Kirim chat biasa untuk prompt AI ngoding\n• Minta kirim file: *"kirimkan file X ke discord"*\n• `/usage` (Cek kuota Gemini & reset time)\n• `/projects` / `/cd <path>` (Pindah workspace)\n• `/model` (Ganti model AI)\n• `/clear` (Reset riwayat chat) • `/stop` (Hentikan proses)' },
          { name: '🎙️ Voice Channel Assistant', value: '• `/join-vc` (Bot bergabung ke voice channel kamu)\n• `/leave-vc` (Keluarkan bot dari voice channel)\n• `/say <text>` (Ucapkan teks suara natural via TTS)\n• Otomatis menyuarakan tugas selesai & dev server crash!' },
          { name: '🌐 Web Preview & Dev Server', value: '• `/preview <port>` (Buka URL publik live via Cloudflare Tunnel)\n• `/stop-preview` (Tutup tunnel)\n• `/watch-server <command>` (Monitor server dengan 1-Click Auto-Fix crash)\n• `/stop-server` (Hentikan dev server)' },
          { name: '💻 Terminal & Git', value: '• `/exec <command>` (Jalankan perintah PowerShell cepat)\n• `/git` (Menu interaktif Diff, Commit AI, Push, Pull)' },
          { name: '📂 File Manager & Notes', value: '• `/browse` (Jelajahi folder & download file ke HP)\n• `/send <path>` (Kirim file spesifik dari laptop)\n• `/notes` (Scratchpad/memori yang selalu diingat AI)' },
          { name: '🔋 Remote Laptop Control', value: '• `/status` (Cek CPU, RAM, Disks, Baterai, Uptime)\n• `/screen` (Live screenshot monitor laptop)\n• `/lock` (Kunci layar)\n• `/screen-off` (Matikan monitor)\n• `/sleep` (Sleep laptop)\n• `/shutdown` (Matikan laptop remote)' }
        );
      await interaction.reply({ embeds: [embed] });
    }
  }

  async handleButton(interaction) {
    const session = this.getOrCreateSession(interaction.channelId, interaction.channel?.name || '');
    const customId = interaction.customId;

    if (customId === 'git_diff') {
      await interaction.deferReply();
      const diff = await this.gitService.getDiff(session.cwd);
      if (diff.length > 1900) {
        const channelFolder = sanitizeFolderName(interaction.channel?.name || 'git');
        const tempDir = path.join(ROOT_DIR, 'temp_downloads', channelFolder);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, `git_diff_${Date.now()}.patch`);
        fs.writeFileSync(tempFile, diff, 'utf8');
        await interaction.editReply({
          content: '🔍 **Git Diff:** (Perubahan terlalu panjang, dikirim sebagai file patch)',
          files: [new AttachmentBuilder(tempFile)]
        });
      } else {
        await interaction.editReply({
          content: `🔍 **Git Diff:**\n\`\`\`diff\n${diff}\n\`\`\``
        });
      }
    } else if (customId === 'git_commit_btn') {
      const modal = new ModalBuilder()
        .setCustomId('git_commit_modal')
        .setTitle('Git Commit All');

      const msgInput = new TextInputBuilder()
        .setCustomId('commit_message')
        .setLabel('Commit Message')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Contoh: feat: implement auto-tunneling and watchdog')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
      await interaction.showModal(modal);
    } else if (customId === 'git_push') {
      await interaction.deferReply();
      const res = await this.gitService.push(session.cwd);
      if (res.ok) {
        await interaction.editReply(`🚀 **Git Push Berhasil!**\n\`\`\`\n${res.output || 'Everything up-to-date'}\n\`\`\``);
      } else {
        await interaction.editReply(`❌ **Git Push Gagal:**\n\`\`\`\n${res.output}\n\`\`\``);
      }
    } else if (customId === 'git_pull') {
      await interaction.deferReply();
      const res = await this.gitService.pull(session.cwd);
      if (res.ok) {
        await interaction.editReply(`📥 **Git Pull Berhasil!**\n\`\`\`\n${res.output}\n\`\`\``);
      } else {
        await interaction.editReply(`❌ **Git Pull Gagal:**\n\`\`\`\n${res.output}\n\`\`\``);
      }
    } else if (customId === 'git_refresh') {
      await interaction.deferUpdate();
      const { embed, components } = await this.buildGitEmbed(session.cwd);
      await interaction.editReply({ embeds: [embed], components });
    } else if (customId.startsWith('fix_crash_')) {
      const targetChannelId = customId.replace('fix_crash_', '');
      const sInfo = this.watchdogService.getServerInfo(targetChannelId);
      await interaction.reply('🛠️ **Memulai Antigravity AI Auto-Fix...** Sedang menganalisa file dan error!');
      
      const crashTail = sInfo ? sInfo.logs.slice(-25).join('\n') : 'Tidak ada log tersimpan.';
      const fixPrompt = `Server dev crash saat menjalankan command '${sInfo ? sInfo.command : 'server'}'.
Berikut tail log error crash terakhir:
\`\`\`
${crashTail}
\`\`\`
Tolong telusuri file yang bersangkutan, identifikasi bug penyebab error, perbaiki kodenya sekarang juga, dan jelaskan apa yang diperbaiki secara singkat dan padat!`;

      // Trigger prompt
      await this.handleDirectPrompt(interaction.channel, session, fixPrompt);
    } else if (customId.startsWith('stop_crash_')) {
      const targetChannelId = customId.replace('stop_crash_', '');
      this.watchdogService.stopWatch(targetChannelId);
      await interaction.reply('🛑 Dev server watchdog dihentikan.');
    } else if (customId === 'confirm_shutdown') {
      await interaction.update({ content: '🔌 **Shutdown dikonfirmasi!** Laptop akan mati dalam 10 detik. Menutup koneksi...', components: [] });
      this.systemService.shutdownLaptop();
    } else if (customId === 'cancel_shutdown') {
      this.systemService.cancelShutdown();
      await interaction.update({ content: '✅ Remote shutdown dibatalkan.', components: [] });
    }
  }

  async handleModalSubmit(interaction) {
    const session = this.getOrCreateSession(interaction.channelId, interaction.channel?.name || '');
    if (interaction.customId === 'git_commit_modal') {
      const commitMsg = interaction.fields.getTextInputValue('commit_message');
      await interaction.deferReply();
      const res = await this.gitService.commit(session.cwd, commitMsg);
      if (res.ok) {
        await interaction.editReply(`📝 **Git Commit Berhasil!**\n\`\`\`\n${res.output}\n\`\`\``);
      } else {
        await interaction.editReply(`❌ **Git Commit Gagal:**\n\`\`\`\n${res.output}\n\`\`\``);
      }
    }
  }

  async handleSelectMenu(interaction) {
    const session = this.getOrCreateSession(interaction.channelId, interaction.channel?.name || '');

    if (interaction.customId === 'select_project') {
      const chosenPath = interaction.values[0];
      try {
        const newDir = session.setCwd(chosenPath);
        this.saveSessions();
        await interaction.update({
          content: `✅ Workspace channel ini dialihkan ke:\n📁 \`\`\`${newDir}\`\`\``,
          components: []
        });
      } catch (err) {
        await interaction.update({ content: `❌ Gagal membuka folder: ${err.message}`, components: [] });
      }
    } else if (interaction.customId === 'select_model') {
      const chosenModel = interaction.values[0];
      session.model = chosenModel;
      this.saveSessions();
      await interaction.update({
        content: `🧠 Model Antigravity channel ini diganti ke:\n\`\`\`${chosenModel}\`\`\``,
        components: []
      });
    } else if (interaction.customId === 'select_browse_item') {
      const val = interaction.values[0];
      if (val.startsWith('dir:')) {
        const targetDir = val.replace('dir:', '');
        session.currentBrowsePath = targetDir;
        await interaction.deferUpdate();
        try {
          const { embed, components } = await this.buildBrowseComponents(targetDir);
          await interaction.editReply({ embeds: [embed], components });
        } catch (e) {
          await interaction.followUp({ content: `❌ Gagal membuka folder: ${e.message}`, ephemeral: true });
        }
      } else if (val.startsWith('file:')) {
        const targetFile = val.replace('file:', '');
        await interaction.deferReply();
        try {
          const stats = fs.statSync(targetFile);
          if (stats.size > 24 * 1024 * 1024) {
            await interaction.editReply(`❌ Ukuran file melebihi batas 24MB Discord (${(stats.size / (1024 * 1024)).toFixed(1)} MB).`);
            return;
          }

          // If text file and small (< 100KB), show preview
          const ext = path.extname(targetFile).toLowerCase();
          const textExts = ['.js', '.json', '.md', '.txt', '.html', '.css', '.py', '.ts', '.yml', '.yaml', '.sh', '.bat', '.ps1'];
          let preview = '';
          if (textExts.includes(ext) && stats.size < 50 * 1024) {
            const raw = fs.readFileSync(targetFile, 'utf8');
            preview = `\`\`\`${ext.replace('.', '')}\n${raw.slice(0, 1500)}\n\`\`\`\n`;
          }

          const attachment = new AttachmentBuilder(targetFile);
          await interaction.editReply({
            content: `📄 **File:** \`${path.basename(targetFile)}\`\n${preview}⬇️ Unduh file ke HP:`,
            files: [attachment]
          });
        } catch (e) {
          await interaction.editReply(`❌ Gagal membaca file: ${e.message}`);
        }
      }
    }
  }

  async handlePrefixCommand(message) {
    const args = message.content.slice(1).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();
    const session = this.getOrCreateSession(message.channelId, message.channel?.name || '');

    if (cmd === 'usage' || cmd === 'kuota') {
      try {
        const data = await this.quotaService.fetchQuotaAndStatus();
        const embed = this.buildUsageEmbed(data);
        await message.reply({ embeds: [embed] });
      } catch (err) {
        await message.reply(`❌ Gagal mengambil data usage: ${err.message}`);
      }
    } else if (cmd === 'pwd') {
      await message.reply(`📁 CWD: \`\`\`${session.cwd}\`\`\` | 🧠 Model: \`\`\`${session.model}\`\`\``);
    } else if (cmd === 'cd') {
      const target = args.join(' ');
      if (!target) {
        await message.reply('Contoh: `!cd ./projects/my-app` atau `!cd C:\\Projects`');
        return;
      }
      try {
        const newDir = session.setCwd(target);
        this.saveSessions();
        await message.reply(`✅ CWD diubah ke: \`\`\`${newDir}\`\`\``);
      } catch (err) {
        await message.reply(`❌ Gagal: ${err.message}`);
      }
    } else if (cmd === 'exec' || cmd === 'sh') {
      const terminalCmd = args.join(' ');
      if (!terminalCmd) {
        await message.reply('Contoh: `!exec git status` atau `!sh dir`');
        return;
      }
      exec(terminalCmd, { cwd: session.cwd, shell: 'powershell.exe', maxBuffer: 1024 * 1024 * 2 }, async (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '') || (err ? err.message : '(No output)');
        const clean = output.trim();
        if (clean.length > 1900) {
          const channelFolder = sanitizeFolderName(message.channel?.name || 'exec');
          const tempDir = path.join(ROOT_DIR, 'temp_downloads', channelFolder);
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempFile = path.join(tempDir, `exec_${Date.now()}.txt`);
          fs.writeFileSync(tempFile, clean, 'utf8');
          await message.reply({
            content: `💻 Output \`${terminalCmd}\` dikirim sebagai file:`,
            files: [new AttachmentBuilder(tempFile)]
          });
        } else {
          await message.reply(`\`\`\`powershell\n${clean}\n\`\`\``);
        }
      });
    } else if (cmd === 'git') {
      const { embed, components } = await this.buildGitEmbed(session.cwd);
      await message.reply({ embeds: [embed], components });
    } else if (cmd === 'status') {
      try {
        const stats = await this.systemService.getStatus();
        const ramUsed = stats.TotalRamMB - stats.FreeRamMB;
        const ramPct = Math.round((ramUsed / stats.TotalRamMB) * 100);
        let batteryInfo = '*(Desktop / Tanpa Baterai)*';
        if (stats.BatteryPercent !== null) {
          batteryInfo = `${stats.BatteryPercent}% ${stats.BatteryStatus === 2 ? '⚡' : '🔋'}`;
        }
        await message.reply(`💻 **Laptop Status:** CPU \`${stats.CpuLoad}%\` | RAM \`${(ramUsed / 1024).toFixed(1)}/${(stats.TotalRamMB / 1024).toFixed(1)}GB\` (${ramPct}%) | Baterai: \`${batteryInfo}\``);
      } catch (e) {
        await message.reply(`❌ Error: ${e.message}`);
      }
    } else if (cmd === 'screen' || cmd === 'screenshot') {
      try {
        const channelFolder = sanitizeFolderName(message.channel?.name || 'screenshots');
        const tempDir = path.join(ROOT_DIR, 'temp_downloads', channelFolder);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const filePath = path.join(tempDir, `screen_${Date.now()}.png`);
        await this.systemService.captureScreenshot(filePath);
        await message.reply({ content: '📸 Screenshot:', files: [new AttachmentBuilder(filePath)] });
      } catch (e) {
        await message.reply(`❌ Gagal: ${e.message}`);
      }
    } else if (cmd === 'preview') {
      const port = parseInt(args[0], 10);
      if (!port) {
        await message.reply('Contoh: `!preview 3000`');
        return;
      }
      try {
        const tunnelUrl = await this.tunnelService.startTunnel(message.channelId, port);
        await message.reply(`🌐 **Web Preview Live:** [${tunnelUrl}](${tunnelUrl})`);
      } catch (e) {
        await message.reply(`❌ Gagal: ${e.message}`);
      }
    } else if (cmd === 'stoppreview') {
      this.tunnelService.stopTunnel(message.channelId);
      await message.reply('🛑 Web preview tunnel ditutup.');
    } else if (cmd === 'send') {
      const target = args.join(' ').trim().replace(/^["']|["']$/g, '');
      if (!target) {
        await message.reply('Contoh: `!send README.md`');
        return;
      }
      const resolved = path.isAbsolute(target) ? target : path.resolve(session.cwd, target);
      if (!fs.existsSync(resolved)) {
        await message.reply(`❌ File tidak ditemukan: \`${resolved}\``);
        return;
      }
      await message.reply({ files: [new AttachmentBuilder(resolved)] });
    } else if (cmd === 'stop') {
      if (session.activeProcess) {
        session.activeProcess.kill();
        session.activeProcess = null;
        await message.reply('🛑 Proses dihentikan.');
      } else {
        await message.reply('ℹ️ Tidak ada proses aktif.');
      }
    } else if (cmd === 'clear') {
      session.conversationId = null;
      this.saveSessions();
      await message.reply('🧹 Riwayat di-reset.');
    } else if (cmd === 'join' || cmd === 'vc') {
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        await message.reply('❌ Kamu harus berada di dalam Voice Channel terlebih dahulu!');
        return;
      }
      try {
        this.voiceService.join(voiceChannel);
        await message.reply(`🔊 Bot bergabung ke Voice Channel **${voiceChannel.name}**!`);
        this.voiceService.speak(message.guildId, `Halo, saya sudah bergabung di voice channel.`);
      } catch (e) {
        await message.reply(`❌ Gagal: ${e.message}`);
      }
    } else if (cmd === 'leave') {
      const ok = this.voiceService.leave(message.guildId);
      if (ok) {
        await message.reply('👋 Keluar dari Voice Channel.');
      } else {
        await message.reply('ℹ️ Bot tidak berada di Voice Channel.');
      }
    } else if (cmd === 'say') {
      const text = args.join(' ').trim();
      if (!text) {
        await message.reply('Contoh: `!say Halo semuanya`');
        return;
      }
      if (!this.voiceService.isConnected(message.guildId)) {
        await message.reply('⚠️ Bot belum join Voice Channel. Ketik `!join` dulu!');
        return;
      }
      this.voiceService.speak(message.guildId, text);
      await message.reply(`🗣️ Mengucapkan: *"${text}"* di Voice Channel.`);
    }
  }

  async handleDirectPrompt(channel, session, promptText) {
    if (session.activeProcess) {
      await channel.send('⚠️ Channel ini sedang menjalankan task sebelumnya. Ketik `/stop` untuk membatalkannya.');
      return;
    }

    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 4500);
    channel.sendTyping().catch(() => {});

    let statusMsg = await channel.send({
      content: `⏳ **[Antigravity AI Auto-Fix]**\n📁 CWD: \`\`\`${session.cwd}\`\`\`\n🧠 Model: \`\`\`${session.model}\`\`\`\nMenjalankan analisa perbaikan...`
    });

    let toolCount = 0;
    let lastStatusUpdate = Date.now();

    const updateStatus = async (text) => {
      const now = Date.now();
      if (now - lastStatusUpdate < 1200) return;
      lastStatusUpdate = now;
      try {
        await statusMsg.edit(text).catch(() => {});
      } catch (_) {}
    };

    const notes = this.notesService.getNotes(session.channelId);
    const timeoutMinutes = parseInt(process.env.TASK_TIMEOUT_MINUTES || '30', 10);
    const timeoutTimer = setTimeout(() => {
      if (session.activeProcess) {
        session.activeProcess.kill();
        session.activeProcess = null;
        clearInterval(typingInterval);
        statusMsg.edit(`⏱️ **Timeout Auto-Fix:** Task dibatalkan karena melebihi batas waktu ${timeoutMinutes} menit.`).catch(() => {});
      }
    }, timeoutMinutes * 60 * 1000);

    try {
      session.activeProcess = AgyRunner.runPrompt({
        prompt: promptText,
        cwd: session.cwd,
        model: session.model,
        conversationId: session.conversationId,
        notes,
        onInit: (initData) => {
          session.conversationId = initData.conversation_id;
        },
        onToolStart: async (step) => {
          toolCount++;
          const toolName = step.tool_name || 'tool';
          await updateStatus(`⚙️ **[Auto-Fix Langkah ${toolCount}] Menjalankan: \`${toolName}\`**`);
        },
        onToolDone: async (step) => {
          const toolName = step.tool_name || 'tool';
          await updateStatus(`✅ **[Auto-Fix Langkah ${toolCount} Selesai] \`${toolName}\`**`);
        },
        onResult: async (result) => {
          clearTimeout(timeoutTimer);
          clearInterval(typingInterval);
          session.activeProcess = null;
          session.conversationId = result.conversation_id || session.conversationId;
          this.saveSessions();

          let rawResponse = result.response || '*(Perbaikan selesai)*';
          const fileAttachments = [];
          const attachRegex = /\[ATTACH_FILE:\s*([^\]]+)\]/gi;
          let match;
          while ((match = attachRegex.exec(rawResponse)) !== null) {
            let targetPath = match[1].trim().replace(/^["']|["']$/g, '');
            let resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(session.cwd, targetPath);
            if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
              fileAttachments.push(new AttachmentBuilder(resolved));
            }
          }
          rawResponse = rawResponse.replace(/\[ATTACH_FILE:\s*[^\]]+\]/gi, '').trim();

          await statusMsg.edit(`✨ **Perbaikan Selesai!** • 📁 \`${session.cwd}\``).catch(() => {});
          await this.sendLargeMessage(channel, formatDiscordText(rawResponse), fileAttachments);
        },
        onError: async (err) => {
          clearTimeout(timeoutTimer);
          clearInterval(typingInterval);
          session.activeProcess = null;
          await statusMsg.edit(`❌ **Error Auto-Fix:** ${err.message}`).catch(() => {});
        }
      });
    } catch (err) {
      clearTimeout(timeoutTimer);
      clearInterval(typingInterval);
      session.activeProcess = null;
      await statusMsg.edit(`❌ **Gagal:** ${err.message}`).catch(() => {});
    }
  }

  async handlePromptMessage(message) {
    const session = this.getOrCreateSession(message.channelId, message.channel?.name || '');

    if (session.activeProcess) {
      await message.reply('⚠️ Channel ini sedang menjalankan task sebelumnya. Ketik `/stop` jika ingin membatalkannya.');
      return;
    }

    // Handle user attachments from Discord -> save to laptop per channel folder
    let fullPrompt = message.content;
    if (message.attachments && message.attachments.size > 0) {
      const channelFolder = sanitizeFolderName(message.channel?.name || message.channelId || 'general');
      const downloadDir = path.join(ROOT_DIR, 'temp_downloads', channelFolder);
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

      const downloadedFiles = [];
      for (const [, att] of message.attachments) {
        try {
          const localFile = path.join(downloadDir, `${Date.now()}_${att.name}`);
          const res = await fetch(att.url);
          const arrayBuffer = await res.arrayBuffer();
          fs.writeFileSync(localFile, Buffer.from(arrayBuffer));
          downloadedFiles.push(localFile);
        } catch (err) {
          console.error('Failed to download user attachment:', err);
        }
      }
      if (downloadedFiles.length > 0) {
        fullPrompt += `\n\n[Catatan Sistem: File lampiran dari pengguna di Discord telah diunduh ke laptop pada: ${downloadedFiles.map(f => `\`${f}\``).join(', ')}]`;
      }
    }

    // Typing heartbeat
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 4500);
    message.channel.sendTyping().catch(() => {});

    // Send initial status message
    let statusMsg = await message.reply({
      content: `⏳ **[Memulai Antigravity CLI]**\n📁 CWD: \`\`\`${session.cwd}\`\`\`\n🧠 Model: \`\`\`${session.model}\`\`\`\nMenyiapkan agent...`
    });

    let toolCount = 0;
    let lastStatusUpdate = Date.now();

    const updateStatus = async (text) => {
      const now = Date.now();
      if (now - lastStatusUpdate < 1200) return;
      lastStatusUpdate = now;
      try {
        await statusMsg.edit(text).catch(() => {});
      } catch (_) {}
    };

    // Timeout safety (default 30 minutes, configurable via TASK_TIMEOUT_MINUTES in .env)
    const timeoutMinutes = parseInt(process.env.TASK_TIMEOUT_MINUTES || '30', 10);
    const timeoutTimer = setTimeout(() => {
      if (session.activeProcess) {
        session.activeProcess.kill();
        session.activeProcess = null;
        clearInterval(typingInterval);
        statusMsg.edit(`⏱️ **Timeout:** Task dibatalkan karena melebihi batas waktu ${timeoutMinutes} menit.`).catch(() => {});
      }
    }, timeoutMinutes * 60 * 1000);

    const channelNotes = this.notesService.getNotes(session.channelId);

    try {
      session.activeProcess = AgyRunner.runPrompt({
        prompt: fullPrompt,
        cwd: session.cwd,
        model: session.model,
        conversationId: session.conversationId,
        notes: channelNotes,
        onInit: (initData) => {
          session.conversationId = initData.conversation_id;
        },
        onToolStart: async (step) => {
          toolCount++;
          const toolName = step.tool_name || 'tool';
          let paramStr = '';
          if (step.tool_info && step.tool_info.parameters) {
            const p = step.tool_info.parameters;
            paramStr = p.CommandLine || p.Path || p.filepath || p.Query || JSON.stringify(p);
            if (paramStr.length > 80) paramStr = paramStr.slice(0, 80) + '...';
          }
          await updateStatus(`⚙️ **[Langkah ${toolCount}] Menjalankan: \`${toolName}\`**\n\`\`\`powershell\n${paramStr || '(eksekusi tool)'}\n\`\`\`\n📁 \`${session.cwd}\``);
        },
        onToolDone: async (step) => {
          const toolName = step.tool_name || 'tool';
          const dur = step.duration_seconds ? ` (${step.duration_seconds.toFixed(1)}s)` : '';
          await updateStatus(`✅ **[Langkah ${toolCount} Selesai] \`${toolName}\`${dur}**\nSedang memproses langkah berikutnya...`);
        },
        onResult: async (result) => {
          clearTimeout(timeoutTimer);
          clearInterval(typingInterval);
          session.activeProcess = null;
          session.conversationId = result.conversation_id || session.conversationId;
          this.saveSessions();

          let rawResponse = result.response || '*(Tidak ada teks respons)*';

          // Extract [ATTACH_FILE: ...] tags
          const fileAttachments = [];
          const attachRegex = /\[ATTACH_FILE:\s*([^\]]+)\]/gi;
          let match;
          while ((match = attachRegex.exec(rawResponse)) !== null) {
            let targetPath = match[1].trim().replace(/^["']|["']$/g, '');
            let resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(session.cwd, targetPath);
            if (fs.existsSync(resolved)) {
              try {
                const stats = fs.statSync(resolved);
                if (!stats.isDirectory()) {
                  if (stats.size > 24 * 1024 * 1024) {
                    rawResponse += `\n⚠️ *File \`${path.basename(resolved)}\` melebihi batas 24MB Discord.*`;
                  } else {
                    fileAttachments.push(new AttachmentBuilder(resolved));
                  }
                }
              } catch (e) {
                console.error('Error attaching file:', e);
              }
            } else {
              rawResponse += `\n⚠️ *File tidak ditemukan di laptop:* \`${resolved}\``;
            }
          }

          // Strip [ATTACH_FILE: ...] tags from displayed text
          rawResponse = rawResponse.replace(/\[ATTACH_FILE:\s*[^\]]+\]/gi, '').trim();

          const responseText = formatDiscordText(rawResponse || '*(File terlampir)*');
          const duration = result.duration_seconds ? `⏱️ ${result.duration_seconds.toFixed(1)}s` : '';
          const turns = result.num_turns ? `• ${result.num_turns} turns` : '';

          await statusMsg.edit(`✨ **Selesai!** ${duration} ${turns} • 📁 \`${session.cwd}\``).catch(() => {});
          await this.sendLargeMessage(message.channel, responseText, fileAttachments);

          // Announce in Voice Channel if connected
          if (message.guildId && this.voiceService.isConnected(message.guildId)) {
            const chanName = message.channel?.name ? `channel ${message.channel.name}` : 'channel ini';
            this.voiceService.speak(message.guildId, `Tugas di ${chanName} sudah selesai dikerjakan ya!`);
          }
        },
        onError: async (err) => {
          clearTimeout(timeoutTimer);
          clearInterval(typingInterval);
          session.activeProcess = null;
          await statusMsg.edit(`❌ **Error:** ${err.message}`).catch(() => {});

          if (message.guildId && this.voiceService.isConnected(message.guildId)) {
            this.voiceService.speak(message.guildId, `Perhatian, terjadi kesalahan saat menjalankan tugas.`);
          }
        }
      });
    } catch (err) {
      clearTimeout(timeoutTimer);
      clearInterval(typingInterval);
      session.activeProcess = null;
      await statusMsg.edit(`❌ **Gagal menjalankan:** ${err.message}`).catch(() => {});
    }
  }

  async sendLargeMessage(channel, text, files = []) {
    if (!text || text.trim() === '') {
      if (files && files.length > 0) {
        await channel.send({ files });
      }
      return;
    }

    const MAX_LIMIT = 1950;
    if (text.length <= MAX_LIMIT) {
      const options = { content: text };
      if (files && files.length > 0) options.files = files;
      await channel.send(options);
      return;
    }

    const chunks = [];
    let remaining = text;
    let inCodeBlock = false;
    let codeLanguage = '';

    while (remaining.length > 0) {
      if (remaining.length <= MAX_LIMIT) {
        chunks.push((inCodeBlock ? '```' + codeLanguage + '\n' : '') + remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf('\n\n', MAX_LIMIT);
      if (splitIndex === -1 || splitIndex < 500) {
        splitIndex = remaining.lastIndexOf('\n', MAX_LIMIT);
      }
      if (splitIndex === -1 || splitIndex < 500) {
        splitIndex = MAX_LIMIT;
      }

      let chunk = remaining.slice(0, splitIndex);
      remaining = remaining.slice(splitIndex).trim();

      // Check code block fences
      const codeMatches = chunk.match(/```([a-zA-Z0-9_-]*)/g);
      if (codeMatches) {
        const count = codeMatches.length;
        if (count % 2 !== 0) {
          // Odd number of backticks -> chunk opened a codeblock without closing
          const lastMatch = codeMatches[codeMatches.length - 1];
          codeLanguage = lastMatch.replace('```', '').trim();
          chunk += '\n```';
          inCodeBlock = true;
        } else {
          inCodeBlock = false;
        }
      }

      chunks.push(chunk);
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.trim()) {
        const options = { content: chunk };
        if (i === 0 && files && files.length > 0) {
          options.files = files;
        }
        await channel.send(options);
      }
    }
  }

  start() {
    this.client.login(this.token);
  }
}

module.exports = { DiscordAntigravityBot };
