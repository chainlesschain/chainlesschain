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
 *   extensionMetadata?: {id?:string, version?:string,
 *     recommendedCliVersion?:string, appName?:string, installMode?:string},
 * }} signals
 * @returns {{ level:string, checks:Array, summary:string, installation?:Object }}
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
      add(
        "ok",
        "cli-ok",
        "cc CLI present and compatible",
        `Found ${s.cliVersion}.`,
      );
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
      'netsh advfirewall firewall add rule name="cc-ide" dir=in action=allow ' +
        `protocol=TCP localport=${s.bridgePort}`,
    );
  }

  // A running extension can verify local activation and execution scope, but
  // cannot prove which store supplied it or what version a store serves now.
  const installation = s.extensionMetadata
    ? analyzeInstallationChannel(s.extensionMetadata, remote)
    : null;
  if (installation) checks.push(...installation.checks);

  const level = checks.some((c) => c.level === "error")
    ? "error"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return {
    level,
    checks,
    summary: summarizeRemoteDoctor({ level, checks }, remote),
    ...(installation ? { installation: installation.evidence } : {}),
  };
}

/** Build reproducible local distribution evidence without a network request. */
function analyzeInstallationChannel(metadata = {}, remote = false) {
  const id = String(metadata.id || "").trim();
  const version = String(metadata.version || "").trim();
  const recommendedCliVersion = String(
    metadata.recommendedCliVersion || "",
  ).trim();
  const appName = String(
    metadata.appName || "Unknown VS Code-compatible host",
  ).trim();
  const installMode = String(metadata.installMode || "production").trim();
  const validId = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i.test(id);
  const validVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
  const app = appName.toLowerCase();
  const channel = app.includes("vscodium")
    ? {
        id: "open-vsx",
        label: "Open VSX Registry",
        url: `https://open-vsx.org/extension/${id.replace(".", "/")}`,
        updateMode: "host-managed",
      }
    : app.includes("visual studio code")
      ? {
          id: "visual-studio-marketplace",
          label: "Visual Studio Marketplace",
          url: `https://marketplace.visualstudio.com/items?itemName=${id}`,
          updateMode: "host-managed",
        }
      : {
          id: "unresolved",
          label: "host-specific marketplace or signed VSIX",
          url: null,
          updateMode: "host-specific",
        };

  const checks = [];
  if (validId && validVersion) {
    checks.push({
      level: "ok",
      id: "extension-activated",
      title: "IDE extension is activated on this execution host",
      detail:
        `${id} ${version} is running in ${appName}` +
        (remote
          ? " on the remote workspace host."
          : " on the local workspace host.") +
        " This verifies local activation, not store availability.",
    });
  } else {
    checks.push({
      level: "warn",
      id: "extension-metadata",
      title: "IDE extension installation metadata is incomplete",
      detail:
        "The active package did not expose a valid extension id and semantic version, so its local installation cannot be recorded as verifiable evidence.",
    });
  }

  checks.push({
    level: channel.id === "unresolved" ? "warn" : "info",
    id: "extension-channel",
    title: "IDE extension update channel",
    detail:
      `${appName} normally uses ${channel.label}; update mode: ${channel.updateMode}. ` +
      (channel.url
        ? `Listing: ${channel.url}. `
        : "Consult the host's extension manager. ") +
      "Install provenance is not exposed by the VS Code extension API, so this is a recommendation rather than a provenance claim.",
  });
  checks.push({
    level: "info",
    id: "extension-store-readback",
    title: "Public store readback not performed",
    detail:
      "This local diagnostic does not query a marketplace. Listing visibility, published version, signature review, and update propagation remain externally unverified.",
  });

  return {
    checks,
    evidence: {
      schemaVersion: "chainlesschain.ide-installation-readiness/v1",
      localActivation: validId && validVersion ? "verified" : "unverified",
      executionHost: remote ? "remote" : "local",
      extension: { id: id || null, version: version || null },
      recommendedCliVersion: recommendedCliVersion || null,
      ideHost: appName,
      installMode,
      recommendedChannel: channel,
      installProvenance: "unavailable-from-host-api",
      storeReadback: "not-performed",
      productionQualified: false,
    },
  };
}

/** Render the checks as a copy-pasteable plain-text report. */
function summarizeRemoteDoctor(result, remote) {
  const icon = { ok: "✓", info: "ℹ", warn: "⚠", error: "✗" };
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

module.exports = {
  analyzeRemoteEnv,
  analyzeInstallationChannel,
  compareVersions,
  summarizeRemoteDoctor,
};
