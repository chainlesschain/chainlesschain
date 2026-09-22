import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const SKILL_DECISION_REQUEST_SCHEMA =
  "chainlesschain.skill-decision-request/v1";
export const SKILL_DECISION_RESULT_SCHEMA =
  "chainlesschain.skill-decision-result/v1";
export const SKILL_DECISION_OBSERVATION_SCHEMA =
  "chainlesschain.skill-decision-observation/v1";

export const DECISION_MODES = Object.freeze(["off", "shadow", "suggest"]);
export const MAX_DECISION_CANDIDATES = 8;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export function decisionDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} contains unsupported properties`);
    }
  }
  return value;
}

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return value.trim();
}

function identifier(value, label) {
  const normalized = boundedText(value, label, 256);
  if (!SAFE_ID.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function probability(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError(`${label} must be a finite probability`);
  }
  return value;
}

function normalizeCandidate(candidate, index) {
  plainObject(candidate, `candidates[${index}]`);
  const digest = candidate.digest;
  if (!DIGEST.test(digest ?? "")) {
    throw new TypeError(`candidates[${index}].digest is invalid`);
  }
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.map((tag, tagIndex) =>
        boundedText(tag, `candidates[${index}].tags[${tagIndex}]`, 128),
      )
    : [];
  if (tags.length > 32 || new Set(tags).size !== tags.length) {
    throw new TypeError(`candidates[${index}].tags are invalid or unbounded`);
  }
  return Object.freeze({
    candidateId: `c${index + 1}`,
    id: identifier(candidate.id, `candidates[${index}].id`),
    displayName: boundedText(
      candidate.displayName || candidate.id,
      `candidates[${index}].displayName`,
      512,
    ),
    description: boundedText(
      candidate.description || "(no description)",
      `candidates[${index}].description`,
      16_384,
    ),
    category: boundedText(
      candidate.category || "uncategorized",
      `candidates[${index}].category`,
      128,
    ),
    digest,
    tags: Object.freeze(tags),
  });
}

export function normalizeDecisionMode(value = "off") {
  if (!DECISION_MODES.includes(value)) {
    throw new TypeError("decision mode must be off, shadow, or suggest");
  }
  return value;
}

export function createSkillDecisionRequest({
  decisionId,
  tenantId,
  sessionId,
  turnId,
  query,
  candidates,
  policyDigest,
  contextRevision,
} = {}) {
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates.map(normalizeCandidate)
    : null;
  if (
    !normalizedCandidates ||
    normalizedCandidates.length < 1 ||
    normalizedCandidates.length > MAX_DECISION_CANDIDATES
  ) {
    throw new TypeError("decision candidates are invalid or unbounded");
  }
  if (
    new Set(normalizedCandidates.map(({ digest }) => digest)).size !==
    normalizedCandidates.length
  ) {
    throw new TypeError("decision candidates require unique content digests");
  }
  const binding = Object.freeze({
    tenantId: identifier(tenantId, "tenantId"),
    sessionId: identifier(sessionId, "sessionId"),
    turnId: identifier(turnId, "turnId"),
    policyDigest: DIGEST.test(policyDigest ?? "")
      ? policyDigest
      : decisionDigest("chainlesschain.skill-decision-policy/v1", {
          version: 1,
        }),
    contextRevision: identifier(
      contextRevision || "current",
      "contextRevision",
    ),
  });
  const candidateSetDigest = decisionDigest(
    "chainlesschain.skill-decision-candidates/v1",
    normalizedCandidates,
  );
  const state = Object.freeze({
    task: boundedText(query, "query", 4096),
    candidates: Object.freeze(
      normalizedCandidates.map((candidate) =>
        Object.freeze({
          candidateId: candidate.candidateId,
          name: candidate.displayName,
          description: candidate.description,
          category: candidate.category,
          tags: candidate.tags,
        }),
      ),
    ),
  });
  if (Buffer.byteLength(canonical(state), "utf8") > 96 * 1024) {
    throw new TypeError("decision state is too large");
  }
  const criteria = Object.fromEntries(
    normalizedCandidates.map((candidate) => [
      candidate.candidateId,
      `Use ${candidate.displayName}: ${candidate.description}`,
    ]),
  );
  criteria.none = "None of the listed skills is suitable for this task";
  const questions = {
    needs_skill: {
      type: "noul",
      instructions:
        "Does this task need one of the listed skills to be handled well?",
    },
    best_skill: {
      type: "choice",
      instructions:
        "Which listed skill is the best fit for the task? Choose none when every listed skill is unsuitable.",
      criteria,
    },
  };
  for (const candidate of normalizedCandidates) {
    questions[`fits_${candidate.candidateId}`] = {
      type: "noul",
      instructions: `Is ${candidate.candidateId} suitable for the task and its stated boundaries?`,
    };
  }
  const core = {
    schema: SKILL_DECISION_REQUEST_SCHEMA,
    decisionId: identifier(decisionId, "decisionId"),
    purpose: "skill-routing",
    binding,
    candidateSetDigest,
    candidates: Object.freeze(normalizedCandidates),
    payload: Object.freeze({ state, questions: Object.freeze(questions) }),
  };
  return Object.freeze({
    ...core,
    requestDigest: decisionDigest(SKILL_DECISION_REQUEST_SCHEMA, core),
  });
}

function normalizeNoul(answer, label) {
  plainObject(answer, label);
  if (answer.type !== undefined && answer.type !== "noul") {
    throw new TypeError(`${label} has the wrong answer type`);
  }
  return Object.freeze({
    type: "noul",
    noul: probability(answer.noul, `${label}.noul`),
  });
}

function normalizeChoice(answer, allowed, label) {
  plainObject(answer, label);
  if (answer.type !== undefined && answer.type !== "choice") {
    throw new TypeError(`${label} has the wrong answer type`);
  }
  if (!allowed.has(answer.choice)) {
    throw new TypeError(`${label}.choice is outside the candidate set`);
  }
  plainObject(answer.probabilities, `${label}.probabilities`);
  if (
    Object.keys(answer.probabilities).length !== allowed.size ||
    Object.keys(answer.probabilities).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label}.probabilities are incomplete`);
  }
  const probabilities = Object.fromEntries(
    [...allowed].map((key) => [
      key,
      probability(answer.probabilities[key], `${label}.probabilities.${key}`),
    ]),
  );
  const sum = Object.values(probabilities).reduce(
    (total, value) => total + value,
    0,
  );
  if (Math.abs(sum - 1) > 0.02) {
    throw new TypeError(`${label}.probabilities do not sum to one`);
  }
  return Object.freeze({
    type: "choice",
    choice: answer.choice,
    confidence: probability(answer.confidence, `${label}.confidence`),
    probabilities: Object.freeze(probabilities),
  });
}

export function normalizeSkillDecisionProviderResult(request, value) {
  plainObject(value, "decision provider result");
  plainObject(value.answers, "decision provider result.answers");
  const expectedKeys = [
    "needs_skill",
    "best_skill",
    ...request.candidates.map(({ candidateId }) => `fits_${candidateId}`),
  ];
  if (
    Object.keys(value.answers).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value.answers, key))
  ) {
    throw new TypeError("decision provider answers are incomplete");
  }
  const allowed = new Set([
    ...request.candidates.map(({ candidateId }) => candidateId),
    "none",
  ]);
  const answers = {
    needs_skill: normalizeNoul(
      value.answers.needs_skill,
      "answers.needs_skill",
    ),
    best_skill: normalizeChoice(
      value.answers.best_skill,
      allowed,
      "answers.best_skill",
    ),
  };
  for (const candidate of request.candidates) {
    const key = `fits_${candidate.candidateId}`;
    answers[key] = normalizeNoul(value.answers[key], `answers.${key}`);
  }
  const core = {
    schema: SKILL_DECISION_RESULT_SCHEMA,
    decisionId: request.decisionId,
    requestDigest: request.requestDigest,
    candidateSetDigest: request.candidateSetDigest,
    provider: boundedText(value.provider, "provider", 160),
    model: boundedText(value.model, "model", 160),
    answers: Object.freeze(answers),
  };
  return Object.freeze({
    ...core,
    usage:
      value.usage && typeof value.usage === "object"
        ? Object.freeze({ ...value.usage })
        : null,
    resultDigest: decisionDigest(SKILL_DECISION_RESULT_SCHEMA, core),
  });
}

export function resolveSkillDecision(request, result, thresholds = {}) {
  const needsSkill = thresholds.needsSkill ?? 0.5;
  const candidateFit = thresholds.candidateFit ?? 0.5;
  const choiceConfidence = thresholds.choiceConfidence ?? 0.5;
  for (const [name, value] of Object.entries({
    needsSkill,
    candidateFit,
    choiceConfidence,
  })) {
    probability(value, `thresholds.${name}`);
  }
  const choice = result.answers.best_skill;
  let status = "suggestion";
  let reasonCode = "accepted";
  let selected = null;
  if (result.answers.needs_skill.noul < needsSkill) {
    status = "no-match";
    reasonCode = "needs-skill-below-threshold";
  } else if (choice.choice === "none") {
    status = "no-match";
    reasonCode = "choice-none";
  } else if (choice.confidence < choiceConfidence) {
    status = "abstain";
    reasonCode = "choice-confidence-below-threshold";
  } else {
    selected = request.candidates.find(
      ({ candidateId }) => candidateId === choice.choice,
    );
    const fit = result.answers[`fits_${choice.choice}`].noul;
    if (fit < candidateFit) {
      status = "abstain";
      reasonCode = "candidate-fit-below-threshold";
      selected = null;
    }
  }
  return Object.freeze({
    status,
    reasonCode,
    selectedCandidateId: selected?.candidateId ?? null,
    selectedDigest: selected?.digest ?? null,
    selectedSkillId: selected?.id ?? null,
    needsSkillProbability: result.answers.needs_skill.noul,
    choiceConfidence: choice.confidence,
    resultDigest: result.resultDigest,
  });
}
