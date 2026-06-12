/**
 * Minimal, XSS-safe markdown for the chat webview. Escape-FIRST, then a
 * whitelist of attribute-less tags: <pre>, <code>, <strong>, <em>, <br>,
 * <table>, <tr>, <th>, <td>. Nothing else can appear in the output, so
 * innerHTML is safe by construction. GFM task-list checkboxes render as
 * ☐/☑ text (real <input> would need attributes — out of the whitelist).
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
    // GFM task lists: checkbox state as text — no attributes needed
    out = out
      .replace(/^(\s*)[-*] \[[xX]\] /gm, "$1☑ ")
      .replace(/^(\s*)[-*] \[ \] /gm, "$1☐ ");
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

  /** One table row "| a | b |" → trimmed cell strings. */
  function splitRow(line) {
    var t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return t.split("|").map(function (c) {
      return c.trim();
    });
  }

  var ROW_RE = /^\s*\|.*\|\s*$/;
  var SEP_RE = /^\s*\|[\s\-:|]+\|\s*$/; // |---|:--:|… under the header

  /**
   * Block pass on a code-free chunk: GFM tables become <table> (cells go
   * through renderInline, so they stay escaped + inline-formatted); all
   * other line runs fall through to renderInline unchanged.
   */
  function renderBlocks(text) {
    var lines = String(text).split("\n");
    var html = "";
    var buf = [];
    function flush() {
      if (buf.length) {
        html += renderInline(buf.join("\n"));
        buf = [];
      }
    }
    for (var i = 0; i < lines.length; i++) {
      if (
        ROW_RE.test(lines[i]) &&
        i + 1 < lines.length &&
        SEP_RE.test(lines[i + 1])
      ) {
        flush();
        var header = splitRow(lines[i]);
        i += 2;
        var rows = [];
        while (i < lines.length && ROW_RE.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        i--; // the for-loop increment re-advances
        html += "<table><tr>";
        for (var h = 0; h < header.length; h++) {
          html += "<th>" + renderInline(header[h]) + "</th>";
        }
        html += "</tr>";
        for (var r = 0; r < rows.length; r++) {
          html += "<tr>";
          for (var c = 0; c < rows[r].length; c++) {
            html += "<td>" + renderInline(rows[r][c]) + "</td>";
          }
          html += "</tr>";
        }
        html += "</table>";
      } else {
        buf.push(lines[i]);
      }
    }
    flush();
    return html;
  }

  /** markdown → safe HTML (fenced blocks first, block+inline on the rest). */
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
      html += renderBlocks(src.slice(pos, open));
      html += "<pre><code>" + escapeHtml(src.slice(bodyStart, close)) + "</code></pre>";
      pos = close + 3;
      if (src.charAt(pos) === "\n") pos++; // swallow the newline after a fence
    }
    html += renderBlocks(src.slice(pos));
    return html;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { mdLite: mdLite, escapeHtml: escapeHtml };
  }
  global.mdLite = mdLite;
})(typeof window !== "undefined" ? window : globalThis);
