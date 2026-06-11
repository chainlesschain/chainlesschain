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
      args: buildSessionArgs({
        model: chatCfg.get("model"),
        provider: chatCfg.get("provider"),
        // Continue this workspace's last conversation across panel/child
        // restarts; "New" clears the stored id for a fresh session.
        resume: this._storedSessionId(),
      }),
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

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildChatHtml({
      cspSource: view.webview.cspSource,
      nonce: crypto.randomBytes(16).toString("hex"),
    });
    view.webview.onDidReceiveMessage((m) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "send") {
        const ok = this._ensureSession().send(m.text);
        if (!ok) {
          this._post({
            kind: "error",
            text:
              "could not reach the agent process — is the `cc` CLI " +
              "installed? (npm i -g chainlesschain, or set " +
              "chainlesschain.cli.path)",
          });
        }
      } else if (m.type === "stop") {
        this.session?.stop();
      } else if (m.type === "new") {
        // New chat: drop the child AND the stored session id; the next
        // message spawns a fresh conversation. Webview clears on "reset".
        this.session?.stop();
        this.session = null;
        this._rememberSessionId(null);
        this._post({ kind: "reset" });
      }
    });
    view.onDidDispose(() => {
      this.session?.stop();
      this.view = null;
    });
  }

  dispose() {
    this.session?.stop();
  }
}

module.exports = { ChatViewProvider };
