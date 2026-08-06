import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const testHome = join(tmpdir(), `cc-sidx-${Date.now()}`);
vi.mock("../../src/lib/paths.js", () => ({ getHomeDir: () => testHome }));

const {
  openIndex,
  syncIndex,
  listSessions,
  searchSessions,
  getIndexedSession,
  indexStats,
  _deps: sessionIndexDeps,
} = await import("../../src/harness/session-index.js");
const { createMirror, createFsMirror, createHttpMirror } =
  await import("../../src/harness/session-mirror.js");
const { computeEventHash } =
  await import("../../src/harness/transcript-integrity.js");

class TestDatabase extends DatabaseSync {
  pragma(statement) {
    this.exec(`PRAGMA ${statement}`);
  }

  transaction(task) {
    return (...args) => {
      this.exec("BEGIN");
      try {
        const result = task(...args);
        this.exec("COMMIT");
        return result;
      } catch (error) {
        this.exec("ROLLBACK");
        throw error;
      }
    };
  }
}

sessionIndexDeps.Database = TestDatabase;

let sessionsDir;
beforeEach(() => {
  mkdirSync(testHome, { recursive: true });
  sessionsDir = join(testHome, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
});
afterEach(() => rmSync(testHome, { recursive: true, force: true }));

/** Write one fully chained and physically anchored JSONL session. */
function writeSession(id, { title = "T", ts = 1000, msgs = [] } = {}) {
  const events = [];
  let previousHash = null;
  const add = (core) => {
    const hash = computeEventHash(previousHash, core);
    events.push({ ...core, prevHash: previousHash, hash });
    previousHash = hash;
  };
  add({
    type: "session_start",
    timestamp: ts,
    data: { title, provider: "anthropic", model: "m" },
  });
  let t = ts;
  for (const m of msgs) {
    t += 10;
    add({
      type: m.role === "assistant" ? "assistant_message" : "user_message",
      timestamp: t,
      data: { role: m.role, content: m.content },
    });
  }
  const transcript = join(sessionsDir, `${id}.jsonl`);
  writeFileSync(
    transcript,
    `${events.map(JSON.stringify).join("\n")}\n`,
    "utf-8",
  );
  const physical = statSync(transcript);
  writeFileSync(
    join(sessionsDir, `${id}.meta.json`),
    `${JSON.stringify({
      schema: 2,
      id,
      title,
      provider: "anthropic",
      model: "m",
      message_count: msgs.length,
      event_count: events.length,
      created_at_ms: ts,
      updated_at_ms: t,
      last_hash: previousHash,
      transcript: {
        dev: String(physical.dev),
        ino: String(physical.ino),
        size: physical.size,
        mtimeMs: physical.mtimeMs,
        ctimeMs: physical.ctimeMs,
      },
      deleted: false,
    })}\n`,
    "utf8",
  );
}

function appendSessionRecord(id, core) {
  const transcript = join(sessionsDir, `${id}.jsonl`);
  const metaPath = join(sessionsDir, `${id}.meta.json`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const hash = computeEventHash(meta.last_hash, core);
  appendFileSync(
    transcript,
    `${JSON.stringify({ ...core, prevHash: meta.last_hash, hash })}\n`,
    "utf8",
  );
  const physical = statSync(transcript);
  writeFileSync(
    metaPath,
    `${JSON.stringify({
      ...meta,
      title:
        core.type === "session_rename" && core.data?.title
          ? core.data.title
          : meta.title,
      event_count: meta.event_count + 1,
      updated_at_ms: core.timestamp,
      last_hash: hash,
      transcript: {
        dev: String(physical.dev),
        ino: String(physical.ino),
        size: physical.size,
        mtimeMs: physical.mtimeMs,
        ctimeMs: physical.ctimeMs,
      },
    })}\n`,
    "utf8",
  );
}

describe("session-index sync + list", () => {
  it("indexes sessions and lists them newest-first", () => {
    writeSession("session-a", {
      title: "Alpha",
      ts: 1000,
      msgs: [{ role: "user", content: "hello world" }],
    });
    writeSession("session-b", {
      title: "Beta",
      ts: 5000,
      msgs: [{ role: "assistant", content: "reply" }],
    });
    const db = openIndex({ file: ":memory:" });
    const res = syncIndex(db);
    expect(res.scanned).toBe(2);
    expect(res.updated).toBe(2);
    expect(res.total).toBe(2);

    const list = listSessions(db, { limit: 10 });
    expect(list.map((s) => s.id)).toEqual(["session-b", "session-a"]); // b is newer
    expect(list[0]).toMatchObject({ title: "Beta", provider: "anthropic" });
    db.close();
  });

  it("is incremental — an unchanged file is not re-indexed", () => {
    writeSession("session-a", { title: "Alpha" });
    const db = openIndex({ file: ":memory:" });
    expect(syncIndex(db).updated).toBe(1);
    // second sync: nothing changed on disk
    const second = syncIndex(db);
    expect(second.scanned).toBe(1);
    expect(second.updated).toBe(0);
    db.close();
  });

  it("removes index rows when the JSONL is deleted", () => {
    writeSession("session-a", { title: "Alpha" });
    writeSession("session-b", { title: "Beta" });
    const db = openIndex({ file: ":memory:" });
    syncIndex(db);
    rmSync(join(sessionsDir, "session-a.jsonl"));
    const res = syncIndex(db);
    expect(res.removed).toBe(1);
    expect(res.total).toBe(1);
    expect(getIndexedSession(db, "session-a")).toBeNull();
    db.close();
  });

  it("removes a cached row when the canonical transcript no longer verifies", () => {
    writeSession("session-a", {
      msgs: [{ role: "user", content: "trusted content" }],
    });
    const db = openIndex({ file: ":memory:" });
    expect(syncIndex(db)).toMatchObject({ updated: 1, rejected: 0, total: 1 });
    const transcript = join(sessionsDir, "session-a.jsonl");
    writeFileSync(
      transcript,
      readFileSync(transcript, "utf8").replace("trusted", "altered"),
      "utf8",
    );

    expect(syncIndex(db)).toMatchObject({ rejected: 1, total: 0 });
    expect(getIndexedSession(db, "session-a")).toBeNull();
    expect(searchSessions(db, "trusted")).toEqual([]);
    db.close();
  });

  it("stats aggregate messages and events", () => {
    writeSession("session-a", {
      msgs: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    const db = openIndex({ file: ":memory:" });
    syncIndex(db);
    const st = indexStats(db);
    expect(st.sessions).toBe(1);
    expect(st.messages).toBe(2);
    expect(st.events).toBe(3); // start + 2 messages
    db.close();
  });

  it("streams the transcript and indexes the latest append-only rename", () => {
    writeSession("session-a", {
      title: "Original",
      msgs: [{ role: "user", content: "needle" }],
    });
    appendSessionRecord("session-a", {
      type: "session_rename",
      timestamp: 9_000,
      data: { title: "Renamed" },
    });
    const db = openIndex({ file: ":memory:" });
    syncIndex(db);
    expect(getIndexedSession(db, "session-a")).toMatchObject({
      title: "Renamed",
      event_count: 3,
      last_ts: 9_000,
    });
    db.close();
  });
});

describe("session-index search", () => {
  it("finds sessions by content and title with a snippet", () => {
    writeSession("session-a", {
      title: "refactor auth",
      msgs: [{ role: "user", content: "please fix the login timeout bug" }],
    });
    writeSession("session-b", {
      title: "unrelated",
      msgs: [{ role: "user", content: "make a sandwich" }],
    });
    const db = openIndex({ file: ":memory:" });
    syncIndex(db);

    const byContent = searchSessions(db, "timeout bug");
    expect(byContent.map((r) => r.id)).toEqual(["session-a"]);
    expect(byContent[0].snippet).toMatch(/timeout bug/);

    const byTitle = searchSessions(db, "refactor");
    expect(byTitle.map((r) => r.id)).toEqual(["session-a"]);

    expect(searchSessions(db, "")).toEqual([]);
    expect(searchSessions(db, "nomatchxyz")).toEqual([]);
    db.close();
  });

  it("escapes LIKE wildcards so a literal % does not match everything", () => {
    writeSession("session-a", {
      msgs: [{ role: "user", content: "100% sure" }],
    });
    writeSession("session-b", { msgs: [{ role: "user", content: "nothing" }] });
    const db = openIndex({ file: ":memory:" });
    syncIndex(db);
    // "%" is escaped → only the session literally containing "%" matches
    expect(searchSessions(db, "100%").map((r) => r.id)).toEqual(["session-a"]);
    db.close();
  });
});

describe("session-mirror fs driver", () => {
  it("push/pull/list round-trips through a directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-mirror-"));
    try {
      const m = createFsMirror({ dir });
      expect(m.kind).toBe("fs");
      await m.push("session-x", '{"type":"session_start"}\n');
      expect(await m.list()).toEqual(["session-x"]);
      expect(await m.pull("session-x")).toContain("session_start");
      expect(await m.pull("missing")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unsafe session id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-mirror-"));
    try {
      const m = createFsMirror({ dir });
      await expect(m.push("../evil", "x")).rejects.toThrow(/unsafe/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("session-mirror factory + http driver", () => {
  it("returns null when no mirror is configured", () => {
    expect(createMirror({})).toBeNull();
    expect(createMirror({ kind: "none" })).toBeNull();
  });

  it("throws on an unknown kind", () => {
    expect(() => createMirror({ kind: "ftp" })).toThrow(
      /unknown session mirror/,
    );
  });

  it("http driver PUTs/GETs with the bearer token", async () => {
    const calls = [];
    const fetch = vi.fn(async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method || "GET",
        auth: init?.headers?.Authorization,
      });
      if (init?.method === "PUT") return { ok: true, status: 200 };
      if (String(url).endsWith("/sessions"))
        return { ok: true, status: 200, json: async () => ["s1", "s2"] };
      return { ok: true, status: 200, text: async () => "line\n" };
    });
    const m = createHttpMirror(
      { baseUrl: "https://mirror.local/", token: "tok" },
      { fetch },
    );
    await m.push("s1", "bytes");
    expect(await m.list()).toEqual(["s1", "s2"]);
    expect(await m.pull("s1")).toBe("line\n");
    expect(calls[0]).toMatchObject({ method: "PUT", auth: "Bearer tok" });
  });

  it("http pull returns null on 404", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    const m = createHttpMirror({ baseUrl: "https://mirror.local" }, { fetch });
    expect(await m.pull("s1")).toBeNull();
  });
});
