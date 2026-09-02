import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SKILL_CANDIDATE_MIGRATION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_MIGRATION_RECEIPT_SCHEMA,
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
  SKILL_MUTATION_NONCE_ACK_SCHEMA,
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_PRINCIPAL_SCHEMA,
  SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationRequest,
  digestSkillMutationReceiptEnvelope,
  digestSkillMutationTransitionSubject,
} from "../../src/lib/evolution/skill-mutation-authority.js";
import {
  EMPTY_SKILL_ACTIVE_DIGEST,
  SkillPromotionController,
} from "../../src/lib/evolution/skill-promotion-controller.js";
import {
  SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
  SKILL_RELEASE_MIGRATION_AUTHORITY_SCHEMA,
  SKILL_RELEASE_MIGRATION_RECEIPT_SCHEMA,
  SKILL_RELEASE_MIGRATION_RECORD_SCHEMA,
  SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  SKILL_RELEASE_SCHEMA,
  SKILL_RELEASE_STATE_SCHEMA,
  SKILL_RELEASE_TENANT_MARKER_SCHEMA,
  SkillReleaseRegistry,
  SkillReleaseSimulatedCrashError,
  buildMigratedSkillRelease,
  deriveSkillReleaseTenantKey,
  verifyLegacySkillRelease,
  verifySkillRelease,
} from "../../src/lib/evolution/skill-release-registry.js";

const TENANT_ID = "tenant:test";
const OTHER_TENANT_ID = "tenant:other";
const candidateAdmissionRecords = new Map();

const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const domainDigest = (schema, value) =>
  digest(`${schema}\0${canonicalJson(value)}`);
const CLI_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function durableWriteJson(filePath, value) {
  fs.writeFileSync(filePath, `${canonicalJson(value)}\n`, "utf8");
}

function capturedError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

function redigestTransitionJournal(value, mutateIntent) {
  const journal = JSON.parse(JSON.stringify(value));
  mutateIntent(journal.intent);
  const intentCore = { ...journal.intent };
  delete intentCore.intentDigest;
  journal.intent.intentDigest = domainDigest(
    "chainlesschain.skill-release-transition-intent/v2",
    intentCore,
  );
  const journalCore = { ...journal };
  delete journalCore.journalDigest;
  journal.journalDigest = domainDigest(
    "chainlesschain.skill-release-journal/v4",
    journalCore,
  );
  return journal;
}

function childSource(value) {
  return value
    .toString()
    .replaceAll("__vite_ssr_import_0__.default", "crypto")
    .replaceAll("__vite_ssr_import_1__.default", "fs")
    .replace(/__vite_ssr_import_\d+__\./gu, "");
}

class StrictTransactionLedger {
  #records = new Map();

  #sequence = 0;

  #failure = null;

  #queryOverride = null;

  setFailure(value) {
    this.#failure = value;
  }

  setQueryOverride(value) {
    this.#queryOverride = value;
  }

  prepare(intent) {
    if (this.#failure === "prepare") throw new Error("prepare failed");
    if (!Object.isFrozen(intent)) throw new Error("intent is not frozen");
    const existing = this.#records.get(intent.transactionId);
    if (existing) {
      if (existing.intent.intentDigest !== intent.intentDigest) {
        throw new Error("transaction collision");
      }
      return existing.prepare;
    }
    this.#sequence += 1;
    const prepare = Object.freeze({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "prepared",
      authenticated: true,
      durable: true,
      transactionId: intent.transactionId,
      intentDigest: intent.intentDigest,
      authorityReceiptDigest: intent.authorityReceiptDigest,
      ledgerId: "ledger:test",
      epoch: "epoch:test",
      sequence: this.#sequence,
      headDigest: digest(`prepare-head:${intent.intentDigest}`),
      receiptDigest: digest(`prepare-receipt:${intent.intentDigest}`),
    });
    this.#records.set(intent.transactionId, {
      intent: JSON.parse(JSON.stringify(intent)),
      prepare,
      committed: null,
    });
    return prepare;
  }

  finalize(input) {
    if (this.#failure === "finalize") throw new Error("finalize failed");
    if (!Object.isFrozen(input))
      throw new Error("finalize input is not frozen");
    const record = this.#records.get(input.transactionId);
    if (
      !record ||
      record.intent.intentDigest !== input.intentDigest ||
      record.prepare.receiptDigest !== input.expectedPrepareReceiptDigest
    ) {
      throw new Error("finalize binding mismatch");
    }
    if (record.committed) return record.committed;
    this.#sequence += 1;
    record.committed = Object.freeze({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "committed",
      authenticated: true,
      durable: true,
      transactionId: input.transactionId,
      intentDigest: input.intentDigest,
      authorityReceiptDigest: input.authorityReceiptDigest,
      ledgerId: "ledger:test",
      epoch: "epoch:test",
      sequence: this.#sequence,
      headDigest: digest(`commit-head:${input.intentDigest}`),
      receiptDigest: digest(`commit-receipt:${input.intentDigest}`),
      current: true,
      pointerDigest: input.pointerDigest,
      prepareReceiptDigest: input.expectedPrepareReceiptDigest,
      revision: input.revision,
      skillName: input.skillName,
      stateDigest: input.stateDigest,
    });
    return record.committed;
  }

  query(transactionId) {
    if (this.#failure === "query") throw new Error("query failed");
    if (this.#queryOverride) return this.#queryOverride(transactionId);
    const record = this.#records.get(transactionId);
    if (!record) {
      return Object.freeze({
        schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
        status: "absent",
        authenticated: true,
        durable: true,
        transactionId,
      });
    }
    if (!record.committed) return record.prepare;
    const latestRevision = Math.max(
      ...[...this.#records.values()]
        .filter(
          (entry) =>
            entry.committed?.skillName === record.committed.skillName &&
            entry.intent.mutationRequest.tenantId ===
              record.intent.mutationRequest.tenantId,
        )
        .map((entry) => entry.committed.revision),
    );
    return Object.freeze({
      ...record.committed,
      current: record.committed.revision === latestRevision,
    });
  }

  records() {
    return [...this.#records.values()];
  }
}

class FileTransactionLedger {
  #filePath;

  #authenticationKey;

  constructor(filePath, authenticationKey) {
    this.#filePath = filePath;
    this.#authenticationKey = authenticationKey;
    if (!fs.existsSync(filePath)) {
      this.#save({ sequence: 0, records: {} });
    }
  }

  #mac(value) {
    return crypto
      .createHmac("sha256", this.#authenticationKey)
      .update(canonicalJson(value), "utf8")
      .digest("hex");
  }

  #load() {
    const envelope = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
    if (
      !envelope ||
      typeof envelope !== "object" ||
      typeof envelope.mac !== "string" ||
      this.#mac(envelope.payload) !== envelope.mac
    ) {
      throw new Error("transaction ledger authentication failed");
    }
    return envelope.payload;
  }

  #save(value) {
    durableWriteJson(this.#filePath, { payload: value, mac: this.#mac(value) });
  }

  prepare(intent) {
    const state = this.#load();
    const existing = state.records[intent.transactionId];
    if (existing) return existing.prepare;
    state.sequence += 1;
    const prepare = {
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "prepared",
      authenticated: true,
      durable: true,
      transactionId: intent.transactionId,
      intentDigest: intent.intentDigest,
      authorityReceiptDigest: intent.authorityReceiptDigest,
      ledgerId: "ledger:file-test",
      epoch: "epoch:file-test",
      sequence: state.sequence,
      headDigest: digest(`file-prepare-head:${intent.intentDigest}`),
      receiptDigest: digest(`file-prepare-receipt:${intent.intentDigest}`),
    };
    state.records[intent.transactionId] = {
      intent: JSON.parse(JSON.stringify(intent)),
      prepare,
      committed: null,
    };
    this.#save(state);
    return Object.freeze(prepare);
  }

  finalize(input) {
    const state = this.#load();
    const record = state.records[input.transactionId];
    if (!record || record.intent.intentDigest !== input.intentDigest) {
      throw new Error("file transaction was not prepared");
    }
    if (record.committed) return Object.freeze(record.committed);
    if (record.prepare.receiptDigest !== input.expectedPrepareReceiptDigest) {
      throw new Error("file prepare receipt mismatch");
    }
    state.sequence += 1;
    record.committed = {
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "committed",
      authenticated: true,
      durable: true,
      transactionId: input.transactionId,
      intentDigest: input.intentDigest,
      authorityReceiptDigest: input.authorityReceiptDigest,
      ledgerId: "ledger:file-test",
      epoch: "epoch:file-test",
      sequence: state.sequence,
      headDigest: digest(`file-commit-head:${input.intentDigest}`),
      receiptDigest: digest(`file-commit-receipt:${input.intentDigest}`),
      current: true,
      pointerDigest: input.pointerDigest,
      prepareReceiptDigest: input.expectedPrepareReceiptDigest,
      revision: input.revision,
      skillName: input.skillName,
      stateDigest: input.stateDigest,
    };
    this.#save(state);
    return Object.freeze(record.committed);
  }

  query(transactionId) {
    const record = this.#load().records[transactionId];
    if (!record) {
      return Object.freeze({
        schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
        status: "absent",
        authenticated: true,
        durable: true,
        transactionId,
      });
    }
    if (!record.committed) return Object.freeze(record.prepare);
    const records = Object.values(this.#load().records);
    const latestRevision = Math.max(
      ...records
        .filter(
          (entry) =>
            entry.committed?.skillName === record.committed.skillName &&
            entry.intent.mutationRequest.tenantId ===
              record.intent.mutationRequest.tenantId,
        )
        .map((entry) => entry.committed.revision),
    );
    return Object.freeze({
      ...record.committed,
      current: record.committed.revision === latestRevision,
    });
  }
}

function receiptEnvelopes(suffix) {
  return Object.fromEntries(
    SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
      `${kind}Receipt`,
      `${kind}:signed:${suffix}`,
    ]),
  );
}

function createAuthority() {
  let auditSequence = 0;
  let nonceSequence = 0;
  const claimedNonces = new Set();
  return new SkillMutationAuthority({
    principalResolver: {
      async resolve({ request }) {
        return {
          schema: SKILL_MUTATION_PRINCIPAL_SCHEMA,
          authenticated: true,
          principalId: "principal:promotion-controller",
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
                schema: SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
                kind,
                receiptDigest: digestSkillMutationReceiptEnvelope(
                  receipts[`${kind}Receipt`],
                ),
                principalId: principal.principalId,
                role: principal.role,
                ...request,
              },
            ]),
          ),
        };
      },
    },
    auditSink: {
      async append(event) {
        auditSequence += 1;
        return {
          persisted: true,
          auditDigest: event.auditDigest,
          headDigest: digest(`audit-head:${auditSequence}`),
          sequence: auditSequence,
        };
      },
    },
    nonceStore: {
      async claim(claim) {
        nonceSequence += 1;
        const key = `${claim.tenantId}:${claim.audience}:${claim.nonce}`;
        const claimed = !claimedNonces.has(key);
        if (claimed) claimedNonces.add(key);
        return {
          schema: SKILL_MUTATION_NONCE_ACK_SCHEMA,
          persisted: true,
          claimed,
          claimDigest: claim.claimDigest,
          expiresAt: claim.expiresAt,
          headDigest: digest(`nonce-head:${nonceSequence}`),
          sequence: nonceSequence,
        };
      },
    },
  });
}

function executionFixture(tenantId = TENANT_ID, suffix = "one") {
  const dependencyLock = buildSkillDependencyLock({
    tenantId,
    lock: { generation: suffix, packages: { vitest: "4.1.10" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: digest("sandbox:cli"),
        },
      },
      {
        runtimeId: "desktop",
        descriptor: {
          platform: "win32-x64",
          runtime: "electron-39",
          sandboxPolicyDigest: digest("sandbox:desktop"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-linux-x64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-x64",
      environmentDigest: digest("environment:cli-linux-x64"),
    },
    {
      cellId: "desktop-win32-x64",
      runtimeId: "desktop",
      targetEnvironmentRef: "environment:desktop-win32-x64",
      environmentDigest: digest("environment:desktop-win32-x64"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  const fixture = {
    context: {
      expectedEnvironmentBindings: cells,
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
    dependencyLock,
    runtimeManifest,
    targetMatrix,
  };
  candidateAdmissionRecords.set(
    [
      tenantId,
      "repair-unit-tests",
      dependencyLock.dependencyLockDigest,
      runtimeManifest.runtimeManifestDigest,
      targetMatrix.targetMatrixRoot,
    ].join("\0"),
    fixture.context,
  );
  return fixture;
}

function candidateAdmissionAuthority() {
  const descriptor = {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    authorityId: "authority:release-test-matrix-admission",
    trust: "trusted",
    revision: 1,
    handlerArtifactDigest: digest("release-test-matrix-admission:v1"),
  };
  return {
    ...descriptor,
    resolve(request) {
      const context = candidateAdmissionRecords.get(
        [
          request.tenantId,
          request.skillName,
          request.dependencyLockDigest,
          request.runtimeManifestDigest,
          request.proposedTargetMatrixRoot,
        ].join("\0"),
      );
      if (!context) return false;
      return {
        schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
        admitted: true,
        authorityId: descriptor.authorityId,
        trust: descriptor.trust,
        revision: descriptor.revision,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        tenantId: request.tenantId,
        skillName: request.skillName,
        dependencyLockDigest: request.dependencyLockDigest,
        runtimeManifestDigest: request.runtimeManifestDigest,
        expectedEnvironmentBindings: context.expectedEnvironmentBindings.map(
          (cell) => ({ ...cell }),
        ),
        expectedTargetMatrixRoot: context.expectedTargetMatrixRoot,
      };
    },
  };
}

function candidateInput(execution, parentDigest = null, suffix = "one") {
  return {
    tenantId: execution.dependencyLock.tenantId,
    skillName: "repair-unit-tests",
    parentDigest,
    sourceEvidenceRefs: [
      {
        ref: `recording://runs/${suffix}`,
        digest: digest(`evidence:${suffix}`),
      },
    ],
    derivationMode: "record-replay",
    wikiRevision: null,
    proposerModel: null,
    requestedCapabilities: ["workspace.read"],
    evalRunId: null,
    content: `---\nname: repair-unit-tests\n---\n\nCandidate ${suffix}.\n`,
    dependencyLock: execution.dependencyLock,
    runtimeManifest: execution.runtimeManifest,
    targetMatrix: execution.targetMatrix,
  };
}

function legacyCandidate(execution) {
  const input = candidateInput(execution);
  const core = {
    schema: "chainlesschain.skill-candidate/v1",
    status: "draft",
    skillName: input.skillName,
    parentDigest: input.parentDigest,
    contentDigest: digest(Buffer.from(input.content, "utf8")),
    sourceEvidenceRefs: input.sourceEvidenceRefs,
    derivationMode: input.derivationMode,
    wikiRevision: input.wikiRevision,
    proposerModel: input.proposerModel,
    targetRuntimes: [...execution.targetMatrix.targetRuntimes].sort(),
    requestedCapabilities: [...input.requestedCapabilities].sort(),
    evalRunId: null,
    contentType: "text/markdown; charset=utf-8; profile=skill",
    content: input.content,
  };
  return {
    candidateId: domainDigest("chainlesschain.skill-candidate/v1", core),
    ...core,
  };
}

function legacyRelease(candidate, execution) {
  const core = {
    authorityReceiptDigest: digest("legacy-authority-receipt"),
    candidateId: candidate.candidateId,
    content: candidate.content,
    contentDigest: candidate.contentDigest,
    dependencyLock: execution.dependencyLock.lock,
    dependencyLockDigest: execution.dependencyLock.lockDigest,
    mutationRequestDigest: digest("legacy-mutation-request"),
    parentDigest: candidate.parentDigest,
    receiptDigests: Object.fromEntries(
      SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
        kind,
        digest(`legacy-receipt:${kind}`),
      ]),
    ),
    requestedCapabilities: candidate.requestedCapabilities,
    schema: "chainlesschain.skill-release/v3",
    skillName: candidate.skillName,
    targetRuntimes: candidate.targetRuntimes,
    transitionSubjectDigest: digest("legacy-transition-subject"),
  };
  return {
    ...core,
    releaseDigest: domainDigest("chainlesschain.skill-release/v3", core),
  };
}

function requestFor({
  targetDigest,
  revision,
  operationId,
  operation = SKILL_MUTATION_OPERATIONS.PROMOTE,
  candidateId = null,
  rollbackTargetReleaseDigest = null,
  dependencyLockDigest,
  tenantId = TENANT_ID,
}) {
  const transitionSubjectDigest = digestSkillMutationTransitionSubject({
    tenantId,
    skillName: "repair-unit-tests",
    operation,
    candidateId,
    rollbackTargetReleaseDigest,
    dependencyLockDigest,
    expectedActiveContentDigest: targetDigest,
    expectedActiveRevision: revision,
  });
  return buildSkillMutationRequest({
    tenantId,
    audience: "worker:promotion",
    operationId,
    operation,
    transitionSubjectDigest,
    skillName: "repair-unit-tests",
    targetScope: SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
    expectedTargetDigest: targetDigest,
    expectedTargetRevision: revision,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: `nonce_${digest(operationId).slice(7, 39)}`,
    receipts: receiptEnvelopes(operationId),
  });
}

describe("SkillReleaseRegistry authenticated transaction recovery", () => {
  let tempRoot;
  let registryBase;
  let registryRoot;
  let execution;
  let candidates;
  let ledger;
  let releases;
  let authority;
  let controller;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-release-tx-"));
    registryBase = path.join(tempRoot, "releases");
    execution = executionFixture();
    candidates = new SkillCandidateRegistry({
      tenantId: TENANT_ID,
      targetMatrixAdmissionAuthority: candidateAdmissionAuthority(),
      rootDir: path.join(tempRoot, "candidates"),
      secure: false,
    });
    ledger = new StrictTransactionLedger();
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
    });
    registryRoot = releases.rootDir;
    authority = createAuthority();
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority,
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("pins non-link registry roots beneath a canonicalized ancestor alias", () => {
    const canonicalParent = path.join(tempRoot, "canonical-parent");
    const aliasParent = path.join(tempRoot, "alias-parent");
    fs.mkdirSync(canonicalParent);
    try {
      fs.symlinkSync(
        canonicalParent,
        aliasParent,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }

    const aliasedCandidates = new SkillCandidateRegistry({
      tenantId: TENANT_ID,
      targetMatrixAdmissionAuthority: candidateAdmissionAuthority(),
      rootDir: path.join(aliasParent, "candidates"),
      secure: false,
    });
    const aliasedReleases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: path.join(aliasParent, "releases"),
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: new StrictTransactionLedger(),
    });

    expect(aliasedCandidates.baseDir).toBe(
      fs.realpathSync.native(path.join(canonicalParent, "candidates")),
    );
    expect(aliasedReleases.baseDir).toBe(
      fs.realpathSync.native(path.join(canonicalParent, "releases")),
    );
  });

  it("migrates an exact v3 release only through durable candidate and release audit bindings", () => {
    const legacyDraft = legacyCandidate(execution);
    const candidateAuthorityDescriptor = {
      schema: SKILL_CANDIDATE_MIGRATION_AUTHORITY_SCHEMA,
      authorityId: "authority:candidate-migration",
      trust: "trusted",
      handlerArtifactDigest: digest("candidate-migration-handler:v1"),
    };
    const candidateMigration = candidates.migrateLegacy(
      legacyDraft,
      {
        dependencyLock: execution.dependencyLock,
        runtimeManifest: execution.runtimeManifest,
        targetMatrix: execution.targetMatrix,
      },
      {
        ...candidateAuthorityDescriptor,
        audit: (migration) => ({
          schema: SKILL_CANDIDATE_MIGRATION_RECEIPT_SCHEMA,
          authenticated: true,
          durable: true,
          authorityId: candidateAuthorityDescriptor.authorityId,
          trust: candidateAuthorityDescriptor.trust,
          handlerArtifactDigest:
            candidateAuthorityDescriptor.handlerArtifactDigest,
          migrationDigest: migration.migrationDigest,
          receiptDigest: digest(
            `candidate-migration-receipt:${migration.migrationDigest}`,
          ),
        }),
      },
    );
    const legacy = legacyRelease(legacyDraft, execution);
    const input = { legacyRelease: legacy, candidateMigration };

    expect(verifyLegacySkillRelease(legacy)).toEqual(legacy);
    expect(buildMigratedSkillRelease(input)).toMatchObject({
      schema: SKILL_RELEASE_SCHEMA,
      tenantId: TENANT_ID,
      candidateId: candidateMigration.candidate.candidateId,
      contentDigest: legacy.contentDigest,
    });

    const releaseAuthorityDescriptor = {
      schema: SKILL_RELEASE_MIGRATION_AUTHORITY_SCHEMA,
      authorityId: "authority:release-migration",
      trust: "trusted",
      handlerArtifactDigest: digest("release-migration-handler:v1"),
    };
    const audit = vi.fn((migration) => ({
      schema: SKILL_RELEASE_MIGRATION_RECEIPT_SCHEMA,
      authenticated: true,
      durable: true,
      authorityId: releaseAuthorityDescriptor.authorityId,
      trust: releaseAuthorityDescriptor.trust,
      handlerArtifactDigest: releaseAuthorityDescriptor.handlerArtifactDigest,
      migrationDigest: migration.migrationDigest,
      receiptDigest: digest(
        `release-migration-receipt:${migration.migrationDigest}`,
      ),
    }));
    const migrationAuthority = { ...releaseAuthorityDescriptor, audit };
    const migrated = releases.migrateLegacyRelease(input, migrationAuthority);

    expect(migrated).toMatchObject({
      created: true,
      migration: {
        schema: SKILL_RELEASE_MIGRATION_RECORD_SCHEMA,
        legacyCandidateId: legacyDraft.candidateId,
        legacyReleaseDigest: legacy.releaseDigest,
        releaseDigest: migrated.release.releaseDigest,
        tenantId: TENANT_ID,
      },
      receipt: {
        schema: SKILL_RELEASE_MIGRATION_RECEIPT_SCHEMA,
        authenticated: true,
        durable: true,
      },
    });
    expect(releases.readRelease(migrated.release.releaseDigest)).toEqual(
      migrated.release,
    );
    expect(releases.readState(legacy.skillName).revision).toBe(0);
    expect(audit).toHaveBeenCalledWith(migrated.migration);

    const repeated = releases.migrateLegacyRelease(input, migrationAuthority);
    expect(repeated.created).toBe(false);
    expect(repeated.migration.migrationDigest).toBe(
      migrated.migration.migrationDigest,
    );

    const tamperedLegacy = structuredClone(legacy);
    tamperedLegacy.content += "tampered";
    expect(
      capturedError(() => verifyLegacySkillRelease(tamperedLegacy)).code,
    ).toBe(SKILL_RELEASE_MIGRATION_REQUIRED_CODE);

    const unauditedCandidate = structuredClone(candidateMigration);
    unauditedCandidate.receipt.durable = false;
    expect(
      capturedError(() =>
        buildMigratedSkillRelease({
          legacyRelease: legacy,
          candidateMigration: unauditedCandidate,
        }),
      ).code,
    ).toBe(SKILL_RELEASE_MIGRATION_REQUIRED_CODE);

    const failedRegistry = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: path.join(tempRoot, "failed-release-migration"),
      secure: false,
      transactionLedger: new StrictTransactionLedger(),
    });
    const failedAudit = (migration) => ({
      ...audit(migration),
      durable: false,
    });
    const error = capturedError(() =>
      failedRegistry.migrateLegacyRelease(input, {
        ...releaseAuthorityDescriptor,
        audit: failedAudit,
      }),
    );
    expect(error.code).toBe("SKILL_RELEASE_MIGRATION_AUDIT_FAILED");
    expect(error.commitState).toBe("inactive-release-only");
    expect(failedRegistry.readState(legacy.skillName).revision).toBe(0);
    expect(failedRegistry.readRelease(migrated.release.releaseDigest)).toEqual(
      migrated.release,
    );
  });

  async function promote(candidate, revision, targetDigest, operationId) {
    const request = requestFor({
      targetDigest,
      revision,
      operationId,
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });
    const capability = await authority.authorize(request);
    return controller.promote({
      candidateId: candidate.candidateId,
      authorization: { capability, request },
    });
  }

  it("creates an exact tenant marker and isolates identical releases and ledger projections", async () => {
    expect(
      capturedError(
        () =>
          new SkillReleaseRegistry({
            rootDir: path.join(tempRoot, "missing-tenant"),
            secure: false,
            transactionLedger: new StrictTransactionLedger(),
          }),
      ).code,
    ).toBe("SKILL_RELEASE_INVALID");

    const marker = JSON.parse(
      fs.readFileSync(path.join(registryRoot, "_tenant.json"), "utf8"),
    );
    const markerCore = {
      schema: SKILL_RELEASE_TENANT_MARKER_SCHEMA,
      component: "skill-release-registry",
      tenantId: TENANT_ID,
      tenantKey: deriveSkillReleaseTenantKey(TENANT_ID),
    };
    expect(marker).toEqual({
      ...markerCore,
      markerDigest: domainDigest(
        SKILL_RELEASE_TENANT_MARKER_SCHEMA,
        markerCore,
      ),
    });
    expect(registryRoot).toBe(
      path.join(
        fs.realpathSync.native(registryBase),
        "tenants",
        deriveSkillReleaseTenantKey(TENANT_ID),
      ),
    );

    const first = candidates.create(candidateInput(execution)).candidate;
    const firstResult = await promote(
      first,
      0,
      EMPTY_SKILL_ACTIVE_DIGEST,
      "promotion:tenant-alpha",
    );

    const otherExecution = executionFixture(OTHER_TENANT_ID);
    const otherCandidates = new SkillCandidateRegistry({
      tenantId: OTHER_TENANT_ID,
      targetMatrixAdmissionAuthority: candidateAdmissionAuthority(),
      rootDir: path.join(tempRoot, "candidates"),
      secure: false,
    });
    const otherCandidate = otherCandidates.create(
      candidateInput(otherExecution),
    ).candidate;
    const otherReleases = new SkillReleaseRegistry({
      tenantId: OTHER_TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
    });
    const otherAuthority = createAuthority();
    const otherController = new SkillPromotionController({
      authority: otherAuthority,
      candidateRegistry: otherCandidates,
      releaseRegistry: otherReleases,
    });
    const otherRequest = requestFor({
      candidateId: otherCandidate.candidateId,
      dependencyLockDigest: otherCandidate.dependencyLockDigest,
      operationId: "promotion:tenant-beta",
      revision: 0,
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      tenantId: OTHER_TENANT_ID,
    });
    const otherResult = await otherController.promote({
      authorization: {
        capability: await otherAuthority.authorize(otherRequest),
        request: otherRequest,
      },
      candidateId: otherCandidate.candidateId,
    });

    expect(first.content).toBe(otherCandidate.content);
    expect(firstResult.release.releaseDigest).not.toBe(
      otherResult.release.releaseDigest,
    );
    expect(releases.readState(first.skillName).revision).toBe(1);
    expect(otherReleases.readState(first.skillName).revision).toBe(1);
    const otherProjection = ledger
      .records()
      .find(
        (record) => record.intent.mutationRequest.tenantId === OTHER_TENANT_ID,
      ).committed;
    ledger.setQueryOverride(() => otherProjection);
    expect(() => releases.readState(first.skillName)).toThrow(/projection/u);
    ledger.setQueryOverride(null);
  });

  it("fails closed on marker links/swaps, root swaps, and legacy or mixed layouts", () => {
    const markerPath = path.join(registryRoot, "_tenant.json");
    const markerAlias = path.join(tempRoot, "release-marker-alias.json");
    fs.linkSync(markerPath, markerAlias);
    expect(() => releases.readState("repair-unit-tests")).toThrow(
      /single-link/u,
    );
    fs.unlinkSync(markerAlias);

    const otherBase = path.join(tempRoot, "marker-swap");
    const alpha = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: otherBase,
      secure: false,
      transactionLedger: new StrictTransactionLedger(),
    });
    const beta = new SkillReleaseRegistry({
      tenantId: OTHER_TENANT_ID,
      rootDir: otherBase,
      secure: false,
      transactionLedger: new StrictTransactionLedger(),
    });
    fs.copyFileSync(
      path.join(beta.rootDir, "_tenant.json"),
      path.join(alpha.rootDir, "_tenant.json"),
    );
    expect(() => alpha.readState("repair-unit-tests")).toThrow(
      /another tenant/u,
    );

    const swapBase = path.join(tempRoot, "root-swap");
    const swapRegistry = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: swapBase,
      secure: false,
      transactionLedger: new StrictTransactionLedger(),
    });
    fs.renameSync(swapRegistry.rootDir, `${swapRegistry.rootDir}.moved`);
    fs.mkdirSync(swapRegistry.rootDir, { recursive: true });
    expect(() => swapRegistry.readState("repair-unit-tests")).toThrow(
      /directory changed|root changed/u,
    );

    const legacyBase = path.join(tempRoot, "legacy-flat");
    fs.mkdirSync(path.join(legacyBase, "artifacts"), { recursive: true });
    expect(
      capturedError(
        () =>
          new SkillReleaseRegistry({
            tenantId: TENANT_ID,
            rootDir: legacyBase,
            secure: false,
            transactionLedger: new StrictTransactionLedger(),
          }),
      ).code,
    ).toBe(SKILL_RELEASE_MIGRATION_REQUIRED_CODE);

    const unmarkedBase = path.join(tempRoot, "legacy-unmarked");
    fs.mkdirSync(
      path.join(
        unmarkedBase,
        "tenants",
        deriveSkillReleaseTenantKey(TENANT_ID),
        "active",
      ),
      { recursive: true },
    );
    expect(
      capturedError(
        () =>
          new SkillReleaseRegistry({
            tenantId: TENANT_ID,
            rootDir: unmarkedBase,
            secure: false,
            transactionLedger: new StrictTransactionLedger(),
          }),
      ).code,
    ).toBe(SKILL_RELEASE_MIGRATION_REQUIRED_CODE);

    durableWriteJson(path.join(registryRoot, "artifacts", "legacy.json"), {
      schema: "chainlesschain.skill-release/v3",
    });
    expect(
      capturedError(
        () =>
          new SkillReleaseRegistry({
            tenantId: TENANT_ID,
            rootDir: registryBase,
            secure: false,
            transactionLedger: ledger,
          }),
      ).code,
    ).toBe(SKILL_RELEASE_MIGRATION_REQUIRED_CODE);
  });

  it("persists the complete candidate execution contract and rejects artifact substitution", async () => {
    const candidate = candidates.create(candidateInput(execution)).candidate;
    const result = await promote(
      candidate,
      0,
      EMPTY_SKILL_ACTIVE_DIGEST,
      "promotion:artifact-binding",
    );
    expect(result.release).toMatchObject({
      candidate,
      dependencyLock: candidate.dependencyLock,
      dependencyLockDigest: candidate.dependencyLockDigest,
      runtimeManifest: candidate.runtimeManifest,
      runtimeManifestDigest: candidate.runtimeManifestDigest,
      targetMatrix: candidate.targetMatrix,
      targetMatrixRoot: candidate.targetMatrixRoot,
      targetRuntimes: candidate.targetRuntimes,
      tenantId: TENANT_ID,
    });

    const substitutedExecution = executionFixture(TENANT_ID, "substituted");
    const substitutedCandidate = candidates.create(
      candidateInput(substitutedExecution, null, "substituted"),
    ).candidate;
    const tampered = structuredClone(result.release);
    tampered.dependencyLock = structuredClone(
      substitutedCandidate.dependencyLock,
    );
    tampered.dependencyLockDigest = substitutedCandidate.dependencyLockDigest;
    tampered.runtimeManifest = structuredClone(
      substitutedCandidate.runtimeManifest,
    );
    tampered.runtimeManifestDigest = substitutedCandidate.runtimeManifestDigest;
    tampered.targetMatrix = structuredClone(substitutedCandidate.targetMatrix);
    tampered.targetMatrixRoot = substitutedCandidate.targetMatrixRoot;
    tampered.targetRuntimes = [...substitutedCandidate.targetRuntimes];
    const core = { ...tampered };
    delete core.releaseDigest;
    tampered.releaseDigest = domainDigest(SKILL_RELEASE_SCHEMA, core);
    expect(() => verifySkillRelease(tampered)).toThrow(/digest verification/u);
  });

  it("keeps immutable releases, LKG/dependency lock, and unforgeable historical pins", async () => {
    const first = candidates.create(candidateInput(execution)).candidate;
    const firstResult = await promote(
      first,
      0,
      EMPTY_SKILL_ACTIVE_DIGEST,
      "promotion:pin-v1",
    );
    const pin = releases.pinActive(first.skillName);
    const secondExecution = executionFixture(TENANT_ID, "two");
    const second = candidates.create(
      candidateInput(secondExecution, first.contentDigest, "two"),
    ).candidate;
    const secondResult = await promote(
      second,
      1,
      first.contentDigest,
      "promotion:pin-v2",
    );

    expect(releases.readState(first.skillName)).toMatchObject({
      revision: 2,
      activeReleaseDigest: secondResult.release.releaseDigest,
      lastKnownGoodReleaseDigest: firstResult.release.releaseDigest,
      dependencyLockDigest: secondResult.release.dependencyLockDigest,
    });
    expect(releases.readPinned(pin).releaseDigest).toBe(
      firstResult.release.releaseDigest,
    );
    const pointerPath = path.join(
      registryRoot,
      "active",
      `${first.skillName}.json`,
    );
    durableWriteJson(pointerPath, firstResult.state);
    expect(() => releases.readState(first.skillName)).toThrow(/finalized/u);
    durableWriteJson(pointerPath, secondResult.state);
    expect(() => releases.readPinned(Object.freeze({}))).toThrow(/forged/u);
    const reopened = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
    });
    expect(() => reopened.readPinned(pin)).toThrow(/another registry/u);
  });

  it("retains prepared evidence on finalize failure and converges idempotently on reopen", async () => {
    const candidate = candidates.create(candidateInput(execution)).candidate;
    ledger.setFailure("finalize");

    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:finalize-recovery",
      ),
    ).rejects.toMatchObject({ code: "SKILL_RELEASE_COMMIT_UNKNOWN" });

    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toHaveLength(1);
    expect(ledger.records()[0].committed).toBeNull();
    ledger.setFailure(null);
    await new Promise((resolve) => setTimeout(resolve, 55));
    const reopened = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
    });

    expect(reopened.readState(candidate.skillName).revision).toBe(1);
    expect(ledger.records()[0].committed).not.toBeNull();
    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toEqual([]);
    expect(fs.readdirSync(path.join(registryRoot, "locks"))).toEqual([]);
  });

  it.each([
    "after-prepare",
    "after-staging-fsync",
    "after-pointer",
    "after-finalize",
  ])(
    "converges the authenticated transaction after a crash at %s",
    async (crashPhase) => {
      releases = new SkillReleaseRegistry({
        tenantId: TENANT_ID,
        rootDir: registryBase,
        secure: false,
        leaseTtlMs: 40,
        transactionLedger: ledger,
        crashHook(phase) {
          if (phase === crashPhase)
            throw new SkillReleaseSimulatedCrashError(phase);
        },
      });
      controller = new SkillPromotionController({
        candidateRegistry: candidates,
        releaseRegistry: releases,
        authority,
      });
      const candidate = candidates.create(candidateInput(execution)).candidate;

      await expect(
        promote(
          candidate,
          0,
          EMPTY_SKILL_ACTIVE_DIGEST,
          `promotion:crash-${crashPhase}`,
        ),
      ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);
      await new Promise((resolve) => setTimeout(resolve, 55));
      const reopened = new SkillReleaseRegistry({
        tenantId: TENANT_ID,
        rootDir: registryBase,
        secure: false,
        leaseTtlMs: 40,
        transactionLedger: ledger,
      });

      expect(reopened.readState(candidate.skillName).revision).toBe(1);
      expect(fs.readdirSync(path.join(registryRoot, "journals"))).toEqual([]);
      expect(fs.readdirSync(path.join(registryRoot, "locks"))).toEqual([]);
    },
  );

  it.each(["replacement", "in-place"])(
    "rejects an exact-digest staged pointer %s before publication",
    async (tamperMode) => {
      releases = new SkillReleaseRegistry({
        tenantId: TENANT_ID,
        rootDir: registryBase,
        secure: false,
        leaseTtlMs: 40,
        transactionLedger: ledger,
        crashHook(phase, journal) {
          if (phase !== "after-staging-fsync") return;
          const stagedPath = path.join(
            registryRoot,
            "staging",
            journal.stagedFile,
          );
          const substitutedState = JSON.parse(
            fs.readFileSync(stagedPath, "utf8"),
          );
          substitutedState.fence += 1;
          const stateCore = { ...substitutedState };
          delete stateCore.stateDigest;
          substitutedState.stateDigest = domainDigest(
            SKILL_RELEASE_STATE_SCHEMA,
            stateCore,
          );
          if (tamperMode === "replacement") fs.unlinkSync(stagedPath);
          durableWriteJson(stagedPath, substitutedState);
          expect(fs.statSync(stagedPath).nlink).toBe(1);
        },
      });
      controller = new SkillPromotionController({
        candidateRegistry: candidates,
        releaseRegistry: releases,
        authority,
      });
      const candidate = candidates.create(candidateInput(execution)).candidate;

      await expect(
        promote(
          candidate,
          0,
          EMPTY_SKILL_ACTIVE_DIGEST,
          `promotion:staged-${tamperMode}`,
        ),
      ).rejects.toMatchObject({ code: "SKILL_RELEASE_STATE_CORRUPT" });
      expect(releases.readState(candidate.skillName).revision).toBe(1);
      expect(fs.readdirSync(path.join(registryRoot, "journals"))).toEqual([]);
      expect(fs.readdirSync(path.join(registryRoot, "staging"))).toEqual([]);
    },
  );

  it.each(["in-place", "replacement", "unlink"])(
    "blocks ledger finalization when the after-pointer hook performs %s tampering",
    async (tamperMode) => {
      releases = new SkillReleaseRegistry({
        tenantId: TENANT_ID,
        rootDir: registryBase,
        secure: false,
        leaseTtlMs: 40,
        transactionLedger: ledger,
        crashHook(phase, journal) {
          if (phase !== "after-pointer") return;
          const pointerPath = path.join(
            registryRoot,
            "active",
            `${journal.skillName}.json`,
          );
          if (tamperMode === "unlink") {
            fs.unlinkSync(pointerPath);
            return;
          }
          const substitutedState = JSON.parse(
            fs.readFileSync(pointerPath, "utf8"),
          );
          substitutedState.fence += 1;
          const stateCore = { ...substitutedState };
          delete stateCore.stateDigest;
          substitutedState.stateDigest = domainDigest(
            SKILL_RELEASE_STATE_SCHEMA,
            stateCore,
          );
          if (tamperMode === "replacement") fs.unlinkSync(pointerPath);
          durableWriteJson(pointerPath, substitutedState);
          expect(fs.statSync(pointerPath).nlink).toBe(1);
        },
      });
      controller = new SkillPromotionController({
        candidateRegistry: candidates,
        releaseRegistry: releases,
        authority,
      });
      const candidate = candidates.create(candidateInput(execution)).candidate;

      await expect(
        promote(
          candidate,
          0,
          EMPTY_SKILL_ACTIVE_DIGEST,
          `promotion:after-pointer-${tamperMode}`,
        ),
      ).rejects.toMatchObject({
        code: "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
        preserveForRecovery: true,
      });
      expect(ledger.records()).toHaveLength(1);
      expect(ledger.records()[0].committed).toBeNull();
      expect(fs.readdirSync(path.join(registryRoot, "journals"))).toHaveLength(
        1,
      );
    },
  );

  it("blocks finalization when the authenticated target release changes after pointer publication", async () => {
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
      crashHook(phase, journal) {
        if (phase !== "after-pointer") return;
        const releasePath = path.join(
          registryRoot,
          "artifacts",
          `${journal.nextState.activeReleaseDigest.slice("sha256:".length)}.json`,
        );
        const bytes = fs.readFileSync(releasePath);
        const marker = Buffer.from("Candidate one", "utf8");
        const offset = bytes.indexOf(marker);
        expect(offset).toBeGreaterThanOrEqual(0);
        bytes[offset] = "X".charCodeAt(0);
        fs.writeFileSync(releasePath, bytes);
      },
    });
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority,
    });
    const candidate = candidates.create(candidateInput(execution)).candidate;

    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:after-pointer-release-tamper",
      ),
    ).rejects.toMatchObject({
      code: "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
      preserveForRecovery: true,
    });
    expect(ledger.records()[0].committed).toBeNull();
    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 55));
    const recoveryError = capturedError(
      () =>
        new SkillReleaseRegistry({
          tenantId: TENANT_ID,
          rootDir: registryBase,
          secure: false,
          leaseTtlMs: 40,
          transactionLedger: ledger,
        }),
    );
    expect(recoveryError).toMatchObject({
      code: "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
      preserveForRecovery: true,
    });
    expect(ledger.records()[0].committed).toBeNull();
    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toHaveLength(1);
  });

  it("fails closed across restart when committed release bytes change in an awaited hook", async () => {
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
      crashHook(phase, transaction) {
        if (phase !== "after-finalize") return;
        const releasePath = path.join(
          registryRoot,
          "artifacts",
          `${transaction.journal.nextState.activeReleaseDigest.slice("sha256:".length)}.json`,
        );
        const bytes = fs.readFileSync(releasePath);
        const marker = Buffer.from("Candidate one", "utf8");
        const offset = bytes.indexOf(marker);
        expect(offset).toBeGreaterThanOrEqual(0);
        bytes[offset] = "X".charCodeAt(0);
        fs.writeFileSync(releasePath, bytes);
      },
    });
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority,
    });
    const candidate = candidates.create(candidateInput(execution)).candidate;

    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:after-finalize-release-tamper",
      ),
    ).rejects.toMatchObject({
      code: "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
      preserveForRecovery: true,
    });
    expect(ledger.records()[0].committed).not.toBeNull();
    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 55));
    const recoveryError = capturedError(
      () =>
        new SkillReleaseRegistry({
          tenantId: TENANT_ID,
          rootDir: registryBase,
          secure: false,
          leaseTtlMs: 40,
          transactionLedger: ledger,
        }),
    );
    expect(recoveryError).toMatchObject({
      code: "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
      preserveForRecovery: true,
    });
    expect(ledger.records()[0].committed).not.toBeNull();
    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toHaveLength(1);
  });

  it.each([
    ["deep nesting", () => `${'{"value":'.repeat(64)}null${"}".repeat(64)}\n`],
    [
      "large node count",
      () =>
        `${canonicalJson({
          nodes: Array.from({ length: 400 }, () => Array(400).fill(0)),
        })}\n`,
    ],
  ])("rejects bounded canonical %s without a RangeError", (_label, bytes) => {
    const releaseDigest = digest(`invalid-release:${_label}`);
    fs.writeFileSync(
      path.join(
        registryRoot,
        "artifacts",
        `${releaseDigest.slice("sha256:".length)}.json`,
      ),
      bytes(),
      "utf8",
    );

    const error = capturedError(() => releases.readRelease(releaseDigest));
    expect(error).not.toBeInstanceOf(RangeError);
    expect(error.code).toBe("SKILL_RELEASE_CORRUPT");
    expect(error.message).toMatch(/canonical structure budget/u);
  });

  it("aborts a crash before authenticated prepare and releases stale ownership", async () => {
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
      crashHook(phase) {
        if (phase === "after-journal") {
          throw new SkillReleaseSimulatedCrashError(phase);
        }
      },
    });
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority,
    });
    const candidate = candidates.create(candidateInput(execution)).candidate;
    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:pre-prepare-crash",
      ),
    ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);
    await new Promise((resolve) => setTimeout(resolve, 55));

    const reopened = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
    });
    expect(reopened.readState(candidate.skillName).revision).toBe(0);
    expect(ledger.records()).toEqual([]);
    expect(fs.readdirSync(path.join(registryRoot, "journals"))).toEqual([]);
    expect(fs.readdirSync(path.join(registryRoot, "locks"))).toEqual([]);
  });

  it("rejects replaying an authenticated cross-tenant intent and journal", async () => {
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
      crashHook(phase) {
        if (phase === "after-journal") {
          throw new SkillReleaseSimulatedCrashError(phase);
        }
      },
    });
    controller = new SkillPromotionController({
      authority,
      candidateRegistry: candidates,
      releaseRegistry: releases,
    });
    const candidate = candidates.create(candidateInput(execution)).candidate;
    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:tenant-journal-alpha",
      ),
    ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);

    const otherExecution = executionFixture(OTHER_TENANT_ID);
    const otherCandidates = new SkillCandidateRegistry({
      tenantId: OTHER_TENANT_ID,
      targetMatrixAdmissionAuthority: candidateAdmissionAuthority(),
      rootDir: path.join(tempRoot, "candidates"),
      secure: false,
    });
    const otherCandidate = otherCandidates.create(
      candidateInput(otherExecution),
    ).candidate;
    const otherLedger = new StrictTransactionLedger();
    const otherReleases = new SkillReleaseRegistry({
      tenantId: OTHER_TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: otherLedger,
      crashHook(phase) {
        if (phase === "after-journal") {
          throw new SkillReleaseSimulatedCrashError(phase);
        }
      },
    });
    const otherAuthority = createAuthority();
    const otherController = new SkillPromotionController({
      authority: otherAuthority,
      candidateRegistry: otherCandidates,
      releaseRegistry: otherReleases,
    });
    const otherRequest = requestFor({
      candidateId: otherCandidate.candidateId,
      dependencyLockDigest: otherCandidate.dependencyLockDigest,
      operationId: "promotion:tenant-journal-beta",
      revision: 0,
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      tenantId: OTHER_TENANT_ID,
    });
    await expect(
      otherController.promote({
        authorization: {
          capability: await otherAuthority.authorize(otherRequest),
          request: otherRequest,
        },
        candidateId: otherCandidate.candidateId,
      }),
    ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);

    fs.copyFileSync(
      path.join(
        otherReleases.rootDir,
        "journals",
        `${otherCandidate.skillName}.json`,
      ),
      path.join(registryRoot, "journals", `${candidate.skillName}.json`),
    );
    await new Promise((resolve) => setTimeout(resolve, 55));
    expect(
      capturedError(
        () =>
          new SkillReleaseRegistry({
            tenantId: TENANT_ID,
            rootDir: registryBase,
            secure: false,
            leaseTtlMs: 40,
            transactionLedger: ledger,
          }),
      ).code,
    ).toBe("SKILL_RELEASE_JOURNAL_CORRUPT");
  });

  it("does not activate a self-consistent public-hash journal absent from the trusted ledger", async () => {
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: ledger,
      crashHook(phase) {
        if (phase === "after-journal")
          throw new SkillReleaseSimulatedCrashError(phase);
      },
    });
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority,
    });
    const candidate = candidates.create(candidateInput(execution)).candidate;
    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:forged-journal",
      ),
    ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);
    const journalPath = path.join(
      registryRoot,
      "journals",
      `${candidate.skillName}.json`,
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    durableWriteJson(
      path.join(registryRoot, "active", `${candidate.skillName}.json`),
      journal.nextState,
    );
    await new Promise((resolve) => setTimeout(resolve, 55));

    expect(
      () =>
        new SkillReleaseRegistry({
          tenantId: TENANT_ID,
          rootDir: registryBase,
          secure: false,
          leaseTtlMs: 40,
          transactionLedger: ledger,
        }),
    ).toThrow(/cannot authorize pointer replacement/u);
    expect(ledger.records()).toEqual([]);
  });

  it.each([
    [
      "candidate A to B",
      (intent) => {
        intent.candidateId = digest("substituted-candidate");
      },
    ],
    [
      "dependency lock A to B",
      (intent) => {
        intent.dependencyLockDigest = digest("substituted-dependency-lock");
      },
    ],
    [
      "promote to rollback",
      (intent) => {
        intent.operation = SKILL_MUTATION_OPERATIONS.ROLLBACK;
        intent.candidateId = null;
      },
    ],
  ])(
    "rejects a self-consistent public-hash intent substitution: %s",
    async (_label, mutateIntent) => {
      releases = new SkillReleaseRegistry({
        tenantId: TENANT_ID,
        rootDir: registryBase,
        secure: false,
        leaseTtlMs: 40,
        transactionLedger: ledger,
        crashHook(phase) {
          if (phase === "after-journal") {
            throw new SkillReleaseSimulatedCrashError(phase);
          }
        },
      });
      controller = new SkillPromotionController({
        candidateRegistry: candidates,
        releaseRegistry: releases,
        authority,
      });
      const candidate = candidates.create(candidateInput(execution)).candidate;
      await expect(
        promote(
          candidate,
          0,
          EMPTY_SKILL_ACTIVE_DIGEST,
          `promotion:intent-substitution-${_label.replaceAll(" ", "-")}`,
        ),
      ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);
      const journalPath = path.join(
        registryRoot,
        "journals",
        `${candidate.skillName}.json`,
      );
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      durableWriteJson(
        journalPath,
        redigestTransitionJournal(journal, mutateIntent),
      );
      await new Promise((resolve) => setTimeout(resolve, 55));

      expect(
        () =>
          new SkillReleaseRegistry({
            tenantId: TENANT_ID,
            rootDir: registryBase,
            secure: false,
            leaseTtlMs: 40,
            transactionLedger: ledger,
          }),
      ).toThrow(/intent/u);
      expect(ledger.records()).toEqual([]);
    },
  );

  it("rejects unauthenticated ledger projections, pointer tampering, and symlink releases", async () => {
    const candidate = candidates.create(candidateInput(execution)).candidate;
    const result = await promote(
      candidate,
      0,
      EMPTY_SKILL_ACTIVE_DIGEST,
      "promotion:tamper",
    );
    ledger.setQueryOverride((transactionId) => ({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "committed",
      authenticated: false,
      durable: true,
      transactionId,
      intentDigest: digest("fake-intent"),
      authorityReceiptDigest: result.state.authorityReceiptDigest,
      ledgerId: "ledger:fake",
      epoch: "epoch:fake",
      sequence: 1,
      headDigest: digest("fake-head"),
      receiptDigest: digest("fake-receipt"),
      current: false,
      pointerDigest: result.state.stateDigest,
      prepareReceiptDigest: digest("fake-prepare"),
      revision: result.state.revision,
      skillName: candidate.skillName,
      stateDigest: result.state.stateDigest,
    }));
    expect(() => releases.readState(candidate.skillName)).toThrow(
      /authenticated/u,
    );
    const committedProjection = ledger.records().at(-1).committed;
    ledger.setQueryOverride(() => ({
      ...committedProjection,
      epoch: 1,
    }));
    expect(() => releases.readState(candidate.skillName)).toThrow(
      /transition intent/u,
    );
    ledger.setQueryOverride(null);

    expect(() => releases.readRelease("../../active")).toThrow(/sha256/u);
    const pointerPath = path.join(
      registryRoot,
      "active",
      `${candidate.skillName}.json`,
    );
    const pointerBytes = fs.readFileSync(pointerPath);
    const pointerTarget = path.join(tempRoot, "outside-pointer.json");
    fs.writeFileSync(pointerTarget, pointerBytes);
    fs.unlinkSync(pointerPath);
    let pointerSymlinkCreated = false;
    try {
      fs.symlinkSync(pointerTarget, pointerPath, "file");
      pointerSymlinkCreated = true;
    } catch (error) {
      if (!["EACCES", "EPERM"].includes(error?.code)) throw error;
    }
    if (pointerSymlinkCreated) {
      expect(() => releases.readState(candidate.skillName)).toThrow(
        /single-link/u,
      );
      fs.unlinkSync(pointerPath);
      fs.writeFileSync(pointerPath, pointerBytes);
    }

    const artifact = path.join(
      registryRoot,
      "artifacts",
      `${result.release.releaseDigest.slice(7)}.json`,
    );
    fs.writeFileSync(
      artifact,
      fs
        .readFileSync(artifact, "utf8")
        .replace("Candidate one", "Tampered bytes"),
      "utf8",
    );
    expect(() => releases.readRelease(result.release.releaseDigest)).toThrow(
      /verification/u,
    );
    fs.unlinkSync(artifact);
    const outside = path.join(tempRoot, "outside.json");
    fs.writeFileSync(outside, "{}\n", "utf8");
    try {
      fs.symlinkSync(outside, artifact, "file");
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }
    expect(() => releases.readRelease(result.release.releaseDigest)).toThrow(
      /single-link/u,
    );
  });

  it("reclaims an expired journal-less lease and stale temporary debris", async () => {
    let clock = Date.now();
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      now: () => new Date(clock),
      transactionLedger: ledger,
      crashHook(phase) {
        if (phase === "after-lease")
          throw new SkillReleaseSimulatedCrashError(phase);
      },
    });
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority,
    });
    const candidate = candidates.create(candidateInput(execution)).candidate;
    await expect(
      promote(
        candidate,
        0,
        EMPTY_SKILL_ACTIVE_DIGEST,
        "promotion:orphan-lease",
      ),
    ).rejects.toBeInstanceOf(SkillReleaseSimulatedCrashError);
    const debrisPath = path.join(
      registryRoot,
      "staging",
      ".write-orphan-debris.tmp",
    );
    fs.writeFileSync(debrisPath, "{}\n", "utf8");
    fs.utimesSync(debrisPath, new Date(clock - 100), new Date(clock - 100));
    clock += 100;

    const reopened = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: registryBase,
      secure: false,
      leaseTtlMs: 40,
      now: () => new Date(clock),
      transactionLedger: ledger,
    });

    expect(reopened.readState(candidate.skillName).revision).toBe(0);
    expect(fs.readdirSync(path.join(registryRoot, "locks"))).toEqual([]);
    expect(fs.existsSync(debrisPath)).toBe(false);
  });

  it("recovers a real process exit after pointer write through authority -> controller -> registry", async () => {
    const hardRoot = path.join(tempRoot, "hard-crash");
    fs.mkdirSync(hardRoot);
    const ledgerPath = path.join(hardRoot, "transaction-ledger.json");
    const ledgerAuthenticationKey = crypto.randomBytes(32).toString("hex");
    const moduleUrls = {
      candidate: pathToFileURL(
        path.resolve(CLI_ROOT, "src/lib/evolution/skill-candidate-registry.js"),
      ).href,
      authority: pathToFileURL(
        path.resolve(CLI_ROOT, "src/lib/evolution/skill-mutation-authority.js"),
      ).href,
      controller: pathToFileURL(
        path.resolve(
          CLI_ROOT,
          "src/lib/evolution/skill-promotion-controller.js",
        ),
      ).href,
      manifest: pathToFileURL(
        path.resolve(CLI_ROOT, "src/lib/evolution/skill-execution-manifest.js"),
      ).href,
      registry: pathToFileURL(
        path.resolve(CLI_ROOT, "src/lib/evolution/skill-release-registry.js"),
      ).href,
    };
    const script = `
      import crypto from "node:crypto";
      import fs from "node:fs";
      import path from "node:path";
      import {
        SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
        SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
        SkillCandidateRegistry
      } from ${JSON.stringify(moduleUrls.candidate)};
      import {
        SKILL_MUTATION_NONCE_ACK_SCHEMA,
        SKILL_MUTATION_OPERATIONS,
        SKILL_MUTATION_PRINCIPAL_SCHEMA,
        SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
        SKILL_MUTATION_RECEIPT_KINDS,
        SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
        SKILL_MUTATION_ROLES,
        SKILL_MUTATION_TARGET_SCOPES,
        SkillMutationAuthority,
        buildSkillMutationRequest,
        digestSkillMutationTransitionSubject,
        digestSkillMutationReceiptEnvelope
      } from ${JSON.stringify(moduleUrls.authority)};
      import { EMPTY_SKILL_ACTIVE_DIGEST, SkillPromotionController } from ${JSON.stringify(moduleUrls.controller)};
      import { buildSkillDependencyLock, buildSkillRuntimeManifest, buildSkillTargetMatrix } from ${JSON.stringify(moduleUrls.manifest)};
      import { SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA, SkillReleaseRegistry } from ${JSON.stringify(moduleUrls.registry)};
      const TENANT_ID = "tenant:test";
      const candidateAdmissionRecords = new Map();
      const digest = ${childSource(digest)};
      ${childSource(canonicalJson)}
      ${childSource(durableWriteJson)}
      ${childSource(FileTransactionLedger)}
      ${childSource(receiptEnvelopes)}
      ${childSource(createAuthority)}
      ${childSource(executionFixture)}
      ${childSource(candidateAdmissionAuthority)}
      ${childSource(candidateInput)}
      ${childSource(requestFor)}
      const root = ${JSON.stringify(hardRoot)};
      const ledger = new FileTransactionLedger(${JSON.stringify(ledgerPath)}, ${JSON.stringify(ledgerAuthenticationKey)});
      const execution = executionFixture();
      const candidates = new SkillCandidateRegistry({ tenantId: TENANT_ID, targetMatrixAdmissionAuthority: candidateAdmissionAuthority(), rootDir: path.join(root, "candidates"), secure: false });
      const releases = new SkillReleaseRegistry({
        tenantId: TENANT_ID,
        rootDir: path.join(root, "releases"),
        secure: false,
        leaseTtlMs: 40,
        transactionLedger: ledger,
        crashHook(phase) { if (phase === "after-pointer") process.exit(73); }
      });
      const authority = createAuthority();
      const controller = new SkillPromotionController({ candidateRegistry: candidates, releaseRegistry: releases, authority });
      const candidate = candidates.create(candidateInput(execution)).candidate;
      const request = requestFor({
        targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
        revision: 0,
        operationId: "promotion:hard-crash",
        candidateId: candidate.candidateId,
        dependencyLockDigest: candidate.dependencyLockDigest
      });
      const capability = await authority.authorize(request);
      await controller.promote({
        candidateId: candidate.candidateId,
        authorization: { capability, request }
      });
      process.exit(0);
    `;

    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: CLI_ROOT,
        encoding: "utf8",
        timeout: 20_000,
      },
    );
    expect(child.status, child.stderr).toBe(73);
    await new Promise((resolve) => setTimeout(resolve, 55));

    const durableLedger = new FileTransactionLedger(
      ledgerPath,
      ledgerAuthenticationKey,
    );
    const reopened = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: path.join(hardRoot, "releases"),
      secure: false,
      leaseTtlMs: 40,
      transactionLedger: durableLedger,
    });

    expect(reopened.readState("repair-unit-tests")).toMatchObject({
      revision: 1,
      activeReleaseDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(fs.readdirSync(path.join(reopened.rootDir, "journals"))).toEqual([]);
    expect(fs.readdirSync(path.join(reopened.rootDir, "locks"))).toEqual([]);
  });
});
