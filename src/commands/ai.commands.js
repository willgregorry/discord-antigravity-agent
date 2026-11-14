const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

/**
 * Builds the `/usage` embed and refresh/account action buttons.
 */
function buildUsagePayload(quotaData, ctx) {
  const accData = ctx.accountService.getAccounts();
  const liveEmail = accData.liveToken?.email;
  const activeAcc = accData.accounts.find(a => a.id === accData.activeAccountId);
  const accountEmail = liveEmail || activeAcc?.email || 'Active CLI Account';
  const matchedAcc = accData.accounts.find(a => (a.email || '').toLowerCase() === accountEmail.toLowerCase()) || activeAcc;
  const activeLabel = matchedAcc ? matchedAcc.label : 'Default Profile';

  const cliScreen = ctx.quotaService.formatCliUsageScreen(quotaData, accountEmail);
  const embed = new EmbedBuilder()
    .setColor(0x00D26A)
    .setTitle('⚡ Antigravity CLI — Models & Quota')
    .setDescription(cliScreen)
    .setFooter({
      text: `Profil: ${activeLabel} • Sumber: ${quotaData?.source === 'cli' ? 'Direct agy CLI' : 'Language Server'} • ${new Date().toLocaleTimeString('id-ID')}`
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_usage_refresh').setLabel('🔄 Refresh Quota').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('btn_usage_switch_acc').setLabel('👤 Kelola Akun').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Builds the `/account` multi-account manager embed, dropdown switcher, and action buttons.
 */
function buildAccountsPayload(ctx) {
  const data = ctx.accountService.getAccounts();
  const embed = new EmbedBuilder()
    .setColor(0x4285F4)
    .setTitle('👑 Multi-Account Gemini Pro Manager')
    .setDescription('Kelola dan alihkan akun Google Gemini Pro kamu langsung dari HP tanpa repot buka laptop!')
    .setTimestamp();

  let activeAccount = null;
  if (data.liveToken?.email) {
    activeAccount = data.accounts.find(a => (a.email || '').toLowerCase() === data.liveToken.email.toLowerCase());
  }
  if (!activeAccount && data.activeAccountId) {
    activeAccount = data.accounts.find(a => a.id === data.activeAccountId);
  }

  const currentEmail = data.liveToken?.maskedEmail || '(Belum terdeteksi)';
  const activeLabel = activeAccount
    ? activeAccount.label
    : (data.liveToken?.email ? 'Akun Baru (Belum Disimpan)' : 'Akun Aktif di Laptop');

  embed.addFields({
    name: '🟢 Akun yang Sedang Digunakan Saat Ini',
    value: `• **Label:** \`${activeLabel}\`\n• **Email:** \`${currentEmail}\`\n• **Status:** \`Siap Koding (Active)\``,
    inline: false
  });

  const activeId = activeAccount ? activeAccount.id : data.activeAccountId;

  if (data.accounts.length === 0) {
    embed.addFields({
      name: '📋 Daftar Profil Tersimpan',
      value: '*(Belum ada profil akun yang disimpan)*\n\nKlik tombol **💾 Simpan Akun Sekarang** di bawah untuk menyimpan akun aktif di laptopmu sebagai profil pertama!',
      inline: false
    });
  } else {
    const listText = data.accounts.map((acc, idx) => {
      const badge = acc.id === activeId ? '🟢 **[AKTIF]**' : '⚪';
      return `${idx + 1}. ${badge} **${acc.label}** (\`${acc.maskedEmail}\`)`;
    }).join('\n');

    embed.addFields({ name: `📋 Daftar Profil Akun (${data.accounts.length})`, value: listText, inline: false });
  }

  embed.setFooter({ text: 'Konteks chat koding AI TIDAK akan hilang saat beralih akun!' });

  const components = [];
  if (data.accounts.length > 0) {
    const selectOptions = data.accounts.map(acc => ({
      label: acc.label.slice(0, 50),
      value: acc.id,
      description: acc.maskedEmail,
      emoji: acc.id === activeId ? '🟢' : '👤',
      default: acc.id === activeId
    }));
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_switch_account')
          .setPlaceholder('🔄 Pilih Akun untuk Diaktifkan Sekarang...')
          .addOptions(selectOptions)
      )
    );
  }

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_save_current_acc').setLabel('💾 Simpan Akun Sekarang').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn_add_token_manual').setLabel('➕ Input Token Manual').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_acc_guide').setLabel('📖 Panduan Login').setStyle(ButtonStyle.Secondary)
  );
  if (data.accounts.length > 0) {
    btnRow.addComponents(
      new ButtonBuilder().setCustomId('btn_delete_acc_prompt').setLabel('🗑️ Hapus Profil').setStyle(ButtonStyle.Danger)
    );
  }
  components.push(btnRow);

  return { embeds: [embed], components };
}

/**
 * Builds the `/enhancements` manager UI listing learned skills and their Global/Channel scopes.
 */
function buildEnhancementsPayload(channelId, ctx) {
  const list = ctx.enhancementService.getEnhancements();
  if (list.length === 0) {
    return {
      content: '📚 **Belum ada Enhanced Skill yang dipelajari.**\n> Gunakan command `/enhance url:<link>` dengan link Instagram Reels atau TikTok untuk mengajari bot teknik/best practice baru!',
      ephemeral: true
    };
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('📚 Learned Skills & Enhancements')
    .setDescription(
      'Daftar kaidah dan teknik koding yang dipelajari bot dari video. Skill yang **AKTIF** otomatis dipatuhi sesuai cakupannya (Global atau per Channel).\n\n' +
      list.map((e, idx) => {
        const status = e.enabled ? '🟢 **AKTIF**' : '⚪ *Nonaktif*';
        const scopeBadge = (!e.scope || e.scope === 'global') ? '🌐 `Global`' : `📍 \`${e.channelName || 'Channel'}\``;
        const isHere = (!e.scope || e.scope === 'global') || (channelId && e.scope === channelId);
        const hereBadge = isHere ? (e.enabled ? '• ⚡ *Aktif di channel ini*' : '') : '• *(Channel lain)*';
        const ruleSample = e.rules?.[0] ? `\n> 💡 \`${e.rules[0]}\`` : '';
        return `**${idx + 1}. ${e.title}** (${status})\n> ${scopeBadge} • 🏷️ \`${e.category || 'General'}\` ${hereBadge}\n> *${e.summary}*${ruleSample}`;
      }).join('\n\n')
    )
    .setFooter({ text: `Total: ${list.length} Skill • Gunakan dropdown di bawah untuk On/Off` });

  const options = list.slice(0, 25).map(e => {
    const scopeIcon = (!e.scope || e.scope === 'global') ? '🌐' : '📍';
    const statusIcon = e.enabled ? '🟢' : '⚪';
    const scopeName = (!e.scope || e.scope === 'global') ? 'Global' : (e.channelName || 'Channel');
    return {
      label: `${statusIcon} ${scopeIcon} ${e.title}`.slice(0, 100),
      value: e.id,
      description: `[${scopeName}] ${e.category || 'Skill'} - Klik untuk ${e.enabled ? 'Matikan' : 'Aktifkan'}`.slice(0, 100)
    };
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_toggle_enhancement')
      .setPlaceholder('Pilih Skill untuk Aktifkan / Nonaktifkan...')
      .addOptions(options)
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Shared video-enhancement pipeline for both `/enhance` and `!enhance`.
 */
async function runEnhanceFlow({ url, channelName, updateProgress, ctx }) {
  await updateProgress(`📥 **Mengunduh media video...**\n🔗 \`${url}\`\n> *Mohon tunggu, proses download & ekstraksi transkrip sedang berlangsung...*`);
  const mediaData = await ctx.enhancementService.downloadMedia(url);

  await updateProgress(`🧠 **Menganalisis konten video dengan AI...**\n📌 *${mediaData.title}* (\`${mediaData.uploader}\`)\n> *Mengekstrak kaidah koding, arsitektur, dan best practices...*`);
  const analysis = await ctx.enhancementService.analyzeMedia(mediaData);
  ctx.enhancementService.cleanTempMedia(mediaData.id);

  if (!analysis || !analysis.title) {
    throw new Error('AI tidak berhasil mengekstrak aturan koding yang spesifik dari video tersebut.');
  }

  const pendingId = `pen_${Date.now()}`;
  ctx.pendingEnhancements.set(pendingId, { ...analysis, sourceUrl: url });
  setTimeout(() => ctx.pendingEnhancements.delete(pendingId), 15 * 60 * 1000);

  const rulesText = (analysis.rules || []).map((r, i) => `**${i + 1}.** ${r}`).join('\n') || '-';
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`✨ [Preview Skill Baru] ${analysis.title}`)
    .setDescription(`> *${analysis.summary}*`)
    .addFields(
      { name: '🏷️ Kategori', value: `\`${analysis.category || 'General'}\``, inline: true },
      { name: '👤 Sumber Video', value: `[${mediaData.uploader}](${url})`, inline: true },
      { name: '📜 Kaidah / Best Practice yang Diekstrak', value: rulesText, inline: false },
      { name: '🤖 System Prompt Directive', value: `\`\`\`text\n${analysis.systemPromptInstruction || analysis.summary}\n\`\`\``, inline: false }
    )
    .setFooter({ text: 'Pilih: Terapkan secara Global atau khusus untuk channel ini saja.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn_apply_enh_global_${pendingId}`).setLabel('🌐 Terapkan Global').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`btn_apply_enh_channel_${pendingId}`).setLabel(`📍 Terapkan di ${channelName}`.slice(0, 80)).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`btn_cancel_enh_${pendingId}`).setLabel('❌ Batalkan').setStyle(ButtonStyle.Secondary)
  );

  return {
    content: '🎯 **Analisis Video Selesai!** Tinjau kaidah baru berikut sebelum diterapkan:',
    embeds: [embed],
    components: [row]
  };
}

module.exports = function createAiCommands(ctx) {
  const handleUsageSlash = async (interaction) => {
    await interaction.deferReply();
    try {
      const data = await ctx.quotaService.fetchQuotaAndStatus(true);
      await interaction.editReply(buildUsagePayload(data, ctx));
    } catch (err) {
      await interaction.editReply(`❌ Gagal mengambil data usage: ${err.message}`);
    }
  };

  return {
    slashBuilders: [
      new SlashCommandBuilder()
        .setName('usage')
        .setDescription('Cek sisa kuota Gemini & model AI Antigravity realtime'),
      new SlashCommandBuilder()
        .setName('account')
        .setDescription('Kelola dan alihkan multi-akun Gemini Pro langsung dari Discord'),
      new SlashCommandBuilder()
        .setName('enhance')
        .setDescription('Pelajari & terapkan kaidah koding/prompt baru dari video Instagram Reels atau TikTok')
        .addStringOption(opt => opt.setName('url').setDescription('Link video Instagram Reels atau TikTok').setRequired(true)),
      new SlashCommandBuilder()
        .setName('enhancements')
        .setDescription('Daftar skill & kaidah global yang sudah dipelajari bot (bisa on/off)')
    ],

    slash: {
      usage: handleUsageSlash,
      account: async (interaction) => interaction.reply(buildAccountsPayload(ctx)),
      accounts: async (interaction) => interaction.reply(buildAccountsPayload(ctx)),
      enhancements: async (interaction) => interaction.reply(buildEnhancementsPayload(interaction.channelId, ctx)),
      enhance: async (interaction) => {
        const url = interaction.options.getString('url').trim();
        if (!/^https?:\/\//i.test(url)) {
          await interaction.reply({ content: '❌ Mohon masukkan link URL yang valid (Instagram Reels atau TikTok).', ephemeral: true });
          return;
        }
        await interaction.deferReply();
        try {
          const channelName = interaction.channel?.name ? `#${interaction.channel.name}` : 'Channel Ini';
          const resultPayload = await runEnhanceFlow({
            url,
            channelName,
            updateProgress: text => interaction.editReply(text),
            ctx
          });
          await interaction.editReply(resultPayload);
        } catch (err) {
          await interaction.editReply(`❌ **Gagal menganalisis video:** ${err.message}`);
        }
      }
    },

    prefix: {
      usage: async (message) => {
        try {
          const data = await ctx.quotaService.fetchQuotaAndStatus(true);
          await message.reply(buildUsagePayload(data, ctx));
        } catch (err) {
          await message.reply(`❌ Gagal mengambil data usage: ${err.message}`);
        }
      },
      kuota: async (message) => {
        try {
          const data = await ctx.quotaService.fetchQuotaAndStatus(true);
          await message.reply(buildUsagePayload(data, ctx));
        } catch (err) {
          await message.reply(`❌ Gagal mengambil data usage: ${err.message}`);
        }
      },
      account: async (message) => message.reply(buildAccountsPayload(ctx)),
      accounts: async (message) => message.reply(buildAccountsPayload(ctx)),
      enhancements: async (message) => message.reply(buildEnhancementsPayload(message.channelId, ctx)),
      enhance: async (message, args) => {
        const url = args[0];
        if (!url || !/^https?:\/\//i.test(url)) {
          await message.reply('Contoh: `!enhance https://www.instagram.com/reel/...` atau `!enhance https://www.tiktok.com/...`');
          return;
        }
        const statusMsg = await message.reply('📥 Mengunduh & menganalisis video tips...');
        try {
          const channelName = message.channel?.name ? `#${message.channel.name}` : 'Channel Ini';
          const resultPayload = await runEnhanceFlow({
            url,
            channelName,
            updateProgress: text => statusMsg.edit(text),
            ctx
          });
          await statusMsg.edit(resultPayload);
        } catch (err) {
          await statusMsg.edit(`❌ **Gagal menganalisis video:** ${err.message}`);
        }
      }
    },

    buttons: [
      {
        match: 'btn_usage_refresh',
        handle: async (interaction) => {
          await interaction.deferUpdate();
          try {
            const data = await ctx.quotaService.fetchQuotaAndStatus(true);
            await interaction.editReply(buildUsagePayload(data, ctx));
          } catch (err) {
            await interaction.followUp({ content: `❌ Gagal me-refresh usage: ${err.message}`, ephemeral: true });
          }
        }
      },
      {
        match: 'btn_usage_switch_acc',
        handle: async (interaction) => {
          await interaction.reply({ ...buildAccountsPayload(ctx), ephemeral: true });
        }
      },
      {
        match: id => id.startsWith('btn_apply_enh_'),
        handle: async (interaction) => {
          const parts = interaction.customId.split('_');
          const hasScope = parts[3] === 'global' || parts[3] === 'channel';
          const scopeMode = hasScope ? parts[3] : 'global';
          const pendingId = parts.slice(hasScope ? 4 : 3).join('_');

          const pending = ctx.pendingEnhancements.get(pendingId);
          if (!pending) {
            await interaction.reply({ content: '⚠️ Sesi konfirmasi skill ini telah kadaluarsa. Silakan jalankan `/enhance` kembali.', ephemeral: true });
            return;
          }
          ctx.pendingEnhancements.delete(pendingId);

          const channelName = interaction.channel?.name ? `#${interaction.channel.name}` : 'Channel Ini';
          const saved = ctx.enhancementService.addEnhancement({
            ...pending,
            scope: scopeMode === 'channel' ? interaction.channelId : 'global',
            channelName: scopeMode === 'channel' ? channelName : null
          });
          const scopeDesc = saved.scope === 'global'
            ? 'secara **GLOBAL (Semua Channel)**'
            : `khusus untuk channel **${channelName}**`;

          await interaction.update({
            content: `🎉 **Sukses! Skill "${saved.title}" Berhasil Diterapkan ${scopeDesc}!**\n> AI sekarang otomatis mematuhi kaidah ini.`,
            components: []
          });
        }
      },
      {
        match: id => id.startsWith('btn_cancel_enh_'),
        handle: async (interaction) => {
          const pendingId = interaction.customId.replace('btn_cancel_enh_', '');
          ctx.pendingEnhancements.delete(pendingId);
          await interaction.update({
            content: '🚫 **Penerapan skill dibatalkan.** Tidak ada kaidah baru yang ditambahkan.',
            embeds: [],
            components: []
          });
        }
      },
      {
        match: 'btn_save_current_acc',
        handle: async (interaction) => {
          const modal = new ModalBuilder().setCustomId('modal_save_current_acc').setTitle('Simpan Akun Saat Ini');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('account_label')
                .setLabel('Label / Nama Profil Akun')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Contoh: Akun Utama (Pro), Akun Kantor')
                .setRequired(true)
            )
          );
          await interaction.showModal(modal);
        }
      },
      {
        match: 'btn_add_token_manual',
        handle: async (interaction) => {
          const modal = new ModalBuilder().setCustomId('modal_add_token_manual').setTitle('Input Token Manual');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('token_label')
                .setLabel('Label / Nama Akun')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Contoh: Akun Cadangan Pro')
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('token_json')
                .setLabel('Isi JSON Token (antigravity-oauth-token)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Paste seluruh string JSON token di sini...')
                .setRequired(true)
            )
          );
          await interaction.showModal(modal);
        }
      },
      {
        match: 'btn_acc_guide',
        handle: async (interaction) => {
          await interaction.reply({
            content:
              `📖 **Panduan Menambah Akun Google / Gemini Pro Baru:**\n\n` +
              `1. Klik tombol **💾 Simpan Akun Sekarang** di Discord untuk mengamankan akun aktifmu saat ini.\n` +
              `2. Buka terminal laptop kamu dan jalankan:\n` +
              `\`\`\`powershell\nRemove-Item "$env:USERPROFILE\\.gemini\\antigravity-cli\\antigravity-oauth-token" -Force\n\`\`\`\n` +
              `3. Ketik \`agy\` di terminal laptop ➡️ Browser login Google akan terbuka otomatis ➡️ Login dengan akun Gemini Pro kedua kamu.\n` +
              `4. Kembali ke Discord, ketik \`/account\` lalu klik **💾 Simpan Akun Sekarang** (beri nama: *Akun Cadangan*).\n` +
              `5. Selesai! Kamu sekarang punya 2 akun dan bisa beralih instan kapan pun hanya dengan 1-klik di Discord!`,
            ephemeral: true
          });
        }
      },
      {
        match: 'btn_delete_acc_prompt',
        handle: async (interaction) => {
          const data = ctx.accountService.getAccounts();
          if (data.accounts.length === 0) {
            await interaction.reply({ content: 'ℹ️ Tidak ada profil akun yang tersimpan.', ephemeral: true });
            return;
          }
          const deleteOptions = data.accounts.map(acc => ({
            label: `Hapus: ${acc.label}`.slice(0, 50),
            value: acc.id,
            description: acc.maskedEmail,
            emoji: '🗑️'
          }));
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('select_delete_account')
              .setPlaceholder('Pilih akun yang ingin dihapus...')
              .addOptions(deleteOptions)
          );
          await interaction.reply({ content: '🗑️ **Pilih profil akun yang ingin kamu hapus:**', components: [row], ephemeral: true });
        }
      }
    ],

    selects: {
      select_switch_account: async (interaction) => {
        const accId = interaction.values[0];
        await interaction.deferUpdate();
        try {
          const switched = ctx.accountService.switchAccount(accId);
          ctx.quotaService.clearCache();
          ctx.clearModelCache();
          const payload = buildAccountsPayload(ctx);
          await interaction.editReply({
            content: `🔄 **Berhasil Beralih Akun!** Sekarang Antigravity aktif menggunakan **${switched.label}** (\`${switched.maskedEmail}\`). Sesi koding kamu tetap aman!`,
            embeds: payload.embeds,
            components: payload.components
          });
        } catch (err) {
          await interaction.followUp({ content: `❌ Gagal beralih akun: ${err.message}`, ephemeral: true });
        }
      },
      select_delete_account: async (interaction) => {
        const accId = interaction.values[0];
        try {
          const removed = ctx.accountService.deleteAccount(accId);
          await interaction.update({
            content: `🗑️ **Profil Dihapus:** Profil **${removed.label}** (\`${removed.maskedEmail}\`) telah dihapus.`,
            components: []
          });
        } catch (err) {
          await interaction.reply({ content: `❌ Gagal menghapus akun: ${err.message}`, ephemeral: true });
        }
      },
      select_toggle_enhancement: async (interaction) => {
        const enhId = interaction.values[0];
        try {
          const toggled = ctx.enhancementService.toggleEnhancement(enhId);
          const payload = buildEnhancementsPayload(interaction.channelId, ctx);
          const scopeBadge = (!toggled.scope || toggled.scope === 'global') ? 'Global' : (toggled.channelName || 'Channel');
          await interaction.update({
            content: `🔄 Status skill **${toggled.title}** (${scopeBadge}) sekarang: ${toggled.enabled ? '🟢 **AKTIF**' : '⚪ **NONAKTIF**'}`,
            embeds: payload.embeds,
            components: payload.components
          });
        } catch (err) {
          await interaction.reply({ content: `❌ Gagal mengubah status skill: ${err.message}`, ephemeral: true });
        }
      }
    },

    modals: {
      modal_save_current_acc: async (interaction) => {
        const label = interaction.fields.getTextInputValue('account_label');
        try {
          const saved = ctx.accountService.saveCurrentLiveAccount(label);
          const payload = buildAccountsPayload(ctx);
          await interaction.update({
            content: `🎉 **Akun Berhasil Disimpan!** Profil **${saved.label}** (\`${ctx.accountService.maskEmail(saved.email)}\`) siap dipakai kapan saja.`,
            embeds: payload.embeds,
            components: payload.components
          });
        } catch (err) {
          await interaction.reply({ content: `❌ Gagal menyimpan akun: ${err.message}`, ephemeral: true });
        }
      },
      modal_add_token_manual: async (interaction) => {
        const label = interaction.fields.getTextInputValue('token_label');
        const json = interaction.fields.getTextInputValue('token_json');
        try {
          const saved = ctx.accountService.saveDirectToken(label, json);
          const payload = buildAccountsPayload(ctx);
          await interaction.update({
            content: `🎉 **Token Berhasil Disimpan!** Profil **${saved.label}** (\`${ctx.accountService.maskEmail(saved.email)}\`) ditambahkan ke daftar.`,
            embeds: payload.embeds,
            components: payload.components
          });
        } catch (err) {
          await interaction.reply({ content: `❌ Gagal menyimpan token: ${err.message}`, ephemeral: true });
        }
      }
    }
  };
};
