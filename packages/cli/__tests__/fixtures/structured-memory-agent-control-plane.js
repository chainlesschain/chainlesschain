import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import { createStructuredMemoryAgentControlPlane } from "../../src/lib/evolution/structured-memory-agent-control-plane.js";
import { StructuredMemoryAuthorityLedgerAdapter } from "../../src/lib/evolution/structured-memory-authority-ledger-adapter.js";
import { StructuredMemoryLedgerAdapter } from "../../src/lib/evolution/structured-memory-ledger-adapter.js";
import { createStructuredMemoryPolicyReceiptWriter } from "../../src/lib/evolution/structured-memory-policy-receipt-writer.js";
import { createCliStructuredMemoryPostCompactVerifier } from "../../src/lib/evolution/structured-memory-post-compact-hook.js";
import { createStructuredMemoryPromotionReceiptWriter } from "../../src/lib/evolution/structured-memory-promotion-receipt-writer.js";
import { createStructuredMemorySemanticReviewer } from "../../src/lib/evolution/structured-memory-semantic-review-pipeline.js";

const { createStructuredMemoryAuthority } = structuredMemory;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

export function createStructuredMemoryAgentControlPlaneFixture({ tenantId }) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-memory-agent-root-"),
  );
  const now = Date.parse("2026-09-02T00:00:00.000Z");
  const descriptor = Object.freeze({
    tenantId,
    artifactTenantId: `artifact-${tenantId}`,
    streamId: `memory-${tenantId}`,
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
  });
  const secret = "test-only-memory-agent-root-artifact";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/memory-agent-root";
  const policyDigest = digest("memory-agent-root-policy");
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
      sign: ({ message }) => ({
        algorithm,
        keyId,
        value: sign(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
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
          receiptDigest: digest(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const ledgerState = { events: [], failAfterType: null };
  const ledger = {
    read: () => structuredClone(ledgerState.events),
    verify: () => ({
      epoch: "epoch-memory-agent-root",
      ledgerId: "ledger-memory-agent-root",
      sequence: ledgerState.events.length,
      headDigest: ledgerState.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent(input, expected) {
      const head = ledgerState.events.at(-1)?.eventDigest ?? null;
      if (
        expected.expectedSequence !== ledgerState.events.length ||
        expected.expectedHeadDigest !== head
      ) {
        const error = new Error("head conflict");
        error.code = "CC_EVOLUTION_LEDGER_HEAD_CONFLICT";
        throw error;
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: ledgerState.events.length + 1,
        eventDigest: digest(input),
      };
      ledgerState.events.push(event);
      if (ledgerState.failAfterType === input.type) {
        ledgerState.failAfterType = null;
        throw new Error("simulated durable append response loss");
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: digest(event),
      };
    },
  };
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: descriptor.purpose,
  });
  const actor = (role, actorType = "agent") =>
    createStructuredMemoryAuthority({
      tenantId,
      actorId: `${role}-root-fixture`,
      actorType,
      role,
      authorityDigest: digest(`${tenantId}:${role}:${actorType}`),
    });
  const authorityDescriptor = {
    ...descriptor,
    authorityId: "memory-agent-root-authority",
    authorityRevision: 1,
    handlerDigest: digest("memory-agent-root-authority-handler"),
  };
  const reviewer = (kind) =>
    createStructuredMemorySemanticReviewer({
      descriptor: {
        tenantId,
        kind,
        issuerId: `${kind}-root-fixture`,
        issuerRevision: 1,
        issuerHandlerDigest: digest(`${kind}-root-fixture-handler`),
        verifierId: `${kind}-root-fixture-verifier`,
        verifierRevision: 1,
        verifierHandlerDigest: digest(`${kind}-root-fixture-verifier-handler`),
      },
      producer: {
        review: async () => ({
          decision: "accepted",
          reasonCodes: [`${kind}-accepted`],
        }),
      },
      attestor: {
        attest: async ({ payloadDigest }) => digest(`attest:${payloadDigest}`),
      },
      verifier: {
        verify: async ({ receipt }) =>
          receipt.attestation === digest(`attest:${receipt.receiptDigest}`),
      },
      clock: () => "2026-09-02T00:00:00.000Z",
    });
  const open = () => {
    const authorityAdapter = new StructuredMemoryAuthorityLedgerAdapter({
      descriptor: authorityDescriptor,
      artifactPorts,
      ledger,
      ledgerArtifactResolver: resolver,
      receiptVerifier: {
        verify: async ({ receipt }) =>
          receipt.attestation === digest(`attest:${receipt.receiptDigest}`),
      },
    });
    const postCompactDescriptor = {
      tenantId,
      authorityId: "memory-agent-root-post-compact",
      authorityRevision: 1,
      handlerDigest: digest("memory-agent-root-post-compact-handler"),
    };
    const postCompactVerifier = createCliStructuredMemoryPostCompactVerifier({
      descriptor: postCompactDescriptor,
      hookExecutor: async () => ({
        success: true,
        blocked: false,
        decision: "continue",
        results: [{ status: "success", hookId: "memory-integrity" }],
      }),
      attestor: {
        sign: ({ message }) => ({
          algorithm,
          keyId,
          value: sign(message),
        }),
        verify: ({ message, result }) =>
          result.signature?.value === sign(message),
      },
      clock: () => now,
    });
    const memoryAdapter = new StructuredMemoryLedgerAdapter({
      descriptor,
      artifactPorts,
      ledger,
      ledgerArtifactResolver: resolver,
      postCompactVerifier,
      receiptProvider: authorityAdapter.createReceiptProvider(),
      clock: () => now,
    });
    const writer = (kind, create) =>
      create({
        descriptor: {
          tenantId,
          issuerId: `${kind}-root-writer`,
          issuerRevision: 1,
          issuerHandlerDigest: digest(`${kind}-root-writer-handler`),
        },
        authorityStore: authorityAdapter,
        attestor: {
          attest: async ({ payloadDigest }) =>
            digest(`attest:${payloadDigest}`),
        },
        clock: () => "2026-09-02T00:00:00.000Z",
      });
    return createStructuredMemoryAgentControlPlane({
      memoryAdapter,
      authorityAdapter,
      critic: reviewer("critic"),
      evaluator: reviewer("evaluator"),
      proposerAuthority: actor("child-agent"),
      governorAuthority: actor("governor", "service"),
      promotionAuthority: actor("promotion-controller", "service"),
      promotionReceiptWriter: writer(
        "promotion",
        createStructuredMemoryPromotionReceiptWriter,
      ),
      policyReceiptWriter: writer(
        "policy",
        createStructuredMemoryPolicyReceiptWriter,
      ),
    });
  };
  const controlPlane = open();
  return Object.freeze({
    controlPlane,
    ledgerState,
    open,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  });
}
