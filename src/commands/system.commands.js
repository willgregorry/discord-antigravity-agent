const path = require('path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const { renderProgressBar, formatRelativeTime } = require('../utils/discord-format');
const { ensureChannelTempDir } = require('../utils/file-helper');

/**
 * Captures a desktop screenshot into a per-channel temp file and returns its path.
 */
async function captureChannelScreenshot(channelName, ctx) {
  const tempDir = ensureChannelTempDir(ctx.rootDir, channelName || 'screenshots', 'screenshots');
  const filePath = path.join(tempDir, `screen_${Date.now()}.png`);
  return await ctx.systemService.captureScreenshot(filePath);
}

/**
 * Provides remote Windows workstation monitoring and power/display controls.
 */
module.exports = function createSystemCommands(ctx) {
  const handleScreenSlash = async (interaction) => {
    await interaction.deferReply();
    try {
      const filePath = await captureChannelScreenshot(interaction.channel?.name, ctx);
      await interaction.editReply({
        content: '📸 **Tangkapan Layar Live Monitor Laptop:**',
        files: [new AttachmentBuilder(filePath)]
      });
    } catch (err) {
      await interaction.editReply(`❌ Gagal mengambil screenshot: ${err.message}`);
    }
  };

  const handleScreenPrefix = async (message) => {
    try {
      const filePath = await captureChannelScreenshot(message.channel?.name, ctx);
      await message.reply({ content: '📸 Screenshot:', files: [new AttachmentBuilder(filePath)] });
    } catch (e) {
      await message.reply(`❌ Gagal: ${e.message}`);
    }
  };

  return {
    slashBuilders: [
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
      new SlashCommandBuilder()
        .setName('screen')
        .setDescription('Ambil tangkapan layar live monitor laptop saat ini')
    ],

    slash: {
      status: async (interaction) => {
        await interaction.deferReply();
        try {
          const stats = await ctx.systemService.getStatus();
          const ramUsed = stats.TotalRamMB - stats.FreeRamMB;
          const ramPct = Math.round((ramUsed / stats.TotalRamMB) * 100);
          const ramBar = renderProgressBar(stats.FreeRamMB / stats.TotalRamMB);

          let batteryInfo = '*(Desktop / Tanpa Baterai)*';
          if (stats.BatteryPercent !== null) {
            const isCharging = stats.BatteryStatus === 2 ? '⚡ (Charging)' : '🔋 (Discharging)';
            batteryInfo = `${stats.BatteryPercent}% ${isCharging}`;
          }

          const diskLines = (stats.Disks || []).map(d => {
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
      },

      screen: handleScreenSlash,
      screenshot: handleScreenSlash,

      lock: async (interaction) => {
        ctx.systemService.lockWorkstation();
        await interaction.reply('🔒 Layar laptop berhasil dikunci (Lock Workstation)!');
      },

      'screen-off': async (interaction) => {
        ctx.systemService.turnOffMonitor();
        await interaction.reply('🌑 Monitor laptop dimatikan untuk hemat daya. (Layar akan kembali menyala saat ada input mouse/keyboard).');
      },

      sleep: async (interaction) => {
        await interaction.reply('💤 Memerintahkan laptop untuk masuk ke Sleep Mode...');
        setTimeout(() => ctx.systemService.sleepLaptop(), 1000);
      },

      shutdown: async (interaction) => {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirm_shutdown').setLabel('⚠️ Ya, Matikan Sekarang').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('cancel_shutdown').setLabel('Batal').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
          content: '⚠️ **KONFIRMASI REMOTE SHUTDOWN:**\nApakah kamu yakin ingin mematikan laptop kamu secara remote dari Discord?\n*(Jika laptop mati, kamu harus menekan tombol power secara fisik di laptop untuk menyalakannya kembali).*',
          components: [row]
        });
      }
    },

    prefix: {
      status: async (message) => {
        try {
          const stats = await ctx.systemService.getStatus();
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
      },
      screen: handleScreenPrefix,
      screenshot: handleScreenPrefix
    },

    buttons: [
      {
        match: 'confirm_shutdown',
        handle: async (interaction) => {
          await interaction.update({ content: '🔌 **Shutdown dikonfirmasi!** Laptop akan mati dalam 10 detik. Menutup koneksi...', components: [] });
          ctx.systemService.shutdownLaptop();
        }
      },
      {
        match: 'cancel_shutdown',
        handle: async (interaction) => {
          ctx.systemService.cancelShutdown();
          await interaction.update({ content: '✅ Remote shutdown dibatalkan.', components: [] });
        }
      }
    ]
  };
};
