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
  buildIdeToolAdmission,
  resolveChatLlm,
} = require("./chat-events");
const { buildChatHtml, CHAT_UI_PROTOCOL_VERSION } = require("./chat-html");
const {
  ConversationManager,
  deriveTabTitle,
  isDefaultTitle,
} = require("./conversation-manager");
const {
  looksLikeLlmConfigError,
  hasUnsafeShellChars,
} = require("../llm-config.js");
const {
  buildPlanReviewRecord,
  buildPersistedPlanReview,
  findPersistedPlanReview,
  formatPlanReviewMarkdown,
  mergePlanRevisionDiff,
  mergePlanReviewProgress,
  sanitizePlanSnapshot,
  upsertPersistedPlanReview,
} = require("./plan-review.js");
const { upsertIdeSessionRecord } = require("./ide-session-index.js");
const { COMMAND_DEFS, splitSlashArgs } = require("./slash-commands.js");

const PLAN_REVIEW_STATES_KEY = "chainlesschain.chat.planReviewStates.v1";
const WEBVIEW_PROTOCOL_TIMEOUT_MS = 750;

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
      opts.deps?.createSession || ((cfg) => new AgentChatSession(cfg).start());
    // Injectable for tests (the default reads ~/.chainlesschain/config.json).
    this._resolveChatLlm = opts.deps?.resolveChatLlm || resolveChatLlm;
    this._upsertIdeSessionRecord =
      opts.deps?.upsertIdeSessionRecord || upsertIdeSessionRecord;
    this._enableSessionIndex = opts.enableSessionIndex === true;
    // "Insert File Reference" (Cmd/Ctrl+Alt+K): text queued here until the
    // webview signals it is live, then flushed into the input.
    this._pendingInsert = "";
    this._webviewReady = false;
    // VS Code can keep the Webview DOM alive while its Extension Host restarts.
    // Guard resolved views with an explicit protocol handshake so an old UI
    // cannot keep applying stale client-side slash-command routing.
    this._webviewProtocolGuard = false;
    this._webviewProtocolConfirmed = false;
    this._webviewProtocolReloads = 0;
    this._webviewProtocolTimer = null;
    // Keyboard actions that may fire before the webview is live (reveal races
    // the "ready" message) — queued here and flushed in _onWebviewReady.
    this._pendingNewTab = false; // Cmd/Ctrl+Shift+Esc
    this._pendingReopen = null; // Cmd/Ctrl+Shift+T → { sessionId }
    // Most recently closed tab (for reopen-closed), captured on closeTab.
    this._lastClosed = null;
    // Context-indicator fast path: the LAST LLM call's usage per conversation
    // (token_usage events) + the model's context-window size learned from ONE
    // `cc context --json` probe. Together they let the per-turn indicator be
    // computed locally instead of cold-spawning the CLI after EVERY turn
    // (seconds per spawn on Windows). Cache is keyed by the panel's raw
    // provider/model settings and dropped on any LLM reconfigure.
    this._lastCallUsage = new Map(); // convId → usage of the latest LLM call
    this._ctxWindowCache = null; // { key, window } from the last CLI probe
    this._planReviews = new Map(); // convId -> { document, lastText, lastPlan }
    this._persistedPlanReviewStates = Array.isArray(
      opts.state?.get?.(PLAN_REVIEW_STATES_KEY),
    )
      ? opts.state.get(PLAN_REVIEW_STATES_KEY)
      : [];
    this._loopTimers = new Map(); // convId -> { timer, intervalMs, prompt }
  }

  /** The active conversation, creating the first one (lazily) if none exist. */
  _activeConv() {
    if (this._convs.count() === 0) this._restoreTabs();
    return this._convs.active();
  }

  /**
   * Rebuild the tab set saved by _persistTabs, so a window reload restores
   * ALL conversations (title / resume id / mode / thinking) instead of
   * collapsing N tabs into one. Children spawn lazily per tab on its first
   * message, resuming that tab's own session — same as the single-tab path.
   * Falls back to the legacy single-session key when nothing was saved.
   */
  _restoreTabs() {
    const saved = this.opts.state?.get?.("chainlesschain.chat.tabs");
    // Sanity bound only — persist saves every tab, and a restored tab is just a
    // cheap record (its child spawns lazily on the first message), so this is
    // high enough that realistic tab counts are never silently dropped.
    const RESTORE_CAP = 24;
    const tabs = Array.isArray(saved?.tabs)
      ? saved.tabs
          .filter((t) => t && (t.sessionId || t.title))
          .slice(0, RESTORE_CAP)
      : [];
    if (tabs.length === 0) {
      const conv = this._convs.create({ sessionId: this._storedSessionId() });
      this._restorePlanReviewState(conv);
      return;
    }
    const created = tabs.map((t) => {
      const conv = this._convs.create({
        title: typeof t.title === "string" ? t.title : "",
        sessionId: typeof t.sessionId === "string" ? t.sessionId : null,
        activate: false,
      });
      if (t.mode) this._convs.setMode(conv.id, String(t.mode));
      if (t.thinking) this._convs.setThinking(conv.id, String(t.thinking));
      if (t.goalCondition)
        this._convs.setGoalCondition(conv.id, String(t.goalCondition));
      this._restorePlanReviewState(conv);
      return conv;
    });
    const idx =
      Number.isInteger(saved.activeIndex) && created[saved.activeIndex]
        ? saved.activeIndex
        : 0;
    this._convs.switchTo(created[idx].id);
  }

  /** Snapshot every tab's restore-relevant state into workspaceState. Called
   * on any tab mutation (create/close/switch/rename/mode/session-id). */
  _persistTabs() {
    if (!this.opts.state?.update) return;
    const list = this._convs.list();
    const tabs = list.map((t) => {
      const c = this._convs.get(t.id);
      return {
        sessionId: c.sessionId || null,
        title: c.title,
        mode: c.mode || "default",
        thinking: c.thinking || "off",
        goalCondition: c.goalCondition || "",
      };
    });
    const activeIndex = Math.max(
      0,
      list.findIndex((t) => t.active),
    );
    this.opts.state.update("chainlesschain.chat.tabs", { tabs, activeIndex });
  }

  _workspaceFolders() {
    return (this.vscode.workspace.workspaceFolders || [])
      .map((f) => f?.uri?.fsPath)
      .filter(Boolean);
  }

  _indexConversation(conv, status) {
    if (!this._enableSessionIndex || !conv?.sessionId) return;
    try {
      this._upsertIdeSessionRecord({
        id: conv.sessionId,
        title: conv.title || "",
        ide: "vscode",
        conversationId: conv.id || "",
        workspaceFolders: this._workspaceFolders(),
        status,
        mode: conv.mode || "default",
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* best-effort: index failures must never break chat */
    }
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

  _clearWebviewProtocolTimer() {
    if (this._webviewProtocolTimer) {
      clearTimeout(this._webviewProtocolTimer);
      this._webviewProtocolTimer = null;
    }
  }

  _buildChatHtml(view) {
    return buildChatHtml({
      cspSource: view.webview.cspSource,
      nonce: crypto.randomBytes(16).toString("hex"),
      // Localized in the host (the webview can't call vscode.l10n.t) and
      // injected as CC_L10N for the setup card.
      l10n: {
        setupFailed: this.vscode.l10n.t(
          "LLM connection failed: {0} — configure the model first",
        ),
        setupNoConfig: this.vscode.l10n.t(
          "No model configured yet — a one-minute guide gets you chatting (written to config.json, shared by the CLI and the panel)",
        ),
        configureLlmBtn: this.vscode.l10n.t("Configure LLM"),
      },
    });
  }

  /**
   * Ask the currently-live DOM which UI protocol it implements. This matters
   * after an Extension Host restart: retainContextWhenHidden can preserve the
   * old script even though this provider instance is new.
   */
  _armWebviewProtocolCheck(view) {
    this._clearWebviewProtocolTimer();
    try {
      Promise.resolve(
        view.webview.postMessage({
          kind: "protocolProbe",
          uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION,
        }),
      ).catch(() => {});
    } catch {
      /* a disposed/not-yet-live webview is handled by the timeout */
    }
    this._webviewProtocolTimer = setTimeout(() => {
      this._webviewProtocolTimer = null;
      if (
        this.view !== view ||
        !this._webviewProtocolGuard ||
        this._webviewProtocolConfirmed
      ) {
        return;
      }
      this._reloadStaleWebview(view, "protocol probe timed out");
    }, WEBVIEW_PROTOCOL_TIMEOUT_MS);
    this._webviewProtocolTimer.unref?.();
  }

  _renderChatWebview(view) {
    if (!view || this.view !== view) return false;
    this._clearWebviewProtocolTimer();
    this._webviewReady = false;
    this._webviewProtocolConfirmed = false;
    view.webview.html = this._buildChatHtml(view);
    this._armWebviewProtocolCheck(view);
    return true;
  }

  /**
   * Rebuild at most once per resolved view. A missing/mismatched protocol is a
   * stale retained DOM in normal operation; the cap prevents an invalid local
   * CSP/script from causing an endless reload loop.
   */
  _reloadStaleWebview(view, reason) {
    if (
      !this._webviewProtocolGuard ||
      this.view !== view ||
      this._webviewProtocolReloads >= 1
    ) {
      return false;
    }
    this._webviewProtocolReloads += 1;
    this.opts.log?.(
      `chat: rebuilding webview (${reason}; expected UI protocol ${CHAT_UI_PROTOCOL_VERSION})`,
    );
    return this._renderChatWebview(view);
  }

  _acceptWebviewProtocol(m) {
    if (!this._webviewProtocolGuard) return true;
    if (m.uiProtocolVersion === CHAT_UI_PROTOCOL_VERSION) {
      this._clearWebviewProtocolTimer();
      this._webviewProtocolConfirmed = true;
      return true;
    }
    // Ignore a late legacy message once the replacement UI has already
    // completed its handshake.
    if (this._webviewProtocolConfirmed) return false;
    this._reloadStaleWebview(
      this.view,
      m.uiProtocolVersion == null
        ? "retained UI did not report a protocol"
        : `retained UI protocol ${m.uiProtocolVersion} does not match`,
    );
    return false;
  }

  _cliCommand() {
    // An explicit non-default `cli.path` wins; otherwise use the binary resolved
    // at activation (cc → chainlesschain → clc → clchain), so a `cc` shadowed by
    // the C compiler doesn't break the panel spawn.
    const configured = this.vscode.workspace
      .getConfiguration("chainlesschain.cli")
      .get("path");
    if (configured && configured !== "cc") return configured;
    return require("../cli-binary").getResolvedCli();
  }

  /** Stable token for host-side async work that belongs to the current
   * transcript generation. `/new` and resume keep the tab id, so convId alone
   * cannot stop an old CLI result from appearing in the replacement chat. */
  _asyncToken(conv) {
    if (!conv._asyncToken) conv._asyncToken = {};
    return conv._asyncToken;
  }

  _invalidateAsync(conv) {
    if (conv) conv._asyncToken = {};
  }

  /** Post a webview message only when it belongs to the ACTIVE tab and, when
   * supplied, the same transcript generation. */
  _postFrom(convId, msg, asyncToken = null) {
    const conv = this._convs.get(convId);
    if (!conv) return;
    if (asyncToken && conv._asyncToken !== asyncToken) return;
    if (this._convs.activeId() === convId) this._post(msg);
  }

  /** Stop and forget one conversation's recurring /loop, if any. */
  _stopLoop(convId) {
    const state = this._loopTimers.get(convId);
    if (state) clearInterval(state.timer);
    this._loopTimers.delete(convId);
    return !!state;
  }

  /**
   * Detach a child before stopping it. The token invalidates late stdout/exit
   * callbacks from the old process so they cannot alter a newly spawned child
   * or bleed stale output into a reset conversation.
   */
  _stopSession(conv) {
    if (!conv) return false;
    const session = conv.session;
    const pendingApproval = conv.pendingApproval;
    conv._sessionToken = null;
    conv.sessionSlashCommands = null;
    conv.unconfirmedSessionSlashCommands = [];
    conv.turnActive = false;
    const clearedApproval = this._convs.clearApproval(conv.id);
    conv.plan = null;
    conv.planReviewTurn = 0;
    this._planReviews.delete(conv.id);
    this._convs.setSession(conv.id, null);
    session?.stop?.();
    if (pendingApproval?.kind === "approval" && pendingApproval.id) {
      this._postFrom(conv.id, {
        kind: "approval_done",
        id: pendingApproval.id,
        approved: false,
        via: "session-stopped",
      });
    }
    if (clearedApproval) this._postTabs();
    if (session) this._indexConversation(conv, "stopped");
    return !!session;
  }

  /** Clear state that belongs to a particular resumed session, not the tab. */
  _clearSessionState(conv, { clearGoal = false } = {}) {
    if (!conv) return;
    this._invalidateAsync(conv);
    this._stopLoop(conv.id);
    this._lastCallUsage.delete(conv.id);
    this._convs.resetTurnState(conv.id);
    this._convs.clearApproval(conv.id);
    conv.unread = false;
    conv.plan = null;
    conv.planReviewTurn = 0;
    conv.turnActive = false;
    this._planReviews.delete(conv.id);
    if (clearGoal) this._convs.setGoalCondition(conv.id, "");
  }

  /** Push the current tab set to the webview (the tab bar renders from this). */
  _postTabs() {
    this._post({
      kind: "tabs",
      tabs: this._convs.list(),
      activeId: this._convs.activeId(),
    });
    this._updateModeStatus(); // the active tab (hence its mode) may have changed
    this._persistTabs(); // every tab mutation flows through here
  }

  /** Event handler bound to one conversation: routes to ITS reducer state and
   * only surfaces when that conversation is the active tab. */
  _makeOnEvent(convId, sessionToken = null) {
    return (evt) => {
      const conv = this._convs.get(convId);
      if (!conv) return;
      if (sessionToken && conv._sessionToken !== sessionToken) return;
      if (evt?.type === "system" && evt.subtype === "init") {
        conv.sessionSlashCommands = Array.isArray(evt.slash_commands)
          ? evt.slash_commands.map((name) => String(name))
          : [];
        const pending = Array.isArray(conv.unconfirmedSessionSlashCommands)
          ? conv.unconfirmedSessionSlashCommands
          : [];
        const unsupported = [
          ...new Set(
            pending.filter(
              (name) => !conv.sessionSlashCommands.includes(String(name)),
            ),
          ),
        ];
        conv.unconfirmedSessionSlashCommands = [];
        if (unsupported.length) {
          this._postFrom(convId, {
            kind: "error",
            text:
              `${unsupported.map((name) => `/${name}`).join(", ")} requires ` +
              "a newer cc CLI. Upgrade the CLI, then retry.",
          });
        }
        if (evt.session_id) {
          this._convs.setSessionId(convId, evt.session_id);
          if (this._convs.activeId() === convId) {
            this._rememberSessionId(evt.session_id);
          }
          this._persistTabs(); // resume id changed without a tab-bar repost
          this._indexConversation(conv, "running");
        }
        if (evt.resumed_messages > 0) {
          this._postFrom(convId, {
            kind: "info",
            text: `resumed previous conversation (${evt.resumed_messages} messages)`,
          });
        }
      }
      // An LLM connection failure ("nothing configured / server down") OR an
      // auth failure (wrong/expired key, bare 401/403/unauthorized) usually
      // means setup is needed — surface the guided-setup card instead of a bare
      // error. The auth half mirrors the JetBrains panel's hint so a bare
      // "Anthropic error: 401" (no "api key" text) still triggers the card.
      if (evt?.type === "result" && evt.is_error) {
        const reason = String(evt.error || evt.result || "");
        if (
          /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(reason) ||
          looksLikeLlmConfigError(reason)
        ) {
          this._postFrom(convId, {
            kind: "setup",
            reason: String(evt.error || ""),
          });
        }
      }
      // Remember the latest per-call usage — the context indicator derives the
      // live context size from it without spawning `cc context` (see
      // _refreshContextStatus). result events follow the turn's token_usage
      // events, so by refresh time this is the turn's final call.
      if (
        evt?.type === "token_usage" &&
        evt.usage &&
        typeof evt.usage === "object"
      ) {
        this._lastCallUsage.set(convId, evt.usage);
      }
      if (
        evt?.type === "result" &&
        Number.isInteger(evt.turn) &&
        evt.turn > 0
      ) {
        conv.planReviewTurn = evt.turn;
      }
      // approve/revise/regenerate can optimistically mark a continuation turn
      // active before the CLI evaluates the plan. A plan_update with a note is
      // the CLI's terminal no-op/error acknowledgement, so no result event will
      // follow to clear the flag.
      if (evt?.type === "plan_update" && evt.note) {
        conv.turnActive = false;
      }
      const ui = mapAgentEvent(evt, conv.turnState);
      this._postFrom(convId, ui);
      if (ui?.kind === "plan") {
        conv.plan = ui;
        this._syncPlanReviewEditor(convId, ui).catch(() => {});
      }
      // Pending-approval signal: an approval landed in a tab you are NOT looking
      // at — the agent is BLOCKED on you. Flag it (a distinct dot from the green
      // "done" one) and remember the card so switching to the tab re-surfaces it.
      if (ui?.kind === "approval") {
        this._convs.setPendingApproval(convId, ui);
        this._indexConversation(conv, "waiting_approval");
        if (this._convs.markNeedsApproval(convId)) {
          this._postTabs();
          this._notifyApprovalPending(conv);
        }
      } else if (ui?.kind === "approval_done") {
        this._indexConversation(conv, "running");
        if (this._convs.clearApproval(convId)) this._postTabs();
      } else if (ui?.kind === "question") {
        // The agent called ask_user_question and is BLOCKED on the user. The
        // question renders as an IN-PANEL card (chat-html) with clickable options
        // / a text input — reliable + visible, unlike a native QuickPick which
        // can fail to surface when the webview has focus. The card was already
        // posted to the webview by _postFrom above IF this is the active tab; the
        // answer returns as a {type:"answer"} message (handled below).
        //
        // If the question landed in a BACKGROUND tab, _postFrom dropped it — so
        // route it through the same pending-approval machinery (dot + toast +
        // re-surface on switch) instead of letting the agent hang until its
        // user_timeout with no visible prompt anywhere.
        if (this._convs.activeId() !== convId) {
          this._convs.setPendingApproval(convId, ui);
          if (this._convs.markNeedsApproval(convId)) {
            this._postTabs();
            this._notifyApprovalPending(conv);
          }
        }
        this._indexConversation(conv, "waiting_approval");
      }
      if (evt?.type === "result") {
        conv.turnActive = false;
        this._indexConversation(conv, evt.is_error ? "errored" : "completed");
        // The turn is done — the CLI inlined any pasted images at turn start,
        // so their temp files are consumed and can be deleted now (they would
        // otherwise pile up in os.tmpdir() forever).
        this._cleanupImageTemps(convId);
        // Refresh the persistent context-window indicator for the active tab
        // (best-effort; reuses the CLI's authoritative window math).
        if (this._convs.activeId() === convId)
          this._refreshContextStatus(convId);
        // Background-tab completion signal: a turn just finished in a tab you are
        // NOT looking at (its stream was gated out of the visible transcript).
        // Flag it so the tab bar shows a dot, and offer a jump-to toast.
        else if (this._convs.markUnread(convId)) {
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
        p.then(
          (pick) => {
            if (pick === "Show") this._revealConversation(conv && conv.id);
          },
          () => {},
        );
      }
    } catch {
      /* notification is best-effort — never break the agent loop over a toast */
    }
  }

  /** Toast for an approval awaiting the user in a background tab (agent blocked). */
  _notifyApprovalPending(conv) {
    const win = this.vscode && this.vscode.window;
    const show = win && win.showWarningMessage;
    if (typeof show !== "function") return;
    const title = (conv && conv.title) || "Chat";
    try {
      const p = show.call(
        win,
        `ChainlessChain · "${title}" needs your approval`,
        "Show",
      );
      if (p && typeof p.then === "function") {
        p.then(
          (pick) => {
            if (pick === "Show") this._revealConversation(conv && conv.id);
          },
          () => {},
        );
      }
    } catch {
      /* best-effort — never break the agent loop over a toast */
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

  _planReviewTargetFromDocument(doc) {
    if (!doc?.uri) return null;
    const key = String(doc.uri.toString ? doc.uri.toString() : doc.uri);
    for (const [convId, review] of this._planReviews.entries()) {
      const uri = review?.document?.uri;
      const reviewKey = uri && String(uri.toString ? uri.toString() : uri);
      if (reviewKey === key) {
        const conv = this._convs.get(convId);
        if (conv) return { convId, conv, review };
      }
    }
    return null;
  }

  _planReviewTargetFromEditor() {
    return this._planReviewTargetFromDocument(
      this.vscode.window?.activeTextEditor?.document,
    );
  }

  updatePlanReviewContext() {
    const active = !!this._planReviewTargetFromEditor();
    try {
      this.vscode.commands
        ?.executeCommand?.(
          "setContext",
          "chainlesschainPlanReviewActive",
          active,
        )
        ?.then?.(undefined, () => {});
    } catch {
      /* context key is best-effort */
    }
  }

  _activePlanReviewTarget() {
    const fromEditor = this._planReviewTargetFromEditor();
    if (fromEditor) return fromEditor;
    const conv = this._activeConv();
    return {
      convId: conv.id,
      conv,
      review: this._planReviews.get(conv.id) || null,
    };
  }

  async _replacePlanReviewDocument(document, text) {
    const ws = this.vscode.workspace;
    if (
      !document ||
      !ws?.applyEdit ||
      !this.vscode.WorkspaceEdit ||
      !this.vscode.Range ||
      !this.vscode.Position
    ) {
      return false;
    }
    let end;
    try {
      end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
    } catch {
      end = new this.vscode.Position(0, 0);
    }
    const edit = new this.vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new this.vscode.Range(new this.vscode.Position(0, 0), end),
      text,
    );
    return ws.applyEdit(edit);
  }

  async _syncPlanReviewEditor(convId, plan) {
    const conv = this._convs.get(convId);
    if (!conv || !plan) return;
    const terminalState = ["rejected", "completed", "failed"].includes(
      plan.state,
    );
    if (!plan.active || terminalState) {
      const review = this._planReviews.get(convId);
      const currentText =
        review?.document?.getText?.() || review?.lastText || "";
      const mergedText = mergePlanReviewProgress(currentText, plan);
      if (review?.document && mergedText !== currentText) {
        await this._replacePlanReviewDocument(review.document, mergedText);
        review.lastText = mergedText;
      }
      const previous = findPersistedPlanReview(
        this._persistedPlanReviewStates,
        { sessionId: conv.sessionId, conversationId: conv.id },
      );
      const status = terminalState
        ? plan.state
        : previous?.action === "reject"
          ? "rejected"
          : "ended";
      this._persistPlanReviewState(conv, mergedText, plan, {
        status,
        action: previous?.action || plan.state || "ended",
      });
      return;
    }
    // Only steal focus for the tab the user is looking at. Background tabs keep
    // their plan snapshot, and the editor opens when that tab becomes active.
    if (this._convs.activeId() !== convId) return;
    const ws = this.vscode.workspace;
    const win = this.vscode.window;
    if (!ws?.openTextDocument || !win?.showTextDocument) return;

    const existing = this._planReviews.get(convId);
    const previousPlan = existing?.lastPlan;
    if (
      existing &&
      !existing.revisionBase &&
      plan.previous_plan_id &&
      (previousPlan?.plan_id || previousPlan?.planId) === plan.previous_plan_id
    ) {
      existing.revisionBase = sanitizePlanSnapshot(previousPlan);
    }
    let text = formatPlanReviewMarkdown(plan, {
      conversationTitle: conv.title,
      sessionId: conv.sessionId,
      updatedAt: new Date(),
    });
    if (existing?.revisionBase) {
      text = mergePlanRevisionDiff(text, existing.revisionBase, plan);
    }
    if (!existing?.document) {
      const initialText = existing?.lastText || text;
      const document = await ws.openTextDocument({
        content: initialText,
        language: "markdown",
      });
      await win.showTextDocument(document, {
        preview: false,
        viewColumn: this.vscode.ViewColumn?.Beside,
      });
      this._planReviews.set(convId, {
        document,
        lastText: initialText,
        lastPlan: plan,
        revisionBase: existing?.revisionBase || null,
        hasReviewerEdits: existing?.hasReviewerEdits === true,
      });
      this._persistPlanReviewState(conv, initialText, plan, {
        status: ["approved", "executing"].includes(plan.state)
          ? "executing"
          : "draft",
      });
      this.updatePlanReviewContext();
      this._post({
        kind: "info",
        text: "opened plan review editor tab",
      });
      return;
    }

    const currentText =
      typeof existing.document.getText === "function"
        ? existing.document.getText()
        : existing.lastText;
    if (currentText !== existing.lastText) {
      // Preserve reviewer edits/inline notes; do not overwrite a dirty review.
      existing.hasReviewerEdits = true;
    }
    if (existing.hasReviewerEdits) {
      let merged = mergePlanReviewProgress(currentText, plan);
      if (existing.revisionBase) {
        merged = mergePlanRevisionDiff(merged, existing.revisionBase, plan);
      }
      let persistedText = merged;
      if (merged !== currentText) {
        const ok = await this._replacePlanReviewDocument(
          existing.document,
          merged,
        );
        if (!ok) {
          existing.pendingText = merged;
          persistedText = currentText;
        }
      }
      existing.lastText = persistedText;
      this._persistPlanReviewState(conv, persistedText, plan, {
        status: ["approved", "executing"].includes(plan.state)
          ? "executing"
          : "draft",
      });
      existing.lastPlan = plan;
      return;
    }
    if (existing.lastText !== text) {
      const ok = await this._replacePlanReviewDocument(existing.document, text);
      if (ok) existing.lastText = text;
      else existing.pendingText = text;
    }
    this._persistPlanReviewState(conv, existing.lastText || currentText, plan, {
      status: ["approved", "executing"].includes(plan.state)
        ? "executing"
        : "draft",
    });
    existing.lastPlan = plan;
  }

  _persistPlanReviewState(
    conv,
    documentText,
    plan,
    { status = "draft", action = "" } = {},
  ) {
    if (!conv) return null;
    const previous = findPersistedPlanReview(this._persistedPlanReviewStates, {
      sessionId: conv.sessionId,
      conversationId: conv.id,
    });
    const next = buildPersistedPlanReview({
      documentText,
      conversationId: conv.id,
      conversationTitle: conv.title,
      sessionId: conv.sessionId,
      plan,
      status,
      action,
      previous,
      turn: conv.planReviewTurn,
    });
    if (!next) return null;
    this._persistedPlanReviewStates = upsertPersistedPlanReview(
      this._persistedPlanReviewStates,
      next,
    );
    this.opts.state?.update?.(
      PLAN_REVIEW_STATES_KEY,
      this._persistedPlanReviewStates,
    );
    return next;
  }

  _restorePlanReviewState(conv) {
    if (!conv) return null;
    const state = findPersistedPlanReview(this._persistedPlanReviewStates, {
      sessionId: conv.sessionId,
      conversationId: conv.id,
    });
    if (!state) return null;
    conv.planReviewTurn = Math.max(
      Number(conv.planReviewTurn) || 0,
      ...(state.comments || []).map((comment) => Number(comment.turn) || 0),
    );
    const terminal = [
      "approved",
      "rejected",
      "completed",
      "failed",
      "ended",
    ].includes(state.status);
    conv.plan = {
      kind: "plan",
      ...state.plan,
      active: terminal ? false : state.plan.active,
      state: terminal ? state.status : state.plan.state,
      persistedRevision: state.revision,
    };
    if (!terminal && conv.plan.active) {
      this._planReviews.set(conv.id, {
        document: null,
        lastText: state.snapshot,
        lastPlan: conv.plan,
        persistedState: state,
        hasReviewerEdits: state.comments?.length > 0,
      });
    }
    return state;
  }

  _flushPlanReviewDrafts() {
    for (const [convId, review] of this._planReviews.entries()) {
      const conv = this._convs.get(convId);
      if (!conv) continue;
      const text = review?.document?.getText?.() || review?.lastText || "";
      const plan = conv.plan || review?.lastPlan;
      const terminal = ["rejected", "completed", "failed"].includes(
        plan?.state,
      );
      const previous = findPersistedPlanReview(
        this._persistedPlanReviewStates,
        {
          sessionId: conv.sessionId,
          conversationId: conv.id,
        },
      );
      const submitted = !terminal && previous?.status === "decision_submitted";
      this._persistPlanReviewState(conv, text, plan, {
        status: terminal
          ? plan.state
          : submitted
            ? "decision_submitted"
            : ["approved", "executing"].includes(plan?.state)
              ? "executing"
              : "draft",
        action: terminal ? plan.state : submitted ? previous.action : "",
      });
    }
  }

  _recordPlanReview(record) {
    const KEY = "chainlesschain.chat.planReviews";
    const cur = this.opts.state?.get?.(KEY);
    const list = Array.isArray(cur) ? cur.slice(-19) : [];
    list.push(record);
    this.opts.state?.update?.(KEY, list);
  }

  async reviewPlan(action) {
    const normalized = String(action || "").trim();
    if (
      !["approve", "reject", "requestChanges", "regenerate"].includes(
        normalized,
      )
    ) {
      this._post({
        kind: "info",
        text: `unknown plan review action "${action}"`,
      });
      return false;
    }
    const target = this._activePlanReviewTarget();
    const { conv, review } = target;
    const session = conv?.session;
    if (!session?.running) {
      this._post({
        kind: "error",
        text: "plan review needs a running agent session",
      });
      return false;
    }
    const document = review?.document;
    const documentText =
      (document && typeof document.getText === "function"
        ? document.getText()
        : review?.lastText) ||
      formatPlanReviewMarkdown(conv.plan || {}, {
        conversationTitle: conv.title,
        sessionId: conv.sessionId,
      });
    const record = buildPlanReviewRecord({
      action: normalized,
      documentText,
      conversationId: conv.id,
      conversationTitle: conv.title,
      sessionId: conv.sessionId,
      plan: conv.plan || review?.lastPlan,
      turn: conv.planReviewTurn,
      permissionMode: conv.mode || "default",
      revision: this._persistPlanReviewState(
        conv,
        documentText,
        conv.plan || review?.lastPlan,
        {
          status:
            normalized === "approve" || normalized === "reject"
              ? "decision_submitted"
              : "changes_requested",
          action: normalized,
        },
      )?.revision,
    });
    this._recordPlanReview(record);

    if (normalized === "approve" || normalized === "reject") {
      const ok = session.sendEvent({
        type: "plan",
        action: normalized,
        review: record,
      });
      this._post({
        kind: ok ? "info" : "error",
        text: ok
          ? `plan ${normalized === "approve" ? "approved" : "rejected"} from review editor`
          : "could not send plan review decision",
      });
      if (ok) {
        if (normalized === "approve") conv.turnActive = true;
        this._indexConversation(
          conv,
          normalized === "reject" ? "stopped" : "running",
        );
      }
      return ok;
    }

    if (review) {
      review.revisionBase = sanitizePlanSnapshot(conv.plan || review.lastPlan);
    }
    const ok = session.sendEvent({
      type: "plan",
      action: normalized === "requestChanges" ? "revise" : "regenerate",
      review: record,
    });
    this._post({
      kind: ok ? "info" : "error",
      text: ok
        ? normalized === "regenerate"
          ? "requested a regenerated plan from review editor"
          : "sent plan review comments to the agent"
        : "could not send plan review comments",
    });
    if (ok) {
      conv.turnActive = true;
      this._indexConversation(conv, "running");
    }
    return ok;
  }

  /**
   * /handoff — hand this tab's conversation off to a DETACHED background
   * agent (`cc agent --bg --resume <id>`), so it keeps running without the
   * IDE and can be continued from the web panel's Background Agents view
   * (browser/phone), `cc attach <id>`, or either IDE's Background Agents
   * panel. The live panel child is stopped first — the background worker
   * becomes the session's single writer.
   */
  async _handoffSession() {
    const conv = this._activeConv();
    if (!conv.sessionId) {
      this._post({
        kind: "info",
        text: "nothing to hand off yet — send a message first",
      });
      return;
    }
    const raw = await this.vscode.window.showInputBox({
      prompt: "Task for the background agent to continue with",
      value: "Continue the current task.",
    });
    const prompt = typeof raw === "string" ? raw.trim() : "";
    if (!prompt) return;
    // A recurring /loop would otherwise restart the foreground child after
    // handoff and create two writers for the same resumed session.
    this._stopLoop(conv.id);
    if (conv.session?.running) {
      this._stopSession(conv);
    }
    this._post({ kind: "info", text: "handing off to a background agent…" });
    const { runHandoff, formatHandoffNote } =
      this.opts.deps?.remoteHandoff || require("./remote-handoff");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const res = await runHandoff({
      command: this._cliCommand(),
      sessionId: conv.sessionId,
      prompt,
      cwd: folders[0]?.uri?.fsPath,
    });
    if (!res.ok) {
      this._post({ kind: "error", text: `handoff failed: ${res.error}` });
      return;
    }
    // The session is running again — as a background agent.
    this._indexConversation(conv, "running");
    this._post({ kind: "info", text: formatHandoffNote(res.state) });
  }

  /**
   * A `chainlesschain.chat.model` / `.provider` setting, sanitized before it is
   * interpolated into a Windows shell argv (the .cmd shims force `shell:true`,
   * where metacharacters can't be quoted). These settings are `window`-scoped,
   * so a workspace `.vscode/settings.json` — shared or from a cloned repo — can
   * set them; a value like `x & calc` would otherwise run `calc`, and the
   * context-status refresh fires after every turn. Legitimate model/provider ids
   * never contain shell metacharacters, so an unsafe value is dropped (the CLI
   * then falls back to the configured default) and the user is warned once.
   */
  _safeLlmSetting(kind, value) {
    const v = value == null ? "" : String(value);
    if (!v) return v;
    if (hasUnsafeShellChars(v)) {
      if (!this._warnedUnsafeLlm) {
        this._warnedUnsafeLlm = new Set();
      }
      if (!this._warnedUnsafeLlm.has(kind)) {
        this._warnedUnsafeLlm.add(kind);
        try {
          this.vscode.window?.showWarningMessage?.(
            `ChainlessChain: ignoring unsafe chainlesschain.chat.${kind} setting ` +
              `("${v}") — it contains shell metacharacters. Using the cc config default.`,
          );
        } catch {
          /* best-effort */
        }
      }
      return "";
    }
    return v;
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
    // Pin the effective provider/model (panel override, else the user's
    // cc config) so the panel deterministically uses the SAME LLM as the
    // terminal `cc` — never drifts to a stale ambient default.
    const llm = this._resolveChatLlm({
      provider: this._safeLlmSetting("provider", chatCfg.get("provider")),
      model: this._safeLlmSetting("model", chatCfg.get("model")),
    });
    // Declare the session id UP FRONT: anonymous stream sessions are
    // persistence-free by CLI design, so a first conversation spawned
    // without an id was never written — an IDE reload's --resume of the id
    // captured from system/init then silently started EMPTY, losing all
    // pre-reload context. --resume with a fresh id creates + persists it.
    if (!conv.sessionId) {
      conv.sessionId = `panel-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      this._persistTabs();
      this._indexConversation(conv, "running");
    }
    const sessionToken = {};
    conv._sessionToken = sessionToken;
    conv.sessionSlashCommands = null;
    conv.unconfirmedSessionSlashCommands = [];
    let session;
    let exited = false;
    session = this._createSession({
      command: this._cliCommand(),
      args: [
        ...buildSessionArgs({
          ...llm,
          // Continue THIS tab's conversation across child restarts; the id is
          // panel-generated on first spawn (created + persisted by the CLI).
          resume: conv.sessionId,
          // Approval mode (/auto, /bypass, /normal) — flag is spawn-time, so a
          // mode change stops the child and the next turn respawns with it.
          mode: conv.mode,
          // Extended thinking (/think, /ultrathink) — same spawn-time story;
          // "off" adds nothing, Anthropic-only (other providers ignore it).
          think: conv.thinking,
          goalCondition: conv.goalCondition,
        }),
        // Confirm-tier approvals become Approve/Deny cards in the panel
        // instead of failing closed (needs cc >= 0.162.45).
        "--interactive-approvals",
      ],
      cwd,
      // CC_INTERACTIVE_QUESTIONS opts the child into the ask_user_question
      // round-trip (QuickPick); an old `cc` simply ignores the env var.
      // CC_API_KEY carries the key OFF the command line (argv is readable by
      // every same-user process); buildSessionArgs still passes --api-key for
      // CLIs predating the env fallback — drop that once MIN_CLI_VERSION
      // reaches the first cc release that reads CC_API_KEY.
      env: {
        ...process.env,
        ...bridgeEnv,
        CC_INTERACTIVE_QUESTIONS: "1",
        CC_TOOL_ADMISSION: JSON.stringify(
          buildIdeToolAdmission("vscode-extension"),
        ),
        // Lean context (chainlesschain.chat.leanContext, default on): trim the
        // auto-loaded project memory injected into the system prompt on EVERY
        // turn. "lean" keeps the primary ENTRY instruction file (cc.md/CLAUDE.md)
        // but sheds the heavy companions — CLAUDE.local.md (gitignored personal
        // status), .claude/rules/*.md, and .chainlesschain/rules.md — which in a
        // doc-heavy monorepo re-cost ~8k+ tokens/message on a paid provider. The
        // agent can still READ any of those with its tools when a task needs
        // them. Delivered via the CC_PROJECT_MEMORY env var (not a CLI flag) so
        // an older `cc` that predates lean mode simply falls back to FULL memory
        // (safe: no crash, just no savings) instead of erroring on an unknown
        // flag. Scoped to the panel child only — terminal `cc` is untouched.
        ...(chatCfg.get("leanContext") !== false
          ? { CC_PROJECT_MEMORY: "lean" }
          : {}),
        ...(llm.apiKey ? { CC_API_KEY: String(llm.apiKey) } : {}),
      },
      onEvent: this._makeOnEvent(conv.id, sessionToken),
      onStderr: (line) => {
        if (conv._sessionToken === sessionToken) {
          this._postFrom(conv.id, { kind: "stderr", text: line });
        }
      },
      onExit: ({ code }) => {
        exited = true;
        const current = this._convs.get(conv.id);
        if (!current || current._sessionToken !== sessionToken) {
          return;
        }
        current._sessionToken = null;
        current.sessionSlashCommands = null;
        current.unconfirmedSessionSlashCommands = [];
        current.turnActive = false;
        this._convs.setSession(conv.id, null);
        this._indexConversation(current, "stopped");
        this._postFrom(conv.id, { kind: "exited", code });
      },
    });
    if (exited || conv._sessionToken !== sessionToken) return session;
    this._convs.setSession(conv.id, session);
    this._indexConversation(conv, "running");
    if (typeof this.opts.log === "function") {
      this.opts.log(`chat: spawned ${this._cliCommand()} agent (cwd ${cwd})`);
    }
    return session;
  }

  /**
   * /sessions — native QuickPick over `cc session list` merged with the shared
   * IDE index, then a second action pick: resume (default), rename or delete.
   * Status + workspace ride along in the rows so cross-workspace sessions are
   * searchable (matchOnDescription/matchOnDetail cover them).
   */
  async _pickSession() {
    const { listSessions } = require("./session-list");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const items = await listSessions({
      command: this._cliCommand(),
      cwd: folders[0]?.uri?.fsPath,
      includeIdeIndex: true,
    });
    if (!items.length) {
      this._post({ kind: "info", text: "no saved sessions found" });
      return;
    }
    const pick = await this.vscode.window.showQuickPick(
      items.map((s) => ({
        label: s.id,
        description:
          s.store +
          (s.status ? " · " + s.status : "") +
          (s.updatedAt ? " · " + s.updatedAt : ""),
        detail: [s.title, s.workspace].filter(Boolean).join(" · ") || undefined,
        session: s,
      })),
      {
        placeHolder: "Pick a session to resume, rename or delete",
        // The label is only the session id; let the user also search by title/
        // workspace (detail) and store/status/date (description), not just the
        // opaque id.
        matchOnDetail: true,
        matchOnDescription: true,
      },
    );
    if (!pick) return;
    const action = await this.vscode.window.showQuickPick(
      [
        {
          label: "$(debug-continue) Resume in this tab",
          action: "resume",
          description: "next message continues " + pick.label,
        },
        { label: "$(edit) Rename", action: "rename" },
        { label: "$(trash) Delete", action: "delete" },
      ],
      { placeHolder: pick.label },
    );
    if (!action) return;
    if (action.action === "rename") return this._renameSession(pick.session);
    if (action.action === "delete") return this._deleteSession(pick.session);
    this.resumeSessionId(pick.label);
  }

  /**
   * Arm the ACTIVE conversation to resume `sessionId` on its next message
   * (shared by the /sessions picker and the deep-link handler). Stops any live
   * child, repoints the tab's session id, persists it (so a reload before the
   * next message keeps the pick), and resets the transcript view.
   */
  resumeSessionId(sessionId) {
    const id = String(sessionId || "").trim();
    if (!id) return;
    const conv = this._activeConv();
    this._flushPlanReviewDrafts();
    this._stopSession(conv);
    this._clearSessionState(conv, { clearGoal: true });
    this._convs.setSessionId(conv.id, id);
    this._rememberSessionId(id);
    this._indexConversation(conv, "stopped");
    // Persist the picked resume id: the tabs blob (written on every mutation) is
    // preferred over the legacy single-session key on restore, so without this a
    // window reload before the next message would restore the tab's OLD id and
    // the pick would silently vanish.
    this._postTabs();
    this._post({ kind: "reset" });
    this._post({
      kind: "info",
      text: `will resume ${id} — send a message to continue it`,
    });
  }

  /**
   * Open `file` (resolved against the workspace when relative) and, when given,
   * reveal 1-based `line`. Deep-link entry point; tolerant of a missing file.
   */
  async openFileAtLine(file, line) {
    const raw = String(file || "").trim();
    if (!raw) return;
    const ws = this.vscode.workspace;
    const win = this.vscode.window;
    if (!ws?.openTextDocument || !win?.showTextDocument) return;
    // Deep links are untrusted input (any web page can mint one): contain the
    // target to the open workspace folders, same boundary as the MCP tools.
    // Without this, `vscode://…/open?file=C:\Users\me\.ssh\id_rsa` opens any
    // readable file in the editor. Rejects UNC/device paths and `..` escapes.
    const { validateIdeToolPath } = require("../ide-path-guard");
    const folders = (ws.workspaceFolders || [])
      .map((f) => f?.uri?.fsPath)
      .filter(Boolean);
    const v = validateIdeToolPath(raw, folders);
    if (!v.ok) {
      this._post?.({
        kind: "error",
        text: `deep link file rejected (outside the open workspace): ${raw}`,
      });
      return;
    }
    const abs = v.resolved;
    try {
      const doc = await ws.openTextDocument(abs);
      const opts = { preview: false };
      if (Number.isInteger(line) && line >= 1) {
        const pos = new this.vscode.Position(line - 1, 0);
        opts.selection = new this.vscode.Range(pos, pos);
      }
      await win.showTextDocument(doc, opts);
    } catch (err) {
      this._post?.({
        kind: "error",
        text: `deep link could not open ${abs}: ${err.message}`,
      });
    }
  }

  /** Public wrapper for the deep-link handler: apply a (pre-vetted) approval
   *  mode to the active conversation. */
  applyApprovalMode(mode) {
    this._setMode(String(mode || "default"));
  }

  /**
   * Rename a picked session. The title lives in the shared IDE index as an
   * overlay — the picker merge prefers it, so this also "renames" sessions
   * that only exist in the CLI store (which has no rename command).
   */
  async _renameSession(s) {
    const raw = await this.vscode.window.showInputBox({
      prompt: `New title for ${s.id}`,
      value: s.title || "",
    });
    const title = typeof raw === "string" ? raw.trim() : "";
    if (!title) return;
    try {
      const { renameIdeSessionRecord } = require("./ide-session-index");
      renameIdeSessionRecord(s.id, title);
      this._post({ kind: "info", text: `renamed ${s.id} → "${title}"` });
    } catch (err) {
      this._post({ kind: "error", text: `rename failed: ${err.message}` });
    }
  }

  /**
   * Delete a picked session: `cc session delete --force` removes the CLI
   * transcript, and the shared IDE index entry is pruned so the other IDE's
   * picker stops offering it. Tabs pointing at the id lose their resume id
   * (otherwise the next message would --resume a deleted session).
   */
  async _deleteSession(s) {
    const proceed = await this.vscode.window.showWarningMessage(
      `Delete session ${s.id}? Its saved transcript is removed. This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (proceed !== "Delete") return;
    const { deleteCliSession } = require("./session-list");
    const { removeIdeSessionRecord } = require("./ide-session-index");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cliDeleted = await deleteCliSession({
      command: this._cliCommand(),
      id: s.id,
      cwd: folders[0]?.uri?.fsPath,
    });
    let indexDeleted = false;
    try {
      indexDeleted = removeIdeSessionRecord(s.id);
    } catch {
      /* index prune is best-effort */
    }
    for (const conv of this._convs.list()) {
      if (conv.sessionId === s.id) this._convs.setSessionId(conv.id, null);
    }
    this._persistTabs();
    this._post({
      kind: "info",
      text:
        cliDeleted || indexDeleted
          ? `deleted session ${s.id}`
          : `could not delete ${s.id} (not found in CLI store or IDE index)`,
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
    this._updateModeStatus();
    const restarted = !!conv.session?.running;
    if (restarted) {
      this._stopSession(conv);
    }
    this._post({
      kind: "info",
      text:
        `approval mode → ${LABELS[mode]}` +
        (restarted ? " (applies on your next message)" : ""),
    });
    this._persistTabs();
  }

  /**
   * /think · /ultrathink · /think-off — toggle Anthropic extended thinking for
   * the ACTIVE conversation. Like the approval mode, the flag is spawn-time, so
   * a live child is stopped and the next message respawns with it (session id
   * preserved). Non-Anthropic providers ignore the flag.
   */
  _setThinking(level) {
    const LABELS = {
      off: "off",
      on: "on",
      ultra: "ultra (max budget)",
    };
    if (!Object.prototype.hasOwnProperty.call(LABELS, level)) {
      this._post({ kind: "info", text: `unknown thinking level "${level}"` });
      return;
    }
    const conv = this._activeConv();
    this._convs.setThinking(conv.id, level);
    const restarted = !!conv.session?.running;
    if (restarted) {
      this._stopSession(conv);
    }
    this._post({
      kind: "info",
      text:
        `extended thinking → ${LABELS[level]}` +
        (restarted ? " (applies on your next message)" : ""),
    });
    this._persistTabs();
  }

  _setGoalCondition(spec) {
    const conv = this._activeConv();
    const value = String(spec || "").trim();
    if (!value) {
      this._post({
        kind: "info",
        text: conv.goalCondition
          ? `session goal: ${conv.goalCondition}`
          : "no session goal; use /goal <condition>",
      });
      return;
    }
    if (/^(clear|off|none)$/i.test(value)) {
      this._convs.setGoalCondition(conv.id, "");
      if (conv.session?.running) this._stopSession(conv);
      this._persistTabs();
      this._post({ kind: "info", text: "session goal cleared" });
      return;
    }
    this._convs.setGoalCondition(conv.id, value);
    if (conv.session?.running) {
      this._stopSession(conv);
    }
    this._persistTabs();
    this._post({
      kind: "info",
      text: `session goal set: ${value} (applies on the next message; /goal clear to drop)`,
    });
  }

  _setLoop(spec) {
    const conv = this._activeConv();
    const value = String(spec || "").trim();
    const old = this._loopTimers.get(conv.id);
    if (/^(stop|clear|off)$/i.test(value)) {
      this._stopLoop(conv.id);
      this._post({ kind: "info", text: "/loop stopped" });
      return;
    }
    const m = /^(?:(\d+(?:\.\d+)?)(s|m|h)\s+)?(.+)$/i.exec(value);
    if (!m || !m[3].trim()) {
      this._post({
        kind: "info",
        text: "usage: /loop [30s|5m|1h] <prompt> · /loop stop",
      });
      return;
    }
    const intervalMs = Math.min(
      24 * 60 * 60 * 1000,
      Math.max(
        1000,
        Number(m[1] || 300) *
          { s: 1000, m: 60000, h: 3600000 }[m[2]?.toLowerCase() || "s"],
      ),
    );
    const prompt = m[3].trim();
    if (old) this._stopLoop(conv.id);
    const timer = setInterval(() => {
      if (!this._convs.has(conv.id)) return;
      this._handleMessage({ type: "switchTab", id: conv.id });
      this._handleMessage({ type: "send", text: prompt });
    }, intervalMs);
    this._loopTimers.set(conv.id, { timer, intervalMs, prompt });
    this._handleMessage({ type: "send", text: prompt });
    this._post({
      kind: "info",
      text: `/loop started: every ${m[1] || 300}${m[2] || "s"} · /loop stop to stop`,
    });
  }

  /**
   * Reload after a Configure-LLM change. The LLM config is GLOBAL
   * (~/.chainlesschain/config.json), so EVERY spawned child holds the stale
   * provider/model/key until it respawns — a child started with bad config
   * keeps erroring even after you fix it (the "配置完还没用 / a new conversation
   * works" symptom). Stop all running children so each conversation's next
   * message respawns with the new config (session id preserved → context kept).
   */
  _reloadLlmConfig() {
    // The model (hence its context-window size) may have changed — drop the
    // cached window so the next indicator refresh re-probes the CLI.
    this._ctxWindowCache = null;
    let restartedActive = false;
    for (const summary of this._convs.list()) {
      const conv = this._convs.get(summary.id);
      if (!conv) continue;
      this._invalidateAsync(conv);
      this._lastCallUsage.delete(conv.id);
      if (conv.session && conv.session.running) {
        this._stopSession(conv);
        if (conv.id === this._convs.activeId()) restartedActive = true;
      }
    }
    this._post({
      kind: "info",
      text:
        "LLM config updated" +
        (restartedActive ? " — applies on your next message" : ""),
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
      const m =
        /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
          String((img && img.data) || ""),
        );
      if (!m) continue;
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const file = path.join(
        os.tmpdir(),
        `cc-chat-img-${Date.now()}-${(this._imgSeq = (this._imgSeq || 0) + 1)}.${ext}`,
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
   * Delete the temp image files recorded for a conversation (or all of them
   * when convId is omitted, e.g. on dispose). Best-effort — a file the CLI
   * still holds open on Windows just stays until the next cleanup.
   */
  _cleanupImageTemps(convId) {
    const map = this._imgTemps;
    if (!map || map.size === 0) return;
    const fs = require("fs");
    const keys = convId != null ? [convId] : [...map.keys()];
    for (const k of keys) {
      for (const file of map.get(k) || []) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* already gone / still locked — best-effort */
        }
      }
      map.delete(k);
    }
  }

  /**
   * Workspace files for @-mention completion. The full listing is fetched
   * once per provider (5k cap, heavy dirs excluded) and filtered per
   * keystroke in-process; "New" invalidates it so fresh files show up.
   */
  async _listWorkspaceFiles(prefix) {
    const { filterFiles, deriveFolders } = require("./at-mention");
    // TTL refresh: long sessions used to keep the very first scan forever, so
    // files created mid-conversation never showed up in @-completion unless
    // the user hit "New". 30s keeps per-keystroke filtering instant while new
    // files appear on the next popup soon after they exist.
    const TTL_MS = 30_000;
    if (this._fileCache && Date.now() - (this._fileCacheAt || 0) > TTL_MS) {
      this._fileCache = null;
    }
    if (!this._fileCache) {
      this._fileCacheAt = Date.now();
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
          const files = (uris || []).map((u) => {
            let p = u.fsPath || "";
            if (root && p.startsWith(root)) p = p.slice(root.length + 1);
            return p.replace(/\\/g, "/");
          });
          // Offer the ancestor folders (as `@folder/`) ahead of the files, so
          // typing "@src" surfaces the directory too — the CLI expands a folder
          // ref into a bounded tree. findFiles never returns directories, so we
          // derive them from the file listing.
          return deriveFolders(files, 2000).concat(files);
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
    const conv = this._activeConv();
    const convId = conv.id;
    const asyncToken = this._asyncToken(conv);
    const id = conv.sessionId;
    if (!id) {
      this._postFrom(
        convId,
        {
          kind: "info",
          text: `/${kind}: send a message first — no session yet.`,
        },
        asyncToken,
      );
      return;
    }
    const introspect = require("./introspect-commands");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const chatCfg = this.vscode.workspace.getConfiguration(
      "chainlesschain.chat",
    );
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    const args = introspect.buildIntrospectArgs(
      kind,
      id,
      this._resolveChatLlm({
        model: this._safeLlmSetting("model", chatCfg.get("model")),
        provider: this._safeLlmSetting("provider", chatCfg.get("provider")),
      }),
    );
    try {
      const options = {
        command: this._cliCommand(),
        args,
        cwd,
        env: { ...process.env, ...bridgeEnv },
      };
      let result;
      if (typeof this.opts.deps?.runCliResult === "function") {
        result = await this.opts.deps.runCliResult(options);
      } else if (typeof this.opts.deps?.runCliText === "function") {
        const text = await this.opts.deps.runCliText(options);
        result = { ok: true, text: String(text || "") };
      } else {
        result = await introspect.runCliResult(options);
      }
      if (result?.ok === true) {
        this._postFrom(
          convId,
          {
            kind: "pre",
            text: result.text || `/${kind}: (no output)`,
          },
          asyncToken,
        );
        return;
      }
      const detail = result?.timedOut
        ? `/${kind} timed out`
        : result?.text || result?.error || `/${kind} failed`;
      this._postFrom(
        convId,
        { kind: "error", text: String(detail) },
        asyncToken,
      );
    } catch (err) {
      this._postFrom(
        convId,
        {
          kind: "error",
          text: `/${kind} failed: ${err?.message || err}`,
        },
        asyncToken,
      );
    }
  }

  _validateCliSlashArgs(command, args) {
    if (command === "changelog") return null;
    if (command === "init") {
      const templates = new Set([
        "code-project",
        "data-science",
        "devops",
        "medical-triage",
        "agriculture-expert",
        "general-assistant",
        "ai-media-creator",
        "ai-doc-creator",
        "empty",
      ]);
      const flags = new Set(["--force", "--memory", "--yes", "-y", "--bare"]);
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (flags.has(arg)) continue;
        const inlineTemplate = /^--template=(.+)$/.exec(arg);
        if (inlineTemplate) {
          if (!templates.has(inlineTemplate[1])) {
            return `unknown /init template "${inlineTemplate[1]}"`;
          }
          continue;
        }
        if (arg === "--template" || arg === "-t") {
          const template = args[i + 1];
          if (!templates.has(template)) {
            return `unknown /init template "${template || ""}"`;
          }
          i += 1;
          continue;
        }
        return (
          `unsupported /init argument "${arg}". ` +
          "Use --force, --memory, --yes, --bare, or --template <name>."
        );
      }
      return null;
    }
    if (command === "plugin") {
      if (args.length === 0) return null;
      const defaultListFlags = new Set(["--enabled", "--json"]);
      if (args[0].startsWith("-")) {
        return args.every((arg) => defaultListFlags.has(arg))
          ? null
          : "/plugin list only accepts --enabled and --json in chat.";
      }
      const [subcommand, ...rest] = args;
      const onlyFlags = (allowed) => rest.every((arg) => allowed.has(arg));
      const onePositionalAndJson = () => {
        let positional = 0;
        for (const arg of rest) {
          if (arg === "--json") continue;
          if (arg.startsWith("-")) return false;
          positional += 1;
        }
        return positional === 1;
      };
      if (subcommand === "list") {
        return onlyFlags(defaultListFlags)
          ? null
          : "/plugin list only accepts --enabled and --json in chat.";
      }
      if (["registry", "summary", "installed"].includes(subcommand)) {
        return onlyFlags(new Set(["--json"]))
          ? null
          : `/plugin ${subcommand} only accepts --json in chat.`;
      }
      if (["info", "search"].includes(subcommand)) {
        return onePositionalAndJson()
          ? null
          : `/plugin ${subcommand} requires one name/query and optional --json.`;
      }
      if (subcommand === "options") {
        return onePositionalAndJson()
          ? null
          : "/plugin options is read-only in chat: use one plugin name and optional --json; run --set/--scope in a terminal.";
      }
      if (subcommand === "monitors") {
        return onlyFlags(new Set(["--json"]))
          ? null
          : "/plugin monitors is list-only in chat: --run/--seconds must be run explicitly in a terminal.";
      }
      if (subcommand === "browse") {
        let queryCount = 0;
        let registryCount = 0;
        for (let i = 0; i < rest.length; i += 1) {
          const arg = rest[i];
          if (arg === "--json") continue;
          if (arg === "--registry") {
            const value = rest[i + 1];
            if (!value || value.startsWith("-")) {
              return "/plugin browse requires --registry <url>.";
            }
            registryCount += 1;
            i += 1;
            continue;
          }
          if (/^--registry=.+/.test(arg)) {
            registryCount += 1;
            continue;
          }
          if (arg.startsWith("-")) {
            return "/plugin browse only accepts an optional query, --registry <url>, and --json in chat; use tokens or insecure registries explicitly in a terminal.";
          }
          queryCount += 1;
        }
        return registryCount === 1 && queryCount <= 1
          ? null
          : "/plugin browse requires exactly one --registry <url> and at most one query.";
      }
      return (
        `/${command} "${subcommand}" changes local plugin state and is not ` +
        "available from chat; run it explicitly in a terminal."
      );
    }
    return `unsupported panel CLI command: ${command}`;
  }

  async _runCliCommand(command, rawArgs = "") {
    const conv = this._activeConv();
    const convId = conv.id;
    const asyncToken = this._asyncToken(conv);
    const name = String(command || "").trim();
    const def = COMMAND_DEFS.find(
      (item) => item.route === "cli" && item.command === name,
    );
    if (!def) {
      this._postFrom(convId, {
        kind: "error",
        text: `unsupported panel CLI command: ${name || "(empty)"}`,
      });
      return false;
    }
    if (typeof rawArgs === "string" && rawArgs.length > 8192) {
      this._postFrom(convId, {
        kind: "error",
        text: `/${name}: arguments are too long`,
      });
      return false;
    }
    const parsed = Array.isArray(rawArgs)
      ? { args: rawArgs.map((arg) => String(arg)), error: null }
      : splitSlashArgs(rawArgs);
    if (parsed.error || parsed.args.length > 64) {
      this._postFrom(convId, {
        kind: "error",
        text: `/${name}: ${parsed.error || "too many arguments"}`,
      });
      return false;
    }
    const validationError = this._validateCliSlashArgs(name, parsed.args);
    if (validationError) {
      this._postFrom(convId, { kind: "error", text: validationError });
      return false;
    }

    const introspect = require("./introspect-commands");
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    const options = {
      command: this._cliCommand(),
      args: [name, ...parsed.args],
      cwd,
      env: { ...process.env, ...bridgeEnv },
    };
    try {
      let result;
      if (typeof this.opts.deps?.runCliResult === "function") {
        result = await this.opts.deps.runCliResult(options);
      } else if (typeof this.opts.deps?.runCliText === "function") {
        const text = await this.opts.deps.runCliText(options);
        result = { ok: true, text: String(text || "") };
      } else {
        result = await introspect.runCliResult(options);
      }
      if (result?.ok === true) {
        this._postFrom(
          convId,
          {
            kind: "pre",
            text: result.text || `/${name}: (no output)`,
          },
          asyncToken,
        );
        return true;
      }
      const detail = result?.timedOut
        ? `/${name} timed out`
        : result?.text || result?.error || `/${name} failed`;
      this._postFrom(
        convId,
        { kind: "error", text: String(detail) },
        asyncToken,
      );
      return false;
    } catch (err) {
      this._postFrom(
        convId,
        {
          kind: "error",
          text: `/${name} failed: ${err?.message || err}`,
        },
        asyncToken,
      );
      return false;
    }
  }

  _runSessionSlashCommand(command, rawArgs = "") {
    const conv = this._activeConv();
    const name = String(command || "")
      .trim()
      .replace(/^\/+/, "");
    const def = COMMAND_DEFS.find(
      (item) => item.route === "session" && item.command === name,
    );
    if (!def) {
      this._postFrom(conv.id, {
        kind: "error",
        text: `unsupported session command: /${name || "(empty)"}`,
      });
      return false;
    }
    const args = String(rawArgs || "").trim();
    if (args.length > 4096) {
      this._postFrom(conv.id, {
        kind: "error",
        text: `/${name}: arguments are too long`,
      });
      return false;
    }
    let session;
    try {
      session = this._ensureSession();
    } catch (err) {
      this._postFrom(conv.id, {
        kind: "error",
        text: `/${name}: could not start the agent session: ${err?.message || err}`,
      });
      return false;
    }
    if (!Array.isArray(conv.sessionSlashCommands)) {
      if (!Array.isArray(conv.unconfirmedSessionSlashCommands)) {
        conv.unconfirmedSessionSlashCommands = [];
      }
      conv.unconfirmedSessionSlashCommands.push(name);
    } else if (!conv.sessionSlashCommands.includes(name)) {
      this._postFrom(conv.id, {
        kind: "error",
        text:
          `/${name} is not supported by the installed cc CLI. ` +
          "Upgrade the CLI and retry.",
      });
      return false;
    }
    const requestId = `slash-${
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : crypto.randomBytes(12).toString("hex")
    }`;
    let ok = false;
    try {
      ok = session.sendEvent({
        type: "slash_command",
        request_id: requestId,
        command: name,
        args,
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      const pending = conv.unconfirmedSessionSlashCommands;
      const index = Array.isArray(pending) ? pending.lastIndexOf(name) : -1;
      if (index >= 0) pending.splice(index, 1);
      this._postFrom(conv.id, {
        kind: "error",
        text: `/${name}: could not reach the agent session`,
      });
    }
    return ok;
  }

  /**
   * Refresh the persistent context-window indicator for a conversation.
   *
   * Fast path (no process spawn): the live context size IS the last LLM
   * call's usage (recorded from token_usage events in _makeOnEvent), so once
   * the model's window size is known the status is computed locally. The old
   * behavior — cold-spawning `cc context <id> --json` after EVERY turn — cost
   * seconds per turn on Windows for numbers the stream already carries.
   *
   * Slow path (first turn per model, or no usage events from this provider):
   * ask the CLI as before and cache the window it reports, keyed by the
   * panel's provider/model settings (dropped on any LLM reconfigure).
   *
   * Best-effort: never throws, silently skips when there's no session id, when
   * disabled via `chainlesschain.chat.contextIndicator`, or when the
   * conversation stops being the active tab before the result lands.
   */
  _refreshContextStatus(convId) {
    const conv = this._convs.get(convId);
    if (!conv) return;
    const asyncToken = this._asyncToken(conv);
    const id = conv?.sessionId;
    if (!id) return;
    const chatCfg = this.vscode.workspace.getConfiguration(
      "chainlesschain.chat",
    );
    if (chatCfg.get("contextIndicator") === false) return;
    const introspect = require("./introspect-commands");
    const model = this._safeLlmSetting("model", chatCfg.get("model"));
    const provider = this._safeLlmSetting("provider", chatCfg.get("provider"));
    const cacheKey = `${provider}::${model}`;
    const usage = this._lastCallUsage.get(convId);
    if (usage && this._ctxWindowCache?.key === cacheKey) {
      const status = introspect.contextStatusFromUsage(
        usage,
        this._ctxWindowCache.window,
      );
      if (status) {
        this._postFrom(convId, { kind: "ctxStatus", ...status }, asyncToken);
        return;
      }
    }
    const runText = this.opts.deps?.runCliText || introspect.runCliText;
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    const args = introspect.buildIntrospectArgs("context", id, {
      model,
      provider,
      json: true,
    });
    Promise.resolve(
      runText({
        command: this._cliCommand(),
        args,
        cwd,
        env: { ...process.env, ...bridgeEnv },
        timeoutMs: 10000,
      }),
    ).then(
      (text) => {
        const status = introspect.parseContextStatus(text);
        if (!status) return;
        if (this._convs.get(convId)?._asyncToken !== asyncToken) return;
        // Remember the window so later turns derive the status locally.
        this._ctxWindowCache = { key: cacheKey, window: status.window };
        this._postFrom(convId, { kind: "ctxStatus", ...status }, asyncToken);
      },
      () => {},
    );
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
          "Rewind the work tree to which checkpoint? (a diff preview opens before you confirm)",
      },
    );
    if (!pick) return;
    const cpId = pick.id || pick.label;
    // Preview the diff BEFORE restoring — the old flow restored on pick with no
    // way to see what would change. Show `checkpoint show --diff` in a
    // read-only editor tab, then confirm in a modal (Cancel = no write).
    const shown = await rewind.runCliJson({
      command,
      args: rewind.buildShowDiffArgs(id, cpId),
      cwd,
      env,
    });
    const previewText = shown.ok ? rewind.formatDiffPreview(shown.data) : "";
    if (previewText) {
      try {
        const doc = await this.vscode.workspace.openTextDocument({
          content:
            `# Restore preview — ${cpId}\n` +
            `# (changes that would be reverted; nothing written until you confirm)\n\n` +
            previewText,
          language: "diff",
        });
        await this.vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        /* preview is best-effort — the confirm modal still gates the write */
      }
    }
    const proceed = await this.vscode.window.showWarningMessage(
      `Restore the work tree to ${cpId}? Your current state is snapshotted first, so this is undoable.`,
      { modal: true },
      "Restore",
    );
    if (proceed !== "Restore") {
      this._post({
        kind: "info",
        text: `/rewind: cancelled — nothing restored`,
      });
      return;
    }
    const restored = await rewind.runCliJson({
      command,
      args: rewind.buildRestoreArgs(id, cpId),
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

  /**
   * "Insert at Cursor" from a chat code block: splice the snippet into the
   * active editor at the caret, replacing a non-empty selection. The webview
   * has focus when the button is clicked, but `activeTextEditor` keeps
   * pointing at the last-focused text editor; fall back to the first visible
   * one. Best-effort with a panel hint when there is nowhere to insert.
   */
  _insertCodeAtCursor(code) {
    if (!code) return;
    const win = this.vscode.window || {};
    const editor = win.activeTextEditor || (win.visibleTextEditors || [])[0];
    if (!editor) {
      this._post({
        kind: "info",
        text: "insert: no editor open — open a file first, then click Insert again",
      });
      return;
    }
    const fail = () =>
      this._post({
        kind: "info",
        text: "insert failed — the editor rejected the edit (read-only file?)",
      });
    Promise.resolve(
      editor.edit((eb) => {
        const sel = editor.selection;
        if (sel && !sel.isEmpty) eb.replace(sel, code);
        else if (sel) eb.insert(sel.active, code);
      }),
    ).then((ok) => {
      if (!ok) fail();
    }, fail);
  }

  /**
   * Called after the Configure-LLM wizard. The LLM config is GLOBAL, so EVERY
   * tab's running child holds the stale provider/model/key — delegate to
   * _reloadLlmConfig, which stops ALL of them (not just the active tab, whose
   * child was the only one the old code restarted, leaving background tabs
   * erroring on the old config).
   */
  onLlmConfigured() {
    this._reloadLlmConfig();
  }

  resolveWebviewView(view) {
    this.view = view;
    this._webviewReady = false;
    this._webviewProtocolGuard = true;
    this._webviewProtocolConfirmed = false;
    this._webviewProtocolReloads = 0;
    view.webview.options = { enableScripts: true };
    // Subscribe before assigning HTML: the new script posts `ready` as soon as
    // it executes, and fast Webview hosts must not win that race.
    view.webview.onDidReceiveMessage((m) => this._handleMessage(m));
    this._renderChatWebview(view);
    // First-run onboarding: no llm.provider configured → show the setup card.
    (async () => {
      try {
        const getConfiguredProvider =
          this.opts.deps?.getConfiguredProvider ||
          require("../llm-config").getConfiguredProvider;
        const provider = await getConfiguredProvider({
          command: this._cliCommand(),
        });
        if (!provider) this._post({ kind: "setup", reason: "" });
      } catch {
        /* onboarding check is best-effort */
      }
    })();
    // Approval-mode indicator in the status bar (auto-accept / bypass are
    // otherwise invisible once set). Guarded: the unit-test vscode mock has no
    // window.createStatusBarItem, so this stays inert there.
    if (!this._modeStatus && this.vscode.window?.createStatusBarItem) {
      const { createModeStatusBar } = require("../ui/status-bar");
      this._modeStatus = createModeStatusBar(this.vscode);
    }
    this._updateModeStatus();
    view.onDidDispose(() => {
      this._clearWebviewProtocolTimer();
      this._flushPlanReviewDrafts();
      for (const summary of this._convs.list()) {
        this._stopLoop(summary.id);
        this._stopSession(this._convs.get(summary.id));
      }
      this._cleanupImageTemps();
      this._modeStatus?.item.dispose();
      this._modeStatus = null;
      this.view = null;
      this._webviewReady = false;
      this._webviewProtocolGuard = false;
      this._webviewProtocolConfirmed = false;
      this._webviewProtocolReloads = 0;
    });
  }

  /** Reflect the ACTIVE conversation's approval mode in the status bar. */
  _updateModeStatus() {
    if (!this._modeStatus) return;
    this._modeStatus.render(this._activeConv()?.mode || "default");
  }

  /**
   * Handle one inbound webview message (send / tabs / plan / approval / …).
   * Extracted from resolveWebviewView so the whole message flow is unit-testable
   * without a live webview host.
   */
  _handleMessage(m) {
    if (!m || typeof m !== "object") return;
    if (this._webviewProtocolGuard) {
      if (m.type === "ready" || m.type === "protocol") {
        const wasReady = this._webviewReady;
        if (!this._acceptWebviewProtocol(m)) return;
        // A retained same-version DOM answers the Host probe but does not rerun
        // its startup `ready` post. Treat that acknowledgement as readiness so
        // queued actions and the tab bar are restored after an EH restart.
        if (m.type === "protocol") {
          if (wasReady) return;
          m = { ...m, type: "ready" };
        }
      } else if (!this._webviewProtocolConfirmed) {
        // Do not accept commands from a DOM whose routing contract has not
        // been verified; replace it immediately instead of waiting for timeout.
        this._reloadStaleWebview(
          this.view,
          `message "${String(m.type || "unknown")}" arrived before handshake`,
        );
        return;
      }
    }
    if (m.type === "send") {
      const images = Array.isArray(m.images)
        ? this._writeImageTemps(m.images)
        : [];
      const session = this._ensureSession(); // bootstraps the conversation
      {
        // Auto-name the tab from its first message ("Chat N" tells you
        // nothing once three tabs are open). Only ever replaces the untouched
        // default, so a deliberate rename sticks.
        const conv = this._activeConv();
        const auto = deriveTabTitle(m.text);
        if (auto && isDefaultTitle(conv.title)) {
          this._convs.setTitle(conv.id, auto);
          this._postTabs();
        }
      }
      if (images.length) {
        // Track for cleanup once this conversation's turn completes.
        if (!this._imgTemps) this._imgTemps = new Map();
        const id = this._convs.activeId();
        this._imgTemps.set(id, (this._imgTemps.get(id) || []).concat(images));
      }
      const ok = images.length
        ? session.sendEvent({
            type: "user",
            text: String(m.text || ""),
            images,
          })
        : session.send(m.text);
      this._activeConv().turnActive = ok === true;
      if (!ok) {
        this._post({
          kind: "error",
          text:
            "could not reach the agent process — is the `cc` CLI " +
            "installed? (npm i -g chainlesschain — requires Node.js >= 22.12.0, " +
            "or set chainlesschain.cli.path)",
        });
        // The send failed, so no `result` event will ever fire to clean up the
        // temp pngs we tracked above — unlink them now, or they leak in tmp for
        // the panel's lifetime (one set per failed send).
        if (images.length) this._cleanupImageTemps(this._convs.activeId());
      }
    } else if (m.type === "plan") {
      // Plan controls ride the same stdin protocol; entering plan mode may
      // need to spawn the child first (e.g. Plan clicked before any turn).
      const action = String(m.action || "");
      if (action === "enter") {
        const ok = this._ensureSession().sendEvent({ type: "plan", action });
        if (!ok) {
          this._post({ kind: "error", text: "could not enter plan mode" });
        }
      } else {
        const conv = this._activeConv();
        if (!conv.plan?.active) {
          this._post({
            kind: "info",
            text: `/${action}: there is no active plan`,
          });
        } else if (!conv.session?.running) {
          this._post({
            kind: "error",
            text: `/${action}: the agent session is not running`,
          });
        } else if (!conv.session.sendEvent({ type: "plan", action })) {
          this._post({
            kind: "error",
            text: `/${action}: could not reach the agent session`,
          });
        } else if (["approve", "revise", "regenerate"].includes(action)) {
          // These controls can fall through into a model continuation turn.
          // Mark it active immediately so /stop can interrupt before the first
          // streamed token arrives. A no-op plan_update note clears the flag.
          conv.turnActive = true;
        }
      }
    } else if (m.type === "planReviewAction") {
      this.reviewPlan(m.action).catch(() => {});
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
    } else if (m.type === "insertCode") {
      // A code block's "Insert" button: splice the snippet into the editor at
      // the caret (Copilot-Chat "Insert at Cursor" parity).
      this._insertCodeAtCursor(String(m.code || ""));
    } else if (m.type === "pickSession") {
      this._pickSession().catch(() => {});
    } else if (m.type === "handoff") {
      this._handoffSession().catch(() => {});
    } else if (m.type === "cost" || m.type === "context") {
      this._runIntrospect(m.type).catch(() => {});
    } else if (m.type === "rewind") {
      this._rewind().catch(() => {});
    } else if (m.type === "mode") {
      this._setMode(String(m.mode || "default"));
    } else if (m.type === "think") {
      this._setThinking(String(m.level || "off"));
    } else if (m.type === "goal") {
      this._setGoalCondition(m.spec);
    } else if (m.type === "loop") {
      this._setLoop(m.spec);
    } else if (m.type === "cliCommand") {
      this._runCliCommand(String(m.command || ""), m.args).catch(() => {});
    } else if (m.type === "sessionSlashCommand") {
      this._runSessionSlashCommand(String(m.command || ""), m.args);
    } else if (m.type === "configureLlm") {
      // After the wizard writes config (cc config set), every ALREADY-RUNNING
      // child still holds the OLD provider/model/key — so a child spawned with
      // bad/empty LLM config keeps erroring until it respawns. Restart running
      // children once the wizard closes so the next message picks up the new
      // config (without the user having to open a fresh conversation).
      Promise.resolve(
        this.vscode.commands.executeCommand("chainlesschain.llm.configure"),
      ).then(
        () => this._reloadLlmConfig(),
        () => this._reloadLlmConfig(),
      );
    } else if (m.type === "approval") {
      this.session?.sendEvent({
        type: "approval",
        id: String(m.id || ""),
        approve: m.approve === true,
      });
    } else if (m.type === "answer") {
      // The in-panel question card's answer (option / text / multi-select, or
      // null when skipped) → unblock the agent's ask_user_question.
      this.session?.sendEvent({
        type: "answer",
        id: String(m.id || ""),
        answer: m.answer === undefined ? null : m.answer,
      });
    } else if (m.type === "interrupt") {
      // Abort the in-flight turn only — the conversation/child stays alive.
      const conv = this._activeConv();
      if (!conv.session?.running || !conv.turnActive) {
        this._post({ kind: "info", text: "/stop: no active turn" });
      } else if (!conv.session.sendEvent({ type: "interrupt" })) {
        this._post({
          kind: "error",
          text: "/stop: could not reach the agent session",
        });
      }
    } else if (m.type === "compact") {
      // Manual /compact (Claude-Code IDE parity): ask the child to trim its
      // live history between turns. The CLI answers with a `compaction`
      // event rendered like any other status line.
      const conv = this._activeConv();
      if (!conv.session?.running) {
        this._post({
          kind: "info",
          text: "/compact: send a message first — no live session",
        });
      } else if (!conv.session.sendEvent({ type: "compact" })) {
        this._post({
          kind: "error",
          text: "/compact: could not reach the agent session",
        });
      }
    } else if (m.type === "stop") {
      const conv = this._activeConv();
      this._stopSession(conv);
      this._indexConversation(conv, "stopped");
    } else if (m.type === "ready") {
      this._onWebviewReady();
      // Show the tab bar from the first paint (bootstraps one conversation
      // record — no child spawn until the first message).
      const conv = this._activeConv();
      this._postTabs();
      if (conv.plan?.active) {
        this._syncPlanReviewEditor(conv.id, conv.plan).catch(() => {});
      }
    } else if (m.type === "new") {
      // New chat: reset the ACTIVE conversation — drop its child AND resume
      // id so the next message spawns fresh. Webview clears on "reset".
      const conv = this._activeConv();
      this._flushPlanReviewDrafts();
      this._stopSession(conv);
      this._clearSessionState(conv, { clearGoal: true });
      this._indexConversation(conv, "stopped");
      this._convs.setSessionId(conv.id, null);
      // Reset the title back to its default ("Chat N") so the fresh
      // conversation re-derives its name from its OWN first message — otherwise
      // it keeps the previous conversation's auto-title forever (isDefaultTitle
      // is false, so auto-rename never fires again). The id is `conv-N`, whose
      // N is exactly the default title's number.
      this._convs.setTitle(conv.id, conv.id.replace(/^conv-/, "Chat "));
      this._rememberSessionId(null);
      this._postTabs(); // refresh the tab bar with the reset title (also persists)
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
        // A pending approval was gated out while this tab was backgrounded —
        // re-post the card now (once; it then lives in the tab's buffer).
        if (conv.pendingApproval) {
          this._post(conv.pendingApproval);
          this._convs.setPendingApproval(conv.id, null);
        }
        if (conv.plan) {
          this._syncPlanReviewEditor(conv.id, conv.plan).catch(() => {});
        }
      }
    } else if (m.type === "closeTab") {
      this._flushPlanReviewDrafts();
      const closingId = String(m.id || "");
      const closing = this._convs.get(closingId);
      this._stopLoop(closingId);
      this._lastCallUsage.delete(closingId);
      this._planReviews.delete(closingId);
      this._stopSession(closing);
      const res = this._convs.close(closingId);
      if (res.closed) {
        // Remember it so Cmd/Ctrl+Shift+T can reopen+resume the last close.
        if (res.conv) {
          this._lastClosed = {
            sessionId: res.conv.sessionId || null,
            title: res.conv.title,
          };
          this._indexConversation(res.conv, "stopped");
        }
        if (this._convs.count() === 0) this._convs.create({}); // never empty
        this._rememberSessionId(this._convs.active()?.sessionId || null);
        this._postTabs();
      }
    }
  }

  dispose() {
    this._clearWebviewProtocolTimer();
    this._webviewProtocolGuard = false;
    this._webviewProtocolConfirmed = false;
    this._flushPlanReviewDrafts();
    for (const summary of this._convs.list()) {
      this._stopLoop(summary.id);
      this._stopSession(this._convs.get(summary.id));
    }
    this._cleanupImageTemps();
    this._modeStatus?.item.dispose();
    this._modeStatus = null;
  }
}

module.exports = { ChatViewProvider };
