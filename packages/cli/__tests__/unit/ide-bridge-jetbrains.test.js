/**
 * Phase 3 guarantee: the CLI's IDE discovery is EDITOR-AGNOSTIC. A lockfile
 * written by the JetBrains plugin (`ide:"jetbrains"`) is discovered + mapped to
 * an MCP config exactly like a VS Code one — i.e. the CLI needs zero changes to
 * support a second editor. (The JetBrains MCP server's protocol parity is
 * proven separately by the cross-language interop probe in
 * packages/jetbrains-plugin.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  _deps,
  readIdeLocks,
  discoverIdeServer,
  ideServerToMcpConfig,
} from "../../src/lib/ide-bridge.js";

const HOME = "/home/u";
const NOW = 1_700_000_000_000;
let files;
const orig = {};

beforeEach(() => {
  for (const k of Object.keys(_deps)) orig[k] = _deps[k];
  files = {};
  _deps.homedir = () => HOME;
  _deps.now = () => NOW;
  _deps.processAlive = () => true;
  _deps.readDir = () => Object.keys(files);
  _deps.readFile = (p) => {
    const name = p.replace(/\\/g, "/").split("/").pop();
    if (files[name] === undefined) throw new Error("ENOENT");
    return files[name];
  };
  _deps.statMtimeMs = () => NOW;
});
afterEach(() => {
  for (const k of Object.keys(orig)) _deps[k] = orig[k];
});

// Exactly what LockfileWriter.java emits.
function jetbrainsLock(port = 63100) {
  return JSON.stringify({
    ide: "jetbrains",
    version: 1,
    transport: "http",
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    workspaceFolders: ["/abs/ws"],
    token: "jb-tok",
    pid: 9999,
    started_at: NOW,
  });
}

describe("CLI discovery is editor-agnostic (JetBrains)", () => {
  it("discovers a jetbrains lock just like a vscode one", () => {
    files["63100.json"] = jetbrainsLock();
    const locks = readIdeLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ ide: "jetbrains", transport: "http" });

    const chosen = discoverIdeServer({ cwd: "/abs/ws/src", env: {} });
    expect(chosen).toMatchObject({ ide: "jetbrains", port: 63100, token: "jb-tok" });
  });

  it("maps it to the same MCP config shape (Bearer + http)", () => {
    files["63100.json"] = jetbrainsLock();
    const cfg = ideServerToMcpConfig(discoverIdeServer({ cwd: "/abs/ws", env: {} }));
    expect(cfg).toEqual({
      url: "http://127.0.0.1:63100/mcp",
      transport: "http",
      headers: { Authorization: "Bearer jb-tok" },
      longRunning: true,
    });
  });

  it("env fast-path + reserved name `ide` work regardless of editor", () => {
    files["63100.json"] = jetbrainsLock();
    const viaEnv = discoverIdeServer({
      cwd: "/elsewhere",
      env: { CHAINLESSCHAIN_IDE_PORT: "63100" },
    });
    expect(viaEnv.ide).toBe("jetbrains");
    expect(viaEnv.port).toBe(63100);
  });

  it("a vscode and a jetbrains lock coexist; newest wins on tie", () => {
    files["63100.json"] = jetbrainsLock(63100);
    files["63200.json"] = JSON.stringify({
      ide: "vscode",
      transport: "http",
      url: "http://127.0.0.1:63200/mcp",
      port: 63200,
      workspaceFolders: ["/abs/ws"],
      token: "vs-tok",
      pid: 1,
      started_at: NOW + 1000, // newer
    });
    const chosen = discoverIdeServer({ cwd: "/abs/ws", env: {} });
    expect(chosen.port).toBe(63200); // newest started_at wins the tie
    expect(readIdeLocks()).toHaveLength(2);
  });
});
