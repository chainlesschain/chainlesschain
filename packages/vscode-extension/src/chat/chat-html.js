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
const SLASH_SOURCE = fs.readFileSync(
  path.join(__dirname, "slash-commands.js"),
  "utf8",
);
const ELICITATION_SCHEMA_SOURCE = fs.readFileSync(
  path.join(__dirname, "../vendor/elicitation-schema/index.js"),
  "utf8",
);
const ELICITATION_FORM_SOURCE = fs.readFileSync(
  path.join(__dirname, "elicitation-form.js"),
  "utf8",
);

// Bump whenever an older retained Webview DOM is not safe to keep talking to
// the current Extension Host. VS Code can preserve that DOM across an
// Extension Host restart when retainContextWhenHidden is enabled, so this is
// an explicit UI/Host handshake rather than relying on the extension version.
const CHAT_UI_PROTOCOL_VERSION = 2;
const TRANSCRIPT_ENTRY_MAX_CHARS = 200_000;

function migrateBootstrapLastSent(lastSentByTab, activeTabId, nextActiveTabId) {
  if (!lastSentByTab || activeTabId || !nextActiveTabId || !lastSentByTab._) {
    return false;
  }
  if (!lastSentByTab[nextActiveTabId]) {
    lastSentByTab[nextActiveTabId] = lastSentByTab._;
  }
  delete lastSentByTab._;
  return true;
}

function trimOldestLogNodes(container, maxNodes) {
  const cap = Number.isSafeInteger(maxNodes) && maxNodes >= 0 ? maxNodes : 0;
  let removed = 0;
  while (container.childElementCount > cap && container.firstChild) {
    container.removeChild(container.firstChild);
    removed += 1;
  }
  return removed;
}

/**
 * Append text to a bounded transcript entry without retaining its omitted
 * middle. The visible marker makes truncation explicit while preserving both
 * the beginning and the most recent tail of a large diff/log/answer.
 */
function appendBoundedTranscriptText(previous, value, maxChars = 200_000) {
  const cap = Number.isSafeInteger(maxChars) && maxChars >= 0 ? maxChars : 0;
  const chunk = String(value ?? "");
  const prior =
    previous &&
    typeof previous === "object" &&
    Number.isSafeInteger(previous.totalChars) &&
    previous.totalChars >= 0
      ? previous
      : {
          prefix: "",
          suffix: "",
          totalChars: 0,
          truncated: false,
        };
  const priorFull = prior.truncated
    ? String(prior.prefix || "") + String(prior.suffix || "")
    : String(prior.prefix || "");
  const totalChars = prior.totalChars + chunk.length;

  if (!prior.truncated && totalChars <= cap) {
    const text = priorFull + chunk;
    return {
      prefix: text,
      suffix: "",
      totalChars,
      truncated: false,
      text,
    };
  }

  const markerFor = (omitted) =>
    `\n\n… [${omitted} characters omitted from oversized transcript entry] …\n\n`;
  let omittedChars = Math.max(0, totalChars - cap);
  let marker = markerFor(omittedChars);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const dataBudget = Math.max(0, cap - marker.length);
    omittedChars = Math.max(0, totalChars - dataBudget);
    marker = markerFor(omittedChars);
  }
  if (marker.length >= cap) {
    const text = marker.slice(0, cap);
    return {
      prefix: "",
      suffix: "",
      totalChars,
      truncated: true,
      text,
    };
  }

  const dataBudget = cap - marker.length;
  const headBudget = Math.ceil(dataBudget / 2);
  const tailBudget = dataBudget - headBudget;
  const oldHead = prior.truncated ? String(prior.prefix || "") : priorFull;
  const oldTail = prior.truncated ? String(prior.suffix || "") : priorFull;
  const prefix =
    oldHead.length >= headBudget
      ? oldHead.slice(0, headBudget)
      : oldHead + chunk.slice(0, headBudget - oldHead.length);
  const suffix =
    chunk.length >= tailBudget
      ? chunk.slice(chunk.length - tailBudget)
      : oldTail.slice(-(tailBudget - chunk.length)) + chunk;
  const text = prefix + marker + suffix;
  return {
    prefix,
    suffix,
    totalChars,
    truncated: true,
    text,
  };
}

function formatTranscriptAnnouncement(
  kind,
  value,
  turnNumber = 0,
  maxChars = 4_000,
) {
  const labels = {
    assistant: "Assistant response",
    permission: "Permission request",
    error: "Tool error",
    status: "Status",
  };
  const label = labels[kind];
  if (!label) return "";
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const cap = Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : 4_000;
  const prefix =
    Number.isSafeInteger(turnNumber) && turnNumber > 0
      ? "Turn " + turnNumber + ", "
      : "";
  const lead = prefix + label + ": ";
  const budget = Math.max(0, cap - lead.length);
  const body =
    normalized.length > budget
      ? normalized.slice(0, Math.max(0, budget - 1)) + "…"
      : normalized;
  return (lead + body).slice(0, cap);
}

function buildChatHtml({ cspSource, nonce, l10n, hostDomToken = null }) {
  const safeHostDomToken =
    typeof hostDomToken === "string" && /^[a-f0-9]{64}$/u.test(hostDomToken)
      ? hostDomToken
      : "";
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
  :focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
             overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .turn-heading { margin:10px 0 2px; font-size:.82em; font-weight:600; opacity:.72; }
  #log { flex:1; overflow-y:auto; padding:8px; }
  .msg { margin:6px 0; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
  .thinking { opacity:.6; font-size:.92em;
              border-left:2px solid var(--vscode-panel-border); padding-left:8px; }
  .thinking > summary { cursor:pointer; font-style:italic; list-style:none; user-select:none; }
  .thinking > summary::-webkit-details-marker { display:none; }
  .thinking > summary::before { content:"💭 ▸ "; }
  .thinking[open] > summary::before { content:"💭 ▾ "; }
  .thinking .tbody { font-style:italic; white-space:pre-wrap; margin-top:2px; }
  .user { color: var(--vscode-textLink-foreground); }
  .user::before { content:"❯ "; opacity:.7; }
  .assistant { }
  .assistant pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15));
                   padding:6px 8px; border-radius:4px; overflow-x:auto; margin:4px 0; position:relative; }
  .assistant code { font-family: var(--vscode-editor-font-family); font-size:.95em; }
  .assistant pre .codebar { position:absolute; top:4px; right:4px; display:flex; gap:4px;
                   opacity:0; transition:opacity .12s; }
  .assistant pre:hover .codebar, .assistant pre .codebar:focus-within { opacity:.85; }
  .assistant pre .codebar:hover { opacity:1; }
  .assistant pre .codebar button { font-size:.78em;
                   padding:1px 6px; line-height:1.4; cursor:pointer;
                   border:1px solid var(--vscode-panel-border); border-radius:3px;
                   background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
                   color: var(--vscode-button-secondaryForeground, inherit); }
  .assistant table { border-collapse:collapse; margin:4px 0; }
  .assistant th, .assistant td { border:1px solid var(--vscode-panel-border);
                                 padding:2px 8px; font-size:.95em; }
  .assistant th { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); }
  .tool { opacity:.75; font-family: var(--vscode-editor-font-family); font-size:.92em; }
  .tool.err { color: var(--vscode-errorForeground); }
  .info { opacity:.6; font-style:italic; font-size:.92em; }
  .mono { font-family: var(--vscode-editor-font-family); font-size:.88em; opacity:.85; }
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
  .elicitation-field { display:flex; flex-direction:column; gap:3px; margin:8px 0; }
  .elicitation-field > label { font-weight:600; }
  .elicitation-description { opacity:.7; font-size:.88em; }
  .elicitation-multi { display:flex; flex-direction:column; gap:3px; }
  .elicitation-error { color:var(--vscode-errorForeground); font-size:.88em; }
  .elicitation-error[hidden] { display:none; }
  #bar { display:flex; gap:4px; padding:6px; border-top:1px solid var(--vscode-panel-border); }
  #input { flex:1; resize:none; min-height:34px; max-height:120px;
           background: var(--vscode-input-background); color: var(--vscode-input-foreground);
           border:1px solid var(--vscode-input-border, transparent); border-radius:3px; padding:6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; border-radius:3px; padding:4px 10px; cursor:pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  #status { padding:2px 8px; font-size:.85em; opacity:.6; }
  #ctxbar { padding:1px 8px 3px; font-size:.78em; opacity:.5;
            font-family: var(--vscode-editor-font-family); }
  #ctxbar:empty { display:none; }
  #ctxbar.warn { opacity:.95; color: var(--vscode-errorForeground); }
  #tabs { display:flex; align-items:center; gap:2px; padding:2px 4px; overflow-x:auto;
          border-bottom:1px solid var(--vscode-panel-border); }
  #tabs:empty { display:none; }
  #tabs .tabwrap { display:flex; align-items:center; max-width:180px; }
  #tabs .tab { display:flex; align-items:center; gap:4px; padding:2px 6px; max-width:160px;
               border:1px solid transparent; border-radius:4px 4px 0 0; cursor:pointer;
               white-space:nowrap; font-size:.88em; background:none; color:inherit; }
  #tabs .tab .t { overflow:hidden; text-overflow:ellipsis; max-width:120px; }
  #tabs .tab .dot { color: var(--vscode-charts-green, #3fb950); font-size:.7em; line-height:1; }
  #tabs .tab .dot.approval { color: var(--vscode-charts-blue, #3794ff); }
  #tabs .tab.unread .t { font-weight:600; }
  #tabs .tab.active { background: var(--vscode-tab-activeBackground, var(--vscode-editorWidget-background));
                      border-color: var(--vscode-panel-border); }
  #tabs .tabwrap .x { opacity:.55; border:none; background:none; color:inherit; cursor:pointer;
                  padding:0 2px; font-size:1em; line-height:1; }
  #tabs .tabwrap .x:hover { opacity:1; }
  #tabs .newtab { border:none; background:none; color:inherit; cursor:pointer; padding:2px 6px;
                  font-size:1.15em; line-height:1; opacity:.7; }
  #tabs .newtab:hover { opacity:1; }
  #suggest { display:none; margin:0 6px; border:1px solid var(--vscode-panel-border);
             border-bottom:none; border-radius:4px 4px 0 0; max-height:160px; overflow-y:auto;
             background: var(--vscode-editorWidget-background); font-size:.92em; }
  #suggest .item { padding:3px 8px; cursor:pointer; font-family: var(--vscode-editor-font-family);
                   white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #suggest .item.sel { background: var(--vscode-list-activeSelectionBackground);
                       color: var(--vscode-list-activeSelectionForeground); }
  #suggest .item .desc { opacity:.65; font-size:.92em; }
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
<script nonce="${nonce}">${SLASH_SOURCE}</script>
<script nonce="${nonce}">${ELICITATION_SCHEMA_SOURCE}</script>
<script nonce="${nonce}">${ELICITATION_FORM_SOURCE}</script>
  <div id="tabs" role="tablist" aria-label="Conversation tabs"></div>
  <div id="log" role="region"
        aria-label="Conversation transcript" aria-busy="false" tabindex="0"></div>
  <div id="announcer" class="sr-only" role="status" aria-live="polite"
       aria-atomic="true" aria-label="Conversation announcements"></div>
  <div id="plan" role="region" aria-labelledby="planHeading">
    <h4 id="planHeading">Plan <span id="planState"></span></h4>
    <ul id="planItems"></ul>
    <div class="actions">
      <button id="planApprove">Approve &amp; run</button>
      <button id="planReject" class="secondary">Reject</button>
    </div>
  </div>
  <div id="status" aria-label="Agent status">not started — send a message to launch cc agent</div>
  <div id="ctxbar" role="status" aria-live="polite" aria-atomic="true" aria-label="Context window"></div>
  <div id="attach" role="status" aria-live="polite" aria-label="Attachments"></div>
  <div id="suggest" role="listbox" aria-label="Composer suggestions"></div>
  <div id="bar">
    <label class="sr-only" for="input">Message the agent</label>
    <textarea id="input" aria-label="Message the agent" aria-controls="suggest"
              aria-autocomplete="list" aria-expanded="false"
              placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send">Send</button>
    <button id="plan-toggle" class="secondary" title="Plan first: write tools blocked until you approve">Plan</button>
    <button id="stop" class="secondary" title="Interrupt the current turn (conversation keeps going; Esc works too)">Stop</button>
    <button id="new" class="secondary" title="Start a fresh conversation (kills the agent process)">New</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const CC_CHAT_UI_PROTOCOL_VERSION = ${CHAT_UI_PROTOCOL_VERSION};
  const CC_HOST_DOM_TOKEN = ${JSON.stringify(safeHostDomToken)};
  const CC_L10N = ${JSON.stringify(l10n || {})};
  const log = document.getElementById("log");
  const announcer = document.getElementById("announcer");
  const input = document.getElementById("input");
  const status = document.getElementById("status");
  const ctxbar = document.getElementById("ctxbar");
  const tabsEl = document.getElementById("tabs");
  let streamEl = null; // the assistant block currently receiving deltas
  let streamRaw = ""; // its raw markdown, re-rendered (coalesced) on deltas
  let streamTextState = null; // bounded head/tail + full logical char count
  let streamFrame = null; // pending requestAnimationFrame id for a deferred render
  let thinkingEl = null; // <details> reasoning block for this turn (extended thinking)
  let thinkingBody = null; // the body inside it where deltas are appended
  let thinkingTextState = null; // bounded reasoning block state
  const lastSentByTab = {}; // per-tab last user prompt, for /retry (regenerate)
  const tabKey = () => activeTabId || "_"; // stable key before the first tab bar
  ${formatTranscriptAnnouncement.toString()}
  const turnStateByTab = {};
  const seenAnnouncementKeys = new Set();
  const announcementQueue = [];
  let announcementTimer = null;
  let headingSerial = 0;
  function currentTurnState() {
    const key = tabKey();
    if (!turnStateByTab[key]) {
      turnStateByTab[key] = { number: 0, assistantHeading: false };
    }
    return turnStateByTab[key];
  }
  function addTurnHeading(label) {
    const state = currentTurnState();
    const heading = document.createElement("h3");
    heading.id = "cc-turn-heading-" + (++headingSerial);
    heading.className = "turn-heading";
    heading.tabIndex = -1;
    heading.textContent = "Turn " + state.number + ", " + label;
    log.appendChild(heading);
    trimLog();
    return heading;
  }
  function beginTurn() {
    const state = currentTurnState();
    state.number += 1;
    state.assistantHeading = false;
    addTurnHeading("User message");
  }
  function ensureAssistantHeading() {
    const state = currentTurnState();
    if (state.number === 0) state.number = 1;
    if (state.assistantHeading) return;
    state.assistantHeading = true;
    addTurnHeading("Assistant response");
  }
  function drainAnnouncementQueue() {
    if (announcementTimer !== null || announcementQueue.length === 0) return;
    const next = announcementQueue.shift();
    announcer.textContent = next.text;
    announcementTimer = setTimeout(() => {
      announcer.textContent = "";
      announcementTimer = null;
      drainAnnouncementQueue();
    }, 120);
  }
  function announceTranscript(kind, text, eventKey) {
    const state = currentTurnState();
    const formatted = formatTranscriptAnnouncement(kind, text, state.number);
    if (!formatted) return false;
    const key = tabKey() + "|" + (eventKey || formatted);
    if (seenAnnouncementKeys.has(key)) return false;
    seenAnnouncementKeys.add(key);
    if (seenAnnouncementKeys.size > 256) {
      seenAnnouncementKeys.delete(seenAnnouncementKeys.values().next().value);
    }
    if (announcementQueue.length >= 32) {
      if (kind === "status") return false;
      const statusIndex = announcementQueue.findIndex((entry) => entry.kind === "status");
      if (statusIndex >= 0) announcementQueue.splice(statusIndex, 1);
      else announcementQueue.shift();
    }
    announcementQueue.push({ kind, text: formatted });
    drainAnnouncementQueue();
    return true;
  }
  function updateStatus(text, shouldAnnounce = true) {
    const next = String(text || "");
    if (status.textContent === next) return;
    status.textContent = next;
    if (shouldAnnounce) announceTranscript("status", next);
  }
  ${migrateBootstrapLastSent.toString()}
  let turnTokens = null; // live per-turn token tally from token_usage events
  const tokfmt = (n) =>
    n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
  // Cap the live transcript so a long session can't grow #log (and each tab's
  // detached buffer) without bound. The webview is purely a view — conversation
  // state for resume lives in the CLI — so dropping the oldest rendered nodes
  // only trims visual scrollback, mirroring Claude-Code 2.1.191 "reduced
  // long-session memory growth". add() always re-pins to the bottom, so trimming
  // the oldest (off-screen) nodes never shifts what the user is reading.
  const MAX_LOG_NODES = 800;
  const MAX_ENTRY_CHARS = ${TRANSCRIPT_ENTRY_MAX_CHARS};
  ${trimOldestLogNodes.toString()}
  ${appendBoundedTranscriptText.toString()}

  // Conversation tabs: each inactive tab's transcript is kept as DETACHED DOM
  // nodes (tabId -> Node[]), not an innerHTML string — detaching/re-appending
  // real nodes preserves their event listeners, so a pending approval card's
  // Approve/Deny buttons still work after you switch away and back. The host
  // gates background-tab streaming, so a buffer only changes while its tab is
  // active.
  const tabNodes = {};
  let activeTabId = null;

  // Move all of #log's children out into an array (detached, listeners intact).
  function detachLogNodes() {
    const nodes = [];
    while (log.firstChild) nodes.push(log.removeChild(log.firstChild));
    return nodes;
  }
  // Re-append previously-detached nodes back into #log.
  function attachLogNodes(nodes) {
    for (const n of nodes || []) log.appendChild(n);
  }

  function renderTabBar(tabs, activeId) {
    const previouslyFocusedTab = document.activeElement?.closest?.('[role="tab"]');
    const restoreTabFocus = Boolean(
      previouslyFocusedTab && tabsEl.contains(previouslyFocusedTab),
    );
    const previouslyFocusedTabId = restoreTabFocus
      ? previouslyFocusedTab.getAttribute("data-tab-id")
      : null;
    tabsEl.textContent = "";
    if (!Array.isArray(tabs) || tabs.length === 0) return;
    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
      const t = tabs[tabIndex];
      const wrap = document.createElement("span");
      wrap.className = "tabwrap";
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = "cc-chat-tab-" + tabIndex;
      tab.setAttribute("role", "tab");
      tab.setAttribute("data-tab-id", t.id);
      tab.setAttribute("aria-controls", "log");
      tab.setAttribute("aria-selected", t.id === activeId ? "true" : "false");
      tab.tabIndex = t.id === activeId ? 0 : -1;
      const flagged = t.needsApproval || t.unread;
      tab.className =
        "tab" +
        (t.id === activeId ? " active" : "") +
        (flagged ? " unread" : "");
      if (flagged && t.id !== activeId) {
        // Blue dot = an approval is pending (agent blocked on you); green dot =
        // a turn just finished in the background. Approval takes precedence.
        const dot = document.createElement("span");
        dot.className = "dot" + (t.needsApproval ? " approval" : "");
        dot.textContent = "●";
        dot.setAttribute("aria-hidden", "true");
        dot.title = t.needsApproval
          ? "this tab is waiting for your approval"
          : "a turn finished in this tab while it was in the background";
        tab.appendChild(dot);
      }
      const label = document.createElement("span");
      label.className = "t";
      label.textContent = t.title || t.id;
      tab.appendChild(label);
      tab.setAttribute(
        "aria-label",
        (t.title || t.id) +
          (t.needsApproval
            ? ", waiting for approval"
            : t.unread
              ? ", unread response"
              : ""),
      );
      tab.addEventListener("click", () => {
        if (t.id !== activeId) vscode.postMessage({ type: "switchTab", id: t.id });
      });
      tab.addEventListener("keydown", (e) => {
        const tabButtons = Array.from(tabsEl.querySelectorAll('[role="tab"]'));
        const current = tabButtons.indexOf(tab);
        let next = current;
        if (e.key === "ArrowRight") next = (current + 1) % tabButtons.length;
        else if (e.key === "ArrowLeft") next = (current - 1 + tabButtons.length) % tabButtons.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabButtons.length - 1;
        else if (e.key === "Delete" && tabs.length > 1) {
          e.preventDefault();
          vscode.postMessage({ type: "closeTab", id: t.id });
          return;
        } else return;
        e.preventDefault();
        tabButtons[next].focus();
      });
      wrap.appendChild(tab);
      if (tabs.length > 1) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "x";
        x.textContent = "×"; // ×
        x.title = "Close conversation";
        x.setAttribute("aria-label", "Close " + (t.title || "conversation"));
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "closeTab", id: t.id });
        });
        wrap.appendChild(x);
      }
      tabsEl.appendChild(wrap);
    }
    const plus = document.createElement("button");
    plus.className = "newtab";
    plus.textContent = "+";
    plus.title = "New conversation tab";
    plus.setAttribute("aria-label", "New conversation");
    plus.addEventListener("click", () => vscode.postMessage({ type: "newTab" }));
    tabsEl.appendChild(plus);
    if (restoreTabFocus) {
      const escapedTabId = CSS.escape(String(previouslyFocusedTabId || ""));
      const target =
        tabsEl.querySelector('[data-tab-id="' + escapedTabId + '"]') ||
        tabsEl.querySelector('[role="tab"][aria-selected="true"]');
      target?.focus();
    }
  }

  // Drop the oldest top-level nodes once #log exceeds the cap. The active stream
  // block and any pending approval/question card are always the NEWEST nodes, so
  // removing from the front never touches live/interactive content.
  function trimLog() {
    return trimOldestLogNodes(log, MAX_LOG_NODES);
  }
  function add(cls, text) {
    const el = document.createElement("div");
    el.className = "msg " + cls;
    el.setAttribute("role", "article");
    const accessibleLabels = {
      user: "User message",
      assistant: "Assistant response",
      tool: "Tool activity",
      error: "Error",
      info: "Status message",
      "tool err": "Tool error",
    };
    if (accessibleLabels[cls]) {
      const turn = currentTurnState().number;
      el.setAttribute(
        "aria-label",
        (turn > 0 ? "Turn " + turn + ", " : "") + accessibleLabels[cls],
      );
    }
    const bounded = appendBoundedTranscriptText(null, text, MAX_ENTRY_CHARS);
    el.textContent = bounded.text;
    if (bounded.truncated) el.dataset.truncated = "true";
    log.appendChild(el);
    trimLog(); // bound long-session memory (keep the most recent MAX_LOG_NODES)
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function ensureStream() {
    if (!streamEl) {
      ensureAssistantHeading();
      streamEl = add("assistant", "");
      streamEl.setAttribute("aria-busy", "true");
      streamRaw = "";
      streamTextState = null;
    }
    return streamEl;
  }
  // Coalesce streaming deltas. Each token re-parses the WHOLE growing markdown
  // string (mdLite) and replaces innerHTML — O(n²) work + a DOM reflow per
  // token, which pins CPU on fast streams. Instead, accumulate raw text
  // synchronously and render at most once per animation frame (~60fps),
  // mirroring Claude-Code 2.1.191 "reduced CPU during streaming via text update
  // coalescing". flushStream() forces a synchronous render so a block is fully
  // rendered before it is closed; cancelStreamFrame() drops a pending render
  // when the block is being discarded (reset / tab switch).
  function renderStreamNow() {
    if (!streamEl) return;
    streamEl.innerHTML = mdLite(streamRaw); // whitelist renderer, XSS-safe
    decorateCodeBlocks(streamEl); // Copy buttons on fenced blocks (DOM-level)
    log.scrollTop = log.scrollHeight;
  }
  function scheduleStreamRender() {
    if (streamFrame !== null) return;
    streamFrame = requestAnimationFrame(() => {
      streamFrame = null;
      renderStreamNow();
    });
  }
  function cancelStreamFrame() {
    if (streamFrame !== null) {
      cancelAnimationFrame(streamFrame);
      streamFrame = null;
    }
  }
  function flushStream() {
    cancelStreamFrame();
    renderStreamNow();
  }
  // Collapsible reasoning block for extended thinking. A native <details> —
  // expanded while it streams, click the summary to collapse; auto-collapsed
  // when the action/answer arrives (see the tool/turn_end cases). Returns the
  // body element where deltas are appended.
  function ensureThinking() {
    if (!thinkingBody) {
      const details = document.createElement("details");
      details.className = "msg thinking";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "thinking";
      details.appendChild(summary);
      const body = document.createElement("div");
      body.className = "tbody";
      details.appendChild(body);
      log.appendChild(details);
      log.scrollTop = log.scrollHeight;
      thinkingEl = details;
      thinkingBody = body;
      thinkingTextState = null;
    }
    return thinkingBody;
  }
  // Tuck a finished reasoning block away (collapse) and drop the refs so the
  // next reasoning starts a fresh block.
  function closeThinking() {
    if (thinkingEl) thinkingEl.open = false;
    thinkingEl = null;
    thinkingBody = null;
    thinkingTextState = null;
  }
  // Expand/collapse ALL reasoning blocks at once (Claude-Code Ctrl+O parity,
  // also the /expand panel command). If anything is collapsed, reveal all;
  // otherwise tuck them all away. No-op when there are no reasoning blocks.
  function toggleAllThinking() {
    const blocks = log.querySelectorAll("details.thinking");
    if (!blocks.length) return;
    let anyClosed = false;
    blocks.forEach((d) => { if (!d.open) anyClosed = true; });
    blocks.forEach((d) => { d.open = anyClosed; });
  }
  // Add Insert + Copy buttons to each fenced code block (Claude-Code /
  // Copilot-Chat panel parity). Runs at the DOM level after mdLite renders, so
  // md-lite stays a pure escape-first string renderer (no button markup in its
  // whitelist). Idempotent — re-decorating a streaming block skips <pre>s
  // already given a button bar.
  function decorateCodeBlocks(container) {
    if (!container || !container.querySelectorAll) return;
    const pres = container.querySelectorAll("pre");
    for (const pre of pres) {
      if (pre.dataset && pre.dataset.cc) continue; // already decorated
      if (pre.dataset) pre.dataset.cc = "1";
      // read the <code> child so the buttons' own text is never included
      const codeText = () => {
        const code = pre.querySelector("code");
        return (code ? code.textContent : pre.textContent) || "";
      };
      const bar = document.createElement("span");
      bar.className = "codebar";
      const mkBtn = (label, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        const flash = (t) => {
          b.textContent = t;
          setTimeout(() => { b.textContent = label; }, 1200);
        };
        b.flash = flash;
        bar.appendChild(b);
        return b;
      };
      // Insert at cursor: the host splices the snippet into the active editor
      // (replacing a non-empty selection) — no full agent edit turn needed.
      const ins = mkBtn("Insert", "Insert at cursor in the active editor");
      ins.addEventListener("click", () => {
        vscode.postMessage({ type: "insertCode", code: codeText() });
        ins.flash("Sent");
      });
      const cp = mkBtn("Copy", "Copy code");
      cp.addEventListener("click", () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(codeText()).then(
            () => cp.flash("Copied"),
            () => cp.flash("Failed"),
          );
        } else {
          cp.flash("Copied"); // best-effort in restricted webviews
        }
      });
      pre.appendChild(bar);
    }
  }

  // Commands requiring DOM state stay local. Everything else is resolved from
  // ccSlash.COMMAND_DEFS, the same manifest that drives completion and /help.
  const LOCAL_SLASH = {
    "/retry": () => {
      // Regenerate: re-send THIS tab's last user prompt as a fresh turn (a
      // single global would replay another tab's prompt after a switch).
      const lt = lastSentByTab[tabKey()];
      if (lt) { input.value = lt; send(); }
      else { add("info", "nothing to retry yet — send a message first"); }
    },
    "/review": () => {
      // Seed a review turn: the agent inspects the working-tree diff using its
      // tools + THIS window's IDE context (selection/diagnostics ride along).
      input.value =
        "Review my current uncommitted git changes. Run git diff (and " +
        "git diff --staged) to see them, then flag correctness bugs first and " +
        "simplifications/cleanups second. Cite file:line and be concise. " +
        "Don't edit files unless I ask.";
      send();
    },
    "/expand": () => {
      // Expand/collapse all reasoning blocks (also Ctrl/Cmd+O).
      if (log.querySelector("details.thinking")) toggleAllThinking();
      else add("info", "no reasoning blocks to expand yet");
    },
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
  // Shared by paste + drag-drop: read an image blob as a data URL and stage it.
  function addImageBlob(blob) {
    if (!blob || pendingImages.length >= 4) return;
    const fr = new FileReader();
    fr.onload = () => { pendingImages.push({ data: fr.result }); renderAttach(); };
    fr.readAsDataURL(blob);
  }
  input.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.indexOf("image/") === 0 && pendingImages.length < 4) {
        e.preventDefault();
        addImageBlob(it.getAsFile());
      }
    }
  });
  // Drag-drop image files into the input (parity with paste). Only intercept
  // image drags — non-image drops fall through so VS Code can still open files.
  function dragHasImage(dt) {
    const items = (dt && dt.items) || [];
    for (const it of items) {
      if (it.kind === "file" && it.type && it.type.indexOf("image/") === 0) return true;
    }
    return false;
  }
  input.addEventListener("dragover", (e) => {
    if (!dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  input.addEventListener("drop", (e) => {
    if (!dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    const files = (e.dataTransfer && e.dataTransfer.files) || [];
    for (const f of files) {
      if (f.type && f.type.indexOf("image/") === 0) addImageBlob(f);
    }
  });
  function send() {
    // Clicking the blue Send button must mirror Enter while the slash menu is
    // open. Previously Enter accepted the highlighted /status suggestion,
    // but Send submitted the still-partial /sta text and reported it as an
    // unknown command without ever reaching the Extension Host or cc.
    if (sug.mode === "slash" && sug.items.length) acceptSug();
    const text = input.value.trim();
    if (!text && !pendingImages.length) return;
    if (text.startsWith("/")) {
      const cmd = text.split(/\\s+/)[0].toLowerCase();
      input.value = "";
      if (text === "/") {
        add("info", "type / followed by a command, or choose one from the suggestions");
        input.focus();
        return;
      }
      const route = ccSlash.routeSlashCommand(
        cmd,
        text.slice(cmd.length).trim(),
      );
      if (route) {
        if (route.kind === "help") {
          add("info", ccSlash.formatSlashHelp());
          return;
        }
        add("info", cmd);
        if (route.kind === "local") {
          const local = LOCAL_SLASH[route.command];
          if (local) local(route.args);
          else add("info", "command is unavailable in this panel: " + cmd);
        } else if (route.kind === "message") {
          vscode.postMessage(route.message);
        }
        return;
      }
      // Let the trusted Extension Host resolve partial or visually-normalized
      // tokens against the manifest. It alone decides whether a fallback is
      // safe to dispatch; the Webview must not guess or execute arbitrary input.
      vscode.postMessage({
        type: "slashCommandFallback",
        command: cmd,
        args: text.slice(cmd.length).trim(),
      });
      return;
    }
    const images = pendingImages;
    pendingImages = [];
    renderAttach();
    lastSentByTab[tabKey()] = text; // remember for /retry (per this tab)
    beginTurn();
    add("user", text + (images.length ? " [📷×" + images.length + "]" : ""));
    streamEl = null;
    log.setAttribute("aria-busy", "true");
    vscode.postMessage(
      images.length ? { type: "send", text, images } : { type: "send", text },
    );
    input.value = "";
    turnTokens = null; // fresh tally for the new turn
    updateStatus("thinking…");
    // Arm the send-acknowledgement timeout: if no event arrives within 30
    // seconds, the agent likely failed to start (wrong cc binary, spawn error,
    // or C compiler waiting on stdin). The user gets a visible error instead of
    // an eternal "thinking…" spinner.
    clearSendTimer();
    sendTimer = setTimeout(() => {
      sendTimer = null;
      log.setAttribute("aria-busy", "false");
      updateStatus("no response");
      add("error",
        "No response from the agent after 30s. The cc CLI may not be installed " +
        "(npm i -g chainlesschain), or 'cc' on your PATH may be a different " +
        "tool (e.g., a C compiler). Check the Output panel (ChainlessChain) " +
        "for details, or set chainlesschain.cli.path in settings."
      );
    }, 30000);
  }
  document.getElementById("send").addEventListener("click", send);
  document.getElementById("stop").addEventListener("click", () => {
    vscode.postMessage({ type: "interrupt" });
  });
  // Track IME composition so Esc dismissing a CJK candidate window does NOT
  // also cancel the running turn (Claude Code 2.1.178 fixed the same bug).
  // event.isComposing / keyCode 229 on the cancelling keydown is unreliable
  // across Electron builds, so we also keep our own flag from composition events.
  let imeComposing = false;
  input.addEventListener("compositionstart", () => { imeComposing = true; });
  input.addEventListener("compositionend", () => { imeComposing = false; });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Esc while composing belongs to the IME (closes the candidate window).
    if (imeComposing || e.isComposing || e.keyCode === 229) return;
    vscode.postMessage({ type: "interrupt" });
  });
  // Send timeout guard: if no response event arrives within 30 seconds after
  // sending, surface a diagnostic error so the user isn't left on "thinking…"
  // forever (e.g., spawn failed, wrong cc binary, or C compiler hung on stdin).
  let sendTimer = null;
  function clearSendTimer() {
    if (sendTimer !== null) { clearTimeout(sendTimer); sendTimer = null; }
  }
  // Reset the send timer on any incoming event that proves the agent is alive.
  function acceptAgentSignal() { clearSendTimer(); }

  // Ctrl/Cmd+O — expand/collapse all reasoning blocks (Claude-Code parity).
  // Only swallow the key when there is something to toggle, so the IDE's own
  // Ctrl+O (Open File) still works in an empty transcript.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key !== "o" && e.key !== "O") return;
    if (!log.querySelector("details.thinking")) return;
    e.preventDefault();
    toggleAllThinking();
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
  // Shared completion dropdown. mode "file" → @-mention items (from the host);
  // mode "slash" → local /command items [label, desc]. sug.at holds the active
  // @-token (file mode only).
  let sug = { mode: null, at: null, items: [], sel: 0 };
  function hideSug() {
    sug = { mode: null, at: null, items: [], sel: 0 };
    suggest.style.display = "none";
    suggest.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function renderSug() {
    suggest.textContent = "";
    if (!sug.mode || !sug.items.length) { hideSug(); return; }
    sug.items.forEach((f, i) => {
      const row = document.createElement("div");
      row.id = "cc-chat-suggestion-" + i;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === sug.sel ? "true" : "false");
      row.className = "item" + (i === sug.sel ? " sel" : "");
      if (sug.mode === "slash") {
        const name = document.createElement("span");
        name.textContent = f[0];
        const desc = document.createElement("span");
        desc.className = "desc";
        desc.textContent = " — " + f[1];
        row.appendChild(name);
        row.appendChild(desc);
      } else {
        row.textContent = ccAtMention.mentionLabel(f);
      }
      row.addEventListener("mousedown", (e) => { e.preventDefault(); acceptSug(i); });
      suggest.appendChild(row);
    });
    suggest.style.display = "block";
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", "cc-chat-suggestion-" + sug.sel);
  }
  function showSlashSug(prefix) {
    const items = ccSlash.filterSlashCommands(prefix);
    if (!items.length) { hideSug(); return; }
    sug = { mode: "slash", at: null, items, sel: 0 };
    renderSug();
  }
  function acceptSug(i) {
    const idx = i == null ? sug.sel : i;
    if (sug.mode === "slash") {
      // Fill the command text (no auto-send — Enter runs it, like typing it).
      const cmd = sug.items[idx] && sug.items[idx][0];
      if (cmd) { input.value = cmd; input.setSelectionRange(cmd.length, cmd.length); }
      hideSug();
      input.focus();
      return;
    }
    const item = sug.items[idx];
    const value = ccAtMention.mentionValue(item);
    if (!value || !sug.at) { hideSug(); return; }
    const r = ccAtMention.applyMention(input.value, sug.at, value, input.selectionStart);
    input.value = r.text;
    input.setSelectionRange(r.caret, r.caret);
    hideSug();
    input.focus();
  }
  input.addEventListener("input", () => {
    const before = input.value.slice(0, input.selectionStart);
    const at = ccAtMention.detectAtToken(before);
    if (at) {
      sug.mode = "file";
      sug.at = at;
      vscode.postMessage({ type: "files", prefix: at.prefix });
      return;
    }
    const sl = ccSlash.detectSlashToken(before);
    if (sl) { showSlashSug(sl.prefix); return; }
    hideSug();
  });
  input.addEventListener("keydown", (e) => {
    if (sug.mode && sug.items.length) {
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
    // Enter confirming an IME candidate must NOT submit a half-composed message.
    if (
      e.key === "Enter" && !e.shiftKey &&
      !imeComposing && !e.isComposing && e.keyCode !== 229
    ) { e.preventDefault(); send(); }
  });

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (
      m.kind === "hostDomCommand" &&
      CC_HOST_DOM_TOKEN &&
      m.token === CC_HOST_DOM_TOKEN &&
      /^[a-f0-9]{32}$/.test(String(m.requestId || ""))
    ) {
      const respond = (ok, value) => vscode.postMessage({
        type: "hostDomResult",
        token: CC_HOST_DOM_TOKEN,
        requestId: m.requestId,
        ok,
        ...(ok ? { result: value } : { error: String(value || "host DOM command failed") }),
      });
      try {
        const command = m.command || {};
        if (command.action === "snapshot") {
          const plan = document.getElementById("plan");
          const approvalCards = [...document.querySelectorAll('.approval[id^="appr-"]')];
          const approval = approvalCards[approvalCards.length - 1] || null;
          const approvalButton = approval
            ? [...approval.querySelectorAll("button")].find(
                (button) => button.textContent.trim() === "Approve" && !button.disabled,
              ) || null
            : null;
          respond(true, {
            readyState: document.readyState,
            title: document.title,
            url: location.href,
            text: document.body ? document.body.innerText : "",
            inputPresent: Boolean(input),
            sendEnabled: Boolean(document.getElementById("send") && !document.getElementById("send").disabled),
            stopEnabled: Boolean(document.getElementById("stop") && !document.getElementById("stop").disabled),
            planVisible: Boolean(plan && getComputedStyle(plan).display !== "none"),
            planApproveEnabled: Boolean(document.getElementById("planApprove") && !document.getElementById("planApprove").disabled),
            approvalApproveEnabled: Boolean(approvalButton),
          });
          return;
        }
        if (command.action === "send" && typeof command.text === "string" && command.text.length <= 512) {
          const button = document.getElementById("send");
          if (!input || !button || button.disabled) throw new Error("composer is unavailable");
          input.value = command.text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          button.click();
          respond(true, { sent: true });
          return;
        }
        if (command.action === "click") {
          let button = null;
          if (command.target === "planApprove") button = document.getElementById("planApprove");
          if (command.target === "stop") button = document.getElementById("stop");
          if (command.target === "latestApprovalApprove") {
            const cards = [...document.querySelectorAll('.approval[id^="appr-"]')];
            const card = cards[cards.length - 1] || null;
            button = card
              ? [...card.querySelectorAll("button")].find(
                  (candidate) => candidate.textContent.trim() === "Approve" && !candidate.disabled,
                ) || null
              : null;
          }
          if (!button || button.disabled) throw new Error("control is unavailable: " + String(command.target));
          button.click();
          respond(true, { clicked: command.target });
          return;
        }
        throw new Error("unsupported host DOM action: " + String(command.action));
      } catch (error) {
        respond(false, error && error.message ? error.message : error);
      }
      return;
    }
    // The Extension Host may have restarted while VS Code retained this DOM.
    // Answer its probe so it can distinguish this UI from an older script.
    if (m.kind === "protocolProbe") {
      vscode.postMessage({
        type: "protocol",
        uiProtocolVersion: CC_CHAT_UI_PROTOCOL_VERSION,
      });
      return;
    }
    // Any event from the host proves the agent (or at least the extension)
    // is alive — cancel the send timeout so "thinking…" doesn't fire a
    // false positive when the agent is merely slow. This must run before the
    // switch: the default branch only handles unknown kinds, not every case.
    acceptAgentSignal();
    switch (m.kind) {
      default:
        break;
      case "init":
        updateStatus(m.model ? (m.provider + " · " + m.model) : "connected");
        break;
      case "delta": {
        ensureStream();
        streamTextState = appendBoundedTranscriptText(
          streamTextState,
          m.text,
          MAX_ENTRY_CHARS,
        );
        streamRaw = streamTextState.text;
        if (streamTextState.truncated) streamEl.dataset.truncated = "true";
        scheduleStreamRender(); // coalesced: render at most once per frame
        break;
      }
      case "thinking": {
        // Extended-thinking reasoning (when /think is on) — plain dimmed text,
        // separate from the answer; not run through the markdown renderer.
        const el = ensureThinking();
        thinkingTextState = appendBoundedTranscriptText(
          thinkingTextState,
          m.text,
          MAX_ENTRY_CHARS,
        );
        el.textContent = thinkingTextState.text;
        if (thinkingTextState.truncated) el.dataset.truncated = "true";
        log.scrollTop = log.scrollHeight;
        break;
      }
      case "tool":
        ensureAssistantHeading();
        flushStream(); // finalize streamed text before the tool block lands below it
        streamEl = null;
        closeThinking(); // collapse the reasoning that led to this action
        add("tool", "▸ " + m.tool + (m.summary ? " " + m.summary : ""));
        break;
      case "tool_done":
        if (m.isError) {
          const toolError = "✗ " + m.tool + " failed";
          add("tool err", toolError);
          announceTranscript("error", toolError, "tool-error:" + currentTurnState().number + ":" + m.tool);
        }
        else if (m.note) add("info", "ℹ " + m.tool + ": " + m.note);
        if (m.permissionDecision && m.permissionDecision.decision !== "allow") {
          const d = m.permissionDecision;
          add(
            "info",
            "Permission " +
              (d.decision || "decision") +
              (d.via ? " via " + d.via : "") +
              (d.reason ? ": " + d.reason : d.rule ? ": " + d.rule : ""),
          );
        }
        break;
      case "question": {
        // The agent is BLOCKED on ask_user_question. Render an in-panel card with
        // clickable options (single → buttons, multi → checkboxes + submit) or a
        // text input — and reply {type:"answer",id,answer} (null = Skip).
        flushStream(); // finalize any streamed text before the question card
        streamEl = null;
        const existing = document.getElementById("q-" + m.id);
        if (existing) {
          existing.scrollIntoView({ block: "nearest" });
          break;
        }
        const card = document.createElement("div");
        card.className = "approval"; // reuse the card styling
        card.id = "q-" + m.id;
        const q = document.createElement("div");
        q.className = "q";
        q.textContent = "❓ " + (m.question || "(question)");
         card.appendChild(q);
         if (m.elicitation && m.server) {
           const server = document.createElement("div");
           server.className = "info";
           server.textContent = "Server: " + m.server;
           card.appendChild(server);
         }
         const opts = Array.isArray(m.options) ? m.options : [];
        const labelOf = (o) => (typeof o === "string" ? o : (o && o.label != null ? String(o.label) : String(o)));
        const reply = (answer) => {
          vscode.postMessage({
            type: "answer",
            id: m.id,
            answer,
            ...(m.binding && typeof m.binding === "object"
              ? { binding: m.binding }
              : {}),
          });
          for (const b of card.querySelectorAll("button,input")) b.disabled = true;
          const note = document.createElement("div");
          note.className = "info";
          note.textContent = answer == null ? "✗ skipped"
            : "✓ " + (Array.isArray(answer) ? answer.join(", ") : answer);
          card.appendChild(note);
          card.className = "approval done";
         };
         const btns = document.createElement("div");
         btns.className = "buttons";
         if (m.elicitation && m.mode === "url") {
           const host = document.createElement("div");
           host.className = "info";
           host.textContent = "Destination host: " + (m.urlHost || "(unknown)");
           card.appendChild(host);
           const target = document.createElement("code");
           target.textContent = m.url || "";
           target.style.overflowWrap = "anywhere";
           card.appendChild(target);
           const open = document.createElement("button");
           open.textContent = "Open secure page";
           open.addEventListener("click", () => {
             vscode.postMessage({
               type: "openElicitationUrl",
               id: m.id,
               url: m.url,
               ...(m.binding && typeof m.binding === "object"
                 ? { binding: m.binding }
                 : {}),
             });
             for (const b of card.querySelectorAll("button,input")) b.disabled = true;
             const note = document.createElement("div");
             note.className = "info";
             note.textContent = "Opening the reviewed URL…";
             card.appendChild(note);
           });
           btns.appendChild(open);
           const skipUrl = document.createElement("button");
           skipUrl.textContent = "Skip";
           skipUrl.className = "secondary";
           skipUrl.addEventListener("click", () => reply(null));
           btns.appendChild(skipUrl);
           card.appendChild(btns);
           log.appendChild(card);
           log.scrollTop = log.scrollHeight;
           break;
         }
         const schema = m.elicitation && m.requestedSchema && typeof m.requestedSchema === "object"
           ? m.requestedSchema : null;
         const schemaForm = schema
           ? CcElicitationForm.renderElicitationForm({
               document,
               container: card,
               actions: btns,
               schema,
               onSubmit: reply,
             })
           : { rendered: false };
         if (schema && !schemaForm.rendered) {
           const warning = document.createElement("div");
           warning.className = "info";
           warning.textContent = "This schema is outside the supported MCP form vocabulary; enter a JSON object.";
           card.appendChild(warning);
         }
         if (schemaForm.rendered) {
           // The shared schema form populated the card and actions.
         } else if (opts.length && m.multiSelect === true) {
          const boxes = [];
          for (const o of opts) {
            const lbl = labelOf(o);
            const row = document.createElement("label");
            row.style.display = "block";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.value = lbl;
            boxes.push(cb);
            row.appendChild(cb);
            row.appendChild(document.createTextNode(" " + lbl));
            card.appendChild(row);
          }
          const submit = document.createElement("button");
          submit.textContent = "Submit";
          submit.addEventListener("click", () =>
            reply(boxes.filter((b) => b.checked).map((b) => b.value)));
          btns.appendChild(submit);
        } else if (opts.length) {
          for (const o of opts) {
            const lbl = labelOf(o);
            const b = document.createElement("button");
            b.textContent = lbl;
            b.addEventListener("click", () => reply(lbl));
            btns.appendChild(b);
          }
        } else {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.placeholder = schema
            ? "Enter a JSON object, Enter to send"
            : "Type your answer, Enter to send";
          inp.style.flex = "1";
          const submit = document.createElement("button");
          submit.textContent = "Send";
          const go = () => {
            if (!schema) {
              reply(inp.value);
              return;
            }
            try {
              const value = JSON.parse(inp.value);
              if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new Error("object required");
              }
              reply(value);
            } catch {
              const error = document.createElement("div");
              error.className = "elicitation-error";
              error.textContent = "Enter a valid JSON object.";
              card.appendChild(error);
            }
          };
          submit.addEventListener("click", go);
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
          btns.appendChild(inp); btns.appendChild(submit);
        }
        const skip = document.createElement("button");
        skip.textContent = "Skip";
        skip.className = "secondary";
        skip.addEventListener("click", () => reply(null));
        btns.appendChild(skip);
        card.appendChild(btns);
        log.appendChild(card);
        log.scrollTop = log.scrollHeight;
        break;
      }
      case "info":
        add("info", m.text);
        break;
      case "pre":
        // Host-side CLI commands such as /status and /doctor return plain text
        // instead of an agent turn. Render their output in the same transcript
        // so a successful command is never perceived as "no response".
        add("info", m.text || "(no output)");
        break;
      case "turn_end": {
        ensureAssistantHeading();
        const assistantAnnouncement = m.text || streamRaw;
        if (m.text) {
          if (m.isError) {
            add("error", m.text); // errors stay plain text
          } else {
            const el = add("assistant", "");
            const bounded = appendBoundedTranscriptText(
              null,
              m.text,
              MAX_ENTRY_CHARS,
            );
            el.innerHTML = mdLite(bounded.text);
            if (bounded.truncated) el.dataset.truncated = "true";
            decorateCodeBlocks(el);
          }
        }
        flushStream(); // ensure the last streamed tokens are rendered before close
        if (streamEl) streamEl.setAttribute("aria-busy", "false");
        streamEl = null;
        log.setAttribute("aria-busy", "false");
        closeThinking(); // tuck the reasoning away now that the answer is in
        if (assistantAnnouncement) {
          announceTranscript(
            m.isError ? "error" : "assistant",
            assistantAnnouncement,
            "turn-end:" + currentTurnState().number,
          );
        }
        updateStatus(m.usage
          ? "ready · " + tokfmt(m.usage.input_tokens||0) + "→" + tokfmt(m.usage.output_tokens||0) + " tokens"
          : "ready");
        turnTokens = null;
        break;
      }
      case "usage": {
        // Live per-turn token tally: token_usage fires once per LLM call while
        // the agent works; accumulate and show on the status line. turn_end
        // overwrites this with the authoritative turn total.
        const u = m.usage || {};
        if (!turnTokens) turnTokens = { inp: 0, out: 0, cached: 0 };
        turnTokens.inp += u.input_tokens || 0;
        turnTokens.out += u.output_tokens || 0;
        turnTokens.cached += u.cache_read_input_tokens || 0;
        status.textContent =
          "thinking… · " + tokfmt(turnTokens.inp) + "→" + tokfmt(turnTokens.out) +
          " tokens" +
          (turnTokens.cached ? " (" + tokfmt(turnTokens.cached) + " cached)" : "");
        break;
      }
      case "ctxStatus": {
        // Persistent context-window indicator (Claude-Code parity); refreshed
        // after each turn from cc context --json (authoritative window math).
        const kfmt = (n) =>
          n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
        ctxbar.textContent =
          "⊟ context " + kfmt(m.total) + " / " + kfmt(m.window) +
          " (" + m.pct + "%)" + (m.overflow ? " — over, compaction needed" : "");
        ctxbar.className = m.overflow ? "warn" : "";
        break;
      }
      case "error":
        add("error", m.text);
        announceTranscript("error", m.text, "error:" + currentTurnState().number + ":" + String(m.code || m.text));
        log.setAttribute("aria-busy", "false");
        updateStatus("error");
        break;
      case "exited":
        add("info", "agent exited (code " + m.code + ") — next message restarts it");
        log.setAttribute("aria-busy", "false");
        updateStatus("stopped");
        flushStream(); // render whatever streamed before the crash/exit
        streamEl = null;
        break;
      case "stderr":
        // tool trace / logs — keep the panel calm, only surface real errors
        if (/error/i.test(m.text)) add("info", m.text);
        break;
      case "approval": {
        flushStream(); // finalize any streamed text before the approval card
        streamEl = null;
        const existing = document.getElementById("appr-" + m.id);
        if (existing) {
          existing.scrollIntoView({ block: "nearest" });
          break;
        }
        const card = document.createElement("div");
        card.className = "approval";
        card.id = "appr-" + m.id;
        card.setAttribute("role", "group");
        const q = document.createElement("div");
        q.id = "appr-label-" + m.id;
        card.setAttribute("aria-labelledby", q.id);
        q.className = "q" + (m.risk === "high" ? " risk-high" : "");
        // NOTE: this whole page is built inside a template literal — escape
        // sequences like \\n must be DOUBLE-escaped or they break the
        // generated script (a raw newline inside a string literal).
        q.textContent = "⚠ " + (m.tool || "tool") +
          (m.command ? ": " + m.command : "") +
          (m.risk ? "  [" + m.risk + "]" : "") +
          (m.reason ? "\\n" + m.reason : "");
        announceTranscript("permission", q.textContent, "permission:" + m.id);
        const btns = document.createElement("div");
        btns.className = "buttons";
        const yes = document.createElement("button");
        yes.textContent = "Approve";
        const no = document.createElement("button");
        no.textContent = "Deny";
        no.className = "secondary";
        const answer = (approve) => {
          vscode.postMessage({
            type: "approval",
            id: m.id,
            approve,
            ...(typeof m.binding === "string" && m.binding
              ? { binding: m.binding }
              : {}),
          });
          yes.disabled = no.disabled = true;
          // A keyboard activation must not strand focus on a newly disabled
          // control while the host settles the approval asynchronously.
          input.focus();
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
        announceTranscript(
          "permission",
          (m.approved ? "approved" : "denied") +
            (m.via ? " via " + m.via : ""),
          "permission-done:" + m.id,
        );
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
          ? (CC_L10N.setupFailed || "LLM connection failed: {0}").replace("{0}", m.reason)
          : (CC_L10N.setupNoConfig || "No model configured yet");
        const btns = document.createElement("div");
        btns.className = "buttons";
        const go = document.createElement("button");
        go.textContent = CC_L10N.configureLlmBtn || "Configure LLM";
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
        sug.mode = "file";
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
      case "pre":
        // Monospaced block for /cost + /context output (.msg keeps newlines).
        add("mono", String(m.text || ""));
        break;
      case "reset":
        cancelStreamFrame(); // drop a pending render — the log is being cleared
        log.textContent = "";
        log.setAttribute("aria-busy", "false");
        if (activeTabId) tabNodes[activeTabId] = []; // forget this tab's transcript
        streamEl = null;
        streamTextState = null;
        thinkingEl = null;
        thinkingBody = null;
        thinkingTextState = null;
        planBox.style.display = "none";
        delete turnStateByTab[tabKey()];
        updateStatus("new conversation — send a message to start");
        ctxbar.textContent = ""; // drop the previous conversation's context line
        hideSug();
        pendingImages = [];
        renderAttach();
        break;
      case "tabs": {
        renderTabBar(m.tabs, m.activeId);
        if (m.activeId !== activeTabId) {
          // A fast first send can beat the initial tabs message. Preserve that
          // bootstrap prompt under the real tab id so /retry remains available.
          migrateBootstrapLastSent(lastSentByTab, activeTabId, m.activeId);
          // Save the outgoing tab's nodes (detached, listeners intact), restore
          // the incoming one's. Real DOM nodes (vs innerHTML) keep approval-card
          // button handlers alive across tab switches.
          if (activeTabId) tabNodes[activeTabId] = detachLogNodes();
          else detachLogNodes(); // no owner yet → drop the bootstrap nodes
          activeTabId = m.activeId;
          attachLogNodes(tabNodes[activeTabId]);
          cancelStreamFrame(); // drop the outgoing tab's pending render
          streamEl = null;
          streamRaw = "";
          streamTextState = null;
          // Also drop the reasoning block pointers — otherwise a mid-thinking
          // stream in the outgoing tab leaves thinkingBody pointing at its
          // detached node, and the incoming tab's reasoning appends into it.
          thinkingEl = null;
          thinkingBody = null;
          thinkingTextState = null;
          log.setAttribute("aria-busy", "false");
          planBox.style.display = "none";
          log.scrollTop = log.scrollHeight;
        }
        // Drop buffers for tabs that were closed.
        const live = new Set((m.tabs || []).map((t) => t.id));
        for (const k of Object.keys(tabNodes)) {
          if (!live.has(k)) delete tabNodes[k];
        }
        for (const k of Object.keys(lastSentByTab)) {
          if (k !== "_" && !live.has(k)) delete lastSentByTab[k];
        }
        for (const k of Object.keys(turnStateByTab)) {
          if (k !== "_" && !live.has(k)) delete turnStateByTab[k];
        }
        break;
      }
    }
  });
  // Signal the host the script is live so it can flush a queued insertText.
  vscode.postMessage({
    type: "ready",
    uiProtocolVersion: CC_CHAT_UI_PROTOCOL_VERSION,
  });
</script>
</body>
</html>`;
}

module.exports = {
  buildChatHtml,
  CHAT_UI_PROTOCOL_VERSION,
  TRANSCRIPT_ENTRY_MAX_CHARS,
  migrateBootstrapLastSent,
  appendBoundedTranscriptText,
  formatTranscriptAnnouncement,
  trimOldestLogNodes,
};
