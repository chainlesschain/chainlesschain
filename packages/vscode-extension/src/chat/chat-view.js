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
    this.session = null;
    this.turnState = createTurnState();
    // "Insert File Reference" (Cmd/Ctrl+Alt+K): text queued here until the
    // webview signals it is live, then flushed into the input.
    this._pendingInsert = "";
    this._webviewReady = false;
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

  /** Webview script is live — flush any reference queued before it loaded. */
  _onWebviewReady() {
    this._webviewReady = true;
    if (this._pendingInsert) {
      const t = this._pendingInsert;
      this._pendingInsert = "";
      this._post({ kind: "insertText", text: t });
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

  _ensureSession() {
    if (this.session?.running) return this.session;
    const folders = this.vscode.workspace.workspaceFolders || [];
    const cwd = folders[0]?.uri?.fsPath || process.cwd();
    const bridgeEnv =
      typeof this.opts.getBridgeEnv === "function"
        ? this.opts.getBridgeEnv()
        : {};
    this.turnState = createTurnState();
    const chatCfg = this.vscode.workspace.getConfiguration(
      "chainlesschain.chat",
    );
    this.session = new AgentChatSession({
      command: this._cliCommand(),
      args: [
        ...buildSessionArgs({
          model: chatCfg.get("model"),
          provider: chatCfg.get("provider"),
          // Continue this workspace's last conversation across panel/child
          // restarts; "New" clears the stored id for a fresh session.
          resume: this._storedSessionId(),
        }),
        // Confirm-tier approvals become Approve/Deny cards in the panel
        // instead of failing closed (needs cc >= 0.162.45).
        "--interactive-approvals",
      ],
      cwd,
      env: { ...process.env, ...bridgeEnv },
      onEvent: (evt) => {
        if (evt?.type === "system" && evt.subtype === "init") {
          if (evt.session_id) this._rememberSessionId(evt.session_id);
          if (evt.resumed_messages > 0) {
            this._post({
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
          this._post({ kind: "setup", reason: String(evt.error || "") });
        }
        this._post(mapAgentEvent(evt, this.turnState));
      },
      onStderr: (line) => this._post({ kind: "stderr", text: line }),
      onExit: ({ code }) => this._post({ kind: "exited", code }),
    }).start();
    if (typeof this.opts.log === "function") {
      this.opts.log(`chat: spawned ${this._cliCommand()} agent (cwd ${cwd})`);
    }
    return this.session;
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
    this._rememberSessionId(pick.label);
    this.session?.stop();
    this.session = null;
    this._post({ kind: "reset" });
    this._post({
      kind: "info",
      text: `will resume ${pick.label} — send a message to continue it`,
    });
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
    view.webview.onDidReceiveMessage((m) => {
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
        // first, then ranked workspace-relative paths.
        const prefix = String(m.prefix || "");
        const { ideMentionMatches } = require("./at-mention");
        this._listWorkspaceFiles(prefix).then(
          (items) =>
            this._post({
              kind: "files",
              prefix,
              items: ideMentionMatches(prefix).concat(items),
            }),
          () => {},
        );
      } else if (m.type === "pickSession") {
        this._pickSession().catch(() => {});
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
      } else if (m.type === "new") {
        // New chat: drop the child AND the stored session id; the next
        // message spawns a fresh conversation. Webview clears on "reset".
        this.session?.stop();
        this.session = null;
        this._rememberSessionId(null);
        this._fileCache = null; // pick up files created since the last scan
        this._post({ kind: "reset" });
      }
    });
    view.onDidDispose(() => {
      this.session?.stop();
      this.view = null;
      this._webviewReady = false;
    });
  }

  dispose() {
    this.session?.stop();
  }
}

module.exports = { ChatViewProvider };
