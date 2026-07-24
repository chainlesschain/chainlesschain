"use strict";

import { describe, expect, it } from "vitest";

const { scopeNormalizedBatch } = require("../lib/scope-normalized-batch");

function source(originalId) {
  return {
    adapter: "account-source",
    adapterVersion: "1.0.0",
    capturedAt: 1_700_000_000_000,
    capturedBy: "manual",
    originalId,
  };
}

function normalizedBatch({ eventId, personId }) {
  return {
    events: [
      {
        id: eventId,
        type: "event",
        subtype: "message",
        occurredAt: 1_700_000_000_000,
        actor: personId,
        participants: [personId, "person-self"],
        content: { text: "hello" },
        ingestedAt: 1_700_000_000_100,
        source: source("message-42"),
      },
    ],
    persons: [
      {
        id: personId,
        type: "person",
        subtype: "contact",
        names: ["Alice"],
        ingestedAt: 1_700_000_000_100,
        source: source("person-alice"),
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

describe("scopeNormalizedBatch", () => {
  it("keeps empty-scope batches byte-for-byte compatible", () => {
    const batch = normalizedBatch({
      eventId: "event-random-a",
      personId: "person-random-a",
    });

    expect(scopeNormalizedBatch(batch, "")).toBe(batch);
  });

  it("creates stable account-specific IDs and rewrites entity references", () => {
    const scopeA = "account:account-source:aaaaaaaa";
    const first = scopeNormalizedBatch(
      normalizedBatch({
        eventId: "event-random-a",
        personId: "person-random-a",
      }),
      scopeA,
    );
    const repeated = scopeNormalizedBatch(
      normalizedBatch({
        eventId: "event-random-b",
        personId: "person-random-b",
      }),
      scopeA,
    );
    const accountB = scopeNormalizedBatch(
      normalizedBatch({
        eventId: "event-random-c",
        personId: "person-random-c",
      }),
      "account:account-source:bbbbbbbb",
    );

    expect(first.events[0].id).toBe(repeated.events[0].id);
    expect(first.persons[0].id).toBe(repeated.persons[0].id);
    expect(first.events[0].actor).toBe(first.persons[0].id);
    expect(first.events[0].participants[0]).toBe(first.persons[0].id);
    expect(first.events[0].participants[1]).toMatch(/-self$/u);
    expect(first.events[0].source.scope).toBe(scopeA);
    expect(first.persons[0].source.scope).toBe(scopeA);

    expect(accountB.events[0].id).not.toBe(first.events[0].id);
    expect(accountB.persons[0].id).not.toBe(first.persons[0].id);
    expect(first.events[0].id).not.toContain(scopeA);
  });
});
