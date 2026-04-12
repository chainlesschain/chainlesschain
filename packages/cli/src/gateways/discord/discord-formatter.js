/**
 * Discord Formatter — converts agent responses to Discord-compatible markup.
 *
 * Discord supports a broad subset of Markdown. Main limit is 2000 chars per message.
 *
 * @module discord-formatter
 */

const DISCORD_MAX_LENGTH = 2000;

/**
 * Format an agent response for Discord.
 * Discord natively supports Markdown, so minimal conversion needed.
 * @param {string} response
 * @param {object} [options]
 * @param {number} [options.maxLength=2000]
 * @returns {string}
 */
export function formatForDiscord(response, options = {}) {
  if (!response) return "";
  const maxLength = options.maxLength || DISCORD_MAX_LENGTH;

  let text = response;

  if (text.length > maxLength) {
    text = text.substring(0, maxLength - 3) + "...";
  }

  return text;
}

/**
 * Split a response into Discord-sized chunks.
 * Tries to split at code block or newline boundaries.
 * @param {string} text
 * @param {number} [maxLength=2000]
 * @returns {string[]}
 */
export function splitForDiscord(text, maxLength = DISCORD_MAX_LENGTH) {
  if (!text || text.length <= maxLength) return [text || ""];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at code block boundary
    let splitIdx = remaining.lastIndexOf("\n```", maxLength);
    if (splitIdx > maxLength * 0.3) {
      splitIdx += 1; // Include the newline
    } else {
      // Try to split at newline
      splitIdx = remaining.lastIndexOf("\n", maxLength);
      if (splitIdx < maxLength * 0.3) {
        splitIdx = maxLength;
      }
    }

    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }

  return chunks;
}

/**
 * Format a code block for Discord with syntax highlighting.
 * @param {string} code
 * @param {string} [language=""]
 * @returns {string}
 */
export function codeBlock(code, language = "") {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/**
 * Format an embed-like block for Discord (using quote blocks).
 * @param {string} title
 * @param {string} content
 * @returns {string}
 */
export function quoteBlock(title, content) {
  const lines = content.split("\n").map((l) => `> ${l}`);
  return `**${title}**\n${lines.join("\n")}`;
}
