/**
 * Hashline — content-hash anchored line editing (v5.0.2.9)
 *
 * Inspired by oh-my-openagent's "Hashline" design: rather than referring to
 * code by line number (brittle across concurrent edits) or by exact string
 * match (brittle across whitespace drift), each line is tagged with a short
 * content hash. Edits reference the hash and are rejected if the current
 * file contents no longer match — preventing stale-line corruption.
 *
 * Pure functions only — zero side effects, fully testable.
 *
 * Tag format: `<6-char base64url>| <line content>`
 *   Empty / whitespace-only lines use `______` (6 underscores).
 *
 * Hash is computed over `line.trim()`, making it insensitive to leading /
 * trailing whitespace — rebust against auto-formatters and indentation drift.
 */

import crypto from "crypto";

const HASH_LENGTH = 6;
const EMPTY_HASH = "______";
const SEPARATOR = "| ";

/**
 * Compute the stable hash for a single line.
 * Whitespace-insensitive: `.trim()` is applied before hashing.
 *
 * @param {string} line
 * @returns {string} 6-char base64url hash, or "______" for empty/whitespace
 */
export function hashLine(line) {
  if (typeof line !== "string") return EMPTY_HASH;
  const trimmed = line.trim();
  if (trimmed.length === 0) return EMPTY_HASH;
  return crypto
    .createHash("sha256")
    .update(trimmed, "utf8")
    .digest("base64url")
    .slice(0, HASH_LENGTH);
}

/**
 * Split content into lines, preserving line-ending style for round-trips.
 * Detects CRLF vs LF; mixed endings fall back to LF.
 *
 * @param {string} content
 * @returns {{ lines: string[], eol: "\r\n" | "\n" }}
 */
export function splitLines(content) {
  if (typeof content !== "string") return { lines: [], eol: "\n" };
  const hasCRLF = content.includes("\r\n");
  const hasLF = content.includes("\n");
  // Only treat as CRLF if no bare LFs appear outside CRLF pairs
  if (hasCRLF) {
    // Count bare \n (\n not preceded by \r)
    const bareLFs = (content.match(/(^|[^\r])\n/g) || []).length;
    const crlfs = (content.match(/\r\n/g) || []).length;
    const eol = bareLFs === 0 || bareLFs < crlfs / 2 ? "\r\n" : "\n";
    return { lines: content.split(/\r?\n/), eol };
  }
  return { lines: hasLF ? content.split("\n") : [content], eol: "\n" };
}

/**
 * Annotate content: prepend each line with `<hash>| `.
 *
 * @param {string} content
 * @returns {string} annotated content
 */
export function annotateLines(content) {
  const { lines, eol } = splitLines(content);
  return lines.map((line) => `${hashLine(line)}${SEPARATOR}${line}`).join(eol);
}

/**
 * Find all lines whose hash matches the anchor.
 *
 * @param {string} content
 * @param {string} anchorHash
 * @returns {Array<{ index: number, lineNumber: number, content: string }>}
 */
export function findByHash(content, anchorHash) {
  if (!anchorHash || typeof anchorHash !== "string") return [];
  const { lines } = splitLines(content);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (hashLine(lines[i]) === anchorHash) {
      matches.push({
        index: i,
        lineNumber: i + 1, // 1-based for human-friendly display
        content: lines[i],
      });
    }
  }
  return matches;
}

/**
 * Verify the current content of a line matches both the anchor hash and the
 * expected trimmed content. Used as a second-layer check to defend against
 * hash collisions.
 *
 * @param {string} currentLine
 * @param {string} anchorHash
 * @param {string} expectedLine - Expected content (compared trimmed)
 * @returns {boolean}
 */
export function verifyLine(currentLine, anchorHash, expectedLine) {
  if (hashLine(currentLine) !== anchorHash) return false;
  if (typeof expectedLine !== "string") return true;
  return currentLine.trim() === expectedLine.trim();
}

/**
 * Replace a single line at the given anchor hash. Returns either the new
 * content or a structured error.
 *
 * Error shapes (not thrown — returned so the agent loop can present them):
 *   { error: "hash_mismatch",    ... }   — anchor doesn't match any line
 *   { error: "ambiguous_anchor", ... }   — anchor matches multiple lines
 *   { error: "content_mismatch", ... }   — hash matches but expected_line differs
 *
 * @param {string} content - Full file content
 * @param {object} opts
 * @param {string} opts.anchorHash
 * @param {string} opts.expectedLine
 * @param {string} opts.newLine
 * @param {number} [opts.contextLines=3] - Lines of context for error snippets
 * @returns {{ success: true, content: string, lineNumber: number } | { success: false, error: string, [key: string]: any }}
 */
export function replaceByHash(content, opts) {
  const { anchorHash, expectedLine, newLine, contextLines = 3 } = opts;
  const { lines, eol } = splitLines(content);
  const matches = findByHash(content, anchorHash);

  if (matches.length === 0) {
    return {
      success: false,
      error: "hash_mismatch",
      message: `No line matches anchor hash "${anchorHash}"`,
      hint: "Re-read the file with hashed:true to get current hashes",
    };
  }

  if (matches.length > 1) {
    return {
      success: false,
      error: "ambiguous_anchor",
      message: `Anchor hash "${anchorHash}" matches ${matches.length} lines`,
      matches: matches.map((m) => ({
        lineNumber: m.lineNumber,
        content: m.content,
      })),
      hint: "Use edit_file with a unique old_string or refine the anchor",
    };
  }

  const match = matches[0];
  if (
    typeof expectedLine === "string" &&
    match.content.trim() !== expectedLine.trim()
  ) {
    return {
      success: false,
      error: "content_mismatch",
      message: `Line ${match.lineNumber} has hash ${anchorHash} but content differs from expected_line`,
      current: match.content,
      expected: expectedLine,
      hint: "Re-read the file to see current content",
    };
  }

  // Replace — preserve leading whitespace from original line if new_line has none
  const newLines = [...lines];
  newLines[match.index] = newLine;
  return {
    success: true,
    content: newLines.join(eol),
    lineNumber: match.lineNumber,
    previousContent: match.content,
  };
}

/**
 * Produce a small snippet of context around a given line index for error
 * messages. Uses annotated form so the agent can retry with fresh hashes.
 *
 * @param {string} content
 * @param {number} lineIndex - 0-based
 * @param {number} [contextLines=3]
 * @returns {string}
 */
export function snippetAround(content, lineIndex, contextLines = 3) {
  const { lines, eol } = splitLines(content);
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length, lineIndex + contextLines + 1);
  const slice = lines
    .slice(start, end)
    .map((line, i) => `${hashLine(line)}${SEPARATOR}${line}`);
  return slice.join(eol);
}

export const _internals = {
  HASH_LENGTH,
  EMPTY_HASH,
  SEPARATOR,
};
