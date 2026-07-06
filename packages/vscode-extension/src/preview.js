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
   * @param {(child:ChildProcess)=>void} [deps.kill]  terminate the dev server.
   *   Defaults to child.kill(); the live wiring kills the whole PROCESS TREE
   *   (npm wrapper → actual dev server) so the port isn't left held.
   */
  constructor(deps = {}) {
    this._spawn = deps.spawn;
    this._openUrl = deps.openUrl || (() => {});
    this._readPkg = deps.readPackageJson || (() => null);
    this._onStatus = deps.onStatus || (() => {});
    this._kill =
      deps.kill ||
      ((child) => {
        try {
          child?.kill?.();
        } catch {
          /* best-effort */
        }
      });
    this.child = null;
    this.url = null;
    this.running = false;
    this.script = null;
    this._cwd = null; // remembered for restart-after-crash
    this._stopping = false; // distinguishes a user stop() from a crash
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
      this._onStatus({
        state: "error",
        message: "no dev script in package.json",
      });
      return { error: "no-dev-script" };
    }
    this.script = dev.script;
    this.url = null;
    this._cwd = cwd;
    this._stopping = false;
    this._onStatus({ state: "starting", script: dev.script });
    const child = this._spawn(dev.script, cwd);
    this.child = child;
    this.running = true;

    // Line-frame with a per-stream carry buffer: the URL can straddle a chunk
    // boundary (long banners / 64KB pipe chunks), and two half-lines never
    // match. stdout and stderr each get their own buffer — a shared one would
    // let interleaved chunks from the two streams corrupt each other's lines.
    const makeOnData = () => {
      let carry = "";
      return (buf) => {
        if (this.url) return; // already opened
        carry += String(buf);
        const lines = carry.split(/\r?\n/);
        carry = lines.pop(); // trailing partial line waits for the next chunk
        for (const line of lines) {
          const url = detectServerUrl(line);
          if (url) {
            this.url = url;
            this._onStatus({ state: "ready", url, script: dev.script });
            this._openUrl(url);
            return;
          }
        }
      };
    };
    child?.stdout?.on?.("data", makeOnData());
    child?.stderr?.on?.("data", makeOnData()); // some servers print the URL on stderr
    child?.on?.("exit", (code) => {
      const intentional = this._stopping;
      this.running = false;
      this.child = null;
      this._stopping = false;
      // A dev server is meant to run until you stop it — any exit we didn't
      // ask for is a crash. stop() already emitted "stopped", so stay quiet
      // for an intentional exit (avoids a double status).
      if (!intentional) {
        this._onStatus({ state: "crashed", code, script: this.script });
      }
    });
    return { started: true, script: dev.script };
  }

  stop() {
    const child = this.child;
    this._stopping = true; // tell the exit handler this was on purpose
    this.running = false;
    this.url = null;
    this.child = null;
    if (child) this._kill(child);
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
  const { hardenedEnv } = require("./hardened-env");
  let controller;
  controller = new PreviewController({
    spawn: (script, cwd) =>
      cp.spawn("npm", ["run", script], {
        cwd,
        shell: true,
        // Hardened so cmd.exe doesn't resolve a repo-local `npm.cmd` before PATH.
        env: hardenedEnv(process.env),
        windowsHide: true,
        // POSIX: give the dev server its own process group so kill() below can
        // signal the whole tree. (On Windows, detached opens a console window —
        // there we use taskkill /T instead.)
        detached: process.platform !== "win32",
      }),
    // `npm run dev` runs the actual dev server as a grandchild (cmd/sh → npm →
    // node), so a plain child.kill() leaves it orphaned holding the port. Kill
    // the whole tree.
    kill: (child) => {
      const pid = child && child.pid;
      if (!pid) {
        try {
          child && child.kill && child.kill();
        } catch {
          /* best-effort */
        }
        return;
      }
      if (process.platform === "win32") {
        try {
          cp.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
            windowsHide: true,
          });
          return;
        } catch {
          /* fall through to child.kill */
        }
      } else {
        try {
          process.kill(-pid, "SIGTERM"); // negative pid → the process group
          return;
        } catch {
          /* fall through to child.kill */
        }
      }
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
    },
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
      // Dev server crashed (exited without us asking) — offer to restart it.
      if (s.state === "crashed") {
        const msg =
          `App preview (npm run ${s.script || "dev"}) exited` +
          (s.code != null ? ` (code ${s.code})` : "") +
          ".";
        vscode.window.showWarningMessage(msg, "Restart").then(
          (pick) => {
            if (pick === "Restart" && controller._cwd) {
              controller.start(controller._cwd);
            }
          },
          () => {},
        );
      }
    },
  });
  return controller;
}

module.exports = { PreviewController, createPreviewController };
