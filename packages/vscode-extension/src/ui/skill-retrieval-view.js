"use strict";

const SCHEMA = "chainlesschain.skill-retrieval-result/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function boundedString(value, label, max = 4096) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return value.trim();
}

function buildSkillRetrievalArgs(query, { limit = 20 } = {}) {
  const normalized = boundedString(query, "Skill retrieval query");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
    throw new TypeError("Skill retrieval limit is invalid or unbounded");
  }
  return ["skill", "search", normalized, "--limit", String(limit), "--json"];
}

function validateCandidate(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !DIGEST.test(value.digest || "") ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 256 ||
    typeof value.displayName !== "string" ||
    value.displayName.length < 1 ||
    value.displayName.length > 512 ||
    typeof value.version !== "string" ||
    value.version.length < 1 ||
    value.version.length > 128 ||
    typeof value.namespace !== "string" ||
    value.namespace.length < 1 ||
    value.namespace.length > 128 ||
    typeof value.category !== "string" ||
    value.category.length < 1 ||
    value.category.length > 128 ||
    !Number.isSafeInteger(value.contextCostTokens) ||
    value.contextCostTokens < 0 ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 1 ||
    !value.scores ||
    typeof value.scores !== "object" ||
    [value.scores.lexical, value.scores.vector, value.scores.outcome].some(
      (score) => !Number.isFinite(score) || score < 0 || score > 1,
    ) ||
    !value.outcome ||
    typeof value.outcome !== "object" ||
    !Number.isSafeInteger(value.outcome.samples) ||
    value.outcome.samples < 0 ||
    !Number.isFinite(value.outcome.successRate) ||
    value.outcome.successRate < 0 ||
    value.outcome.successRate > 1 ||
    !Number.isFinite(value.outcome.correctionRate) ||
    value.outcome.correctionRate < 0 ||
    value.outcome.correctionRate > 1 ||
    typeof value.reason !== "string" ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    throw new Error("Skill retrieval returned an invalid candidate");
  }
  return value;
}

function validateConflict(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !["same-name-different-version", "ambiguous-top-score"].includes(
      value.type,
    ) ||
    !Array.isArray(value.digests) ||
    value.digests.length !== 2 ||
    value.digests.some((digest) => !DIGEST.test(digest)) ||
    value.digests[0] === value.digests[1] ||
    (value.type === "same-name-different-version" &&
      (typeof value.name !== "string" ||
        value.name.length < 1 ||
        value.name.length > 256)) ||
    (value.type === "ambiguous-top-score" &&
      (!Number.isFinite(value.margin) || value.margin < 0 || value.margin > 1))
  ) {
    throw new Error("Skill retrieval returned an invalid conflict");
  }
  return value;
}

function validateRejection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 256 ||
    (value.digest !== null && !DIGEST.test(value.digest || "")) ||
    !Array.isArray(value.reasons) ||
    value.reasons.length < 1 ||
    value.reasons.length > 16 ||
    value.reasons.some(
      (reason) =>
        typeof reason !== "string" || reason.length < 1 || reason.length > 512,
    )
  ) {
    throw new Error("Skill retrieval returned an invalid rejection");
  }
  return value;
}

function parseSkillRetrievalResult(text) {
  let value;
  try {
    value = JSON.parse(String(text || ""));
  } catch {
    throw new Error("Skill retrieval did not return canonical JSON");
  }
  if (
    value?.schema !== SCHEMA ||
    !Object.prototype.hasOwnProperty.call(value, "selected") ||
    typeof value.query !== "string" ||
    value.query.trim().length < 1 ||
    value.query !== value.query.trim() ||
    value.query.length > 4096 ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 64 ||
    !Array.isArray(value.conflicts) ||
    value.conflicts.length > 64 ||
    !Array.isArray(value.rejected) ||
    value.rejected.length > 10_000 ||
    typeof value.vectorAvailable !== "boolean"
  ) {
    throw new Error("Skill retrieval returned an invalid result");
  }
  const candidates = value.candidates.map(validateCandidate);
  const conflicts = value.conflicts.map(validateConflict);
  const rejected = value.rejected.map(validateRejection);
  if (
    new Set(candidates.map(({ digest }) => digest)).size !== candidates.length
  ) {
    throw new Error("Skill retrieval returned duplicate candidate digests");
  }
  let selected = null;
  if (value.selected !== null) {
    const claimed = validateCandidate(value.selected);
    const canonical = candidates.find(
      (candidate) =>
        candidate.digest === claimed.digest && candidate.id === claimed.id,
    );
    if (!canonical) {
      throw new Error("Skill retrieval selected an unreturned candidate");
    }
    if (canonical !== candidates[0]) {
      throw new Error("Skill retrieval selected a non-leading candidate");
    }
    selected = canonical;
  }
  if (candidates.length > 0 && selected === null && conflicts.length === 0) {
    throw new Error("Skill retrieval omitted a selection without a conflict");
  }
  return Object.freeze({
    ...value,
    selected,
    candidates: Object.freeze(candidates),
    conflicts: Object.freeze(conflicts),
    rejected: Object.freeze(rejected),
  });
}

function quickPickItem(candidate, selectedDigest) {
  return {
    label: `${candidate.digest === selectedDigest ? "$(check) " : ""}${candidate.displayName}`,
    description: `v${candidate.version} · ${candidate.namespace}`,
    detail: `score=${candidate.score.toFixed(3)} · ${candidate.reason}`,
    candidate,
  };
}

async function showCandidate(vscode, result, candidate) {
  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify(
      {
        schema: result.schema,
        query: result.query,
        executionAuthorized: false,
        candidate,
        conflicts: result.conflicts,
      },
      null,
      2,
    ),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function openSkillRetrieval(
  vscode,
  { command, runCliResult, cwd, limit = 20 } = {},
) {
  if (typeof command !== "string" || typeof runCliResult !== "function") {
    throw new TypeError("Skill retrieval CLI host is required");
  }
  const query = await vscode.window.showInputBox({
    title: "ChainlessChain Skill Retrieval",
    prompt: "Describe the capability you need",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "A search query is required.";
      if (value.length > 4096) return "Query must be at most 4096 characters.";
      return null;
    },
  });
  if (query == null) return null;
  const response = await runCliResult({
    command,
    args: buildSkillRetrievalArgs(query, { limit }),
    cwd,
    timeoutMs: 30_000,
    maxBufferBytes: 8 * 1024 * 1024,
  });
  if (response?.ok !== true) {
    throw new Error(
      response?.text || response?.error || "Skill retrieval failed",
    );
  }
  const result = parseSkillRetrievalResult(response.stdout);
  if (result.candidates.length === 0) {
    await vscode.window.showInformationMessage(
      `No digest-bound Skills matched “${result.query}”.`,
    );
    return result;
  }
  if (result.selected === null && result.conflicts.length > 0) {
    await vscode.window.showWarningMessage(
      "Skill retrieval abstained because the leading candidates conflict. Narrow the query before execution.",
    );
  }
  const picked = await vscode.window.showQuickPick(
    result.candidates.map((candidate) =>
      quickPickItem(candidate, result.selected?.digest || null),
    ),
    {
      title: "ChainlessChain Skill Retrieval — inspect only",
      placeHolder:
        "Select a candidate to inspect its canonical routing evidence",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) return result;
  await showCandidate(vscode, result, picked.candidate);
  return result;
}

module.exports = {
  buildSkillRetrievalArgs,
  openSkillRetrieval,
  parseSkillRetrievalResult,
};
