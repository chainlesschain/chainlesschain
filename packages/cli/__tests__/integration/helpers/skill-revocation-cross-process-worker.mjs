import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "../../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA,
  INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
  createIndependentSkillRevocationSource,
  digestIndependentSkillRevocationRecord,
} from "../../../src/lib/evolution/independent-skill-revocation-source.js";
import {
  SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
  SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
  createSkillRevocationPropagation,
} from "../../../src/lib/evolution/skill-revocation-propagation.js";
import {
  SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
  SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
  createSkillWikiReconciler,
} from "../../../src/lib/evolution/skill-wiki-reconciliation.js";

const [root, operation, crashPoint = "none"] = process.argv.slice(2);
mkdirSync(root, { recursive: true });

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const D = (value) =>
  `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const file = (name) => join(root, `${name}.json`);
const load = (name, fallback) =>
  existsSync(file(name))
    ? JSON.parse(readFileSync(file(name), "utf8"))
    : structuredClone(fallback);
function save(name, value) {
  const temporary = `${file(name)}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), "utf8");
  renameSync(temporary, file(name));
}

function externalSource() {
  const unsigned = {
    schema: INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA,
    tenantId: "tenant-a",
    streamId: "security-revocations",
    sequence: 1,
    revocationId: "security-incident-1",
    candidateId: D("candidate"),
    skillName: "safe-refactor",
    reason: "Independent security authority revoked the active Skill.",
    occurredAt: "2026-09-05T10:00:00.000Z",
    activeStateDigest: D("active-state"),
    evidenceReceiptDigests: [D("incident")],
    attestation: {
      algorithm: "ed25519",
      keyId: "security-key-1",
      value: "A".repeat(64),
    },
  };
  const record = {
    ...unsigned,
    recordDigest: digestIndependentSkillRevocationRecord(unsigned),
  };
  return createIndependentSkillRevocationSource({
    tenantId: "tenant-a",
    streamId: "security-revocations",
    ports: {
      readRevocations: async () => [record],
      verifyRevocation: async (request) => ({
        schema: INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: request.tenantId,
        streamId: request.streamId,
        sequence: request.sequence,
        recordDigest: request.recordDigest,
        receiptDigest: D(["verified", request.recordDigest]),
      }),
    },
  });
}

function evidence(ref, trustDomain) {
  const core = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: "tenant-a",
    ref,
    sourceDigest: D(["source", ref]),
    projectionDigest: D(["projection", ref]),
    artifactRef: `artifact://${ref}`,
    trustedProjection: true,
    trustDomain,
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
    data: { result: "verified" },
  };
  return { ...core, envelopeDigest: D(core) };
}

async function wiki() {
  let wikiState = load("wiki", createEmptyWikiState("tenant-a"));
  const retained = load("evidence", {});
  const base = {
    "ev-1": evidence("ev-1", "workspace-a"),
    "ev-2": evidence("ev-2", "workspace-b"),
  };
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor: {
      tenantId: "tenant-a",
      evolutionRunId: "run-cross-process",
      maintainerModel: "provider:maintainer-v1",
      rulesDigest: D("rules"),
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
      loadWiki: async () => ({
        trusted: true,
        state: wikiState,
        stateDigest: digestWikiState(wikiState),
      }),
      resolveEvidence: async (ref) => retained[ref] ?? base[ref],
      derive: async ({ evidence: items }) => {
        const proposal = items.find(
          (item) => item.kind === "proposal-decision",
        );
        return proposal
          ? {
              operations: [
                {
                  type: "proposal-impact",
                  decision: {
                    ...proposal.data.decision,
                    receiptRef: proposal.ref,
                  },
                },
              ],
            }
          : {
              operations: [
                {
                  type: "upsert",
                  pattern: {
                    patternId: "pat-safe-refactor",
                    kind: "success",
                    summary:
                      "Bounded refactors pass deterministic verification.",
                    rootCause: "Small changes preserve behavior.",
                    procedure: "Apply one bounded change and test.",
                    appliesWhen: ["tests exist"],
                    doesNotApplyWhen: [],
                    positiveEvidence: ["ev-1", "ev-2"],
                    negativeEvidence: [],
                    contradicts: [],
                    supersedes: [],
                    confidence: 0.8,
                    trustDomains: [],
                    lastVerifiedAt: "2026-09-01T00:00:00.000Z",
                    expiresAt: null,
                    skillNames: ["safe-refactor"],
                  },
                },
              ],
            };
      },
      commitRevision: async ({ revision }) => {
        wikiState = revision.state;
        save("wiki", wikiState);
        return {
          committed: true,
          revisionId: revision.revisionId,
          stateDigest: revision.stateDigest,
          evolutionRunId: revision.evolutionRunId,
        };
      },
    },
  });
  if (!wikiState.patterns["pat-safe-refactor"]) {
    await maintainer.maintain({
      evidenceRefs: ["ev-1", "ev-2"],
      effectiveAt: "2026-09-01T00:00:00.000Z",
    });
  }
  const source = externalSource();
  const reconciler = createSkillWikiReconciler({
    source,
    maintainer,
    ports: {
      resolveImpact: async (event) => ({
        schema: SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: "tenant-a",
        transitionDigest: event.transitionDigest,
        candidateId: event.candidateId,
        skillName: event.skillName,
        wikiRevision: event.wikiRevision,
        patternRefs: ["pat-safe-refactor"],
        reason: event.reason,
        receiptDigest: D("impact"),
      }),
      retainEvidence: async (item) => {
        retained[item.ref] = item;
        save("evidence", retained);
        return {
          schema: SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: "tenant-a",
          ref: item.ref,
          envelopeDigest: item.envelopeDigest,
          receiptDigest: D(["retain", item.ref]),
        };
      },
      loadCheckpoint: async () => load("wiki-checkpoint", null),
      commitCheckpoint: async ({ checkpoint }) => {
        save("wiki-checkpoint", checkpoint);
        return {
          authenticated: true,
          durable: true,
          committed: true,
          checkpointDigest: checkpoint.checkpointDigest,
        };
      },
    },
    crashHook() {
      if (crashPoint === "after-wiki-commit") process.exit(92);
    },
  });
  await reconciler.reconcile();
}

async function propagate() {
  const source = externalSource();
  const effectState = load("effects", {});
  const dependencies = [
    ["wiki-pattern", "stale"],
    ["memory", "quarantine"],
    ["retrieval-index", "invalidate"],
    ["marketplace-badge", "revoke"],
  ]
    .map(([kind, disposition]) => ({
      kind,
      disposition,
      ref: `${kind}://tenant-a/safe-refactor`,
      digest: D([kind, "dependency"]),
    }))
    .sort((a, b) => `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`));
  const effect = async (request) => {
    const prior = effectState[request.operationId];
    if (!prior) {
      effectState[request.operationId] = {
        applyCount: 1,
        requestDigest: request.requestDigest,
        receiptDigest: D(["effect", request.operationId]),
      };
      save("effects", effectState);
    } else if (prior.requestDigest !== request.requestDigest)
      throw new Error("operation substitution");
    return {
      schema: SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      tenantId: request.tenantId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      dependencyKind: request.dependency.kind,
      dependencyRef: request.dependency.ref,
      dependencyDigest: request.dependency.digest,
      disposition: request.dependency.disposition,
      receiptDigest: effectState[request.operationId].receiptDigest,
    };
  };
  const propagation = createSkillRevocationPropagation({
    source,
    ports: {
      resolveDependencies: async (event) => {
        const core = {
          schema: SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
          tenantId: "tenant-a",
          transitionDigest: event.transitionDigest,
          candidateId: event.candidateId,
          skillName: event.skillName,
          completeKinds: [
            "wiki-pattern",
            "memory",
            "retrieval-index",
            "marketplace-badge",
          ],
          dependencies,
        };
        return {
          ...core,
          authenticated: true,
          durable: true,
          resolutionDigest: D(core),
          receiptDigest: D("resolution"),
        };
      },
      stalePattern: effect,
      quarantineMemory: effect,
      invalidateRetrieval: effect,
      revokeMarketplaceBadge: effect,
      loadCheckpoint: async () => load("propagation-checkpoint", null),
      commitCheckpoint: async ({ checkpoint }) => {
        save("propagation-checkpoint", checkpoint);
        if (crashPoint === "after-checkpoint-commit") process.exit(94);
        return {
          authenticated: true,
          durable: true,
          committed: true,
          checkpointDigest: checkpoint.checkpointDigest,
        };
      },
    },
    crashHook() {
      if (crashPoint === "after-dependencies") process.exit(93);
    },
  });
  await propagation.propagate();
}

if (operation === "wiki") await wiki();
else if (operation === "propagate") await propagate();
else throw new Error("unknown operation");
