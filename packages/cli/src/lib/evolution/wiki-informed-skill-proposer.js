import { createHash } from "node:crypto";

export const WIKI_SKILL_PROPOSAL_SCHEMA =
  "chainlesschain.wiki-informed-skill-proposal/v1";
export const WIKI_PROPOSAL_STATUS = Object.freeze({
  PROPOSAL: "proposal",
  NO_PROPOSAL: "no-proposal",
  NEEDS_EVIDENCE: "needs-evidence",
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const INITIAL_SOURCES = Object.freeze([
  "wiki-index",
  "skill-impact",
  "active-skill",
  "training-summary",
]);
const SELECTIVE_SOURCES = new Set(["pattern", "raw"]);
const SAFE_DIFF_ROOTS = new Set([
  "SKILL.md",
  "PURPOSE.md",
  "assets",
  "references",
  "scripts",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function computeWikiSkillProposalDigest(proposal) {
  return hash(proposal);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function stringList(value, name, { allowEmpty = false, max = 64 } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > max ||
    value.some((item) => typeof item !== "string" || item.trim() === "") ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(`${name} must be a bounded unique string list`);
  }
  return [...value];
}

function verifyEnvelope(value, expectedKind) {
  if (
    !value ||
    typeof value !== "object" ||
    value.kind !== expectedKind ||
    value.trusted !== true ||
    typeof value.ref !== "string" ||
    !DIGEST.test(value.digest ?? "") ||
    value.digest !== hash(value.data)
  ) {
    const error = new Error(
      `${expectedKind} evidence is not digest-bound and trusted`,
    );
    error.code = "WIKI_PROPOSAL_UNTRUSTED_EVIDENCE";
    throw error;
  }
  return deepFreeze({
    kind: value.kind,
    ref: value.ref,
    digest: value.digest,
    data: structuredClone(value.data),
  });
}

function normalizeDescriptor(input) {
  const descriptor = {
    tenantId: requiredString(input?.tenantId, "tenantId"),
    evolutionRunId: requiredString(input?.evolutionRunId, "evolutionRunId"),
    targetSkillName: requiredString(input?.targetSkillName, "targetSkillName"),
    wikiRevision: requiredString(input?.wikiRevision, "wikiRevision"),
    proposerModel: requiredString(input?.proposerModel, "proposerModel"),
    minEvidenceSamples: Math.max(1, Number(input?.minEvidenceSamples) || 1),
    maxSelectiveEvidence: Math.min(
      16,
      Math.max(0, Number(input?.maxSelectiveEvidence) || 4),
    ),
  };
  if (!SKILL_NAME.test(descriptor.targetSkillName)) {
    throw new TypeError("targetSkillName must be canonical kebab-case");
  }
  return deepFreeze(descriptor);
}

function validateDiff(diff) {
  if (!Array.isArray(diff) || diff.length === 0 || diff.length > 128) {
    throw new TypeError("machineDiff must contain 1..128 operations");
  }
  return diff.map((entry) => {
    if (!entry || !["add", "replace", "remove"].includes(entry.op)) {
      throw new TypeError("machineDiff operation is invalid");
    }
    const path = requiredString(entry.path, "machineDiff.path").replaceAll(
      "\\",
      "/",
    );
    const parts = path.split("/");
    if (
      path.startsWith("/") ||
      parts.includes("..") ||
      !SAFE_DIFF_ROOTS.has(parts[0]) ||
      /(^|\/)(active|\.chainlesschain)(\/|$)/u.test(path)
    ) {
      const error = new Error("machineDiff escaped the single candidate Skill");
      error.code = "WIKI_PROPOSAL_UNSAFE_DIFF";
      throw error;
    }
    return {
      op: entry.op,
      path,
      beforeDigest: entry.beforeDigest ?? null,
      afterDigest: entry.afterDigest ?? null,
    };
  });
}

function validateProposal(output, descriptor, evidence) {
  if (output?.status !== WIKI_PROPOSAL_STATUS.PROPOSAL) {
    throw new TypeError("proposal output status is invalid");
  }
  if (output.skillName !== descriptor.targetSkillName) {
    const error = new Error(
      "proposer attempted to change more than the fixed Skill",
    );
    error.code = "WIKI_PROPOSAL_MULTI_SKILL";
    throw error;
  }
  const knownRefs = new Set(evidence.map((item) => item.ref));
  const purpose = {
    summary: requiredString(output.purpose?.summary, "purpose.summary"),
    patternRefs: stringList(output.purpose?.patternRefs, "purpose.patternRefs"),
    sourceEvidenceRefs: stringList(
      output.purpose?.sourceEvidenceRefs,
      "purpose.sourceEvidenceRefs",
    ),
  };
  for (const ref of [...purpose.patternRefs, ...purpose.sourceEvidenceRefs]) {
    if (!knownRefs.has(ref)) {
      const error = new Error(
        "PURPOSE references evidence outside the resolved set",
      );
      error.code = "WIKI_PROPOSAL_UNKNOWN_LINEAGE";
      throw error;
    }
  }
  const contextCost = {
    maxTokens: Number(output.contextCost?.maxTokens),
    maxBytes: Number(output.contextCost?.maxBytes),
  };
  if (
    !Number.isInteger(contextCost.maxTokens) ||
    contextCost.maxTokens <= 0 ||
    !Number.isInteger(contextCost.maxBytes) ||
    contextCost.maxBytes <= 0
  ) {
    throw new TypeError("contextCost must provide positive maxTokens/maxBytes");
  }
  return deepFreeze({
    schema: WIKI_SKILL_PROPOSAL_SCHEMA,
    status: WIKI_PROPOSAL_STATUS.PROPOSAL,
    tenantId: descriptor.tenantId,
    evolutionRunId: descriptor.evolutionRunId,
    skillName: descriptor.targetSkillName,
    purpose,
    applicableWhen: stringList(output.applicableWhen, "applicableWhen"),
    notApplicableWhen: stringList(
      output.notApplicableWhen,
      "notApplicableWhen",
    ),
    failureCounterexamples: stringList(
      output.failureCounterexamples,
      "failureCounterexamples",
    ),
    rollbackSteps: stringList(output.rollbackSteps, "rollbackSteps"),
    validationMethods: stringList(
      output.validationMethods,
      "validationMethods",
    ),
    requestedCapabilities: stringList(
      output.requestedCapabilities,
      "requestedCapabilities",
      { allowEmpty: true },
    ),
    targetRuntimes: stringList(output.targetRuntimes, "targetRuntimes"),
    contextCost,
    machineDiff: validateDiff(output.machineDiff),
    sourceEvidenceRefs: evidence.map(({ ref, digest }) => ({ ref, digest })),
    wikiRevision: descriptor.wikiRevision,
    proposerModel: descriptor.proposerModel,
  });
}

function abstention(status, reason, evidence = []) {
  return deepFreeze({
    schema: WIKI_SKILL_PROPOSAL_SCHEMA,
    status,
    reason,
    sourceEvidenceRefs: evidence.map(({ ref, digest }) => ({ ref, digest })),
  });
}

export class WikiInformedSkillProposer {
  constructor({ descriptor, policy, ports } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    if (
      policy?.proposerWikiRead !== true ||
      policy?.executionAgentWikiRead === true
    ) {
      throw new Error(
        "capability policy must isolate Wiki reads to the proposer",
      );
    }
    if (typeof ports?.readInitial !== "function")
      throw new TypeError("readInitial port is required");
    if (typeof ports?.readSelective !== "function")
      throw new TypeError("readSelective port is required");
    if (typeof ports?.generate !== "function")
      throw new TypeError("generate port is required");
    if (typeof ports?.createCandidate !== "function")
      throw new TypeError("createCandidate port is required");
    this._ports = ports;
    Object.freeze(this);
  }

  async draft() {
    const initial = [];
    for (const kind of INITIAL_SOURCES) {
      initial.push(verifyEnvelope(await this._ports.readInitial(kind), kind));
    }
    const wiki = initial.find((item) => item.kind === "wiki-index");
    const training = initial.find((item) => item.kind === "training-summary");
    if ((wiki.data?.contradictionRefs?.length ?? 0) > 0) {
      return abstention(
        WIKI_PROPOSAL_STATUS.NEEDS_EVIDENCE,
        "wiki evidence is contradictory",
        initial,
      );
    }
    if (
      Number(training.data?.sampleCount) < this.descriptor.minEvidenceSamples
    ) {
      return abstention(
        WIKI_PROPOSAL_STATUS.NEEDS_EVIDENCE,
        "training evidence sample is insufficient",
        initial,
      );
    }

    let evidence = [...initial];
    let output = await this._ports.generate({
      descriptor: this.descriptor,
      evidence: deepFreeze([...evidence]),
    });
    if (output?.status === WIKI_PROPOSAL_STATUS.NO_PROPOSAL) {
      return abstention(
        output.status,
        requiredString(output.reason, "reason"),
        evidence,
      );
    }
    if (output?.status === WIKI_PROPOSAL_STATUS.NEEDS_EVIDENCE) {
      const requests = output.requests;
      if (
        !Array.isArray(requests) ||
        requests.length === 0 ||
        requests.length > this.descriptor.maxSelectiveEvidence
      ) {
        return abstention(
          output.status,
          "selective evidence request is invalid",
          evidence,
        );
      }
      for (const request of requests) {
        if (!SELECTIVE_SOURCES.has(request?.kind)) {
          return abstention(
            output.status,
            "requested evidence scope is not allowed",
            evidence,
          );
        }
        evidence.push(
          verifyEnvelope(
            await this._ports.readSelective(request.kind, request.ref),
            request.kind,
          ),
        );
      }
      output = await this._ports.generate({
        descriptor: this.descriptor,
        evidence: deepFreeze([...evidence]),
      });
      if (output?.status !== WIKI_PROPOSAL_STATUS.PROPOSAL) {
        return abstention(
          output?.status === WIKI_PROPOSAL_STATUS.NO_PROPOSAL
            ? output.status
            : WIKI_PROPOSAL_STATUS.NEEDS_EVIDENCE,
          requiredString(output?.reason, "reason"),
          evidence,
        );
      }
    }

    const proposal = validateProposal(output, this.descriptor, evidence);
    const proposalDigest = computeWikiSkillProposalDigest(proposal);
    return deepFreeze({
      status: WIKI_PROPOSAL_STATUS.PROPOSAL,
      proposal,
      proposalDigest,
    });
  }

  async propose() {
    const drafted = await this.draft();
    if (drafted.status !== WIKI_PROPOSAL_STATUS.PROPOSAL) return drafted;
    return this.createCandidateFromDraft(drafted);
  }

  async createCandidateFromDraft(drafted) {
    const proposal = drafted?.proposal;
    const sourceEvidenceRefs = Array.isArray(proposal?.sourceEvidenceRefs)
      ? proposal.sourceEvidenceRefs
      : [];
    const normalized = validateProposal(
      proposal,
      this.descriptor,
      sourceEvidenceRefs,
    );
    if (
      drafted?.status !== WIKI_PROPOSAL_STATUS.PROPOSAL ||
      proposal?.schema !== WIKI_SKILL_PROPOSAL_SCHEMA ||
      proposal?.tenantId !== this.descriptor.tenantId ||
      proposal?.evolutionRunId !== this.descriptor.evolutionRunId ||
      canonical(normalized) !== canonical(proposal) ||
      drafted?.proposalDigest !== computeWikiSkillProposalDigest(proposal)
    ) {
      const error = new Error(
        "draft is not an exact proposal bound to this proposer",
      );
      error.code = "WIKI_PROPOSAL_DRAFT_UNCONFIRMED";
      throw error;
    }
    const { proposalDigest } = drafted;
    const candidateInput = deepFreeze({
      tenantId: proposal.tenantId,
      skillName: proposal.skillName,
      derivationMode: "wiki",
      wikiRevision: proposal.wikiRevision,
      proposerModel: proposal.proposerModel,
      requestedCapabilities: proposal.requestedCapabilities,
      sourceEvidenceRefs: proposal.sourceEvidenceRefs,
      content: canonical(proposal),
    });
    const created = await this._ports.createCandidate(candidateInput);
    const candidate = created?.candidate;
    if (
      typeof candidate?.candidateId !== "string" ||
      typeof candidate?.contentDigest !== "string" ||
      candidate.skillName !== proposal.skillName ||
      candidate.content !== candidateInput.content ||
      candidate.derivationMode !== "wiki" ||
      candidate.wikiRevision !== proposal.wikiRevision ||
      candidate.proposerModel !== proposal.proposerModel ||
      canonical(candidate.requestedCapabilities) !==
        canonical(proposal.requestedCapabilities) ||
      canonical(candidate.targetRuntimes) !==
        canonical(proposal.targetRuntimes) ||
      canonical(candidate.sourceEvidenceRefs) !==
        canonical(proposal.sourceEvidenceRefs)
    ) {
      const error = new Error(
        "candidate sink did not return an exact immutable proposal binding",
      );
      error.code = "WIKI_PROPOSAL_CANDIDATE_UNCONFIRMED";
      throw error;
    }
    return deepFreeze({
      status: WIKI_PROPOSAL_STATUS.PROPOSAL,
      proposal,
      proposalDigest,
      candidateId: candidate.candidateId,
      contentDigest: candidate.contentDigest,
    });
  }
}

export function createWikiInformedSkillProposer(options) {
  return new WikiInformedSkillProposer(options);
}
