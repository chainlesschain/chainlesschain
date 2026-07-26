import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkProjectMcpTrust,
  recordProjectMcpTrust,
  _deps,
} from "../../src/lib/project-mcp-trust.js";
import { loadProjectMcp } from "../../src/runtime/mcp-config.js";

let dir;
let store;
let originalDeps;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-mcp-trust-"));
  store = path.join(dir, "trust.json");
  originalDeps = { ..._deps };
});

afterEach(() => {
  Object.assign(_deps, originalDeps);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("project MCP trust store", () => {
  const projectFile = "C:/repo/.mcp.json";
  const content = '{"mcpServers":{"one":{"command":"node"}}}';

  it("round-trips a fingerprint under a fail-closed lock", () => {
    const realLock = _deps.withFileLock;
    _deps.withFileLock = vi.fn((target, body, options) =>
      realLock(target, body, options),
    );

    expect(checkProjectMcpTrust(projectFile, content, { storePath: store }))
      .toMatchObject({ status: "first-use" });
    expect(
      recordProjectMcpTrust(projectFile, content, {
        storePath: store,
        now: 1_700_000_000_000,
      }),
    ).toBe(true);
    expect(checkProjectMcpTrust(projectFile, content, { storePath: store }))
      .toMatchObject({ status: "trusted" });
    expect(checkProjectMcpTrust(projectFile, `${content} `, { storePath: store }))
      .toMatchObject({ status: "changed" });
    expect(_deps.withFileLock).toHaveBeenCalledWith(
      store,
      expect.any(Function),
      expect.objectContaining({ failIfUnavailable: true }),
    );
  });

  it("preserves corrupt trust bytes and fails closed", () => {
    fs.writeFileSync(store, "{broken", "utf8");
    expect(() =>
      checkProjectMcpTrust(projectFile, content, { storePath: store }),
    ).toThrow(/corrupt/i);
    expect(() =>
      recordProjectMcpTrust(projectFile, content, { storePath: store }),
    ).toThrow(/corrupt/i);
    expect(fs.readFileSync(store, "utf8")).toBe("{broken");
  });

  it("does not write when the trust lock is unavailable", () => {
    const unavailable = Object.assign(new Error("busy"), {
      code: "STATE_LOCK_UNAVAILABLE",
    });
    _deps.withFileLock = vi.fn(() => {
      throw unavailable;
    });
    expect(() =>
      recordProjectMcpTrust(projectFile, content, { storePath: store }),
    ).toThrow(unavailable);
    expect(fs.existsSync(store)).toBe(false);
  });
});

describe("project MCP runtime gate", () => {
  it("skips executable project config when trust state is unavailable", async () => {
    const errors = [];
    const createClient = vi.fn();
    const result = await loadProjectMcp(
      {
        cwd: dir,
        env: { CC_PROJECT_MCP: "1" },
      },
      {
        fileExists: () => true,
        readFile: () =>
          JSON.stringify({
            mcpServers: { dangerous: { command: "dangerous-command" } },
          }),
        writeErr: (message) => errors.push(message),
        createClient,
        projectMcpTrust: {
          checkProjectMcpTrust() {
            throw new Error("trust disk unavailable");
          },
          recordProjectMcpTrust: vi.fn(),
          projectMcpRetrustRequested: () => false,
        },
      },
    );

    expect(result).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(errors.join("")).toMatch(/SKIPPING.*trust state is unavailable/i);
  });

  it("skips first use when its trust record cannot be persisted", async () => {
    const errors = [];
    const result = await loadProjectMcp(
      { cwd: dir, env: { CC_PROJECT_MCP: "1" } },
      {
        fileExists: () => true,
        readFile: () =>
          JSON.stringify({
            mcpServers: { one: { command: "node" } },
          }),
        writeErr: (message) => errors.push(message),
        projectMcpTrust: {
          checkProjectMcpTrust: () => ({ status: "first-use" }),
          recordProjectMcpTrust: () => false,
          projectMcpRetrustRequested: () => false,
        },
      },
    );

    expect(result).toBeNull();
    expect(errors.join("")).toMatch(/SKIPPING.*not persisted/i);
  });
});
