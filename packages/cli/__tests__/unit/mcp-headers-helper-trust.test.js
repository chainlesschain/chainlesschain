import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkLocalMcpHeadersHelperTrust,
  recordLocalMcpHeadersHelperTrust,
  revokeLocalMcpHeadersHelperTrust,
} from "../../src/lib/mcp-headers-helper-trust.js";

let root;
let storePath;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-helper-trust-"));
  storePath = path.join(root, "security", "trust.json");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function helperSpec(overrides = {}) {
  return {
    workspaceRoot: root,
    serverName: "internal-api",
    url: "https://mcp.example.test/rpc",
    transport: "https",
    headersHelper: "credential-helper --profile production",
    ...overrides,
  };
}

describe("local MCP headersHelper consent", () => {
  it("binds consent to workspace, server, endpoint, transport, and command", () => {
    expect(
      checkLocalMcpHeadersHelperTrust(helperSpec(), { storePath }),
    ).toMatchObject({ status: "first-use" });
    expect(
      recordLocalMcpHeadersHelperTrust(helperSpec(), {
        storePath,
        now: 1_700_000_000_000,
      }),
    ).toBe(true);
    expect(
      checkLocalMcpHeadersHelperTrust(helperSpec(), { storePath }),
    ).toMatchObject({ status: "trusted" });
    for (const changed of [
      { headersHelper: "credential-helper --profile staging" },
      { url: "https://other.example.test/rpc" },
      { transport: "sse" },
      { serverName: "other-api" },
      { serverName: " internal-api " },
    ]) {
      expect(
        checkLocalMcpHeadersHelperTrust(helperSpec(changed), { storePath }),
      ).not.toMatchObject({ status: "trusted" });
    }
  });

  it("revokes a standing grant without storing the helper command", () => {
    const spec = helperSpec();
    recordLocalMcpHeadersHelperTrust(spec, { storePath });
    const serialized = fs.readFileSync(storePath, "utf8");
    expect(serialized).not.toContain(spec.headersHelper);
    expect(revokeLocalMcpHeadersHelperTrust(spec, { storePath })).toBe(true);
    expect(checkLocalMcpHeadersHelperTrust(spec, { storePath })).toMatchObject({
      status: "first-use",
    });
  });

  it("preserves corrupt trust evidence and fails closed", () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{broken", "utf8");
    expect(() =>
      checkLocalMcpHeadersHelperTrust(helperSpec(), { storePath }),
    ).toThrow(/corrupt/i);
    expect(() =>
      recordLocalMcpHeadersHelperTrust(helperSpec(), { storePath }),
    ).toThrow(/corrupt/i);
    expect(fs.readFileSync(storePath, "utf8")).toBe("{broken");
  });
});
