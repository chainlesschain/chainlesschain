/**
 * Integration: `cc hub export-events` / `import-events` helpers against a REAL
 * LocalVault (module 101 §8.3 backup bridge). Exercises the actual
 * queryEvents/putEvent round-trip — no cc subprocess (so it's unaffected by
 * other sessions' uncommitted worktree changes), no shared %APPDATA% (explicit
 * temp vault paths → DB-isolated per cli_subprocess_test_db_isolation).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hub from "@chainlesschain/personal-data-hub";
import { _internal } from "../../src/commands/hub.js";

const { LocalVault, generateKeyHex } = hub;
const { exportAllEvents, importEventsInto } = _internal;

function ev(id, text) {
  const now = Date.now();
  return {
    id,
    type: "event",
    subtype: "message",
    occurredAt: now,
    ingestedAt: now,
    content: { text },
    source: {
      adapter: "test-adapter",
      adapterVersion: "0.1.0",
      capturedAt: now,
      capturedBy: "manual",
    },
  };
}

describe("hub export-events/import-events — real vault round-trip", () => {
  let dir;
  let vaultA;
  let vaultB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-eei-"));
    vaultA = new LocalVault({
      path: path.join(dir, "a.db"),
      key: generateKeyHex(),
    });
    vaultB = new LocalVault({
      path: path.join(dir, "b.db"),
      key: generateKeyHex(),
    });
    vaultA.open();
    vaultB.open();
  });

  afterEach(() => {
    try {
      vaultA.close?.();
      vaultB.close?.();
    } catch {
      /* ignore */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exports all of A and imports losslessly into B", () => {
    vaultA.putEvent(ev("e1", "hello"));
    vaultA.putEvent(ev("e2", "世界 🌍"));
    const exported = exportAllEvents(vaultA);
    expect(exported.length).toBe(2);

    const result = importEventsInto(vaultB, exported);
    expect(result).toMatchObject({ ok: true, imported: 2, failed: 0 });

    const inB = vaultB
      .queryEvents({ limit: 100 })
      .map((e) => e.id)
      .sort();
    expect(inB).toEqual(["e1", "e2"]);
  });

  it("re-import is idempotent (ON CONFLICT(id) upsert, no dup)", () => {
    vaultA.putEvent(ev("e1", "hi"));
    const exported = exportAllEvents(vaultA);
    importEventsInto(vaultB, exported);
    const again = importEventsInto(vaultB, exported);
    expect(again.ok).toBe(true);
    expect(vaultB.queryEvents({ limit: 100 }).length).toBe(1);
  });

  it("paginates beyond one page", () => {
    for (let i = 0; i < 5; i += 1) vaultA.putEvent(ev(`p${i}`, `t${i}`));
    expect(exportAllEvents(vaultA, 2).length).toBe(5); // pageSize 2 → 3 pages
  });
});
