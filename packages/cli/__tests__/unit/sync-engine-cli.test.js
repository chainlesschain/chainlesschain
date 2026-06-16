import { describe, it, expect } from "vitest";
import {
  generateFilename,
  generateMarkdown,
  cursorAfterItem,
  getCursor,
  ensureCursor,
  updateCursor,
  recordPushedItem,
  removeFromMaps,
  listTombstones,
  deleteTombstone,
  markTombstoneFailed,
  fetchBatch,
  countPending,
} from "../../src/lib/sync-engine-cli.js";

/**
 * A fake better-sqlite3-style dbManager. `get` consumes from a queue (push
 * the rows each call should return, in order); `all` returns a preset list.
 * Every call is recorded on `.calls` for assertions.
 */
function fakeDb() {
  const getQueue = [];
  let allReturn = [];
  const calls = { get: [], run: [], all: [] };
  return {
    calls,
    _pushGet(...rows) {
      getQueue.push(...rows);
      return this;
    },
    _setAll(rows) {
      allReturn = rows;
      return this;
    },
    get(sql, params) {
      calls.get.push({ sql, params });
      return getQueue.length ? getQueue.shift() : undefined;
    },
    run(sql, params) {
      calls.run.push({ sql, params });
      return { changes: 1 };
    },
    all(sql, params) {
      calls.all.push({ sql, params });
      return allReturn;
    },
  };
}

describe("sync-engine-cli — generateFilename", () => {
  it("builds <id>-<cleanTitle>.md", () => {
    expect(generateFilename({ id: "k1", title: "Hello World" })).toBe(
      "k1-Hello_World.md",
    );
  });

  it("replaces filesystem-unsafe chars and dashes with underscores", () => {
    expect(generateFilename({ id: "k1", title: 'a/b:c*d?e"f<g>h|i-j' })).toBe(
      "k1-a_b_c_d_e_f_g_h_i_j.md",
    );
  });

  it("collapses runs of underscores and trims leading/trailing ones", () => {
    expect(generateFilename({ id: "k1", title: "  --x--  " })).toBe("k1-x.md");
  });

  it("falls back to untitled for empty or all-unsafe titles", () => {
    expect(generateFilename({ id: "k1", title: "" })).toBe("k1-untitled.md");
    expect(generateFilename({ id: "k1", title: "***" })).toBe("k1-untitled.md");
  });

  it("truncates the title to 80 chars", () => {
    const long = "a".repeat(200);
    const name = generateFilename({ id: "k1", title: long });
    expect(name).toBe(`k1-${"a".repeat(80)}.md`);
  });
});

describe("sync-engine-cli — generateMarkdown", () => {
  const item = {
    id: "k1",
    title: "My Note",
    type: "article",
    content: "body text",
    tags: "a,b",
    created_at: 100,
    updated_at: 200,
  };

  it("emits front matter with all fields and the content + trailing newline", () => {
    const md = generateMarkdown(item);
    // Closing `---` is on its own line, then the body (regression guard:
    // the front-matter fence must not be glued onto the content).
    expect(md).toBe(
      [
        "---",
        "id: k1",
        'title: "My Note"',
        "type: article",
        "created_at: 100",
        "updated_at: 200",
        "tags: a,b",
        "---",
        "body text",
        "",
      ].join("\n"),
    );
  });

  it("omits the tags line when there are no tags", () => {
    const md = generateMarkdown({ ...item, tags: "" });
    expect(md).not.toMatch(/^tags:/m);
  });

  it("defaults type to note and title to untitled", () => {
    const md = generateMarkdown({ id: "k1", created_at: 1, updated_at: 2 });
    expect(md).toMatch(/^type: note$/m);
    expect(md).toMatch(/^title: "untitled"$/m);
  });

  it("JSON-encodes the title (quotes embedded specials)", () => {
    const md = generateMarkdown({ ...item, title: 'He said "hi"' });
    expect(md).toMatch(/^title: "He said \\"hi\\""$/m);
  });

  it("handles missing content as an empty body", () => {
    const md = generateMarkdown({ id: "k1", created_at: 1, updated_at: 2 });
    expect(md.endsWith("---\n\n")).toBe(true);
  });

  it("never glues the closing fence onto the body (front-matter stays valid)", () => {
    const md = generateMarkdown({
      id: "k1",
      title: "t",
      content: "hello",
      created_at: 1,
      updated_at: 2,
    });
    expect(md).not.toMatch(/---hello/);
    expect(md).toMatch(/\n---\nhello/);
  });
});

describe("sync-engine-cli — cursorAfterItem", () => {
  it("captures updated_at and id", () => {
    expect(cursorAfterItem({ id: "k9", updated_at: 555 })).toEqual({
      lastSyncAt: 555,
      lastItemId: "k9",
    });
  });
});

describe("sync-engine-cli — getCursor", () => {
  it("returns undefined when there is no row", () => {
    expect(getCursor(fakeDb(), "webdav")).toBeUndefined();
  });

  it("maps snake_case columns and parses JSON map fields", () => {
    const db = fakeDb()._pushGet({
      provider_id: "webdav",
      account_key: "acct",
      last_sync_at: 10,
      last_item_id: "k5",
      remote_etag_map: '{"k5":"e5"}',
      remote_filename_map: '{"k5":"k5-x.md"}',
      last_run_status: "ok",
      items_pushed: 3,
    });
    const c = getCursor(db, "webdav", "acct");
    expect(c).toMatchObject({
      providerId: "webdav",
      accountKey: "acct",
      lastSyncAt: 10,
      lastItemId: "k5",
      remoteEtagMap: { k5: "e5" },
      remoteFilenameMap: { k5: "k5-x.md" },
      lastRunStatus: "ok",
      itemsPushed: 3,
    });
  });

  it("falls back to {} for null/invalid JSON maps", () => {
    const db = fakeDb()._pushGet({
      provider_id: "oss",
      remote_etag_map: null,
      remote_filename_map: "not json",
    });
    const c = getCursor(db, "oss");
    expect(c.remoteEtagMap).toEqual({});
    expect(c.remoteFilenameMap).toEqual({});
  });
});

describe("sync-engine-cli — ensureCursor", () => {
  it("returns the existing cursor without inserting", () => {
    const db = fakeDb()._pushGet({ provider_id: "webdav" });
    const c = ensureCursor(db, "webdav");
    expect(c.providerId).toBe("webdav");
    expect(db.calls.run).toHaveLength(0);
  });

  it("inserts then re-reads when absent", () => {
    const db = fakeDb()._pushGet(undefined, { provider_id: "webdav" });
    const c = ensureCursor(db, "webdav", "acct");
    expect(db.calls.run).toHaveLength(1);
    expect(db.calls.run[0].sql).toMatch(/INSERT OR IGNORE/);
    expect(db.calls.run[0].params).toEqual(["webdav", "acct"]);
    expect(c.providerId).toBe("webdav");
  });
});

describe("sync-engine-cli — updateCursor", () => {
  it("is a no-op for a null or non-object patch", () => {
    const db = fakeDb();
    updateCursor(db, "webdav", null);
    updateCursor(db, "webdav", "nope");
    expect(db.calls.run).toHaveLength(0);
  });

  it("maps only the patched fields and always sets updated_at", () => {
    const db = fakeDb();
    updateCursor(
      db,
      "webdav",
      { lastRunStatus: "ok", itemsPushed: 5, remoteEtagMap: { a: 1 } },
      "acct",
    );
    const { sql, params } = db.calls.run[0];
    expect(sql).toContain("last_run_status = ?");
    expect(sql).toContain("items_pushed = ?");
    expect(sql).toContain("remote_etag_map = ?");
    expect(sql).toContain("updated_at = ?");
    expect(sql).not.toContain("items_skipped");
    // params: [status, pushed, etagJson, updated_at, providerId, accountKey]
    expect(params[0]).toBe("ok");
    expect(params[1]).toBe(5);
    expect(params[2]).toBe('{"a":1}');
    expect(typeof params[3]).toBe("number");
    expect(params.slice(-2)).toEqual(["webdav", "acct"]);
  });
});

describe("sync-engine-cli — recordPushedItem", () => {
  it("merges the item into existing remote maps", () => {
    const db = fakeDb()._pushGet({
      provider_id: "webdav",
      remote_etag_map: '{"old":"e0"}',
      remote_filename_map: '{"old":"old.md"}',
    });
    recordPushedItem(db, "webdav", "new", "e9", "new.md");
    const { params } = db.calls.run[0];
    expect(JSON.parse(params[0])).toEqual({ old: "e0", new: "e9" });
    expect(JSON.parse(params[1])).toEqual({ old: "old.md", new: "new.md" });
  });

  it("starts from empty maps when there is no cursor", () => {
    const db = fakeDb(); // get returns undefined
    recordPushedItem(db, "webdav", "k1", "e1", "k1.md");
    const { params } = db.calls.run[0];
    expect(JSON.parse(params[0])).toEqual({ k1: "e1" });
    expect(JSON.parse(params[1])).toEqual({ k1: "k1.md" });
  });
});

describe("sync-engine-cli — removeFromMaps", () => {
  it("does nothing when there is no cursor", () => {
    const db = fakeDb();
    removeFromMaps(db, "webdav", "k1");
    expect(db.calls.run).toHaveLength(0);
  });

  it("deletes the item from both maps", () => {
    const db = fakeDb()._pushGet({
      provider_id: "webdav",
      remote_etag_map: '{"k1":"e1","k2":"e2"}',
      remote_filename_map: '{"k1":"k1.md","k2":"k2.md"}',
    });
    removeFromMaps(db, "webdav", "k1");
    const { params } = db.calls.run[0];
    expect(JSON.parse(params[0])).toEqual({ k2: "e2" });
    expect(JSON.parse(params[1])).toEqual({ k2: "k2.md" });
  });
});

describe("sync-engine-cli — tombstones", () => {
  it("listTombstones filters by provider/account and applies the limit", () => {
    const db = fakeDb()._setAll([{ id: 1 }]);
    const rows = listTombstones(db, "webdav", "acct", 50);
    expect(rows).toEqual([{ id: 1 }]);
    expect(db.calls.all[0].params).toEqual(["webdav", "acct", 50]);
    expect(db.calls.all[0].sql).toMatch(/resource_type = 'KNOWLEDGE_ITEM'/);
  });

  it("deleteTombstone targets the id", () => {
    const db = fakeDb();
    deleteTombstone(db, 42);
    expect(db.calls.run[0].sql).toMatch(/DELETE FROM sync_external_tombstones/);
    expect(db.calls.run[0].params).toEqual([42]);
  });

  it("markTombstoneFailed bumps retry_count and truncates the error to 500 chars", () => {
    const db = fakeDb();
    markTombstoneFailed(db, 7, "x".repeat(900));
    const { sql, params } = db.calls.run[0];
    expect(sql).toMatch(/retry_count = retry_count \+ 1/);
    expect(params[0]).toHaveLength(500);
    expect(params[1]).toBe(7);
  });
});

describe("sync-engine-cli — fetchBatch / countPending", () => {
  it("fetchBatch uses cursor defaults (0 / '' / 200)", () => {
    const db = fakeDb()._setAll([{ id: "k1" }]);
    fetchBatch(db, undefined);
    expect(db.calls.all[0].params).toEqual([0, 0, "", 200]);
  });

  it("fetchBatch threads the cursor and batch size", () => {
    const db = fakeDb()._setAll([]);
    fetchBatch(db, { lastSyncAt: 12, lastItemId: "k3" }, 50);
    expect(db.calls.all[0].params).toEqual([12, 12, "k3", 50]);
  });

  it("countPending returns the COUNT value", () => {
    const db = fakeDb()._pushGet({ c: 7 });
    expect(countPending(db, { lastSyncAt: 5, lastItemId: "k2" })).toBe(7);
    expect(db.calls.get[0].params).toEqual([5, 5, "k2"]);
  });

  it("countPending returns 0 when no row", () => {
    expect(countPending(fakeDb(), null)).toBe(0);
  });
});
