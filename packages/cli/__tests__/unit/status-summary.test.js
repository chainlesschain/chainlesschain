/**
 * `/status` renderer — concise environment snapshot. Pure + deterministic.
 */
import { describe, it, expect } from "vitest";
import { formatStatus } from "../../src/repl/status-summary.js";

describe("formatStatus", () => {
  const base = {
    version: "0.162.130",
    installedVersion: "0.162.130",
    node: "v22.22.2",
    platform: "win32-x64",
    provider: "volcengine",
    model: "doubao-seed-1-6-251015",
    sessionId: "sess_abc",
    messageCount: 12,
    cwd: "/proj",
    extraRoots: 0,
    ideConnected: false,
    mcpServers: 0,
    hookEvents: 0,
  };

  it("renders version, model, session, cwd and connection counts", () => {
    const out = formatStatus(base);
    expect(out).toMatch(/cc 0\.162\.130 {2}· {2}node v22\.22\.2 {2}· {2}win32-x64/);
    expect(out).toMatch(/provider\/model: volcengine \/ doubao-seed-1-6-251015/);
    expect(out).toMatch(/session: sess_abc {2}· {2}messages: 12/);
    expect(out).toMatch(/cwd: \/proj/);
    expect(out).toMatch(/IDE: none {2}· {2}MCP: 0 server\(s\) {2}· {2}hooks: 0 event\(s\)/);
    // no extra roots line when 0
    expect(out).not.toMatch(/extra roots/);
  });

  it("flags a disk-newer version (restart to apply)", () => {
    const out = formatStatus({ ...base, installedVersion: "0.162.131" });
    expect(out).toMatch(/cc 0\.162\.130 \(disk 0\.162\.131 — restart to apply\)/);
  });

  it("shows extra roots and live connection counts", () => {
    const out = formatStatus({
      ...base,
      extraRoots: 2,
      ideConnected: true,
      mcpServers: 3,
      hookEvents: 2,
    });
    expect(out).toMatch(/extra roots: \+2 \(\/add-dir\)/);
    expect(out).toMatch(/IDE: connected {2}· {2}MCP: 3 server\(s\) {2}· {2}hooks: 2 event\(s\)/);
  });

  it("degrades gracefully on missing fields", () => {
    const out = formatStatus({});
    expect(out).toMatch(/cc \?/);
    expect(out).toMatch(/session: \(none\)/);
    expect(out).toMatch(/messages: 0/);
  });
});
