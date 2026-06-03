"use strict";

import { describe, it, expect } from "vitest";

const { MockAdapter } = require("../lib/mock-adapter");
const { validate } = require("../lib/schemas");
const { assertAdapter } = require("../lib/adapter-spec");

describe("MockAdapter", () => {
  it("satisfies the PersonalDataAdapter contract", () => {
    expect(assertAdapter(new MockAdapter()).ok).toBe(true);
  });

  it("yields exactly `count` raw events", async () => {
    const a = new MockAdapter({ count: 7 });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws.length).toBe(7);
    expect(raws[0].adapter).toBe("mock");
    expect(raws[0].originalId).toMatch(/^mock-raw-/);
    expect(raws[0].capturedAt).toBeGreaterThan(1_000_000_000_000);
  });

  it("respects sinceWatermark by skipping seen items", async () => {
    const a = new MockAdapter({ count: 10 });
    const skipped = [];
    for await (const r of a.sync({ sinceWatermark: 4 })) skipped.push(r);
    expect(skipped.length).toBe(6); // 10 - 4
    expect(skipped[0].payload.index).toBe(4);
  });

  it("respects maxEvents", async () => {
    const a = new MockAdapter({ count: 50 });
    const got = [];
    for await (const r of a.sync({ maxEvents: 5 })) got.push(r);
    expect(got.length).toBe(5);
  });

  it("normalize produces valid UnifiedSchema entities (v0, v1, v2 variants)", async () => {
    const a = new MockAdapter({ count: 6, seed: 42 });
    for await (const r of a.sync()) {
      const batch = a.normalize(r);
      expect(batch.events.length).toBeGreaterThanOrEqual(1);
      for (const e of batch.events) expect(validate(e).valid).toBe(true);
      for (const p of batch.persons) expect(validate(p).valid).toBe(true);
    }
  });

  it("healthCheck honors shouldFailHealth flag", async () => {
    const a = new MockAdapter();
    expect((await a.healthCheck()).ok).toBe(true);
    a.shouldFailHealth = true;
    const r = await a.healthCheck();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unhealthy");
  });

  it("failAfter throws mid-sync", async () => {
    const a = new MockAdapter({ count: 10 });
    a.failAfter = 3;
    const got = [];
    await expect(async () => {
      for await (const r of a.sync()) got.push(r);
    }).rejects.toThrow(/induced sync failure/);
    expect(got.length).toBe(3); // 3 yielded before throw
  });

  it("normalizeShouldThrowAt fires on the right call", async () => {
    const a = new MockAdapter({ count: 5 });
    a.normalizeShouldThrowAt(2);
    let callCount = 0;
    for await (const r of a.sync()) {
      callCount += 1;
      if (callCount < 3) {
        expect(() => a.normalize(r)).not.toThrow();
      } else if (callCount === 3) {
        expect(() => a.normalize(r)).toThrow(/induced normalize/);
      }
    }
  });

  it("same seed produces same payloads (deterministic)", async () => {
    const collect = async () => {
      const a = new MockAdapter({ count: 5, seed: 99 });
      const out = [];
      for await (const r of a.sync()) out.push(r.payload);
      return out;
    };
    const a = await collect();
    const b = await collect();
    expect(a).toEqual(b);
  });
});
