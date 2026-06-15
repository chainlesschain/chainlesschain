/**
 * Chat panel glue — the WebviewViewProvider that wires the webview UI to an
 * AgentChatSession. The ONLY file in src/chat/ that touches `vscode`.
 *
 * Lazy lifecycle: the cc child is spawned on the FIRST message (not on view
 * open), restarted automatically by the next message after an exit, and
 * killed on dispose. The child env carries this window's bridge port/token
 * (via getBridgeEnv) so the agent gets selection context, diagnostics
 * feedback, and native diff reviews against THIS editor.
 */
const crypto = require("crypto");
const { AgentChatSession } = require("./agent-session");
const {
  mapAgentEvent,
  createTurnState,
  buildSessionArgs,
} = require("./chat-events");
const { buildChatHtml } = require("./chat-html");
const { ConversationManager } = require("./conversation-manager");

class ChatViewProvider {
  /**
   * @param {*} vscode
   * @param {object} opts { getBridgeEnv: () => object, log?: (s)=>void,
   *                        state?: vscode Memento (workspaceState) for
   *                        per-workspace session resume }
   */
  constructor(vscode, opts = {}) {
    this.vscode = vscode;
    this.opts = opts;
    this.view = null;
    // Multi-tab model: N conversations, each owning its own agent child +
    // resume id + per-turn reducer state. One is bootstrapped on demand so
    // single-tab behavior (and every existing flow) is preserved.
    this._convs = new ConversationManager({ createTurnState });
    // Injectable for tests: returns a STARTED session for the given config.
    this._createSession =
      opts.deps?.createSession ||
      ((cfg) => new AgentChatSession(cfg).start());
    // "Insert File Reference" (Cmd/Ctrl+Alt+K): text queued here until the
    // webview signals it is live, then flushed into the input.
    this._pendingInsert = "";
    this._webviewReady = false;
    // Keyboard actions that may fire before the webview is live (reveal races
    // the "ready" message) — queued here and flushed in _onWebviewReady.
    this._pendingNewTab = false; // Cmd/Ctrl+Shift+Esc
    this._pendingReopen = null; // Cmd/Ctrl+Shift+T → { sessionId }
    // Most recently closed tab (for reopen-closed), captured on closeTab.
    this._lastClosed = null;
  }

  /** The active conversation, creating the first one (lazily) if none exist. */
  _activeConv() {
    if (this._convs.count() === 0) {
      this._convs.create({ sessionId: this._storedSessionId() });
    }
    return this._convs.active();
  }

  /** Back-compat accessor: the active conversation's live session (or null). */
  get session() {
    return this._convs.active()?.session || null;
  }

  /** Back-compat setter: drops/sets the active conversation's session handle. */
  set session(handle) {
    const c = this._convs.active();
    if (c) this._convs.setSession(c.id, handle);
  }

  /**
   * Insert an `@<file>` reference into the chat input. Reveals the panel first;
   * if the webview is not live yet (lazy), the text is queued and flushed when
   * the webview posts "ready" (avoids a postMessage race on first open).
   */
  insertReference(text) {
    if (!text) return;
    this.vscode.commands.executeCommand("chainlesschainIdeChat.focus");
    if (this._webviewReady && this.view) {
      this._post({ kind: "insertText", text });
    } else {
      this._pendingInsert += text;
    }
  }

  /**
   * Seed the chat input with prompt text (e.g. a "Fix with ChainlessChain"
   * request) and reveal the panel — same reveal + queue/flush path as
   * insertReference, named for intent. The user reviews/edits, then hits Send.
   */
  seedInput(text) {
    return this.insertReference(text);
  }

  /** Webview script is live — flush any action queued before it loaded. */
  _onWebviewReady() {
    this._webviewReady = true;
    if (this._pendingInsert) {
      const t = this._pendingInsert;
      this._pendingInsert = "";
      this._post({ kind: "insertText", text: t });
    }
    if (this._pendingReopen) {
      const { sessionId } = this._pendingReopen;
      this._pendingReopen = null;
      this._pendingNewTab = false; // reopen subsumes a plain new tab
      this._reopenInto(sessionId);
    } else if (this._pendingNewTab) {
      this._pendingNewTab = false;
      this._openNewTab();
    }
  }

  _storedSessionId() {
    return this.opts.state?.get?.("chainlesschain.chat.sessionId") || null;
  }

  _rememberSessionId(id) {
    this.opts.state?.update?.("chainlesschain.chat.sessionId", id || null);
  }

  _post(msg) {
    if (msg && this.view) {
      this.view.webview.postMessage(msg).then(undefined, () => {});
    }
  }

  _cliCommand() {
    return (
      this.vscode.workspace
        .getConfiguration("chainlesschain.cli")
        .get("path") || "cc"
    );
  }

  /** Post a webview message only when it belongs to the ACTIVE tab — so a
   * background tab's stream never bleeds into the visible transcript. */
  _postFrom(convId, msg) {
    if (this._convs.activeId() === convId) this._post(msg);
  }

  /** Push the current tab set to the webview (the tab bar renders from this). */
  _postTabs() {
    this._post({
      kind: "tabs",
      tabs: this._convs.list(),
      activeId: this._convs.activeId(),
    });
  }

  /** Event handler bound to one conversation: routes to ITS reducer state and
   * only surfaces when that conversation is the active tab. */
  _makeOnEvent(convId) {
    return (evt) => {
      const conv = this._convs.get(convId);
      if (!conv) return;
      if (evt?.type === "system" && evt.subtype === "init") {
        if (evt.session_id) {
          this._convs.setSessionId(convId, evt.session_id);
          if (this._convs.activeId() === convId) {
            this._rememberSessionId(evt.session_id);
          }
        }
        if (evt.resumed_messages > 0) {
          this._postFrom(convId, {
            kind: "info",
            text: `resumed previous conversation (${evt.resumed_messages} messages)`,
          });
        }
      }
      // An LLM connection failure usually means "nothing configured yet" —
      // surface the guided-setup card instead of a bare error.
      if (
        evt?.type === "result" &&
        evt.is_error &&
        /fetch failed|ECONNREFUSED|ENOTFOUND|api.?key/i.test(
          String(evt.error || evt.result || ""),
        )
      ) {
        this._postFrom(convId, { kind: "setup", reason: String(evt.error || "") });
      }
      this._postFrom(convId, mapAgentEvent(evt, conv.turnState));
      // Background-tab completion signal: a turn just finished in a tab you are
      // NOT looking at (its stream was gated out of the visible transcript).
      // Flag it so the tab bar shows a dot, and offer a jump-to toast.
      if (evt?.type === "result" && this._convs.activeId() !== convId) {
        if (this._convs.markUnread(convId)) {
          this._postTabs();
          this._notifyBackgroundDone(conv);
        }
      }
    };
  }

  /**
   * Best-effort toast when a background tab's turn completes; the "Show" action
   * reveals the panel and switches to that tab. `window.showInformationMessage`
   * is read off the live host (and may be absent in tests) so this never throws.
   */
  _notifyBackgroundDone(conv) {
    const win = this.vscode && this.vscode.window;
    const show = win && win.showInformationMessage;
    if (typeof show !== "function") return;
    const title = (conv && conv.title) || "Chat";
    try {
      const p = show.call(win, `ChainlessChain · "${title}" finished`, "Show");
      if (p && typeof p.then === "function") {
        p.then((pick) => {
          if (pick === "Show") this._revealConversation(conv && conv.id);
        }, () => {});
      }
    } catch {
      /* notification is best-effort — never break the agent loop over a toast */
    }
  }

  /** Switch to a conversation and reveal the panel (used by the "Show" toast). */
  _revealConversation(id) {
    const conv = this._convs.switchTo(String(id || ""));
    if (!conv) return;
    this._rememberSessionId(conv.sessionId);
    try {
      this.vscode.commands.executeCommand("chainlesschainIdeChat.focus");
    } catch {
      /* focus is best-effort */
    }
    this._postTabs();
  }

  /** Ensure the ACTIVE conversation has a running agent child; spawn one
   * (resuming its own session id) if not. Returns the live session. */
  _ensureSession() {
    const conv = this._activeConv();
    if (conv.session?.running) return conv.session;
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    this._convs.resetTurnState(conv.id);
    const chatCfg = this.vscode.workspace.getConfiguration(
      "chainlesschain.chat",
    );
    const session = this._createSession({
      command: this._cliCommand(),
      args: [
        ...buildSessionArgs({
          model: chatCfg.get("model"),
          provider: chatCfg.get("provider"),
          // Continue THIS tab's conversation across child restarts; a new tab
          // (or "New") starts with no resume id for a fresh session.
          resume: conv.sessionId,
          // Approval mode (/auto, /bypass, /normal) — flag is spawn-time, so a
          // mode change stops the child and the next turn respawns with it.
          mode: conv.mode,
        }),
        // Confirm-tier approvals become Approve/Deny cards in the panel
        // instead of failing closed (needs cc >= 0.162.45).
        "--interactive-approvals",
      ],
      cwd,
      env: { ...process.env, ...bridgeEnv },
      onEvent: this._makeOnEvent(conv.id),
      onStderr: (line) => this._postFrom(conv.id, { kind: "stderr", text: line }),
      onExit: ({ code }) => this._postFrom(conv.id, { kind: "exited", code }),
    });
    this._convs.setSession(conv.id, session);
    if (typeof this.opts.log === "function") {
      this.opts.log(`chat: spawned ${this._cliCommand()} agent (cwd ${cwd})`);
    }
    return session;
  }

  /** /sessions — native QuickPick over `cc session list`, then resume. */
  async _pickSession() {
    const { listSessions } = require("./session-list");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const items = await listSessions({
      command: this._cliCommand(),
      cwd: folders[0]?.uri?.fsPath,
    });
    if (!items.length) {
      this._post({ kind: "info", text: "no saved sessions found" });
      return;
    }
    const pick = await this.vscode.window.showQuickPick(
      items.map((s) => ({
        label: s.id,
        description: s.store + (s.updatedAt ? " · " + s.updatedAt : ""),
        detail: s.title || undefined,
      })),
      { placeHolder: "Resume which session in the chat panel?" },
    );
    if (!pick) return;
    const conv = this._activeConv();
    conv.session?.stop();
    this._convs.setSession(conv.id, null);
    this._convs.setSessionId(conv.id, pick.label);
    this._rememberSessionId(pick.label);
    this._post({ kind: "reset" });
    this._post({
      kind: "info",
      text: `will resume ${pick.label} — send a message to continue it`,
    });
  }

  /**
   * /auto · /bypass · /normal — switch the ACTIVE conversation's approval mode
   * (Claude-Code auto-accept/bypass parity). The `--permission-mode` flag is
   * spawn-time, so a live child is stopped here; the next message respawns it
   * with the new mode, resuming this conversation's session id so context
   * carries over. Unknown modes are reported and ignored (no flag = default).
   */
  _setMode(mode) {
    const LABELS = {
      default: "normal approvals",
      acceptEdits: "auto-accept edits",
      bypassPermissions: "bypass all approvals",
    };
    if (!Object.prototype.hasOwnProperty.call(LABELS, mode)) {
      this._post({ kind: "info", text: `unknown mode "${mode}"` });
      return;
    }
    const conv = this._activeConv();
    this._convs.setMode(conv.id, mode);
    const restarted = !!conv.session?.running;
    if (restarted) {
      conv.session.stop();
      this._convs.setSession(conv.id, null);
    }
    this._post({
      kind: "info",
      text:
        `approval mode → ${LABELS[mode]}` +
        (restarted ? " (applies on your next message)" : ""),
    });
  }

  /** Open a fresh conversation tab (becomes active); its child spawns on the
   * first message. `sessionId` resumes an existing session (reopen-closed);
   * null starts blank. No "reset" is posted, so other tabs stay buffered. */
  _openNewTab(sessionId = null) {
    this._activeConv(); // ensure at least the bootstrap exists first
    this._convs.create({ sessionId: sessionId || null });
    this._rememberSessionId(sessionId || null);
    this._fileCache = null; // pick up files created since the last scan
    this._postTabs();
  }

  /** Reopen the most recently closed chat as a new tab, resuming its session. */
  _reopenInto(sessionId) {
    this._openNewTab(sessionId);
    this._post({
      kind: "info",
      text: sessionId
        ? `reopened closed chat — send a message to continue ${sessionId}`
        : "reopened a fresh chat",
    });
  }

  /** Cmd/Ctrl+Shift+Esc — reveal the panel and open a fresh conversation tab.
   * If the webview is not live yet (reveal races "ready"), the action is
   * queued and flushed in _onWebviewReady. */
  newConversation() {
    this.vscode.commands.executeCommand("chainlesschainIdeChat.focus");
    if (this._webviewReady && this.view) this._openNewTab();
    else this._pendingNewTab = true;
  }

  /** Cmd/Ctrl+Shift+T — reveal the panel and reopen the most recently closed
   * chat (resuming its session). No-op with a hint when none was closed. */
  reopenClosedSession() {
    if (!this._lastClosed) {
      this.vscode.window.showInformationMessage?.(
        "ChainlessChain: no recently-closed chat to reopen.",
      );
      return;
    }
    const sessionId = this._lastClosed.sessionId || null;
    this._lastClosed = null;
    this.vscode.commands.executeCommand("chainlesschainIdeChat.focus");
    if (this._webviewReady && this.view) this._reopenInto(sessionId);
    else this._pendingReopen = { sessionId };
  }

  /**
   * Pasted images arrive from the webview as data URLs; the CLI's stream
   * protocol takes file PATHS (same pipeline as `cc agent --image`), so each
   * one is written to a temp file. Returns the paths (cap 4 per message;
   * non-image/malformed data is skipped — never trust webview input).
   */
  _writeImageTemps(images) {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const out = [];
    for (const img of (images || []).slice(0, 4)) {
      const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
        String((img && img.data) || ""),
      );
      if (!m) continue;
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const file = path.join(
        os.tmpdir(),
        `cc-chat-img-${Date.now()}-${this._imgSeq = (this._imgSeq || 0) + 1}.${ext}`,
      );
      try {
        fs.writeFileSync(file, Buffer.from(m[2], "base64"));
        out.push(file);
      } catch {
        // unwritable tmp — skip this attachment, keep the message going
      }
    }
    return out;
  }

  /**
   * Workspace files for @-mention completion. The full listing is fetched
   * once per provider (5k cap, heavy dirs excluded) and filtered per
   * keystroke in-process; "New" invalidates it so fresh files show up.
   */
  async _listWorkspaceFiles(prefix) {
    const { filterFiles } = require("./at-mention");
    if (!this._fileCache) {
      this._fileCache = Promise.resolve()
        .then(() =>
          this.vscode.workspace.findFiles(
            "**/*",
            "**/{node_modules,.git,dist,build,out,coverage}/**",
            5000,
          ),
        )
        .then((uris) => {
          const folders = this.vscode.workspace.workspaceFolders || [];
          const root = folders[0]?.uri?.fsPath || "";
          return (uris || []).map((u) => {
            let p = u.fsPath || "";
            if (root && p.startsWith(root)) p = p.slice(root.length + 1);
            return p.replace(/\\/g, "/");
          });
        })
        .catch(() => []);
    }
    const all = await this._fileCache;
    return filterFiles(all, prefix, 20);
  }

  /**
   * Workspace symbols (functions/classes/…) matching the typed prefix, as
   * `{label, value}` items whose value is the symbol's file (the CLI expands
   * `@<path>`). Gated at >=2 chars to avoid the unfiltered symbol dump; never
   * throws (no provider / no results → []).
   */
  async _listWorkspaceSymbols(prefix) {
    const q = String(prefix || "").trim();
    if (q.length < 2) return [];
    try {
      const syms = await this.vscode.commands.executeCommand(
        "vscode.executeWorkspaceSymbolProvider",
        q,
      );
      const { formatSymbolItems } = require("./symbol-mentions");
      const folders = this.vscode.workspace.workspaceFolders || [];
      const root = folders[0]?.uri?.fsPath || "";
      return formatSymbolItems(syms, root, 8);
    } catch {
      return [];
    }
  }

  /**
   * `/cost` + `/context` — run the CLI introspection command for THIS panel's
   * session and render its text (mirrors `/sessions` deferring to the CLI;
   * avoids duplicating pricing / context-window math in the webview). Needs a
   * persisted session id, so it's a no-op with a hint before the first turn.
   */
  async _runIntrospect(kind) {
    const id = this._storedSessionId();
    if (!id) {
      this._post({
        kind: "info",
        text: `/${kind}: send a message first — no session yet.`,
      });
      return;
    }
    const introspect = require("./introspect-commands");
    const runText = this.opts.deps?.runCliText || introspect.runCliText;
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const chatCfg = this.vscode.workspace.getConfiguration(
      "chainlesschain.chat",
    );
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    const args = introspect.buildIntrospectArgs(kind, id, {
      model: chatCfg.get("model"),
      provider: chatCfg.get("provider"),
    });
    const text = await runText({
      command: this._cliCommand(),
      args,
      cwd,
      env: { ...process.env, ...bridgeEnv },
    });
    this._post({ kind: "pre", text: text || `/${kind}: (no output)` });
  }

  /**
   * `/rewind` — list this session's auto-checkpoints (the agent snapshots the
   * work tree before each mutating tool, cc >= 0.162.70), let the user pick one
   * in a native QuickPick, and `cc checkpoint restore` it (current state is
   * auto-snapshotted first). Scoped to the panel's session id so it only offers
   * THIS conversation's checkpoints. No-op with a hint before the first turn.
   */
  async _rewind() {
    const id = this._storedSessionId();
    if (!id) {
      this._post({
        kind: "info",
        text: "/rewind: send a message first — no session yet.",
      });
      return;
    }
    const rewind = this.opts.deps?.rewind || require("./rewind-commands");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    const env = { ...process.env, ...bridgeEnv };
    const command = this._cliCommand();
    const listed = await rewind.runCliJson({
      command,
      args: rewind.buildListArgs(id),
      cwd,
      env,
    });
    if (!listed.ok || !Array.isArray(listed.data) || listed.data.length === 0) {
      this._post({
        kind: "info",
        text:
          "/rewind: no checkpoints for this session yet — they're created " +
          "automatically before file edits (needs cc >= 0.162.70).",
      });
      return;
    }
    const pick = await this.vscode.window.showQuickPick(
      listed.data.map(rewind.toQuickPickItem),
      {
        placeHolder:
          "Rewind the work tree to which checkpoint? (current state is snapshotted first)",
      },
    );
    if (!pick) return;
    const restored = await rewind.runCliJson({
      command,
      args: rewind.buildRestoreArgs(id, pick.id || pick.label),
      cwd,
      env,
    });
    if (restored.ok) {
      const n = rewind.restoredCount(restored.data);
      this._post({
        kind: "info",
        text:
          `↩ rewound to ${pick.label}` +
          (typeof n === "number" ? ` — ${n} file(s) restored` : ""),
      });
    } else {
      this._post({
        kind: "error",
        text: `/rewind failed: ${restored.error || "unknown error"}`,
      });
    }
  }

  /** Called after the Configure-LLM wizard: fresh child picks up the config. */
  onLlmConfigured() {
    this.session?.stop();
    this.session = null;
    this._post({
      kind: "info",
      text: "LLM 配置已更新 — 下一条消息用新配置启动",
    });
  }

  resolveWebviewView(view) {
    this.view = view;
    this._webviewReady = false;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildChatHtml({
      cspSource: view.webview.cspSource,
      nonce: crypto.randomBytes(16).toString("hex"),
    });
    // First-run onboarding: no llm.provider configured → show the setup card.
    (async () => {
      try {
        const { getConfiguredProvider } = require("../llm-config");
        const provider = await getConfiguredProvider({
          command: this._cliCommand(),
        });
        if (!provider) this._post({ kind: "setup", reason: "" });
      } catch {
        /* onboarding check is best-effort */
      }
    })();
    view.webview.onDidReceiveMessage((m) => this._handleMessage(m));
    view.onDidDispose(() => {
      for (const s of this._convs.allSessions()) s.stop?.();
      this.view = null;
      this._webviewReady = false;
    });
  }

  /**
   * Handle one inbound webview message (send / tabs / plan / approval / …).
   * Extracted from resolveWebviewView so the whole message flow is unit-testable
   * without a live webview host.
   */
  _handleMessage(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "send") {
        const images = Array.isArray(m.images)
          ? this._writeImageTemps(m.images)
          : [];
        const session = this._ensureSession();
        const ok = images.length
          ? session.sendEvent({
              type: "user",
              text: String(m.text || ""),
              images,
            })
          : session.send(m.text);
        if (!ok) {
          this._post({
            kind: "error",
            text:
              "could not reach the agent process — is the `cc` CLI " +
              "installed? (npm i -g chainlesschain, or set " +
              "chainlesschain.cli.path)",
          });
        }
      } else if (m.type === "plan") {
        // Plan controls ride the same stdin protocol; entering plan mode may
        // need to spawn the child first (e.g. Plan clicked before any turn).
        const action = String(m.action || "");
        if (action === "enter") {
          this._ensureSession().sendEvent({ type: "plan", action });
        } else {
          this.session?.sendEvent({ type: "plan", action });
        }
      } else if (m.type === "files") {
        // @-mention completion: IDE pseudo-mentions (@selection/@diagnostics)
        // first, then ranked workspace-relative paths, then workspace symbols
        // (find a file by a function/class name). Deduped by inserted value so
        // a symbol whose file already matched by path doesn't show twice.
        const prefix = String(m.prefix || "");
        const { ideMentionMatches } = require("./at-mention");
        const { dedupeMentionItems } = require("./symbol-mentions");
        Promise.all([
          this._listWorkspaceFiles(prefix),
          this._listWorkspaceSymbols(prefix),
        ]).then(
          ([files, symbols]) =>
            this._post({
              kind: "files",
              prefix,
              items: dedupeMentionItems(
                ideMentionMatches(prefix).concat(files, symbols),
              ),
            }),
          () => {},
        );
      } else if (m.type === "pickSession") {
        this._pickSession().catch(() => {});
      } else if (m.type === "cost" || m.type === "context") {
        this._runIntrospect(m.type).catch(() => {});
      } else if (m.type === "rewind") {
        this._rewind().catch(() => {});
      } else if (m.type === "mode") {
        this._setMode(String(m.mode || "default"));
      } else if (m.type === "configureLlm") {
        this.vscode.commands.executeCommand("chainlesschain.llm.configure");
      } else if (m.type === "approval") {
        this.session?.sendEvent({
          type: "approval",
          id: String(m.id || ""),
          approve: m.approve === true,
        });
      } else if (m.type === "interrupt") {
        // Abort the in-flight turn only — the conversation/child stays alive.
        this.session?.sendEvent({ type: "interrupt" });
      } else if (m.type === "stop") {
        this.session?.stop();
      } else if (m.type === "ready") {
        this._onWebviewReady();
        // Show the tab bar from the first paint (bootstraps one conversation
        // record — no child spawn until the first message).
        this._activeConv();
        this._postTabs();
      } else if (m.type === "new") {
        // New chat: reset the ACTIVE conversation — drop its child AND resume
        // id so the next message spawns fresh. Webview clears on "reset".
        const conv = this._activeConv();
        conv.session?.stop();
        this._convs.setSession(conv.id, null);
        this._convs.setSessionId(conv.id, null);
        this._rememberSessionId(null);
        this._fileCache = null; // pick up files created since the last scan
        this._post({ kind: "reset" });
      } else if (m.type === "newTab") {
        // Open a fresh conversation tab (becomes active). Its child spawns on
        // the first message. `tabs` tells the webview to swap to the new
        // (empty) tab — no `reset`, so the previous tab's transcript is kept
        // buffered for when the user switches back.
        this._openNewTab();
      } else if (m.type === "switchTab") {
        // Switch the visible conversation; the webview restores that tab's
        // buffered transcript on the `tabs` message (no reset).
        const conv = this._convs.switchTo(String(m.id || ""));
        if (conv) {
          this._rememberSessionId(conv.sessionId);
          this._postTabs();
        }
      } else if (m.type === "closeTab") {
        const res = this._convs.close(String(m.id || ""));
        if (res.closed) {
          // Remember it so Cmd/Ctrl+Shift+T can reopen+resume the last close.
          if (res.conv) {
            this._lastClosed = {
              sessionId: res.conv.sessionId || null,
              title: res.conv.title,
            };
          }
          res.conv?.session?.stop?.();
          if (this._convs.count() === 0) this._convs.create({}); // never empty
          this._rememberSessionId(this._convs.active()?.sessionId || null);
          this._postTabs();
        }
      }
  }

  dispose() {
    for (const s of this._convs.allSessions()) s.stop?.();
  }
}

module.exports = { ChatViewProvider };
