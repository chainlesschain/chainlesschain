/**
 * Unit tests for the §8.3 backup event export/import helpers
 * (`cc hub export-events` / `import-events`). We test the pure helpers
 * (exportAllEvents / importEventsInto) against a fake vault — they're the
 * logic; the cmd wrappers are thin getHub + jsonAndExit glue. Real-vault
 * round-trip is covered by the pdh vault suite (queryEvents/putEvent).
 */

import { describe, it, expect } from "vitest";
import { _internal } from "../../src/commands/hub.js";

const { exportAllEvents, importEventsInto } = _internal;

/** Fake vault: queryEvents paginates a fixed array; putEvent records (throws on ev.bad). */
function fakeVault(events = []) {
  return {
    queryEvents: ({ limit, offset }) => events.slice(offset, offset + limit),
    imported: [],
    putEvent(ev) {
      if (ev && ev.bad) throw new Error(`invalid event ${ev.id}`);
      this.imported.push(ev);
    },
  };
}

describe("exportAllEvents", () => {
  it("pages through every event (beyond a single page)", () => {
    const events = [1, 2, 3, 4, 5].map((n) => ({ id: `e${n}` }));
    const out = exportAllEvents(fakeVault(events), 2); // pageSize 2 → 3 pages
    expect(out.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("returns [] for an empty vault", () => {
    expect(exportAllEvents(fakeVault([]), 2)).toEqual([]);
  });

  it("terminates on an exact page-size multiple", () => {
    const events = [1, 2, 3, 4].map((n) => ({ id: `e${n}` })); // 4 = 2*2
    expect(exportAllEvents(fakeVault(events), 2).length).toBe(4);
  });
});

describe("importEventsInto", () => {
  it("imports all valid events and reports ok", () => {
    const vault = fakeVault();
    const r = importEventsInto(vault, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(r).toMatchObject({ ok: true, imported: 3, failed: 0 });
    expect(vault.imported.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("counts failures without aborting the batch", () => {
    const vault = fakeVault();
    const r = importEventsInto(vault, [
      { id: "a" },
      { id: "x", bad: true }, // putEvent throws
      { id: "b" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.imported).toBe(2); // a + b still imported
    expect(r.failed).toBe(1);
    expect(r.errors[0].id).toBe("x");
    expect(vault.imported.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("handles an empty import as a no-op ok", () => {
    expect(importEventsInto(fakeVault(), [])).toMatchObject({
      ok: true,
      imported: 0,
      failed: 0,
    });
  });
});
