/**
 * YjsCollabManager._loadDocument — corrupt-update resilience.
 *
 * Stored Yjs updates are replayed in order to rebuild a document. A single
 * corrupt/truncated update_data row must not throw out of the replay loop and
 * silently drop every LATER update (truncating the doc to a stale state); the
 * bad update should be skipped and the rest applied.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Y = require("yjs");
const YjsCollabManager = require("../yjs-collab-manager");

/** Mock database whose update query returns the given rows. */
function mockDb(rows) {
  const db = { prepare: () => ({ all: () => rows }) };
  return { getDatabase: () => db };
}

describe("YjsCollabManager._loadDocument corrupt-update resilience", () => {
  it("skips a corrupt update and still applies the valid ones after it", async () => {
    // u1 sets a=1; u2 is the full state with a=1 AND b=2 (applied AFTER corrupt).
    const src1 = new Y.Doc();
    src1.getMap("m").set("a", 1);
    const u1 = Y.encodeStateAsUpdate(src1);
    const src2 = new Y.Doc();
    Y.applyUpdate(src2, u1);
    src2.getMap("m").set("b", 2);
    const u2 = Y.encodeStateAsUpdate(src2);

    const corrupt = new Uint8Array([255, 255, 255, 200, 13, 99, 1, 2]);

    const mgr = new YjsCollabManager(
      null,
      mockDb([
        { update_data: u1 },
        { update_data: corrupt },
        { update_data: u2 },
      ]),
    );
    const ydoc = new Y.Doc();
    await mgr._loadDocument("doc-1", ydoc);

    // Before the fix the corrupt update threw, aborting the loop → u2 never
    // applied → b was lost. Now the corrupt one is skipped and u2 applies.
    expect(ydoc.getMap("m").get("a")).toBe(1);
    expect(ydoc.getMap("m").get("b")).toBe(2);
  });

  it("loads cleanly when there are no corrupt updates", async () => {
    const src = new Y.Doc();
    src.getMap("m").set("k", "v");
    const u = Y.encodeStateAsUpdate(src);
    const mgr = new YjsCollabManager(null, mockDb([{ update_data: u }]));
    const ydoc = new Y.Doc();
    await mgr._loadDocument("doc-2", ydoc);
    expect(ydoc.getMap("m").get("k")).toBe("v");
  });
});
