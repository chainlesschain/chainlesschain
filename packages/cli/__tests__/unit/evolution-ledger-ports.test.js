import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
  EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
  EVOLUTION_LEDGER_PORTS_INVALID_CODE,
  createEvolutionLedgerDurableArtifactResolver,
  createEvolutionLedgerPorts,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  SKILL_MUTATION_AUDIT_SCHEMA,
  SKILL_MUTATION_CONSUMPTION_RECEIPT_SCHEMA,
  SKILL_MUTATION_NONCE_CLAIM_SCHEMA,
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_PRINCIPAL_SCHEMA,
  SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationConsumeContext,
  buildSkillMutationRequest,
  digestSkillMutationReceiptEnvelope,
} from "../../src/lib/evolution/skill-mutation-authority.js";
import {
  SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
  SKILL_RELEASE_STATE_LEDGER_MIGRATION_SCHEMA,
  SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA,
  SKILL_RELEASE_STATE_MIGRATION_RECEIPT_SCHEMA,
  SKILL_RELEASE_STATE_SCHEMA,
} from "../../src/lib/evolution/skill-release-registry.js";

const ARTIFACT_SECRET = "test-only-ledger-ports-artifact-secret";
const LEDGER_SECRET = "test-only-ledger-ports-ledger-secret";
const WITNESS_SECRET = "test-only-ledger-ports-witness-secret";
const ARTIFACT_KEY_ID = "test:key/evolution-ledger-ports-artifacts";
const ARTIFACT_ROTATED_KEY_ID =
  "test:key/evolution-ledger-ports-artifacts-rotated";
const AUDIENCE = "evolution-runtime";
const ARTIFACT_TENANT_ID = "artifact-tenant-a";
const PURPOSE = "evolution-ledger";
// A successful adapter append performs one preflight read; EvolutionLedger
// performs append-preflight and persisted-recovery reads; verifyReceipt performs
// the fourth. The removed post-append query/snapshot would make this five.
const VERIFIED_APPEND_MAX_HEAD_READS = 4;
const RELEASE_INTENT_SCHEMA =
  "chainlesschain.skill-release-transition-intent/v2";
const AUTHORITY_DOMAIN =
  "chainlesschain.evolution-artifact-authority-decision/v1\0";
const TRUST = Object.freeze({
  algorithm: "hmac-sha256",
  keyId: "key://tests/evolution-ledger-ports",
  trustPolicyDigest: digestBytes("ledger-ports-trust-policy"),
});
const WITNESS_TRUST = Object.freeze({
  algorithm: "hmac-sha256",
  keyId: "key://tests/evolution-ledger-ports-witness",
  trustPolicyDigest: digestBytes("ledger-ports-witness-policy"),
});
const EMPTY_DISCARD_ACCUMULATOR_DIGEST = digestBytes(
  Buffer.from(
    `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonicalJson([])}`,
    "utf8",
  ),
);

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function domainDigest(domain, value) {
  return digestBytes(Buffer.from(`${domain}${canonicalJson(value)}`, "utf8"));
}

function hmac(message, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64url");
}

function signedWitness(witnessId, snapshot = null, transition = {}) {
  const previousWitnessDigest = snapshot
    ? transition.previousWitnessDigest || signedWitness(witnessId).witnessDigest
    : null;
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest || null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      transition.discardAccumulatorDigest || EMPTY_DISCARD_ACCUMULATOR_DIGEST,
    epoch: snapshot?.epoch || null,
    generation: snapshot ? (transition.generation ?? 1) : 0,
    headDigest: snapshot?.headDigest || null,
    identityDigest: snapshot?.identityDigest || null,
    ledgerId: snapshot?.ledgerId || null,
    payloadDigest: snapshot?.payloadDigest || null,
    previousWitnessDigest,
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest || null,
    sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent",
    storeMarkerDigest: snapshot?.storeMarkerDigest || null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest || null,
    storeMarkerId: snapshot?.storeMarkerId || null,
    witnessId,
  };
  const message = Buffer.from(
    `chainlesschain.evolution-ledger-witness/v1\0${canonicalJson(core)}`,
    "utf8",
  );
  return {
    ...core,
    signature: {
      ...WITNESS_TRUST,
      value: hmac(message, WITNESS_SECRET),
    },
    witnessDigest: digestBytes(message),
  };
}

function discardAccumulator(previous, discard) {
  return domainDigest(
    "chainlesschain.evolution-witness-discard-accumulator/v1\0",
    {
      discard,
      previousDiscardAccumulatorDigest: previous.discardAccumulatorDigest,
      previousWitnessDigest: previous.witnessDigest,
    },
  );
}

function advancedWitness(previous, snapshot, discard = null) {
  return signedWitness(previous.witnessId, snapshot, {
    discardAccumulatorDigest: discard
      ? discardAccumulator(previous, discard)
      : previous.discardAccumulatorDigest,
    generation: previous.generation + 1,
    previousWitnessDigest: previous.witnessDigest,
  });
}

function signedAncestry(witnessId, ancestor, descendant) {
  const core = {
    ...WITNESS_TRUST,
    ancestorDigest: ancestor.witnessDigest,
    ancestorGeneration: ancestor.generation,
    authenticated: true,
    descendantDigest: descendant.witnessDigest,
    descendantGeneration: descendant.generation,
    durable: true,
    epoch: ancestor.epoch,
    included: true,
    ledgerId: ancestor.ledgerId,
    schema: "chainlesschain.evolution-ledger-witness-ancestry/v1",
    witnessId,
  };
  const message = Buffer.from(
    `chainlesschain.evolution-ledger-witness-ancestry/v1\0${canonicalJson(core)}`,
    "utf8",
  );
  return {
    ...core,
    proofDigest: digestBytes(message),
    signature: {
      ...WITNESS_TRUST,
      value: hmac(message, WITNESS_SECRET),
    },
  };
}

function authorityWitness(witnessId, state) {
  const current = () => state.current || signedWitness(witnessId);
  const remember = (record) => {
    if (
      !state.history.some(
        (entry) => entry.witnessDigest === record.witnessDigest,
      )
    ) {
      state.history.push(structuredClone(record));
    }
  };
  remember(current());
  return {
    id: witnessId,
    read: vi.fn(current),
    initialize: vi.fn(({ expected, snapshot }) => {
      const existing = current();
      if (existing.witnessDigest !== expected.witnessDigest) return existing;
      state.current = advancedWitness(existing, snapshot);
      remember(state.current);
      return state.current;
    }),
    compareAndSwap: vi.fn(({ discard, expected, next }) => {
      const existing = current();
      if (existing.witnessDigest !== expected.witnessDigest) return existing;
      if (
        !discard &&
        state.discards.some(
          (entry) =>
            entry.anchorDigest === next.anchorDigest ||
            entry.headDigest === next.headDigest ||
            entry.segmentDigest === next.segmentDigest,
        )
      ) {
        return existing;
      }
      if (
        discard &&
        !state.discards.some(
          (entry) => entry.anchorDigest === discard.anchorDigest,
        )
      ) {
        state.discards.push(structuredClone(discard));
      }
      state.current = advancedWitness(existing, next, discard);
      remember(state.current);
      return state.current;
    }),
    proveAncestry: vi.fn(({ ancestor, descendant }) => {
      const ancestorIndex = state.history.findIndex(
        (entry) => entry.witnessDigest === ancestor.witnessDigest,
      );
      const descendantIndex = state.history.findIndex(
        (entry) => entry.witnessDigest === descendant.witnessDigest,
      );
      if (ancestorIndex < 0 || descendantIndex < ancestorIndex) {
        throw new Error("witness ancestry is absent");
      }
      return signedAncestry(witnessId, ancestor, descendant);
    }),
  };
}

function filesystemWith(overrides = {}, readMetrics = null) {
  const directoryDescriptors = new Set();
  const headDescriptors = new Set();
  let nextDirectoryDescriptor = -20_000;
  return {
    ...fs,
    closeSync(descriptor) {
      headDescriptors.delete(descriptor);
      if (directoryDescriptors.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    constants: fs.constants,
    fsyncSync(descriptor) {
      if (directoryDescriptors.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        const descriptor = fs.openSync(target, flags, mode);
        if (
          readMetrics !== null &&
          typeof target === "string" &&
          path.basename(target) === "head-v1.json"
        ) {
          headDescriptors.add(descriptor);
        }
        return descriptor;
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDirectoryDescriptor;
          nextDirectoryDescriptor -= 1;
          directoryDescriptors.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
    readFileSync(target, ...args) {
      if (
        readMetrics !== null &&
        ((typeof target === "number" && headDescriptors.has(target)) ||
          (typeof target === "string" &&
            path.basename(target) === "head-v1.json"))
      ) {
        readMetrics.headReads += 1;
      }
      return fs.readFileSync(target, ...args);
    },
    realpathSync: fs.realpathSync,
    ...overrides,
  };
}

function receiptEnvelopes(suffix) {
  return Object.fromEntries(
    SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
      `${kind}Receipt`,
      `${kind}:signed:${suffix}`,
    ]),
  );
}

function nonceValue(suffix) {
  return digestBytes(`nonce:${suffix}`).slice("sha256:".length, 32);
}

function nonceClaim({
  tenantId = "tenant-a",
  audience = AUDIENCE,
  suffix = "one",
  operationId = `operation:${suffix}`,
  claimedAt = "2026-09-01T10:00:00.000Z",
  expiresAt = "2026-09-01T10:02:00.000Z",
} = {}) {
  const core = {
    audience,
    claimedAt,
    expiresAt,
    nonce: nonceValue(suffix),
    operationId,
    requestDigest: digestBytes(`request:${suffix}`),
    schema: SKILL_MUTATION_NONCE_CLAIM_SCHEMA,
    tenantId,
  };
  return {
    ...core,
    claimDigest: domainDigest(
      "chainlesschain.skill-mutation-nonce-claim/v1\0",
      core,
    ),
  };
}

function deniedAudit() {
  const core = {
    audience: null,
    code: "CC_SKILL_MUTATION_REQUEST_INVALID",
    decision: "deny",
    expectedTargetDigest: null,
    expectedTargetRevision: null,
    expiresAt: null,
    nonce: null,
    occurredAt: "2026-09-01T10:00:00.000Z",
    operation: null,
    operationId: null,
    phase: "authorize",
    principalId: null,
    requestDigest: null,
    role: null,
    schema: SKILL_MUTATION_AUDIT_SCHEMA,
    skillName: null,
    targetScope: null,
    tenantId: null,
    transitionSubjectDigest: null,
  };
  return {
    ...core,
    auditDigest: domainDigest("chainlesschain.skill-mutation-audit/v3\0", core),
  };
}

function artifactId(ref) {
  return ref.slice("cc-evolution-artifact:".length);
}

function subjectValue(store, event) {
  const entry = store.get(artifactId(event.subjectRef.ref));
  return JSON.parse(fs.readFileSync(store.storedPath(entry), "utf8")).value;
}

function trapProxy(target, trapCount) {
  const trap = () => {
    trapCount.count += 1;
    throw new Error("unexpected Proxy trap");
  };
  return new Proxy(target, {
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    ownKeys: trap,
  });
}

describe("EvolutionLedger domain ports", () => {
  let tempRoot;
  let eventRoot;
  let authorityRoot;
  let artifactRoot;
  let nowMs;
  let authorityState;
  let durableArtifacts;
  let witnessState;
  let openInstances;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-evolution-ledger-ports-"),
    );
    eventRoot = path.join(tempRoot, "events");
    authorityRoot = path.join(tempRoot, "authority");
    artifactRoot = path.join(tempRoot, "artifacts");
    nowMs = Date.parse("2026-09-01T10:00:00.000Z");
    authorityState = {
      allowed: true,
      algorithm: "hmac-sha256",
      issuedPolicyTrusted: true,
      keyId: ARTIFACT_KEY_ID,
      policyDigest: digestBytes("artifact-policy-v1"),
      policyRevision: 1,
      revocationRevision: 1,
      revoked: false,
    };
    witnessState = { current: null, discards: [], history: [] };
    durableArtifacts = new Map();
    openInstances = [];
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function artifactDurabilityAuthority() {
    const id = "durability:test-replica";
    const receipt = (binding) => {
      const core = {
        artifactTenantId: binding.artifactTenantId,
        authenticated: true,
        authorityId: id,
        digest: binding.digest,
        durable: true,
        purpose: binding.purpose,
        ref: binding.ref,
        retention: binding.retention,
        schema: EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
        type: binding.type,
      };
      return Object.freeze({
        ...core,
        receiptDigest: domainDigest(
          "chainlesschain.test-evolution-artifact-durability-receipt/v1\0",
          core,
        ),
      });
    };
    return Object.freeze({
      id,
      retain(request) {
        if (
          request.schema !==
            EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA ||
          !Buffer.isBuffer(request.bytes) ||
          digestBytes(request.bytes) !== request.binding.digest
        ) {
          throw new Error("durability retain request is invalid");
        }
        durableArtifacts.set(request.binding.ref, {
          binding: structuredClone(request.binding),
          bytes: Buffer.from(request.bytes),
        });
        return receipt(request.binding);
      },
      resolve(request) {
        if (
          request.schema !==
          EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA
        ) {
          throw new Error("durability resolve request is invalid");
        }
        const retained = durableArtifacts.get(request.ref);
        if (
          !retained ||
          retained.binding.artifactTenantId !== request.artifactTenantId ||
          retained.binding.digest !== request.digest ||
          retained.binding.purpose !== request.purpose ||
          retained.binding.ref !== request.ref ||
          retained.binding.retention !== request.retention ||
          digestBytes(retained.bytes) !== request.digest
        ) {
          throw new Error("durable artifact replica is absent or mismatched");
        }
        return Object.freeze({
          ...receipt(retained.binding),
          bytes: Buffer.from(retained.bytes),
          schema: EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
        });
      },
    });
  }

  function open({ crashHook = null } = {}) {
    const ledgerReadMetrics = { headReads: 0 };
    const store = new ArtifactStore({ dir: artifactRoot, now: () => nowMs });
    const envelopeSigner = {
      sign: vi.fn(({ message }) => ({
        algorithm: authorityState.algorithm,
        keyId: authorityState.keyId,
        value: hmac(
          message,
          authorityState.keyId === ARTIFACT_ROTATED_KEY_ID
            ? `${ARTIFACT_SECRET}:rotated`
            : ARTIFACT_SECRET,
        ),
      })),
    };
    const envelopeVerifier = {
      verify: vi.fn(({ keyId, message, signature }) =>
        Boolean(
          [ARTIFACT_KEY_ID, ARTIFACT_ROTATED_KEY_ID].includes(keyId) &&
          signature.value ===
            hmac(
              message,
              keyId === ARTIFACT_ROTATED_KEY_ID
                ? `${ARTIFACT_SECRET}:rotated`
                : ARTIFACT_SECRET,
            ),
        ),
      ),
    };
    const currentAuthorityResolver = {
      resolve: vi.fn((request) => {
        const core = {
          action: request.action,
          algorithm: authorityState.algorithm,
          allowed: authorityState.allowed,
          audience: request.audience,
          checkedAt: new Date(nowMs).toISOString(),
          decisionExpiresAt: new Date(nowMs + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: authorityState.issuedPolicyTrusted,
          keyId: request.keyId || authorityState.keyId,
          policyDigest: authorityState.policyDigest,
          policyRevision: authorityState.policyRevision,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: authorityState.revocationRevision,
          revoked: authorityState.revoked,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: domainDigest(AUTHORITY_DOMAIN, core),
        };
      }),
    };
    const artifactPorts = new EvolutionArtifactPorts({
      artifactStore: store,
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: ARTIFACT_TENANT_ID,
    });
    const durabilityAuthority = artifactDurabilityAuthority();
    const witnessId = `witness-${digestBytes(authorityRoot).slice(7)}`;
    const ledger = new EvolutionLedger({
      artifactResolver: createEvolutionLedgerDurableArtifactResolver({
        artifactDurabilityAuthority: durabilityAuthority,
        artifactPorts,
        artifactTenantId: ARTIFACT_TENANT_ID,
        purpose: PURPOSE,
      }),
      authorityRootDir: authorityRoot,
      clock: () => nowMs,
      crashHook,
      fsImpl: filesystemWith({}, ledgerReadMetrics),
      rootDir: eventRoot,
      secure: false,
      sign: ({ message }) => ({
        ...TRUST,
        value: hmac(message, LEDGER_SECRET),
      }),
      trust: TRUST,
      verifySignature: ({ message, signature }) =>
        signature.algorithm === TRUST.algorithm &&
        signature.keyId === TRUST.keyId &&
        signature.trustPolicyDigest === TRUST.trustPolicyDigest &&
        signature.value === hmac(message, LEDGER_SECRET),
      verifyWitnessSignature: ({ message, signature }) =>
        signature.algorithm === WITNESS_TRUST.algorithm &&
        signature.keyId === WITNESS_TRUST.keyId &&
        signature.trustPolicyDigest === WITNESS_TRUST.trustPolicyDigest &&
        signature.value === hmac(message, WITNESS_SECRET),
      witness: authorityWitness(witnessId, witnessState),
      witnessTrust: WITNESS_TRUST,
    });
    const ports = createEvolutionLedgerPorts({
      artifactDurabilityAuthority: durabilityAuthority,
      artifactPorts,
      artifactTenantId: ARTIFACT_TENANT_ID,
      audience: AUDIENCE,
      ledger,
      purpose: PURPOSE,
    });
    const opened = {
      artifactPorts,
      currentAuthorityResolver,
      ledger,
      ledgerReadMetrics,
      ports,
      store,
    };
    openInstances.push(opened);
    return opened;
  }

  function mutationAuthority(ports) {
    return new SkillMutationAuthority({
      auditSink: ports.auditSink,
      nonceStore: ports.nonceStore,
      now: () => new Date(nowMs),
      principalResolver: {
        async resolve({ request }) {
          return {
            authenticated: true,
            audience: request.audience,
            expiresAt: request.expiresAt,
            operation: request.operation,
            operationId: request.operationId,
            principalId: "principal:promotion-controller",
            requestDigest: request.requestDigest,
            role: SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
            schema: SKILL_MUTATION_PRINCIPAL_SCHEMA,
            tenantId: request.tenantId,
            transitionSubjectDigest: request.transitionSubjectDigest,
          };
        },
      },
      receiptVerifier: {
        async verify({ principal, receipts, request }) {
          return {
            bindings: Object.fromEntries(
              SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
                kind,
                {
                  ...request,
                  kind,
                  principalId: principal.principalId,
                  receiptDigest: digestSkillMutationReceiptEnvelope(
                    receipts[`${kind}Receipt`],
                  ),
                  role: principal.role,
                  schema: SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
                },
              ]),
            ),
            schema: SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
            verified: true,
          };
        },
      },
    });
  }

  async function consumeMutation(
    ports,
    {
      tenantId = "tenant-a",
      skillName = "repair-unit-tests",
      suffix = "one",
      operation = SKILL_MUTATION_OPERATIONS.PROMOTE,
      expectedTargetDigest = digestBytes(`active:${suffix}`),
      expectedTargetRevision = 0,
      transitionSubjectDigest = digestBytes(`transition:${suffix}`),
    } = {},
  ) {
    const request = buildSkillMutationRequest({
      audience: AUDIENCE,
      expectedTargetDigest,
      expectedTargetRevision,
      expiresAt: new Date(nowMs + 120_000).toISOString(),
      nonce: nonceValue(suffix),
      operation,
      operationId: `operation:${suffix}`,
      receipts: receiptEnvelopes(suffix),
      skillName,
      targetScope: SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
      tenantId,
      transitionSubjectDigest,
    });
    const authority = mutationAuthority(ports);
    const capability = await authority.authorize(request);
    const receipt = await authority.consume(
      capability,
      buildSkillMutationConsumeContext({
        audience: request.audience,
        expectedTargetDigest: request.expectedTargetDigest,
        expectedTargetRevision: request.expectedTargetRevision,
        expiresAt: request.expiresAt,
        nonce: request.nonce,
        operation: request.operation,
        operationId: request.operationId,
        skillName: request.skillName,
        targetScope: request.targetScope,
        tenantId: request.tenantId,
        transitionSubjectDigest: request.transitionSubjectDigest,
      }),
    );
    return { receipt, request };
  }

  function releaseIntent(
    consumed,
    {
      suffix = "one",
      previousStateDigest = null,
      stateDigest = digestBytes(`state:${suffix}`),
      candidateId = consumed.request.operation ===
      SKILL_MUTATION_OPERATIONS.ROLLBACK
        ? null
        : digestBytes(`candidate:${suffix}`),
    } = {},
  ) {
    const transactionId = digestBytes(`transaction:${suffix}`);
    const core = {
      authorityReceipt: consumed.receipt,
      authorityReceiptDigest: consumed.receipt.receiptDigest,
      candidateId,
      dependencyLockDigest: digestBytes(`dependency-lock:${suffix}`),
      expectedParentDigest: consumed.request.expectedTargetDigest,
      expectedRevision: consumed.request.expectedTargetRevision,
      mutationRequest: consumed.request,
      nextStateDigest: stateDigest,
      operation: consumed.request.operation,
      operationId: consumed.request.operationId,
      pointerDigest: stateDigest,
      previousStateDigest,
      receiptDigests: Object.fromEntries(
        SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
          kind,
          digestSkillMutationReceiptEnvelope(
            consumed.request.receipts[`${kind}Receipt`],
          ),
        ]),
      ),
      requestDigest: consumed.request.requestDigest,
      schema: RELEASE_INTENT_SCHEMA,
      skillName: consumed.request.skillName,
      targetReleaseDigest: digestBytes(`release:${suffix}`),
      transactionId,
      transitionSubjectDigest: consumed.request.transitionSubjectDigest,
    };
    return {
      ...core,
      intentDigest: domainDigest(`${RELEASE_INTENT_SCHEMA}\0`, core),
    };
  }

  function finalization(intent) {
    return {
      authorityReceiptDigest: intent.authorityReceiptDigest,
      expectedPrepareReceiptDigest: null,
      intentDigest: intent.intentDigest,
      pointerDigest: intent.pointerDigest,
      revision: intent.expectedRevision + 1,
      skillName: intent.skillName,
      stateDigest: intent.nextStateDigest,
      transactionId: intent.transactionId,
    };
  }

  function stateMigration(suffix = "legacy") {
    const planCore = {
      activeReleaseDigest: digestBytes(`active:${suffix}`),
      activeReleaseMigrationDigest: digestBytes(`active-migration:${suffix}`),
      activeReleaseMigrationReceiptDigest: digestBytes(
        `active-migration-receipt:${suffix}`,
      ),
      dependencyLockDigest: digestBytes(`dependency-lock:${suffix}`),
      lastKnownGoodReleaseDigest: digestBytes(`lkg:${suffix}`),
      lastKnownGoodReleaseMigrationDigest: digestBytes(
        `lkg-migration:${suffix}`,
      ),
      lastKnownGoodReleaseMigrationReceiptDigest: digestBytes(
        `lkg-migration-receipt:${suffix}`,
      ),
      legacyActiveReleaseDigest: digestBytes(`legacy-active:${suffix}`),
      legacyFence: 11,
      legacyLastKnownGoodReleaseDigest: digestBytes(`legacy-lkg:${suffix}`),
      legacyRevision: 3,
      legacyStateDigest: digestBytes(`legacy-state:${suffix}`),
      legacyTransactionId: digestBytes(`legacy-transaction:${suffix}`),
      requiresAuthenticatedLedgerMigration: true,
      schema: SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA,
      skillName: "repair-unit-tests",
      tenantId: "tenant-a",
    };
    const plan = {
      ...planCore,
      stateMigrationDigest: domainDigest(
        `${SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA}\0`,
        planCore,
      ),
    };
    const stateCore = {
      activeReleaseDigest: plan.activeReleaseDigest,
      authorityReceiptDigest: digestBytes(`active-authority:${suffix}`),
      dependencyLockDigest: plan.dependencyLockDigest,
      fence: plan.legacyFence,
      lastKnownGoodReleaseDigest: plan.lastKnownGoodReleaseDigest,
      revision: plan.legacyRevision,
      schema: SKILL_RELEASE_STATE_SCHEMA,
      skillName: plan.skillName,
      tenantId: plan.tenantId,
      transactionId: plan.stateMigrationDigest,
    };
    const state = {
      ...stateCore,
      stateDigest: domainDigest(`${SKILL_RELEASE_STATE_SCHEMA}\0`, stateCore),
    };
    const receipt = {
      schema: SKILL_RELEASE_STATE_MIGRATION_RECEIPT_SCHEMA,
      authenticated: true,
      durable: true,
      authorityId: "authority:state-migration",
      trust: "trusted",
      handlerArtifactDigest: digestBytes("state-migration-handler:v1"),
      stateMigrationDigest: plan.stateMigrationDigest,
      receiptDigest: digestBytes(
        `state-migration-receipt:${plan.stateMigrationDigest}`,
      ),
    };
    return {
      plan,
      receipt,
      schema: SKILL_RELEASE_STATE_LEDGER_MIGRATION_SCHEMA,
      state,
    };
  }

  async function preparedTransition(instance, options = {}) {
    const consumed = await consumeMutation(instance.ports, options);
    const intent = releaseIntent(consumed, options);
    const headReadsBeforePrepare = instance.ledgerReadMetrics.headReads;
    const prepared = instance.ports.transactionLedger.prepare(intent);
    const prepareHeadReads =
      instance.ledgerReadMetrics.headReads - headReadsBeforePrepare;
    const finalize = finalization(intent);
    finalize.expectedPrepareReceiptDigest = prepared.receiptDigest;
    return { consumed, finalize, intent, prepareHeadReads, prepared };
  }

  it("uses one captured ledger for exact prepare/finalize subjects and stable idempotent projections", async () => {
    const instance = open();
    const transition = await preparedTransition(instance, { suffix: "stable" });

    expect(Object.isFrozen(instance.ports)).toBe(true);
    expect(Object.isFrozen(instance.ports.transactionLedger)).toBe(true);
    expect(instance.ports.transactionLedger.prepare(transition.intent)).toEqual(
      transition.prepared,
    );
    const committed = instance.ports.transactionLedger.finalize(
      transition.finalize,
    );
    expect(
      instance.ports.transactionLedger.finalize(transition.finalize),
    ).toEqual(committed);
    expect(
      instance.ports.transactionLedger.query(transition.intent.transactionId),
    ).toEqual(committed);
    expect(committed).toMatchObject({
      authenticated: true,
      current: true,
      durable: true,
      epoch: expect.any(String),
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "committed",
    });
    expect(committed.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const releaseEvents = instance.ledger
      .read({ afterSequence: 0, limit: 100 })
      .filter((event) => event.type.startsWith("skill.release."));
    expect(releaseEvents.map((event) => event.type)).toEqual([
      "skill.release.prepare",
      "skill.release.finalize",
    ]);
    expect(releaseEvents[0].sourceRefs).toHaveLength(1);
    expect(releaseEvents[1].sourceRefs).toEqual([releaseEvents[0].subjectRef]);
    for (const event of releaseEvents) {
      expect(event.schema).toBe(EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA);
      expect(event).not.toHaveProperty("candidateRef");
      expect(event).not.toHaveProperty("diffRef");
      expect(event.reason).not.toBe(event.subjectRef.digest);
    }

    const reopened = open();
    expect(
      reopened.ports.transactionLedger.query(transition.intent.transactionId),
    ).toEqual(committed);
  });

  it("commits one authenticated legacy state baseline and extends it with normal finalize lineage", async () => {
    const instance = open();
    const migration = stateMigration();
    const migrated = instance.ports.transactionLedger.migrate(migration);

    expect(instance.ports.transactionLedger.migrate(migration)).toEqual(
      migrated,
    );
    expect(() =>
      instance.ports.transactionLedger.migrate({
        ...migration,
        receipt: {
          ...migration.receipt,
          receiptDigest: digestBytes("other-state-migration-receipt"),
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_LEDGER_PORTS_COLLISION_CODE }),
    );
    expect(
      instance.ports.transactionLedger.query(
        migration.plan.stateMigrationDigest,
      ),
    ).toEqual(migrated);
    expect(migrated).toMatchObject({
      authenticated: true,
      current: true,
      durable: true,
      intentDigest: migration.plan.stateMigrationDigest,
      pointerDigest: migration.state.stateDigest,
      prepareReceiptDigest: migration.receipt.receiptDigest,
      revision: migration.plan.legacyRevision,
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      stateDigest: migration.state.stateDigest,
      status: "committed",
      transactionId: migration.plan.stateMigrationDigest,
    });

    const next = await preparedTransition(instance, {
      expectedTargetRevision: migration.plan.legacyRevision,
      previousStateDigest: migration.state.stateDigest,
      stateDigest: digestBytes("state:after-migration"),
      suffix: "after-migration",
    });
    const finalized = instance.ports.transactionLedger.finalize(next.finalize);
    expect(finalized).toMatchObject({
      current: true,
      revision: migration.plan.legacyRevision + 1,
    });
    expect(
      instance.ports.transactionLedger.query(
        migration.plan.stateMigrationDigest,
      ).current,
    ).toBe(false);

    const migrationEvent = instance.ledger
      .read({ afterSequence: 0, limit: 100 })
      .find((event) => event.type === "skill.release.state-migration");
    expect(migrationEvent).toMatchObject({
      correlationId: migration.plan.stateMigrationDigest,
      decision: "committed",
      skillName: migration.plan.skillName,
      sourceRefs: [],
      tenantId: migration.plan.tenantId,
    });
    expect(subjectValue(instance.store, migrationEvent)).toEqual(migration);

    const reopened = open();
    expect(
      reopened.ports.transactionLedger.query(next.intent.transactionId),
    ).toEqual(finalized);
    expect(() =>
      reopened.ports.transactionLedger.migrate(stateMigration("collision")),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_LEDGER_PORTS_COLLISION_CODE }),
    );
  }, 180_000);

  it("rejects tampered state migration evidence before appending a ledger event", () => {
    const instance = open();
    const migration = stateMigration("tampered");
    const invalidReceipt = {
      ...migration,
      receipt: { ...migration.receipt, durable: false },
    };
    const invalidState = {
      ...migration,
      state: {
        ...migration.state,
        activeReleaseDigest: digestBytes("forged-active-release"),
      },
    };

    for (const invalid of [invalidReceipt, invalidState]) {
      expect(() =>
        instance.ports.transactionLedger.migrate(invalid),
      ).toThrowError(
        expect.objectContaining({ code: EVOLUTION_LEDGER_PORTS_INVALID_CODE }),
      );
    }
    expect(instance.ledger.read({ afterSequence: 0, limit: 100 })).toEqual([]);
  });

  it("fails closed on transaction collisions and forged consumption audit heads", async () => {
    const instance = open();
    const transition = await preparedTransition(instance, {
      suffix: "collision",
    });
    const changedCore = {
      ...transition.intent,
      targetReleaseDigest: digestBytes("another release"),
    };
    delete changedCore.intentDigest;
    const collision = {
      ...changedCore,
      intentDigest: domainDigest(`${RELEASE_INTENT_SCHEMA}\0`, changedCore),
    };
    expect(() =>
      instance.ports.transactionLedger.prepare(collision),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_LEDGER_PORTS_COLLISION_CODE }),
    );

    const forgedReceiptCore = {
      ...transition.consumed.receipt,
      auditDigest: digestBytes("forged audit"),
      headDigest: digestBytes("forged head"),
      sequence: transition.consumed.receipt.sequence + 100,
    };
    delete forgedReceiptCore.receiptDigest;
    const forgedReceipt = {
      ...forgedReceiptCore,
      receiptDigest: domainDigest(
        `${SKILL_MUTATION_CONSUMPTION_RECEIPT_SCHEMA}\0`,
        forgedReceiptCore,
      ),
    };
    const forgedIntentCore = {
      ...transition.intent,
      authorityReceipt: forgedReceipt,
      authorityReceiptDigest: forgedReceipt.receiptDigest,
      transactionId: digestBytes("forged transaction"),
    };
    delete forgedIntentCore.intentDigest;
    const forgedIntent = {
      ...forgedIntentCore,
      intentDigest: domainDigest(
        `${RELEASE_INTENT_SCHEMA}\0`,
        forgedIntentCore,
      ),
    };
    expect(() =>
      instance.ports.transactionLedger.prepare(forgedIntent),
    ).toThrow();
  });

  it("derives current from contiguous tenant-and-Skill finalize lineages and keeps rollback candidate null", async () => {
    const instance = open();
    const first = await preparedTransition(instance, { suffix: "lineage-one" });
    const firstCommit = instance.ports.transactionLedger.finalize(
      first.finalize,
    );

    const rollback = await preparedTransition(instance, {
      candidateId: null,
      expectedTargetRevision: 1,
      operation: SKILL_MUTATION_OPERATIONS.ROLLBACK,
      previousStateDigest: first.finalize.stateDigest,
      stateDigest: digestBytes("state:lineage-two"),
      suffix: "lineage-two",
    });
    const rollbackCommit = instance.ports.transactionLedger.finalize(
      rollback.finalize,
    );
    expect(
      instance.ports.transactionLedger.query(first.intent.transactionId)
        .current,
    ).toBe(false);
    expect(rollbackCommit.current).toBe(true);

    const otherTenant = await preparedTransition(instance, {
      suffix: "other-tenant",
      tenantId: "tenant-b",
    });
    expect(
      instance.ports.transactionLedger.finalize(otherTenant.finalize).current,
    ).toBe(true);
    expect(
      instance.ports.transactionLedger.query(rollback.intent.transactionId)
        .current,
    ).toBe(true);
    for (const headReads of [
      first.prepareHeadReads,
      rollback.prepareHeadReads,
      otherTenant.prepareHeadReads,
    ]) {
      expect(headReads).toBeGreaterThan(0);
      expect(headReads).toBeLessThanOrEqual(VERIFIED_APPEND_MAX_HEAD_READS);
    }

    const prepareEvent = instance.ledger.findByEventId(
      instance.ledger
        .read({ afterSequence: 0, limit: 100 })
        .find(
          (event) =>
            event.type === "skill.release.prepare" &&
            event.correlationId === rollback.intent.transactionId,
        ).eventId,
    );
    expect(subjectValue(instance.store, prepareEvent).candidateId).toBeNull();

    expect(firstCommit.revision).toBe(1);
  }, 180_000);

  it("rejects a release finalize revision gap without retaining invalid lineage evidence", async () => {
    const instance = open();
    const gap = await preparedTransition(instance, {
      expectedTargetRevision: 3,
      previousStateDigest: digestBytes("missing state"),
      stateDigest: digestBytes("gap state"),
      suffix: "lineage-gap",
    });
    const retainedBeforeFinalize = durableArtifacts.size;
    expect(() =>
      instance.ports.transactionLedger.finalize(gap.finalize),
    ).toThrow();
    expect(durableArtifacts.size).toBe(retainedBeforeFinalize);
  });

  it("retains denied audits with honest nullable event fields and exact acknowledgements", () => {
    const instance = open();
    const audit = deniedAudit();
    const headReadsBeforeAppend = instance.ledgerReadMetrics.headReads;
    const acknowledgement = instance.ports.auditSink.append(audit);
    const appendHeadReads =
      instance.ledgerReadMetrics.headReads - headReadsBeforeAppend;
    expect(appendHeadReads).toBeGreaterThan(0);
    expect(appendHeadReads).toBeLessThanOrEqual(VERIFIED_APPEND_MAX_HEAD_READS);
    expect(instance.ports.auditSink.append(audit)).toEqual(acknowledgement);
    const event = instance.ledger.query(
      { sequence: acknowledgement.sequence },
      { issueReceipt: false },
    ).event;
    expect(acknowledgement).toEqual({
      auditDigest: audit.auditDigest,
      headDigest: event.eventDigest,
      persisted: true,
      sequence: event.sequence,
    });
    expect(event).toMatchObject({
      correlationId: null,
      decision: "rejected",
      skillName: null,
      tenantId: null,
      type: "skill.mutation.audit",
    });
    expect(subjectValue(instance.store, event)).toEqual(audit);

    expect(() =>
      instance.ports.auditSink.append({
        ...audit,
        auditDigest: digestBytes("not the audit"),
      }),
    ).toThrow();
  });

  it("claims a tenant/audience/nonce key once across two adapters and returns replay false", () => {
    const instance = open();
    const secondPorts = createEvolutionLedgerPorts({
      artifactDurabilityAuthority: artifactDurabilityAuthority(),
      artifactPorts: instance.artifactPorts,
      artifactTenantId: ARTIFACT_TENANT_ID,
      audience: AUDIENCE,
      ledger: instance.ledger,
    });
    const claim = nonceClaim({ suffix: "race" });
    const headReadsBeforeClaim = instance.ledgerReadMetrics.headReads;
    const firstOutcome = instance.ports.nonceStore.claim(claim);
    const claimHeadReads =
      instance.ledgerReadMetrics.headReads - headReadsBeforeClaim;
    expect(claimHeadReads).toBeGreaterThan(0);
    expect(claimHeadReads).toBeLessThanOrEqual(VERIFIED_APPEND_MAX_HEAD_READS);
    const outcomes = [firstOutcome, secondPorts.nonceStore.claim(claim)];
    expect(outcomes.map((entry) => entry.claimed).sort()).toEqual([
      false,
      true,
    ]);
    const replay = instance.ports.nonceStore.claim(claim);
    expect(replay.claimed).toBe(false);
    expect(replay.claimDigest).toBe(claim.claimDigest);

    const differentRequestCore = {
      ...claim,
      operationId: "operation:replay",
      requestDigest: digestBytes("request:replay"),
    };
    delete differentRequestCore.claimDigest;
    const differentRequest = {
      ...differentRequestCore,
      claimDigest: domainDigest(
        "chainlesschain.skill-mutation-nonce-claim/v1\0",
        differentRequestCore,
      ),
    };
    const denied = secondPorts.nonceStore.claim(differentRequest);
    expect(denied).toMatchObject({
      claimed: false,
      claimDigest: differentRequest.claimDigest,
      sequence: outcomes[0].sequence,
    });
  });

  it("recovers an exact nonce winner after ledger response loss, then reports replay false", () => {
    let crashOnce = true;
    let headReadsAtCrash = null;
    let instance;
    instance = open({
      crashHook(phase) {
        if (phase === "after-witness" && crashOnce) {
          crashOnce = false;
          headReadsAtCrash = instance.ledgerReadMetrics.headReads;
          throw new Error("simulated response loss after witness CAS");
        }
      },
    });
    const claim = nonceClaim({ suffix: "response-loss" });
    const recovered = instance.ports.nonceStore.claim(claim);
    expect(recovered.claimed).toBe(true);
    expect(headReadsAtCrash).not.toBeNull();
    expect(instance.ledgerReadMetrics.headReads).toBeGreaterThan(
      headReadsAtCrash,
    );
    expect(instance.ports.nonceStore.claim(claim)).toMatchObject({
      claimed: false,
      claimDigest: claim.claimDigest,
      sequence: recovered.sequence,
    });
  });

  it("recovers a missing local artifact from exact durable bytes and fails closed when the replica is absent or changed", async () => {
    const instance = open();
    const transition = await preparedTransition(instance, {
      suffix: "retention",
    });
    const committed = instance.ports.transactionLedger.finalize(
      transition.finalize,
    );
    nowMs += 7 * 24 * 60 * 60 * 1000;
    expect(
      instance.ports.transactionLedger.query(transition.intent.transactionId)
        .receiptDigest,
    ).toBe(committed.receiptDigest);

    const prepareEvent = instance.ledger
      .read({ afterSequence: 0, limit: 100 })
      .find(
        (event) =>
          event.type === "skill.release.prepare" &&
          event.correlationId === transition.intent.transactionId,
      );
    const durableCopy = durableArtifacts.get(prepareEvent.subjectRef.ref);
    instance.store.remove(artifactId(prepareEvent.subjectRef.ref));
    expect(
      instance.ports.transactionLedger.query(transition.intent.transactionId)
        .receiptDigest,
    ).toBe(committed.receiptDigest);

    authorityState.policyDigest = digestBytes("artifact-policy-v2");
    authorityState.policyRevision = 2;
    expect(
      instance.ports.transactionLedger.query(transition.intent.transactionId)
        .receiptDigest,
    ).toBe(committed.receiptDigest);

    durableArtifacts.set(prepareEvent.subjectRef.ref, {
      ...durableCopy,
      bytes: Buffer.from("changed authoritative bytes", "utf8"),
    });
    expect(() =>
      instance.ports.transactionLedger.query(transition.intent.transactionId),
    ).toThrow();
    durableArtifacts.delete(prepareEvent.subjectRef.ref);
    expect(() =>
      instance.ports.transactionLedger.query(transition.intent.transactionId),
    ).toThrow();
  });

  it("rejects Proxy and accessor inputs before invoking their traps", () => {
    const instance = open();
    expect(() =>
      createEvolutionLedgerPorts({
        artifactPorts: instance.artifactPorts,
        artifactTenantId: ARTIFACT_TENANT_ID,
        audience: AUDIENCE,
        ledger: instance.ledger,
      }),
    ).toThrow();
    const trapCount = { count: 0 };
    const proxy = trapProxy({}, trapCount);
    expect(() => createEvolutionLedgerPorts(proxy)).toThrow();
    expect(trapCount.count).toBe(0);

    let getterCalls = 0;
    const audit = deniedAudit();
    Object.defineProperty(audit, "tenantId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return null;
      },
    });
    expect(() => instance.ports.auditSink.append(audit)).toThrow();
    expect(getterCalls).toBe(0);
  });

  it("exposes an exact absent projection without inventing ledger identity fields", () => {
    const instance = open();
    const transactionId = digestBytes("absent transaction");
    expect(instance.ports.transactionLedger.query(transactionId)).toEqual({
      authenticated: true,
      durable: true,
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "absent",
      transactionId,
    });
  });
});
