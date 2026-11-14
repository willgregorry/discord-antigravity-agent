const path = require('path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const { createTempFile } = require('../utils/file-helper');
const { execPowerShell } = require('../utils/shell-exec');
const { executeAiPrompt } = require('./ai-runner.helper');

/**
 * Builds the interactive Git repository dashboard embed and action buttons.
 */
async function buildGitEmbed(cwd, gitService) {
  const gitInfo = await gitService.getStatus(cwd);
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

/**
 * Runs a PowerShell command and returns either an inline code block or a file attachment for large outputs.
 */
async function buildExecPayload(cmd, cwd, channelName, rootDir) {
  const cleanOutput = await execPowerShell(cmd, cwd);
  if (cleanOutput.length > 1900) {
    const tempFile = createTempFile(rootDir, channelName || 'exec', 'exec', 'txt', cleanOutput);
    return {
      content: `💻 Perintah: \`${cmd}\`\n📁 \`${cwd}\`\nOutput terlalu panjang, dikirim sebagai file:`,
      files: [new AttachmentBuilder(tempFile)]
    };
  }
  return {
    content: `💻 Perintah: \`${cmd}\`\n📁 \`${cwd}\`\n\`\`\`powershell\n${cleanOutput}\n\`\`\``
  };
}

/**
 * Provides developer tooling commands: PowerShell execution, Git control,
 * Cloudflare web preview tunnels, and crash-watching dev servers with 1-click AI fix.
 */
module.exports = function createDevopsCommands(ctx) {
  return {
    slashBuilders: [
      new SlashCommandBuilder()
        .setName('preview')
        .setDescription('Buka URL publik live untuk web server lokal via Cloudflare Tunnel')
        .addIntegerOption(opt => opt.setName('port').setDescription('Port server lokal (contoh: 3000, 5173, 8080)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('stop-preview')
        .setDescription('Tutup web preview tunnel untuk channel ini'),
      new SlashCommandBuilder()
        .setName('exec')
        .setDescription('Jalankan perintah PowerShell cepat langsung di folder channel ini')
        .addStringOption(opt => opt.setName('command').setDescription('Perintah terminal (contoh: git status, npm test, dir)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('git')
        .setDescription('Menu interaktif Git (Status, Diff, Commit, Push, Pull)'),
      new SlashCommandBuilder()
        .setName('watch-server')
        .setDescription('Jalankan dev server dengan pemantau crash otomatis (1-Click AI Fix)')
        .addStringOption(opt => opt.setName('command').setDescription('Perintah dev server (contoh: npm run dev, python app.py)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('stop-server')
        .setDescription('Hentikan dev server yang sedang dipantau di channel ini')
    ],

    slash: {
      preview: async (interaction) => {
        const port = interaction.options.getInteger('port');
        await interaction.deferReply();
        try {
          const tunnelUrl = await ctx.tunnelService.startTunnel(interaction.channelId, port);
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
      },

      'stop-preview': async (interaction) => {
        const stopped = ctx.tunnelService.stopTunnel(interaction.channelId);
        await interaction.reply(
          stopped ? '🛑 Web preview tunnel channel ini berhasil ditutup.' : 'ℹ️ Tidak ada tunnel web preview yang sedang aktif di channel ini.'
        );
      },

      exec: async (interaction, session) => {
        const cmd = interaction.options.getString('command');
        await interaction.deferReply();
        const payload = await buildExecPayload(cmd, session.cwd, interaction.channel?.name, ctx.rootDir);
        await interaction.editReply(payload);
      },

      git: async (interaction, session) => {
        await interaction.deferReply();
        try {
          const { embed, components } = await buildGitEmbed(session.cwd, ctx.gitService);
          await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
          await interaction.editReply(`❌ Gagal membaca git: ${err.message}`);
        }
      },

      'watch-server': async (interaction, session) => {
        const cmd = interaction.options.getString('command');
        await interaction.deferReply();

        ctx.watchdogService.startWatch(interaction.channelId, cmd, session.cwd, async (crashInfo) => {
          try {
            const ch = await ctx.client.channels.fetch(crashInfo.channelId);
            if (!ch) return;

            const crashEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle('🚨 Server Crash Terdeteksi!')
              .setDescription(`Server dev di channel ini mengalami crash atau error fatal!\n\n💻 **Perintah:** \`${crashInfo.command}\`\n📁 **Workspace:** \`${crashInfo.cwd}\`\n\n**🛑 Error Log Terakhir:**\n\`\`\`\n${crashInfo.fullTail.slice(-1200)}\n\`\`\``)
              .setFooter({ text: 'Klik tombol di bawah untuk perbaikan otomatis dengan AI!' });

            const actionRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`fix_crash_${crashInfo.channelId}`).setLabel('🔘 Perbaiki dengan Antigravity AI (1-Click Fix)').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`stop_crash_${crashInfo.channelId}`).setLabel('🛑 Stop Server').setStyle(ButtonStyle.Secondary)
            );

            await ch.send({ embeds: [crashEmbed], components: [actionRow] });
            if (interaction.guildId && ctx.voiceService.isConnected(interaction.guildId)) {
              ctx.voiceService.speak(interaction.guildId, 'Perhatian, dev server mengalami crash!');
            }
          } catch (e) {
            console.error('Failed to notify crash:', e);
          }
        });

        await interaction.editReply(`🛡️ **Server Crash Watchdog Aktif!**\n💻 Perintah: \`${cmd}\`\n📁 Folder: \`${session.cwd}\`\n> Bot akan otomatis memantau terminal ini. Jika terjadi crash atau unhandled error, kamu akan langsung diberi notifikasi darurat di HP lengkap dengan tombol **1-Click AI Fix**!`);
      },

      'stop-server': async (interaction) => {
        const stopped = ctx.watchdogService.stopWatch(interaction.channelId);
        await interaction.reply(
          stopped ? '🛑 Dev server watchdog di channel ini berhasil dihentikan.' : 'ℹ️ Tidak ada server yang sedang dipantau di channel ini.'
        );
      }
    },

    prefix: {
      exec: async (message, args, session) => {
        const terminalCmd = args.join(' ');
        if (!terminalCmd) {
          await message.reply('Contoh: `!exec git status` atau `!sh dir`');
          return;
        }
        const payload = await buildExecPayload(terminalCmd, session.cwd, message.channel?.name, ctx.rootDir);
        await message.reply(payload);
      },
      sh: async (message, args, session) => {
        const terminalCmd = args.join(' ');
        if (!terminalCmd) {
          await message.reply('Contoh: `!exec git status` atau `!sh dir`');
          return;
        }
        const payload = await buildExecPayload(terminalCmd, session.cwd, message.channel?.name, ctx.rootDir);
        await message.reply(payload);
      },
      git: async (message, _args, session) => {
        const { embed, components } = await buildGitEmbed(session.cwd, ctx.gitService);
        await message.reply({ embeds: [embed], components });
      },
      preview: async (message, args) => {
        const port = parseInt(args[0], 10);
        if (!port) {
          await message.reply('Contoh: `!preview 3000`');
          return;
        }
        try {
          const tunnelUrl = await ctx.tunnelService.startTunnel(message.channelId, port);
          await message.reply(`🌐 **Web Preview Live:** [${tunnelUrl}](${tunnelUrl})`);
        } catch (e) {
          await message.reply(`❌ Gagal: ${e.message}`);
        }
      },
      stoppreview: async (message) => {
        ctx.tunnelService.stopTunnel(message.channelId);
        await message.reply('🛑 Web preview tunnel ditutup.');
      }
    },

    buttons: [
      {
        match: 'git_diff',
        handle: async (interaction, session) => {
          await interaction.deferReply();
          const diff = await ctx.gitService.getDiff(session.cwd);
          if (diff.length > 1900) {
            const tempFile = createTempFile(ctx.rootDir, interaction.channel?.name || 'git', 'git_diff', 'patch', diff);
            await interaction.editReply({
              content: '🔍 **Git Diff:** (Perubahan terlalu panjang, dikirim sebagai file patch)',
              files: [new AttachmentBuilder(tempFile)]
            });
          } else {
            await interaction.editReply({ content: `🔍 **Git Diff:**\n\`\`\`diff\n${diff}\n\`\`\`` });
          }
        }
      },
      {
        match: 'git_commit_btn',
        handle: async (interaction) => {
          const modal = new ModalBuilder().setCustomId('git_commit_modal').setTitle('Git Commit All');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('commit_message')
                .setLabel('Commit Message')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Contoh: feat: implement auto-tunneling and watchdog')
                .setRequired(true)
            )
          );
          await interaction.showModal(modal);
        }
      },
      {
        match: 'git_push',
        handle: async (interaction, session) => {
          await interaction.deferReply();
          const res = await ctx.gitService.push(session.cwd);
          await interaction.editReply(
            res.ok
              ? `🚀 **Git Push Berhasil!**\n\`\`\`\n${res.output || 'Everything up-to-date'}\n\`\`\``
              : `❌ **Git Push Gagal:**\n\`\`\`\n${res.output}\n\`\`\``
          );
        }
      },
      {
        match: 'git_pull',
        handle: async (interaction, session) => {
          await interaction.deferReply();
          const res = await ctx.gitService.pull(session.cwd);
          await interaction.editReply(
            res.ok
              ? `📥 **Git Pull Berhasil!**\n\`\`\`\n${res.output}\n\`\`\``
              : `❌ **Git Pull Gagal:**\n\`\`\`\n${res.output}\n\`\`\``
          );
        }
      },
      {
        match: 'git_refresh',
        handle: async (interaction, session) => {
          await interaction.deferUpdate();
          const { embed, components } = await buildGitEmbed(session.cwd, ctx.gitService);
          await interaction.editReply({ embeds: [embed], components });
        }
      },
      {
        match: id => id.startsWith('fix_crash_'),
        handle: async (interaction, session) => {
          const targetChannelId = interaction.customId.replace('fix_crash_', '');
          const sInfo = ctx.watchdogService.getServerInfo(targetChannelId);
          await interaction.reply('🛠️ **Memulai Antigravity AI Auto-Fix...** Sedang menganalisa file dan error!');

          const crashTail = sInfo ? sInfo.logs.slice(-25).join('\n') : 'Tidak ada log tersimpan.';
          const fixPrompt =
            `Server dev crash saat menjalankan command '${sInfo ? sInfo.command : 'server'}'.\n` +
            `Berikut tail log error crash terakhir:\n\`\`\`\n${crashTail}\n\`\`\`\n` +
            `Tolong telusuri file yang bersangkutan, identifikasi bug penyebab error, perbaiki kodenya sekarang juga, dan jelaskan apa yang diperbaiki secara singkat dan padat!`;

          await executeAiPrompt({ channel: interaction.channel, session, promptText: fixPrompt, ctx, mode: 'autofix' });
        }
      },
      {
        match: id => id.startsWith('stop_crash_'),
        handle: async (interaction) => {
          const targetChannelId = interaction.customId.replace('stop_crash_', '');
          ctx.watchdogService.stopWatch(targetChannelId);
          await interaction.reply('🛑 Dev server watchdog dihentikan.');
        }
      }
    ],

    modals: {
      git_commit_modal: async (interaction, session) => {
        const commitMsg = interaction.fields.getTextInputValue('commit_message');
        await interaction.deferReply();
        const res = await ctx.gitService.commit(session.cwd, commitMsg);
        await interaction.editReply(
          res.ok
            ? `📝 **Git Commit Berhasil!**\n\`\`\`\n${res.output}\n\`\`\``
            : `❌ **Git Commit Gagal:**\n\`\`\`\n${res.output}\n\`\`\``
        );
      }
    }
  };
};
