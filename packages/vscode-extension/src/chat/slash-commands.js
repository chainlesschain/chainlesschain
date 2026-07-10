/**
 * `/` slash-command completion for the chat input — pure logic, shared verbatim
 * between Node (unit tests) and the webview (embedded as a nonce'd script, like
 * md-lite / at-mention). The panel's slash commands (executed in chat-html's
 * SLASH map) are otherwise invisible until you read /help; this drives the
 * autocomplete dropdown that makes them discoverable as you type.
 *
 * IMPORTANT: this source is embedded inside chat-html.js's template literal —
 * keep it free of backticks and `${` sequences.
 */
(function (global) {
  // Menu source: [command, one-line help]. /resume is an alias of /sessions,
  // so it is intentionally omitted. Kept in sync with chat-html's SLASH map.
  var SLASH_COMMANDS = [
    ["/new", "start a new conversation"],
    ["/sessions", "resume a saved session"],
    ["/plan", "enter plan mode"],
    ["/approve", "approve the current plan"],
    ["/reject", "reject the current plan"],
    ["/auto", "auto-accept file edits"],
    ["/bypass", "bypass all approvals"],
    ["/normal", "normal approvals (default)"],
    ["/think", "extended thinking on (Anthropic)"],
    ["/ultrathink", "extended thinking, max budget"],
    ["/think-off", "extended thinking off"],
    ["/stop", "interrupt the running turn"],
    ["/compact", "compact the conversation history"],
    ["/cost", "token cost for this session"],
    ["/context", "context-window usage"],
    ["/rewind", "restore a checkpoint"],
    ["/retry", "regenerate the last prompt"],
    ["/handoff", "hand off to a background agent (web/mobile)"],
    ["/review", "review the current git diff"],
    ["/help", "list panel commands"],
  ];

  /**
   * Detect an in-progress slash command: the WHOLE input so far is `/` + word
   * chars at the start of the line, no space yet. "/co" → { prefix:"co" },
   * "/cost x" → null (already a full command with an arg), "hi /x" → null.
   */
  function detectSlashToken(textBeforeCaret) {
    var s = String(textBeforeCaret == null ? "" : textBeforeCaret);
    var m = /^\s*\/([a-z]*)$/i.exec(s);
    return m ? { prefix: m[1].toLowerCase() } : null;
  }

  /**
   * Commands whose name (sans "/") starts with the typed prefix; empty prefix
   * matches all. Returns [command, desc] rows in menu order.
   */
  function filterSlashCommands(prefix) {
    var q = String(prefix == null ? "" : prefix).toLowerCase();
    return SLASH_COMMANDS.filter(function (row) {
      return row[0].slice(1).indexOf(q) === 0;
    });
  }

  var api = {
    SLASH_COMMANDS: SLASH_COMMANDS,
    detectSlashToken: detectSlashToken,
    filterSlashCommands: filterSlashCommands,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.ccSlash = api;
})(typeof window !== "undefined" ? window : globalThis);
