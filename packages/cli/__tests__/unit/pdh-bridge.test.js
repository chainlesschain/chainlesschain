/**
 * PDH bridge discovery (Phase 0) — env fast-path, lockfile scan, validation
 * filters (localhost / transport / stale / foreign-kind), newest-lock fallback,
 * MCP config generation, and the doctor diagnosis. Pure unit via _deps.
 * Mirrors ide-bridge.test.js. Design: docs/design/modules/101_个人数据IDE桥接方案.md
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  _deps,
  pdhLockDir,
  readPdhLocks,
  isInPdhTerminal,
  discoverPdhServer,
  pdhServerToMcpConfig,
  diagnosePdh,
} from "../../src/lib/pdh-bridge.js";

const HOME = "/home/u";
const NOW = 1_700_000_000_000;

// A virtual lock dir: { "<file>.json": <object|string> }. Keys MUST end in
// .json or readPdhLocks skips them by name (so the validation filters below
// are actually exercised, not short-circuited by the name check).
let files;
const orig = {};

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
    kind: "pdh-bridge",
    version: 1,
    transport: "http",
    url: "http://127.0.0.1:53690/mcp",
    port: 53690,
    device: "android",
    appUid: 10306,
    token: "secret-tok",
    pid: 4242,
    started_at: NOW,
    ...extra,
  };
}

describe("pdhLockDir", () => {
  it("is ~/.chainlesschain/pdh-bridge", () => {
    expect(pdhLockDir().replace(/\\/g, "/")).toBe(
      "/home/u/.chainlesschain/pdh-bridge",
    );
  });
});

describe("readPdhLocks — validation filters", () => {
  it("reads a well-formed lock", () => {
    files = { "53690.json": lock() };
    const out = readPdhLocks();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      device: "android",
      appUid: 10306,
      transport: "http",
      port: 53690,
      token: "secret-tok",
    });
  });

  it("skips non-localhost url", () => {
    files = { "a.json": lock({ url: "http://10.0.0.5:53690/mcp" }) };
    expect(readPdhLocks()).toHaveLength(0);
  });

  it("skips unsupported transport (ws)", () => {
    files = { "a.json": lock({ transport: "ws" }) };
    expect(readPdhLocks()).toHaveLength(0);
  });

  it("rejects a foreign kind", () => {
    files = { "a.json": lock({ kind: "ide" }) };
    expect(readPdhLocks()).toHaveLength(0);
  });

  it("tolerates an absent kind (dir already scopes us)", () => {
    const l = lock();
    delete l.kind;
    files = { "a.json": l };
    expect(readPdhLocks()).toHaveLength(1);
  });

  it("skips malformed json and non-.json names", () => {
    files = {
      "bad.json": "{not json",
      "ignore-no-ext": lock(),
      "ok.json": lock(),
    };
    expect(readPdhLocks()).toHaveLength(1);
  });

  it("drops a stale lock (dead pid + old mtime)", () => {
    _deps.statMtimeMs = () => NOW - 60_000; // older than 30s TTL
    files = { "a.json": lock({ pid: 999 }) };
    expect(readPdhLocks()).toHaveLength(0);
  });

  it("keeps a fresh lock even with a dead pid (mtime within TTL)", () => {
    _deps.statMtimeMs = () => NOW - 5_000;
    files = { "a.json": lock({ pid: 999 }) };
    expect(readPdhLocks()).toHaveLength(1);
  });

  it("keeps a lock whose pid is alive regardless of mtime", () => {
    _deps.processAlive = () => true;
    _deps.statMtimeMs = () => NOW - 10 * 60_000;
    files = { "a.json": lock({ pid: 4242 }) };
    expect(readPdhLocks()).toHaveLength(1);
  });

  it("returns [] when the dir is missing", () => {
    _deps.readDir = () => {
      throw new Error("ENOENT");
    };
    expect(readPdhLocks()).toEqual([]);
  });
});

describe("isInPdhTerminal", () => {
  it("true when CHAINLESSCHAIN_PDH_PORT is set", () => {
    expect(isInPdhTerminal({ CHAINLESSCHAIN_PDH_PORT: "53690" })).toBe(true);
  });
  it("true when CHAINLESSCHAIN_PDH flag is set", () => {
    expect(isInPdhTerminal({ CHAINLESSCHAIN_PDH: "1" })).toBe(true);
  });
  it("false otherwise", () => {
    expect(isInPdhTerminal({})).toBe(false);
    expect(isInPdhTerminal(null)).toBe(false);
  });
});

describe("discoverPdhServer", () => {
  it("returns null with no locks", () => {
    expect(discoverPdhServer({ env: {} })).toBeNull();
  });

  it("path A: env port matches a live lock", () => {
    files = {
      "111.json": lock({ port: 111, started_at: NOW - 1000 }),
      "222.json": lock({ port: 222, started_at: NOW - 5000 }),
    };
    const hit = discoverPdhServer({ env: { CHAINLESSCHAIN_PDH_PORT: "222" } });
    expect(hit.port).toBe(222);
  });

  it("path A: token falls back to env when lock has none", () => {
    files = { "222.json": lock({ port: 222, token: null }) };
    const hit = discoverPdhServer({
      env: {
        CHAINLESSCHAIN_PDH_PORT: "222",
        CHAINLESSCHAIN_PDH_TOKEN: "envtok",
      },
    });
    expect(hit.token).toBe("envtok");
  });

  it("path B: newest live lock when no env port", () => {
    files = {
      "111.json": lock({ port: 111, started_at: NOW - 5000 }),
      "222.json": lock({ port: 222, started_at: NOW - 1000 }),
    };
    expect(discoverPdhServer({ env: {} }).port).toBe(222);
  });

  it("env port with no live lock falls through to newest", () => {
    files = { "111.json": lock({ port: 111, started_at: NOW }) };
    const hit = discoverPdhServer({ env: { CHAINLESSCHAIN_PDH_PORT: "999" } });
    expect(hit.port).toBe(111);
  });
});

describe("pdhServerToMcpConfig", () => {
  it("builds a bearer + longRunning config", () => {
    const cfg = pdhServerToMcpConfig({
      url: "http://127.0.0.1:1/mcp",
      transport: "http",
      token: "tok",
    });
    expect(cfg).toEqual({
      url: "http://127.0.0.1:1/mcp",
      transport: "http",
      headers: { Authorization: "Bearer tok" },
      longRunning: true,
    });
  });

  it("omits Authorization when there is no token", () => {
    const cfg = pdhServerToMcpConfig({
      url: "http://127.0.0.1:1/mcp",
      transport: "http",
      token: null,
    });
    expect(cfg.headers).toEqual({});
  });

  it("null for a bad lock", () => {
    expect(pdhServerToMcpConfig(null)).toBeNull();
    expect(pdhServerToMcpConfig({})).toBeNull();
  });
});

describe("diagnosePdh", () => {
  it("explains the env fast-path hit + masks token presence", () => {
    files = { "222.json": lock({ port: 222 }) };
    const d = diagnosePdh({ env: { CHAINLESSCHAIN_PDH_PORT: "222" } });
    expect(d.inPdhTerminal).toBe(true);
    expect(d.chosen.port).toBe(222);
    expect(d.reason).toMatch(/CHAINLESSCHAIN_PDH_PORT/);
    expect(d.locks[0].hasToken).toBe(true);
    expect(d.locks[0]).not.toHaveProperty("token"); // never leak the token
  });

  it("explains 'no locks'", () => {
    const d = diagnosePdh({ env: {} });
    expect(d.chosen).toBeNull();
    expect(d.reason).toMatch(/no live PDH lockfiles/);
  });

  it("picks newest live lock outside an env fast-path", () => {
    files = {
      "111.json": lock({ port: 111, started_at: NOW - 5000 }),
      "222.json": lock({ port: 222, started_at: NOW - 1000 }),
    };
    const d = diagnosePdh({ env: {} });
    expect(d.chosen.port).toBe(222);
    expect(d.reason).toBe("newest live lock");
  });
});
