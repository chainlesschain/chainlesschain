/**
 * web-ui-server.js
 * Creates a lightweight HTTP server that serves the ChainlessChain Web UI.
 * The UI is a self-contained single-page app with an embedded WebSocket client.
 *
 * Usage:
 *   const server = createWebUIServer({ wsPort, wsToken, wsHost, projectRoot, projectName, mode, uiMode });
 *   server.listen(18810, '127.0.0.1');
 *
 * uiMode controls which front-end is served:
 *   - "auto"    (default): SPA if web-panel/dist exists, else embedded HTML
 *   - "full":   SPA only — throws if web-panel/dist is missing
 *   - "minimal": embedded HTML only, even if SPA is available
 *
 * `cc pack` artifacts always set uiMode="full" so the bundled exe never
 * silently degrades to the minimal HTML when assets failed to bundle.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getInlineSource as getEnvelopeInlineSource } from "./web-ui-envelope.js";
import { CLISkillLoader } from "./skill-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 产品版本标签统一从根 package.json 读取，避免多点漂移
const PRODUCT_VERSION = (() => {
  try {
    const pkgPath = path.resolve(__dirname, "../../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.productVersion || "vDev";
  } catch {
    return "vDev";
  }
})();

// MIME type map for static file serving
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

/**
 * Build the full HTML page with runtime config injected.
 *
 * @param {object} cfg
 * @param {number}  cfg.wsPort       - WebSocket server port
 * @param {string|null} cfg.wsToken  - Optional auth token
 * @param {string}  cfg.wsHost       - WebSocket server host (for browser)
 * @param {string|null} cfg.projectRoot  - Absolute project root path (null = global mode)
 * @param {string|null} cfg.projectName  - Human-readable project name
 * @param {"project"|"global"} cfg.mode  - UI mode
 * @returns {string} Full HTML document
 */
function buildHtml({
  wsPort,
  wsToken,
  wsHost,
  projectRoot,
  projectName,
  mode,
}) {
  // Escape <, > and & so the JSON is safe to embed directly inside a <script> tag.
  const cfg = JSON.stringify({
    wsPort,
    wsToken,
    wsHost,
    projectRoot,
    projectName,
    mode,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const title =
    mode === "project"
      ? `${projectName || "Project"} — ChainlessChain`
      : "ChainlessChain — Global";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script>window.__CC_CONFIG__ = ${cfg};</script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js" defer></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" defer></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-base:    #0f1117;
      --bg-sidebar: #161b22;
      --bg-panel:   #1c2128;
      --bg-input:   #21262d;
      --bg-bubble-user: #1f4e79;
      --bg-bubble-ai:   #1c2128;
      --border:     #30363d;
      --text:       #e6edf3;
      --text-dim:   #8b949e;
      --text-muted: #484f58;
      --accent:     #58a6ff;
      --accent-dim: #1f3a5f;
      --green:      #3fb950;
      --red:        #f85149;
      --yellow:     #d29922;
      --radius:     8px;
      --sidebar-w:  260px;
    }

    html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg-base); color: var(--text); font-size: 14px; line-height: 1.5; }

    /* ── Layout ─────────────────────────────────────────────────────── */
    #app { display: flex; height: 100vh; overflow: hidden; }

    /* ── Sidebar ────────────────────────────────────────────────────── */
    #sidebar {
      width: var(--sidebar-w);
      min-width: var(--sidebar-w);
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
    }

    #sidebar-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    #sidebar-logo .icon {
      width: 28px; height: 28px;
      background: var(--accent);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 700; color: #fff;
      flex-shrink: 0;
    }

    #sidebar-logo .brand { font-weight: 600; font-size: 15px; }

    #project-badge {
      background: var(--accent-dim);
      border: 1px solid var(--accent);
      border-radius: 5px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--accent);
      word-break: break-all;
    }

    #project-badge .proj-name { font-weight: 600; font-size: 13px; display: block; }
    #project-badge .proj-path { color: var(--text-dim); font-size: 11px; display: block; margin-top: 2px; word-break: break-all; }

    #global-badge {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--text-dim);
    }

    #btn-new-session {
      margin: 12px 16px 8px;
      width: calc(100% - 32px);
      padding: 8px 12px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex; align-items: center; gap: 6px; justify-content: center;
      transition: opacity 0.15s;
    }
    #btn-new-session:hover { opacity: 0.85; }

    #session-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 8px 8px;
    }

    #session-list::-webkit-scrollbar { width: 4px; }
    #session-list::-webkit-scrollbar-track { background: transparent; }
    #session-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .session-item {
      padding: 8px 10px;
      border-radius: var(--radius);
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 2px;
      transition: background 0.1s;
    }
    .session-item:hover { background: var(--bg-panel); }
    .session-item.active { background: var(--accent-dim); }

    .session-item .s-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
    .session-item .s-info { min-width: 0; }
    .session-item .s-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .session-item .s-meta { font-size: 11px; color: var(--text-dim); margin-top: 2px; }

    #sidebar-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    #conn-status { display: flex; align-items: center; gap: 5px; }
    #conn-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    #conn-dot.connected { background: var(--green); }
    #conn-dot.error { background: var(--red); }

    /* ── Main area ──────────────────────────────────────────────────── */
    #main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-base);
    }

    #chat-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-panel);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    #chat-title { font-size: 15px; font-weight: 600; }
    #chat-subtitle { font-size: 12px; color: var(--text-dim); margin-left: auto; }

    #session-type-tabs {
      display: flex;
      gap: 4px;
    }

    .tab-btn {
      padding: 4px 12px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-dim);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.1s;
    }
    .tab-btn:hover { background: var(--bg-input); color: var(--text); }
    .tab-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }

    /* ── Messages ───────────────────────────────────────────────────── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    #messages::-webkit-scrollbar { width: 6px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    .message { display: flex; gap: 10px; align-items: flex-start; max-width: 100%; }
    .message.user { flex-direction: row-reverse; }

    .msg-avatar {
      width: 30px; height: 30px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px;
    }
    .message.user .msg-avatar { background: var(--accent); color: #fff; }
    .message.ai .msg-avatar { background: var(--bg-panel); border: 1px solid var(--border); }
    .message.system .msg-avatar { background: var(--bg-panel); border: 1px solid var(--border); font-size: 12px; }

    .msg-bubble {
      max-width: calc(100% - 80px);
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.6;
      word-break: break-word;
    }

    .message.user .msg-bubble {
      background: var(--bg-bubble-user);
      border-radius: 12px 4px 12px 12px;
    }
    .message.ai .msg-bubble {
      background: var(--bg-bubble-ai);
      border: 1px solid var(--border);
      border-radius: 4px 12px 12px 12px;
    }
    .message.system .msg-bubble {
      background: transparent;
      border: 1px dashed var(--border);
      color: var(--text-dim);
      font-size: 12px;
      border-radius: var(--radius);
    }

    /* Markdown inside AI bubbles */
    .msg-bubble h1, .msg-bubble h2, .msg-bubble h3 { margin: 12px 0 6px; font-size: 1em; }
    .msg-bubble p { margin-bottom: 8px; }
    .msg-bubble p:last-child { margin-bottom: 0; }
    .msg-bubble ul, .msg-bubble ol { padding-left: 20px; margin-bottom: 8px; }
    .msg-bubble li { margin-bottom: 3px; }
    .msg-bubble pre { margin: 8px 0; border-radius: 6px; overflow: auto; }
    .msg-bubble pre code { font-size: 12px; }
    .msg-bubble code:not(pre code) { background: var(--bg-input); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    .msg-bubble blockquote { border-left: 3px solid var(--border); padding-left: 10px; color: var(--text-dim); margin: 8px 0; }
    .msg-bubble table { border-collapse: collapse; margin: 8px 0; width: 100%; }
    .msg-bubble th, .msg-bubble td { border: 1px solid var(--border); padding: 5px 10px; }
    .msg-bubble th { background: var(--bg-input); }
    .msg-bubble a { color: var(--accent); text-decoration: none; }
    .msg-bubble a:hover { text-decoration: underline; }

    .typing-indicator { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
    .typing-indicator span {
      width: 6px; height: 6px; border-radius: 50%; background: var(--text-dim);
      animation: blink 1.2s infinite;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes blink { 0%,80%,100% { opacity: 0.2; } 40% { opacity: 1; } }

    /* ── Input area ─────────────────────────────────────────────────── */
    #input-area {
      padding: 16px 20px;
      border-top: 1px solid var(--border);
      background: var(--bg-panel);
    }

    #input-row {
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }

    #msg-input {
      flex: 1;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 14px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
      resize: none;
      max-height: 150px;
      min-height: 42px;
      outline: none;
      transition: border-color 0.15s;
      line-height: 1.5;
    }
    #msg-input:focus { border-color: var(--accent); }
    #msg-input::placeholder { color: var(--text-muted); }

    #btn-send {
      padding: 10px 18px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius);
      font-size: 14px;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity 0.15s;
      height: 42px;
    }
    #btn-send:hover:not(:disabled) { opacity: 0.85; }
    #btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

    #input-hint { font-size: 11px; color: var(--text-muted); margin-top: 6px; }

    /* ── Empty state ────────────────────────────────────────────────── */
    #empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      color: var(--text-dim);
      padding: 40px;
      text-align: center;
    }
    #empty-state .es-icon { font-size: 48px; opacity: 0.5; }
    #empty-state h2 { font-size: 20px; color: var(--text); }
    #empty-state p { font-size: 14px; max-width: 320px; }

    /* ── Question dialog (slot-filling) ─────────────────────────────── */
    #question-overlay {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    #question-overlay.active { display: flex; }

    #question-box {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      width: 400px;
      max-width: 90vw;
    }
    #question-box h3 { font-size: 15px; margin-bottom: 12px; }
    #question-text { font-size: 14px; color: var(--text-dim); margin-bottom: 16px; }
    #question-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    #question-input-wrap { margin-bottom: 16px; }
    #question-input-wrap input {
      width: 100%; padding: 8px 12px;
      background: var(--bg-input); border: 1px solid var(--border);
      border-radius: var(--radius); color: var(--text); font-size: 14px; outline: none;
    }
    #question-input-wrap input:focus { border-color: var(--accent); }
    .q-option {
      padding: 8px 12px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 13px;
      color: var(--text);
      text-align: left;
      transition: border-color 0.1s;
    }
    .q-option:hover { border-color: var(--accent); }
    #btn-question-submit {
      width: 100%; padding: 9px;
      background: var(--accent); color: #fff;
      border: none; border-radius: var(--radius);
      font-size: 14px; cursor: pointer;
    }
    #btn-question-submit:hover { opacity: 0.85; }
  </style>
</head>
<body>
<div id="app">
  <!-- Sidebar -->
  <nav id="sidebar">
    <div id="sidebar-header">
      <div id="sidebar-logo">
        <div class="icon">C</div>
        <span class="brand">ChainlessChain</span>
      </div>
      <div id="mode-badge"></div>
    </div>

    <button id="btn-new-session">
      <span>＋</span> 新建会话
    </button>

    <div id="session-list"></div>

    <div id="sidebar-footer">
      <div id="conn-status">
        <div id="conn-dot"></div>
        <span id="conn-label">未连接</span>
      </div>
      <span id="version-label">${PRODUCT_VERSION}</span>
    </div>
  </nav>

  <!-- Main chat area -->
  <main id="main">
    <div id="chat-header">
      <span id="chat-title">欢迎</span>
      <div id="session-type-tabs">
        <button class="tab-btn active" data-type="agent">Agent</button>
        <button class="tab-btn" data-type="chat">Chat</button>
      </div>
      <span id="chat-subtitle"></span>
    </div>

    <div id="empty-state">
      <div class="es-icon">🤖</div>
      <h2>开始对话</h2>
      <p id="empty-desc"></p>
    </div>

    <div id="messages" style="display:none"></div>

    <div id="input-area">
      <div id="input-row">
        <textarea id="msg-input" rows="1" placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"></textarea>
        <button id="btn-send" disabled>发送</button>
      </div>
      <div id="input-hint">使用 /help 查看可用命令</div>
    </div>
  </main>
</div>

<!-- Question dialog -->
<div id="question-overlay">
  <div id="question-box">
    <h3>⚙️ 需要您输入</h3>
    <div id="question-text"></div>
    <div id="question-options"></div>
    <div id="question-input-wrap" style="display:none">
      <input id="question-input" type="text" placeholder="请输入...">
    </div>
    <button id="btn-question-submit">确认</button>
  </div>
</div>

<script>
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  const CFG = window.__CC_CONFIG__;
  const WS_URL = 'ws://' + CFG.wsHost + ':' + CFG.wsPort;

  // ── State ────────────────────────────────────────────────────────────────
  let ws = null;
  let wsReady = false;
  let currentSessionId = null;
  let streamingMsgId = null;
  let streamBuffer = '';
  let selectedSessionType = 'agent';
  let pendingQuestionResolve = null;
  let _msgId = 0;
  let _pendingMsgs = []; // buffered while session pending
  const sessions = new Map(); // id → { id, title, type, createdAt }

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const modeBadge = $('mode-badge');
  const sessionList = $('session-list');
  const btnNewSession = $('btn-new-session');
  const messages = $('messages');
  const emptyState = $('empty-state');
  const emptyDesc = $('empty-desc');
  const msgInput = $('msg-input');
  const btnSend = $('btn-send');
  const chatTitle = $('chat-title');
  const chatSubtitle = $('chat-subtitle');
  const connDot = $('conn-dot');
  const connLabel = $('conn-label');
  const questionOverlay = $('question-overlay');
  const questionText = $('question-text');
  const questionOptions = $('question-options');
  const questionInputWrap = $('question-input-wrap');
  const questionInputEl = $('question-input');
  const btnQuestionSubmit = $('btn-question-submit');
  const tabBtns = document.querySelectorAll('.tab-btn');

  // ── Init mode badge ──────────────────────────────────────────────────────
  if (CFG.mode === 'project') {
    modeBadge.innerHTML =
      '<div id="project-badge">' +
        '<span class="proj-name">' + esc(CFG.projectName || 'Project') + '</span>' +
        '<span class="proj-path">' + esc(CFG.projectRoot || '') + '</span>' +
      '</div>';
    emptyDesc.textContent = '当前已绑定项目 ' + (CFG.projectName || '') + '，AI 将结合项目上下文回答。';
  } else {
    modeBadge.innerHTML = '<div id="global-badge">🌐 全局模式</div>';
    emptyDesc.textContent = '全局模式：未绑定项目，可直接对话或管理项目。';
  }

  // ── marked.js config (deferred — called after defer scripts load) ────────
  function initMarked() {
    if (window.marked) {
      try {
        marked.setOptions({
          highlight: (code, lang) => {
            if (window.hljs && lang && hljs.getLanguage(lang)) {
              return hljs.highlight(code, { language: lang }).value;
            }
            return window.hljs ? hljs.highlightAuto(code).value : code;
          },
          breaks: true,
          gfm: true,
        });
      } catch (_) {
        // marked v10+ removed highlight option — ignore, fallback renderer handles it
      }
    }
  }

  // ── WebSocket ────────────────────────────────────────────────────────────
  function connect() {
    setConnStatus('connecting');
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      setConnStatus('error');
      return;
    }

    ws.onopen = () => {
      if (CFG.wsToken) {
        send({ type: 'auth', token: CFG.wsToken });
      } else {
        onAuthenticated();
      }
    };

    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    };

    ws.onclose = () => {
      wsReady = false;
      setConnStatus('disconnected');
      btnSend.disabled = true;
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setConnStatus('error');
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (!obj.id) { obj = Object.assign({ id: 'ui-' + (++_msgId) }, obj); }
      ws.send(JSON.stringify(obj));
    }
  }

  function onAuthenticated() {
    wsReady = true;
    setConnStatus('connected');
    btnSend.disabled = false;
    // Load session list
    send({ type: 'session-list' });
  }

  // Map unified envelope dot-case types back to legacy kebab-case so the
  // existing switch table below keeps working without per-case rewrites.
  // The CLI runtime wraps every coding-agent event in a v1.0 envelope.
  // Source of truth lives in lib/web-ui-envelope.js — inlined here at
  // build time so the browser bundle stays self-contained and the same
  // unwrap logic is unit-testable in Node.
  ${getEnvelopeInlineSource()}

  function handleMessage(rawMsg) {
    var msg = unwrapEnvelope(rawMsg);
    switch (msg.type) {
      case 'auth-result':
        if (msg.success) {
          onAuthenticated();
        } else {
          setConnStatus('error');
          addSystemMsg('认证失败：' + (msg.message || '无效的 token'));
        }
        break;

      case 'pong':
        break;

      case 'session-created':
        // Server sends { sessionId, sessionType }
        if (msg.sessionId) {
          sessions.set(msg.sessionId, {
            id: msg.sessionId,
            title: (msg.sessionType || 'agent') === 'agent' ? 'Agent 会话' : 'Chat 会话',
            type: msg.sessionType || 'agent',
            createdAt: Date.now(),
          });
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            updateChatHeader();
          }
        }
        break;

      case 'session-list-result':
        if (Array.isArray(msg.sessions)) {
          msg.sessions.forEach(s => {
            sessions.set(s.id, {
              id: s.id,
              title: s.title || '会话',
              type: s.type || 'agent',
              createdAt: s.createdAt || 0,
            });
          });
          renderSessionList();
        }
        break;

      // Streaming: chat handler emits response-token per token
      case 'response-token':
        if (msg.sessionId === currentSessionId) {
          if (!streamingMsgId) {
            hideTyping();
            streamBuffer = '';
            streamingMsgId = 'stream-' + Date.now();
            appendAiMsgStreaming(streamingMsgId);
          }
          streamBuffer += (msg.token || '');
          updateStreamingMsg(streamingMsgId, streamBuffer);
        }
        break;

      // Final response: both agent and chat handlers emit response-complete
      case 'response-complete':
        if (msg.sessionId === currentSessionId) {
          if (streamingMsgId) {
            finalizeStreamingMsg(streamingMsgId, streamBuffer || msg.content || '');
            streamingMsgId = null;
            streamBuffer = '';
          } else {
            // Agent mode: no token stream, show full response at once
            hideTyping();
            if (msg.content) appendAiMsg(msg.content);
          }
          maybeUpdateSessionTitle(currentSessionId);
        }
        break;

      // Agent tool events — show as system info
      case 'tool-executing':
        if (msg.sessionId === currentSessionId) {
          addSystemMsg('🔧 ' + (msg.display || msg.tool || '工具调用中...'));
        }
        break;

      case 'tool-result':
        // Silently consumed — agent will emit response-complete after
        break;

      case 'model-switch':
        if (msg.sessionId === currentSessionId) {
          addSystemMsg('🔄 模型切换: ' + msg.from + ' → ' + msg.to + ' (' + msg.reason + ')');
        }
        break;

      case 'command-response':
        if (msg.sessionId === currentSessionId) {
          addSystemMsg('✅ ' + JSON.stringify(msg.result || {}));
        }
        break;

      case 'error':
        hideTyping();
        if (msg.sessionId === currentSessionId || !msg.sessionId) {
          addSystemMsg('错误：' + (msg.message || msg.error || '未知错误'));
        }
        break;

      case 'question':
        // Interactive question from slot-filler or agent
        if (msg.sessionId === currentSessionId) {
          showQuestion(msg);
        }
        break;

      default:
        break;
    }
  }

  // ── Session management ───────────────────────────────────────────────────
  function createSession() {
    const tempId = 'pending-' + Date.now();
    currentSessionId = tempId;

    // Optimistically add to sidebar
    sessions.set(tempId, {
      id: tempId,
      title: selectedSessionType === 'agent' ? 'Agent 会话' : 'Chat 会话',
      type: selectedSessionType,
      createdAt: Date.now(),
      pending: true,
    });
    renderSessionList();
    showMessagesArea();
    updateChatHeader();

    send({
      type: 'session-create',
      sessionType: selectedSessionType,
      projectRoot: CFG.projectRoot || undefined,
    });

    // Listen for real session ID
    const origHandler = ws.onmessage;
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      // Unwrap unified envelopes so the type compare below still matches.
      msg = unwrapEnvelope(msg);
      if (msg.type === 'session-created' && msg.sessionId) {
        // Replace temp id
        sessions.delete(tempId);
        const realId = msg.sessionId;
        sessions.set(realId, {
          id: realId,
          title: selectedSessionType === 'agent' ? 'Agent 会话' : 'Chat 会话',
          type: msg.sessionType || selectedSessionType,
          createdAt: Date.now(),
        });
        if (currentSessionId === tempId) {
          currentSessionId = realId;
          updateChatHeader();
        }
        renderSessionList();
        ws.onmessage = origHandler;
        // Flush buffered messages sent while session was pending
        for (const pending of _pendingMsgs) {
          send({ type: 'session-message', sessionId: realId, content: pending });
        }
        _pendingMsgs = [];
        return;
      }
      // Pass through all other messages
      handleMessage(msg);
    };

    addSystemMsg(
      selectedSessionType === 'agent'
        ? '已创建 Agent 会话，可以开始对话。输入 /help 查看可用命令。'
        : '已创建 Chat 会话。'
    );
  }

  function switchSession(id) {
    if (currentSessionId === id) return;
    currentSessionId = id;
    renderSessionList();
    updateChatHeader();
    clearMessages();
    showMessagesArea();
    addSystemMsg('已切换到会话 ' + (sessions.get(id)?.title || id));
    // Reload session history
    send({ type: 'session-resume', sessionId: id });
  }

  function maybeUpdateSessionTitle(sessionId) {
    // Use first 30 chars of first user message as title (client-side only)
    const userMsgs = document.querySelectorAll('.message.user .msg-bubble');
    if (userMsgs.length > 0) {
      const raw = userMsgs[0].textContent.slice(0, 30).trim();
      const s = sessions.get(sessionId);
      if (s && (s.title === 'Agent 会话' || s.title === 'Chat 会话' || s.title === '新会话')) {
        s.title = raw + (raw.length >= 30 ? '…' : '');
        renderSessionList();
      }
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────────────
  function renderSessionList() {
    const sorted = [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
    sessionList.innerHTML = sorted.map(s => {
      const icon = s.type === 'agent' ? '🤖' : '💬';
      const active = s.id === currentSessionId ? ' active' : '';
      return '<div class="session-item' + active + '" data-id="' + esc(s.id) + '">' +
        '<span class="s-icon">' + icon + '</span>' +
        '<div class="s-info">' +
          '<div class="s-title">' + esc(s.title) + '</div>' +
          '<div class="s-meta">' + s.type + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    sessionList.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => switchSession(el.dataset.id));
    });
  }

  function updateChatHeader() {
    const s = sessions.get(currentSessionId);
    if (s) {
      chatTitle.textContent = s.title;
      chatSubtitle.textContent = s.type === 'agent' ? 'Agent 模式' : 'Chat 模式';
    } else {
      chatTitle.textContent = '新会话';
      chatSubtitle.textContent = '';
    }
  }

  function setConnStatus(state) {
    connDot.className = '';
    if (state === 'connected') {
      connDot.classList.add('connected');
      connLabel.textContent = '已连接';
    } else if (state === 'error') {
      connDot.classList.add('error');
      connLabel.textContent = '连接错误';
    } else if (state === 'connecting') {
      connLabel.textContent = '连接中...';
    } else {
      connLabel.textContent = '未连接';
    }
  }

  function showMessagesArea() {
    emptyState.style.display = 'none';
    messages.style.display = 'flex';
  }

  function clearMessages() {
    messages.innerHTML = '';
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  // ── Message rendering ────────────────────────────────────────────────────
  function appendUserMsg(text) {
    const el = document.createElement('div');
    el.className = 'message user';
    el.innerHTML =
      '<div class="msg-avatar">U</div>' +
      '<div class="msg-bubble">' + esc(text).split('\\n').join('<br>') + '</div>';
    messages.appendChild(el);
    scrollToBottom();
  }

  function appendAiMsg(text) {
    const el = document.createElement('div');
    el.className = 'message ai';
    el.innerHTML =
      '<div class="msg-avatar">🤖</div>' +
      '<div class="msg-bubble">' + renderMd(text) + '</div>';
    messages.appendChild(el);
    if (window.hljs) {
      el.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    }
    scrollToBottom();
  }

  function appendAiMsgStreaming(id) {
    const el = document.createElement('div');
    el.className = 'message ai';
    el.id = id;
    el.innerHTML =
      '<div class="msg-avatar">🤖</div>' +
      '<div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
    messages.appendChild(el);
    scrollToBottom();
  }

  function updateStreamingMsg(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.querySelector('.msg-bubble').innerHTML = renderMd(text);
      scrollToBottom();
    }
  }

  function finalizeStreamingMsg(id, text) {
    const el = document.getElementById(id);
    if (el) {
      const bubble = el.querySelector('.msg-bubble');
      bubble.innerHTML = renderMd(text);
      if (window.hljs) {
        bubble.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      }
      scrollToBottom();
    }
  }

  function addSystemMsg(text) {
    const el = document.createElement('div');
    el.className = 'message system';
    el.innerHTML =
      '<div class="msg-avatar">ℹ</div>' +
      '<div class="msg-bubble">' + esc(text) + '</div>';
    messages.appendChild(el);
    scrollToBottom();
  }

  function showTyping() {
    if (document.getElementById('typing-bubble')) return;
    const el = document.createElement('div');
    el.className = 'message ai';
    el.id = 'typing-bubble';
    el.innerHTML =
      '<div class="msg-avatar">🤖</div>' +
      '<div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
    messages.appendChild(el);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById('typing-bubble');
    if (el) el.remove();
  }

  // ── Sending messages ─────────────────────────────────────────────────────
  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !wsReady) return;
    if (!currentSessionId) { createSession(); }

    msgInput.value = '';
    msgInput.style.height = 'auto';
    btnSend.disabled = true;

    appendUserMsg(text);
    showMessagesArea();
    showTyping();

    // If session is still pending (not yet confirmed by server), buffer
    if (currentSessionId && currentSessionId.startsWith('pending-')) {
      _pendingMsgs.push(text);
      setTimeout(() => { btnSend.disabled = false; }, 500);
      return;
    }

    send({
      type: 'session-message',
      sessionId: currentSessionId,
      content: text,
    });

    // Re-enable after brief delay (server will stream back)
    setTimeout(() => { btnSend.disabled = false; }, 500);
  }

  // ── Question dialog ──────────────────────────────────────────────────────
  function showQuestion(msg) {
    questionText.textContent = msg.message || msg.question || '请输入：';
    questionOptions.innerHTML = '';
    questionInputEl.value = '';

    if (Array.isArray(msg.choices) && msg.choices.length > 0) {
      questionInputWrap.style.display = 'none';
      msg.choices.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'q-option';
        btn.textContent = c;
        btn.addEventListener('click', () => submitQuestion(c, msg.requestId));
        questionOptions.appendChild(btn);
      });
    } else {
      questionInputWrap.style.display = 'block';
    }

    pendingQuestionResolve = { requestId: msg.requestId };
    questionOverlay.classList.add('active');
    questionInputEl.focus();
  }

  function submitQuestion(value, requestId) {
    questionOverlay.classList.remove('active');
    pendingQuestionResolve = null;
    send({
      type: 'session-answer',
      sessionId: currentSessionId,
      requestId: requestId,
      answer: value,
    });
  }

  // ── Event listeners ──────────────────────────────────────────────────────
  btnNewSession.addEventListener('click', () => {
    clearMessages();
    currentSessionId = null;
    createSession();
  });

  btnSend.addEventListener('click', sendMessage);

  msgInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });

  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 150) + 'px';
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSessionType = btn.dataset.type;
    });
  });

  btnQuestionSubmit.addEventListener('click', () => {
    if (pendingQuestionResolve) {
      submitQuestion(questionInputEl.value, pendingQuestionResolve.requestId);
    }
  });

  questionInputEl.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && pendingQuestionResolve) {
      submitQuestion(questionInputEl.value, pendingQuestionResolve.requestId);
    }
  });

  // ── Utility ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMd(text) {
    if (window.marked) {
      try { return marked.parse(text); } catch (_) { /* fall through */ }
    }
    return esc(text).split('\\n').join('<br>');
  }

  // ── Start ────────────────────────────────────────────────────────────────
  // Connect immediately — do NOT wait for defer scripts (marked/hljs)
  connect();
  // Init marked after defer scripts finish loading
  window.addEventListener('load', initMarked);
})();
</script>
</body>
</html>`;
}

/**
 * Escape HTML special characters (server-side, for injecting into attributes/text).
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the runtime config JSON string, safe for embedding in a <script> tag.
 */
function buildConfigJson(opts) {
  return JSON.stringify({
    wsPort: opts.wsPort,
    wsToken: opts.wsToken,
    wsHost: opts.wsHost,
    projectRoot: opts.projectRoot,
    projectName: opts.projectName,
    mode: opts.mode,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Try to locate the built web-panel dist directory.
 * Returns the absolute path if found, or null.
 *
 * Search order:
 *   1. Explicit --web-panel-dir override
 *   2. packages/web-panel/dist/ (source tree / local dev)
 *   3. src/assets/web-panel/ inside the CLI package itself (bundled for npm users)
 */
function findWebPanelDist(staticDir) {
  if (staticDir) {
    return fs.existsSync(path.join(staticDir, "index.html")) ? staticDir : null;
  }
  // 1. Source tree: packages/web-panel/dist/
  const sourceDist = path.resolve(__dirname, "../../web-panel/dist");
  if (fs.existsSync(path.join(sourceDist, "index.html"))) {
    return sourceDist;
  }
  // 2. Bundled inside CLI npm package: src/assets/web-panel/
  const bundledDist = path.resolve(__dirname, "../assets/web-panel");
  if (fs.existsSync(path.join(bundledDist, "index.html"))) {
    return bundledDist;
  }
  return null;
}

/**
 * Handle `/api/*` routes. Returns `true` if the request was handled (caller
 * must stop further processing) and `false` for everything else (caller
 * continues with the static/SPA handler).
 *
 * Currently exposes a single read-only endpoint:
 *
 *   GET /api/skills → 200 { schema: 1, skills: [{name, source, category,
 *                    description, version}] }
 *
 * The smoke-runner's project-mode probe (packer/smoke-runner.js) hits this
 * to verify bundled skills were materialized and registered. The shape is
 * deliberately minimal — the Web UI's richer skill views use WS.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse}  res
 * @returns {boolean}  true if handled, false if the caller should continue
 */
export function handleApiRequest(req, res) {
  const urlPath = req.url.split("?")[0];
  if (!urlPath.startsWith("/api/")) return false;

  if (urlPath === "/api/skills") {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return true;
    }
    try {
      const loader = new CLISkillLoader();
      const resolved = loader.loadAll();
      const skills = resolved.map((s) => ({
        name: s.id,
        displayName: s.displayName,
        source: s.source,
        category: s.category,
        description: s.description,
        version: s.version,
      }));
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify({ schema: 1, skills }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Skill load failed", detail: err.message }),
      );
    }
    return true;
  }

  // Unknown /api/* path — explicit 404 so callers (smoke-runner) can tell
  // "endpoint not implemented" from "server broken".
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found", path: urlPath }));
  return true;
}

/**
 * Create and return a Node.js HTTP server that serves the Web UI.
 *
 * When packages/web-panel/dist/ is present (built Vue3 app), it is served as
 * a SPA with the runtime config injected into index.html.
 * Otherwise falls back to the embedded single-page HTML.
 *
 * @param {object} opts
 * @param {number}  opts.wsPort
 * @param {string|null} opts.wsToken
 * @param {string}  opts.wsHost
 * @param {string|null} opts.projectRoot
 * @param {string|null} opts.projectName
 * @param {"project"|"global"} opts.mode
 * @param {"auto"|"full"|"minimal"} [opts.uiMode="auto"]
 * @param {string|null} [opts.staticDir]   - Optional override for dist directory
 * @returns {import("http").Server}
 */
export function createWebUIServer(opts) {
  const uiMode = opts.uiMode || "auto";
  if (uiMode !== "auto" && uiMode !== "full" && uiMode !== "minimal") {
    throw new Error(
      `Invalid uiMode "${uiMode}". Expected "auto", "full", or "minimal".`,
    );
  }

  const distDir =
    uiMode === "minimal" ? null : findWebPanelDist(opts.staticDir || null);

  if (uiMode === "full" && !distDir) {
    throw new Error(
      'uiMode="full" requires a built web-panel dist directory, but none was found. ' +
        "Run `npm run build:web-panel` in packages/cli, or pass `staticDir` to override.",
    );
  }

  const configJson = buildConfigJson(opts);

  if (distDir) {
    // ── Serve built Vue3 web panel ──────────────────────────────────────────
    return http.createServer((req, res) => {
      // /api/* routes are handled before the static file logic so GET /api/skills
      // doesn't accidentally resolve to index.html via the SPA fallback.
      if (handleApiRequest(req, res)) return;

      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

      const urlPath = req.url.split("?")[0];

      // Resolve requested file path (prevent path traversal)
      const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = path.join(distDir, safePath);

      // Serve static assets (js, css, fonts, etc.)
      if (urlPath !== "/" && urlPath !== "/index.html") {
        try {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mime = MIME_TYPES[ext] || "application/octet-stream";
            const isAsset = urlPath.startsWith("/assets/");
            res.writeHead(200, {
              "Content-Type": mime,
              "Cache-Control": isAsset
                ? "public, max-age=31536000, immutable"
                : "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            res.end(fs.readFileSync(filePath));
            return;
          }
        } catch (_) {
          // Fall through to SPA index
        }
      }

      // SPA fallback: serve index.html with injected config
      try {
        let html = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
        // Use a function replacement to avoid String.prototype.replace() treating
        // '$&', '$`', "$'" etc. in configJson as special replacement patterns
        // (e.g. projectRoot="/path/$HOME" would corrupt the JSON otherwise).
        html = html.replace("__CC_CONFIG_PLACEHOLDER__", () => configJson);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(html, "utf-8");
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Failed to read index.html: ${err.message}`);
      }
    });
  }

  // ── Fallback: embedded classic single-page HTML ─────────────────────────
  const html = buildHtml(opts);
  return http.createServer((req, res) => {
    if (handleApiRequest(req, res)) return;

    const urlPath = req.url.split("?")[0];
    if (
      req.method !== "GET" ||
      (urlPath !== "/" && urlPath !== "/index.html")
    ) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(html, "utf-8");
  });
}

// =====================================================================
// web-ui-server V2 governance overlay (iter26)
// =====================================================================
export const WEBUIGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  ARCHIVED: "archived",
});
export const WEBUIGOV_REQUEST_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SERVING: "serving",
  SERVED: "served",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _webuigovPTrans = new Map([
  [
    WEBUIGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE,
      WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      WEBUIGOV_PROFILE_MATURITY_V2.DEGRADED,
      WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WEBUIGOV_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE,
      WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _webuigovPTerminal = new Set([WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _webuigovJTrans = new Map([
  [
    WEBUIGOV_REQUEST_LIFECYCLE_V2.QUEUED,
    new Set([
      WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVING,
      WEBUIGOV_REQUEST_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVING,
    new Set([
      WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVED,
      WEBUIGOV_REQUEST_LIFECYCLE_V2.FAILED,
      WEBUIGOV_REQUEST_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVED, new Set()],
  [WEBUIGOV_REQUEST_LIFECYCLE_V2.FAILED, new Set()],
  [WEBUIGOV_REQUEST_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _webuigovPsV2 = new Map();
const _webuigovJsV2 = new Map();
let _webuigovMaxActive = 10,
  _webuigovMaxPending = 25,
  _webuigovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _webuigovStuckMs = 60 * 1000;
function _webuigovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _webuigovCheckP(from, to) {
  const a = _webuigovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid webuigov profile transition ${from} → ${to}`);
}
function _webuigovCheckJ(from, to) {
  const a = _webuigovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid webuigov request transition ${from} → ${to}`);
}
function _webuigovCountActive(owner) {
  let c = 0;
  for (const p of _webuigovPsV2.values())
    if (p.owner === owner && p.status === WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _webuigovCountPending(profileId) {
  let c = 0;
  for (const j of _webuigovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === WEBUIGOV_REQUEST_LIFECYCLE_V2.QUEUED ||
        j.status === WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVING)
    )
      c++;
  return c;
}
export function setMaxActiveWebuigovProfilesPerOwnerV2(n) {
  _webuigovMaxActive = _webuigovPos(n, "maxActiveWebuigovProfilesPerOwner");
}
export function getMaxActiveWebuigovProfilesPerOwnerV2() {
  return _webuigovMaxActive;
}
export function setMaxPendingWebuigovRequestsPerProfileV2(n) {
  _webuigovMaxPending = _webuigovPos(n, "maxPendingWebuigovRequestsPerProfile");
}
export function getMaxPendingWebuigovRequestsPerProfileV2() {
  return _webuigovMaxPending;
}
export function setWebuigovProfileIdleMsV2(n) {
  _webuigovIdleMs = _webuigovPos(n, "webuigovProfileIdleMs");
}
export function getWebuigovProfileIdleMsV2() {
  return _webuigovIdleMs;
}
export function setWebuigovRequestStuckMsV2(n) {
  _webuigovStuckMs = _webuigovPos(n, "webuigovRequestStuckMs");
}
export function getWebuigovRequestStuckMsV2() {
  return _webuigovStuckMs;
}
export function _resetStateWebUiServerGovV2() {
  _webuigovPsV2.clear();
  _webuigovJsV2.clear();
  _webuigovMaxActive = 10;
  _webuigovMaxPending = 25;
  _webuigovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _webuigovStuckMs = 60 * 1000;
}
export function registerWebuigovProfileV2({
  id,
  owner,
  endpoint,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_webuigovPsV2.has(id))
    throw new Error(`webuigov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    endpoint: endpoint || "/",
    status: WEBUIGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _webuigovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateWebuigovProfileV2(id) {
  const p = _webuigovPsV2.get(id);
  if (!p) throw new Error(`webuigov profile ${id} not found`);
  const isInitial = p.status === WEBUIGOV_PROFILE_MATURITY_V2.PENDING;
  _webuigovCheckP(p.status, WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _webuigovCountActive(p.owner) >= _webuigovMaxActive)
    throw new Error(
      `max active webuigov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function degradeWebuigovProfileV2(id) {
  const p = _webuigovPsV2.get(id);
  if (!p) throw new Error(`webuigov profile ${id} not found`);
  _webuigovCheckP(p.status, WEBUIGOV_PROFILE_MATURITY_V2.DEGRADED);
  p.status = WEBUIGOV_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveWebuigovProfileV2(id) {
  const p = _webuigovPsV2.get(id);
  if (!p) throw new Error(`webuigov profile ${id} not found`);
  _webuigovCheckP(p.status, WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = WEBUIGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchWebuigovProfileV2(id) {
  const p = _webuigovPsV2.get(id);
  if (!p) throw new Error(`webuigov profile ${id} not found`);
  if (_webuigovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal webuigov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getWebuigovProfileV2(id) {
  const p = _webuigovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listWebuigovProfilesV2() {
  return [..._webuigovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createWebuigovRequestV2({
  id,
  profileId,
  method,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_webuigovJsV2.has(id))
    throw new Error(`webuigov request ${id} already exists`);
  if (!_webuigovPsV2.has(profileId))
    throw new Error(`webuigov profile ${profileId} not found`);
  if (_webuigovCountPending(profileId) >= _webuigovMaxPending)
    throw new Error(
      `max pending webuigov requests for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    method: method || "",
    status: WEBUIGOV_REQUEST_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _webuigovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function servingWebuigovRequestV2(id) {
  const j = _webuigovJsV2.get(id);
  if (!j) throw new Error(`webuigov request ${id} not found`);
  _webuigovCheckJ(j.status, WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVING);
  const now = Date.now();
  j.status = WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRequestWebuigovV2(id) {
  const j = _webuigovJsV2.get(id);
  if (!j) throw new Error(`webuigov request ${id} not found`);
  _webuigovCheckJ(j.status, WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVED);
  const now = Date.now();
  j.status = WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failWebuigovRequestV2(id, reason) {
  const j = _webuigovJsV2.get(id);
  if (!j) throw new Error(`webuigov request ${id} not found`);
  _webuigovCheckJ(j.status, WEBUIGOV_REQUEST_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = WEBUIGOV_REQUEST_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelWebuigovRequestV2(id, reason) {
  const j = _webuigovJsV2.get(id);
  if (!j) throw new Error(`webuigov request ${id} not found`);
  _webuigovCheckJ(j.status, WEBUIGOV_REQUEST_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = WEBUIGOV_REQUEST_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getWebuigovRequestV2(id) {
  const j = _webuigovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listWebuigovRequestsV2() {
  return [..._webuigovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdleWebuigovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _webuigovPsV2.values())
    if (
      p.status === WEBUIGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _webuigovIdleMs
    ) {
      p.status = WEBUIGOV_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckWebuigovRequestsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _webuigovJsV2.values())
    if (
      j.status === WEBUIGOV_REQUEST_LIFECYCLE_V2.SERVING &&
      j.startedAt != null &&
      t - j.startedAt >= _webuigovStuckMs
    ) {
      j.status = WEBUIGOV_REQUEST_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getWebUiServerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(WEBUIGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _webuigovPsV2.values()) profilesByStatus[p.status]++;
  const requestsByStatus = {};
  for (const v of Object.values(WEBUIGOV_REQUEST_LIFECYCLE_V2))
    requestsByStatus[v] = 0;
  for (const j of _webuigovJsV2.values()) requestsByStatus[j.status]++;
  return {
    totalWebuigovProfilesV2: _webuigovPsV2.size,
    totalWebuigovRequestsV2: _webuigovJsV2.size,
    maxActiveWebuigovProfilesPerOwner: _webuigovMaxActive,
    maxPendingWebuigovRequestsPerProfile: _webuigovMaxPending,
    webuigovProfileIdleMs: _webuigovIdleMs,
    webuigovRequestStuckMs: _webuigovStuckMs,
    profilesByStatus,
    requestsByStatus,
  };
}
