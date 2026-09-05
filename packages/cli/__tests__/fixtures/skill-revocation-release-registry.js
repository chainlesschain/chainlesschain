import { createHash } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";

import {
  EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
  createEvolutionLedgerPorts,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
  SkillCandidateRegistry,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import {
  SKILL_MUTATION_PRINCIPAL_SCHEMA,
  SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
  SKILL_MUTATION_ROLES,
  SkillMutationAuthority,
  buildSkillMutationRequest,
  digestSkillMutationReceiptEnvelope,
  digestSkillMutationTransitionSubject,
} from "../../src/lib/evolution/skill-mutation-authority.js";
import {
  EMPTY_SKILL_ACTIVE_DIGEST,
  SkillPromotionController,
} from "../../src/lib/evolution/skill-promotion-controller.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";

const TENANT = "tenant-a";
const SKILL = "safe-refactor";
const ARTIFACT_TENANT = "artifact-tenant-a-release";
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const digestBytes = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const D = (value) => digestBytes(canonical(value));

// Test-only replica, persisted and read back in every process. Production key
// custody and remote durability are intentionally outside this fixture.
function replicaAuthority(root) {
  fs.mkdirSync(root, { recursive: true });
  const id = "durability:revocation-release-test";
  const location = (ref) => join(root, `${D(ref).slice(7)}.json`);
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
    return { ...core, receiptDigest: D(core) };
  };
  const read = (request) => {
    const record = JSON.parse(fs.readFileSync(location(request.ref), "utf8"));
    const bytes = Buffer.from(record.bytes, "base64");
    for (const key of [
      "artifactTenantId",
      "digest",
      "purpose",
      "ref",
      "retention",
    ]) {
      if (record.binding[key] !== request[key])
        throw new Error("release replica binding changed");
    }
    if (digestBytes(bytes) !== request.digest)
      throw new Error("release replica bytes changed");
    return { record, bytes };
  };
  return {
    id,
    retain({ binding, bytes }) {
      if (!Buffer.isBuffer(bytes) || digestBytes(bytes) !== binding.digest) {
        throw new Error("release replica retain digest mismatch");
      }
      const target = location(binding.ref);
      if (!fs.existsSync(target)) {
        const fd = fs.openSync(target, "wx");
        try {
          fs.writeFileSync(
            fd,
            canonical({ binding, bytes: bytes.toString("base64") }),
          );
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      read(binding);
      return receipt(binding);
    },
    resolve(request) {
      const { record, bytes } = read(request);
      return {
        ...receipt(record.binding),
        bytes,
        schema: EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
      };
    },
  };
}

function execution(generation) {
  const dependencyLock = buildSkillDependencyLock({
    tenantId: TENANT,
    lock: {
      generation,
      packages: {
        "fixture-tool": generation === "baseline" ? "1.0.0" : "2.0.0",
      },
    },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: TENANT,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "win32-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: D("sandbox"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-test",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:revocation-test",
      environmentDigest: D("test-environment"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: TENANT,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  return { dependencyLock, runtimeManifest, targetMatrix, cells };
}

export async function openRevocationReleaseRegistry({
  root,
  storage,
  fsImpl,
  seed = false,
  crashPoint = "none",
}) {
  const ports = createEvolutionLedgerPorts({
    artifactDurabilityAuthority: replicaAuthority(
      join(root, "release-replica"),
    ),
    artifactPorts: storage.artifactPorts,
    artifactTenantId: ARTIFACT_TENANT,
    audience: "evolution-runtime",
    ledger: storage.backend.ledger,
  });
  const plans = [execution("baseline"), execution("candidate")];
  const admission = {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    authorityId: "authority:revocation-test-admission",
    trust: "trusted",
    revision: 1,
    handlerArtifactDigest: D("revocation-test-admission"),
    resolve(request) {
      const plan = plans.find(
        ({ targetMatrix }) =>
          targetMatrix.targetMatrixRoot === request.proposedTargetMatrixRoot,
      );
      if (!plan || request.tenantId !== TENANT || request.skillName !== SKILL)
        return false;
      return {
        authorityId: admission.authorityId,
        trust: admission.trust,
        revision: admission.revision,
        handlerArtifactDigest: admission.handlerArtifactDigest,
        schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
        admitted: true,
        tenantId: TENANT,
        skillName: SKILL,
        dependencyLockDigest: plan.dependencyLock.dependencyLockDigest,
        runtimeManifestDigest: plan.runtimeManifest.runtimeManifestDigest,
        expectedEnvironmentBindings: plan.cells,
        expectedTargetMatrixRoot: plan.targetMatrix.targetMatrixRoot,
      };
    },
  };
  const candidates = new SkillCandidateRegistry({
    tenantId: TENANT,
    rootDir: join(root, "release-candidates"),
    targetMatrixAdmissionAuthority: admission,
    secure: false,
  });
  const releases = new SkillReleaseRegistry({
    tenantId: TENANT,
    rootDir: join(root, "skill-releases"),
    transactionLedger: ports.transactionLedger,
    fsImpl,
    secure: false,
    leaseTtlMs: 60_000,
    crashHook(phase, transaction) {
      if (
        crashPoint === "after-release-pointer" &&
        phase === "after-pointer" &&
        transaction.intent.operation === "rollback"
      ) {
        process.exit(95);
      }
    },
  });
  // Fixed test principal/receipts isolate Registry recovery from external PKI.
  // Audit and one-use nonce decisions still go through the real durable Ledger.
  const authority = new SkillMutationAuthority({
    auditSink: ports.auditSink,
    nonceStore: ports.nonceStore,
    now: () => new Date(storage.now),
    principalResolver: {
      async resolve({ request }) {
        return {
          schema: SKILL_MUTATION_PRINCIPAL_SCHEMA,
          authenticated: true,
          principalId: "principal:revocation-test",
          role: SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
          tenantId: request.tenantId,
          audience: request.audience,
          operationId: request.operationId,
          operation: request.operation,
          transitionSubjectDigest: request.transitionSubjectDigest,
          requestDigest: request.requestDigest,
          expiresAt: request.expiresAt,
        };
      },
    },
    receiptVerifier: {
      async verify({ receipts, request, principal }) {
        return {
          schema: SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
          verified: true,
          bindings: Object.fromEntries(
            SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
              kind,
              {
                ...request,
                schema: SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
                kind,
                principalId: principal.principalId,
                role: principal.role,
                receiptDigest: digestSkillMutationReceiptEnvelope(
                  receipts[`${kind}Receipt`],
                ),
              },
            ]),
          ),
        };
      },
    },
  });
  const controller = new SkillPromotionController({
    candidateRegistry: candidates,
    releaseRegistry: releases,
    authority,
  });
  function requestFor({
    operation,
    operationId,
    candidate = null,
    target = null,
    current,
  }) {
    const expectedTargetDigest =
      current?.release.contentDigest ?? EMPTY_SKILL_ACTIVE_DIGEST;
    const expectedTargetRevision = current?.state.revision ?? 0;
    return buildSkillMutationRequest({
      tenantId: TENANT,
      audience: "evolution-runtime",
      operationId,
      operation,
      skillName: SKILL,
      targetScope: "active",
      expectedTargetDigest,
      expectedTargetRevision,
      transitionSubjectDigest: digestSkillMutationTransitionSubject({
        tenantId: TENANT,
        skillName: SKILL,
        operation,
        candidateId: candidate?.candidateId ?? null,
        rollbackTargetReleaseDigest: target?.releaseDigest ?? null,
        dependencyLockDigest: (candidate ?? target).dependencyLockDigest,
        expectedActiveContentDigest: expectedTargetDigest,
        expectedActiveRevision: expectedTargetRevision,
      }),
      expiresAt: new Date(storage.now + 120_000).toISOString(),
      nonce: D(operationId).slice(7),
      receipts: Object.fromEntries(
        SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
          `${kind}Receipt`,
          `${kind}:test:${operationId}`,
        ]),
      ),
    });
  }
  if (seed) {
    for (const [index, plan] of plans.entries()) {
      if (releases.readState(SKILL).revision > index) continue;
      const current = releases.readActive(SKILL);
      const generation = index === 0 ? "baseline" : "candidate";
      const { candidate } = candidates.create({
        tenantId: TENANT,
        skillName: SKILL,
        parentDigest: current?.release.contentDigest ?? null,
        sourceEvidenceRefs: [
          {
            ref: `recording://revocation/${generation}`,
            digest: D(generation),
          },
        ],
        derivationMode: "record-replay",
        wikiRevision: null,
        proposerModel: null,
        requestedCapabilities: ["workspace.read"],
        evalRunId: null,
        content: `---\nname: safe-refactor\n---\n\nApply the ${generation} procedure and verify tests.\n`,
        dependencyLock: plan.dependencyLock,
        runtimeManifest: plan.runtimeManifest,
        targetMatrix: plan.targetMatrix,
      });
      const request = requestFor({
        operation: "promote",
        operationId: `seed:${generation}`,
        candidate,
        current,
      });
      const capability = await authority.authorize(request);
      await controller.promote({
        candidateId: candidate.candidateId,
        authorization: { capability, request },
      });
    }
  }

  function intents() {
    const identity = storage.backend.ledger.verify();
    return storage.backend.ledger
      .read()
      .filter((event) => event.type === "skill.release.prepare")
      .map((event) => {
        const resolved = storage.resolver({
          epoch: identity.epoch,
          ledgerId: identity.ledgerId,
          tenantId: ARTIFACT_TENANT,
          ref: event.subjectRef,
        });
        return JSON.parse(resolved.bytes.toString("utf8")).value;
      });
  }
  const promotions = intents().filter(
    (intent) => intent.operation === "promote",
  );
  if (promotions.length !== 2)
    throw new Error("revocation fixture requires two real promotions");
  const baseline = releases.readRelease(promotions[0].targetReleaseDigest);
  const candidateRelease = releases.readRelease(
    promotions[1].targetReleaseDigest,
  );

  return Object.freeze({
    baseline,
    candidateRelease,
    readActive: () => releases.readActive(SKILL),
    async rollback(pilotRequestDigest) {
      const operationId = `pilot-rollback:${pilotRequestDigest.slice(7)}`;
      let current = releases.readActive(SKILL);
      if (current.release.releaseDigest !== baseline.releaseDigest) {
        if (
          current.release.releaseDigest !== candidateRelease.releaseDigest ||
          current.state.revision !== 2
        )
          throw new Error("unexpected active release before Pilot rollback");
        const request = requestFor({
          operation: "rollback",
          operationId,
          target: baseline,
          current,
        });
        const capability = await authority.authorize(request);
        await controller.rollback({
          authorization: { capability, request },
          targetReleaseDigest: baseline.releaseDigest,
        });
        current = releases.readActive(SKILL);
      }
      const intent = intents().find(
        (item) => item.transactionId === current.state.transactionId,
      );
      if (
        current.state.revision !== 3 ||
        intent?.operation !== "rollback" ||
        intent.operationId !== operationId ||
        intent.targetReleaseDigest !== baseline.releaseDigest ||
        intent.previousStateDigest !== promotions[1].nextStateDigest
      ) {
        throw new Error(
          "Pilot rollback does not match its durable release transaction",
        );
      }
      const settled = ports.transactionLedger.query(
        current.state.transactionId,
      );
      if (
        settled.status !== "committed" ||
        settled.current !== true ||
        settled.stateDigest !== current.state.stateDigest
      )
        throw new Error("Pilot release rollback is not finalized");
      return { active: current, receiptDigest: settled.receiptDigest };
    },
    inspect() {
      return {
        active: releases.readActive(SKILL),
        baseline,
        candidateRelease,
        ledger: storage.backend.ledger.verify(),
        transitions: intents().map(
          ({ operation, operationId, transactionId, targetReleaseDigest }) => ({
            operation,
            operationId,
            transactionId,
            targetReleaseDigest,
          }),
        ),
      };
    },
  });
}
