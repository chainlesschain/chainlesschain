/**
 * Execution-location model (P1-7 "任务在哪执行是 Session 一等属性" —
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no fs /
 * clock / RNG — normalize location, clamp permissions fail-closed, strip
 * credential values, validate policy.
 */
import { describe, it, expect } from "vitest";
import {
  EXECUTION_LOCATION,
  normalizeExecutionLocation,
  isRemoteLocation,
  detectAmbientLocation,
  clampPermissionsForLocation,
  redactCredentialRefs,
  describeExecutionContext,
  validateExecutionContext,
} from "../../src/lib/execution-location.js";

describe("normalizeExecutionLocation", () => {
  it("maps aliases to canonical locations", () => {
    expect(normalizeExecutionLocation("localhost")).toBe(
      EXECUTION_LOCATION.LOCAL,
    );
    expect(normalizeExecutionLocation("WSL2")).toBe(EXECUTION_LOCATION.WSL);
    expect(normalizeExecutionLocation("remote-ssh")).toBe(
      EXECUTION_LOCATION.SSH,
    );
    expect(normalizeExecutionLocation("devcontainer")).toBe(
      EXECUTION_LOCATION.CONTAINER,
    );
    expect(normalizeExecutionLocation("codespaces")).toBe(
      EXECUTION_LOCATION.CLOUD,
    );
  });
  it("falls back to UNKNOWN for anything unrecognized", () => {
    expect(normalizeExecutionLocation("mars")).toBe(EXECUTION_LOCATION.UNKNOWN);
    expect(normalizeExecutionLocation(null)).toBe(EXECUTION_LOCATION.UNKNOWN);
  });
  it("classifies remote vs local", () => {
    expect(isRemoteLocation("ssh")).toBe(true);
    expect(isRemoteLocation("cloud")).toBe(true);
    expect(isRemoteLocation("local")).toBe(false);
    expect(isRemoteLocation("wsl")).toBe(false);
  });
});

describe("detectAmbientLocation (env-driven, pure)", () => {
  it("defaults to LOCAL when no environment marker is present", () => {
    expect(detectAmbientLocation({ env: {} })).toBe(EXECUTION_LOCATION.LOCAL);
    expect(detectAmbientLocation()).toBe(EXECUTION_LOCATION.LOCAL);
  });

  it("detects a Codespace (cloud) most specifically", () => {
    expect(
      detectAmbientLocation({
        env: { CODESPACES: "true", WSL_DISTRO_NAME: "Ubuntu" },
      }),
    ).toBe(EXECUTION_LOCATION.CLOUD);
  });

  it("detects an SSH login above a bare WSL marker", () => {
    expect(
      detectAmbientLocation({
        env: { SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22", WSL_DISTRO_NAME: "x" },
      }),
    ).toBe(EXECUTION_LOCATION.SSH);
  });

  it("detects a container via /.dockerenv, `container` env, or k8s", () => {
    expect(detectAmbientLocation({ env: {}, dockerEnvFileExists: true })).toBe(
      EXECUTION_LOCATION.CONTAINER,
    );
    expect(detectAmbientLocation({ env: { container: "podman" } })).toBe(
      EXECUTION_LOCATION.CONTAINER,
    );
    expect(
      detectAmbientLocation({ env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } }),
    ).toBe(EXECUTION_LOCATION.CONTAINER);
  });

  it("detects WSL from its shell exports", () => {
    expect(detectAmbientLocation({ env: { WSL_DISTRO_NAME: "Ubuntu" } })).toBe(
      EXECUTION_LOCATION.WSL,
    );
    expect(
      detectAmbientLocation({ env: { WSL_INTEROP: "/run/WSL/1_interop" } }),
    ).toBe(EXECUTION_LOCATION.WSL);
  });

  it("ignores blank env values (not a truthy marker)", () => {
    expect(
      detectAmbientLocation({
        env: { SSH_CONNECTION: "   ", WSL_INTEROP: "" },
      }),
    ).toBe(EXECUTION_LOCATION.LOCAL);
  });
});

describe("clampPermissionsForLocation — fail-closed floor for UNKNOWN", () => {
  it("locks down an unknown location regardless of the request", () => {
    const p = clampPermissionsForLocation("mars", {
      file: "write",
      shell: true,
      network: true,
      mcp: true,
      externalSystems: true,
    });
    expect(p).toEqual({
      file: "read",
      shell: false,
      network: false,
      mcp: false,
      externalSystems: false,
    });
  });

  it("requires explicit true for each ambient power on a known location", () => {
    const p = clampPermissionsForLocation("local", {
      file: "readwrite",
      shell: "yes", // truthy but not === true → denied
      network: 1, // truthy but not === true → denied
      mcp: true,
    });
    expect(p.file).toBe("write");
    expect(p.shell).toBe(false);
    expect(p.network).toBe(false);
    expect(p.mcp).toBe(true);
    expect(p.externalSystems).toBe(false);
  });

  it("defaults file access to read when unspecified", () => {
    expect(clampPermissionsForLocation("ssh", {}).file).toBe("read");
  });
});

describe("redactCredentialRefs — never a value", () => {
  it("keeps only name/source/scope and drops any value-like field", () => {
    const out = redactCredentialRefs([
      { name: "GH", source: "keychain", scope: "repo", value: "ghp_secret" },
      { name: "DB", source: "env", scope: "read", token: "abc" },
    ]);
    expect(out).toEqual([
      { name: "GH", source: "keychain", scope: "repo" },
      { name: "DB", source: "env", scope: "read" },
    ]);
    for (const c of out) {
      expect(JSON.stringify(c)).not.toMatch(/ghp_secret|abc/);
    }
  });
});

describe("describeExecutionContext", () => {
  it("builds a safe descriptor with clamped perms and stripped credentials", () => {
    const d = describeExecutionContext({
      location: "ssh",
      source: { dir: "/srv/app", repo: "acme/app", commit: "deadbeef" },
      permissions: { file: "write", network: true },
      credentials: [
        { name: "GH", source: "keychain", scope: "repo", value: "x" },
      ],
      lifecycle: { foreground: false, onDisconnect: "keep-running" },
      cost: { model: "opus", tokenBudget: 50000, remote: true },
      returnPath: "pr",
    });
    expect(d.location).toBe(EXECUTION_LOCATION.SSH);
    expect(d.remote).toBe(true);
    expect(d.source.commit).toBe("deadbeef");
    expect(d.permissions.file).toBe("write");
    expect(d.permissions.network).toBe(true);
    expect(d.credentials[0]).toEqual({
      name: "GH",
      source: "keychain",
      scope: "repo",
    });
    expect(d.lifecycle.foreground).toBe(false);
    expect(d.lifecycle.onDisconnect).toBe("keep-running");
    expect(d.cost.tokenBudget).toBe(50000);
    expect(d.returnPath).toBe("pr");
  });

  it("normalizes an unknown return path to none", () => {
    expect(
      describeExecutionContext({ location: "local", returnPath: "email" })
        .returnPath,
    ).toBe("none");
  });
});

describe("validateExecutionContext — exhaustive, fail-closed", () => {
  it("passes a clean local session", () => {
    const r = validateExecutionContext({
      location: "local",
      permissions: { file: "write", shell: true },
      credentials: [{ name: "GH", source: "keychain", scope: "repo" }],
      returnPath: "commit",
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("flags a credential that carries a value", () => {
    const r = validateExecutionContext({
      location: "local",
      credentials: [
        { name: "GH", source: "env", scope: "repo", value: "ghp_x" },
      ],
      returnPath: "commit",
    });
    expect(r.violations).toContain("credential-value-present");
  });

  it("flags an unknown location", () => {
    const r = validateExecutionContext({
      location: "mars",
      returnPath: "commit",
    });
    expect(r.violations).toContain("unknown-location");
  });

  it("flags a remote session with no return path", () => {
    const r = validateExecutionContext({
      location: "cloud",
      returnPath: "none",
    });
    expect(r.violations).toContain("remote-without-return-path");
  });

  it("flags remote network/external egress as needing acknowledgement", () => {
    const r = validateExecutionContext({
      location: "ssh",
      permissions: { network: true },
      returnPath: "pr",
    });
    expect(r.violations).toContain("remote-egress-granted");
  });

  it("collects multiple violations at once", () => {
    const r = validateExecutionContext({
      location: "mars",
      credentials: [{ name: "x", value: "secret" }],
      returnPath: "none",
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("credential-value-present");
    expect(r.violations).toContain("unknown-location");
    // "mars" → UNKNOWN → not classified remote, so no remote-* violations
    expect(r.violations).not.toContain("remote-without-return-path");
  });
});
