import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  WIKI_LEDGER_CONFLICT_CODE,
  WikiMaintainerLedgerAdapter,
} from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex")}`;
}

const descriptor = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a",
  evolutionRunId: "run-1",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
};

const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const LEDGER_TRUST = { algorithm: "hmac-sha256", keyId: "key://tests/wiki-ledger",
  trustPolicyDigest: hash("wiki-ledger-trust") };
const WITNESS_TRUST = { algorithm: "hmac-sha256", keyId: "key://tests/wiki-witness",
  trustPolicyDigest: hash("wiki-witness-trust") };
const EMPTY_DISCARD_DIGEST = hash(`chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`);

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
    proveAncestry: () => { throw new Error("unexpected ancestry request in linear Wiki test"); },
  };
}

function durableFilesystem() {
  const directoryDescriptors = new Set();
  let nextDirectoryDescriptor = -10_000;
  return { ...fs, constants: fs.constants, realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directoryDescriptors.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directoryDescriptors.has(descriptor)) return;
      try { return fs.fsyncSync(descriptor); } catch (error) {
        if (process.platform === "win32" && ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
            fs.fstatSync(descriptor).isDirectory()) return;
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try { return fs.openSync(target, flags, mode); } catch (error) {
        if (process.platform === "win32" && flags === "r" && ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
            fs.statSync(target).isDirectory()) {
          const descriptor = nextDirectoryDescriptor;
          nextDirectoryDescriptor -= 1;
          directoryDescriptors.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function durableBackends() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cc-wiki-ledger-"));
  temporaryRoots.push(root);
  const secret = "test-only-wiki-artifact-key";
  const keyId = "test:key/wiki-artifacts";
  const algorithm = "hmac-sha256";
  const policyDigest = hash("wiki-artifact-policy");
  const now = Date.parse("2026-09-02T00:00:00.000Z");
  const sign = (message) => createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({ dir: path.join(root, "artifacts"), now: () => now }),
    audience: descriptor.audience,
    tenantId: descriptor.artifactTenantId,
    now: () => now,
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
  const putSpy = vi.fn((...args) => artifactPorts.putCanonical(...args));
  const artifactWriter = { putCanonical: putSpy };
  const ledgerState = { events: [], failAfterAppend: false, beforeAppend: null };
  const ledger = {
    read: vi.fn(() => structuredClone(ledgerState.events)),
    verify: vi.fn(() => ({ epoch: "epoch-a", ledgerId: "ledger-a", sequence: ledgerState.events.length,
      headDigest: ledgerState.events.at(-1)?.eventDigest ?? null })),
    appendDomainEvent: vi.fn((input, options) => {
      ledgerState.beforeAppend?.();
      const head = ledgerState.events.at(-1);
      if (options.expectedSequence !== ledgerState.events.length || options.expectedHeadDigest !== (head?.eventDigest ?? null)) {
        const error = new Error("ledger head conflict");
        error.code = "CC_EVOLUTION_LEDGER_HEAD_CONFLICT";
        throw error;
      }
      const event = { ...structuredClone(input), schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: ledgerState.events.length + 1, eventDigest: hash(input) };
      ledgerState.events.push(event);
      const receipt = { authenticated: true, committed: true, durable: true, eventId: input.eventId, receiptDigest: hash(event) };
      if (ledgerState.failAfterAppend) {
        ledgerState.failAfterAppend = false;
        throw new Error("simulated response loss");
      }
      return receipt;
    }),
  };
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({ purpose: descriptor.purpose });
  return { artifactPorts: artifactWriter, rawArtifactPorts: artifactPorts, putSpy, ledger, ledgerState, resolver, root };
}

function openRealLedger(backends, witness) {
  const secret = "test-only-real-wiki-ledger-key";
  return new EvolutionLedger({
    rootDir: path.join(backends.root, "ledger-events"),
    authorityRootDir: path.join(backends.root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => Date.parse("2026-09-02T00:00:00.000Z"),
    random: () => randomBytes(16).toString("hex"),
    trust: LEDGER_TRUST,
    witnessTrust: WITNESS_TRUST,
    witness,
    artifactResolver: backends.resolver,
    sign: ({ message }) => ({ ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url") }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
}

function evidence(ref, trustDomain) {
  const value = { schema: WIKI_EVIDENCE_SCHEMA, tenantId: "tenant-a", ref, sourceDigest: hash(`source:${ref}`),
    projectionDigest: hash(`projection:${ref}`), artifactRef: `artifact://${ref}`, trustedProjection: true,
    trustDomain, kind: "tool-observation", status: "active", observedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null, data: { outcome: "verified" } };
  return { ...value, envelopeDigest: hash(value) };
}

function operation() {
  return { type: "upsert", pattern: { patternId: "pat-durable-wiki", kind: "success",
    summary: "Durable Wiki revisions recover across adapter instances.", rootCause: "Artifact and ledger identities are bound.",
    procedure: "Commit immutable state then append its ledger event.", appliesWhen: ["durable authorities are available"],
    doesNotApplyWhen: ["the ledger is unavailable"], positiveEvidence: ["ev-1", "ev-2"], negativeEvidence: [],
    contradicts: [], supersedes: [], confidence: 0.9, trustDomains: [], lastVerifiedAt: "2026-09-02T00:00:00.000Z",
    expiresAt: null, skillNames: ["safe-refactor"] } };
}

function maintainer(adapter, overrides = {}) {
  const evidenceByRef = { "ev-1": evidence("ev-1", "workspace-a"), "ev-2": evidence("ev-2", "workspace-b") };
  return new EvidenceBackedWikiMaintainer({
    descriptor: { tenantId: "tenant-a", evolutionRunId: "run-1", maintainerModel: "provider:model-v1",
      rulesDigest: hash("rules"), minCorroboratingSources: 2 },
    policy: { trustedProjectionRead: true, rawEvidenceRead: false, activeSkillWrite: false,
      shell: false, network: false, secretRead: false },
    ports: adapter.maintainerPorts({
      resolveEvidence: async (ref) => evidenceByRef[ref],
      derive: overrides.derive ?? (async () => ({ operations: [operation()] })),
    }),
  });
}

function adapter(backends) {
  return new WikiMaintainerLedgerAdapter({ descriptor, artifactPorts: backends.artifactPorts,
    ledger: backends.ledger, ledgerArtifactResolver: backends.resolver });
}

describe("WikiMaintainerLedgerAdapter", () => {
  it("round-trips through real EvolutionLedger files and a reopened ledger instance", async () => {
    const backends = durableBackends();
    const witness = durableWitness("witness-wiki-integration");
    const firstLedger = openRealLedger(backends, witness);
    const firstAdapter = new WikiMaintainerLedgerAdapter({ descriptor, artifactPorts: backends.artifactPorts,
      ledger: firstLedger, ledgerArtifactResolver: backends.resolver });
    const result = await maintainer(firstAdapter).maintain({ evidenceRefs: ["ev-1", "ev-2"],
      effectiveAt: "2026-09-02T00:00:00.000Z" });

    const reopenedLedger = openRealLedger(backends, witness);
    const reopenedAdapter = new WikiMaintainerLedgerAdapter({ descriptor, artifactPorts: backends.artifactPorts,
      ledger: reopenedLedger, ledgerArtifactResolver: backends.resolver });
    expect(reopenedAdapter.loadWiki()).toMatchObject({ stateDigest: result.stateDigest, state: result.state });
    expect(reopenedLedger.verify()).toMatchObject({ eventCount: 1, sequence: 1 });
    expect(reopenedLedger.read()[0]).toMatchObject({ type: "wiki.revision.committed", correlationId: "run-1" });
  });

  it("persists a Wiki revision in immutable artifacts and recovers it through a new adapter instance", async () => {
    const backends = durableBackends();
    const first = await maintainer(adapter(backends)).maintain({ evidenceRefs: ["ev-1", "ev-2"], effectiveAt: "2026-09-02T00:00:00.000Z" });
    const reopened = adapter(backends).loadWiki();
    expect(reopened.state).toEqual(first.state);
    expect(reopened.stateDigest).toBe(first.stateDigest);
    expect(backends.ledgerState.events).toHaveLength(1);
    expect(backends.putSpy).toHaveBeenCalledWith("wiki-revision", expect.any(Object),
      { audience: "evolution-runtime", purpose: "evolution-ledger", retention: "ledger" });
  });

  it("allows exactly one concurrent writer from the same Wiki baseline", async () => {
    const backends = durableBackends();
    let release;
    let arrivals = 0;
    const barrier = new Promise((resolve) => { release = resolve; });
    const derive = async () => {
      arrivals += 1;
      const arrival = arrivals;
      if (arrivals === 2) release();
      await barrier;
      const next = operation();
      if (arrival === 2) {
        next.pattern.patternId = "pat-competing-wiki";
        next.pattern.summary = "A competing Wiki revision from the same baseline.";
        next.pattern.rootCause = "A concurrent maintainer derived a different cluster.";
      }
      return { operations: [next] };
    };
    const results = await Promise.allSettled([
      maintainer(adapter(backends), { derive }).maintain({ evidenceRefs: ["ev-1", "ev-2"], effectiveAt: "2026-09-02T00:00:00.000Z" }),
      maintainer(adapter(backends), { derive }).maintain({ evidenceRefs: ["ev-1", "ev-2"], effectiveAt: "2026-09-02T00:00:00.000Z" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected").reason.code).toBe(WIKI_LEDGER_CONFLICT_CODE);
    expect(backends.ledgerState.events).toHaveLength(1);
  });

  it("recovers an idempotent commit after ledger response loss", async () => {
    const backends = durableBackends();
    const persisted = adapter(backends);
    let request;
    const wrapped = { ...persisted.maintainerPorts({ resolveEvidence: async (ref) => evidence(ref, ref),
      derive: async () => ({ operations: [operation()] }) }),
      commitRevision: (input) => { request = input; return persisted.commitRevision(input); } };
    const control = new EvidenceBackedWikiMaintainer({ descriptor: { tenantId: "tenant-a", evolutionRunId: "run-1",
      maintainerModel: "provider:model-v1", rulesDigest: hash("rules") },
      policy: { trustedProjectionRead: true, rawEvidenceRead: false, activeSkillWrite: false, shell: false, network: false, secretRead: false },
      ports: wrapped });
    backends.ledgerState.failAfterAppend = true;
    await expect(control.maintain({ evidenceRefs: ["ev-1", "ev-2"], effectiveAt: "2026-09-02T00:00:00.000Z" })).rejects.toThrow(/response loss/);
    expect(persisted.commitRevision(request)).toMatchObject({ committed: true, recovered: true });
    expect(backends.ledgerState.events).toHaveLength(1);
  });

  it("rejects an unbranded resolver before it can substitute stored bytes", async () => {
    const backends = durableBackends();
    await maintainer(adapter(backends)).maintain({ evidenceRefs: ["ev-1", "ev-2"], effectiveAt: "2026-09-02T00:00:00.000Z" });
    const tamperedResolver = (request) => ({ ...backends.resolver(request), bytes: Buffer.from("{}") });
    expect(() => new WikiMaintainerLedgerAdapter({ descriptor, artifactPorts: backends.artifactPorts,
      ledger: backends.ledger, ledgerArtifactResolver: tamperedResolver })).toThrow(/branded/);
  });

  it("uses the EvolutionLedger head CAS so unrelated concurrent appends cannot be hidden", async () => {
    const backends = durableBackends();
    backends.ledgerState.beforeAppend = () => {
      backends.ledgerState.beforeAppend = null;
      backends.ledgerState.events.push({ schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA, sequence: 1,
        eventDigest: hash("other"), type: "other.event", tenantId: "tenant-a", correlationId: null });
    };
    await expect(maintainer(adapter(backends)).maintain({ evidenceRefs: ["ev-1", "ev-2"],
      effectiveAt: "2026-09-02T00:00:00.000Z" })).rejects.toMatchObject({ code: "CC_EVOLUTION_LEDGER_HEAD_CONFLICT" });
    expect(backends.ledgerState.events.filter((event) => event.type === "wiki.revision.committed")).toHaveLength(0);
  });
});
