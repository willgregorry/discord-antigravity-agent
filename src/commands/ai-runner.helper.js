const fs = require('fs');
const path = require('path');
const { AgyRunner } = require('../core/agy-runner');
const { formatDiscordText, sendLargeMessage } = require('../utils/discord-format');
const { extractFileAttachments, ensureChannelTempDir } = require('../utils/file-helper');

/**
 * Formats an elapsed millisecond duration as `12.3s` or `2m 15s`.
 */
function formatDuration(ms) {
  const sec = (ms / 1000).toFixed(1);
  if (ms / 1000 < 60) return `${sec}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Downloads any Discord message attachments into `temp_downloads/<channel>/`
 * and appends their local laptop paths to the prompt so the CLI can read them.
 */
async function appendIncomingAttachments(prompt, message, rootDir) {
  if (!message?.attachments || message.attachments.size === 0) return prompt;

  const downloadDir = ensureChannelTempDir(rootDir, message.channel?.name || message.channelId || 'general');
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

  if (downloadedFiles.length === 0) return prompt;
  return `${prompt}\n\n[Catatan Sistem: File lampiran dari pengguna di Discord telah diunduh ke laptop pada: ${downloadedFiles.map(f => `\`${f}\``).join(', ')}]`;
}

/**
 * Unified AI prompt executor shared by normal user chat prompts and automated
 * Watchdog 1-Click AI Fix runs. Handles typing heartbeat, rate-limited status updates,
 * timeout enforcement, quota delta tracking, attachment extraction, and voice alerts.
 */
async function executeAiPrompt({ channel, replyMessage = null, session, promptText, ctx, mode = 'chat' }) {
  const isAutoFix = mode === 'autofix';

  if (session.activeProcess) {
    const busyMsg = '⚠️ Channel ini sedang menjalankan task sebelumnya. Ketik `/stop` jika ingin membatalkannya.';
    if (replyMessage) await replyMessage.reply(busyMsg);
    else await channel.send(busyMsg);
    return;
  }

  const fullPrompt = replyMessage
    ? await appendIncomingAttachments(promptText, replyMessage, ctx.rootDir)
    : promptText;

  session.clearTimers();
  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 4500);
  session.typingInterval = typingInterval;
  channel.sendTyping().catch(() => {});

  const startBanner = isAutoFix
    ? `⏳ **[Antigravity AI Auto-Fix]**\n📁 CWD: \`\`\`${session.cwd}\`\`\`\n🧠 Model: \`\`\`${session.model}\`\`\`\nMenjalankan analisa perbaikan...`
    : `⏳ **[Memulai Antigravity CLI]**\n📁 CWD: \`\`\`${session.cwd}\`\`\`\n🧠 Model: \`\`\`${session.model}\`\`\`\nMenyiapkan agent...`;

  const statusMsg = replyMessage
    ? await replyMessage.reply({ content: startBanner })
    : await channel.send({ content: startBanner });

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

  const timeoutMinutes = parseInt(process.env.TASK_TIMEOUT_MINUTES || '30', 10);
  const taskStartTime = Date.now();
  let beforeQuota = null;
  try {
    beforeQuota = await ctx.quotaService.fetchQuotaAndStatus(false);
  } catch (_) {}

  const timeoutTimer = setTimeout(() => {
    if (!session.activeProcess) return;
    session.stopActiveProcess();
    const label = isAutoFix ? 'Timeout Auto-Fix' : 'Timeout';
    statusMsg.edit(`⏱️ **${label}:** Task dibatalkan karena melebihi batas waktu ${timeoutMinutes} menit.`).catch(() => {});
  }, timeoutMinutes * 60 * 1000);

  const guildId = replyMessage?.guildId || channel.guildId;

  try {
    session.activeProcess = AgyRunner.runPrompt({
      prompt: fullPrompt,
      cwd: session.cwd,
      model: session.model,
      conversationId: session.conversationId,
      notes: ctx.notesService.getNotes(session.channelId),
      enhancements: ctx.enhancementService.getFormattedPromptBlock(session.channelId),
      onInit: (initData) => {
        session.conversationId = initData.conversation_id;
      },
      onToolStart: async (step) => {
        toolCount++;
        const toolName = step.tool_name || 'tool';
        if (isAutoFix) {
          await updateStatus(`⚙️ **[Auto-Fix Langkah ${toolCount}] Menjalankan: \`${toolName}\`**`);
          return;
        }
        let paramStr = '';
        if (step.tool_info?.parameters) {
          const p = step.tool_info.parameters;
          paramStr = p.CommandLine || p.Path || p.filepath || p.Query || JSON.stringify(p);
          if (paramStr.length > 80) paramStr = `${paramStr.slice(0, 80)}...`;
        }
        await updateStatus(`⚙️ **[Langkah ${toolCount}] Menjalankan: \`${toolName}\`**\n\`\`\`powershell\n${paramStr || '(eksekusi tool)'}\n\`\`\`\n📁 \`${session.cwd}\``);
      },
      onToolDone: async (step) => {
        const toolName = step.tool_name || 'tool';
        if (isAutoFix) {
          await updateStatus(`✅ **[Auto-Fix Langkah ${toolCount} Selesai] \`${toolName}\`**`);
          return;
        }
        const dur = step.duration_seconds ? ` (${step.duration_seconds.toFixed(1)}s)` : '';
        await updateStatus(`✅ **[Langkah ${toolCount} Selesai] \`${toolName}\`${dur}**\nSedang memproses langkah berikutnya...`);
      },
      onResult: async (result) => {
        clearTimeout(timeoutTimer);
        clearInterval(typingInterval);
        session.activeProcess = null;
        session.conversationId = result.conversation_id || session.conversationId;
        ctx.sessionManager.saveSessions();

        const fallbackText = isAutoFix ? '*(Perbaikan selesai)*' : '*(Tidak ada teks respons)*';
        const { cleanText, attachments } = extractFileAttachments(result.response || fallbackText, session.cwd);
        const responseText = formatDiscordText(cleanText || '*(File terlampir)*');

        const durationStr = formatDuration(Date.now() - taskStartTime);
        const turns = result.num_turns ? `• ${result.num_turns} turns ` : '';

        let quotaBadge = '';
        try {
          const afterQuota = await ctx.quotaService.fetchQuotaAndStatus(true);
          quotaBadge = ctx.quotaService.calculateConsumptionBadge(session.model, beforeQuota, afterQuota, result.usage);
        } catch (_) {}

        const doneTitle = isAutoFix ? 'Perbaikan Selesai!' : 'Selesai!';
        await statusMsg.edit(`✨ **${doneTitle}** ⏱️ ${durationStr} ${turns}• 📁 \`${session.cwd}\``).catch(() => {});
        await sendLargeMessage(channel, responseText + quotaBadge, attachments);

        if (!isAutoFix && guildId && ctx.voiceService.isConnected(guildId)) {
          const chanName = channel?.name ? `channel ${channel.name}` : 'channel ini';
          ctx.voiceService.speak(guildId, `Tugas di ${chanName} sudah selesai dikerjakan ya!`);
        }
      },
      onError: async (err) => {
        clearTimeout(timeoutTimer);
        clearInterval(typingInterval);
        session.activeProcess = null;
        const prefix = isAutoFix ? 'Error Auto-Fix' : 'Error';
        await statusMsg.edit(`❌ **${prefix}:** ${err.message}`).catch(() => {});

        if (!isAutoFix && guildId && ctx.voiceService.isConnected(guildId)) {
          ctx.voiceService.speak(guildId, 'Perhatian, terjadi kesalahan saat menjalankan tugas.');
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

module.exports = { executeAiPrompt };
