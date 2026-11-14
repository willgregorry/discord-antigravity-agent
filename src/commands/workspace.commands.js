const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

/**
 * Manages per-channel workspace state: working directory, model selection,
 * conversation reset, task cancellation, and persistent project notes.
 */
module.exports = function createWorkspaceCommands(ctx) {
  return {
    slashBuilders: [
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
        .setDescription('Pilih atau set model Antigravity (Gemini, Claude, Argon, dll)')
        .addStringOption(opt => opt.setName('name').setDescription('Nama model (opsional jika ingin ketik manual, misal: argon)')),
      new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Mulai sesi percakapan baru di channel ini'),
      new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Batalkan proses Antigravity yang sedang berjalan di channel ini'),
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
        .addStringOption(opt => opt.setName('text').setDescription('Isi catatan yang ingin ditambahkan (jika pilih add)').setRequired(false))
    ],

    slash: {
      pwd: async (interaction, session) => {
        const isRunning = session.activeProcess ? '⚡ Sedang Berjalan (Active Task)' : '💤 Idle (Siap menerima prompt)';
        const activeTunnel = ctx.tunnelService.getTunnel(interaction.channelId);
        const isWatching = ctx.watchdogService.isWatching(interaction.channelId);
        const notes = ctx.notesService.getNotes(interaction.channelId);

        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('📍 Status Workspace Channel')
          .addFields(
            { name: '📁 Working Directory', value: `\`\`\`${session.cwd}\`\`\`` },
            { name: '🧠 Antigravity Model', value: `\`\`\`${session.model}\`\`\`` },
            { name: '🔄 Status Antigravity', value: isRunning },
            { name: '🌐 Web Preview', value: activeTunnel ? `🔗 [${activeTunnel.url}](${activeTunnel.url}) (Port ${activeTunnel.port})` : '*(Tidak aktif)*' },
            { name: '🛡️ Server Watchdog', value: isWatching ? `Active: \`${ctx.watchdogService.getServerInfo(interaction.channelId).command}\`` : '*(Tidak aktif)*' },
            { name: '📝 Scratchpad Notes', value: notes ? `\`\`\`\n${notes.slice(0, 200)}\`\`\`` : '*(Kosong)*' },
            { name: '💬 Conversation ID', value: session.conversationId ? `\`\`\`${session.conversationId}\`\`\`` : '*(Baru / Belum ada riwayat)*' }
          )
          .setFooter({ text: 'Beda channel = beda working directory. Kamu bisa prompt di banyak channel sekaligus!' });

        await interaction.reply({ embeds: [embed] });
      },

      cd: async (interaction, session) => {
        const targetPath = interaction.options.getString('path');
        try {
          const newDir = session.setCwd(targetPath);
          ctx.sessionManager.saveSessions();
          await interaction.reply(`✅ Working directory channel ini berhasil diubah ke:\n📁 \`\`\`${newDir}\`\`\``);
        } catch (err) {
          await interaction.reply(`❌ Gagal pindah folder: ${err.message}`);
        }
      },

      projects: async (interaction, session) => {
        const favorites = ctx.config.favorite_projects || [];
        if (favorites.length === 0) {
          await interaction.reply({ content: 'ℹ️ Belum ada `favorite_projects` yang dikonfigurasi di `config.json`.', ephemeral: true });
          return;
        }
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_project')
            .setPlaceholder('Pilih Project Workspace...')
            .addOptions(favorites.map(p => ({ label: p.name, description: p.path.slice(-50), value: p.path })))
        );
        await interaction.reply({
          content: `📁 **Pilih folder kerja untuk channel ini:**\nSaat ini: \`\`\`${session.cwd}\`\`\``,
          components: [row]
        });
      },

      model: async (interaction, session) => {
        const customModel = interaction.options.getString('name');
        if (customModel && customModel.trim()) {
          session.model = customModel.trim();
          ctx.sessionManager.saveSessions();
          await interaction.reply(`🧠 **Model channel ini diubah menjadi:** \`${session.model}\``);
          return;
        }

        await interaction.deferReply();
        const availableModels = await ctx.getAvailableModels();
        const options = availableModels.map(m => ({
          label: m.label.slice(0, 100),
          value: m.value.slice(0, 100),
          default: m.value === session.model
        }));

        if (!options.some(o => o.value === session.model)) {
          options.unshift({
            label: `Kustom: ${session.model}`.slice(0, 100),
            value: session.model.slice(0, 100),
            default: true
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_model')
            .setPlaceholder('Pilih Model Antigravity...')
            .addOptions(options)
        );

        await interaction.editReply({
          content: `🧠 **Pilih model Antigravity untuk channel ini:**\nModel aktif: \`\`\`${session.model}\`\`\`\n> 💡 *Daftar model disinkronkan langsung dari akun aktif kamu di CLI.*\n> *Ketik \`/model name:<nama_model>\` untuk memasukkan model kustom/khusus secara manual.*`,
          components: [row]
        });
      },

      clear: async (interaction, session) => {
        session.conversationId = null;
        ctx.sessionManager.saveSessions();
        await interaction.reply('🧹 Sesi percakapan di channel ini telah di-reset (konteks baru dimulai)!');
      },

      stop: async (interaction, session) => {
        if (session.activeProcess || session.typingInterval) {
          session.stopActiveProcess();
          await interaction.reply('🛑 Proses Antigravity di channel ini telah dihentikan total.');
        } else {
          await interaction.reply('ℹ️ Tidak ada proses yang sedang berjalan di channel ini.');
        }
      },

      notes: async (interaction) => {
        const action = interaction.options.getString('action') || 'view';
        const text = interaction.options.getString('text');

        if (action === 'add') {
          if (!text) {
            await interaction.reply({ content: '❌ Mohon sertakan parameter `text` untuk catatan yang ingin ditambahkan.', ephemeral: true });
            return;
          }
          const updated = ctx.notesService.appendNote(interaction.channelId, text);
          await interaction.reply(`✅ Catatan berhasil ditambahkan!\n📝 **Catatan Channel Saat Ini:**\n\`\`\`\n${updated}\n\`\`\`\n> 💡 *Catatan ini otomatis dibaca oleh Antigravity setiap kali kamu prompt di channel ini!*`);
        } else if (action === 'clear') {
          ctx.notesService.clearNotes(interaction.channelId);
          await interaction.reply('🧹 Catatan scratchpad untuk channel ini telah dibersihkan.');
        } else {
          const current = ctx.notesService.getNotes(interaction.channelId);
          const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('📝 Project Scratchpad & Notes')
            .setDescription(current ? `\`\`\`\n${current}\n\`\`\`` : '*(Belum ada catatan untuk channel ini)*\n\nGunakan `/notes action:Tambah Catatan text:...` untuk menambah catatan baru.')
            .setFooter({ text: 'Konteks scratchpad otomatis diikutsertakan dalam prompt Antigravity AI!' });
          await interaction.reply({ embeds: [embed] });
        }
      }
    },

    prefix: {
      pwd: async (message, _args, session) => {
        await message.reply(`📁 CWD: \`\`\`${session.cwd}\`\`\` | 🧠 Model: \`\`\`${session.model}\`\`\``);
      },
      cd: async (message, args, session) => {
        const target = args.join(' ');
        if (!target) {
          await message.reply('Contoh: `!cd ./projects/my-app` atau `!cd C:\\Projects`');
          return;
        }
        try {
          const newDir = session.setCwd(target);
          ctx.sessionManager.saveSessions();
          await message.reply(`✅ CWD diubah ke: \`\`\`${newDir}\`\`\``);
        } catch (err) {
          await message.reply(`❌ Gagal: ${err.message}`);
        }
      },
      model: async (message, args, session) => {
        const targetModel = args.join(' ').trim();
        if (targetModel) {
          session.model = targetModel;
          ctx.sessionManager.saveSessions();
          await message.reply(`🧠 Model Antigravity channel ini diganti ke:\n\`\`\`${targetModel}\`\`\``);
        } else {
          const available = await ctx.getAvailableModels();
          const listStr = available.map(m => `• \`${m.value}\` — **${m.label}**`).join('\n');
          await message.reply(`🧠 **Model Aktif Saat Ini:** \`${session.model}\`\n\n**Daftar Model Tersedia:**\n${listStr}\n\n> *Ganti model: \`!model <nama_model>\` (contoh: \`!model argon\` atau \`!model gemini-3.8-flash-high\`)*`);
        }
      },
      stop: async (message, _args, session) => {
        if (session.activeProcess || session.typingInterval) {
          session.stopActiveProcess();
          await message.reply('🛑 Proses dihentikan total.');
        } else {
          await message.reply('ℹ️ Tidak ada proses aktif.');
        }
      },
      clear: async (message, _args, session) => {
        session.conversationId = null;
        ctx.sessionManager.saveSessions();
        await message.reply('🧹 Riwayat di-reset.');
      }
    },

    selects: {
      select_project: async (interaction, session) => {
        const chosenPath = interaction.values[0];
        try {
          const newDir = session.setCwd(chosenPath);
          ctx.sessionManager.saveSessions();
          await interaction.update({ content: `✅ Workspace channel ini dialihkan ke:\n📁 \`\`\`${newDir}\`\`\``, components: [] });
        } catch (err) {
          await interaction.update({ content: `❌ Gagal membuka folder: ${err.message}`, components: [] });
        }
      },
      select_model: async (interaction, session) => {
        const chosenModel = interaction.values[0];
        session.model = chosenModel;
        ctx.sessionManager.saveSessions();
        await interaction.update({ content: `🧠 Model Antigravity channel ini diganti ke:\n\`\`\`${chosenModel}\`\`\``, components: [] });
      }
    }
  };
};
