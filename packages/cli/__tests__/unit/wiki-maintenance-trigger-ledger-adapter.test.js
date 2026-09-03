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
import { WikiMaintainerLedgerAdapter } from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import {
  WIKI_MAINTENANCE_REQUEST_EVENT_TYPE,
  WIKI_MAINTENANCE_SETTLED_EVENT_TYPE,
  WIKI_MAINTENANCE_TRIGGER_KIND,
  WikiMaintenanceTriggerLedgerAdapter,
} from "../../src/lib/evolution/wiki-maintenance-trigger-ledger-adapter.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

const descriptor = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a",
  streamId: "wiki-maintenance-stream",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
};
const LEDGER_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/wiki-trigger-ledger",
  trustPolicyDigest: hash("wiki-trigger-ledger-trust"),
};
const WITNESS_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/wiki-trigger-witness",
  trustPolicyDigest: hash("wiki-trigger-witness-trust"),
};
const EMPTY_DISCARD_DIGEST = hash(
  `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
);

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest ?? null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      previous?.discardAccumulatorDigest ?? EMPTY_DISCARD_DIGEST,
    epoch: snapshot?.epoch ?? null,
    generation: previous ? previous.generation + 1 : 0,
    headDigest: snapshot?.headDigest ?? null,
    identityDigest: snapshot?.identityDigest ?? null,
    ledgerId: snapshot?.ledgerId ?? null,
    payloadDigest: snapshot?.payloadDigest ?? null,
    previousWitnessDigest: previous?.witnessDigest ?? null,
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest ?? null,
    sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent",
    storeMarkerDigest: snapshot?.storeMarkerDigest ?? null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest ?? null,
    storeMarkerId: snapshot?.storeMarkerId ?? null,
    witnessId,
  };
  return {
    ...core,
    witnessDigest: hash(
      `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`,
    ),
    signature: { ...WITNESS_TRUST, value: "A".repeat(43) },
  };
}

function durableWitness(witnessId) {
  let current = witnessRecord(witnessId);
  return {
    id: witnessId,
    read: () => current,
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
    proveAncestry: () => {
      throw new Error("unexpected ancestry request in linear trigger test");
    },
  };
}

function durableFilesystem() {
  const directoryDescriptors = new Set();
  let nextDirectoryDescriptor = -20_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(fileDescriptor) {
      if (directoryDescriptors.delete(fileDescriptor)) return;
      return fs.closeSync(fileDescriptor);
    },
    fsyncSync(fileDescriptor) {
      if (directoryDescriptors.has(fileDescriptor)) return;
      try {
        return fs.fsyncSync(fileDescriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(fileDescriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
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
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-wiki-trigger-"),
  );
  roots.push(root);
  const now = Date.parse("2026-09-03T00:00:00.000Z");
  const secret = "test-only-wiki-trigger-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/wiki-trigger";
  const policyDigest = hash("wiki-trigger-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: descriptor.audience,
    tenantId: descriptor.artifactTenantId,
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now).toISOString(),
          decisionExpiresAt: new Date(now + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: hash(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const putCanonical = vi.fn((...args) => artifactPorts.putCanonical(...args));
  const state = { events: [], failAfterTypes: new Set() };
  const ledger = {
    read: vi.fn(() => structuredClone(state.events)),
    verify: vi.fn(() => ({
      epoch: "epoch-a",
      ledgerId: "ledger-a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    })),
    appendDomainEvent: vi.fn((input, options) => {
      const previous = state.events.at(-1);
      if (
        options.expectedSequence !== state.events.length ||
        options.expectedHeadDigest !== (previous?.eventDigest ?? null)
      ) {
        const error = new Error("ledger head conflict");
        error.code = "CC_EVOLUTION_LEDGER_HEAD_CONFLICT";
        throw error;
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: hash(input),
      };
      state.events.push(event);
      if (state.failAfterTypes.delete(input.type)) {
        throw new Error(`simulated ${input.type} response loss`);
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: hash(event),
      };
    }),
  };
  return {
    artifactPorts: { putCanonical },
    ledger,
    resolver: artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: descriptor.purpose,
    }),
    putCanonical,
    state,
    root,
  };
}

function openRealLedger(storage, witness) {
  const secret = "test-only-real-wiki-trigger-ledger-key";
  return new EvolutionLedger({
    rootDir: path.join(storage.root, "ledger-events"),
    authorityRootDir: path.join(storage.root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => Date.parse("2026-09-03T00:00:00.000Z"),
    random: () => randomBytes(16).toString("hex"),
    trust: LEDGER_TRUST,
    witnessTrust: WITNESS_TRUST,
    witness,
    artifactResolver: storage.resolver,
    sign: ({ message }) => ({
      ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url"),
    }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
}

function evidence(ref = "evidence://session/1") {
  const value = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: descriptor.tenantId,
    ref,
    sourceDigest: hash(`source:${ref}`),
    projectionDigest: hash(`projection:${ref}`),
    artifactRef: `artifact://${ref}`,
    trustedProjection: true,
    trustDomain: "agent-runtime",
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-09-03T00:00:00.000Z",
    expiresAt: null,
    data: { outcome: "verified" },
  };
  return { ...value, envelopeDigest: hash(value) };
}

function composition({
  sourceVerifier,
  maintainer: maintainerOverride,
  storage: storageOverride,
  ledger: ledgerOverride,
} = {}) {
  const storage = storageOverride ?? backends();
  const ledger = ledgerOverride ?? storage.ledger;
  const wikiAdapter = new WikiMaintainerLedgerAdapter({
    descriptor: {
      ...descriptor,
      evolutionRunId: "wiki-maintainer-stream",
    },
    artifactPorts: storage.artifactPorts,
    ledger,
    ledgerArtifactResolver: storage.resolver,
  });
  const trustedEvidence = evidence();
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor: {
      tenantId: descriptor.tenantId,
      evolutionRunId: "wiki-maintainer-stream",
      maintainerModel: "provider:maintainer-v1",
      rulesDigest: hash("maintainer-rules"),
    },
    policy: {
      trustedProjectionRead: true,
      rawEvidenceRead: false,
      activeSkillWrite: false,
      shell: false,
      network: false,
      secretRead: false,
    },
    ports: wikiAdapter.maintainerPorts({
      resolveEvidence: async (ref) =>
        ref === trustedEvidence.ref ? trustedEvidence : null,
      derive: async () => ({ operations: [] }),
    }),
  });
  const verifier = sourceVerifier ?? {
    verify: vi.fn(async (request) => ({
      authenticated: true,
      durable: true,
      tenantId: request.tenantId,
      kind: request.kind,
      sourceId: request.sourceId,
      evidenceRefs: request.evidenceRefs,
      effectiveAt: request.effectiveAt,
      receiptDigest: request.sourceReceiptDigest,
    })),
  };
  const triggerAdapter = new WikiMaintenanceTriggerLedgerAdapter({
    descriptor,
    artifactPorts: storage.artifactPorts,
    ledger,
    ledgerArtifactResolver: storage.resolver,
    sourceVerifier: verifier,
    maintainer: maintainerOverride ?? maintainer,
    now: () => Date.parse("2026-09-03T00:00:01.000Z"),
  });
  return {
    storage,
    wikiAdapter,
    maintainer,
    sourceVerifier: verifier,
    triggerAdapter,
    trustedEvidence,
  };
}

function trigger(kind = WIKI_MAINTENANCE_TRIGGER_KIND.SESSION_END) {
  return {
    kind,
    sourceId: `${kind}:source-1`,
    sourceReceiptDigest: hash(`${kind}:receipt-1`),
    evidenceRefs: ["evidence://session/1"],
    effectiveAt: "2026-09-03T00:00:00.000Z",
  };
}

describe("WikiMaintenanceTriggerLedgerAdapter", () => {
  it("reopens a settled trigger and Wiki revision from real Ledger files and witness", async () => {
    const storage = backends();
    const witness = durableWitness("witness-wiki-maintenance-trigger");
    const firstLedger = openRealLedger(storage, witness);
    const first = composition({ storage, ledger: firstLedger });

    await first.triggerAdapter.enqueue(trigger());
    const processed = await first.triggerAdapter.processNext();

    const reopenedLedger = openRealLedger(storage, witness);
    const reopened = composition({ storage, ledger: reopenedLedger });
    expect(reopened.triggerAdapter.list()).toMatchObject([
      {
        status: "committed",
        request: { requestId: processed.requestId },
        settlement: { revisionId: processed.revisionId },
      },
    ]);
    expect(reopened.wikiAdapter.loadWiki().state).toMatchObject({
      revision: 1,
      maintenanceRequests: {
        [processed.requestId]: { revisionId: processed.revisionId },
      },
    });
    expect(reopenedLedger.verify()).toMatchObject({
      eventCount: 3,
      sequence: 3,
    });
  }, 20_000);

  it("durably queues all three canonical trigger kinds", async () => {
    const { triggerAdapter, sourceVerifier } = composition();

    for (const kind of Object.values(WIKI_MAINTENANCE_TRIGGER_KIND)) {
      await expect(
        triggerAdapter.enqueue(trigger(kind)),
      ).resolves.toMatchObject({
        queued: true,
        recovered: false,
      });
    }

    expect(triggerAdapter.list()).toHaveLength(3);
    expect(triggerAdapter.list().map((entry) => entry.request.kind)).toEqual([
      "session-end",
      "goal-end",
      "scheduled-batch",
    ]);
    expect(sourceVerifier.verify).toHaveBeenCalledTimes(3);
  });

  it("processes a trigger through the real Maintainer and settles its exact revision", async () => {
    const { triggerAdapter, wikiAdapter, storage } = composition();
    const queued = await triggerAdapter.enqueue(trigger());

    const processed = await triggerAdapter.processNext();

    expect(processed).toMatchObject({
      processed: true,
      requestId: queued.requestId,
      recovered: false,
    });
    expect(triggerAdapter.list()[0]).toMatchObject({
      status: "committed",
      settlement: { requestId: queued.requestId, revision: 1 },
    });
    expect(
      wikiAdapter.loadWiki().state.maintenanceRequests[queued.requestId],
    ).toMatchObject({ revision: 1 });
    expect(
      storage.state.events.filter(
        (event) => event.type === WIKI_MAINTENANCE_REQUEST_EVENT_TYPE,
      ),
    ).toHaveLength(1);
    expect(
      storage.state.events.filter(
        (event) => event.type === WIKI_MAINTENANCE_SETTLED_EVENT_TYPE,
      ),
    ).toHaveLength(1);
  });

  it("recovers without a duplicate revision after a crash before settlement", async () => {
    const base = composition();
    let failAfterMaintain = true;
    const crashingMaintainer = {
      maintain: async (input) => {
        const result = await base.maintainer.maintain(input);
        if (failAfterMaintain) {
          failAfterMaintain = false;
          throw new Error("simulated crash after Wiki commit");
        }
        return result;
      },
    };
    const triggerAdapter = new WikiMaintenanceTriggerLedgerAdapter({
      descriptor,
      artifactPorts: base.storage.artifactPorts,
      ledger: base.storage.ledger,
      ledgerArtifactResolver: base.storage.resolver,
      sourceVerifier: base.sourceVerifier,
      maintainer: crashingMaintainer,
      now: () => Date.parse("2026-09-03T00:00:01.000Z"),
    });
    await triggerAdapter.enqueue(trigger());

    await expect(triggerAdapter.processNext()).rejects.toThrow(
      /crash after Wiki commit/,
    );
    expect(triggerAdapter.list()[0].status).toBe("pending");
    await expect(triggerAdapter.processNext()).resolves.toMatchObject({
      processed: true,
      recovered: true,
    });

    expect(base.wikiAdapter.loadWiki().state.revision).toBe(1);
    expect(
      base.storage.state.events.filter(
        (event) => event.type === "wiki.revision.committed",
      ),
    ).toHaveLength(1);
  });

  it("recovers a settlement when the ledger response is lost", async () => {
    const { triggerAdapter, storage } = composition();
    await triggerAdapter.enqueue(trigger());
    storage.state.failAfterTypes.add(WIKI_MAINTENANCE_SETTLED_EVENT_TYPE);

    await expect(triggerAdapter.processNext()).resolves.toMatchObject({
      processed: true,
      recovered: true,
    });
    expect(triggerAdapter.list()[0].status).toBe("committed");
    expect(
      storage.state.events.filter(
        (event) => event.type === WIKI_MAINTENANCE_SETTLED_EVENT_TYPE,
      ),
    ).toHaveLength(1);
  });

  it("deduplicates a retried request after an enqueue response loss", async () => {
    const { triggerAdapter, storage } = composition();
    storage.state.failAfterTypes.add(WIKI_MAINTENANCE_REQUEST_EVENT_TYPE);

    const first = await triggerAdapter.enqueue(trigger());
    const retried = await triggerAdapter.enqueue(trigger());

    expect(first).toMatchObject({ queued: true, recovered: true });
    expect(retried).toMatchObject({
      queued: true,
      recovered: true,
      requestId: first.requestId,
    });
    expect(
      storage.state.events.filter(
        (event) => event.type === WIKI_MAINTENANCE_REQUEST_EVENT_TYPE,
      ),
    ).toHaveLength(1);
  });

  it("rejects an unauthenticated trigger source before persistence", async () => {
    const sourceVerifier = { verify: vi.fn(async () => ({ durable: false })) };
    const { triggerAdapter, storage } = composition({ sourceVerifier });

    await expect(triggerAdapter.enqueue(trigger())).rejects.toThrow(
      /not durably authenticated/,
    );
    expect(storage.putCanonical).not.toHaveBeenCalled();
    expect(storage.state.events).toHaveLength(0);
  });

  it("revalidates trigger authority before processing and honors revocation", async () => {
    let allowed = true;
    const sourceVerifier = {
      verify: vi.fn(async (request) =>
        allowed
          ? {
              authenticated: true,
              durable: true,
              tenantId: request.tenantId,
              kind: request.kind,
              sourceId: request.sourceId,
              evidenceRefs: request.evidenceRefs,
              effectiveAt: request.effectiveAt,
              receiptDigest: request.sourceReceiptDigest,
            }
          : { authenticated: false, durable: false },
      ),
    };
    const { triggerAdapter, storage } = composition({ sourceVerifier });
    await triggerAdapter.enqueue(trigger());
    allowed = false;

    await expect(triggerAdapter.processNext()).rejects.toThrow(
      /not durably authenticated/,
    );
    expect(triggerAdapter.list()[0].status).toBe("pending");
    expect(
      storage.state.events.filter(
        (event) => event.type === "wiki.revision.committed",
      ),
    ).toHaveLength(0);
  });

  it("refuses to settle a result that does not match the committed Wiki revision", async () => {
    const base = composition();
    const substitutingMaintainer = {
      maintain: async (input) => ({
        ...(await base.maintainer.maintain(input)),
        stateDigest: hash("substituted-state"),
      }),
    };
    const triggerAdapter = new WikiMaintenanceTriggerLedgerAdapter({
      descriptor,
      artifactPorts: base.storage.artifactPorts,
      ledger: base.storage.ledger,
      ledgerArtifactResolver: base.storage.resolver,
      sourceVerifier: base.sourceVerifier,
      maintainer: substitutingMaintainer,
      now: () => Date.parse("2026-09-03T00:00:01.000Z"),
    });
    await triggerAdapter.enqueue(trigger());

    await expect(triggerAdapter.processNext()).rejects.toThrow(
      /does not match its committed revision/,
    );
    expect(
      base.storage.state.events.filter(
        (event) => event.type === WIKI_MAINTENANCE_SETTLED_EVENT_TYPE,
      ),
    ).toHaveLength(0);
  });
});
