/**
 * Remote / WSL Doctor (P2 #12) — pure analysis of the environment signals that
 * make the IDE↔cc bridge flaky on WSL2 / Remote / SSH setups: WSL mirrored
 * networking, a missing or version-mismatched CLI on the remote host, a stopped
 * or unreachable bridge port, and loopback/firewall reachability. Produces
 * leveled checks with a COPYABLE fix command each, so the user isn't left to
 * guess. The host gathers the (cheap) real signals; this classifies them.
 *
 * Pure + host-free so it unit-tests without vscode.
 */

/** Compare dotted numeric versions (`0.162.156`), ignoring any prerelease tail.
 *  Returns <0, 0, >0 like a comparator; unparseable → 0 (treated as equal). */
function compareVersions(a, b) {
  const parse = (v) =>
    String(v || "")
      .trim()
      .replace(/^v/, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Analyze environment signals into leveled checks.
 *
 * @param {{
 *   platform?: string,          // 'win32' | 'linux' | 'darwin'
 *   isWsl?: boolean,            // running INSIDE a WSL distro
 *   remoteUncPath?: string|null,// workspace opened over \\wsl.localhost\… (Win host)
 *   isRemote?: boolean,        // VS Code Remote/SSH/Container session
 *   cliFound?: boolean,
 *   cliVersion?: string|null,
 *   minCliVersion?: string,
 *   bridgePort?: number,       // 0 = stopped
 *   portProbe?: string,        // 'listening' | 'stopped' | 'unknown'
 * }} signals
 * @returns {{ level:string, checks:Array, summary:string }}
 */
function analyzeRemoteEnv(signals = {}) {
  const s = signals;
  const checks = [];
  const add = (level, id, title, detail, fix) =>
    checks.push({ level, id, title, detail, ...(fix ? { fix } : {}) });

  const remote = !!(s.isWsl || s.remoteUncPath || s.isRemote);

  // 1) WSL / mirrored networking — the #1 cause of "bridge unreachable" on WSL2.
  if (s.isWsl || s.remoteUncPath) {
    add(
      "warn",
      "wsl-networking",
      "WSL2 networking",
      "The IDE bridge binds 127.0.0.1. Under WSL2's default NAT networking, a " +
        "cc running in the Windows host and the IDE in WSL (or vice-versa) don't " +
        "share loopback. Mirrored networking makes 127.0.0.1 shared.",
      "Add to %UserProfile%\\.wslconfig then `wsl --shutdown`:\n" +
        "[wsl2]\nnetworkingMode=mirrored",
    );
  }

  // 2) CLI presence + version compatibility on THIS (possibly remote) host.
  if (s.cliFound === false) {
    add(
      "error",
      "cli-missing",
      "cc CLI not found on this host",
      remote
        ? "Remote/WSL sessions have their own PATH — the CLI must be installed " +
            "on the host the IDE is running on, not only on Windows."
        : "The chat panel and bridge shell out to `cc`.",
      "npm install -g chainlesschain",
    );
  } else if (s.cliFound && s.cliVersion && s.minCliVersion) {
    const cmp = compareVersions(s.cliVersion, s.minCliVersion);
    if (cmp < 0) {
      add(
        "warn",
        "cli-outdated",
        "cc CLI is older than this plugin expects",
        `Found ${s.cliVersion}; the plugin targets ≥ ${s.minCliVersion}. Some ` +
          "bridge/tool features may be missing.",
        "npm install -g chainlesschain@latest",
      );
    } else {
      add("ok", "cli-ok", "cc CLI present and compatible", `Found ${s.cliVersion}.`);
    }
  }

  // 3) Bridge port state.
  if (s.portProbe === "stopped" || s.bridgePort === 0) {
    add(
      "error",
      "bridge-stopped",
      "IDE bridge is not running",
      "A terminal cc agent auto-connects via the bridge; without it there's no " +
        "editor context (selection/diagnostics/diff).",
      "Run Tools → “ChainlessChain IDE: Restart Bridge”",
    );
  } else if (s.bridgePort > 0) {
    add(
      "ok",
      "bridge-ok",
      "IDE bridge is listening",
      `127.0.0.1:${s.bridgePort}` +
        (remote
          ? " — from a remote/WSL terminal, confirm the same host can reach this port."
          : ""),
    );
  }

  // 4) Loopback/firewall reachability advisory (only meaningful when remote).
  if (remote && s.bridgePort > 0 && s.portProbe !== "listening") {
    add(
      "warn",
      "firewall",
      "Bridge reachability unverified",
      "The bridge is up but a loopback probe didn't confirm reachability — a " +
        "host firewall or WSL NAT can still block 127.0.0.1 across the boundary.",
      "netsh advfirewall firewall add rule name=\"cc-ide\" dir=in action=allow " +
        `protocol=TCP localport=${s.bridgePort}`,
    );
  }

  const level = checks.some((c) => c.level === "error")
    ? "error"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return { level, checks, summary: summarizeRemoteDoctor({ level, checks }, remote) };
}

/** Render the checks as a copy-pasteable plain-text report. */
function summarizeRemoteDoctor(result, remote) {
  const icon = { ok: "✓", warn: "⚠", error: "✗" };
  const lines = [
    remote
      ? "Remote / WSL Doctor — remote or WSL session detected"
      : "Remote / WSL Doctor — local session",
    "",
  ];
  for (const c of result.checks) {
    lines.push(`${icon[c.level] || "•"} ${c.title}`);
    if (c.detail) lines.push("    " + c.detail.replace(/\n/g, "\n    "));
    if (c.fix) lines.push("    fix: " + c.fix.replace(/\n/g, "\n         "));
    lines.push("");
  }
  if (result.level === "ok") lines.push("All checks passed.");
  return lines.join("\n");
}

module.exports = { analyzeRemoteEnv, compareVersions, summarizeRemoteDoctor };
