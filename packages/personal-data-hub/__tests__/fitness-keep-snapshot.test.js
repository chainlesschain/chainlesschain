"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  KeepAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  mapWorkout,
  extractList,
  typeLabel,
} = require("../lib/adapters/fitness-keep");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// Keep (健身) — mirrors fitness-joyrun but multi-type (workoutType). best-effort
// scaffold; signing injected. pure-Node.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "fitness-keep.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("KeepAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keep-snap-"));
  });

  it("exports schema constants", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["workout"]);
  });

  it("authenticate(inputPath) ok; authenticate() no input → NO_INPUT", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: Date.now(), events: [] });
    const a = new KeepAdapter();
    expect((await a.authenticate({ inputPath: p })).ok).toBe(true);
    const r = await a.authenticate({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_INPUT");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 9, snapshottedAt: Date.now(), events: [] });
    const a = new KeepAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("running workout → OTHER event '运动: 跑步 X km' + GPS-bearing extra", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      account: { userId: "u1" },
      events: [
        { kind: "workout", id: "w1", workoutId: "9001", type: "running", name: "晨跑",
          time: 1700000000, distanceMeters: 5230, durationSec: 1800, calories: 320, steps: 6400 },
      ],
    });
    const a = new KeepAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].originalId).toBe("keep:workout:9001");
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("other");
    expect(batch.events[0].content.title).toBe("运动: 跑步 5.23 km");
    expect(batch.events[0].extra.workoutType).toBe("running");
    expect(batch.events[0].extra.calories).toBe(320);
  });

  it("non-distance workout (yoga) → '运动: 瑜伽 N 分钟'", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [
        { kind: "workout", id: "w2", workoutId: "9002", type: "yoga", name: "晚间瑜伽",
          time: now, durationSec: 1500, calories: 120 },
      ],
    });
    const a = new KeepAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].content.title).toBe("运动: 瑜伽 25 分钟");
  });

  it("unknown type falls back to raw token; no metrics → bare '运动: <type>'", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1, snapshottedAt: now,
      events: [{ kind: "workout", id: "w3", workoutId: "9003", type: "parkour", time: now }],
    });
    const a = new KeepAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(batch.events[0].content.title).toBe("运动: parkour");
  });

  it("respects include opt-out + limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 4 }, (_, i) => ({
      kind: "workout", id: `w${i}`, workoutId: String(100 + i), type: "running",
      time: now - i * 1000, distanceMeters: 3000,
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new KeepAdapter();
    let raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
    raws = [];
    for await (const r of a.sync({ inputPath: p, include: { workout: false } })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("advertises capabilities + passes assertAdapter", () => {
    const a = new KeepAdapter();
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).not.toContain("sync:cookie-api");
    expect(a.capabilities).not.toContain("sync:custom-cookie-api");
    expect(assertAdapter(a).ok).toBe(true);
  });
});

describe("KeepAdapter cookie-api mode", () => {
  it("rejects cookie mode until a captured endpoint and fetcher are provided", async () => {
    const a = new KeepAdapter({ account: { cookies: "token=ok" } });
    const res = await a.authenticate();
    expect(res).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
  });

  it("fetches workouts via fetchFn and normalizes (km vs meters heuristic)", async () => {
    const fetchFn = async () => ({
      data: {
        records: [
          { workoutId: 555, type: "cycling", name: "骑行", doneDate: 1700000000, distance: 12.5, duration: 2400, kcal: 410 },
        ],
      },
    });
    const a = new KeepAdapter({ account: { userId: "u1", cookies: "token=ok" }, fetchFn, listUrl: "https://captured.example/workouts" });
    const raws = [];
    for await (const r of a.sync({})) raws.push(r);
    expect(raws.length).toBe(1);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    // distance 12.5 (looks like km, no meter field) → 12500 m → 12.50 km
    expect(batch.events[0].content.title).toBe("运动: 骑行 12.50 km");
    expect(batch.events[0].extra.calories).toBe(410);
  });

  it("invokes signProvider, passes sign to fetchFn", async () => {
    let seen = null;
    const signProvider = async () => "SIG";
    const fetchFn = async (opts) => {
      seen = opts.sign;
      return { list: [] };
    };
    const a = new KeepAdapter({ account: { cookies: "x=1" }, fetchFn, signProvider, listUrl: "https://captured.example/workouts" });
    for await (const _r of a.sync({})) { /* drain */ }
    expect(seen).toBe("SIG");
  });

  it("paginates until short page", async () => {
    const all = Array.from({ length: 45 }, (_, i) => ({ workoutId: i + 1, type: "running", time: 1700000000, distanceMeters: 3000 }));
    const seenPages = [];
    const fetchFn = async (opts) => {
      const page = opts.query.page;
      seenPages.push(page);
      return { list: all.slice((page - 1) * 30, page * 30) };
    };
    const a = new KeepAdapter({ account: { cookies: "x=1" }, fetchFn, listUrl: "https://captured.example/workouts" });
    const raws = [];
    for await (const r of a.sync({})) raws.push(r);
    expect(raws.length).toBe(45);
    expect(seenPages).toEqual([1, 2]);
  });

  it("mapWorkout / extractList / typeLabel helpers", () => {
    expect(mapWorkout({ workoutId: 7, type: "running", distanceMeters: 5000 }).distanceMeters).toBe(5000);
    expect(mapWorkout({})).toBe(null);
    expect(extractList({ data: { logs: [1] } })).toEqual([1]);
    expect(extractList(null)).toEqual([]);
    expect(typeLabel("yoga")).toBe("瑜伽");
    expect(typeLabel("xyz")).toBe("xyz");
    expect(typeLabel(null)).toBe("运动");
  });

  it("uses opts.listUrl override", async () => {
    let seenUrl = null;
    const fetchFn = async (opts) => {
      seenUrl = opts.url;
      return { list: [] };
    };
    const a = new KeepAdapter({ account: { cookies: "x=1" }, fetchFn, listUrl: "https://x/w" });
    for await (const _r of a.sync({})) { /* drain */ }
    expect(seenUrl).toBe("https://x/w");
  });

  it("missing explicit endpoint/fetcher throws a legible error", async () => {
    const a = new KeepAdapter({ account: { cookies: "x=1" } });
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(String(threw.message)).toMatch(/explicit listUrl/);
  });
});
