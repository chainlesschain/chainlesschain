import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { createEvolutionTrainStageReceipt } from "./evolution-release-train.js";
import {
  evaluateSkillTargetMatrix,
  verifySkillTargetMatrixEvalReceipt,
} from "./skill-target-matrix-eval.js";
import { buildSkillPromotionReviewPacket } from "./skill-promotion-review.js";
import { WIKI_PROPOSAL_STATUS } from "./wiki-informed-skill-proposer.js";

const STAGES = Object.freeze({
  WIKI: "wiki-maintain",
  PROPOSE: "propose",
  CANDIDATE: "candidate",
  EVAL: "eval",
  REVIEW: "review",
  PILOT: "pilot",
  PROMOTION: "promotion",
  WIKI_IMPACT: "wiki-impact",
});

function capture(owner, method, name) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${name}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function assertMatrixEvalPlanBinding(receipt, expected, plan, planRef) {
  if (
    planRef?.digest !== plan.matrixEvalPlanDigest ||
    expected.planDigest !== plan.matrixEvalPlanDigest ||
    expected.tenantId !== plan.tenantId ||
    expected.skillName !== plan.skillId ||
    expected.candidateId !== plan.candidateId ||
    expected.candidateContentDigest !== plan.candidateDigest ||
    expected.baselineId !== plan.baselineId ||
    expected.baselineReleaseDigest !== plan.baselineReleaseDigest ||
    expected.expectedActiveContentDigest !== plan.baselineContentDigest ||
    expected.expectedActiveRevision !== plan.baselineRevision ||
    expected.targetMatrixRoot !== plan.targetMatrixDigest ||
    expected.decision !== "accepted" ||
    receipt.tenantId !== plan.tenantId ||
    receipt.skillName !== plan.skillId ||
    receipt.candidateId !== plan.candidateId ||
    receipt.candidateContentDigest !== plan.candidateDigest ||
    receipt.baselineId !== plan.baselineId ||
    receipt.baselineReleaseDigest !== plan.baselineReleaseDigest ||
    receipt.expectedActiveContentDigest !== plan.baselineContentDigest ||
    receipt.expectedActiveRevision !== plan.baselineRevision ||
    receipt.targetMatrixRoot !== plan.targetMatrixDigest ||
    receipt.planDigest !== plan.matrixEvalPlanDigest ||
    receipt.decision !== "accepted" ||
    !Array.isArray(receipt.cellResults) ||
    receipt.cellResults.length === 0 ||
    receipt.cellResults.some(
      (cell) =>
        cell.suiteDigest !== plan.evalSuiteDigest ||
        cell.policyDigest !== plan.policyDigest,
    )
  )
    throw new Error(
      "matrix evaluation receipt is not bound to the EvolutionPlan",
    );
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function bindPromotionInput(value) {
  const capability = value?.authorization?.capability;
  if (!capability) return freezeClone(value);
  const { authorization, ...request } = value;
  const authorizationData = { ...authorization };
  delete authorizationData.capability;
  return Object.freeze({
    ...freezeClone(request),
    authorization: Object.freeze({
      ...freezeClone(authorizationData),
      // Mutation capabilities are opaque identity tokens held in an
      // authority WeakMap. Cloning them turns a valid capability into a
      // forgery, so preserve the already-frozen authority object itself.
      capability,
    }),
  });
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function dataRecord(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(`${label} must be a plain non-proxy object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw new TypeError(`${label} must contain only enumerable data fields`);
  }
  return value;
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
    if (
      created?.candidateId !== context.plan.candidateId ||
      created?.contentDigest !== context.plan.candidateDigest
    )
      throw new Error(
        "candidate output does not match the EvolutionPlan candidate digest",
      );
    return stageReceipt(context, created.contentDigest, boundUsage);
  });
}

export function createEvolutionEvalStage({
  aggregator,
  receiptVerifier,
  planRef,
  expectedReceipt,
  durability,
  outputLedger,
  usage,
} = {}) {
  const load = capture(outputLedger, "load", "outputLedger");
  const commit = capture(outputLedger, "commit", "outputLedger");
  const retain = capture(durability, "retain", "durability");
  const boundPlanRef = freezeClone(planRef);
  const boundExpected = freezeClone(expectedReceipt);
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.EVAL);
    let stored = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.EVAL,
    });
    let receipt;
    if (stored) {
      if (
        stored.operationKey !== context.operationKey ||
        stored.inputDigest !== context.inputDigest
      )
        throw new Error(
          "stored evaluation is bound to a different stage input",
        );
      receipt = stored.value;
    } else {
      receipt = await evaluateSkillTargetMatrix(aggregator, boundPlanRef);
    }
    assertMatrixEvalPlanBinding(
      receipt,
      boundExpected,
      context.plan,
      boundPlanRef,
    );
    const verified = await verifySkillTargetMatrixEvalReceipt(
      receiptVerifier,
      receipt,
      boundExpected,
    );
    if (verified.decision !== "accepted")
      throw new Error(`matrix evaluation did not accept: ${verified.decision}`);
    const retained = await retain(verified);
    if (
      retained?.durable !== true ||
      retained?.receiptDigest !== verified.receiptDigest
    )
      throw new Error("matrix evaluation durability was not confirmed");
    if (!stored) {
      commit({
        planDigest: context.plan.planDigest,
        stage: STAGES.EVAL,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        outputDigest: verified.receiptDigest,
        value: verified,
        effectiveAt: verified.issuedAt,
      });
      stored = load({
        planDigest: context.plan.planDigest,
        stage: STAGES.EVAL,
      });
    }
    if (
      !stored ||
      stored.outputDigest !== verified.receiptDigest ||
      stored.valueDigest === undefined
    )
      throw new Error("evaluation receipt was not durably recoverable");
    return stageReceipt(context, verified.receiptDigest, boundUsage);
  });
}

export function createEvolutionReviewStage({
  reviewLedger,
  packetInput,
  outputLedger,
  usage,
} = {}) {
  const submitPacket = capture(reviewLedger, "submitPacket", "reviewLedger");
  const listReviews = capture(reviewLedger, "listReviews", "reviewLedger");
  const load = capture(outputLedger, "load", "outputLedger");
  const commit = capture(outputLedger, "commit", "outputLedger");
  const boundPacketInput = freezeClone(packetInput);
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.REVIEW);
    const packet = buildSkillPromotionReviewPacket(boundPacketInput);
    if (
      context.inputDigest !== packet.evaluation.matrixReceiptDigest ||
      packet.tenantId !== context.plan.tenantId ||
      packet.skillName !== context.plan.skillId ||
      packet.candidateId !== context.plan.candidateId ||
      packet.candidateContentDigest !== context.plan.candidateDigest ||
      packet.baselineReleaseDigest !== context.plan.baselineReleaseDigest ||
      packet.expectedActiveRevision !== context.plan.baselineRevision
    )
      throw new Error("review packet is not bound to the EvolutionPlan");
    const stored = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.REVIEW,
    });
    if (
      stored &&
      (stored.operationKey !== context.operationKey ||
        stored.inputDigest !== context.inputDigest)
    )
      throw new Error("stored review is bound to a different stage input");
    await submitPacket(packet);
    const reviews = await listReviews();
    const matches = reviews.filter(
      (review) => review.packet?.packetDigest === packet.packetDigest,
    );
    if (matches.length !== 1)
      throw new Error("review packet is missing or ambiguous after submission");
    const review = matches[0];
    if (review.status === "pending") {
      const error = new Error("human promotion review is pending");
      error.code = "EVOLUTION_RELEASE_TRAIN_REVIEW_PENDING";
      throw error;
    }
    if (review.status !== "approved" || !review.decision?.receiptDigest)
      throw new Error(
        `human promotion review did not approve: ${review.status}`,
      );
    if (!stored) {
      commit({
        planDigest: context.plan.planDigest,
        stage: STAGES.REVIEW,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        outputDigest: review.decision.receiptDigest,
        value: { packet: review.packet, decision: review.decision },
        effectiveAt: review.decision.decidedAt,
      });
    } else if (stored.outputDigest !== review.decision.receiptDigest) {
      throw new Error(
        "stored review decision differs from the durable authority",
      );
    }
    const recovered = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.REVIEW,
    });
    if (!recovered || recovered.outputDigest !== review.decision.receiptDigest)
      throw new Error("review decision was not durably recoverable");
    return stageReceipt(context, review.decision.receiptDigest, boundUsage);
  });
}

export function createEvolutionPilotStage({
  pilot,
  startRequest,
  approvalInput,
  nextAdvanceInput,
  effectiveAt,
  outputLedger,
  usage,
} = {}) {
  const start = capture(pilot, "start", "pilot");
  const approveShadow = capture(pilot, "approveShadow", "pilot");
  const advance = capture(pilot, "advance", "pilot");
  const reconcile = capture(pilot, "reconcilePendingTransition", "pilot");
  const snapshot = capture(pilot, "snapshot", "pilot");
  const view = capture(pilot, "view", "pilot");
  if (typeof nextAdvanceInput !== "function")
    throw new TypeError("nextAdvanceInput() is required");
  const load = capture(outputLedger, "load", "outputLedger");
  const commit = capture(outputLedger, "commit", "outputLedger");
  const boundStart = freezeClone(startRequest);
  const boundApproval = freezeClone(approvalInput);
  const timestamp = new Date(effectiveAt).toISOString();
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.PILOT);
    const review = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.REVIEW,
    });
    if (
      !review ||
      review.outputDigest !== context.inputDigest ||
      review.value?.decision?.receiptDigest !== context.inputDigest ||
      pilot.descriptor?.tenantId !== context.plan.tenantId ||
      pilot.descriptor?.skillName !== context.plan.skillId ||
      pilot.descriptor?.candidateDigest !== context.plan.candidateDigest ||
      pilot.descriptor?.baselineDigest !== context.plan.baselineReleaseDigest ||
      pilot.descriptor?.evalReceiptDigest !==
        review.value.packet?.evaluation?.matrixReceiptDigest ||
      pilot.descriptor?.reviewPacketDigest !== review.value.packet?.packetDigest
    )
      throw new Error(
        "production Pilot is not bound to the EvolutionPlan review",
      );
    let current = view();
    if (
      current.progressiveCanary?.planDigest !== context.plan.rolloutPolicyDigest
    )
      throw new Error(
        "Pilot progressive rollout differs from the EvolutionPlan",
      );
    if (current.reconciliationRequired) current = await reconcile();
    if (snapshot().state.activeStateDigest === null)
      current = await start(boundStart);
    if (current.stage === "candidate")
      current = await approveShadow(boundApproval);
    for (let step = 0; current.stage !== "active" && step < 64; step += 1) {
      if (current.stage === "rolled-back")
        throw new Error("production Pilot rolled back the candidate");
      if (current.reconciliationRequired) {
        current = await reconcile();
        continue;
      }
      const advanceInput = await nextAdvanceInput(freezeClone(current));
      if (advanceInput === null) {
        const error = new Error("production Pilot observation gate is pending");
        error.code = "EVOLUTION_RELEASE_TRAIN_PILOT_PENDING";
        throw error;
      }
      current = await advance(freezeClone(advanceInput));
    }
    if (
      current.stage !== "active" ||
      current.progressiveCanary?.stepId !== null ||
      typeof current.lastTransitionReceiptDigest !== "string"
    )
      throw new Error("production Pilot did not reach stable active state");
    const stored = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.PILOT,
    });
    if (!stored) {
      commit({
        planDigest: context.plan.planDigest,
        stage: STAGES.PILOT,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        outputDigest: current.lastTransitionReceiptDigest,
        value: current,
        effectiveAt: timestamp,
      });
    } else if (
      stored.operationKey !== context.operationKey ||
      stored.inputDigest !== context.inputDigest ||
      stored.outputDigest !== current.lastTransitionReceiptDigest
    ) {
      throw new Error(
        "stored Pilot output differs from the durable controller",
      );
    }
    const recovered = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.PILOT,
    });
    if (!recovered)
      throw new Error("production Pilot output was not durably recoverable");
    return stageReceipt(context, recovered.outputDigest, boundUsage);
  });
}

export function createEvolutionPromotionStage({
  controller,
  releaseRegistry,
  promotionInput,
  outputLedger,
  effectiveAt,
  usage,
} = {}) {
  const promote = capture(controller, "promoteEvaluated", "controller");
  const readState = capture(releaseRegistry, "readState", "releaseRegistry");
  const readRelease = capture(
    releaseRegistry,
    "readRelease",
    "releaseRegistry",
  );
  const load = capture(outputLedger, "load", "outputLedger");
  const commit = capture(outputLedger, "commit", "outputLedger");
  const boundInput = bindPromotionInput(promotionInput);
  const timestamp = new Date(effectiveAt).toISOString();
  const boundUsage = freezeClone(usage);
  const active = (plan) => {
    const state = readState(plan.skillId);
    if (state?.activeReleaseDigest === null) return null;
    const release = readRelease(state.activeReleaseDigest);
    if (
      state?.tenantId !== plan.tenantId ||
      state.skillName !== plan.skillId ||
      release?.tenantId !== plan.tenantId ||
      release.skillName !== plan.skillId
    )
      throw new Error("active Skill release belongs to another plan subject");
    return { state, release };
  };
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.PROMOTION);
    const pilot = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.PILOT,
    });
    const evaluation = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.EVAL,
    });
    const review = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.REVIEW,
    });
    if (
      !pilot ||
      pilot.outputDigest !== context.inputDigest ||
      pilot.value?.stage !== "active" ||
      pilot.value?.progressiveCanary?.stepId !== null ||
      boundInput.candidateId !== context.plan.candidateId ||
      evaluation?.value?.receiptDigest !== evaluation.outputDigest ||
      review?.value?.decision?.receiptDigest !== review.outputDigest
    )
      throw new Error(
        "promotion inputs are not a stable authorized release train",
      );
    let current = active(context.plan);
    let result = null;
    if (
      current === null ||
      current.release.contentDigest !== context.plan.candidateDigest
    ) {
      result = await promote(boundInput);
      current = active(context.plan);
    }
    if (
      !current ||
      current.release.candidateId !== context.plan.candidateId ||
      current.release.contentDigest !== context.plan.candidateDigest ||
      current.state.revision !== context.plan.baselineRevision + 1 ||
      (result &&
        (result.release?.releaseDigest !== current.release.releaseDigest ||
          result.matrixBinding?.matrixReceiptDigest !==
            evaluation.outputDigest ||
          result.reviewBinding?.reviewReceiptDigest !== review.outputDigest))
    )
      throw new Error(
        "evaluated promotion did not commit the exact planned release",
      );
    const stored = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.PROMOTION,
    });
    if (!stored) {
      commit({
        planDigest: context.plan.planDigest,
        stage: STAGES.PROMOTION,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        outputDigest: current.release.releaseDigest,
        value: { state: current.state, release: current.release },
        effectiveAt: timestamp,
      });
    } else if (
      stored.operationKey !== context.operationKey ||
      stored.inputDigest !== context.inputDigest ||
      stored.outputDigest !== current.release.releaseDigest
    ) {
      throw new Error(
        "stored promotion differs from the active ReleaseRegistry",
      );
    }
    const recovered = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.PROMOTION,
    });
    if (!recovered)
      throw new Error("promotion output was not durably recoverable");
    return stageReceipt(context, recovered.outputDigest, boundUsage);
  });
}

export function createEvolutionWikiImpactStage({
  reconciler,
  outputLedger,
  effectiveAt,
  limit = 64,
  usage,
} = {}) {
  const list = capture(reconciler?.source, "list", "reconciler.source");
  const reconcile = capture(reconciler, "reconcile", "reconciler");
  const load = capture(outputLedger, "load", "outputLedger");
  const commit = capture(outputLedger, "commit", "outputLedger");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new TypeError("Wiki reconciliation limit must be between 1 and 256");
  const timestamp = new Date(effectiveAt).toISOString();
  const boundUsage = freezeClone(usage);
  return Object.freeze(async (context) => {
    assertStage(context, STAGES.WIKI_IMPACT);
    const promotion = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.PROMOTION,
    });
    if (
      !promotion ||
      promotion.outputDigest !== context.inputDigest ||
      promotion.value?.release?.releaseDigest !== context.inputDigest
    )
      throw new Error("Wiki impact is not bound to the promoted release");
    let sourceCursor = 0;
    let target = null;
    for (let page = 0; page < 10_000; page += 1) {
      const batch = await list({ afterSequence: sourceCursor, limit });
      if (!Array.isArray(batch))
        throw new Error("Wiki reconciliation source returned an invalid page");
      target ??= batch.find(
        (transition) =>
          transition.tenantId === context.plan.tenantId &&
          transition.skillName === context.plan.skillId &&
          transition.candidateId === context.plan.candidateId &&
          transition.activeReleaseDigest === promotion.outputDigest,
      );
      if (batch.length === 0 || batch.length < limit) break;
      sourceCursor = batch.at(-1).sequence;
    }
    if (!target)
      throw new Error(
        "promoted release is absent from the Wiki reconciliation source",
      );
    let settled;
    for (let batch = 0; batch < 10_000; batch += 1) {
      settled = await reconcile({ limit });
      if (
        !Number.isSafeInteger(settled?.processed) ||
        !Number.isSafeInteger(settled?.cursor)
      )
        throw new Error("Wiki reconciler returned an invalid settlement");
      if (settled.processed < limit) break;
    }
    if (!settled || settled.cursor < target.sequence)
      throw new Error("promoted release did not reach the Wiki checkpoint");
    const stored = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.WIKI_IMPACT,
    });
    if (!stored) {
      const value = {
        releaseDigest: promotion.outputDigest,
        transitionDigest: target.transitionDigest,
        transitionSequence: target.sequence,
        checkpointCursor: settled.cursor,
      };
      commit({
        planDigest: context.plan.planDigest,
        stage: STAGES.WIKI_IMPACT,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        outputDigest: domainDigest(
          "chainlesschain.evolution-release-train-wiki-impact/v1",
          value,
        ),
        value,
        effectiveAt: timestamp,
      });
    } else if (
      stored.operationKey !== context.operationKey ||
      stored.inputDigest !== context.inputDigest ||
      stored.value?.transitionDigest !== target.transitionDigest ||
      stored.value?.checkpointCursor > settled.cursor
    ) {
      throw new Error(
        "stored Wiki impact differs from reconciliation authority",
      );
    }
    const recovered = load({
      planDigest: context.plan.planDigest,
      stage: STAGES.WIKI_IMPACT,
    });
    if (!recovered)
      throw new Error("Wiki impact output was not durably recoverable");
    return stageReceipt(context, recovered.outputDigest, boundUsage);
  });
}

export function createEvolutionReleaseTrainDomainStages({
  domain,
  proposalLedger,
  outputLedger,
} = {}) {
  const expected = [
    "wiki-maintain",
    "propose",
    "candidate",
    "eval",
    "review",
    "pilot",
    "promotion",
    "wiki-impact",
  ];
  dataRecord(domain, "release train domain");
  if (canonical(Object.keys(domain).sort()) !== canonical([...expected].sort()))
    throw new TypeError("release train domain must configure all eight stages");
  for (const name of expected) dataRecord(domain[name], `domain.${name}`);
  return Object.freeze({
    "wiki-maintain": createEvolutionWikiMaintainStage(domain["wiki-maintain"]),
    propose: createEvolutionProposalStage({
      ...domain.propose,
      proposalLedger,
    }),
    candidate: createEvolutionCandidateStage({
      ...domain.candidate,
      proposalLedger,
    }),
    eval: createEvolutionEvalStage({
      ...domain.eval,
      outputLedger,
    }),
    review: createEvolutionReviewStage({
      ...domain.review,
      outputLedger,
    }),
    pilot: createEvolutionPilotStage({
      ...domain.pilot,
      outputLedger,
    }),
    promotion: createEvolutionPromotionStage({
      ...domain.promotion,
      outputLedger,
    }),
    "wiki-impact": createEvolutionWikiImpactStage({
      ...domain["wiki-impact"],
      outputLedger,
    }),
  });
}
