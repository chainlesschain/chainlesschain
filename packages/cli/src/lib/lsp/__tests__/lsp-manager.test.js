/**
 * LSPManager tests — server pooling, document open/change sync, diagnostics
 * collection, and position conversion. A fake client is injected via
 * `_deps.createClient`; the registry resolves a server via `_deps.existsSync`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import path from "path";
import {
  LSPManager,
  toLspPosition,
  fromLspPosition,
  _deps,
} from "../lsp-manager.js";
import { _deps as regDeps } from "../lsp-server-registry.js";

/** Minimal fake LSPClient: records notifications, canned requests, emits events. */
class FakeClient extends EventEmitter {
  constructor(opts) {
    super();
    this.rootPath = opts.rootPath;
    this.running = true;
    this.notifications = [];
    this.started = false;
  }
  async start() {
    this.started = true;
    return { definitionProvider: true };
  }
  notify(method, params) {
    this.notifications.push({ method, params });
  }
  async request() {
    return null;
  }
  async stop() {
    this.running = false;
  }
}

let origCreate, origRead, origExistsMgr, origExistsReg;
let lastClient;

beforeEach(() => {
  origCreate = _deps.createClient;
  origRead = _deps.readFileSync;
  origExistsMgr = _deps.existsSync;
  origExistsReg = regDeps.existsSync;

  _deps.createClient = (opts) => {
    lastClient = new FakeClient(opts);
    return lastClient;
  };
  _deps.readFileSync = () => "const x = 1;\n";
  // root inference: pretend the nearest /proj ancestor has package.json.
  // Suffix match tolerates path.resolve prepending a drive letter on Windows.
  _deps.existsSync = (p) =>
    String(p).replace(/\\/g, "/").endsWith("/proj/package.json");
  // registry: pretend the TS server bin exists in <root>/node_modules/.bin
  const isWin = process.platform === "win32";
  const binName = isWin
    ? "typescript-language-server.cmd"
    : "typescript-language-server";
  regDeps.existsSync = (p) =>
    String(p).replace(/\\/g, "/").endsWith(`/node_modules/.bin/${binName}`);
});

afterEach(() => {
  _deps.createClient = origCreate;
  _deps.readFileSync = origRead;
  _deps.existsSync = origExistsMgr;
  regDeps.existsSync = origExistsReg;
  vi.restoreAllMocks();
});

describe("position helpers", () => {
  it("converts 1-based ⇄ 0-based", () => {
    expect(toLspPosition({ line: 1, col: 1 })).toEqual({
      line: 0,
      character: 0,
    });
    expect(toLspPosition({ line: 10, col: 5 })).toEqual({
      line: 9,
      character: 4,
    });
    expect(fromLspPosition({ line: 0, character: 0 })).toEqual({
      line: 1,
      col: 1,
    });
    expect(fromLspPosition({ line: 9, character: 4 })).toEqual({
      line: 10,
      col: 5,
    });
  });
  it("clamps below 1 to 0 (no negatives to the server)", () => {
    expect(toLspPosition({ line: 0, col: 0 })).toEqual({
      line: 0,
      character: 0,
    });
  });
});

describe("ensureFor", () => {
  it("starts a server and sends didOpen the first time", async () => {
    const mgr = new LSPManager();
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.languageId).toBe("typescript");
    expect(ready.root.replace(/\\/g, "/")).toMatch(/\/proj$/);
    expect(lastClient.started).toBe(true);
    const open = lastClient.notifications.find(
      (n) => n.method === "textDocument/didOpen",
    );
    expect(open.params.textDocument.text).toBe("const x = 1;\n");
    await mgr.disposeAll();
  });

  it("sends didChange (not a second didOpen) on the next access", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    await mgr.ensureFor("/proj/src/a.ts");
    const opens = lastClient.notifications.filter(
      (n) => n.method === "textDocument/didOpen",
    );
    const changes = lastClient.notifications.filter(
      (n) => n.method === "textDocument/didChange",
    );
    expect(opens).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].params.textDocument.version).toBe(2);
    await mgr.disposeAll();
  });

  it("reuses one server for two files in the same project/language", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    const first = lastClient;
    await mgr.ensureFor("/proj/src/b.ts");
    expect(lastClient).toBe(first); // same client instance
    expect(mgr.activeServerCount).toBe(1);
    await mgr.disposeAll();
  });

  it("spawns only ONE server when two concurrent calls race the same key", async () => {
    // Regression: ensureFor did Map.get(miss)→await start→Map.set with no
    // in-flight dedupe, so two concurrent calls (the read-only agent batch fires
    // several code_intelligence calls at once) both spawned a server; the second
    // set() orphaned the first process. Gate start() so both calls interleave
    // inside the await window, then assert a single spawn.
    let created = 0;
    let releaseStart;
    const gate = new Promise((r) => {
      releaseStart = r;
    });
    _deps.createClient = (opts) => {
      created += 1;
      lastClient = new FakeClient(opts);
      const origStart = lastClient.start.bind(lastClient);
      lastClient.start = async () => {
        await gate; // hold both starts open until released
        return origStart();
      };
      return lastClient;
    };
    const mgr = new LSPManager();
    const p1 = mgr.ensureFor("/proj/src/a.ts");
    const p2 = mgr.ensureFor("/proj/src/b.ts");
    releaseStart();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(created).toBe(1); // NOT two — the race is deduped
    expect(mgr.activeServerCount).toBe(1);
    expect(r1.client).toBe(r2.client);
    await mgr.disposeAll();
  });

  it("returns unavailable for an unsupported extension", async () => {
    const mgr = new LSPManager();
    const ready = await mgr.ensureFor("/proj/readme.txt");
    expect(ready.unavailable).toBe(true);
    expect(ready.reason).toMatch(/no language mapping/);
    await mgr.disposeAll();
  });

  it("returns unavailable when no server bin is installed", async () => {
    regDeps.existsSync = () => false; // nothing installed
    const mgr = new LSPManager();
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.unavailable).toBe(true);
    expect(ready.reason).toMatch(/no language server installed/);
    await mgr.disposeAll();
  });
});

describe("crash-loop restart guard", () => {
  // Simulate a language server process dying: the client marks itself not
  // running and emits `exit`, exactly as the real LSPClient does on child exit.
  function crash(client) {
    client.running = false;
    client.emit("exit", 1, null);
  }

  it("re-spawns a crashed server on the next request (auto-restart)", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    const first = lastClient;
    crash(first);
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.unavailable).toBeUndefined();
    expect(lastClient).not.toBe(first); // a FRESH client was spawned
    expect(lastClient.started).toBe(true);
    expect(ready.client).toBe(lastClient);
    await mgr.disposeAll();
  });

  it("quarantines a server that crash-loops past maxRestarts within the window", async () => {
    let t = 1000;
    const mgr = new LSPManager({
      maxRestarts: 3,
      restartWindowMs: 30000,
      now: () => t,
    });
    for (let i = 0; i < 3; i++) {
      await mgr.ensureFor("/proj/src/a.ts");
      t += 100;
      crash(lastClient);
    }
    // 3 crashes are now inside the window → the next request quarantines the
    // server (degrade to text search) rather than thrash-respawning it.
    const before = lastClient;
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.unavailable).toBe(true);
    expect(ready.quarantined).toBe(true);
    expect(ready.reason).toMatch(/crash-looped/);
    expect(lastClient).toBe(before); // did NOT spawn yet another
    await mgr.disposeAll();
  });

  it("recovers and re-spawns once the crash window clears", async () => {
    let t = 1000;
    const mgr = new LSPManager({
      maxRestarts: 3,
      restartWindowMs: 30000,
      now: () => t,
    });
    for (let i = 0; i < 3; i++) {
      await mgr.ensureFor("/proj/src/a.ts");
      t += 100;
      crash(lastClient);
    }
    expect((await mgr.ensureFor("/proj/src/a.ts")).quarantined).toBe(true);
    // Stay healthy past the window → crash history prunes → a fresh start is
    // allowed again (a server isn't quarantined forever).
    t += 30001;
    const quarantined = lastClient;
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.unavailable).toBeUndefined();
    expect(lastClient).not.toBe(quarantined);
    await mgr.disposeAll();
  });

  describe("exponential restart backoff (opt-in)", () => {
    it("computes exponential backoff per crash, capped, and 0 when disabled", () => {
      const on = new LSPManager({
        restartBackoffBaseMs: 1000,
        restartBackoffMaxMs: 8000,
      });
      expect(on._restartBackoffMs(0)).toBe(0); // first start — no wait
      expect(on._restartBackoffMs(1)).toBe(1000);
      expect(on._restartBackoffMs(2)).toBe(2000);
      expect(on._restartBackoffMs(3)).toBe(4000);
      expect(on._restartBackoffMs(4)).toBe(8000);
      expect(on._restartBackoffMs(5)).toBe(8000); // capped
      // Disabled by default → always 0 (byte-identical immediate respawn).
      const off = new LSPManager();
      expect(off.restartBackoffBaseMs).toBe(0);
      expect(off._restartBackoffMs(2)).toBe(0);
    });

    it("degrades (backing off) during the cooldown, then re-spawns once it elapses", async () => {
      let t = 1000;
      const mgr = new LSPManager({
        maxRestarts: 5,
        restartWindowMs: 60000,
        restartBackoffBaseMs: 1000,
        restartBackoffMaxMs: 8000,
        now: () => t,
      });
      await mgr.ensureFor("/proj/src/a.ts"); // spawn #1
      const first = lastClient;
      crash(first); // 1 crash at t=1000
      // Same tick → within the 1st-crash backoff (1000ms) → degrade, no respawn.
      const backingOff = await mgr.ensureFor("/proj/src/a.ts");
      expect(backingOff.unavailable).toBe(true);
      expect(backingOff.backoff).toBe(true);
      expect(backingOff.quarantined).toBeUndefined();
      expect(backingOff.retryInMs).toBe(1000);
      expect(lastClient).toBe(first); // did NOT spawn during cooldown
      // Advance past the cooldown → a fresh spawn is allowed.
      t += 1000;
      const ready = await mgr.ensureFor("/proj/src/a.ts");
      expect(ready.unavailable).toBeUndefined();
      expect(lastClient).not.toBe(first);
      await mgr.disposeAll();
    });

    it("does NOT back off by default — respawns a crashed server on the next request", async () => {
      const mgr = new LSPManager({ maxRestarts: 3, now: () => 5000 });
      await mgr.ensureFor("/proj/src/a.ts");
      const first = lastClient;
      crash(first);
      // Same tick, backoff disabled → immediate fresh spawn (prior behaviour).
      const ready = await mgr.ensureFor("/proj/src/a.ts");
      expect(ready.unavailable).toBeUndefined();
      expect(lastClient).not.toBe(first);
      await mgr.disposeAll();
    });
  });
});

describe("diagnostics", () => {
  it("collects pushed diagnostics keyed by file", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    lastClient.emit("notify:textDocument/publishDiagnostics", {
      uri: (await import("../lsp-client.js")).pathToFileUri(
        path.resolve("/proj/src/a.ts"),
      ),
      diagnostics: [
        {
          message: "boom",
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
    });
    const diags = mgr.getDiagnostics("/proj/src/a.ts");
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe("boom");
    await mgr.disposeAll();
  });

  it("clears stale diagnostics + readiness state when the server crashes", async () => {
    const { pathToFileUri } = await import("../lsp-client.js");
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    lastClient.emit("notify:textDocument/publishDiagnostics", {
      uri: pathToFileUri(path.resolve("/proj/src/a.ts")),
      diagnostics: [
        {
          message: "boom",
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
    });
    expect(mgr.getDiagnostics("/proj/src/a.ts")).toHaveLength(1);

    // Server crashes. Its diagnostics + publish bookkeeping must NOT survive —
    // otherwise the readiness waiters resolve on the pre-crash publish and a
    // post-restart query returns these stale results.
    lastClient.running = false;
    lastClient.emit("exit", 1, null);
    expect(mgr.getDiagnostics("/proj/src/a.ts")).toEqual([]);

    // A fresh query re-spawns the server; before it publishes, waitForDiagnostics
    // must not hand back the stale set (returns empty within the timeout budget).
    await mgr.ensureFor("/proj/src/a.ts");
    const afterRestart = await mgr.waitForDiagnostics("/proj/src/a.ts", {
      timeoutMs: 60,
      settleMs: 20,
    });
    expect(afterRestart).toEqual([]);
    await mgr.disposeAll();
  });
});

describe("disposeAll", () => {
  it("stops all servers and blocks further use", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    await mgr.disposeAll();
    expect(lastClient.running).toBe(false);
    await expect(mgr.ensureFor("/proj/src/a.ts")).rejects.toThrow(/disposed/);
  });
});
