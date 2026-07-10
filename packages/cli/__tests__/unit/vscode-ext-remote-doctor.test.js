/**
 * Remote / WSL Doctor (P2 #12) — pure environment analysis. Host-free.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeRemoteEnv,
  compareVersions,
  summarizeRemoteDoctor,
} from "../../../vscode-extension/src/remote-doctor.js";

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
