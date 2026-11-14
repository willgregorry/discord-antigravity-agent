/**
 * Converts local `file:///...` links emitted by the CLI into inline code spans
 * because Discord clients cannot open local filesystem URIs.
 */
function formatDiscordText(text) {
  if (!text) return '';

  let formatted = text.replace(/\[([^\]]+)\]\(file:\/\/\/[^\)]+\)/g, '`$1`');
  formatted = formatted.replace(/file:\/\/\/[^\s\)]+/g, match => {
    try {
      return `\`${decodeURIComponent(match.replace('file:///', ''))}\``;
    } catch (_) {
      return `\`${match}\``;
    }
  });

  return formatted;
}

/**
 * Renders a compact emoji + block progress bar suitable for mobile Discord views.
 */
function renderProgressBar(fraction, length = 10) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  let statusEmoji = '🟢';
  if (pct <= 20) statusEmoji = '🔴';
  else if (pct <= 50) statusEmoji = '🟡';
  return `${statusEmoji} \`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${pct}%**`;
}

/**
 * Converts an ISO timestamp string into Discord's dynamic `<t:unix:R> (<t:unix:t>)` format.
 */
function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const timestamp = Math.floor(new Date(isoString).getTime() / 1000);
  if (isNaN(timestamp)) return '';
  return `<t:${timestamp}:R> (<t:${timestamp}:t>)`;
}

/**
 * Splits oversized responses into < 2000-char chunks while preserving open Markdown
 * code fences across chunk boundaries, and attaches files to the first message.
 */
async function sendLargeMessage(channel, text, files = []) {
  if (!text || text.trim() === '') {
    if (files && files.length > 0) {
      await channel.send({ files });
    }
    return;
  }

  const MAX_LIMIT = 1950;
  if (text.length <= MAX_LIMIT) {
    const options = { content: text };
    if (files && files.length > 0) options.files = files;
    await channel.send(options);
    return;
  }

  const chunks = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeLanguage = '';

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LIMIT) {
      chunks.push((inCodeBlock ? '```' + codeLanguage + '\n' : '') + remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n\n', MAX_LIMIT);
    if (splitIndex === -1 || splitIndex < 500) {
      splitIndex = remaining.lastIndexOf('\n', MAX_LIMIT);
    }
    if (splitIndex === -1 || splitIndex < 500) {
      splitIndex = MAX_LIMIT;
    }

    let chunk = remaining.slice(0, splitIndex);
    remaining = remaining.slice(splitIndex).trim();

    // Balance any unclosed ``` fence so the next chunk renders with proper syntax highlighting.
    const codeMatches = chunk.match(/```([a-zA-Z0-9_-]*)/g);
    if (codeMatches) {
      if (codeMatches.length % 2 !== 0) {
        codeLanguage = codeMatches[codeMatches.length - 1].replace('```', '').trim();
        chunk += '\n```';
        inCodeBlock = true;
      } else {
        inCodeBlock = false;
      }
    }

    chunks.push(chunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;
    const options = { content: chunk };
    if (i === 0 && files && files.length > 0) {
      options.files = files;
    }
    await channel.send(options);
  }
}

module.exports = {
  formatDiscordText,
  renderProgressBar,
  formatRelativeTime,
  sendLargeMessage
};
