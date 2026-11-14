const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const DISCORD_MAX_FILE_BYTES = 24 * 1024 * 1024;

/**
 * Replaces Windows-illegal path characters so channel names map safely to temp folders.
 */
function sanitizeFolderName(name) {
  if (!name) return 'general';
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'general';
}

/**
 * Ensures the per-channel temp directory exists and returns its path.
 */
function ensureChannelTempDir(rootDir, channelName, fallback = 'temp') {
  const folder = sanitizeFolderName(channelName || fallback);
  const dir = path.join(rootDir, 'temp_downloads', folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Writes content to a uniquely named temporary file inside `temp_downloads/<channel>/`.
 */
function createTempFile(rootDir, channelName, prefix, ext, content) {
  const tempDir = ensureChannelTempDir(rootDir, channelName, prefix);
  const filePath = path.join(tempDir, `${prefix}_${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Validates that a local file exists, is not a directory, and stays under Discord's 24 MB limit.
 */
function validateAttachableFile(rawPath, cwd) {
  const cleanPath = rawPath.trim().replace(/^["']|["']$/g, '');
  const resolved = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(cwd, cleanPath);

  if (!fs.existsSync(resolved)) {
    return { ok: false, resolved, error: `File tidak ditemukan di laptop:\n\`\`\`${resolved}\`\`\`` };
  }
  const stats = fs.statSync(resolved);
  if (stats.isDirectory()) {
    return { ok: false, resolved, error: `Path tersebut adalah folder, bukan file:\n\`\`\`${resolved}\`\`\`` };
  }
  if (stats.size > DISCORD_MAX_FILE_BYTES) {
    const mb = (stats.size / (1024 * 1024)).toFixed(1);
    return { ok: false, resolved, error: `File \`${path.basename(resolved)}\` melebihi batas 24MB Discord (${mb} MB).` };
  }

  return { ok: true, resolved, stats, attachment: new AttachmentBuilder(resolved) };
}

/**
 * Parses `[ATTACH_FILE: <path>]` directives out of AI output and resolves valid Discord attachments.
 */
function extractFileAttachments(rawText, cwd) {
  let cleanText = rawText || '';
  const attachments = [];
  const attachRegex = /\[ATTACH_FILE:\s*([^\]]+)\]/gi;
  let match;

  while ((match = attachRegex.exec(cleanText)) !== null) {
    const check = validateAttachableFile(match[1], cwd);
    if (check.ok) {
      attachments.push(check.attachment);
    } else if (check.error) {
      cleanText += `\n⚠️ *${check.error.replace(/\n/g, ' ')}*`;
    }
  }

  cleanText = cleanText.replace(/\[ATTACH_FILE:\s*[^\]]+\]/gi, '').trim();
  return { cleanText, attachments };
}

module.exports = {
  DISCORD_MAX_FILE_BYTES,
  sanitizeFolderName,
  ensureChannelTempDir,
  createTempFile,
  validateAttachableFile,
  extractFileAttachments
};
