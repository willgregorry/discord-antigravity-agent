const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require('discord.js');
const { TreeService } = require('../services/tree-service');
const {
  createTempFile,
  validateAttachableFile,
  DISCORD_MAX_FILE_BYTES
} = require('../utils/file-helper');

/**
 * Builds the interactive directory browser embed and folder/file dropdown menu.
 */
async function buildBrowseComponents(targetDir) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Directory tidak ditemukan: ${targetDir}`);
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const folders = [];
  const files = [];

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) folders.push(ent.name);
    else files.push(ent.name);
  }

  folders.sort();
  files.sort();

  const options = [];
  const parentDir = path.dirname(targetDir);
  if (parentDir && parentDir !== targetDir) {
    options.push({
      label: '.. (Kembali ke folder atas)',
      description: parentDir.slice(-50),
      value: `dir:${parentDir}`,
      emoji: '⬆️'
    });
  }

  for (const f of folders) {
    if (options.length >= 24) break;
    options.push({
      label: f.slice(0, 50),
      description: 'Folder',
      value: `dir:${path.join(targetDir, f)}`,
      emoji: '📁'
    });
  }

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

/**
 * Generates a formatted directory tree response, spilling over to a `.txt` attachment when large.
 */
function buildTreeReplyPayload(targetDir, depth, channelName, rootDir) {
  const result = TreeService.generateTree(targetDir, depth);
  const header = `🌳 **Struktur Project:** \`${path.basename(targetDir) || targetDir}\`\n📁 \`${targetDir}\` *(Depth: ${depth})*\n📊 Total: **${result.stats.totalDirs}** Folder, **${result.stats.totalFiles}** File\n`;

  if (result.treeString.length <= 1800) {
    return `${header}\`\`\`text\n${result.treeString}\n\`\`\``;
  }

  const tempFile = createTempFile(rootDir, channelName || 'tree', 'project-tree', 'txt', result.treeString);
  const previewSnippet = result.treeString.split('\n').slice(0, 30).join('\n');
  const remainingLines = result.treeString.split('\n').length - 30;
  return {
    content: `${header}\`\`\`text\n${previewSnippet}\n... (tersisa ${remainingLines} baris lagi)\n\`\`\`\n📄 *Struktur lengkap dilampirkan sebagai file di bawah:*`,
    files: [new AttachmentBuilder(tempFile, { name: 'project-tree.txt' })]
  };
}

/**
 * Handles file inspection, directory tree generation, and local file uploads to Discord.
 */
module.exports = function createFilesCommands(ctx) {
  return {
    slashBuilders: [
      new SlashCommandBuilder()
        .setName('send')
        .setDescription('Kirim file dari laptop kamu ke channel Discord ini')
        .addStringOption(opt => opt.setName('path').setDescription('Path file di laptop (contoh: ./README.md atau ./src/index.js)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('browse')
        .setDescription('File explorer interaktif untuk melihat dan mengunduh file project')
        .addStringOption(opt => opt.setName('path').setDescription('Sub-folder yang ingin dibuka (opsional)').setRequired(false)),
      new SlashCommandBuilder()
        .setName('tree')
        .setDescription('Lihat struktur direktori lengkap project aktif saat ini')
        .addIntegerOption(opt => opt.setName('depth').setDescription('Kedalaman folder (default: 3, maks: 6)').setRequired(false))
        .addStringOption(opt => opt.setName('path').setDescription('Sub-folder spesifik yang ingin di-inspect (opsional)').setRequired(false))
    ],

    slash: {
      send: async (interaction, session) => {
        const check = validateAttachableFile(interaction.options.getString('path'), session.cwd);
        if (!check.ok) {
          await interaction.reply({ content: `❌ ${check.error}`, ephemeral: true });
          return;
        }
        await interaction.deferReply();
        const sizeStr = check.stats.size > 1024 * 1024
          ? `${(check.stats.size / (1024 * 1024)).toFixed(2)} MB`
          : `${(check.stats.size / 1024).toFixed(1)} KB`;
        await interaction.editReply({
          content: `📤 **File dari laptop:** \`${path.basename(check.resolved)}\` (${sizeStr})\n📁 \`${check.resolved}\``,
          files: [check.attachment]
        });
      },

      browse: async (interaction, session) => {
        const subPath = interaction.options.getString('path') || '';
        const targetDir = subPath ? path.resolve(session.cwd, subPath) : session.cwd;
        session.currentBrowsePath = targetDir;
        await interaction.deferReply();
        try {
          const { embed, components } = await buildBrowseComponents(targetDir);
          await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
          await interaction.editReply(`❌ Gagal menjelajahi direktori: ${err.message}`);
        }
      },

      tree: async (interaction, session) => {
        const subPath = interaction.options.getString('path');
        const depth = Math.min(Math.max(interaction.options.getInteger('depth') || 3, 1), 6);
        const targetDir = subPath ? path.resolve(session.cwd, subPath) : session.cwd;

        if (!fs.existsSync(targetDir)) {
          await interaction.reply({ content: `❌ Direktori tidak ditemukan: \`${targetDir}\``, ephemeral: true });
          return;
        }

        await interaction.deferReply();
        try {
          const payload = buildTreeReplyPayload(targetDir, depth, interaction.channel?.name, ctx.rootDir);
          await interaction.editReply(payload);
        } catch (err) {
          await interaction.editReply(`❌ Gagal menghasilkan struktur direktori: ${err.message}`);
        }
      }
    },

    prefix: {
      send: async (message, args, session) => {
        const target = args.join(' ').trim();
        if (!target) {
          await message.reply('Contoh: `!send README.md`');
          return;
        }
        const check = validateAttachableFile(target, session.cwd);
        if (!check.ok) {
          await message.reply(`❌ ${check.error}`);
          return;
        }
        await message.reply({ files: [check.attachment] });
      },

      tree: async (message, args, session) => {
        const depthArg = args.find(a => /^\d+$/.test(a));
        const depth = depthArg ? Math.min(Math.max(parseInt(depthArg, 10), 1), 6) : 3;
        const pathArg = args.filter(a => a !== depthArg).join(' ');
        const targetDir = pathArg ? path.resolve(session.cwd, pathArg) : session.cwd;

        if (!fs.existsSync(targetDir)) {
          await message.reply(`❌ Direktori tidak ditemukan: \`${targetDir}\``);
          return;
        }

        try {
          const payload = buildTreeReplyPayload(targetDir, depth, message.channel?.name, ctx.rootDir);
          await message.reply(payload);
        } catch (err) {
          await message.reply(`❌ Gagal: ${err.message}`);
        }
      }
    },

    selects: {
      select_browse_item: async (interaction, session) => {
        const val = interaction.values[0];
        if (val.startsWith('dir:')) {
          const targetDir = val.replace('dir:', '');
          session.currentBrowsePath = targetDir;
          await interaction.deferUpdate();
          try {
            const { embed, components } = await buildBrowseComponents(targetDir);
            await interaction.editReply({ embeds: [embed], components });
          } catch (e) {
            await interaction.followUp({ content: `❌ Gagal membuka folder: ${e.message}`, ephemeral: true });
          }
        } else if (val.startsWith('file:')) {
          const targetFile = val.replace('file:', '');
          await interaction.deferReply();
          try {
            const stats = fs.statSync(targetFile);
            if (stats.size > DISCORD_MAX_FILE_BYTES) {
              await interaction.editReply(`❌ Ukuran file melebihi batas 24MB Discord (${(stats.size / (1024 * 1024)).toFixed(1)} MB).`);
              return;
            }

            const ext = path.extname(targetFile).toLowerCase();
            const textExts = ['.js', '.json', '.md', '.txt', '.html', '.css', '.py', '.ts', '.yml', '.yaml', '.sh', '.bat', '.ps1'];
            let preview = '';
            if (textExts.includes(ext) && stats.size < 50 * 1024) {
              const raw = fs.readFileSync(targetFile, 'utf8');
              preview = `\`\`\`${ext.replace('.', '')}\n${raw.slice(0, 1500)}\n\`\`\`\n`;
            }

            await interaction.editReply({
              content: `📄 **File:** \`${path.basename(targetFile)}\`\n${preview}⬇️ Unduh file ke HP:`,
              files: [new AttachmentBuilder(targetFile)]
            });
          } catch (e) {
            await interaction.editReply(`❌ Gagal membaca file: ${e.message}`);
          }
        }
      }
    }
  };
};
