/**
 * Self-contained HTML for the chat webview — vanilla JS, no framework, no
 * external resources (strict CSP, everything inline with a nonce). Renders
 * the UI-message vocabulary produced by chat-events.js and posts
 * {type:"send"|"stop"|"restart"} back to the extension.
 */
function buildChatHtml({ cspSource, nonce }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin:0; font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         display:flex; flex-direction:column; height:100vh; }
  #log { flex:1; overflow-y:auto; padding:8px; }
  .msg { margin:6px 0; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
  .user { color: var(--vscode-textLink-foreground); }
  .user::before { content:"❯ "; opacity:.7; }
  .assistant { }
  .tool { opacity:.75; font-family: var(--vscode-editor-font-family); font-size:.92em; }
  .tool.err { color: var(--vscode-errorForeground); }
  .info { opacity:.6; font-style:italic; font-size:.92em; }
  .error { color: var(--vscode-errorForeground); }
  #bar { display:flex; gap:4px; padding:6px; border-top:1px solid var(--vscode-panel-border); }
  #input { flex:1; resize:none; min-height:34px; max-height:120px;
           background: var(--vscode-input-background); color: var(--vscode-input-foreground);
           border:1px solid var(--vscode-input-border, transparent); border-radius:3px; padding:6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; border-radius:3px; padding:4px 10px; cursor:pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  #status { padding:2px 8px; font-size:.85em; opacity:.6; }
</style>
</head>
<body>
  <div id="log"></div>
  <div id="status">not started — send a message to launch cc agent</div>
  <div id="bar">
    <textarea id="input" placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send">Send</button>
    <button id="stop" class="secondary" title="Kill the agent process">Stop</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const input = document.getElementById("input");
  const status = document.getElementById("status");
  let streamEl = null; // the assistant block currently receiving deltas

  function add(cls, text) {
    const el = document.createElement("div");
    el.className = "msg " + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function ensureStream() {
    if (!streamEl) streamEl = add("assistant", "");
    return streamEl;
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    add("user", text);
    streamEl = null;
    vscode.postMessage({ type: "send", text });
    input.value = "";
    status.textContent = "thinking…";
  }
  document.getElementById("send").addEventListener("click", send);
  document.getElementById("stop").addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    switch (m.kind) {
      case "init":
        status.textContent = m.model ? (m.provider + " · " + m.model) : "connected";
        break;
      case "delta":
        ensureStream().textContent += m.text;
        log.scrollTop = log.scrollHeight;
        break;
      case "tool":
        streamEl = null;
        add("tool", "▸ " + m.tool + (m.summary ? " " + m.summary : ""));
        break;
      case "tool_done":
        if (m.isError) add("tool err", "✗ " + m.tool + " failed");
        break;
      case "info":
        add("info", m.text);
        break;
      case "turn_end":
        if (m.text) add(m.isError ? "error" : "assistant", m.text);
        streamEl = null;
        status.textContent = m.usage
          ? "ready · " + (m.usage.input_tokens||0) + "→" + (m.usage.output_tokens||0) + " tokens"
          : "ready";
        break;
      case "error":
        add("error", m.text);
        status.textContent = "error";
        break;
      case "exited":
        add("info", "agent exited (code " + m.code + ") — next message restarts it");
        status.textContent = "stopped";
        streamEl = null;
        break;
      case "stderr":
        // tool trace / logs — keep the panel calm, only surface real errors
        if (/error/i.test(m.text)) add("info", m.text);
        break;
    }
  });
</script>
</body>
</html>`;
}

module.exports = { buildChatHtml };
