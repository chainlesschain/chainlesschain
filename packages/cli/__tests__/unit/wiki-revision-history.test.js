import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  WIKI_REVISION_SCHEMA,
  createEmptyWikiState,
  digestWikiState as hash,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  WIKI_LEDGER_CONFLICT_CODE,
  WIKI_LEDGER_CORRUPT_CODE,
  WIKI_LEDGER_EVENT_TYPE,
  WikiMaintainerLedgerAdapter,
  captureWikiRevisionReader,
} from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import { EVOLUTION_LEDGER_MAX_EVENTS } from "../../src/lib/evolution/evolution-ledger.js";

const roots = [];
const tenantId = "tenant-history";
const effectiveAt = "2026-09-05T00:00:00.000Z";
const evidenceRefs = ["ev-history"];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function open(root) {
  const resources = openEvolutionDurableStore(root, {
    tenantId,
    streamId: "wiki-history",
  });
  const options = {
    descriptor: { ...resources.descriptor, evolutionRunId: "wiki-history" },
    artifactPorts: resources.artifactPorts,
    ledger: resources.backend.ledger,
    ledgerArtifactResolver: resources.resolver,
  };
  const adapter = new WikiMaintainerLedgerAdapter(options);
  return {
    ...resources,
    root,
    options,
    adapter,
    reader: captureWikiRevisionReader(adapter),
  };
}
function setup() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-wiki-history-"),
  );
  roots.push(root);
  return open(root);
}
function request(requestDigest) {
  return {
    schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
    tenantId,
    requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
    requestDigest,
  };
}
async function maintain(h, requestDigest = null) {
  const core = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId,
    ref: evidenceRefs[0],
    sourceDigest: hash("source"),
    projectionDigest: hash("projection"),
    artifactRef: "artifact://history",
    trustedProjection: true,
    trustDomain: "test-history",
    kind: "tool-observation",
    status: "active",
    observedAt: effectiveAt,
    expiresAt: null,
    data: { outcome: "verified" },
  };
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor: {
      tenantId,
      evolutionRunId: "wiki-history",
      maintainerModel: "test:history",
      rulesDigest: hash("rules"),
    },
    policy: {
      trustedProjectionRead: true,
      rawEvidenceRead: false,
      activeSkillWrite: false,
      shell: false,
      network: false,
      secretRead: false,
    },
    ports: h.adapter.maintainerPorts({
      resolveEvidence: async () => ({ ...core, envelopeDigest: hash(core) }),
      derive: async () => ({ operations: [] }),
    }),
  });
  return maintainer.maintain({
    evidenceRefs,
    effectiveAt,
    ...(requestDigest ? { maintenanceRequest: request(requestDigest) } : {}),
  });
}
function seal(revision) {
  const {
    revisionId: ignoredId,
    stateDigest: ignoredDigest,
    state,
    ...payload
  } = revision;
  void ignoredId;
  void ignoredDigest;
  revision.revisionId = `wiki:${hash(payload).slice(7)}`;
  state.revisionId = revision.revisionId;
  revision.stateDigest = hash(state);
  return revision;
}
function nextRevision(state, requestDigest = null) {
  const revision = seal({
    schema: WIKI_REVISION_SCHEMA,
    tenantId,
    evolutionRunId: "wiki-history",
    revision: state.revision + 1,
    priorStateDigest: hash(state),
    rulesDigest: hash("rules"),
    maintainerModel: "test:history",
    effectiveAt,
    evidenceRefs,
    operationDigest: hash([]),
    maintenanceRequestId: requestDigest
      ? request(requestDigest).requestId
      : null,
    maintenanceRequestDigest: requestDigest,
    state: { ...structuredClone(state), revision: state.revision + 1 },
  });
  if (requestDigest)
    revision.state.maintenanceRequests[revision.maintenanceRequestId] = {
      requestDigest,
      evidenceRefs,
      effectiveAt,
      operationDigest: revision.operationDigest,
      revision: revision.revision,
      revisionId: revision.revisionId,
    };
  revision.stateDigest = hash(revision.state);
  return revision;
}
// Deliberately bypass the Wiki adapter but NOT ArtifactStore/Ledger signatures:
// valid persistence authentication alone must not bless invalid Wiki semantics.
function appendUnchecked(h, revision, overrides = {}) {
  const ledger = h.backend.ledger;
  const previous = ledger
    .read()
    .filter((event) => event.type === WIKI_LEDGER_EVENT_TYPE)
    .at(-1);
  const published = h.artifactPorts.putCanonical("wiki-revision", revision, {
    audience: h.descriptor.audience,
    purpose: "evolution-ledger",
    retention: "ledger",
  });
  const head = ledger.verify();
  return ledger.appendDomainEvent(
    {
      artifactTenantId: h.descriptor.artifactTenantId,
      correlationId: "wiki-history",
      decision: "committed",
      eventId: `wiki.revision.${revision.revisionId.slice(5)}`,
      reason: "test signed Wiki revision",
      skillName: null,
      sourceRefs: previous ? [previous.subjectRef] : [],
      subjectRef: published.ref,
      tenantId,
      timestamp: effectiveAt,
      type: WIKI_LEDGER_EVENT_TYPE,
      ...overrides,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
}

describe("authenticated Wiki revision history", () => {
  it("reopens the exact baseline and ordered own successors with real signatures and durable request idempotency", async () => {
    const h = setup();
    const baseline = await maintain(h);
    const firstRequest = hash("first pruning effect");
    const secondRequest = hash("second pruning effect");
    await maintain(h, firstRequest);
    const current = await maintain(h, secondRequest);
    const reopened = open(h.root);
    const result = reopened.reader.resolveHistory({
      tenantId,
      stateDigest: baseline.stateDigest,
      allowedMaintenanceRequestDigests: [firstRequest, secondRequest],
    });
    expect(result.source.state).toEqual(baseline.state);
    expect(result.current.state).toEqual(current.state);
    expect(
      result.successors.map((entry) => entry.revision.maintenanceRequestDigest),
    ).toEqual([firstRequest, secondRequest]);
    expect(Object.isFrozen(result.source.state.maintenanceRequests)).toBe(true);
    expect(Object.isFrozen(result.successors[0].revision)).toBe(true);
    expect(await maintain(reopened, firstRequest)).toMatchObject({
      recovered: true,
      revision: 2,
      currentRevision: 3,
    });
    expect(reopened.backend.ledger.verify().sequence).toBe(3);
  });

  it("resolves genesis and requires authorization even for an otherwise valid untagged successor", async () => {
    const h = setup();
    const stateDigest = hash(createEmptyWikiState(tenantId));
    expect(
      h.reader.resolveHistory({ tenantId, stateDigest }).source.state.revision,
    ).toBe(0);
    const ownRequest = hash("genesis pruning");
    await maintain(h, ownRequest);
    expect(
      h.reader.resolveHistory({
        tenantId,
        stateDigest,
        allowedMaintenanceRequestDigests: [ownRequest],
      }).successors,
    ).toHaveLength(1);
    await maintain(h);
    expect(() =>
      h.reader.resolveHistory({
        tenantId,
        stateDigest,
        allowedMaintenanceRequestDigests: [ownRequest],
      }),
    ).toThrow(/successors/u);
  });

  it.each([
    "missing",
    "wrong-tenant",
    "no-permission",
    "wrong-order",
    "duplicate-permission",
  ])("rejects %s historical requests", async (kind) => {
    const h = setup();
    const baseline = await maintain(h);
    const own = hash("own");
    await maintain(h, own);
    const input = {
      tenantId,
      stateDigest: baseline.stateDigest,
      allowedMaintenanceRequestDigests: [own],
    };
    if (kind === "missing") input.stateDigest = hash("unknown baseline");
    if (kind === "wrong-tenant") input.tenantId = "another-tenant";
    if (kind === "no-permission") input.allowedMaintenanceRequestDigests = [];
    if (kind === "wrong-order")
      input.allowedMaintenanceRequestDigests = [hash("other"), own];
    if (kind === "duplicate-permission")
      input.allowedMaintenanceRequestDigests = [own, own];
    expect(() => open(h.root).reader.resolveHistory(input)).toThrow();
  });

  it.each([
    "revision-id",
    "state-sequence",
    "prior-state",
    "request-digest",
    "request-record",
    "extra-request",
  ])("rejects signed but invalid %s binding", (kind) => {
    const h = setup();
    const revision = nextRevision(createEmptyWikiState(tenantId), hash("own"));
    if (kind === "revision-id") {
      revision.revisionId = `wiki:${"0".repeat(64)}`;
      revision.state.revisionId = revision.revisionId;
    }
    if (kind === "state-sequence") revision.state.revision = 999;
    if (kind === "prior-state") {
      revision.priorStateDigest = hash("not genesis");
      seal(revision);
    }
    if (kind === "request-digest") {
      revision.maintenanceRequestDigest = hash("other");
      seal(revision);
    }
    if (kind === "request-record")
      revision.state.maintenanceRequests[
        revision.maintenanceRequestId
      ].operationDigest = hash("other operation");
    if (kind === "extra-request") revision.state.maintenanceRequests.extra = {};
    revision.stateDigest = hash(revision.state);
    appendUnchecked(h, revision);
    expect(h.backend.ledger.verify().sequence).toBe(1);
    expect(() => open(h.root).reader.loadWiki()).toThrow(
      expect.objectContaining({ code: WIKI_LEDGER_CORRUPT_CODE }),
    );
  });

  it("authenticates every predecessor, not only a valid-looking latest revision", () => {
    const h = setup();
    const first = nextRevision(createEmptyWikiState(tenantId));
    first.priorStateDigest = hash("forged genesis");
    seal(first);
    appendUnchecked(h, first);
    const second = nextRevision(first.state);
    appendUnchecked(h, second);
    expect(h.backend.ledger.verify().sequence).toBe(2);
    expect(() => open(h.root).reader.loadWiki()).toThrow(/predecessor/u);
  });

  it.each(["dropped", "rebound", "duplicated"])(
    "rejects %s durable maintenance history",
    (kind) => {
      const h = setup();
      const own = hash("own");
      const first = nextRevision(createEmptyWikiState(tenantId), own);
      appendUnchecked(h, first);
      const second = nextRevision(
        first.state,
        kind === "duplicated" ? own : null,
      );
      if (kind === "dropped") second.state.maintenanceRequests = {};
      if (kind === "rebound")
        second.state.maintenanceRequests[
          first.maintenanceRequestId
        ].requestDigest = hash("other");
      second.stateDigest = hash(second.state);
      appendUnchecked(h, second);
      expect(() => open(h.root).reader.loadWiki()).toThrow(
        /maintenance request/u,
      );
    },
  );

  it.each(["source", "timestamp", "event-id", "decision"])(
    "rejects signed event %s substitution",
    (kind) => {
      const h = setup();
      const first = nextRevision(createEmptyWikiState(tenantId));
      appendUnchecked(h, first);
      const second = nextRevision(first.state);
      const overrides =
        kind === "source"
          ? { sourceRefs: [] }
          : kind === "timestamp"
            ? { timestamp: "2026-09-06T00:00:00.000Z" }
            : kind === "event-id"
              ? { eventId: "wiki.revision.substituted" }
              : { decision: "rejected" };
      appendUnchecked(h, second, overrides);
      expect(() => open(h.root).reader.loadWiki()).toThrow(
        expect.objectContaining({ code: WIKI_LEDGER_CORRUPT_CODE }),
      );
    },
  );

  it("preserves authenticated legacy v1 genesis and upgrades it with durable maintenance requests", async () => {
    const h = setup();
    const legacyGenesis = { ...createEmptyWikiState(tenantId) };
    delete legacyGenesis.maintenanceRequests;
    const legacy = nextRevision(legacyGenesis);
    delete legacy.maintenanceRequestId;
    delete legacy.maintenanceRequestDigest;
    delete legacy.state.maintenanceRequests;
    seal(legacy);
    appendUnchecked(h, legacy);
    const reopened = open(h.root);
    expect(reopened.reader.loadWiki().stateDigest).toBe(legacy.stateDigest);
    const ownRequest = hash("legacy upgrade");
    await maintain(reopened, ownRequest);
    expect(
      open(h.root).reader.resolveHistory({
        tenantId,
        stateDigest: legacy.stateDigest,
        allowedMaintenanceRequestDigests: [ownRequest],
      }).current.state.revision,
    ).toBe(2);
    expect(() =>
      reopened.reader.resolveHistory({
        tenantId,
        stateDigest: hash(createEmptyWikiState(tenantId)),
        allowedMaintenanceRequestDigests: [ownRequest],
      }),
    ).toThrow(/baseline/u);
  });

  it("detects an unrelated ledger append while reading the Wiki history", () => {
    const h = setup();
    const revision = nextRevision(createEmptyWikiState(tenantId));
    appendUnchecked(h, revision);
    const ledger = h.backend.ledger;
    let changed = false;
    const adapter = new WikiMaintainerLedgerAdapter({
      ...h.options,
      ledger: {
        verify: () => ledger.verify(),
        appendDomainEvent: (...args) => ledger.appendDomainEvent(...args),
        read() {
          const events = ledger.read();
          if (!changed) {
            changed = true;
            appendUnchecked(h, revision, {
              eventId: "unrelated.change",
              type: "other.event",
              sourceRefs: [],
            });
          }
          return events;
        },
      },
    });
    expect(() => captureWikiRevisionReader(adapter).loadWiki()).toThrow(
      expect.objectContaining({ code: WIKI_LEDGER_CONFLICT_CODE }),
    );
  });

  it("reads the complete range with one fresh authority check and rejects truncated snapshots", () => {
    const h = setup();
    const first = nextRevision(createEmptyWikiState(tenantId));
    appendUnchecked(h, first);
    appendUnchecked(h, nextRevision(first.state));
    const ledger = h.backend.ledger;
    let verifies = 0;
    let reads = 0;
    let truncated = false;
    const adapter = new WikiMaintainerLedgerAdapter({
      ...h.options,
      ledger: {
        read(options) {
          expect(options).toEqual({ limit: EVOLUTION_LEDGER_MAX_EVENTS });
          reads += 1;
          return ledger.read(truncated ? { limit: 1 } : options);
        },
        verify() {
          verifies += 1;
          return ledger.verify();
        },
        appendDomainEvent: (...args) => ledger.appendDomainEvent(...args),
      },
    });
    expect(adapter.loadWiki().state.revision).toBe(2);
    expect([reads, verifies]).toEqual([1, 1]);
    truncated = true;
    expect(() => adapter.loadWiki()).toThrow(
      expect.objectContaining({ code: WIKI_LEDGER_CONFLICT_CODE }),
    );
  });

  it("rejects imitation readers and does not dispatch through subclass overrides", () => {
    const h = setup();
    class Substitution extends WikiMaintainerLedgerAdapter {
      resolveHistory() {
        return { authenticated: true, source: "forged" };
      }
    }
    const adapter = new Substitution(h.options);
    const reader = captureWikiRevisionReader(adapter);
    const result = reader.resolveHistory({
      tenantId,
      stateDigest: hash(createEmptyWikiState(tenantId)),
    });
    expect(result.source.state.revision).toBe(0);
    expect(() => captureWikiRevisionReader({ ...adapter })).toThrow(/branded/u);
    expect(() => captureWikiRevisionReader(reader)).toThrow(/branded/u);
  });

  it("rejects sparse and oversized request sequences before reading the ledger", () => {
    const h = setup();
    let reads = 0;
    const adapter = new WikiMaintainerLedgerAdapter({
      ...h.options,
      ledger: {
        read: () => {
          reads += 1;
          throw new Error("unexpected ledger read");
        },
        verify: () => {
          reads += 1;
          throw new Error("unexpected ledger verification");
        },
        appendDomainEvent: () => {
          throw new Error("unexpected append");
        },
      },
    });
    const reader = captureWikiRevisionReader(adapter);
    for (const allowedMaintenanceRequestDigests of [
      new Array(1),
      new Array(129),
    ]) {
      expect(() =>
        reader.resolveHistory({
          tenantId,
          stateDigest: hash(createEmptyWikiState(tenantId)),
          allowedMaintenanceRequestDigests,
        }),
      ).toThrow(TypeError);
    }
    expect(reads).toBe(0);
  });
});
