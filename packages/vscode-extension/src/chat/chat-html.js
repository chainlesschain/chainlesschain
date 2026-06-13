/**
 * Self-contained HTML for the chat webview — vanilla JS, no framework, no
 * external resources (strict CSP, everything inline with a nonce). Renders
 * the UI-message vocabulary produced by chat-events.js and posts
 * {type:"send"|"stop"|"restart"} back to the extension.
 *
 * Assistant replies render through md-lite (whitelist markdown, XSS-safe by
 * construction); its source is embedded as a second nonce'd script — it is
 * written WITHOUT backticks so the template literal below stays intact.
 */
const fs = require("fs");
const path = require("path");
const MD_LITE_SOURCE = fs.readFileSync(
  path.join(__dirname, "md-lite.js"),
  "utf8",
);
const AT_MENTION_SOURCE = fs.readFileSync(
  path.join(__dirname, "at-mention.js"),
  "utf8",
);

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
  .assistant pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15));
                   padding:6px 8px; border-radius:4px; overflow-x:auto; margin:4px 0; }
  .assistant code { font-family: var(--vscode-editor-font-family); font-size:.95em; }
  .assistant table { border-collapse:collapse; margin:4px 0; }
  .assistant th, .assistant td { border:1px solid var(--vscode-panel-border);
                                 padding:2px 8px; font-size:.95em; }
  .assistant th { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); }
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
  #suggest { display:none; margin:0 6px; border:1px solid var(--vscode-panel-border);
             border-bottom:none; border-radius:4px 4px 0 0; max-height:160px; overflow-y:auto;
             background: var(--vscode-editorWidget-background); font-size:.92em; }
  #suggest .item { padding:3px 8px; cursor:pointer; font-family: var(--vscode-editor-font-family);
                   white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #suggest .item.sel { background: var(--vscode-list-activeSelectionBackground);
                       color: var(--vscode-list-activeSelectionForeground); }
  #attach { display:none; padding:2px 8px; font-size:.85em; }
  #attach .chip { display:inline-block; margin-right:6px; padding:1px 8px;
                  border:1px solid var(--vscode-panel-border); border-radius:10px; }
  #attach .chip button { background:none; border:none; color:inherit; padding:0 0 0 4px;
                         cursor:pointer; }
</style>
</head>
<body>
<script nonce="${nonce}">${MD_LITE_SOURCE}</script>
<script nonce="${nonce}">${AT_MENTION_SOURCE}</script>
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
  <div id="attach"></div>
  <div id="suggest"></div>
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
  let streamRaw = ""; // its raw markdown, re-rendered on every delta

  function add(cls, text) {
    const el = document.createElement("div");
    el.className = "msg " + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function ensureStream() {
    if (!streamEl) {
      streamEl = add("assistant", "");
      streamRaw = "";
    }
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
  // Pasted screenshots ride the message as data URLs; the host writes them
  // to temp files and the CLI attaches them like --image (vision model
  // required — configure llm.visionModel / chainlesschain.chat.model).
  const attach = document.getElementById("attach");
  let pendingImages = [];
  function renderAttach() {
    attach.textContent = "";
    if (!pendingImages.length) { attach.style.display = "none"; return; }
    pendingImages.forEach((img, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "📷 image " + (i + 1);
      const x = document.createElement("button");
      x.textContent = "×";
      x.title = "remove attachment";
      x.addEventListener("click", () => { pendingImages.splice(i, 1); renderAttach(); });
      chip.appendChild(x);
      attach.appendChild(chip);
    });
    attach.style.display = "block";
  }
  input.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.indexOf("image/") === 0 && pendingImages.length < 4) {
        e.preventDefault();
        const blob = it.getAsFile();
        if (!blob) continue;
        const fr = new FileReader();
        fr.onload = () => { pendingImages.push({ data: fr.result }); renderAttach(); };
        fr.readAsDataURL(blob);
      }
    }
  });
  function send() {
    const text = input.value.trim();
    if (!text && !pendingImages.length) return;
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
    const images = pendingImages;
    pendingImages = [];
    renderAttach();
    add("user", text + (images.length ? " [📷×" + images.length + "]" : ""));
    streamEl = null;
    vscode.postMessage(
      images.length ? { type: "send", text, images } : { type: "send", text },
    );
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
  // @file mention completion — the CLI expands @path refs server-side; this
  // dropdown only helps type them. State: sug.at is the active "@" token.
  const suggest = document.getElementById("suggest");
  let sug = { at: null, items: [], sel: 0 };
  function hideSug() {
    sug = { at: null, items: [], sel: 0 };
    suggest.style.display = "none";
    suggest.textContent = "";
  }
  function renderSug() {
    suggest.textContent = "";
    if (!sug.at || !sug.items.length) { suggest.style.display = "none"; return; }
    sug.items.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "item" + (i === sug.sel ? " sel" : "");
      row.textContent = f;
      row.addEventListener("mousedown", (e) => { e.preventDefault(); acceptSug(i); });
      suggest.appendChild(row);
    });
    suggest.style.display = "block";
  }
  function acceptSug(i) {
    const item = sug.items[i == null ? sug.sel : i];
    if (!item || !sug.at) { hideSug(); return; }
    const r = ccAtMention.applyMention(input.value, sug.at, item, input.selectionStart);
    input.value = r.text;
    input.setSelectionRange(r.caret, r.caret);
    hideSug();
    input.focus();
  }
  input.addEventListener("input", () => {
    const at = ccAtMention.detectAtToken(input.value.slice(0, input.selectionStart));
    if (at) {
      sug.at = at;
      vscode.postMessage({ type: "files", prefix: at.prefix });
    } else {
      hideSug();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (sug.at && sug.items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault(); sug.sel = (sug.sel + 1) % sug.items.length; renderSug(); return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault(); sug.sel = (sug.sel - 1 + sug.items.length) % sug.items.length; renderSug(); return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault(); acceptSug(); return;
      }
      if (e.key === "Escape") {
        // Close the dropdown only — must NOT fall through to the document
        // listener that interrupts the in-flight turn.
        e.preventDefault(); e.stopPropagation(); hideSug(); return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    switch (m.kind) {
      case "init":
        status.textContent = m.model ? (m.provider + " · " + m.model) : "connected";
        break;
      case "delta": {
        const el = ensureStream();
        streamRaw += m.text;
        el.innerHTML = mdLite(streamRaw); // whitelist renderer, XSS-safe
        log.scrollTop = log.scrollHeight;
        break;
      }
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
        if (m.text) {
          if (m.isError) {
            add("error", m.text); // errors stay plain text
          } else {
            add("assistant", "").innerHTML = mdLite(m.text);
          }
        }
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
      case "setup": {
        if (document.getElementById("setup-card")) break; // one card is enough
        const card = document.createElement("div");
        card.className = "approval";
        card.id = "setup-card";
        const q = document.createElement("div");
        q.className = "q";
        q.textContent = m.reason
          ? "LLM 连接失败:" + m.reason + " — 先完成大模型配置"
          : "还没有配置大模型 — 一分钟引导即可开聊(写入本机 config.json,CLI 与面板共用)";
        const btns = document.createElement("div");
        btns.className = "buttons";
        const go = document.createElement("button");
        go.textContent = "Configure LLM / 配置大模型";
        go.addEventListener("click", () => {
          vscode.postMessage({ type: "configureLlm" });
          card.remove();
        });
        btns.appendChild(go);
        card.appendChild(q); card.appendChild(btns);
        log.appendChild(card);
        log.scrollTop = log.scrollHeight;
        break;
      }
      case "files": {
        // Stale replies (user kept typing / closed the token) are dropped.
        const at = ccAtMention.detectAtToken(input.value.slice(0, input.selectionStart));
        if (!at || at.prefix !== m.prefix) break;
        sug.at = at;
        sug.items = Array.isArray(m.items) ? m.items : [];
        sug.sel = 0;
        renderSug();
        break;
      }
      case "insertText": {
        // "Insert File Reference" (Cmd/Ctrl+Alt+K): splice the @ref at the
        // caret and focus the input so the user can keep typing.
        const t = String(m.text || "");
        if (!t) break;
        const a = input.selectionStart != null ? input.selectionStart : input.value.length;
        const b = input.selectionEnd != null ? input.selectionEnd : a;
        input.value = input.value.slice(0, a) + t + input.value.slice(b);
        const caret = a + t.length;
        input.setSelectionRange(caret, caret);
        input.focus();
        break;
      }
      case "reset":
        log.textContent = "";
        streamEl = null;
        planBox.style.display = "none";
        status.textContent = "new conversation — send a message to start";
        hideSug();
        pendingImages = [];
        renderAttach();
        break;
    }
  });
  // Signal the host the script is live so it can flush a queued insertText.
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}

module.exports = { buildChatHtml };
