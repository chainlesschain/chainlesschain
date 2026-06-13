/**
 * @file-mention helpers for the chat input — pure logic, shared verbatim
 * between Node (extension host filtering + unit tests) and the webview
 * (embedded as a nonce'd script, like md-lite). The CLI side already expands
 * @path references in stream-json user turns (headless-stream
 * expandFileRefs), so the panel only needs to help the user TYPE them.
 *
 * IMPORTANT: this source is embedded inside chat-html.js's template literal —
 * keep it free of backticks and `${` sequences.
 */
(function (global) {
  /**
   * Detect an in-progress @token immediately before the caret.
   * Returns { prefix, start } (start = index of "@") or null. An "@" glued
   * to a preceding word (user@host) is NOT a mention.
   */
  function detectAtToken(textBeforeCaret) {
    const s = String(textBeforeCaret == null ? "" : textBeforeCaret);
    const m = s.match(/(^|[\s({\[<"'])@([A-Za-z0-9_\-./\\]*)$/);
    if (!m) return null;
    return { prefix: m[2], start: s.length - m[2].length - 1 };
  }

  /**
   * Rank workspace-relative paths against the typed prefix:
   * basename-prefix hits first, then path-prefix, then substring anywhere.
   * Case-insensitive; backslashes in the query are normalized to "/".
   */
  function filterFiles(files, prefix, limit) {
    const max = limit > 0 ? limit : 20;
    const list = Array.isArray(files) ? files : [];
    const q = String(prefix == null ? "" : prefix)
      .toLowerCase()
      .replace(/\\/g, "/");
    if (!q) return list.slice(0, max);
    const baseHits = [];
    const pathHits = [];
    const subHits = [];
    for (let i = 0; i < list.length; i++) {
      const f = String(list[i]);
      const lower = f.toLowerCase();
      const base = lower.slice(lower.lastIndexOf("/") + 1);
      if (base.indexOf(q) === 0) baseHits.push(f);
      else if (lower.indexOf(q) === 0) pathHits.push(f);
      else if (lower.indexOf(q) >= 0) subHits.push(f);
    }
    return baseHits.concat(pathHits, subHits).slice(0, max);
  }

  // IDE pseudo-mentions the CLI expands server-side (lib/ide-context.js):
  // @selection = the active editor selection, @diagnostics = the whole
  // workspace's current problems. Offered as completions so the feature is
  // discoverable, not just typeable from memory.
  var IDE_MENTIONS = ["selection", "diagnostics"];

  /**
   * IDE keyword mentions whose name starts with the typed prefix (empty prefix
   * matches all). Returned ahead of file paths so "@s" → selection ranks first.
   */
  function ideMentionMatches(prefix) {
    var q = String(prefix == null ? "" : prefix).toLowerCase();
    return IDE_MENTIONS.filter(function (m) {
      return m.indexOf(q) === 0;
    });
  }

  /**
   * Splice an accepted suggestion into the input text.
   * Returns { text, caret } with a trailing space after the mention.
   */
  function applyMention(text, at, relPath, caretPos) {
    const s = String(text == null ? "" : text);
    const before = s.slice(0, at.start);
    const after = s.slice(caretPos == null ? s.length : caretPos);
    const mention = "@" + relPath + " ";
    return { text: before + mention + after, caret: (before + mention).length };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      detectAtToken: detectAtToken,
      filterFiles: filterFiles,
      applyMention: applyMention,
      ideMentionMatches: ideMentionMatches,
    };
  }
  global.ccAtMention = {
    detectAtToken: detectAtToken,
    filterFiles: filterFiles,
    applyMention: applyMention,
    ideMentionMatches: ideMentionMatches,
  };
})(typeof window !== "undefined" ? window : globalThis);
