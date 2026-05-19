"use strict";

import { describe, it, expect } from "vitest";

const { emptyBatch, mergeBatches, validateBatch, partitionBatch } = require("../lib/batch");
const { newId } = require("../lib/ids");

const source = () => ({
  adapter: "test",
  adapterVersion: "0.1.0",
  capturedAt: Date.now(),
  capturedBy: "api",
});

const goodEvent = () => ({
  id: newId(),
  type: "event",
  subtype: "order",
  occurredAt: Date.now(),
  ingestedAt: Date.now(),
  content: { title: "X" },
  source: source(),
});

const goodPerson = () => ({
  id: newId(),
  type: "person",
  subtype: "merchant",
  names: ["美团"],
  ingestedAt: Date.now(),
  source: source(),
});

const badEvent = () => ({
  // missing required occurredAt + source + content
  id: newId(),
  type: "event",
  subtype: "order",
  ingestedAt: Date.now(),
});

describe("emptyBatch", () => {
  it("returns shape with all 5 entity arrays", () => {
    const b = emptyBatch();
    expect(b).toEqual({ events: [], persons: [], places: [], items: [], topics: [] });
  });
});

describe("mergeBatches", () => {
  it("concatenates all 5 arrays", () => {
    const a = { ...emptyBatch(), events: [goodEvent()], persons: [goodPerson()] };
    const b = { ...emptyBatch(), events: [goodEvent()] };
    const merged = mergeBatches(a, b);
    expect(merged.events.length).toBe(2);
    expect(merged.persons.length).toBe(1);
    expect(merged.places.length).toBe(0);
  });

  it("tolerates missing arrays in either input", () => {
    const merged = mergeBatches({}, { persons: [goodPerson()] });
    expect(merged.persons.length).toBe(1);
    expect(merged.events.length).toBe(0);
  });
});

describe("validateBatch", () => {
  it("returns valid=true for an all-good batch", () => {
    const r = validateBatch({ events: [goodEvent(), goodEvent()], persons: [goodPerson()] });
    expect(r.valid).toBe(true);
    expect(r.entityCount).toBe(3);
    expect(r.errorCount).toBe(0);
  });

  it("collects all errors instead of throwing", () => {
    const r = validateBatch({ events: [goodEvent(), badEvent(), badEvent()] });
    expect(r.valid).toBe(false);
    expect(r.entityCount).toBe(3);
    expect(r.errorCount).toBe(2);
    expect(r.errors.every((e) => e.kind === "events")).toBe(true);
    expect(r.errors[0]).toHaveProperty("index");
    expect(r.errors[0].errors.length).toBeGreaterThan(0);
  });

  it("rejects non-array entity buckets", () => {
    const r = validateBatch({ events: "not-an-array" });
    expect(r.valid).toBe(false);
    expect(r.errors[0].errors[0]).toMatch(/array/);
  });

  it("rejects non-object batch", () => {
    expect(validateBatch(null).valid).toBe(false);
    expect(validateBatch("string").valid).toBe(false);
  });

  it("accepts batch with only some entity types populated", () => {
    const r = validateBatch({ persons: [goodPerson()] });
    expect(r.valid).toBe(true);
    expect(r.entityCount).toBe(1);
  });
});

describe("partitionBatch", () => {
  it("separates valid from invalid into distinct sub-batches", () => {
    const gE = goodEvent();
    const bE = badEvent();
    const gP = goodPerson();

    const { valid, invalid, invalidReasons } = partitionBatch({
      events: [gE, bE],
      persons: [gP],
    });

    expect(valid.events).toEqual([gE]);
    expect(valid.persons).toEqual([gP]);
    expect(invalid.events).toEqual([bE]);
    expect(invalid.persons).toEqual([]);
    expect(invalidReasons.length).toBe(1);
    expect(invalidReasons[0].kind).toBe("events");
    expect(invalidReasons[0].id).toBe(bE.id);
  });

  it("returns empty invalid sub-batch when all rows are valid", () => {
    const { valid, invalid, invalidReasons } = partitionBatch({
      events: [goodEvent()],
      persons: [goodPerson()],
    });
    expect(invalid.events).toEqual([]);
    expect(invalid.persons).toEqual([]);
    expect(invalidReasons).toEqual([]);
    expect(valid.events.length).toBe(1);
    expect(valid.persons.length).toBe(1);
  });
});
