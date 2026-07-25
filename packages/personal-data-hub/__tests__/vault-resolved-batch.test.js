"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generateKeyHex } = require("../lib/key-providers");
const { LocalVault } = require("../lib/vault");

const NOW = 1_700_000_000_000;
const SCOPE = "account:qq-pc:aaaaaaaa";

function source(adapter, originalId, scope = SCOPE) {
  return {
    adapter,
    adapterVersion: "1.0.0",
    capturedAt: NOW,
    capturedBy: "manual",
    originalId,
    ...(scope ? { scope } : {}),
  };
}

function person(id, originalId, names = ["Alice"], overrides = {}) {
  return {
    id,
    type: "person",
    subtype: "contact",
    names,
    ingestedAt: NOW,
    source: source("qq-pc", originalId),
    ...overrides,
  };
}

function event(id, originalId, overrides = {}) {
  return {
    id,
    type: "event",
    subtype: "message",
    occurredAt: NOW,
    content: { title: "message", text: "hello" },
    ingestedAt: NOW,
    source: source("qq-pc", originalId),
    ...overrides,
  };
}

function emptyBatch(overrides = {}) {
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [],
    ...overrides,
  };
}

function union(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeForTest({ entityType, existing, incoming }) {
  if (entityType === "person") {
    return {
      ...existing,
      ...incoming,
      names: union([...(existing.names || []), ...(incoming.names || [])]),
      identifiers: {
        ...(existing.identifiers || {}),
        ...(incoming.identifiers || {}),
      },
      extra: { ...(existing.extra || {}), ...(incoming.extra || {}) },
    };
  }
  if (entityType === "event") {
    return {
      ...existing,
      ...incoming,
      actor: incoming.actor || existing.actor,
      participants: union([
        ...(existing.participants || []),
        ...(incoming.participants || []),
      ]),
      content:
        incoming.content?.text && incoming.content.text.length > 0
          ? incoming.content
          : existing.content,
      extra: { ...(existing.extra || {}), ...(incoming.extra || {}) },
    };
  }
  return { ...existing, ...incoming };
}

describe("LocalVault.putBatchResolved", () => {
  let tmpDir;
  let vault;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-resolved-batch-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
  });

  afterEach(() => {
    if (vault) {
      try {
        vault.close();
      } catch {
        // Best-effort cleanup.
      }
      vault = null;
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns the persisted IDs and rewrites all event references", () => {
    vault.putBatch(
      emptyBatch({
        persons: [
          person("person-stored", "person:10001", ["Alice", "10001"], {
            identifiers: { qq: ["10001"] },
            extra: { verified: true },
          }),
        ],
        events: [
          event("event-stored", "c2c_msg_table:9007199254740993123", {
            actor: "person-stored",
            participants: ["person-stored"],
            content: { title: "old", text: "old text" },
            extra: { senderUid: "u_10001" },
          }),
        ],
      }),
    );

    const incomingPerson = person(
      "person-random",
      "person:10001",
      ["Alice Remark"],
      {
        identifiers: { qqUid: ["u_10001"] },
      },
    );
    const incomingEvent = event(
      "event-random",
      "c2c_msg_table:9007199254740993123",
      {
        actor: "person-random",
        participants: ["person-random"],
        content: { title: "new", text: "new text" },
        extra: { readState: 1 },
      },
    );

    const result = vault.putBatchResolved(
      emptyBatch({
        persons: [incomingPerson],
        events: [incomingEvent],
      }),
      { conflictResolver: mergeForTest },
    );

    expect(result.counts).toEqual({
      events: 1,
      persons: 1,
      places: 0,
      items: 0,
      topics: 0,
    });
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        {
          entityType: "person",
          incomingId: "person-random",
          persistedId: "person-stored",
          matchedBy: ["source"],
        },
        {
          entityType: "event",
          incomingId: "event-random",
          persistedId: "event-stored",
          matchedBy: ["source"],
        },
      ]),
    );

    expect(result.resolvedBatch.persons[0]).toMatchObject({
      id: "person-stored",
      names: ["Alice", "10001", "Alice Remark"],
      identifiers: { qq: ["10001"], qqUid: ["u_10001"] },
    });
    expect(result.resolvedBatch.events[0]).toMatchObject({
      id: "event-stored",
      actor: "person-stored",
      participants: ["person-stored"],
      content: { text: "new text" },
      extra: { senderUid: "u_10001", readState: 1 },
    });
    expect(vault.getEvent("event-stored")).toEqual(
      result.resolvedBatch.events[0],
    );
    expect(vault.getPerson("person-stored")).toEqual(
      result.resolvedBatch.persons[0],
    );
    expect(vault.stats()).toMatchObject({ events: 1, persons: 1 });

    // The caller's batch remains untouched; sinks must use resolvedBatch.
    expect(incomingEvent.id).toBe("event-random");
    expect(incomingEvent.actor).toBe("person-random");
    expect(incomingPerson.id).toBe("person-random");
  });

  it("atomically registers aliases, canonicalizes raw observations, and merges entities", () => {
    const canonicalOriginalId = "c2c_msg_table:9007199254740993123";
    const aliasOriginalId = "qq:message:msg-9007199254740993123";
    vault.putEvent(
      event("event-canonical", canonicalOriginalId, {
        content: { title: "rich", text: "rich desktop text" },
        extra: { senderUid: "u_10001", textResolved: true },
      }),
    );

    const result = vault.putBatchResolved(
      emptyBatch({
        events: [
          {
            ...event("event-android", aliasOriginalId, {
              content: { title: "", text: "" },
              extra: { readState: 1, textResolved: false },
            }),
            source: source("messaging-qq", aliasOriginalId),
          },
        ],
      }),
      {
        sourceAliases: [
          {
            entityType: "event",
            alias: {
              adapter: "messaging-qq",
              scope: SCOPE,
              originalId: aliasOriginalId,
            },
            canonical: {
              adapter: "qq-pc",
              scope: SCOPE,
              originalId: canonicalOriginalId,
            },
            createdAt: NOW,
          },
        ],
        rawObservations: [
          {
            adapter: "messaging-qq",
            scope: SCOPE,
            canonicalOriginalId: aliasOriginalId,
            producer: "qq-pc/android",
            producerOriginalId: "android-row-1",
            capturedAt: NOW,
            payload: { readState: 1, text: "" },
          },
        ],
        conflictResolver: ({ existing, incoming }) => ({
          ...existing,
          extra: { ...existing.extra, ...incoming.extra },
        }),
      },
    );

    expect(result).toMatchObject({
      aliasesRegistered: 1,
      rawObservationWrites: 1,
      counts: { events: 1 },
    });
    expect(result.resolvedBatch.events[0]).toMatchObject({
      id: "event-canonical",
      content: { text: "rich desktop text" },
      source: {
        adapter: "qq-pc",
        scope: SCOPE,
        originalId: canonicalOriginalId,
      },
      extra: { senderUid: "u_10001", readState: 1, textResolved: false },
    });
    expect(
      vault.resolveSourceIdentity("event", {
        adapter: "messaging-qq",
        scope: SCOPE,
        originalId: aliasOriginalId,
      }),
    ).toEqual({
      adapter: "qq-pc",
      scope: SCOPE,
      originalId: canonicalOriginalId,
    });
    expect(vault.queryRawObservations()).toEqual([
      expect.objectContaining({
        adapter: "qq-pc",
        scope: SCOPE,
        canonicalOriginalId,
        producer: "qq-pc/android",
        payload: { readState: 1, text: "" },
      }),
    ]);
    expect(vault.stats()).toMatchObject({
      events: 1,
      sourceIdentityAliases: 1,
      rawObservations: 1,
    });
  });

  it("collapses duplicate canonical sources inside one batch and rewrites references once", () => {
    const first = person("person-first", "person:10001", ["Alice"]);
    const second = person("person-second", "person:10001", ["10001"]);
    const message = event("event-one", "message:1", {
      actor: "person-second",
      participants: ["person-first", "person-second"],
    });

    const result = vault.putBatchResolved(
      emptyBatch({
        persons: [first, second],
        events: [message],
      }),
      { conflictResolver: mergeForTest },
    );

    expect(result.counts).toMatchObject({ persons: 1, events: 1 });
    expect(result.resolvedBatch.persons).toEqual([
      expect.objectContaining({
        id: "person-first",
        names: ["Alice", "10001"],
      }),
    ]);
    expect(result.resolvedBatch.events[0]).toMatchObject({
      actor: "person-first",
      participants: ["person-first"],
    });
    expect(result.conflicts).toContainEqual({
      entityType: "person",
      incomingId: "person-second",
      persistedId: "person-first",
      matchedBy: ["batch-source"],
    });
    expect(vault.stats()).toMatchObject({ persons: 1, events: 1 });
  });

  it("rewrites item and topic references to resolved IDs", () => {
    vault.putPerson(person("merchant-stored", "person:merchant", ["Shop"]));
    vault.putEvent(event("event-stored", "message:1"));

    const result = vault.putBatchResolved(
      emptyBatch({
        persons: [
          person("merchant-incoming", "person:merchant", ["Shop Alias"]),
        ],
        events: [event("event-incoming", "message:1")],
        items: [
          {
            id: "item-one",
            type: "item",
            subtype: "product",
            name: "Product",
            merchant: "merchant-incoming",
            ingestedAt: NOW,
            source: source("qq-pc", "item:1"),
          },
        ],
        topics: [
          {
            id: "topic-one",
            type: "topic",
            name: "Conversation",
            derivedFromEvents: ["event-incoming"],
            ingestedAt: NOW,
            source: source("qq-pc", "topic:1"),
          },
        ],
      }),
      { conflictResolver: mergeForTest },
    );

    expect(result.resolvedBatch.items[0].merchant).toBe("merchant-stored");
    expect(result.resolvedBatch.topics[0].derivedFromEvents).toEqual([
      "event-stored",
    ]);
    expect(vault.getItem("item-one").merchant).toBe("merchant-stored");
    expect(vault.getTopic("topic-one").derivedFromEvents).toEqual([
      "event-stored",
    ]);
  });

  it("fails an ID/source split and rolls back aliases and observations", () => {
    vault.putBatch(
      emptyBatch({
        persons: [
          person("person-a", "person:a", ["A"]),
          person("person-b", "person:b", ["B"]),
        ],
      }),
    );

    let failure;
    try {
      vault.putBatchResolved(
        emptyBatch({
          persons: [person("person-a", "person:b", ["Split"])],
        }),
        {
          sourceAliases: [
            {
              entityType: "event",
              alias: {
                adapter: "messaging-qq",
                scope: SCOPE,
                originalId: "alias:1",
              },
              canonical: {
                adapter: "qq-pc",
                scope: SCOPE,
                originalId: "canonical:1",
              },
              createdAt: NOW,
            },
          ],
          rawObservations: [
            {
              adapter: "qq-pc",
              scope: SCOPE,
              canonicalOriginalId: "canonical:1",
              producer: "qq-pc/android",
              producerOriginalId: "row-1",
              capturedAt: NOW,
              payload: {},
            },
          ],
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "ENTITY_IDENTITY_SPLIT",
      details: {
        entityType: "person",
        incomingId: "person-a",
        candidateIds: ["person-a", "person-b"],
      },
    });
    expect(vault.stats()).toMatchObject({
      persons: 2,
      sourceIdentityAliases: 0,
      rawObservations: 0,
    });
    expect(vault.getPerson("person-a").names).toEqual(["A"]);
    expect(vault.getPerson("person-b").names).toEqual(["B"]);
  });

  it("rolls back when the conflict resolver returns an invalid entity", () => {
    vault.putEvent(
      event("event-stored", "message:1", {
        content: { title: "safe", text: "safe" },
      }),
    );

    expect(() =>
      vault.putBatchResolved(
        emptyBatch({
          events: [event("event-incoming", "message:1")],
        }),
        {
          sourceAliases: [
            {
              entityType: "person",
              alias: {
                adapter: "messaging-qq",
                scope: SCOPE,
                originalId: "person:alias",
              },
              canonical: {
                adapter: "qq-pc",
                scope: SCOPE,
                originalId: "person:canonical",
              },
              createdAt: NOW,
            },
          ],
          conflictResolver: ({ incoming }) => ({
            ...incoming,
            content: null,
          }),
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "ENTITY_CONFLICT_RESOLUTION_INVALID",
      }),
    );
    expect(vault.getEvent("event-stored").content).toEqual({
      title: "safe",
      text: "safe",
    });
    expect(vault.stats()).toMatchObject({
      events: 1,
      sourceIdentityAliases: 0,
    });
  });

  it("rejects an async conflict resolver and leaves persisted data unchanged", () => {
    vault.putPerson(person("person-stored", "person:1", ["Stored"]));

    expect(() =>
      vault.putBatchResolved(
        emptyBatch({
          persons: [person("person-incoming", "person:1", ["Incoming"])],
        }),
        {
          conflictResolver: async ({ incoming }) => incoming,
        },
      ),
    ).toThrow(
      expect.objectContaining({ code: "ENTITY_CONFLICT_RESOLVER_ASYNC" }),
    );
    expect(vault.getPerson("person-stored").names).toEqual(["Stored"]);
    expect(vault.stats().persons).toBe(1);
  });

  it("fails closed when a topic source is already ambiguous", () => {
    const topicSource = source("qq-pc", "topic:ambiguous");
    vault.putTopic({
      id: "topic-a",
      type: "topic",
      name: "A",
      ingestedAt: NOW,
      source: topicSource,
    });
    vault.putTopic({
      id: "topic-b",
      type: "topic",
      name: "B",
      ingestedAt: NOW,
      source: topicSource,
    });

    expect(() =>
      vault.putBatchResolved(
        emptyBatch({
          topics: [
            {
              id: "topic-incoming",
              type: "topic",
              name: "Incoming",
              ingestedAt: NOW,
              source: topicSource,
            },
          ],
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "ENTITY_SOURCE_AMBIGUOUS" }));
    expect(vault.stats().topics).toBe(2);
  });

  it("validates inputs before opening a transaction", () => {
    expect(() => vault.putBatchResolved(null)).toThrow(/batch/);
    expect(() => vault.putBatchResolved(emptyBatch({ events: {} }))).toThrow(
      /events/,
    );
    expect(() =>
      vault.putBatchResolved(emptyBatch(), { conflictResolver: "merge" }),
    ).toThrow(/conflictResolver/);
    expect(() =>
      vault.putBatchResolved(emptyBatch(), { sourceAliases: {} }),
    ).toThrow(/sourceAliases/);
    expect(() =>
      vault.putBatchResolved(emptyBatch(), { rawObservations: {} }),
    ).toThrow(/rawObservations/);
    expect(vault.stats()).toMatchObject({
      events: 0,
      persons: 0,
      sourceIdentityAliases: 0,
      rawObservations: 0,
    });
  });
});
