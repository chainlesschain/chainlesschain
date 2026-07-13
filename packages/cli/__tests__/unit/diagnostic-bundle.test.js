/**
 * De-identified diagnostic bundle + secret-scan export gate (IDE gap P1-9
 * "脱敏诊断包"). Pure module. Load-bearing assertions: the excluded categories
 * (source / keys / cookies / full env / unpermitted terminal) never leave, and
 * the fail-closed gate blocks any bundle that still carries a secret.
 */
import { describe, it, expect } from "vitest";
import {
  EXCLUDED_BY_DEFAULT,
  summarizeEnv,
  buildDiagnosticBundle,
  scanBundleForSecrets,
  secretScanGate,
  exportDiagnosticBundle,
} from "../../src/lib/diagnostic-bundle.js";

const richInput = () => ({
  version: "0.162.163",
  platform: { os: "win32", node: "22.0.0" },
  connectionState: "ready",
  reconnectHistory: [{ at: 1000, reason: "socket hangup" }],
  trace: { traceId: "abc123", spanCount: 42 },
  redactionEvents: [
    { surface: "transcript", category: "provider_token", count: 2 },
  ],
  processes: [{ pid: 111, name: "cc serve", cpu: 3 }],
  ports: [8347, { port: 6333, proto: "tcp" }],
  lockfiles: ["/tmp/cc.lock"],
  worktrees: [{ path: "/repo/.wt/a", branch: "feat/x" }],
  env: {
    PATH: "/usr/bin",
    GITHUB_TOKEN: "ghp_realtokenshouldnotappear",
    HOME: "/home/u",
  },
});

describe("summarizeEnv", () => {
  it("keeps names only, flags secret-named vars, never a value", () => {
    const s = summarizeEnv({
      PATH: "/usr/bin",
      AWS_SECRET_ACCESS_KEY: "abcd",
      HOME: "/h",
    });
    expect(s.count).toBe(3);
    expect(s.names).toEqual(["AWS_SECRET_ACCESS_KEY", "HOME", "PATH"]);
    expect(s.secretNames).toEqual(["AWS_SECRET_ACCESS_KEY"]);
    // no value survives anywhere
    expect(JSON.stringify(s)).not.toContain("abcd");
  });
});

describe("buildDiagnosticBundle — contract fields", () => {
  it("assembles the required sections and the excluded-list", () => {
    const b = buildDiagnosticBundle(richInput());
    expect(b.schema).toBe("cc-diagnostic-bundle/v1");
    expect(b.meta.version).toBe("0.162.163");
    expect(b.capability).toBeTruthy();
    expect(b.connection.state).toBe("ready");
    expect(b.trace).toEqual({ traceId: "abc123", spanCount: 42 });
    expect(b.runtime.ports).toEqual([
      { port: 8347, proto: null },
      { port: 6333, proto: "tcp" },
    ]);
    expect(b.meta.excluded).toEqual(EXCLUDED_BY_DEFAULT);
  });

  it("reduces env to names only (no full environment values)", () => {
    const b = buildDiagnosticBundle(richInput());
    expect(b.env.names).toContain("GITHUB_TOKEN");
    expect(b.env.secretNames).toContain("GITHUB_TOKEN");
    expect(JSON.stringify(b)).not.toContain("ghp_realtokenshouldnotappear");
  });

  it("withholds terminal output by default, includes it only on explicit permission", () => {
    const withOutput = {
      ...richInput(),
      terminalOutput: "build ok\nexport API_KEY=sk-abcd1234efgh5678ijkl",
    };
    const dropped = buildDiagnosticBundle(withOutput);
    expect(dropped.terminalOutput).toBeNull();
    expect(dropped.terminalOutputWithheld).toBe(true);

    const kept = buildDiagnosticBundle(withOutput, {
      includeTerminalOutput: true,
    });
    expect(typeof kept.terminalOutput).toBe("string");
    // even when included, secrets in it are redacted
    expect(kept.terminalOutput).not.toContain("sk-abcd1234efgh5678ijkl");
    expect(kept.terminalOutput).toContain("build ok");
  });

  it("redacts secrets that ride in free-text fields (notes, reconnect reason)", () => {
    const b = buildDiagnosticBundle({
      ...richInput(),
      notes: "failed calling api with sk-abcd1234efgh5678ijkl",
      reconnectHistory: [
        { at: 1, reason: "auth Bearer aG9sZDpteS1zZWNyZXQtdG9rZW4 rejected" },
      ],
    });
    expect(b.notes).not.toContain("sk-abcd1234efgh5678ijkl");
    expect(b.connection.reconnectHistory[0].reason).not.toContain(
      "aG9sZDpteS1zZWNyZXQtdG9rZW4",
    );
  });
});

describe("scanBundleForSecrets / secretScanGate — fail closed", () => {
  it("a clean assembled bundle passes the gate", () => {
    const gate = secretScanGate(buildDiagnosticBundle(richInput()));
    expect(gate.ok).toBe(true);
    expect(gate.blocked).toBe(false);
    expect(gate.findings).toEqual([]);
  });

  it("a hand-tampered bundle with a residual secret is BLOCKED with a path", () => {
    const b = buildDiagnosticBundle(richInput());
    b.notes = "leftover sk-abcd1234efgh5678ijkl slipped in"; // bypass assembly redaction
    const gate = secretScanGate(b);
    expect(gate.ok).toBe(false);
    expect(gate.blocked).toBe(true);
    expect(gate.findings[0]).toMatchObject({
      path: "notes",
      category: "provider_token",
    });
  });

  it("scanBundleForSecrets reports nested paths", () => {
    const findings = scanBundleForSecrets({
      a: { b: ["ok", "Cookie: sid=deadbeefdeadbeef"] },
    });
    expect(findings[0].path).toBe("a.b[1]");
    expect(findings[0].category).toBe("cookie");
  });
});

describe("exportDiagnosticBundle — one-call assemble + gate", () => {
  it("returns an exportable bundle when clean", () => {
    const res = exportDiagnosticBundle(richInput());
    expect(res.ok).toBe(true);
    expect(res.bundle).toBeTruthy();
    expect(res.findings).toEqual([]);
    // the whole exported body is secret-free
    expect(scanBundleForSecrets(res.bundle)).toEqual([]);
  });

  it("never leaks a raw token even when one is fed through every text field", () => {
    const res = exportDiagnosticBundle({
      version: "sk-abcd1234efgh5678ijkl",
      connectionState: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      notes: "postgres://u:supersecretpw@db/app",
      env: { OPENAI_API_KEY: "sk-shouldnotappear12345678" },
    });
    expect(res.ok).toBe(true);
    const serialized = JSON.stringify(res.bundle);
    expect(serialized).not.toContain("sk-abcd1234efgh5678ijkl");
    expect(serialized).not.toContain(
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    );
    expect(serialized).not.toContain("supersecretpw");
    expect(serialized).not.toContain("sk-shouldnotappear12345678");
  });
});
