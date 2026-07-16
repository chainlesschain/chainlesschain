import { describe, it, expect } from "vitest";
import {
  queueEntryKey,
  normalizeRecord,
  emptyQueue,
  coerceQueue,
  foldAppend,
  foldRemove,
  foldPruneStale,
  boundSessions,
  appendRewake,
  removeRewakes,
  takePending,
  loadQueue,
  MAX_RECORDS_PER_SESSION,
  MAX_SESSIONS,
  DEFAULT_STALE_MS,
} from "../../src/lib/async-hook-queue.cjs";

/**
 * A tiny in-memory fs implementing exactly the surface async-hook-queue uses
 * (existsSync/readFileSync/writeFileSync/renameSync/mkdirSync). Lets the IO
 * paths run deterministically without touching the real filesystem.
 */
function memFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error("ENOENT " + p);
      return files.get(p);
    },
    writeFileSync: (p, data) => files.set(p, data),
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      files.delete(a);
    },
    mkdirSync: () => {},
  };
}

const FILE = "/tmp/q/async-hook-queue.json";

function rec(over = {}) {
  return {
    command: "npm test",
    event: "PostToolUse",
    exitCode: 1,
    error: "1 test failed",
    additionalContext: null,
    blocked: false,
    ts: 1000,
    ms: 42,
    ...over,
  };
}

describe("async-hook-queue pure helpers", () => {
  it("queueEntryKey is stable and distinguishes records", () => {
    expect(queueEntryKey(rec())).toBe(queueEntryKey(rec()));
    expect(queueEntryKey(rec())).not.toBe(queueEntryKey(rec({ ts: 2000 })));
    expect(queueEntryKey(rec())).not.toBe(
      queueEntryKey(rec({ command: "npm run e2e" })),
    );
    expect(queueEntryKey(null)).toBe("");
  });

  it("normalizeRecord drops records with no command and compacts fields", () => {
    expect(normalizeRecord({ command: "  " })).toBe(null);
    expect(normalizeRecord(null)).toBe(null);
    const n = normalizeRecord(rec({ ts: "x", ms: undefined }));
    expect(n.command).toBe("npm test");
    expect(n.ts).toBe(0); // non-finite → 0
    expect(n.ms).toBe(0);
  });

  it("coerceQueue repairs any non-conforming parsed value", () => {
    expect(coerceQueue(null)).toEqual(emptyQueue());
    expect(coerceQueue({})).toEqual(emptyQueue());
    expect(coerceQueue({ sessions: 5 })).toEqual(emptyQueue());
    expect(coerceQueue({ sessions: { s1: { records: [] } } })).toEqual({
      sessions: { s1: { records: [] } },
    });
  });

  it("foldAppend de-dupes by key and stamps updatedAt", () => {
    let q = emptyQueue();
    q = foldAppend(q, "s1", [rec(), rec()], 5000); // same key twice
    expect(q.sessions.s1.records).toHaveLength(1);
    expect(q.sessions.s1.updatedAt).toBe(5000);
    q = foldAppend(q, "s1", rec({ ts: 2000 }), 6000); // distinct
    expect(q.sessions.s1.records).toHaveLength(2);
    expect(q.sessions.s1.updatedAt).toBe(6000);
  });

  it("foldAppend ignores empty session id and invalid records", () => {
    let q = foldAppend(emptyQueue(), "", [rec()], 1);
    expect(Object.keys(q.sessions)).toHaveLength(0);
    q = foldAppend(emptyQueue(), "s1", [{ command: " " }, null], 1);
    expect(q.sessions.s1).toBeUndefined();
  });

  it("foldAppend bounds records to the most recent MAX_RECORDS_PER_SESSION", () => {
    let q = emptyQueue();
    for (let i = 0; i < MAX_RECORDS_PER_SESSION + 25; i++) {
      q = foldAppend(q, "s1", rec({ ts: i }), i);
    }
    expect(q.sessions.s1.records).toHaveLength(MAX_RECORDS_PER_SESSION);
    // oldest (ts 0..24) dropped, newest kept
    expect(q.sessions.s1.records[0].ts).toBe(25);
  });

  it("foldRemove deletes matching keys and prunes emptied buckets", () => {
    let q = foldAppend(emptyQueue(), "s1", [rec(), rec({ ts: 2000 })], 1);
    q = foldRemove(q, "s1", [rec()]);
    expect(q.sessions.s1.records).toHaveLength(1);
    expect(q.sessions.s1.records[0].ts).toBe(2000);
    q = foldRemove(q, "s1", [rec({ ts: 2000 })]);
    expect(q.sessions.s1).toBeUndefined(); // emptied → deleted
  });

  it("foldRemove is a no-op for unknown session / unmatched records", () => {
    let q = foldAppend(emptyQueue(), "s1", [rec()], 1);
    q = foldRemove(q, "nope", [rec()]);
    expect(q.sessions.s1.records).toHaveLength(1);
    q = foldRemove(q, "s1", [rec({ command: "other" })]);
    expect(q.sessions.s1.records).toHaveLength(1);
  });

  it("boundSessions keeps the MAX_SESSIONS most-recently-updated buckets", () => {
    let q = emptyQueue();
    for (let i = 0; i < MAX_SESSIONS + 10; i++) {
      q = foldAppend(q, `s${i}`, rec(), i);
    }
    expect(Object.keys(q.sessions)).toHaveLength(MAX_SESSIONS);
    expect(q.sessions.s0).toBeUndefined(); // oldest dropped
    expect(q.sessions[`s${MAX_SESSIONS + 9}`]).toBeDefined();
    boundSessions(q); // idempotent
    expect(Object.keys(q.sessions)).toHaveLength(MAX_SESSIONS);
  });

  it("foldPruneStale drops buckets older than the stale cutoff", () => {
    let q = emptyQueue();
    q = foldAppend(q, "old", rec(), 1000);
    q = foldAppend(q, "fresh", rec(), 1_000_000_000);
    q = foldPruneStale(q, 1_000_000_000, DEFAULT_STALE_MS);
    expect(q.sessions.old).toBeUndefined();
    expect(q.sessions.fresh).toBeDefined();
  });
});

describe("async-hook-queue IO (injected fs)", () => {
  it("appendRewake → takePending recovers then clears the bucket", () => {
    const fs = memFs();
    expect(
      appendRewake({ sessionId: "s1", records: [rec()], now: 100 }, FILE, fs),
    ).toBe(true);
    // A second, distinct failure for the same session.
    appendRewake(
      {
        sessionId: "s1",
        records: [rec({ ts: 2000, error: "e2e broke" })],
        now: 200,
      },
      FILE,
      fs,
    );
    const recovered = takePending({ sessionId: "s1", now: 300 }, FILE, fs);
    expect(recovered).toHaveLength(2);
    expect(recovered.map((r) => r.error)).toContain("e2e broke");
    // Bucket cleared — a second take returns nothing.
    expect(takePending({ sessionId: "s1", now: 400 }, FILE, fs)).toEqual([]);
  });

  it("removeRewakes marks a consumed rewake so resume won't replay it", () => {
    const fs = memFs();
    appendRewake({ sessionId: "s1", records: [rec()], now: 100 }, FILE, fs);
    expect(removeRewakes({ sessionId: "s1", records: [rec()] }, FILE, fs)).toBe(
      true,
    );
    expect(takePending({ sessionId: "s1", now: 300 }, FILE, fs)).toEqual([]);
  });

  it("takePending isolates sessions and prunes stale buckets on read", () => {
    const fs = memFs();
    appendRewake({ sessionId: "old", records: [rec()], now: 1000 }, FILE, fs);
    appendRewake(
      { sessionId: "s1", records: [rec({ ts: 5 })], now: 2_000_000_000 },
      FILE,
      fs,
    );
    // Taking s1 far in the future prunes the ancient "old" bucket too.
    const recovered = takePending(
      { sessionId: "s1", now: 2_000_000_000 },
      FILE,
      fs,
    );
    expect(recovered).toHaveLength(1);
    expect(loadQueue(FILE, fs).sessions.old).toBeUndefined();
  });

  it("takePending on an absent/empty queue leaves the file untouched (no write)", () => {
    const fs = memFs();
    const writes = [];
    const spyFs = {
      ...fs,
      writeFileSync: (p, d) => {
        writes.push(p);
        fs.writeFileSync(p, d);
      },
    };
    expect(takePending({ sessionId: "s1", now: 1 }, FILE, spyFs)).toEqual([]);
    expect(writes).toHaveLength(0); // pure read, no rewrite
  });

  it("appendRewake/removeRewakes/takePending reject a blank session id", () => {
    const fs = memFs();
    expect(appendRewake({ sessionId: "", records: [rec()] }, FILE, fs)).toBe(
      false,
    );
    expect(removeRewakes({ sessionId: "  ", records: [rec()] }, FILE, fs)).toBe(
      false,
    );
    expect(takePending({ sessionId: "" }, FILE, fs)).toEqual([]);
  });

  it("survives a corrupt queue file (best-effort → empty)", () => {
    const fs = memFs();
    fs.writeFileSync(FILE, "{ not json");
    expect(loadQueue(FILE, fs)).toEqual(emptyQueue());
    // append still works, overwriting the garbage.
    expect(
      appendRewake({ sessionId: "s1", records: [rec()], now: 1 }, FILE, fs),
    ).toBe(true);
    expect(takePending({ sessionId: "s1", now: 2 }, FILE, fs)).toHaveLength(1);
  });
});
