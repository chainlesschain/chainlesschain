/**
 * App Preview (Claude-Code desktop preview-pane parity) — spawn the project's
 * dev server, watch its output for the served URL, and open it in VS Code's
 * Simple Browser. The dev server's own HMR handles live reload on edits.
 *
 * The controller takes injected deps (spawn / openUrl / readPackageJson) so the
 * whole flow is unit-testable without a vscode host or a real server. The thin
 * vscode glue lives in createPreviewController(); extension.js registers the
 * start/stop commands against it.
 */
const { pickDevScript, detectServerUrl } = require("./preview-detect");

class PreviewController {
  /**
   * @param {object} deps
   * @param {(script:string, cwd:string)=>ChildProcess} deps.spawn
   * @param {(url:string)=>void} deps.openUrl   open the URL (Simple Browser)
   * @param {(cwd:string)=>object|null} deps.readPackageJson
   * @param {(s:object)=>void} [deps.onStatus]  status sink (status bar / log)
   */
  constructor(deps = {}) {
    this._spawn = deps.spawn;
    this._openUrl = deps.openUrl || (() => {});
    this._readPkg = deps.readPackageJson || (() => null);
    this._onStatus = deps.onStatus || (() => {});
    this.child = null;
    this.url = null;
    this.running = false;
    this.script = null;
  }

  /**
   * Start (or focus) the preview for `cwd`. Idempotent: if already running,
   * just re-opens the known URL. Returns a small result object.
   */
  start(cwd) {
    if (this.running) {
      if (this.url) this._openUrl(this.url);
      return { already: true, url: this.url };
    }
    const pkg = this._readPkg(cwd);
    const dev = pickDevScript(pkg);
    if (!dev) {
      this._onStatus({ state: "error", message: "no dev script in package.json" });
      return { error: "no-dev-script" };
    }
    this.script = dev.script;
    this.url = null;
    this._onStatus({ state: "starting", script: dev.script });
    const child = this._spawn(dev.script, cwd);
    this.child = child;
    this.running = true;

    const onData = (buf) => {
      if (this.url) return; // already opened
      const text = String(buf);
      for (const line of text.split(/\r?\n/)) {
        const url = detectServerUrl(line);
        if (url) {
          this.url = url;
          this._onStatus({ state: "ready", url, script: dev.script });
          this._openUrl(url);
          return;
        }
      }
    };
    child?.stdout?.on?.("data", onData);
    child?.stderr?.on?.("data", onData); // some servers print the URL on stderr
    child?.on?.("exit", (code) => {
      this.running = false;
      this.child = null;
      this._onStatus({ state: "stopped", code });
    });
    return { started: true, script: dev.script };
  }

  stop() {
    const child = this.child;
    this.running = false;
    this.url = null;
    this.child = null;
    if (child) {
      try {
        child.kill?.();
      } catch {
        /* best-effort */
      }
    }
    this._onStatus({ state: "stopped" });
  }

  dispose() {
    this.stop();
  }
}

/**
 * Wire a PreviewController to the live VS Code API: spawn `npm run <script>` in
 * the workspace, open the detected URL in Simple Browser, read package.json off
 * disk. Kept tiny so the logic (PreviewController) stays host-free + tested.
 */
function createPreviewController(vscode, { log } = {}) {
  const cp = require("child_process");
  const fs = require("fs");
  const path = require("path");
  return new PreviewController({
    spawn: (script, cwd) =>
      cp.spawn("npm", ["run", script], {
        cwd,
        shell: true,
        env: process.env,
        windowsHide: true,
      }),
    openUrl: (url) =>
      vscode.commands.executeCommand(
        "simpleBrowser.show",
        // Some VS Code versions expect a Uri, others a string — Uri is safe.
        vscode.Uri ? vscode.Uri.parse(url) : url,
      ),
    readPackageJson: (cwd) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
        );
      } catch {
        return null;
      }
    },
    onStatus: (s) => {
      if (typeof log === "function") {
        log(
          `preview: ${s.state}` +
            (s.script ? ` (${s.script})` : "") +
            (s.url ? ` → ${s.url}` : "") +
            (s.message ? ` — ${s.message}` : ""),
        );
      }
    },
  });
}

module.exports = { PreviewController, createPreviewController };
