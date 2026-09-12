import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WIKI_SKILL_CANDIDATE_CONTENT_SCHEMA,
  WIKI_SKILL_PROPOSAL_SCHEMA,
  WikiInformedSkillProposer,
  computeWikiSkillProposalDigest,
} from "../../src/lib/evolution/wiki-informed-skill-proposer.js";
import {
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
  SkillCandidateRegistry,
  verifySkillCandidateDraft,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import { createEvolutionCandidateStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

const TENANT = "tenant-journey-58";
const SKILL = "journey-safe-skill";
const PHONE = "14229029435";
const BATCH_58_DIGEST =
  "sha256:032ffbec8d945b6de7babb263fce8438d4f0e92c73e14229029435cd894531a4";

// Exact pattern preimage read from the retained batch-58 Wiki revision.
// This regression has no dependency on that temporary directory or the corpus
// helpers. Typed Wiki ports are fixtures; the proposer and disk registry are real.
const BATCH_58_PATTERN = {
  actionable: true,
  appliesWhen: ["deterministic tests exist"],
  confidence: 0.8,
  contradicts: [],
  doesNotApplyWhen: ["data migration required"],
  evidenceCounts: { negative: 0, positive: 2, trustDomains: 2 },
  expiresAt: null,
  kind: "success",
  lastVerifiedAt: null,
  negativeEvidence: [],
  operationalConfidence: 0.8,
  patternId: "pat-journey-checks",
  positiveEvidence: ["evidence-run-journey-58-1", "evidence-run-journey-58-2"],
  procedure: "Run focused checks before accepting a bounded change",
  rejectionCount: 0,
  rollbackCount: 0,
  rootCause: "Independent deterministic observations agree",
  skillNames: [SKILL],
  status: "corroborated",
  summary: "focused-checks; independent-checks",
  supersedes: [],
  trustDomains: [
    "evolution-principal:tenant-journey-58:tool-a",
    "evolution-principal:tenant-journey-58:tool-b",
  ],
  updatedAt: "2026-09-12T00:00:00.000Z",
};

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const digestBytes = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digest = (value) => digestBytes(canonical(value));
const envelope = (kind, data) => ({
  kind,
  data,
  ref: `evidence://${kind}/one`,
  digest: digest(data),
  trusted: true,
});

function candidateFixture(rootDir) {
  const dependencyLock = buildSkillDependencyLock({
    tenantId: TENANT,
    lock: { packages: {} },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: TENANT,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.22.2",
          sandboxPolicyDigest: digest("candidate-content-sandbox"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-content-regression",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:candidate-content",
      environmentDigest: digest("candidate-content-environment"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: TENANT,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  const authority = {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    authorityId: "authority:candidate-content-targets",
    trust: "trusted",
    revision: 1,
    handlerArtifactDigest: digest("candidate-content-admission"),
    resolve(request) {
      if (
        request.tenantId !== TENANT ||
        request.skillName !== SKILL ||
        request.dependencyLockDigest !== dependencyLock.dependencyLockDigest ||
        request.runtimeManifestDigest !==
          runtimeManifest.runtimeManifestDigest ||
        request.proposedTargetMatrixRoot !== targetMatrix.targetMatrixRoot
      )
        return false;
      return {
        schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
        admitted: true,
        authorityId: authority.authorityId,
        trust: authority.trust,
        revision: authority.revision,
        handlerArtifactDigest: authority.handlerArtifactDigest,
        tenantId: TENANT,
        skillName: SKILL,
        dependencyLockDigest: dependencyLock.dependencyLockDigest,
        runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
        expectedEnvironmentBindings: cells,
        expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
      };
    },
  };
  const open = () =>
    new SkillCandidateRegistry({
      rootDir,
      tenantId: TENANT,
      targetMatrixAdmissionAuthority: authority,
      // Physical files and production identity checks remain in use. This unit
      // is not a platform ACL or power-loss durability acceptance test.
      secure: false,
    });
  return {
    registry: open(),
    open,
    execution: { dependencyLock, runtimeManifest, targetMatrix },
  };
}

function proposalFixture(
  candidates,
  { pattern = BATCH_58_PATTERN, sampleCount = 2, mutate, forgedDigest } = {},
) {
  const initial = {
    "wiki-index": envelope("wiki-index", { contradictionRefs: [] }),
    "skill-impact": envelope("skill-impact", { affectedSkills: [SKILL] }),
    "active-skill": envelope("active-skill", { skillName: SKILL, revision: 0 }),
    "training-summary": envelope("training-summary", { sampleCount }),
  };
  const selected = envelope("pattern", pattern);
  if (forgedDigest) selected.digest = forgedDigest;
  const calls = { create: 0, generate: 0 };
  const proposer = new WikiInformedSkillProposer({
    descriptor: {
      tenantId: TENANT,
      evolutionRunId: "run-journey-58",
      targetSkillName: SKILL,
      wikiRevision: "wiki:content-regression",
      proposerModel: {
        provider: "local-fixture",
        model: "schema-deriver",
        version: "v1",
      },
      minEvidenceSamples: 2,
    },
    policy: { proposerWikiRead: true, executionAgentWikiRead: false },
    ports: {
      readInitial: (kind) => initial[kind],
      readSelective(kind, ref) {
        if (kind !== "pattern" || ref !== selected.ref)
          throw new Error("unexpected selective evidence request");
        return selected;
      },
      generate({ evidence }) {
        calls.generate += 1;
        const verified = evidence.find((item) => item.kind === "pattern");
        if (!verified)
          return {
            status: "needs-evidence",
            requests: [{ kind: "pattern", ref: selected.ref }],
          };
        const output = {
          status: "proposal",
          skillName: SKILL,
          purpose: {
            summary: verified.data.summary,
            patternRefs: [verified.ref],
            sourceEvidenceRefs: [verified.ref, initial["wiki-index"].ref],
          },
          applicableWhen: ["deterministic tests exist"],
          notApplicableWhen: ["data migration required"],
          failureCounterexamples: ["unverified evidence"],
          rollbackSteps: ["retain the previously approved release"],
          validationMethods: ["run focused deterministic checks"],
          requestedCapabilities: [],
          targetRuntimes: candidates.execution.targetMatrix.targetRuntimes,
          contextCost: { maxTokens: 1000, maxBytes: 8000 },
          machineDiff: [
            {
              op: "add",
              path: "SKILL.md",
              beforeDigest: null,
              afterDigest: "bounded-change",
            },
          ],
        };
        mutate?.(output);
        return output;
      },
      createCandidate(input) {
        calls.create += 1;
        return candidates.registry.create({
          ...input,
          ...candidates.execution,
          parentDigest: null,
          evalRunId: null,
        });
      },
    },
  });
  return { proposer, calls };
}

function candidatePath(registry, candidateId) {
  return path.join(
    registry.rootDir,
    `${candidateId.slice("sha256:".length)}.json`,
  );
}

function legacyCandidateInput(proposal, execution) {
  return {
    tenantId: TENANT,
    skillName: SKILL,
    derivationMode: "wiki",
    wikiRevision: proposal.wikiRevision,
    proposerModel: proposal.proposerModel,
    requestedCapabilities: proposal.requestedCapabilities,
    sourceEvidenceRefs: proposal.sourceEvidenceRefs,
    content: canonical(proposal),
    ...execution,
    parentDigest: null,
    evalRunId: null,
  };
}

describe("Wiki Skill candidate content and structural provenance", () => {
  let root;
  let candidates;
  beforeEach(() => {
    root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-wiki-content-regression-"),
    );
    candidates = candidateFixture(path.join(root, "candidates"));
  });
  afterEach(({ task }) => {
    if (task.result?.state === "pass")
      fs.rmSync(root, { recursive: true, force: true });
    else console.error(`candidate content fixture retained: ${root}`);
  });

  it("persists and reopens the real batch-58 pattern digest without treating it as body PII", async () => {
    expect(digest(BATCH_58_PATTERN)).toBe(BATCH_58_DIGEST);
    expect(BATCH_58_DIGEST).toContain(PHONE);
    const { proposer } = proposalFixture(candidates);
    const result = await proposer.propose();
    const reopened = candidates.open();
    const candidate = reopened.read(result.candidateId);
    expect(candidate.sourceEvidenceRefs).toEqual(
      result.proposal.sourceEvidenceRefs,
    );
    expect(candidate.sourceEvidenceRefs).toContainEqual({
      ref: "evidence://pattern/one",
      digest: BATCH_58_DIGEST,
    });
    expect(candidate.candidateId).toBe(result.candidateId);
    expect(candidate.contentDigest).toBe(result.contentDigest);
    expect(candidate.contentDigest).toBe(digestBytes(candidate.content));
    expect(verifySkillCandidateDraft(candidate)).toEqual(candidate);
    expect(result.proposalDigest).toBe(
      computeWikiSkillProposalDigest(result.proposal),
    );
    expect(JSON.parse(candidate.content).schema).toBe(
      WIKI_SKILL_CANDIDATE_CONTENT_SCHEMA,
    );
    expect(candidate.content).not.toContain(BATCH_58_DIGEST);
    expect(reopened.list()).toEqual([candidate]);
    const stored = JSON.parse(
      fs.readFileSync(candidatePath(reopened, candidate.candidateId), "utf8"),
    );
    expect(stored).toEqual(candidate);
    // The unchanged guard must still reproduce the old serialization defect.
    expect(() =>
      reopened.create(
        legacyCandidateInput(result.proposal, candidates.execution),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "SKILL_CANDIDATE_SECRET_LEAK" }),
    );
    expect(reopened.list()).toEqual([candidate]);
  });

  it("does not grant a caller-controlled candidate-content schema any plaintext exemption", async () => {
    const { proposal } = await proposalFixture(candidates).proposer.draft();
    const content = canonical({
      ...proposal,
      schema: WIKI_SKILL_CANDIDATE_CONTENT_SCHEMA,
    });
    expect(JSON.parse(content).sourceEvidenceRefs).toContainEqual({
      ref: "evidence://pattern/one",
      digest: BATCH_58_DIGEST,
    });
    expect(() =>
      candidates.registry.create({
        ...legacyCandidateInput(proposal, candidates.execution),
        content,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "SKILL_CANDIDATE_SECRET_LEAK" }),
    );
    expect(candidates.open().list()).toEqual([]);
    expect(fs.readdirSync(candidates.registry.rootDir)).toEqual([
      "_tenant.json",
    ]);
  });

  it.each([
    ["plain phone", `Contact ${PHONE}`],
    [
      "escaped JSON string",
      JSON.stringify({ contact: PHONE, note: 'quoted "value" and \\path\n' }),
    ],
    ["Unicode phone", "Contact １４２２９０２９４３５"],
    [
      "JSON-decoded Unicode phone",
      JSON.parse(
        '"\\u0031\\u0034\\u0032\\u0032\\u0039\\u0030\\u0032\\u0039\\u0034\\u0033\\u0035"',
      ),
    ],
  ])(
    "still rejects %s in body content before writing a candidate",
    async (_label, summary) => {
      const { proposer, calls } = proposalFixture(candidates, {
        mutate: (output) => {
          output.purpose.summary = summary;
        },
      });
      await expect(proposer.propose()).rejects.toMatchObject({
        code: "SKILL_CANDIDATE_SECRET_LEAK",
      });
      expect(calls.create).toBe(1);
      expect(candidates.open().list()).toEqual([]);
      expect(fs.readdirSync(candidates.registry.rootDir)).toEqual([
        "_tenant.json",
      ]);
    },
  );

  it.each([
    ["beforeDigest", PHONE],
    ["afterDigest", PHONE],
    ["beforeDigest", BATCH_58_DIGEST],
    ["afterDigest", BATCH_58_DIGEST],
  ])(
    "does not exempt model-supplied machineDiff %s value %s",
    async (field, value) => {
      const { proposer } = proposalFixture(candidates, {
        mutate: (output) => {
          output.machineDiff[0][field] = value;
        },
      });
      await expect(proposer.propose()).rejects.toMatchObject({
        code: "SKILL_CANDIDATE_SECRET_LEAK",
      });
      expect(candidates.open().list()).toEqual([]);
      expect(fs.readdirSync(candidates.registry.rootDir)).toEqual([
        "_tenant.json",
      ]);
    },
  );

  it("rejects a forged evidence digest before crossing the registry boundary", async () => {
    const { proposer, calls } = proposalFixture(candidates, {
      forgedDigest: `sha256:${"a".repeat(64)}`,
    });
    await expect(proposer.propose()).rejects.toMatchObject({
      code: "WIKI_PROPOSAL_UNTRUSTED_EVIDENCE",
    });
    expect(calls.create).toBe(0);
    expect(calls.generate).toBe(1);
    expect(candidates.open().list()).toEqual([]);
  });

  it("rejects unknown proposal fields even after the caller recomputes the draft digest", async () => {
    const { proposer, calls } = proposalFixture(candidates);
    const drafted = await proposer.draft();
    const proposal = { ...drafted.proposal, unreviewedContent: PHONE };
    await expect(
      proposer.createCandidateFromDraft({
        ...drafted,
        proposal,
        proposalDigest: computeWikiSkillProposalDigest(proposal),
      }),
    ).rejects.toMatchObject({ code: "WIKI_PROPOSAL_DRAFT_UNCONFIRMED" });
    expect(calls.create).toBe(0);
    expect(candidates.open().list()).toEqual([]);
  });

  it("binds changed outer evidence digests into candidate identity while identical body bytes retain their digest", async () => {
    // Structural binding only: fixture ports are not an external authenticity
    // authority, and a different valid preimage is not proof of independent evidence.
    const first = await proposalFixture(candidates, {
      sampleCount: 2,
    }).proposer.propose();
    const second = await proposalFixture(candidates, {
      sampleCount: 3,
    }).proposer.propose();
    const reopened = candidates.open();
    const a = reopened.read(first.candidateId);
    const b = reopened.read(second.candidateId);
    expect(a.content).toBe(b.content);
    expect(a.contentDigest).toBe(b.contentDigest);
    expect(a.sourceEvidenceRefs).not.toEqual(b.sourceEvidenceRefs);
    expect(a.candidateId).not.toBe(b.candidateId);
    expect(first.proposalDigest).not.toBe(second.proposalDigest);
    expect(reopened.list()).toHaveLength(2);
  });

  it("reads an existing full-proposal candidate without rewriting its original bytes", async () => {
    const { proposer } = proposalFixture(candidates, {
      pattern: { summary: "A bounded independently checked change" },
    });
    const drafted = await proposer.draft();
    const { proposal } = drafted;
    const oldContent = canonical(proposal);
    expect(JSON.parse(oldContent).schema).toBe(WIKI_SKILL_PROPOSAL_SCHEMA);
    expect(JSON.parse(oldContent).sourceEvidenceRefs).toEqual(
      proposal.sourceEvidenceRefs,
    );
    const { candidate } = candidates.registry.create(
      legacyCandidateInput(proposal, candidates.execution),
    );
    const storedPath = candidatePath(
      candidates.registry,
      candidate.candidateId,
    );
    const originalBytes = fs.readFileSync(storedPath);
    const reopened = candidates.open();
    expect(reopened.read(candidate.candidateId)).toEqual(candidate);
    expect(reopened.read(candidate.candidateId).content).toBe(oldContent);
    expect(fs.readFileSync(storedPath)).toEqual(originalBytes);

    const plan = Object.freeze({
      planDigest: digest("legacy-candidate-plan"),
      candidateId: candidate.candidateId,
      candidateDigest: candidate.contentDigest,
    });
    const planBytes = canonical(plan);
    // The draft read port is a fixture; stage execution, serialization and both
    // immutable candidates use production code. This is not a release receipt.
    const draftPath = path.join(root, "stored-proposal.json");
    fs.writeFileSync(
      draftPath,
      canonical({ outputDigest: drafted.proposalDigest, drafted }),
    );
    const stage = createEvolutionCandidateStage({
      proposer,
      proposalLedger: {
        load(planDigest) {
          if (planDigest !== plan.planDigest)
            throw new Error("wrong proposal plan");
          return JSON.parse(fs.readFileSync(draftPath, "utf8"));
        },
      },
      usage: { tokens: 1, cost: 0, timeMs: 1, turns: 1 },
    });
    await expect(
      stage(
        Object.freeze({
          plan,
          stage: "candidate",
          operationKey: digest("legacy-candidate-stage"),
          inputDigest: drafted.proposalDigest,
        }),
      ),
    ).rejects.toThrow(/does not match the EvolutionPlan candidate digest/u);
    expect(canonical(plan)).toBe(planBytes);
    expect(fs.readFileSync(storedPath)).toEqual(originalBytes);
    expect(candidates.open().read(candidate.candidateId)).toEqual(candidate);
    // A new-format draft may exist, but the old plan receives no stage receipt
    // and cannot silently switch its candidate ID or content digest.
    const retained = candidates.open().list();
    expect(retained).toHaveLength(2);
    const next = retained.find(
      (entry) => entry.candidateId !== candidate.candidateId,
    );
    expect(next.contentDigest).not.toBe(candidate.contentDigest);
    expect(JSON.parse(next.content).schema).toBe(
      WIKI_SKILL_CANDIDATE_CONTENT_SCHEMA,
    );
  });
});
