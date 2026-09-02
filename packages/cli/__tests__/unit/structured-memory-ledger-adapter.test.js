import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA, EvolutionArtifactPorts } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import {
  STRUCTURED_MEMORY_LEDGER_CONFLICT_CODE,
  StructuredMemoryLedgerAdapter,
} from "../../src/lib/evolution/structured-memory-ledger-adapter.js";

const { STRUCTURED_MEMORY_EVENT_SCHEMA, createStructuredMemoryAuthority } = structuredMemory;

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
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

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
  return { artifactPorts, ledger, resolver: artifactPorts.createEvolutionLedgerArtifactResolver({ purpose: descriptor.purpose }), state };
}

function adapter(value) {
  return new StructuredMemoryLedgerAdapter({ descriptor, artifactPorts: value.artifactPorts,
    ledger: value.ledger, ledgerArtifactResolver: value.resolver, clock: () => Date.parse("2026-09-02T00:00:00.000Z") });
}

function authority() {
  return createStructuredMemoryAuthority({ tenantId: "tenant-a", actorId: "producer-1", actorType: "agent",
    role: "producer", authorityDigest: hash("producer-authority") });
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
  it("persists events and snapshots and hydrates a new memory control-plane instance", async () => {
    const backend = backends();
    const first = adapter(backend).createMemory({ postCompactVerifier: async () => true });
    await first.append(runtimeEvent());
    expect((await first.compact(compactInput)).status).toBe("compacted");
    const reopened = adapter(backend).createMemory({ postCompactVerifier: async () => true });
    expect(reopened.projection()).toEqual(first.projection());
    expect(reopened.snapshot()).toEqual(first.snapshot());
    expect(backend.state.events.map((entry) => entry.type)).toEqual(["memory.event.persisted", "memory.snapshot.persisted"]);
  });

  it("rejects a different concurrent event from the same structured-memory sequence", async () => {
    const backend = backends();
    const first = adapter(backend).createMemory({ postCompactVerifier: async () => true });
    const second = adapter(backend).createMemory({ postCompactVerifier: async () => true });
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
});
