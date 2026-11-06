const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

class UpdateService {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, 'updates_data');
    this.dataFile = path.join(this.dataDir, 'updates.json');
    this.pkgFile = path.join(rootDir, 'package.json');
    this.repoOwner = 'willgregorry';
    this.repoName = 'discord-antigravity-agent';
    this.initDirs();
  }

  initDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.dataFile)) {
      fs.writeFileSync(this.dataFile, JSON.stringify({
        welcomedGuilds: [],
        lastNotifiedSha: null
      }, null, 2), 'utf8');
    }
  }

  getStorage() {
    this.initDirs();
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    } catch (_) {
      return { welcomedGuilds: [], lastNotifiedSha: null };
    }
  }

  saveStorage(data) {
    this.initDirs();
    fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2), 'utf8');
  }

  isGuildWelcomed(guildId) {
    const data = this.getStorage();
    return (data.welcomedGuilds || []).includes(guildId);
  }

  markGuildWelcomed(guildId) {
    const data = this.getStorage();
    if (!data.welcomedGuilds) data.welcomedGuilds = [];
    if (!data.welcomedGuilds.includes(guildId)) {
      data.welcomedGuilds.push(guildId);
      this.saveStorage(data);
    }
  }

  getVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync(this.pkgFile, 'utf8'));
      return pkg.version || '1.0.0';
    } catch (_) {
      return '1.0.0';
    }
  }

  getLocalGitInfo() {
    try {
      const sha = execSync('git rev-parse --short HEAD', { cwd: this.rootDir, encoding: 'utf8' }).trim();
      const message = execSync('git log -1 --pretty=%B', { cwd: this.rootDir, encoding: 'utf8' }).trim();
      return {
        sha,
        message: message.split('\n')[0],
        version: this.getVersion()
      };
    } catch (_) {
      return {
        sha: 'unknown',
        message: 'Tidak dapat membaca git lokal',
        version: this.getVersion()
      };
    }
  }

  async getRemoteGitInfo() {
    try {
      const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits/main`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Antigravity-Discord-Agent' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        sha: data.sha ? data.sha.slice(0, 7) : null,
        fullSha: data.sha || null,
        message: data.commit ? data.commit.message.split('\n')[0] : 'Pembaruan baru',
        author: data.commit?.author?.name || 'Kontributor',
        date: data.commit?.author?.date || null,
        url: data.html_url || `https://github.com/${this.repoOwner}/${this.repoName}`
      };
    } catch (_) {
      return null;
    }
  }

  async checkUpdate() {
    const local = this.getLocalGitInfo();
    const remote = await this.getRemoteGitInfo();
    if (!remote || !remote.sha) return { hasUpdate: false, local, remote: null };

    const hasUpdate = local.sha !== 'unknown' && local.sha.toLowerCase() !== remote.sha.toLowerCase();
    return {
      hasUpdate,
      local,
      remote
    };
  }

  findGeneralChannel(guild) {
    if (!guild || !guild.channels) return null;
    const channels = guild.channels.cache;

    // 1. Cari channel teks yang mengandung general / umum / chat
    const byName = channels.find(c =>
      c.type === ChannelType.GuildText &&
      /(general|umum|chat|main)/i.test(c.name) &&
      c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
    );
    if (byName) return byName;

    // 2. System channel jika bisa dikirimi pesan
    if (guild.systemChannel && guild.systemChannel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
      return guild.systemChannel;
    }

    // 3. Fallback: Channel teks pertama yang bisa dikirimi pesan
    return channels.find(c =>
      c.type === ChannelType.GuildText &&
      c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
    ) || null;
  }

  findAnnouncementChannel(guild) {
    if (!guild || !guild.channels) return null;
    const channels = guild.channels.cache;

    // 1. Cari channel announcement/updates
    const byName = channels.find(c =>
      (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
      /(announcement|announcements|updates|update|pengumuman|changelog)/i.test(c.name) &&
      c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
    );
    if (byName) return byName;

    // 2. Fallback ke general channel
    return this.findGeneralChannel(guild);
  }

  buildWelcomePayload() {
    const local = this.getLocalGitInfo();
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 Halo! Antigravity Discord Agent Siap Digunakan!')
      .setDescription(
        `Bot asisten koding & terminal otonom berhasil terhubung ke server ini.\n\n` +
        `🔖 **Versi Saat Ini:** \`v${local.version}\` (Build: \`${local.sha}\`)\n` +
        `📝 **Update Terakhir:** *${local.message}*`
      )
      .addFields(
        {
          name: '🚀 Fitur Unggulan',
          value:
            '• **Autonomous Coding Bridge:** Jalankan prompt, debug, edit file, dan run command langsung dari chat.\n' +
            '• **Continuous Learning (`/enhance`):** Ajari bot kaidah koding baru dari video Reels & TikTok.\n' +
            '• **Multi-Account Manager (`/account`):** Simpan & ganti akun Gemini Pro instan tanpa limit kuota.\n' +
            '• **Dev Watcher (`/preview` & `/watch-server`):** Auto tunnel Cloudflare & auto-restart dev server.'
        },
        {
          name: '📢 Saran Konfigurasi Penghubung Update',
          value:
            'Buat channel khusus bernama **`#announcements`** atau **`#updates`** di server ini.\n' +
            '> Setiap kali ada rilis fitur baru di GitHub, bot akan memposting pemberitahuan ke channel tersebut lengkap dengan tombol **`[🚀 Pull & Update Sekarang]`** agar tim/pengguna bisa langsung meng-update bot hanya dengan 1-klik!'
        },
        {
          name: '💡 Mulai Menggunakan',
          value: 'Ketik `/help` untuk panduan lengkap, atau langsung ketik instruksi koding Anda di channel mana pun!'
        }
      )
      .setFooter({ text: 'Antigravity Discord Bridge • Pairing Coding Assistant' })
      .setTimestamp();

    return { embeds: [embed] };
  }

  async sendWelcomeToGuild(guild) {
    if (!guild || this.isGuildWelcomed(guild.id)) return false;

    const channel = this.findGeneralChannel(guild);
    if (!channel) return false;

    try {
      const payload = this.buildWelcomePayload();
      await channel.send(payload);
      this.markGuildWelcomed(guild.id);
      return true;
    } catch (e) {
      console.warn(`[UPDATE SERVICE] Gagal kirim welcome ke guild ${guild.name}:`, e.message);
      return false;
    }
  }

  buildUpdatePayload(remote, local) {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🚀 Pembaruan Kode Tersedia di GitHub!')
      .setDescription(
        `Versi terbaru dari repository **\`${this.repoOwner}/${this.repoName}\`** telah dirilis oleh **${remote.author}**.\n\n` +
        `🔖 **Commit Baru:** \`${remote.sha}\`\n` +
        `📝 **Pesan Rilis:** *${remote.message}*\n` +
        `📌 **Versi Lokal Kamu:** \`${local.sha}\``
      )
      .addFields({
        name: '⚡ Cara Memperbarui',
        value:
          '> Klik tombol **`[🚀 Pull & Update Sekarang]`** di bawah untuk langsung mengunduh update & restart bot di laptop secara otomatis.\n' +
          '> Atau ketik `/update` di Discord kapan saja!'
      })
      .setFooter({ text: 'Klik tombol di bawah untuk auto-sync dari GitHub' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_pull_update')
        .setLabel('🚀 Pull & Update Sekarang')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setLabel('🔗 Lihat di GitHub')
        .setStyle(ButtonStyle.Link)
        .setURL(remote.url || `https://github.com/${this.repoOwner}/${this.repoName}`)
    );

    return { embeds: [embed], components: [row] };
  }

  async broadcastUpdateIfAvailable(client, isManual = false) {
    const { hasUpdate, local, remote } = await this.checkUpdate();
    if (!hasUpdate && !isManual) return false;
    if (!remote) return false;

    const storage = this.getStorage();
    if (!isManual && storage.lastNotifiedSha === remote.sha) {
      // Sudah pernah di-broadcast untuk SHA ini
      return false;
    }

    let sentCount = 0;
    const payload = this.buildUpdatePayload(remote, local);

    for (const [, guild] of client.guilds.cache) {
      const targetChannel = this.findAnnouncementChannel(guild);
      if (targetChannel) {
        try {
          await targetChannel.send(payload);
          sentCount++;
        } catch (_) {}
      }
    }

    if (sentCount > 0) {
      storage.lastNotifiedSha = remote.sha;
      this.saveStorage(storage);
    }

    return sentCount > 0;
  }

  async executePullAndUpdate() {
    return new Promise((resolve) => {
      try {
        const pullOutput = execSync('git pull origin main', { cwd: this.rootDir, encoding: 'utf8', timeout: 30000 });
        let npmOutput = '';
        if (pullOutput.includes('package.json')) {
          npmOutput = execSync('npm install --omit=dev', { cwd: this.rootDir, encoding: 'utf8', timeout: 60000 });
        }
        resolve({
          success: true,
          pullOutput: pullOutput.trim(),
          npmOutput: npmOutput ? npmOutput.trim() : null
        });
      } catch (err) {
        resolve({
          success: false,
          error: err.message
        });
      }
    });
  }

  triggerDelayedRestart(seconds = 3) {
    const psCmd = `Start-Sleep -Seconds ${seconds}; & "${path.join(this.rootDir, 'scripts', 'restart.bat')}"`;
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
      detached: true,
      stdio: 'ignore'
    }).unref();
  }
}

module.exports = { UpdateService };
