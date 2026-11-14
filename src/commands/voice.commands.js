const { SlashCommandBuilder } = require('discord.js');

/**
 * Provides Voice Channel join/leave controls and Indonesian TTS announcements.
 */
module.exports = function createVoiceCommands(ctx) {
  const handleJoinSlash = async (interaction) => {
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: '❌ Kamu harus berada di dalam Voice Channel terlebih dahulu agar bot bisa bergabung!', ephemeral: true });
      return;
    }
    try {
      ctx.voiceService.join(voiceChannel);
      await interaction.reply(`🔊 Berhasil bergabung ke Voice Channel **${voiceChannel.name}**!\n> 💡 *Notifikasi tugas selesai, peringatan sistem, dan dev server akan diumumkan lewat suara.*`);
      ctx.voiceService.speak(interaction.guildId, `Halo ${member.displayName || 'Willy'}! Aku sudah bergabung di voice channel ya. Nanti kalau ada tugas coding yang selesai atau server error, langsung aku kabarin lewat sini!`);
    } catch (err) {
      await interaction.reply({ content: `❌ Gagal bergabung ke Voice Channel: ${err.message}`, ephemeral: true });
    }
  };

  const handleLeaveSlash = async (interaction) => {
    const success = ctx.voiceService.leave(interaction.guildId);
    if (success) {
      await interaction.reply('👋 Berhasil keluar dari Voice Channel.');
    } else {
      await interaction.reply({ content: 'ℹ️ Bot sedang tidak berada di Voice Channel mana pun pada server ini.', ephemeral: true });
    }
  };

  const handleJoinPrefix = async (message) => {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply('❌ Kamu harus berada di dalam Voice Channel terlebih dahulu!');
      return;
    }
    try {
      ctx.voiceService.join(voiceChannel);
      await message.reply(`🔊 Bot bergabung ke Voice Channel **${voiceChannel.name}**!`);
      ctx.voiceService.speak(message.guildId, 'Halo, saya sudah bergabung di voice channel.');
    } catch (e) {
      await message.reply(`❌ Gagal: ${e.message}`);
    }
  };

  return {
    slashBuilders: [
      new SlashCommandBuilder()
        .setName('join')
        .setDescription('Perintahkan bot untuk bergabung ke Voice Channel tempat kamu berada'),
      new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Keluarkan bot dari Voice Channel'),
      new SlashCommandBuilder()
        .setName('say')
        .setDescription('Ucapkan pesan suara TTS di Voice Channel')
        .addStringOption(opt => opt.setName('text').setDescription('Teks yang ingin diucapkan bot').setRequired(true))
    ],

    slash: {
      join: handleJoinSlash,
      'join-vc': handleJoinSlash,
      leave: handleLeaveSlash,
      'leave-vc': handleLeaveSlash,
      say: async (interaction) => {
        const text = interaction.options.getString('text');
        if (!ctx.voiceService.isConnected(interaction.guildId)) {
          await interaction.reply({ content: '⚠️ Bot belum bergabung di Voice Channel. Gunakan `/join` terlebih dahulu!', ephemeral: true });
          return;
        }
        ctx.voiceService.speak(interaction.guildId, text);
        await interaction.reply(`🗣️ Mengucapkan: *"${text}"* di Voice Channel.`);
      }
    },

    prefix: {
      join: handleJoinPrefix,
      vc: handleJoinPrefix,
      leave: async (message) => {
        const ok = ctx.voiceService.leave(message.guildId);
        await message.reply(ok ? '👋 Keluar dari Voice Channel.' : 'ℹ️ Bot tidak berada di Voice Channel.');
      },
      say: async (message, args) => {
        const text = args.join(' ').trim();
        if (!text) {
          await message.reply('Contoh: `!say Halo semuanya`');
          return;
        }
        if (!ctx.voiceService.isConnected(message.guildId)) {
          await message.reply('⚠️ Bot belum join Voice Channel. Ketik `!join` dulu!');
          return;
        }
        ctx.voiceService.speak(message.guildId, text);
        await message.reply(`🗣️ Mengucapkan: *"${text}"* di Voice Channel.`);
      }
    }
  };
};
