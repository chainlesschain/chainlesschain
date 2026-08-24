import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const {
  MCPSecurityAuditStore,
} = require("../../../src/main/mcp/mcp-security-audit-store");

describe("MCPSecurityAuditStore", () => {
  it("appends JSONL with private permissions and supports bounded queries", () => {
    let contents = "";
    const fakeFs = {
      mkdirSync: vi.fn(),
      appendFileSync: vi.fn((_file, value) => {
        contents += value;
      }),
      chmodSync: vi.fn(),
      readFileSync: vi.fn(() => contents),
    };
    const store = new MCPSecurityAuditStore(
      path.resolve("mcp-security-audit.jsonl"),
      { fs: fakeFs },
    );

    store.append({ timestamp: 1, decision: "DENIED", serverName: "a" });
    store.append({ timestamp: 2, decision: "ALLOWED", serverName: "b" });

    expect(fakeFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      mode: 0o700,
    });
    expect(fakeFs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ mode: 0o600, flag: "a" }),
    );
    expect(store.query({ decision: "ALLOWED" })).toEqual([
      { timestamp: 2, decision: "ALLOWED", serverName: "b" },
    ]);
  });
});
