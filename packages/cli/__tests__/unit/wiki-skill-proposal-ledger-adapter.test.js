import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import {
  WIKI_SKILL_PROPOSAL_SCHEMA,
  computeWikiSkillProposalDigest,
} from "../../src/lib/evolution/wiki-informed-skill-proposer.js";
import {
  WIKI_SKILL_PROPOSAL_CONFLICT_CODE,
  WIKI_SKILL_PROPOSAL_LEDGER_EVENT,
  WikiSkillProposalLedgerAdapter,
} from "../../src/lib/evolution/wiki-skill-proposal-ledger-adapter.js";

const roots = [];
const now = Date.parse("2026-09-05T00:00:00.000Z");

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

function drafted(summary = "Use the evidence-backed procedure.") {
  const proposal = {
    schema: WIKI_SKILL_PROPOSAL_SCHEMA,
    status: "proposal",
    tenantId: "tenant-a",
    evolutionRunId: "run-1",
    skillName: "safe-refactor",
    purpose: {
      summary,
      patternRefs: ["evidence://pattern/1"],
      sourceEvidenceRefs: ["evidence://pattern/1"],
    },
    applicableWhen: ["tests exist"],
    notApplicableWhen: ["migration is destructive"],
    failureCounterexamples: ["public API changes"],
    rollbackSteps: ["discard the candidate"],
    validationMethods: ["run the fixed suite"],
    requestedCapabilities: [],
    targetRuntimes: ["node22-windows"],
    contextCost: { maxTokens: 1000, maxBytes: 8000 },
    machineDiff: [
      {
        op: "replace",
        path: "SKILL.md",
        beforeDigest: hash("before"),
        afterDigest: hash("after"),
      },
    ],
    sourceEvidenceRefs: [
      { ref: "evidence://pattern/1", digest: hash("evidence") },
    ],
    wikiRevision: "wiki:revision-7",
    proposerModel: "provider:model-v1",
  };
  return {
    status: "proposal",
    proposal,
    proposalDigest: computeWikiSkillProposalDigest(proposal),
  };
}

function backend() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-proposal-ledger-"),
  );
  roots.push(root);
  const secret = "test-only-proposal-artifact-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/proposal-artifacts";
  const policyDigest = hash("proposal-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: "tenant-a",
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
  const state = { events: [], failAfterAppend: false };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch-a",
      ledgerId: "ledger-a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent: (input, expected) => {
      const head = state.events.at(-1);
      if (
        expected.expectedSequence !== state.events.length ||
        expected.expectedHeadDigest !== (head?.eventDigest ?? null)
      )
        throw new Error("ledger head conflict");
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: hash(input),
      };
      state.events.push(event);
      if (state.failAfterAppend) {
        state.failAfterAppend = false;
        throw new Error("simulated response loss");
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: hash(event),
      };
    },
  };
  return {
    artifactPorts,
    ledger,
    resolver: artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    }),
    state,
  };
}

function adapter(value) {
  return new WikiSkillProposalLedgerAdapter({
    descriptor: {
      tenantId: "tenant-a",
      artifactTenantId: "tenant-a",
      evolutionRunId: "run-1",
      skillName: "safe-refactor",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: value.artifactPorts,
    ledger: value.ledger,
    ledgerArtifactResolver: value.resolver,
  });
}

function request(overrides = {}) {
  return {
    planDigest: hash("plan"),
    operationKey: hash("operation"),
    inputDigest: hash("input"),
    drafted: drafted(),
    effectiveAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

describe("WikiSkillProposalLedgerAdapter", () => {
  it("persists and reloads one exact proposal through ArtifactStore and Ledger", () => {
    const value = backend();
    const committed = adapter(value).commit(request());
    const reopened = adapter(value).load(request().planDigest);

    expect(committed).toMatchObject({
      committed: true,
      recovered: false,
      outputDigest: request().drafted.proposalDigest,
    });
    expect(reopened.drafted).toEqual(request().drafted);
    expect(value.state.events).toHaveLength(1);
    expect(value.state.events[0].type).toBe(WIKI_SKILL_PROPOSAL_LEDGER_EVENT);
  });

  it("recovers after the Ledger committed but its response was lost", () => {
    const value = backend();
    value.state.failAfterAppend = true;
    expect(() => adapter(value).commit(request())).toThrow(/response loss/u);

    expect(adapter(value).commit(request())).toMatchObject({
      committed: true,
      recovered: true,
      outputDigest: request().drafted.proposalDigest,
    });
    expect(value.state.events).toHaveLength(1);
  });

  it("rejects a second proposal for the same release plan", () => {
    const value = backend();
    adapter(value).commit(request());

    expect(() =>
      adapter(value).commit(
        request({ drafted: drafted("Substituted proposal") }),
      ),
    ).toThrow(
      expect.objectContaining({ code: WIKI_SKILL_PROPOSAL_CONFLICT_CODE }),
    );
    expect(value.state.events).toHaveLength(1);
  });
});
