import { createEvolutionTrainStageReceipt } from "./evolution-release-train.js";
import { WIKI_PROPOSAL_STATUS } from "./wiki-informed-skill-proposer.js";

const STAGES = Object.freeze({
  WIKI: "wiki-maintain",
  PROPOSE: "propose",
  CANDIDATE: "candidate",
});

function capture(owner, method, name) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${name}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function stageReceipt(context, outputDigest, usage) {
  return createEvolutionTrainStageReceipt({
    planDigest: context.plan.planDigest,
    stage: context.stage,
    operationKey: context.operationKey,
    inputDigest: context.inputDigest,
    outputDigest,
    accepted: true,
    durable: true,
    usage,
  });
}

function assertStage(context, expected) {
  if (context?.stage !== expected)
    throw new Error(`${expected} adapter received a different stage`);
}

export function createEvolutionWikiMaintainStage({
  maintainer,
  request,
  usage,
} = {}) {
  const maintain = capture(maintainer, "maintain", "maintainer");
  const boundRequest = freezeClone(request);
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.WIKI);
    const result = await maintain(boundRequest);
    if (result?.stateDigest !== context.plan.wikiRevisionDigest)
      throw new Error(
        "wiki-maintain output does not match the EvolutionPlan Wiki digest",
      );
    return stageReceipt(context, result.stateDigest, boundUsage);
  });
}

export function createEvolutionProposalStage({
  proposer,
  proposalLedger,
  effectiveAt,
  usage,
} = {}) {
  const draft = capture(proposer, "draft", "proposer");
  const load = capture(proposalLedger, "load", "proposalLedger");
  const commit = capture(proposalLedger, "commit", "proposalLedger");
  const timestamp = new Date(effectiveAt).toISOString();
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.PROPOSE);
    let stored = load(context.plan.planDigest);
    if (stored) {
      if (
        stored.operationKey !== context.operationKey ||
        stored.inputDigest !== context.inputDigest
      )
        throw new Error("stored proposal is bound to a different stage input");
    } else {
      const drafted = await draft();
      if (drafted?.status !== WIKI_PROPOSAL_STATUS.PROPOSAL)
        throw new Error(`proposer abstained with status ${drafted?.status}`);
      commit({
        planDigest: context.plan.planDigest,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        drafted,
        effectiveAt: timestamp,
      });
      stored = load(context.plan.planDigest);
    }
    if (!stored)
      throw new Error("proposal was not durably recoverable after commit");
    return stageReceipt(context, stored.outputDigest, boundUsage);
  });
}

export function createEvolutionCandidateStage({
  proposer,
  proposalLedger,
  usage,
} = {}) {
  const createCandidate = capture(
    proposer,
    "createCandidateFromDraft",
    "proposer",
  );
  const load = capture(proposalLedger, "load", "proposalLedger");
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.CANDIDATE);
    const stored = load(context.plan.planDigest);
    if (!stored || stored.outputDigest !== context.inputDigest)
      throw new Error(
        "candidate stage could not resolve its exact proposal input",
      );
    const created = await createCandidate(stored.drafted);
    if (created?.contentDigest !== context.plan.candidateDigest)
      throw new Error(
        "candidate output does not match the EvolutionPlan candidate digest",
      );
    return stageReceipt(context, created.contentDigest, boundUsage);
  });
}
