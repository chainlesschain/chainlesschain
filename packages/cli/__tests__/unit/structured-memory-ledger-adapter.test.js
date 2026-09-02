import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA, EvolutionArtifactPorts } from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  STRUCTURED_MEMORY_LEDGER_CONFLICT_CODE,
  StructuredMemoryLedgerAdapter,
} from "../../src/lib/evolution/structured-memory-ledger-adapter.js";

const { STRUCTURED_MEMORY_EVENT_SCHEMA, createStructuredMemoryAuthority,
  createStructuredMemoryAuthorityReceipt, createStructuredMemoryReceiptProvider,
  createStructuredMemoryPostCompactVerifier } = structuredMemory;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function hash(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex")}`;
}

const descriptor = { tenantId: "tenant-a", artifactTenantId: "artifact-tenant-a", streamId: "memory-stream-a",
  audience: "evolution-runtime", purpose: "evolution-ledger" };
const LEDGER_TRUST = { algorithm: "hmac-sha256", keyId: "key://tests/structured-memory-ledger",
  trustPolicyDigest: hash("structured-memory-ledger-trust") };
const WITNESS_TRUST = { algorithm: "hmac-sha256", keyId: "key://tests/structured-memory-witness",
  trustPolicyDigest: hash("structured-memory-witness-trust") };
const EMPTY_DISCARD_DIGEST = hash(`chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`);
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const core = { ...WITNESS_TRUST, anchorDigest: snapshot?.anchorDigest ?? null, authenticated: true, durable: true,
    discardAccumulatorDigest: previous?.discardAccumulatorDigest ?? EMPTY_DISCARD_DIGEST,
    epoch: snapshot?.epoch ?? null, generation: previous ? previous.generation + 1 : 0,
    headDigest: snapshot?.headDigest ?? null, identityDigest: snapshot?.identityDigest ?? null,
    ledgerId: snapshot?.ledgerId ?? null, payloadDigest: snapshot?.payloadDigest ?? null,
    previousWitnessDigest: previous?.witnessDigest ?? null, schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest ?? null, sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent", storeMarkerDigest: snapshot?.storeMarkerDigest ?? null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest ?? null, storeMarkerId: snapshot?.storeMarkerId ?? null,
    witnessId };
  const message = `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`;
  return { ...core, witnessDigest: hash(message), signature: { ...WITNESS_TRUST, value: "A".repeat(43) } };
}

function durableWitness(witnessId) {
  let current = witnessRecord(witnessId);
  return { id: witnessId, read: () => current,
    initialize: ({ expected, snapshot }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, snapshot, current);
      return current;
    },
    compareAndSwap: ({ expected, next }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, next, current);
      return current;
    },
    proveAncestry: () => { throw new Error("unexpected ancestry request in linear structured-memory test"); },
  };
}

function durableFilesystem() {
  const directoryDescriptors = new Set();
  let nextDirectoryDescriptor = -20_000;
  return { ...fs, constants: fs.constants, realpathSync: fs.realpathSync,
    closeSync(fileDescriptor) {
      if (directoryDescriptors.delete(fileDescriptor)) return;
      return fs.closeSync(fileDescriptor);
    },
    fsyncSync(fileDescriptor) {
      if (directoryDescriptors.has(fileDescriptor)) return;
      try { return fs.fsyncSync(fileDescriptor); } catch (error) {
        if (process.platform === "win32" && ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
            fs.fstatSync(fileDescriptor).isDirectory()) return;
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try { return fs.openSync(target, flags, mode); } catch (error) {
        if (process.platform === "win32" && flags === "r" && ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
            fs.statSync(target).isDirectory()) {
          const fileDescriptor = nextDirectoryDescriptor;
          nextDirectoryDescriptor -= 1;
          directoryDescriptors.add(fileDescriptor);
          return fileDescriptor;
        }
        throw error;
      }
    },
  };
}

function backends() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cc-structured-memory-"));
  roots.push(root);
  const now = Date.parse("2026-09-02T00:00:00.000Z");
  const secret = "test-only-structured-memory-artifact";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/structured-memory";
  const policyDigest = hash("structured-memory-policy");
  const sign = (message) => createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({ dir: path.join(root, "artifacts"), now: () => now }),
    audience: descriptor.audience, tenantId: descriptor.artifactTenantId, now: () => now,
    envelopeSigner: { sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }) },
    envelopeVerifier: { verify: ({ message, signature }) => signature.algorithm === algorithm &&
      signature.keyId === keyId && signature.value === sign(message) },
    currentAuthorityResolver: { resolve: (request) => {
      const core = { action: request.action, algorithm, allowed: true, audience: request.audience,
        checkedAt: new Date(now).toISOString(), decisionExpiresAt: new Date(now + 30_000).toISOString(),
        digest: request.digest, issuedAt: request.issuedAt, issuedPolicyDigest: request.issuedPolicyDigest,
        issuedPolicyRevision: request.issuedPolicyRevision, issuedPolicyTrusted: true, keyId: request.keyId || keyId,
        policyDigest, policyRevision: 1, purpose: request.purpose, requestedAt: request.requestedAt,
        retention: request.retention, revocationRevision: 1, revoked: false,
        schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA, tenantId: request.tenantId, type: request.type };
      return { ...core, receiptDigest: hash(`chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`) };
    } },
  });
  const state = { events: [], failAfterAppend: false };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({ epoch: "epoch-a", ledgerId: "ledger-a", sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null }),
    appendDomainEvent: (input, expected) => {
      if (expected.expectedSequence !== state.events.length || expected.expectedHeadDigest !== (state.events.at(-1)?.eventDigest ?? null)) {
        const error = new Error("head conflict"); error.code = "CC_EVOLUTION_LEDGER_HEAD_CONFLICT"; throw error;
      }
      const record = { ...structuredClone(input), schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1, eventDigest: hash(input) };
      state.events.push(record);
      if (state.failAfterAppend) { state.failAfterAppend = false; throw new Error("response lost"); }
      return { authenticated: true, committed: true, durable: true, eventId: input.eventId, receiptDigest: hash(record) };
    },
  };
  return { artifactPorts, ledger, resolver: artifactPorts.createEvolutionLedgerArtifactResolver({ purpose: descriptor.purpose }), root, state };
}

function adapter(value) {
  return new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: value.artifactPorts,
    ledger: value.ledger, ledgerArtifactResolver: value.resolver, ...memoryOptions(),
    clock: () => Date.parse("2026-09-02T00:00:00.000Z") });
}

function openRealLedger(backend, witness) {
  const secret = "test-only-real-structured-memory-ledger-key";
  return new EvolutionLedger({ rootDir: path.join(backend.root, "ledger-events"),
    authorityRootDir: path.join(backend.root, "ledger-authority"), secure: false,
    fsImpl: durableFilesystem(), clock: () => Date.parse("2026-09-02T00:00:00.000Z"),
    random: () => randomBytes(16).toString("hex"), trust: LEDGER_TRUST, witnessTrust: WITNESS_TRUST, witness,
    artifactResolver: backend.resolver,
    sign: ({ message }) => ({ ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url") }),
    verifySignature: () => true, verifyWitnessSignature: () => true });
}

function authority() {
  return createStructuredMemoryAuthority({ tenantId: "tenant-a", actorId: "producer-1", actorType: "agent",
    role: "producer", authorityDigest: hash("producer-authority") });
}

function receiptProvider() {
  const providerDescriptor = { tenantId: "tenant-a", authorityId: "memory-receipts", authorityRevision: 1,
    handlerDigest: hash("memory-receipt-handler") };
  return createStructuredMemoryReceiptProvider({ descriptor: providerDescriptor,
    resolver: { resolve: async (request) => ({ schema: structuredMemory.STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
      authenticated: true, ...providerDescriptor, kind: request.kind, receiptDigest: request.receiptDigest,
      resolutionReceiptDigest: hash(`resolution:${request.kind}`),
      receipt: createStructuredMemoryAuthorityReceipt({ tenantId: request.tenantId,
        kind: request.kind, decision: "accepted", memoryId: request.memoryId,
        layer: request.layer, action: request.action, contentDigest: request.contentDigest,
        artifactRef: request.artifactRef, evidenceRefs: request.evidenceRefs,
        issuerId: `${request.kind}-authority`, issuerRevision: 1,
        issuerHandlerDigest: hash(`${request.kind}-handler`), issuedAt: "2026-09-02T00:00:00.000Z" }) }) },
    verifier: { verify: async () => true } });
}

function memoryOptions() {
  const postCompactDescriptor = { tenantId: "tenant-a", authorityId: "post-compact-runtime", authorityRevision: 1,
    handlerDigest: hash("post-compact-handler") };
  const postCompactVerifier = createStructuredMemoryPostCompactVerifier({ descriptor: postCompactDescriptor,
    hook: { run: async (request) => ({ schema: structuredMemory.STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
      authenticated: true, ...postCompactDescriptor, snapshotDigest: request.snapshotDigest,
      projectionDigest: request.projectionDigest, previousSnapshotDigest: request.previousSnapshotDigest,
      decision: "accepted", checkedAt: "2026-09-02T00:00:00.000Z",
      receiptDigest: hash(`post-compact:${request.snapshotDigest}`) }) },
    verifier: { verify: async () => true } });
  return { postCompactVerifier, receiptProvider: receiptProvider() };
}

function runtimeEvent(id = "memory-1") {
  return { eventId: `event-${id}`, memoryId: id, layer: "episodic", action: "append", automatic: true,
    authority: authority(), contentDigest: hash(`content-${id}`), artifactRef: `artifact://${id}`,
    evidenceRefs: [], supersedes: [], receipts: {}, timestamp: "2026-09-02T00:00:00.000Z", metadata: { sessionId: "s1" } };
}

function persistedEvent(id = "memory-1") {
  const input = runtimeEvent(id);
  delete input.authority;
  return { ...input, schema: STRUCTURED_MEMORY_EVENT_SCHEMA, tenantId: "tenant-a", sequence: 1,
    actor: { actorId: "producer-1", actorType: "agent", role: "producer" } };
}

const compactInput = { requirements: ["retain requirements"], decisions: ["use ledger"], openRisks: [],
  failedAttempts: [], tests: ["adapter-test"], goalState: { status: "active" }, delegatedTasks: [],
  memoryLineage: ["memory-1"] };

describe("StructuredMemoryLedgerAdapter", () => {
  it("round-trips events and snapshots through real ledger files and a reopened ledger", async () => {
    const backend = backends();
    const witness = durableWitness("witness-structured-memory-integration");
    const firstLedger = openRealLedger(backend, witness);
    const first = new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: backend.artifactPorts,
      ledger: firstLedger, ledgerArtifactResolver: backend.resolver,
      ...memoryOptions(),
      clock: () => Date.parse("2026-09-02T00:00:00.000Z") })
      .createMemory();
    await first.append(runtimeEvent());
    expect((await first.compact(compactInput)).status).toBe("compacted");

    const reopenedLedger = openRealLedger(backend, witness);
    const reopened = new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: backend.artifactPorts,
      ledger: reopenedLedger, ledgerArtifactResolver: backend.resolver,
      ...memoryOptions(),
      clock: () => Date.parse("2026-09-02T00:00:00.000Z") })
      .createMemory();
    expect(reopened.projection()).toEqual(first.projection());
    expect(reopened.snapshot()).toEqual(first.snapshot());
    expect(reopenedLedger.verify()).toMatchObject({ eventCount: 2, sequence: 2 });
    expect(reopenedLedger.read().map((entry) => entry.type)).toEqual([
      "memory.event.persisted", "memory.snapshot.persisted",
    ]);
  });

  it("persists events and snapshots and hydrates a new memory control-plane instance", async () => {
    const backend = backends();
    const first = adapter(backend).createMemory();
    await first.append(runtimeEvent());
    expect((await first.compact(compactInput)).status).toBe("compacted");
    const reopened = adapter(backend).createMemory();
    expect(reopened.projection()).toEqual(first.projection());
    expect(reopened.snapshot()).toEqual(first.snapshot());
    expect(backend.state.events.map((entry) => entry.type)).toEqual(["memory.event.persisted", "memory.snapshot.persisted"]);
  });

  it("rejects a different concurrent event from the same structured-memory sequence", async () => {
    const backend = backends();
    const first = adapter(backend).createMemory();
    const second = adapter(backend).createMemory();
    await first.append(runtimeEvent("memory-1"));
    await expect(second.append(runtimeEvent("memory-2"))).rejects.toMatchObject({ code: STRUCTURED_MEMORY_LEDGER_CONFLICT_CODE });
    expect(backend.state.events).toHaveLength(1);
  });

  it("recovers an identical event after the ledger committed but its response was lost", async () => {
    const backend = backends();
    const persistence = adapter(backend);
    backend.state.failAfterAppend = true;
    const event = persistedEvent();
    await expect(persistence.persistEvent(event)).rejects.toThrow(/response lost/);
    await expect(persistence.persistEvent(event)).resolves.toMatchObject({ persisted: true, recovered: true,
      eventId: "event-memory-1", eventDigest: hash(event) });
    expect(backend.state.events).toHaveLength(1);
  });

  it("rejects unbranded artifact resolvers at construction", () => {
    const backend = backends();
    expect(() => new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: backend.artifactPorts,
      ledger: backend.ledger, ledgerArtifactResolver: (request) => backend.resolver(request) })).toThrow(/branded/);
  });

  it("fixes branded receipt and PostCompact authorities at adapter construction", () => {
    const backend = backends();
    const options = memoryOptions();
    expect(() => new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: backend.artifactPorts,
      ledger: backend.ledger, ledgerArtifactResolver: backend.resolver,
      receiptProvider: { ...options.receiptProvider }, postCompactVerifier: options.postCompactVerifier }))
      .toThrow(/branded tenant-scoped structured memory receipt/);
    expect(() => new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: backend.artifactPorts,
      ledger: backend.ledger, ledgerArtifactResolver: backend.resolver,
      receiptProvider: options.receiptProvider, postCompactVerifier: async () => true }))
      .toThrow(/branded tenant-scoped structured memory PostCompact/);
  });
});
