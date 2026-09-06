import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  GovernedKnowledgeQuarantineReleaseLedger,
  createGovernedKnowledgeQuarantineReleaseDecisionAuthority,
} from "../../src/lib/evolution/governed-knowledge-quarantine-release.js";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function D(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function decisionAuthority({ rejectApproval = false } = {}) {
  const verifyApproval = vi.fn(({ request, receipt }) => {
    if (rejectApproval || receipt !== "human-approval") {
      throw new Error("independent human approval rejected");
    }
    return {
      authenticated: true,
      durable: true,
      authorityId: "knowledge-quarantine-release:approval",
      authorityRevision: 1,
      handlerArtifactDigest: D("release-approval-handler"),
      requestDigest: request.requestDigest,
      receiptDigest: D(`approval:${request.requestDigest}`),
      decision: "approved",
      verifiedAt: "2026-09-06T00:00:00.000Z",
    };
  });
  const verifyEvaluation = vi.fn(({ request, receipt }) => {
    if (receipt !== "safety-evaluation") {
      throw new Error("independent safety evaluation rejected");
    }
    return {
      authenticated: true,
      durable: true,
      authorityId: "knowledge-quarantine-release:evaluation",
      authorityRevision: 1,
      handlerArtifactDigest: D("release-evaluation-handler"),
      requestDigest: request.requestDigest,
      receiptDigest: D(`evaluation:${request.requestDigest}`),
      decision: "passed",
      verifiedAt: "2026-09-06T00:00:01.000Z",
    };
  });
  return {
    authority: createGovernedKnowledgeQuarantineReleaseDecisionAuthority({
      approval: {
        descriptor: {
          authorityId: "knowledge-quarantine-release:approval",
          revision: 1,
          handlerArtifactDigest: D("release-approval-handler"),
        },
        verify: verifyApproval,
      },
      evaluation: {
        descriptor: {
          authorityId: "knowledge-quarantine-release:evaluation",
          revision: 1,
          handlerArtifactDigest: D("release-evaluation-handler"),
        },
        verify: verifyEvaluation,
      },
    }),
    verifyApproval,
    verifyEvaluation,
  };
}

function releaseLedger(h, authority, ledger = h.resources.backend.ledger) {
  return new GovernedKnowledgeQuarantineReleaseLedger({
    descriptor: h.descriptor,
    artifactPorts: h.resources.artifactPorts,
    ledger,
    ledgerArtifactResolver: h.resources.resolver,
    dependencyExecutor: h.executor,
    decisionAuthority: authority,
    now: h.resources.clock,
  });
}

function operationDigest(h) {
  const event = h.resources.backend.ledger
    .read()
    .findLast(
      (entry) =>
        entry.type === "knowledge.revocation-dependencies.prepared" &&
        entry.correlationId === h.descriptor.streamId,
    );
  if (!event) throw new Error("test quarantine preparation is missing");
  return `sha256:${event.eventId.split(".").at(-1)}`;
}

async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-quarantine-release-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, { ...options, seed: true });
}

it("restores one exact quarantine set only after independent durable approval and safety evaluation", async () => {
  const h = await setup({
    activeQuarantine: true,
    candidateQuarantine: "combined",
    wikiProvenance: true,
    wikiQuarantine: "combined",
  });
  await h.makeSync().publish(h.knowledge);
  const successor = h.release.createDerivedCandidate();
  await expect(
    h.release.promoteCandidate(
      "before-approved-release",
      successor.candidateId,
    ),
  ).rejects.toMatchObject({
    cause: { code: "CC_EVOLUTION_LEDGER_SOURCE_REVOKED" },
  });

  const decisions = decisionAuthority();
  const ledger = releaseLedger(h, decisions.authority);
  const committed = await ledger.commit({
    operationDigest: operationDigest(h),
    reason: "independent review confirmed the exact release is safe",
    approvalReceipt: "human-approval",
    evaluationReceipt: "safety-evaluation",
  });
  expect(committed).toMatchObject({
    authenticated: true,
    durable: true,
    recovered: false,
    record: {
      dependencies: [
        {
          kind: "active-skill",
          digest: h.release.candidateRelease.releaseDigest,
          disposition: "quarantine",
        },
        {
          kind: "candidate",
          digest: h.release.candidateRelease.candidateId,
          disposition: "quarantine",
        },
        expect.objectContaining({ kind: "wiki", disposition: "quarantine" }),
      ],
    },
  });
  expect(decisions.verifyApproval).toHaveBeenCalledOnce();
  expect(decisions.verifyEvaluation).toHaveBeenCalledOnce();
  await expect(
    h.release.promoteCandidate(
      "before-wiki-restoration",
      successor.candidateId,
    ),
  ).rejects.toMatchObject({
    cause: { code: "CC_EVOLUTION_LEDGER_SOURCE_REVOKED" },
  });
  await expect(
    ledger.restoreWikis({
      operationDigest: operationDigest(h),
      wikiAdapters: [h.wiki.adapter],
    }),
  ).resolves.toMatchObject({
    authenticated: true,
    durable: true,
    recovered: false,
  });
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "hypothesis",
  );
  await expect(
    h.release.promoteCandidate("exact-quarantined-release"),
  ).rejects.toBeTruthy();
  const reopened = await openKnowledgeSkillRollbackStore(h.root, {
    activeQuarantine: true,
    candidateQuarantine: "combined",
    wikiProvenance: true,
    wikiQuarantine: "combined",
  });
  const reopenedLedger = releaseLedger(reopened, decisions.authority);
  const recovered = await reopenedLedger.commit({
    operationDigest: operationDigest(reopened),
    reason: "independent review confirmed the exact release is safe",
    approvalReceipt: "human-approval",
    evaluationReceipt: "safety-evaluation",
  });
  expect(recovered).toMatchObject({
    authenticated: true,
    durable: true,
    recovered: true,
  });
  await expect(
    reopenedLedger.restoreWikis({
      operationDigest: operationDigest(reopened),
      wikiAdapters: [reopened.wiki.adapter],
    }),
  ).resolves.toMatchObject({ recovered: true });
  await expect(
    reopened.release.promoteCandidate(
      "after-approved-release",
      successor.candidateId,
    ),
  ).resolves.toMatchObject({ state: { revision: 4 } });
  expect(reopened.release.readActive().release.candidate.candidateId).toBe(
    successor.candidateId,
  );
  expect(reopened.release.readActive().release.candidate.candidateId).not.toBe(
    reopened.release.candidateRelease.candidate.candidateId,
  );
}, 240_000);

it("does not reinterpret terminal rollback or a failed human decision as releasable quarantine", async () => {
  const terminal = await setup();
  await terminal.makeSync().publish(terminal.knowledge);
  const decisions = decisionAuthority();
  await expect(
    releaseLedger(terminal, decisions.authority).commit({
      operationDigest: operationDigest(terminal),
      reason: "attempt to release a terminal rollback disposition",
      approvalReceipt: "human-approval",
      evaluationReceipt: "safety-evaluation",
    }),
  ).rejects.toThrow(/dependencies are invalid/u);

  const quarantined = await setup({ activeQuarantine: true });
  await quarantined.makeSync().publish(quarantined.knowledge);
  const rejected = decisionAuthority({ rejectApproval: true });
  await expect(
    releaseLedger(quarantined, rejected.authority).commit({
      operationDigest: operationDigest(quarantined),
      reason: "human approval must be independently authenticated",
      approvalReceipt: "human-approval",
      evaluationReceipt: "safety-evaluation",
    }),
  ).rejects.toThrow(/human approval rejected/u);
  await expect(
    quarantined.release.promoteCandidate("still-quarantined"),
  ).rejects.toMatchObject({
    cause: { code: "CC_EVOLUTION_LEDGER_SOURCE_REVOKED" },
  });
}, 240_000);

it("recovers an exact committed release when the Ledger acknowledgement is lost", async () => {
  const h = await setup({ activeQuarantine: true });
  await h.makeSync().publish(h.knowledge);
  const decisions = decisionAuthority();
  const actual = h.resources.backend.ledger;
  let loseAcknowledgement = true;
  const lossy = {
    read: actual.read.bind(actual),
    verify: actual.verify.bind(actual),
    appendDomainEvent(event, expected) {
      const receipt = actual.appendDomainEvent(event, expected);
      if (
        loseAcknowledgement &&
        event.type === "knowledge.quarantine-release.committed"
      ) {
        loseAcknowledgement = false;
        throw new Error("simulated quarantine release acknowledgement loss");
      }
      return receipt;
    },
  };
  await expect(
    releaseLedger(h, decisions.authority, lossy).commit({
      operationDigest: operationDigest(h),
      reason: "recover the same independently approved release operation",
      approvalReceipt: "human-approval",
      evaluationReceipt: "safety-evaluation",
    }),
  ).resolves.toMatchObject({
    authenticated: true,
    durable: true,
    recovered: true,
  });
  expect(loseAcknowledgement).toBe(false);
  await expect(
    releaseLedger(h, decisions.authority).read({
      operationDigest: operationDigest(h),
    }),
  ).resolves.toMatchObject({ authenticated: true, durable: true });
}, 240_000);

it("rejects a shared or matching approval and evaluation authority", () => {
  const verifier = {
    descriptor: {
      authorityId: "same-authority",
      revision: 1,
      handlerArtifactDigest: D("same-handler"),
    },
    verify() {},
  };
  expect(() =>
    createGovernedKnowledgeQuarantineReleaseDecisionAuthority({
      approval: verifier,
      evaluation: verifier,
    }),
  ).toThrow(/independent/u);
  expect(() =>
    createGovernedKnowledgeQuarantineReleaseDecisionAuthority({
      approval: verifier,
      evaluation: { ...verifier },
    }),
  ).toThrow(/identities must differ/u);
});
