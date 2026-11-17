const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const QUESTION_TTL_MS = 30 * 60 * 1000;

/**
 * Finds and parses `[ASK_USER: {...}]` directives using balanced-brace scanning
 * so nested brackets or JSON strings inside the payload never truncate prematurely.
 */
function extractAskUserBlocks(rawText) {
  let text = rawText || '';
  const questions = [];
  const markerRegex = /\[ASK_USER:\s*/gi;
  const removals = [];
  let match;

  while ((match = markerRegex.exec(text)) !== null) {
    const startIdx = match.index;
    const jsonStart = text.indexOf('{', match.index + match[0].length - 1);
    if (jsonStart === -1) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let jsonEnd = -1;

    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          jsonEnd = i;
          break;
        }
      }
    }

    if (jsonEnd === -1) continue;
    const closingBracket = text.indexOf(']', jsonEnd);
    const removeEnd = closingBracket !== -1 ? closingBracket + 1 : jsonEnd + 1;

    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (parsed && typeof parsed.question === 'string' && parsed.question.trim()) {
        const cleanOptions = Array.isArray(parsed.options)
          ? parsed.options.map(o => String(o).trim()).filter(Boolean).slice(0, 4)
          : [];
        questions.push({
          question: parsed.question.trim(),
          options: cleanOptions
        });
        removals.push([startIdx, removeEnd]);
      }
    } catch (_) {
      // Ignore malformed JSON blocks rather than breaking the user response.
    }

    markerRegex.lastIndex = removeEnd;
  }

  // Remove extracted blocks from right to left so indices remain valid.
  for (let i = removals.length - 1; i >= 0; i--) {
    const [from, to] = removals[i];
    text = text.slice(0, from) + text.slice(to);
  }

  return {
    cleanText: text.trim(),
    questions
  };
}

/**
 * Registers a pending question in context and builds an interactive Discord
 * Embed + Buttons (up to 4 preset options + 1 "Custom Answer" modal trigger).
 */
function buildAskUserPayload(askData, channelId, ctx) {
  const qId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const options = askData.options || [];

  ctx.pendingQuestions.set(qId, {
    question: askData.question,
    options,
    channelId,
    createdAt: Date.now()
  });

  const ttlTimer = setTimeout(() => {
    ctx.pendingQuestions.delete(qId);
  }, QUESTION_TTL_MS);
  if (typeof ttlTimer.unref === 'function') ttlTimer.unref();

  const optionList = options.length > 0
    ? options.map((opt, idx) => `**${idx + 1}.** ${opt}`).join('\n')
    : '*(Klik tombol di bawah untuk mengetik jawabanmu)*';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🧭 Keputusan / Arahan Kamu Diperlukan')
    .setDescription(`**${askData.question}**\n\n${optionList}`)
    .setFooter({ text: 'Pilih salah satu opsi di bawah, atau ketik arahan custom.' });

  const row = new ActionRowBuilder();
  options.forEach((opt, idx) => {
    const isRecommended = /recommended/i.test(opt);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ask_opt_${qId}_${idx}`)
        .setLabel(`${idx + 1}. ${opt}`.slice(0, 80))
        .setStyle(isRecommended ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  });

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`ask_custom_${qId}`)
      .setLabel('✏️ Jawaban Lainnya...')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  extractAskUserBlocks,
  buildAskUserPayload
};
