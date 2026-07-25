"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

const SOURCE_SCOPE = "account:resolved-ingest:test";

function rawRecord(index) {
  return {
    adapter: "resolved-ingest",
    originalId: `raw-${index}`,
    capturedAt: 1_750_000_000_000 + index,
    payload: {
      index,
      eventId: `event-${index}`,
      personId: `person-${index}`,
      text: `message ${index}`,
      name: `Person ${index}`,
    },
  };
}

class ResolvedIngestAdapter {
  constructor() {
    this.name = "resolved-ingest";
    this.version = "1.0.0";
    this.capabilities = ["sync:test"];
    this.watermarkStrategy = "none";
    this.defaultScope = SOURCE_SCOPE;
    this.dataDisclosure = {
      fields: ["test:message,person"],
      sensitivity: "low",
      legalGate: false,
    };
    this.lastResolvedContext = null;
  }

  async authenticate() {
    return { ok: true };
  }

  async healthCheck() {
    return { ok: true };
  }

  async *sync() {
    yield rawRecord(1);
    yield rawRecord(2);
  }

  normalize(raw) {
    const { capturedAt, payload } = raw;
    const source = (originalId) => ({
      adapter: this.name,
      adapterVersion: this.version,
      capturedAt,
      capturedBy: "manual",
      originalId,
    });
    return {
      events: [
        {
          id: payload.eventId,
          type: "event",
          subtype: "message",
          occurredAt: capturedAt,
          actor: payload.personId,
          participants: [payload.personId],
          content: { text: payload.text },
          ingestedAt: capturedAt,
          source: source(`event-source-${payload.index}`),
        },
      ],
      persons: [
        {
          id: payload.personId,
          type: "person",
          subtype: "contact",
          names: [payload.name],
          ingestedAt: capturedAt,
          source: source(`person-source-${payload.index}`),
        },
      ],
      places: [],
      items: [],
      topics: [],
    };
  }

  buildResolvedIngestOptions(context) {
    this.lastResolvedContext = context;
    const canonical = (originalId) => ({
      adapter: this.name,
      scope: context.scope,
      originalId,
    });
    const sourceAliases = [];
    for (const index of [1, 2]) {
      sourceAliases.push(
        {
          entityType: "event",
          alias: canonical(`event-source-${index}`),
          canonical: canonical("canonical-event"),
        },
        {
          entityType: "person",
          alias: canonical(`person-source-${index}`),
          canonical: canonical("canonical-person"),
        },
      );
    }
    return {
      sourceAliases,
      conflictResolver({ existing, incoming }) {
        return {
          ...existing,
          ...incoming,
          id: existing.id,
          source: incoming.source,
        };
      },
    };
  }
}

let tmpDir;
let vault;

function openVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-resolved-registry-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
  return vault;
}

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

describe("AdapterRegistry resolved ingest", () => {
  it("feeds persisted IDs and rewritten references to every downstream sink", async () => {
    openVault();
    const kgTriples = [];
    const ragDocs = [];
    const resolvedPersons = [];
    const adapter = new ResolvedIngestAdapter();
    const registry = new AdapterRegistry({
      vault,
      entityResolver: {
        resolveOnIngest(persons) {
          resolvedPersons.push(...persons);
          return {
            newPersons: persons.length,
            sameImmediate: 0,
            differentImmediate: 0,
            enqueued: 0,
            errored: 0,
          };
        },
      },
      kgSink: (triples) => kgTriples.push(...triples),
      ragSink: (docs) => ragDocs.push(...docs),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("ok");
    expect(report.entityCounts).toMatchObject({ events: 1, persons: 1 });
    expect(report.resolvedConflictCount).toBe(2);
    expect(report.sourceAliasCount).toBe(4);
    expect(report.rawObservationCount).toBe(0);
    expect(adapter.lastResolvedContext).toMatchObject({
      scope: SOURCE_SCOPE,
    });
    expect(adapter.lastResolvedContext.rawBatch).toHaveLength(2);
    const firstEventId = adapter.lastResolvedContext.batch.events[0].id;
    const secondEventId = adapter.lastResolvedContext.batch.events[1].id;
    const firstPersonId = adapter.lastResolvedContext.batch.persons[0].id;

    const events = vault.queryEvents({ adapter: adapter.name, limit: 10 });
    const persons = vault.queryPersons({ adapter: adapter.name, limit: 10 });
    expect(events).toHaveLength(1);
    expect(persons).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: firstEventId,
      actor: firstPersonId,
      participants: [firstPersonId],
      content: { text: "message 2" },
    });
    expect(persons[0]).toMatchObject({
      id: firstPersonId,
      names: ["Person 2"],
    });

    expect(resolvedPersons).toHaveLength(1);
    expect(resolvedPersons[0].id).toBe(firstPersonId);
    expect(
      kgTriples.some(
        (triple) =>
          triple.subject === firstEventId &&
          triple.predicate === "by" &&
          triple.object === firstPersonId,
      ),
    ).toBe(true);
    expect(kgTriples.some((triple) => triple.subject === secondEventId)).toBe(
      false,
    );
    expect(ragDocs.find((doc) => doc.type === "event")).toMatchObject({
      id: firstEventId,
      text: expect.stringContaining("message 2"),
      metadata: { actor: firstPersonId },
    });
  });

  it("uses the same resolved transaction during raw re-derive", async () => {
    openVault();
    const adapter = new ResolvedIngestAdapter();
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);
    for (const raw of [rawRecord(1), rawRecord(2)]) {
      vault.putRawEvent({
        ...raw,
        scope: SOURCE_SCOPE,
      });
    }

    const report = await registry.rederive({
      adapter: adapter.name,
      scope: SOURCE_SCOPE,
    });

    expect(report.errors).toEqual([]);
    expect(report.entityCounts).toMatchObject({ events: 1, persons: 1 });
    expect(
      vault.queryEvents({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(1);
    const firstEventId = adapter.lastResolvedContext.batch.events[0].id;
    const firstPersonId = adapter.lastResolvedContext.batch.persons[0].id;
    expect(vault.getEvent(firstEventId)).toMatchObject({
      actor: firstPersonId,
      content: { text: "message 2" },
    });
  });

  it("fails closed when the adapter returns resolved options asynchronously", async () => {
    openVault();
    const adapter = new ResolvedIngestAdapter();
    adapter.buildResolvedIngestOptions = async () => ({});
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("error");
    expect(report.error).toContain(
      "buildResolvedIngestOptions must be synchronous",
    );
    expect(report.checkpointCommitted).toBe(false);
    expect(vault.queryEvents({ adapter: adapter.name, limit: 10 })).toEqual([]);
    expect(
      vault.queryRawEvents({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(2);
  });
});
