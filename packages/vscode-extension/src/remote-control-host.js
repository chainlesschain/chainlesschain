/**
 * Remote Control host manager — glue for the `chainlesschain.remote.control`
 * command. Wraps `cc remote-control start/status/stop --json`: starts a
 * pairing host (long-running child of THIS window) so mobile/web devices can
 * pair and drive this machine's agent sessions, surfaces the one-time pairing
 * URI (copy to clipboard), lists discovered hosts, and stops them.
 *
 * Pure arg builders/parsers live in chat/remote-handoff.js; this module owns
 * the child lifecycle + VS Code UI only.
 */
const { spawn, execFile } = require("child_process");
const { hardenedEnv } = require("./hardened-env");
const {
  buildRemoteControlStartArgs,
  buildRemoteControlStatusArgs,
  buildRemoteControlStopArgs,
  extractFirstJsonObject,
  formatPairingNote,
  parseRemoteControlStatus,
} = require("./chat/remote-handoff");

function createRemoteControlHost(
  vscode,
  { command, log = () => {}, deps = {} } = {},
) {
  const cliCommand = typeof command === "function" ? command : () => "cc";
  const doSpawn = deps.spawn || spawn;
  const doExecFile = deps.execFile || execFile;
  let child = null;
  let pairing = null; // parsed start --json payload
  let stopping = false;

  function spawnOpts(extra = {}) {
    return {
      env: hardenedEnv(process.env),
      windowsHide: true,
      // npm global shims on Windows are .cmd files — they need a shell.
      shell: process.platform === "win32",
      ...extra,
    };
  }

  function runCli(args) {
    return new Promise((resolve) => {
      doExecFile(
        cliCommand(),
        args,
        spawnOpts({ timeout: 30000 }),
        (err, stdout, stderr) =>
          resolve({
            err,
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
          }),
      );
    });
  }

  async function copyPairingUri() {
    if (!pairing?.pairingUri) return;
    await vscode.env.clipboard.writeText(pairing.pairingUri);
    vscode.window.setStatusBarMessage("$(broadcast) Pairing URI copied", 3000);
  }

  function announcePairing() {
    const note = formatPairingNote(pairing);
    if (!note) return;
    log(`remote-control: ${note}`);
    vscode.window
      .showInformationMessage(
        `Remote control ready on port ${pairing.port} (${pairing.mode}). ` +
          "Pair a phone or web panel with the one-time URI.",
        "Copy pairing URI",
      )
      .then((pick) => {
        if (pick === "Copy pairing URI") copyPairingUri().catch(() => {});
      });
  }

  /**
   * Relay (E2EE cross-network) settings — `chainlesschain.remote.relayUrl` /
   * `.peerId`. Read at each start so a settings change applies to the next
   * host without a window reload; blank values defer to the CLI's env/config.
   */
  function relayOptions() {
    try {
      const cfg = vscode.workspace.getConfiguration("chainlesschain.remote");
      return {
        relayUrl: cfg.get("relayUrl") || "",
        peerId: cfg.get("peerId") || "",
      };
    } catch {
      return {};
    }
  }

  function start() {
    if (child) return;
    stopping = false;
    let buffer = "";
    let errBuffer = "";
    const proc = doSpawn(
      cliCommand(),
      buildRemoteControlStartArgs(relayOptions()),
      spawnOpts(),
    );
    child = proc;
    proc.stdout?.on("data", (d) => {
      if (pairing) return;
      buffer += d.toString("utf8");
      const parsed = extractFirstJsonObject(buffer);
      if (parsed?.pairingUri) {
        pairing = parsed;
        announcePairing();
      }
    });
    proc.stderr?.on("data", (d) => {
      errBuffer = (errBuffer + d.toString("utf8")).slice(-2000);
    });
    proc.on("exit", (code) => {
      if (child !== proc) return;
      child = null;
      pairing = null;
      if (!stopping) {
        vscode.window.showWarningMessage(
          `ChainlessChain remote-control host exited (code ${code ?? "?"})` +
            (errBuffer.trim()
              ? ` — ${errBuffer.trim().split("\n").pop()}`
              : "") +
            ". Run the command again to restart it (a restart issues a fresh pairing URI).",
        );
      }
    });
    proc.on("error", (err) => {
      if (child !== proc) return;
      child = null;
      pairing = null;
      vscode.window.showErrorMessage(
        `Could not start the remote-control host: ${err.message}`,
      );
    });
    vscode.window.setStatusBarMessage(
      "$(broadcast) Starting remote-control host…",
      5000,
    );
  }

  function stopOwn() {
    const proc = child;
    if (!proc) return;
    stopping = true;
    const port = pairing?.port;
    child = null;
    pairing = null;
    const finishKill = () => {
      if (proc.exitCode !== null || proc.killed) return;
      const pid = proc.pid;
      if (pid && process.platform === "win32") {
        // shell:true wraps cc in cmd.exe — plain kill() orphans the real
        // node grandchild (which holds the WS port). taskkill /T reaps it.
        try {
          doSpawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
            windowsHide: true,
          });
          return;
        } catch {
          /* fall through */
        }
      }
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    };
    // Graceful first: the CLI stop removes the discovery state file; the
    // taskkill fallback covers a host that ignored it.
    const args = port
      ? buildRemoteControlStopArgs(port)
      : ["remote-control", "stop", "--json"];
    runCli(args).then(finishKill, finishKill);
    vscode.window.setStatusBarMessage(
      "$(primitive-square) Remote-control host stopped",
      3000,
    );
  }

  async function showStatus() {
    const { stdout } = await runCli(buildRemoteControlStatusArgs());
    const hosts = parseRemoteControlStatus(stdout);
    if (!hosts.length) {
      vscode.window.showInformationMessage(
        "No remote-control hosts running on this machine.",
      );
      return null;
    }
    const pick = await vscode.window.showQuickPick(
      hosts.map((h) => ({
        label: `port ${h.port}`,
        description: `${h.alive ? "running" : "stale"} · ${h.mode || "?"} · pid ${h.pid}`,
        detail: `session ${h.agentSessionId || "?"} · ${h.wsUrl || ""}`,
        host: h,
      })),
      { placeHolder: "Remote-control hosts (pick one to stop it)" },
    );
    if (!pick) return null;
    const stop = await vscode.window.showWarningMessage(
      `Stop the remote-control host on port ${pick.host.port}? Paired devices disconnect.`,
      { modal: true },
      "Stop",
    );
    if (stop !== "Stop") return null;
    if (child && pairing?.port === pick.host.port) {
      stopOwn();
    } else {
      await runCli(buildRemoteControlStopArgs(pick.host.port));
    }
    return pick.host.port;
  }

  async function openMenu() {
    const running = Boolean(child);
    const items = running
      ? [
          { label: "$(clippy) Copy pairing URI", action: "copy" },
          { label: "$(list-unordered) Show host status", action: "status" },
          {
            label: "$(primitive-square) Stop this window's host",
            action: "stopOwn",
          },
        ]
      : [
          {
            label: "$(broadcast) Start remote-control host",
            description: "pair a phone / web panel to drive this machine",
            action: "start",
          },
          {
            label: "$(list-unordered) Show host status / stop a host",
            action: "status",
          },
        ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: running
        ? "Remote control host is running in this window"
        : "Remote control (cc remote-control)",
    });
    if (!pick) return;
    if (pick.action === "start") start();
    else if (pick.action === "copy") await copyPairingUri();
    else if (pick.action === "status") await showStatus();
    else if (pick.action === "stopOwn") stopOwn();
  }

  return {
    openMenu,
    dispose: () => stopOwn(),
    // test seams
    _get: () => ({ child, pairing }),
  };
}

module.exports = { createRemoteControlHost };
