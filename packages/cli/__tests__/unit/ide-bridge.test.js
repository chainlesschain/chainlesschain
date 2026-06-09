/**
 * IDE bridge discovery (Phase 0) — env fast-path, lockfile scan, validation
 * filters (localhost / transport / stale), multi-root longest-prefix workspace
 * match, MCP config generation, and the doctor diagnosis. Pure unit via _deps.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  _deps,
  ideLockDir,
  readIdeLocks,
  isInIdeTerminal,
  discoverIdeServer,
  ideServerToMcpConfig,
  diagnoseIde,
} from "../../src/lib/ide-bridge.js";

const HOME = "/home/u";
const NOW = 1_700_000_000_000;

// A virtual lock dir: { "<file>.json": <object|string> }.
let files;
const orig = {};

function setFiles(map) {
  files = map;
}

beforeEach(() => {
  for (const k of Object.keys(_deps)) orig[k] = _deps[k];
  files = {};
  _deps.homedir = () => HOME;
  _deps.now = () => NOW;
  _deps.processAlive = () => false; // freshness decided by mtime
  _deps.readDir = () => Object.keys(files);
  _deps.readFile = (p) => {
    const name = p.replace(/\\/g, "/").split("/").pop();
    const v = files[name];
    if (v === undefined) throw new Error("ENOENT");
    return typeof v === "string" ? v : JSON.stringify(v);
  };
  _deps.statMtimeMs = () => NOW; // fresh by default
});

afterEach(() => {
  for (const k of Object.keys(orig)) _deps[k] = orig[k];
});

function lock(extra = {}) {
  return {
    ide: "vscode",
    version: 1,
    transport: "sse",
    url: "http://127.0.0.1:53690/sse",
    port: 53690,
    workspaceFolders: ["/abs/ws"],
    token: "secret-tok",
    pid: 4242,
    started_at: NOW,
    ...extra,
  };
}

describe("ideLockDir", () => {
  it("is ~/.chainlesschain/ide", () => {
    expect(ideLockDir().replace(/\\/g, "/")).toBe(`${HOME}/.chainlesschain/ide`);
  });
});

describe("readIdeLocks — validation filters", () => {
  it("returns a normalized live lock", () => {
    setFiles({ "53690.json": lock() });
    const locks = readIdeLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      ide: "vscode",
      transport: "sse",
      port: 53690,
      token: "secret-tok",
      workspaceFolders: ["/abs/ws"],
    });
  });

  it("drops non-localhost urls", () => {
    setFiles({ "1.json": lock({ url: "http://10.0.0.5:53690/sse" }) });
    expect(readIdeLocks()).toHaveLength(0);
  });

  it("drops unsupported transports (ws not implemented)", () => {
    setFiles({
      "1.json": lock({ transport: "ws", url: "ws://127.0.0.1:1/sse" }),
    });
    expect(readIdeLocks()).toHaveLength(0);
  });

  it("drops malformed json", () => {
    setFiles({ "1.json": "{not json" });
    expect(readIdeLocks()).toHaveLength(0);
  });

  it("drops non-.json files", () => {
    setFiles({ "README.txt": lock() });
    expect(readIdeLocks()).toHaveLength(0);
  });

  it("drops stale locks (dead pid + old mtime)", () => {
    setFiles({ "1.json": lock() });
    _deps.statMtimeMs = () => NOW - 60_000; // older than 30s TTL
    expect(readIdeLocks()).toHaveLength(0);
  });

  it("keeps a dead-pid lock that was written recently", () => {
    setFiles({ "1.json": lock() });
    _deps.statMtimeMs = () => NOW - 5_000; // within TTL
    expect(readIdeLocks()).toHaveLength(1);
  });

  it("keeps a lock whose pid is alive even if file is old", () => {
    setFiles({ "1.json": lock() });
    _deps.processAlive = () => true;
    _deps.statMtimeMs = () => NOW - 999_999;
    expect(readIdeLocks()).toHaveLength(1);
  });

  it("normalizes a string workspaceFolders to an array", () => {
    setFiles({ "1.json": lock({ workspaceFolders: "/abs/ws" }) });
    expect(readIdeLocks()[0].workspaceFolders).toEqual(["/abs/ws"]);
  });

  it("returns [] when the lock dir is missing", () => {
    _deps.readDir = () => {
      throw new Error("ENOENT");
    };
    expect(readIdeLocks()).toEqual([]);
  });
});

describe("isInIdeTerminal", () => {
  it("true for CHAINLESSCHAIN_IDE_PORT", () => {
    expect(isInIdeTerminal({ CHAINLESSCHAIN_IDE_PORT: "53690" })).toBe(true);
  });
  it("true for TERM_PROGRAM=vscode", () => {
    expect(isInIdeTerminal({ TERM_PROGRAM: "vscode" })).toBe(true);
  });
  it("true for JetBrains JediTerm", () => {
    expect(
      isInIdeTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }),
    ).toBe(true);
  });
  it("false for a plain shell", () => {
    expect(isInIdeTerminal({ TERM: "xterm-256color" })).toBe(false);
  });
});

describe("discoverIdeServer — path A (env fast-path)", () => {
  it("locks onto the port named by CHAINLESSCHAIN_IDE_PORT", () => {
    setFiles({
      "100.json": lock({ port: 100, workspaceFolders: ["/other"] }),
      "200.json": lock({ port: 200, workspaceFolders: ["/other"] }),
    });
    const hit = discoverIdeServer({
      cwd: "/nowhere",
      env: { CHAINLESSCHAIN_IDE_PORT: "200" },
    });
    expect(hit.port).toBe(200); // chosen by env, NOT by workspace
  });

  it("supplies token from env when the lock omits it", () => {
    setFiles({ "200.json": lock({ port: 200, token: undefined }) });
    const hit = discoverIdeServer({
      cwd: "/x",
      env: { CHAINLESSCHAIN_IDE_PORT: "200", CHAINLESSCHAIN_IDE_TOKEN: "envtok" },
    });
    expect(hit.token).toBe("envtok");
  });

  it("falls through to scan when env port has no live lock", () => {
    setFiles({ "300.json": lock({ port: 300, workspaceFolders: ["/abs/ws"] }) });
    const hit = discoverIdeServer({
      cwd: "/abs/ws/sub",
      env: { CHAINLESSCHAIN_IDE_PORT: "999" },
    });
    expect(hit.port).toBe(300); // env port absent → workspace scan wins
  });
});

describe("discoverIdeServer — path B (scan + workspace match)", () => {
  it("matches when cwd is under a workspace folder", () => {
    setFiles({ "1.json": lock({ workspaceFolders: ["/abs/ws"] }) });
    const hit = discoverIdeServer({ cwd: "/abs/ws/src/deep", env: {} });
    expect(hit.port).toBe(53690);
  });

  it("returns null when no folder contains cwd", () => {
    setFiles({ "1.json": lock({ workspaceFolders: ["/abs/ws"] }) });
    expect(discoverIdeServer({ cwd: "/somewhere/else", env: {} })).toBeNull();
  });

  it("prefers the longest-prefix (most specific) folder", () => {
    setFiles({
      "1.json": lock({ port: 1, workspaceFolders: ["/abs"] }),
      "2.json": lock({ port: 2, workspaceFolders: ["/abs/ws/inner"] }),
    });
    const hit = discoverIdeServer({ cwd: "/abs/ws/inner/x", env: {} });
    expect(hit.port).toBe(2);
  });

  it("breaks ties by newest started_at", () => {
    setFiles({
      "1.json": lock({ port: 1, started_at: NOW - 1000 }),
      "2.json": lock({ port: 2, started_at: NOW }),
    });
    const hit = discoverIdeServer({ cwd: "/abs/ws", env: {} });
    expect(hit.port).toBe(2);
  });

  it("force picks the newest lock even with no workspace match", () => {
    setFiles({
      "1.json": lock({ port: 1, workspaceFolders: ["/x"], started_at: NOW - 5 }),
      "2.json": lock({ port: 2, workspaceFolders: ["/y"], started_at: NOW }),
    });
    const hit = discoverIdeServer({ cwd: "/elsewhere", env: {}, force: true });
    expect(hit.port).toBe(2);
  });

  it("returns null with no locks at all", () => {
    setFiles({});
    expect(discoverIdeServer({ cwd: "/abs/ws", env: {} })).toBeNull();
  });
});

describe("ideServerToMcpConfig", () => {
  it("emits url/transport + Bearer header + longRunning", () => {
    const cfg = ideServerToMcpConfig({
      url: "http://127.0.0.1:1/sse",
      transport: "sse",
      token: "tok",
    });
    expect(cfg).toEqual({
      url: "http://127.0.0.1:1/sse",
      transport: "sse",
      headers: { Authorization: "Bearer tok" },
      longRunning: true,
    });
  });

  it("omits the Authorization header when there is no token", () => {
    const cfg = ideServerToMcpConfig({
      url: "http://127.0.0.1:1/sse",
      transport: "sse",
      token: null,
    });
    expect(cfg.headers).toEqual({});
  });

  it("returns null for a missing lock/url", () => {
    expect(ideServerToMcpConfig(null)).toBeNull();
    expect(ideServerToMcpConfig({})).toBeNull();
  });
});

describe("diagnoseIde", () => {
  it("explains an env-port match", () => {
    setFiles({ "200.json": lock({ port: 200 }) });
    const d = diagnoseIde({
      cwd: "/x",
      env: { CHAINLESSCHAIN_IDE_PORT: "200" },
    });
    expect(d.chosen.port).toBe(200);
    expect(d.reason).toMatch(/env fast-path/);
  });

  it("explains no live lockfiles", () => {
    setFiles({});
    const d = diagnoseIde({ cwd: "/x", env: {} });
    expect(d.chosen).toBeNull();
    expect(d.reason).toMatch(/no live IDE lockfiles/);
  });

  it("explains a workspace mismatch", () => {
    setFiles({ "1.json": lock({ workspaceFolders: ["/abs/ws"] }) });
    const d = diagnoseIde({ cwd: "/somewhere/else", env: {} });
    expect(d.chosen).toBeNull();
    expect(d.reason).toMatch(/none match cwd/);
    expect(d.locks[0].matchScore).toBe(-1);
  });
});
