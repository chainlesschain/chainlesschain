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
  #plan { display:none; margin:6px; padding:8px; border:1px solid var(--vscode-panel-border);
          border-radius:4px; background: var(--vscode-editorWidget-background); }
  #plan h4 { margin:0 0 6px 0; font-size:.95em; }
  #plan ul { margin:0 0 8px 0; padding-left:18px; }
  #plan li { margin:2px 0; font-size:.92em; }
  #plan .impact-high { color: var(--vscode-errorForeground); }
  #plan .impact-medium { color: var(--vscode-editorWarning-foreground, orange); }
  #plan .actions { display:flex; gap:6px; }
  .approval { margin:6px 0; padding:8px; border:1px solid var(--vscode-editorWarning-foreground, orange);
              border-radius:4px; }
  .approval .q { margin-bottom:6px; font-family: var(--vscode-editor-font-family); font-size:.92em; }
  .approval .risk-high { color: var(--vscode-errorForeground); font-weight:bold; }
  .approval .buttons { display:flex; gap:6px; }
  .approval.done { opacity:.65; border-color: var(--vscode-panel-border); }
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
  <div id="plan">
    <h4>Plan <span id="planState"></span></h4>
    <ul id="planItems"></ul>
    <div class="actions">
      <button id="planApprove">Approve &amp; run</button>
      <button id="planReject" class="secondary">Reject</button>
    </div>
  </div>
  <div id="status">not started — send a message to launch cc agent</div>
  <div id="bar">
    <textarea id="input" placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send">Send</button>
    <button id="plan-toggle" class="secondary" title="Plan first: write tools blocked until you approve">Plan</button>
    <button id="stop" class="secondary" title="Interrupt the current turn (conversation keeps going; Esc works too)">Stop</button>
    <button id="new" class="secondary" title="Start a fresh conversation (kills the agent process)">New</button>
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

  // Panel slash commands — local sugar over the existing controls.
  const SLASH = {
    "/sessions": () => vscode.postMessage({ type: "pickSession" }),
    "/resume": () => vscode.postMessage({ type: "pickSession" }),
    "/new": () => vscode.postMessage({ type: "new" }),
    "/plan": () => vscode.postMessage({ type: "plan", action: "enter" }),
    "/approve": () => vscode.postMessage({ type: "plan", action: "approve" }),
    "/reject": () => vscode.postMessage({ type: "plan", action: "reject" }),
    "/stop": () => vscode.postMessage({ type: "interrupt" }),
  };
  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      input.value = "";
      if (cmd === "/help") {
        add("info", "panel commands: /new · /sessions (/resume) · /plan · /approve · /reject · /stop · /help");
        return;
      }
      if (SLASH[cmd]) {
        add("info", cmd);
        SLASH[cmd]();
        return;
      }
      add("info", "unknown command " + cmd + " — try /help");
      return;
    }
    add("user", text);
    streamEl = null;
    vscode.postMessage({ type: "send", text });
    input.value = "";
    status.textContent = "thinking…";
  }
  document.getElementById("send").addEventListener("click", send);
  document.getElementById("stop").addEventListener("click", () => {
    vscode.postMessage({ type: "interrupt" });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") vscode.postMessage({ type: "interrupt" });
  });
  document.getElementById("new").addEventListener("click", () => {
    vscode.postMessage({ type: "new" });
  });
  const planBox = document.getElementById("plan");
  const planItems = document.getElementById("planItems");
  const planState = document.getElementById("planState");
  document.getElementById("plan-toggle").addEventListener("click", () => {
    vscode.postMessage({ type: "plan", action: "enter" });
    add("info", "plan mode: write tools blocked — describe the task, then Approve");
  });
  document.getElementById("planApprove").addEventListener("click", () => {
    vscode.postMessage({ type: "plan", action: "approve" });
  });
  document.getElementById("planReject").addEventListener("click", () => {
    vscode.postMessage({ type: "plan", action: "reject" });
  });
  function renderPlan(m) {
    if (!m.active) {
      planBox.style.display = "none";
      if (m.state === "rejected") add("info", "plan rejected — plan mode off");
      return;
    }
    planBox.style.display = "block";
    planState.textContent = "· " + (m.state || "analyzing") +
      (m.risk ? " · risk " + m.risk.level : "");
    planItems.textContent = "";
    if (!m.items.length) {
      const li = document.createElement("li");
      li.className = "info";
      li.textContent = "(no items yet — the agent's blocked actions appear here)";
      planItems.appendChild(li);
    }
    for (const it of m.items) {
      const li = document.createElement("li");
      li.className = "impact-" + (it.impact || "low");
      li.textContent = (it.tool ? it.tool + ": " : "") + (it.title || "");
      planItems.appendChild(li);
    }
    if (m.state === "approved") {
      planBox.style.display = "none";
      add("info", "plan approved — executing " + m.items.length + " items");
    }
  }
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
      case "approval": {
        streamEl = null;
        const card = document.createElement("div");
        card.className = "approval";
        card.id = "appr-" + m.id;
        const q = document.createElement("div");
        q.className = "q" + (m.risk === "high" ? " risk-high" : "");
        // NOTE: this whole page is built inside a template literal — escape
        // sequences like \\n must be DOUBLE-escaped or they break the
        // generated script (a raw newline inside a string literal).
        q.textContent = "⚠ " + (m.tool || "tool") +
          (m.command ? ": " + m.command : "") +
          (m.risk ? "  [" + m.risk + "]" : "") +
          (m.reason ? "\\n" + m.reason : "");
        const btns = document.createElement("div");
        btns.className = "buttons";
        const yes = document.createElement("button");
        yes.textContent = "Approve";
        const no = document.createElement("button");
        no.textContent = "Deny";
        no.className = "secondary";
        const answer = (approve) => {
          vscode.postMessage({ type: "approval", id: m.id, approve });
          yes.disabled = no.disabled = true;
        };
        yes.addEventListener("click", () => answer(true));
        no.addEventListener("click", () => answer(false));
        btns.appendChild(yes); btns.appendChild(no);
        card.appendChild(q); card.appendChild(btns);
        log.appendChild(card);
        log.scrollTop = log.scrollHeight;
        break;
      }
      case "approval_done": {
        const card = document.getElementById("appr-" + m.id);
        if (card) {
          card.className = "approval done";
          const note = document.createElement("div");
          note.className = "info";
          note.textContent = (m.approved ? "✓ approved" : "✗ denied") +
            (m.via && m.via.indexOf("user") !== 0 ? " (" + m.via + ")" : "");
          card.appendChild(note);
          for (const b of card.querySelectorAll("button")) b.disabled = true;
        }
        break;
      }
      case "plan":
        renderPlan(m);
        break;
      case "reset":
        log.textContent = "";
        streamEl = null;
        planBox.style.display = "none";
        status.textContent = "new conversation — send a message to start";
        break;
    }
  });
</script>
</body>
</html>`;
}

module.exports = { buildChatHtml };
