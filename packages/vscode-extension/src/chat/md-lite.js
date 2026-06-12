/**
 * Minimal, XSS-safe markdown for the chat webview. Escape-FIRST, then a
 * whitelist of attribute-less tags: <pre>, <code>, <strong>, <em>, <br>.
 * Nothing else can appear in the output, so innerHTML is safe by
 * construction.
 *
 * CONSTRAINTS (do not violate):
 *  - This file is embedded verbatim into the webview page, which is built
 *    inside a template literal — so this source MUST NOT contain backticks,
 *    the dollar-brace sequence, or a closing script tag.
 *  - Runs both in Node (module.exports, for tests) and in the webview
 *    (window.mdLite).
 */
(function (global) {
  "use strict";

  var TICK = String.fromCharCode(96); // backtick, spelled without using one

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Inline transforms on an ALREADY-ESCAPED, code-free text segment. */
  function inlineFormat(escaped) {
    var out = escaped
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    // headings: render the line bold (block semantics kept simple)
    out = out.replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>");
    return out.replace(/\n/g, "<br>");
  }

  /** Split a code-free chunk on inline code spans and format both halves. */
  function renderInline(text) {
    var escaped = escapeHtml(text);
    var tickRe = new RegExp(TICK + "([^" + TICK + "\n]+)" + TICK, "g");
    var html = "";
    var last = 0;
    var m;
    while ((m = tickRe.exec(escaped)) !== null) {
      html += inlineFormat(escaped.slice(last, m.index));
      html += "<code>" + m[1] + "</code>";
      last = m.index + m[0].length;
    }
    html += inlineFormat(escaped.slice(last));
    return html;
  }

  /** markdown → safe HTML (fenced blocks first, inline on the rest). */
  function mdLite(text) {
    var src = String(text == null ? "" : text);
    var fence = TICK + TICK + TICK;
    var html = "";
    var pos = 0;
    for (;;) {
      var open = src.indexOf(fence, pos);
      if (open < 0) break;
      var nl = src.indexOf("\n", open); // skip the info string (lang tag)
      var bodyStart = nl >= 0 ? nl + 1 : open + 3;
      var close = src.indexOf(fence, bodyStart);
      if (close < 0) break; // unterminated fence → leave as inline text
      html += renderInline(src.slice(pos, open));
      html += "<pre><code>" + escapeHtml(src.slice(bodyStart, close)) + "</code></pre>";
      pos = close + 3;
      if (src.charAt(pos) === "\n") pos++; // swallow the newline after a fence
    }
    html += renderInline(src.slice(pos));
    return html;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { mdLite: mdLite, escapeHtml: escapeHtml };
  }
  global.mdLite = mdLite;
})(typeof window !== "undefined" ? window : globalThis);
