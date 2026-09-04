import { BM25Search } from "./bm25-search.js";
import { captureSkillRetrievalRevocationReader } from "./evolution/skill-retrieval-revocation-authority.js";

export const SKILL_RETRIEVAL_RESULT_SCHEMA =
  "chainlesschain.skill-retrieval-result/v1";
export const MAX_ROUTABLE_SKILLS = 10_000;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalize(scores) {
  const values = [...scores.values()];
  const max = Math.max(0, ...values);
  if (max === 0) return new Map([...scores].map(([key]) => [key, 0]));
  return new Map([...scores].map(([key, value]) => [key, value / max]));
}

function digestFor(skill) {
  const value = skill?.executionIdentity?.contentDigest;
  return DIGEST.test(value || "") ? value : null;
}

function containsPath(skill, targetPath) {
  if (!targetPath || !Array.isArray(skill.paths) || skill.paths.length === 0)
    return true;
  const normalized = String(targetPath).replaceAll("\\", "/");
  return skill.paths.some((scope) => {
    const prefix = String(scope).replaceAll("\\", "/").replace(/\/$/u, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function compatible(skill, target) {
  if (!target) return { accepted: true, reasons: [] };
  const reasons = [];
  if (
    Array.isArray(skill.os) &&
    skill.os.length > 0 &&
    target.os &&
    !skill.os.includes(target.os)
  ) {
    reasons.push(`os:${target.os}`);
  }
  if (
    Array.isArray(target.allowedCapabilities) &&
    Array.isArray(skill.capabilities)
  ) {
    const allowed = new Set(target.allowedCapabilities);
    const denied = skill.capabilities.filter((value) => !allowed.has(value));
    if (denied.length > 0) reasons.push(`capability:${denied.join(",")}`);
  }
  return { accepted: reasons.length === 0, reasons };
}

function metricFor(metrics, digest) {
  const value = metrics?.[digest] ?? metrics?.get?.(digest) ?? null;
  if (value === null) return { samples: 0, successRate: 0, correctionRate: 0 };
  const samples = finite(value.samples);
  const successRate = finite(value.successRate);
  const correctionRate = finite(value.correctionRate);
  if (
    !Number.isSafeInteger(samples) ||
    samples < 0 ||
    successRate < 0 ||
    successRate > 1 ||
    correctionRate < 0 ||
    correctionRate > 1
  ) {
    throw new TypeError("Skill outcome metrics are invalid");
  }
  return { samples, successRate, correctionRate };
}

export function routeSkillDescriptors({
  skills,
  query,
  namespace = null,
  tags = [],
  targetPath = null,
  target = null,
  vectorScores = null,
  outcomeMetrics = null,
  revocationReader = null,
  topK = 5,
  ambiguityMargin = 0.02,
} = {}) {
  if (
    !Array.isArray(skills) ||
    skills.length > MAX_ROUTABLE_SKILLS ||
    typeof query !== "string" ||
    query.trim().length < 1 ||
    query.length > 4096 ||
    !Array.isArray(tags) ||
    !Number.isSafeInteger(topK) ||
    topK < 1 ||
    topK > 64 ||
    !Number.isFinite(ambiguityMargin) ||
    ambiguityMargin < 0 ||
    ambiguityMargin > 1
  ) {
    throw new TypeError("Skill retrieval request is invalid or unbounded");
  }
  const requiredTags = new Set(
    tags.map((value) => String(value).toLowerCase()),
  );
  const revocations =
    revocationReader === null
      ? null
      : captureSkillRetrievalRevocationReader(revocationReader);
  const rejected = [];
  const admitted = [];
  for (const skill of skills) {
    const digest = digestFor(skill);
    const skillTags = new Set(
      (Array.isArray(skill.tags) ? skill.tags : []).map((value) =>
        String(value).toLowerCase(),
      ),
    );
    const mismatch = compatible(skill, target);
    const reasons = [];
    if (!digest) reasons.push("missing-content-digest");
    const revocation =
      digest === null
        ? null
        : revocations?.inspect({ skillName: skill.id, contentDigest: digest });
    if (revocation?.invalidated) reasons.push("revoked-by-evolution");
    if (namespace !== null && skill.source !== namespace)
      reasons.push("namespace-mismatch");
    if ([...requiredTags].some((value) => !skillTags.has(value)))
      reasons.push("tag-mismatch");
    if (!containsPath(skill, targetPath)) reasons.push("path-mismatch");
    reasons.push(...mismatch.reasons);
    if (reasons.length > 0) {
      rejected.push({
        id: skill.id,
        digest,
        reasons,
        ...(revocation?.invalidated
          ? {
              revocationStateDigest: revocation.stateDigest,
              revocationReceiptDigest: revocation.receiptDigest,
            }
          : {}),
      });
      continue;
    }
    admitted.push({ skill, digest });
  }

  const bm25 = new BM25Search({ language: "auto" });
  bm25.indexDocuments(
    admitted.map(({ skill, digest }) => ({
      id: digest,
      title: `${skill.id} ${skill.displayName || ""} ${(skill.tags || []).join(" ")}`,
      content: `${skill.description || ""} ${skill.category || ""}`,
    })),
  );
  const bm25Scores = normalize(
    new Map(
      bm25
        .search(query, { topK: admitted.length || 1, threshold: 0 })
        .map(({ id, score }) => [id, score]),
    ),
  );
  const vector = normalize(
    new Map(
      admitted.map(({ digest }) => [
        digest,
        Math.max(
          0,
          finite(vectorScores?.[digest] ?? vectorScores?.get?.(digest)),
        ),
      ]),
    ),
  );
  const vectorAvailable = [...vector.values()].some((value) => value > 0);
  const candidates = admitted
    .map(({ skill, digest }) => {
      const lexicalScore = bm25Scores.get(digest) || 0;
      const vectorScore = vector.get(digest) || 0;
      const outcome = metricFor(outcomeMetrics, digest);
      const outcomeScore =
        outcome.samples === 0
          ? 0.5
          : outcome.successRate * (1 - outcome.correctionRate);
      const score =
        lexicalScore * (vectorAvailable ? 0.45 : 0.75) +
        vectorScore * (vectorAvailable ? 0.35 : 0) +
        outcomeScore * (vectorAvailable ? 0.2 : 0.25);
      return {
        id: skill.id,
        displayName: skill.displayName || skill.id,
        namespace: skill.source,
        version: String(skill.version || "1.0.0"),
        digest,
        category: skill.category || "uncategorized",
        contextCostTokens: Math.ceil(
          `${skill.id}\n${skill.description || ""}\n${skill.category || ""}`
            .length / 4,
        ),
        score,
        scores: {
          lexical: lexicalScore,
          vector: vectorScore,
          outcome: outcomeScore,
        },
        outcome,
        reason: `bm25=${lexicalScore.toFixed(3)}, vector=${vectorScore.toFixed(3)}, outcome=${outcomeScore.toFixed(3)}`,
      };
    })
    .filter(({ scores }) => scores.lexical > 0 || scores.vector > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.digest.localeCompare(right.digest),
    );

  const conflicts = [];
  const byName = new Map();
  for (const candidate of candidates) {
    const key = candidate.id.toLowerCase();
    const prior = byName.get(key);
    if (prior && prior.digest !== candidate.digest) {
      conflicts.push({
        type: "same-name-different-version",
        name: candidate.id,
        digests: [prior.digest, candidate.digest].sort(),
      });
    } else byName.set(key, candidate);
  }
  const returned = candidates.slice(0, topK);
  const ambiguous =
    returned.length > 1 &&
    returned[0].score - returned[1].score < ambiguityMargin;
  if (ambiguous) {
    conflicts.push({
      type: "ambiguous-top-score",
      digests: [returned[0].digest, returned[1].digest],
      margin: returned[0].score - returned[1].score,
    });
  }
  const topConflict = conflicts.some(({ digests }) =>
    digests?.includes(returned[0]?.digest),
  );
  return Object.freeze({
    schema: SKILL_RETRIEVAL_RESULT_SCHEMA,
    query: query.trim(),
    selected: returned.length > 0 && !topConflict ? returned[0] : null,
    candidates: Object.freeze(returned.map(Object.freeze)),
    conflicts: Object.freeze(conflicts.map(Object.freeze)),
    rejected: Object.freeze(rejected.map(Object.freeze)),
    vectorAvailable,
  });
}
