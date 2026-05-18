/**
 * Telegram Formatter — converts agent responses to Telegram-compatible markup.
 *
 * Telegram uses a subset of Markdown (MarkdownV2) with different escaping rules.
 *
 * @module telegram-formatter
 */

// Characters that must be escaped in MarkdownV2
const ESCAPE_CHARS = /([_*[\]()~`>#+\-=|{}.!])/g;

/**
 * Escape text for Telegram MarkdownV2.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(ESCAPE_CHARS, "\\$1");
}

/**
 * Convert standard Markdown to Telegram MarkdownV2.
 * Handles: bold, italic, code blocks, inline code, links.
 * @param {string} markdown
 * @returns {string}
 */
export function toTelegramMarkdown(markdown) {
  if (!markdown) return "";

  let result = markdown;

  // Preserve code blocks (don't escape inside them)
  const codeBlocks = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Preserve inline code
  const inlineCode = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  // Escape special characters in text
  result = escapeMarkdownV2(result);

  // Restore code blocks and inline code (unescaped)
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    result = result.replace(
      `__CODE_BLOCK_${i}__`.replace(ESCAPE_CHARS, "\\$1"),
      codeBlocks[i],
    );
  }
  for (let i = inlineCode.length - 1; i >= 0; i--) {
    result = result.replace(
      `__INLINE_CODE_${i}__`.replace(ESCAPE_CHARS, "\\$1"),
      inlineCode[i],
    );
  }

  return result;
}

/**
 * Format an agent response for Telegram (plain text fallback).
 * Strips complex markdown, keeps it readable.
 * @param {string} response
 * @param {object} [options]
 * @param {number} [options.maxLength=4000]
 * @returns {string}
 */
export function formatForTelegram(response, options = {}) {
  if (!response) return "";
  const maxLength = options.maxLength || 4000;

  let text = response;

  // Convert headers to bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Keep code blocks as-is (Telegram supports ```)
  // Keep bold (**text** → *text*)
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");

  if (text.length > maxLength) {
    text = text.substring(0, maxLength - 3) + "...";
  }

  return text;
}
