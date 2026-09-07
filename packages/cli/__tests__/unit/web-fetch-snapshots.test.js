import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { WebFetchSnapshots } from "../../src/lib/web-fetch-snapshots.js";

const stores = [];
const create = (options) => {
  const store = new WebFetchSnapshots(options);
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

describe("downloaded webpage snapshots", () => {
  it("reads every chunk from disk without omissions, repeats, or broken Unicode", () => {
    const store = create();
    const content = "第一页🙂\n".repeat(1000) + "尾页";
    const id = store.save(
      { content, url: "https://example.com/" },
      "identity",
      null,
    );
    expect(fs.statSync(store.entries.get(id).file).size).toBe(
      content.length * 2,
    );
    let offset = 0;
    let reconstructed = "";
    for (let n = 0; n < 2000; n++) {
      const page = store.read(id, "identity", null, offset, 7);
      reconstructed += page.content;
      expect(page.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      expect(page.totalChars).toBe(content.length);
      if (!page.hasMore) {
        expect(page.nextOffset).toBeNull();
        expect(page.truncated).toBe(false);
        break;
      }
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
    }
    expect(reconstructed).toBe(content);
  });

  it("does not cross host/URL boundaries or interpret IDs as file paths", () => {
    const store = create();
    const owner = {};
    const id = store.save({ content: "private response" }, "url-one", owner);
    expect(store.read(id, "url-one", {}, 0, 10).code).toBe(
      "ERR_FETCH_SNAPSHOT_MISSING",
    );
    expect(store.read(id, "url-two", owner, 0, 10).code).toBe(
      "ERR_FETCH_SNAPSHOT_MISSING",
    );
    expect(store.read("../../secret", "url-one", owner, 0, 10).code).toBe(
      "ERR_FETCH_SNAPSHOT_MISSING",
    );
  });

  it("bounds disk use, evicts old files, expires snapshots and cleans its directory", () => {
    let now = 0;
    const store = create({
      maxBytes: 12,
      maxEntries: 2,
      ttlMs: 100,
      now: () => now,
    });
    const first = store.save({ content: "aaaa" }, "url", null);
    const file = store.entries.get(first).file;
    store.save({ content: "bbbb" }, "url", null);
    expect(fs.existsSync(file)).toBe(false);
    expect(store.bytes).toBe(8);
    expect(store.read(first, "url", null, 0, 3).code).toBe(
      "ERR_FETCH_SNAPSHOT_MISSING",
    );
    now = 101;
    store.expire();
    expect(store.bytes).toBe(0);
    expect(store.entries.size).toBe(0);
    const dir = store.dir;
    store.dispose();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("handles EOF, invalid offsets, and downloads known to be incomplete", () => {
    const store = create();
    const id = store.save(
      { content: "abc", downloadTruncated: true, hint: "Increase maxBytes" },
      "url",
      null,
    );
    expect(store.read(id, "url", null, 2, 10)).toMatchObject({
      content: "c",
      hasMore: false,
      nextOffset: null,
      truncated: true,
      downloadTruncated: true,
      hint: "Increase maxBytes",
    });
    expect(store.read(id, "url", null, 3, 10).content).toBe("");
    expect(store.read(id, "url", null, 4, 10).code).toBe("ERR_FETCH_OFFSET");
  });
});
