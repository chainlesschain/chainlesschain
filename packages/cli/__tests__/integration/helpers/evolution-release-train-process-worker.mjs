import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ArtifactStore } from "../../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  createEvolutionCandidateStage,
  createEvolutionProposalStage,
  createEvolutionWikiMaintainStage,
} from "../../../src/lib/evolution/evolution-release-train-domain-stages.js";
import { EvolutionReleaseTrainLedgerAdapter } from "../../../src/lib/evolution/evolution-release-train-ledger-adapter.js";
import {
  EVOLUTION_RELEASE_TRAIN_STAGES,
  createEvolutionPlan,
  createEvolutionReleaseTrain,
  createEvolutionTrainStageReceipt,
} from "../../../src/lib/evolution/evolution-release-train.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "../../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import { WikiInformedSkillProposer } from "../../../src/lib/evolution/wiki-informed-skill-proposer.js";
import { WikiSkillProposalLedgerAdapter } from "../../../src/lib/evolution/wiki-skill-proposal-ledger-adapter.js";

const [rootInput, operation = "run", crashStage = "none"] =
  process.argv.slice(2);
const root = path.resolve(rootInput);
const NOW = "2026-09-05T12:00:00.000Z";
const TENANT = "tenant-process";
const SKILL = "safe-refactor";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const digest = (value) =>
  `sha256:${crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
const domainDigest = (domain, value) =>
  digest(`${domain}\0${canonical(value)}`);

function wikiEvidence(ref, trustDomain) {
  const core = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: TENANT,
    ref,
    sourceDigest: digest(`source:${ref}`),
    projectionDigest: digest(`projection:${ref}`),
    artifactRef: `artifact://${ref}`,
    trustedProjection: true,
    trustDomain,
    kind: "tool-observation",
    status: "active",
    observedAt: NOW,
    expiresAt: null,
    data: { result: "verified" },
  };
  return { ...core, envelopeDigest: digest(core) };
}

const WIKI_EVIDENCE = new Map([
  ["wiki-proof-a", wikiEvidence("wiki-proof-a", "workspace-a")],
  ["wiki-proof-b", wikiEvidence("wiki-proof-b", "workspace-b")],
]);

const WIKI_REQUEST = Object.freeze({
  evidenceRefs: [...WIKI_EVIDENCE.keys()],
  effectiveAt: NOW,
});

function createMaintainer({ load, commit }) {
  return new EvidenceBackedWikiMaintainer({
    descriptor: {
      tenantId: TENANT,
      evolutionRunId: "run-real-prefix",
      maintainerModel: "provider:real-prefix-maintainer",
      rulesDigest: digest("real-prefix-wiki-rules"),
      minCorroboratingSources: 2,
    },
    policy: {
      trustedProjectionRead: true,
      rawEvidenceRead: false,
      activeSkillWrite: false,
      shell: false,
      network: false,
      secretRead: false,
    },
    ports: {
      async loadWiki() {
        const state = load();
        return { trusted: true, state, stateDigest: digestWikiState(state) };
      },
      async resolveEvidence(ref) {
        return WIKI_EVIDENCE.get(ref);
      },
      async derive() {
        return {
          operations: [
            {
              type: "upsert",
              pattern: {
                patternId: "pat-safe-refactor",
                kind: "success",
                summary: "Bounded refactors pass deterministic verification.",
                rootCause: "Small changes preserve observable behavior.",
                procedure: "Apply one bounded change and run fixed tests.",
                appliesWhen: ["deterministic tests exist"],
                doesNotApplyWhen: [],
                positiveEvidence: [...WIKI_EVIDENCE.keys()],
                negativeEvidence: [],
                contradicts: [],
                supersedes: [],
                confidence: 0.8,
                trustDomains: [],
                lastVerifiedAt: NOW,
                expiresAt: null,
                skillNames: [SKILL],
              },
            },
          ],
        };
      },
      async commitRevision({ expectedStateDigest, revision }) {
        const current = load();
        if (digestWikiState(current) !== expectedStateDigest) {
          throw new Error("Wiki state CAS conflict");
        }
        commit(revision.state);
        return {
          committed: true,
          revisionId: revision.revisionId,
          stateDigest: revision.stateDigest,
          evolutionRunId: revision.evolutionRunId,
        };
      },
    },
  });
}

function proposalEnvelope(kind, data, wikiDigest) {
  return {
    kind,
    ref: `wiki://${kind}/${wikiDigest.slice(7)}`,
    data,
    trusted: true,
    digest: digest(data),
  };
}

function createProposer(wikiDigest) {
  const initial = {
    "wiki-index": proposalEnvelope(
      "wiki-index",
      { contradictionRefs: [], wikiDigest },
      wikiDigest,
    ),
    "skill-impact": proposalEnvelope(
      "skill-impact",
      { affectedSkills: [SKILL] },
      wikiDigest,
    ),
    "active-skill": proposalEnvelope(
      "active-skill",
      { skillName: SKILL, digest: digest("baseline-content") },
      wikiDigest,
    ),
    "training-summary": proposalEnvelope(
      "training-summary",
      { sampleCount: 4, passed: 4 },
      wikiDigest,
    ),
  };
  const targetRuntimes = ["node22-process"];
  return new WikiInformedSkillProposer({
    descriptor: {
      tenantId: TENANT,
      evolutionRunId: "run-real-prefix",
      targetSkillName: SKILL,
      wikiRevision: wikiDigest,
      proposerModel: "provider:real-prefix-proposer",
      minEvidenceSamples: 3,
      maxSelectiveEvidence: 1,
    },
    policy: { proposerWikiRead: true, executionAgentWikiRead: false },
    ports: {
      async readInitial(kind) {
        return initial[kind];
      },
      async readSelective() {
        throw new Error("selective evidence is not expected");
      },
      async generate({ evidence }) {
        const refs = evidence.map((item) => item.ref);
        return {
          status: "proposal",
          skillName: SKILL,
          purpose: {
            summary:
              "Apply a bounded refactor backed by durable Wiki evidence.",
            patternRefs: [refs[0]],
            sourceEvidenceRefs: refs,
          },
          applicableWhen: ["deterministic tests exist"],
          notApplicableWhen: ["persisted data migrations are required"],
          failureCounterexamples: ["the public contract changes"],
          rollbackSteps: ["retain the current active release"],
          validationMethods: ["run the fixed target matrix"],
          requestedCapabilities: ["workspace.read"],
          targetRuntimes,
          contextCost: { maxTokens: 800, maxBytes: 4_096 },
          machineDiff: [
            {
              op: "replace",
              path: "SKILL.md",
              beforeDigest: digest("baseline-content"),
              afterDigest: digest("candidate-content"),
            },
          ],
        };
      },
      async createCandidate(input) {
        return {
          created: true,
          candidate: {
            ...input,
            candidateId: domainDigest("real-prefix-candidate-id", input),
            contentDigest: domainDigest("real-prefix-candidate-content", input),
            targetRuntimes,
          },
        };
      },
    },
  });
}

function signingAuthority(label) {
  const secret = `test-only-${label}-process-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://process/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: sign(message) }) },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -70_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
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
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor--;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function artifactPorts() {
  const secret = "test-only-release-train-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "key://process/artifact";
  const policyDigest = digest("artifact-policy");
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return new EvolutionArtifactPorts({
    tenantId: TENANT,
    audience: "evolution-runtime",
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.parse(NOW),
    }),
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
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-05T12:01:00.000Z",
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
          receiptDigest: domainDigest(
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
    now: () => Date.parse(NOW),
  });
}

fs.mkdirSync(path.join(root, "witness"), { recursive: true });
const artifacts = artifactPorts();
const resolver = artifacts.createEvolutionLedgerArtifactResolver({
  purpose: "evolution-ledger",
});
const backend = createEvolutionLedgerFileBackend({
  rootDir: path.join(root, "ledger-events"),
  authorityRootDir: path.join(root, "ledger-authority"),
  witnessFilePath: path.join(root, "witness", "checkpoint.json"),
  witnessId: "release-train-process-witness",
  ledgerAuthority: signingAuthority("ledger"),
  witnessAuthority: signingAuthority("witness"),
  artifactResolver: resolver,
  fsImpl: durableFilesystem(),
  secure: false,
  clock: () => Date.parse(NOW),
});

if (operation === "init") {
  process.stdout.write(`${JSON.stringify({ ok: true, initialized: true })}\n`);
  process.exit(0);
}

const plan = createEvolutionPlan({
  tenantId: TENANT,
  skillId: SKILL,
  gitCommit: "a".repeat(40),
  baselineReleaseDigest: digest("baseline"),
  baselineId: digest("baseline-id"),
  baselineContentDigest: digest("baseline-content"),
  baselineRevision: 1,
  candidateId: digest("candidate-id"),
  candidateDigest: digest("candidate"),
  wikiRevisionDigest: digest("wiki"),
  evalSuiteDigest: digest("eval"),
  matrixEvalPlanDigest: digest("matrix-eval-plan"),
  targetMatrixDigest: digest("matrix"),
  riskTier: "low",
  rolloutPolicyDigest: digest("rollout"),
  metricPolicyDigest: digest("metrics"),
  permissionManifestDigest: digest("permissions"),
  policyDigest: digest("policy"),
  requestedCapabilityDigests: [digest("read")],
  baselineCapabilityDigests: [digest("read")],
  rootBudget: { tokens: 100, cost: 1, timeMs: 60_000, turns: 16 },
  expiresAt: "2030-01-01T00:00:00.000Z",
  triggerDigest: digest("trigger"),
});

const effectsDir = path.join(root, "stage-effects");
fs.mkdirSync(effectsDir, { recursive: true });
async function recordEffect(stage, index, action) {
  const receipt = await action();
  const effectPath = path.join(
    effectsDir,
    `${String(index).padStart(2, "0")}-${stage}.json`,
  );
  let created = false;
  try {
    fs.writeFileSync(effectPath, JSON.stringify(receipt), {
      encoding: "utf8",
      flag: "wx",
    });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const prior = JSON.parse(fs.readFileSync(effectPath, "utf8"));
    if (canonical(prior) !== canonical(receipt)) {
      throw new Error(`stage effect conflict: ${stage}`);
    }
  }
  if (created && crashStage === stage) process.exit(71 + index);
  return receipt;
}

let selectedPlan = plan;
let stages = Object.fromEntries(
  EVOLUTION_RELEASE_TRAIN_STAGES.map((stage, index) => [
    stage,
    (context) =>
      recordEffect(stage, index, () =>
        createEvolutionTrainStageReceipt({
          planDigest: context.plan.planDigest,
          stage,
          operationKey: context.operationKey,
          inputDigest: context.inputDigest,
          outputDigest: digest(`${context.plan.planDigest}:${stage}`),
          accepted: true,
          durable: true,
          usage: { tokens: 1, cost: 0.01, timeMs: 10, turns: 1 },
        }),
      ),
  ]),
);

if (operation === "real-prefix-run") {
  let calibrationState = createEmptyWikiState(TENANT);
  const calibrationMaintainer = createMaintainer({
    load: () => calibrationState,
    commit: (state) => {
      calibrationState = structuredClone(state);
    },
  });
  const calibratedWiki = await calibrationMaintainer.maintain(WIKI_REQUEST);
  const calibratedCandidate = await createProposer(
    calibratedWiki.stateDigest,
  ).propose();
  const selectedPlanInput = structuredClone(plan);
  delete selectedPlanInput.schema;
  delete selectedPlanInput.planDigest;
  selectedPlan = createEvolutionPlan({
    ...selectedPlanInput,
    candidateId: calibratedCandidate.candidateId,
    candidateDigest: calibratedCandidate.contentDigest,
    wikiRevisionDigest: calibratedWiki.stateDigest,
  });

  const wikiStatePath = path.join(root, "real-prefix-wiki-state.json");
  const loadWikiState = () =>
    fs.existsSync(wikiStatePath)
      ? JSON.parse(fs.readFileSync(wikiStatePath, "utf8"))
      : createEmptyWikiState(TENANT);
  const commitWikiState = (state) => {
    const temporary = `${wikiStatePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
    fs.renameSync(temporary, wikiStatePath);
  };
  const maintainer = createMaintainer({
    load: loadWikiState,
    commit: commitWikiState,
  });
  const proposer = createProposer(selectedPlan.wikiRevisionDigest);
  const proposalLedger = new WikiSkillProposalLedgerAdapter({
    descriptor: {
      tenantId: TENANT,
      artifactTenantId: TENANT,
      evolutionRunId: "run-real-prefix",
      skillName: SKILL,
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: artifacts,
    ledger: backend.ledger,
    ledgerArtifactResolver: resolver,
  });
  const realPrefix = {
    "wiki-maintain": createEvolutionWikiMaintainStage({
      maintainer,
      request: WIKI_REQUEST,
      usage: { tokens: 1, cost: 0, timeMs: 1, turns: 1 },
    }),
    propose: createEvolutionProposalStage({
      proposer,
      proposalLedger,
      effectiveAt: NOW,
      usage: { tokens: 1, cost: 0, timeMs: 1, turns: 1 },
    }),
    candidate: createEvolutionCandidateStage({
      proposer,
      proposalLedger,
      usage: { tokens: 1, cost: 0, timeMs: 1, turns: 1 },
    }),
  };
  stages = Object.fromEntries(
    EVOLUTION_RELEASE_TRAIN_STAGES.map((stage, index) => [
      stage,
      Object.hasOwn(realPrefix, stage)
        ? (context) =>
            recordEffect(stage, index, () => realPrefix[stage](context))
        : stages[stage],
    ]),
  );
}

const adapter = new EvolutionReleaseTrainLedgerAdapter({
  descriptor: {
    tenantId: TENANT,
    artifactTenantId: TENANT,
    skillName: SKILL,
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
  },
  artifactPorts: artifacts,
  ledger: backend.ledger,
  ledgerArtifactResolver: resolver,
  clock: () => NOW,
});
const result = await createEvolutionReleaseTrain({
  plan: selectedPlan,
  stateStore: adapter.createStateStore(),
  stages,
  clock: () => Date.parse(NOW),
}).run();
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    pid: process.pid,
    stateDigest: result.state.stateDigest,
    stageIndex: result.state.stageIndex,
    effectCount: fs.readdirSync(effectsDir).length,
    ledgerEventCount: backend.ledger.verify().eventCount,
  })}\n`,
);
