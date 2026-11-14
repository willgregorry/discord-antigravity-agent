const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const HELP_CATEGORIES = {
  help_overview: {
    color: 0x5865f2,
    title: '🛠️ Panduan Antigravity Discord Agent',
    description: '**Asisten AI Coding & Remote Laptop Control dari Discord HP**\n\nPilih kategori di dropdown menu di bawah untuk melihat rincian perintah:',
    fields: [
      { name: '🤖 AI Coding & Workspace', value: 'Prompt LLM, `/account`, `/usage`, `/projects`, `/cd`, `/pwd`, `/model`, `/clear`, `/stop`' },
      { name: '🌳 File & Directory Tree', value: '`/tree` (visual struktur folder), `/browse`, `/send`, kirim file otomatis' },
      { name: '🎙️ Voice Assistant & TTS', value: '`/join`, `/leave`, `/say`, notifikasi suara hands-free tugas & server' },
      { name: '🌐 Web Preview & Watchdog', value: '`/preview`, `/stop-preview`, `/watch-server`, 1-Click AI Fix crash' },
      { name: '💻 Terminal & Git Manager', value: '`/exec`, `/git` (Status, Diff, Commit modal, Push, Pull)' },
      { name: '🔋 Remote Laptop & Notes', value: '`/status`, `/screen`, `/lock`, `/screen-off`, `/sleep`, `/shutdown`, `/notes`' }
    ],
    footer: '💡 Tips: Ketik langsung di chat tanpa slash untuk coding dengan AI!'
  },
  help_ai: {
    color: 0x3498db,
    title: '🤖 Panduan: Antigravity AI Coding & Workspace',
    description: '> Ngoding full-stack langsung dari chat Discord dengan LLM terbaik.',
    fields: [
      { name: '💬 Cara Chat AI', value: '• Kirim chat biasa (tanpa prefix) untuk prompt AI coding.\n• Minta kirim file: *"kirimkan file X ke discord"*.\n• AI otomatis mengeksekusi tools, terminal, dan membaca kode.' },
      { name: '⚡ Perintah Workspace & Model', value: '• `/usage` — Cek sisa kuota Gemini & reset time realtime\n• `/projects` — Menu dropdown daftar folder favorit project\n• `/cd <path>` — Pindah folder kerja aktif channel ini\n• `/pwd` — Cek direktori aktif dan model yang digunakan\n• `/model` — Ganti model LLM (Gemini 3.8 Flash, Claude Sonnet 4.6, dll)\n• `/account` — Kelola & ganti multi-akun Gemini Pro instan dari HP\n• `/clear` — Reset riwayat obrolan / mulai sesi baru\n• `/stop` — Hentikan proses AI yang sedang berjalan' }
    ]
  },
  help_files: {
    color: 0x2ecc71,
    title: '🌳 Panduan: File Manager & Directory Tree',
    description: '> Pantau dan kelola seluruh file project di laptop secara visual dari HP.',
    fields: [
      { name: '🌳 /tree [depth] [path]', value: '• Tampilkan visualisasi hierarki folder & file project.\n• Otomatis menyembunyikan `node_modules`, `.git`, `bin`, `.next`, `dist`, dll.\n• Parameter `depth` (1-6, default: 3) & `path` (sub-folder opsional).\n• Jika struktur panjang (>1800 char), otomatis dikirim sebagai file lampiran `project-tree.txt`!' },
      { name: '📂 /browse [path]', value: '• File explorer interaktif dengan dropdown.\n• Masuk ke subfolder atau unduh langsung file project ke HP kamu.' },
      { name: '📤 /send <path>', value: '• Kirim file spesifik dari laptop kamu ke Discord.\n• Contoh: `/send src/bot.js` atau `/send README.md`' },
      { name: '📎 Auto Attachment AI', value: '• Jika kamu meminta AI mengirimkan file yang diedit/dibuat, bot otomatis mengunggah file tersebut ke chat.' }
    ]
  },
  help_voice: {
    color: 0x9b59b6,
    title: '🎙️ Panduan: Voice Channel Assistant & TTS',
    description: '> Asisten suara natural berbasis Microsoft Edge TTS bahasa Indonesia.',
    fields: [
      { name: '🔊 Perintah Voice Channel', value: '• `/join` atau `/join-vc` — Bot bergabung ke Voice Channel kamu\n• `/leave` atau `/leave-vc` — Bot keluar dari Voice Channel\n• `/say <text>` — Ucapkan pesan suara TTS natural di Voice Channel' },
      { name: '📢 Fitur Hands-Free Otomatis', value: '• **Task Done Notification**: Saat tugas coding AI selesai, bot otomatis mengabarkan lewat suara di VC!\n• **Crash Alert**: Jika server dev crash, bot langsung memberi peringatan suara.\n• **Low Battery Alert**: Peringatan jika baterai laptop menipis.' }
    ]
  },
  help_web: {
    color: 0xe67e22,
    title: '🌐 Panduan: Web Preview & Server Watchdog',
    description: '> Akses website lokal dari HP & otomatis pantau dev server.',
    fields: [
      { name: '🌐 Web Preview Live (Auto-Tunnel)', value: '• `/preview <port>` — Buka URL publik HTTPS instan via Cloudflare Tunnel (contoh: `/preview 3000`)\n• `/stop-preview` — Tutup tunnel aktif di channel ini' },
      { name: '🛡️ Server Crash Watchdog', value: '• `/watch-server <command>` — Jalankan dev server (npm run dev, python app.py) dengan pemantau crash realtime\n• **1-Click AI Fix**: Saat crash terdeteksi, bot mengirim error log dan tombol perbaikan otomatis satu klik!\n• `/stop-server` — Matikan dev server yang sedang dipantau' }
    ]
  },
  help_terminal: {
    color: 0x1abc9c,
    title: '💻 Panduan: Terminal PowerShell & Git Manager',
    description: '> Akses terminal cepat dan manajemen Git tanpa perlu buka laptop.',
    fields: [
      { name: '💻 Terminal Exec', value: '• `/exec <command>` — Jalankan perintah PowerShell cepat di direktori project (contoh: `/exec git status`, `/exec npm test`)\n• Jika output terminal panjang, otomatis dikirim sebagai file text.' },
      { name: '🐙 Interactive Git Manager', value: '• `/git` — Tampilkan menu tombol Git lengkap:\n  - 📊 **Status**: Cek file modified, staged, untracked\n  - 🔍 **Diff**: Tinjau perubahan kode (file patch jika panjang)\n  - 💾 **Commit**: Form modal popup untuk menulis commit message\n  - 🚀 **Push**: Push commit ke remote GitHub/GitLab\n  - 📥 **Pull**: Tarik update terbaru dari repository remote' }
    ]
  },
  help_system: {
    color: 0xe74c3c,
    title: '🔋 Panduan: Remote Laptop Control & Notes',
    description: '> Kontrol workstation laptop dan simpan memori penting.',
    fields: [
      { name: '📊 Monitor & Hardware', value: '• `/status` — Cek beban CPU, RAM, disk, sisa baterai, dan uptime laptop\n• `/screen` atau `/screenshot` — Ambil live screenshot monitor laptop' },
      { name: '🔒 Remote Power & Display', value: '• `/lock` — Kunci workstation Windows (Lock Screen)\n• `/screen-off` — Matikan monitor laptop untuk hemat daya\n• `/sleep` — Masukkan laptop ke Sleep mode\n• `/shutdown` — Matikan laptop secara remote (dengan dialog konfirmasi)' },
      { name: '📝 Project Notes / Scratchpad', value: '• `/notes` — Lihat catatan channel ini\n• `/notes action:add text:...` — Tambah catatan penting\n• *Catatan scratchpad otomatis diikutsertakan sebagai memori AI!*' }
    ]
  }
};

/**
 * Builds the categorized `/help` embed and navigation dropdown.
 */
function buildHelpPayload(category = 'help_overview') {
  const select = new StringSelectMenuBuilder()
    .setCustomId('help_category_select')
    .setPlaceholder('📂 Pilih Kategori Panduan...')
    .addOptions([
      { label: 'Ringkasan Semua Fitur', value: 'help_overview', emoji: '🏠', description: 'Lihat gambaran umum seluruh fitur bot' },
      { label: 'AI Coding & Workspace', value: 'help_ai', emoji: '🤖', description: 'Prompt AI, kuota, model, dan sesi coding' },
      { label: 'File & Directory Tree', value: 'help_files', emoji: '🌳', description: 'Lihat struktur folder, browse, & kirim file' },
      { label: 'Voice Assistant & TTS', value: 'help_voice', emoji: '🎙️', description: 'Voice channel, TTS suara, & notifikasi hands-free' },
      { label: 'Web Preview & Watchdog', value: 'help_web', emoji: '🌐', description: 'Cloudflare tunnel preview & 1-click AI fix crash' },
      { label: 'Terminal & Git Manager', value: 'help_terminal', emoji: '💻', description: 'PowerShell exec, diff, commit, push, & pull' },
      { label: 'Remote Laptop Control', value: 'help_system', emoji: '🔋', description: 'Status hardware, screenshot, sleep, & notes' }
    ]);

  const spec = HELP_CATEGORIES[category] || HELP_CATEGORIES.help_overview;
  const embed = new EmbedBuilder()
    .setTimestamp()
    .setColor(spec.color)
    .setTitle(spec.title)
    .setDescription(spec.description)
    .addFields(spec.fields)
    .setFooter({ text: spec.footer || 'Gunakan dropdown di bawah untuk beralih kategori' });

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

/**
 * Shared update flow used by `/update`, `!update`, and the `btn_pull_update` button.
 */
async function performSelfUpdate(ctx, replyEdit) {
  const check = await ctx.updateService.checkUpdate();
  if (!check.hasUpdate) {
    await replyEdit(`✅ **Bot sudah menggunakan versi terbaru!**\n> 🔖 Build: \`${check.local.sha}\` (v${check.local.version})\n> 📝 *${check.local.message}*`);
    return;
  }

  await replyEdit(`📥 **Mengunduh pembaruan dari GitHub...**\n> 🔖 Commit: \`${check.remote.sha}\` — *${check.remote.message}* oleh **${check.remote.author}**`);
  const res = await ctx.updateService.executePullAndUpdate();
  if (!res.success) {
    await replyEdit(`❌ **Gagal memperbarui:**\n\`\`\`text\n${res.error}\n\`\`\``);
    return;
  }

  await replyEdit(
    `🎉 **Pembaruan Berhasil Diunduh!**\n` +
    `\`\`\`text\n${res.pullOutput}\n\`\`\`\n` +
    `> 🔄 Bot akan otomatis me-restart dalam 3 detik untuk menerapkan versi terbaru.`
  );
  ctx.updateService.triggerDelayedRestart(3);
}

/**
 * Handles bot documentation (`/help`) and GitHub self-update lifecycle (`/update`, `/broadcast-update`).
 */
module.exports = function createMetaCommands(ctx) {
  return {
    slashBuilders: [
      new SlashCommandBuilder()
        .setName('help')
        .setDescription('Panduan lengkap semua fitur & perintah Antigravity Discord Agent'),
      new SlashCommandBuilder()
        .setName('update')
        .setDescription('Periksa dan unduh pembaruan terbaru dari GitHub (git pull & auto-restart)'),
      new SlashCommandBuilder()
        .setName('broadcast-update')
        .setDescription('Siarkan kartu pengumuman update terbaru dengan tombol 1-Click Pull ke channel announcement')
    ],

    slash: {
      help: async (interaction) => interaction.reply(buildHelpPayload('help_overview')),

      update: async (interaction) => {
        await interaction.deferReply();
        try {
          await performSelfUpdate(ctx, text => interaction.editReply(text));
        } catch (err) {
          await interaction.editReply(`❌ Error memeriksa update: ${err.message}`);
        }
      },

      'broadcast-update': async (interaction) => {
        await interaction.deferReply({ ephemeral: true });
        try {
          const sent = await ctx.updateService.broadcastUpdateIfAvailable(ctx.client, true);
          await interaction.editReply(
            sent
              ? '📢 **Berhasil menyiarkan pengumuman update ke channel announcement!**'
              : 'ℹ️ Tidak dapat menyiarkan update (pastikan koneksi GitHub normal).'
          );
        } catch (err) {
          await interaction.editReply(`❌ Gagal: ${err.message}`);
        }
      }
    },

    prefix: {
      help: async (message) => message.reply(buildHelpPayload('help_overview')),
      update: async (message) => {
        const statusMsg = await message.reply('🔍 Memeriksa pembaruan di GitHub...');
        try {
          await performSelfUpdate(ctx, text => statusMsg.edit(text));
        } catch (err) {
          await statusMsg.edit(`❌ Error update: ${err.message}`);
        }
      },
      'broadcast-update': async (message) => {
        try {
          const sent = await ctx.updateService.broadcastUpdateIfAvailable(ctx.client, true);
          await message.reply(
            sent ? '📢 **Pengumuman update berhasil disiarkan ke channel announcement!**' : 'ℹ️ Tidak dapat menyiarkan update.'
          );
        } catch (err) {
          await message.reply(`❌ Gagal: ${err.message}`);
        }
      }
    },

    buttons: [
      {
        match: 'btn_pull_update',
        handle: async (interaction) => {
          await interaction.deferReply();
          try {
            await interaction.editReply('📥 **Sedang melakukan `git pull origin main` dan menyiapkan update...**');
            const res = await ctx.updateService.executePullAndUpdate();
            if (!res.success) {
              await interaction.editReply(`❌ **Gagal memperbarui bot:**\n\`\`\`text\n${res.error}\n\`\`\``);
              return;
            }
            await interaction.editReply(
              `🎉 **Pembaruan Berhasil Diunduh!**\n` +
              `\`\`\`text\n${res.pullOutput}\n\`\`\`\n` +
              `> 🔄 Bot sedang melakukan auto-restart di laptop Anda sekarang. Tunggu 5-10 detik.`
            );
            ctx.updateService.triggerDelayedRestart(3);
          } catch (err) {
            await interaction.editReply(`❌ Error update: ${err.message}`);
          }
        }
      }
    ],

    selects: {
      help_category_select: async (interaction) => {
        await interaction.update(buildHelpPayload(interaction.values[0]));
      }
    }
  };
};
