/**
 * Canonical, bounded handoff shared by compaction, checkpoint summaries, and
 * parent-to-child agent context. The field order is part of the wire format.
 */

export const STRUCTURED_HANDOFF_FIELDS = Object.freeze([
  "objective",
  "constraints",
  "keyDecisions",
  "changedFiles",
  "tests",
  "unresolvedSideEffects",
  "checkpoints",
  "blockers",
  "nextSteps",
]);

const ARRAY_FIELDS = STRUCTURED_HANDOFF_FIELDS.slice(1);
const DEFAULT_MAX_CONTENT_CHARS = 32_000;
const DEFAULT_MAX_ITEMS_PER_FIELD = 12;
const DEFAULT_MAX_ITEM_CHARS = 1_000;
const DEFAULT_MAX_FALLBACK_SOURCE_CHARS = 24_000;

export class StructuredHandoffValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StructuredHandoffValidationError";
    this.code = code;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function truncateText(value, maxChars) {
  const text = normalizeText(value);
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function contentText(message) {
  if (typeof message?.content === "string") return message.content;
  if (message?.content == null) return "";
  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}

function validationError(code, message) {
  throw new StructuredHandoffValidationError(code, message);
}

function validateHandoffObject(value, maxContentChars) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError("invalid_shape", "structured handoff must be an object");
  }

  const keys = Object.keys(value);
  if (
    keys.length !== STRUCTURED_HANDOFF_FIELDS.length ||
    keys.some((key, index) => key !== STRUCTURED_HANDOFF_FIELDS[index])
  ) {
    validationError(
      "invalid_fields",
      "structured handoff fields are missing, extra, or out of order",
    );
  }
  if (typeof value.objective !== "string") {
    validationError("invalid_objective", "objective must be a string");
  }

  const normalized = { objective: normalizeText(value.objective) };
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(value[field])) {
      validationError(`invalid_${field}`, `${field} must be an array`);
    }
    normalized[field] = value[field].map((item) => {
      if (typeof item !== "string") {
        validationError(`invalid_${field}`, `${field} must contain strings`);
      }
      return normalizeText(item);
    });
  }

  if (JSON.stringify(normalized).length > maxContentChars) {
    validationError(
      "content_too_large",
      `structured handoff exceeds ${maxContentChars} characters`,
    );
  }
  return normalized;
}

/** Parse one strict JSON object. Markdown fences and surrounding prose fail. */
export function parseStructuredHandoff(raw, options = {}) {
  const maxContentChars = boundedInteger(
    options.maxContentChars,
    DEFAULT_MAX_CONTENT_CHARS,
    512,
    1_000_000,
  );
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) validationError("invalid_json", "structured handoff is empty");
    if (text.length > maxContentChars) {
      validationError(
        "content_too_large",
        `structured handoff exceeds ${maxContentChars} characters`,
      );
    }
    try {
      value = JSON.parse(text);
    } catch {
      validationError("invalid_json", "structured handoff is not strict JSON");
    }
  } else if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    validationError(
      "invalid_type",
      "structured handoff must be JSON text or an object",
    );
  }
  return validateHandoffObject(value, maxContentChars);
}

/** Format with stable field order so persisted summaries are reproducible. */
export function formatStructuredHandoff(value) {
  return JSON.stringify(
    validateHandoffObject(value, DEFAULT_MAX_CONTENT_CHARS),
    null,
    2,
  );
}

function selectBoundedSources(messages, maxChars) {
  const entries = (Array.isArray(messages) ? messages : [])
    .map((message, index) => ({
      index,
      role: typeof message?.role === "string" ? message.role : "unknown",
      text: normalizeText(contentText(message)),
    }))
    .filter((entry) => entry.text);
  const firstUser = entries.find((entry) => entry.role === "user");
  const selected = new Map();
  let remaining = maxChars;

  if (firstUser) {
    const allowance = Math.min(
      firstUser.text.length,
      Math.max(1, Math.floor(maxChars / 3)),
    );
    selected.set(firstUser.index, {
      ...firstUser,
      text: firstUser.text.slice(0, allowance),
    });
    remaining -= allowance;
  }

  for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
    const entry = entries[index];
    if (selected.has(entry.index)) continue;
    const allowance = Math.min(entry.text.length, remaining);
    if (allowance <= 0) break;
    selected.set(entry.index, {
      ...entry,
      text: entry.text.slice(0, allowance),
    });
    remaining -= allowance;
  }
  return [...selected.values()].sort((left, right) => left.index - right.index);
}

function fragments(text) {
  return text
    .split(/\n+|(?<=[.!?。！？])\s+/u)
    .map((part) => normalizeText(part).replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ""))
    .filter(Boolean);
}

function stripLabel(value, labels) {
  return normalizeText(value).replace(
    new RegExp(`^(?:${labels})\\s*(?::|：|-)?\\s*`, "iu"),
    "",
  );
}

function uniqueBounded(values, maxItems, maxItemChars) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const item = truncateText(value, maxItemChars);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
}

function pathsFrom(text) {
  const matches = text.match(
    /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?(?:[A-Za-z0-9_@.-]+[\\/])+(?:[A-Za-z0-9_@.-]+)/g,
  );
  return (matches || [])
    .map((value) => value.replace(/[),;:.]+$/g, ""))
    .filter((value) => value && !value.includes("://"));
}

function emptyHandoff(objective = "") {
  return {
    objective,
    constraints: [],
    keyDecisions: [],
    changedFiles: [],
    tests: [],
    unresolvedSideEffects: [],
    checkpoints: [],
    blockers: [],
    nextSteps: [],
  };
}

function serializedLength(value) {
  return JSON.stringify(value, null, 2).length;
}

function fitToContentLimit(handoff, maxContentChars) {
  const value = structuredClone(handoff);
  while (serializedLength(value) > maxContentChars) {
    const strings = [
      { field: "objective", index: null, value: value.objective },
      ...ARRAY_FIELDS.flatMap((field) =>
        value[field].map((item, index) => ({ field, index, value: item })),
      ),
    ].sort((left, right) => right.value.length - left.value.length);
    const longest = strings[0];
    if (!longest) break;
    if (longest.value.length > 80) {
      const excess = serializedLength(value) - maxContentChars;
      const nextLength = Math.max(80, longest.value.length - excess - 1);
      const next = truncateText(longest.value, nextLength);
      if (longest.index == null) value.objective = next;
      else value[longest.field][longest.index] = next;
      continue;
    }
    const removable = [...ARRAY_FIELDS]
      .reverse()
      .find((field) => value[field].length > 0);
    if (removable) {
      value[removable].pop();
      continue;
    }
    value.objective = truncateText(
      value.objective,
      Math.max(0, value.objective.length - 1),
    );
  }
  return value;
}

/**
 * Deterministic fallback that retains labelled facts and exact file paths.
 * The first user objective and the most recent history receive source-budget
 * priority, preventing a large middle tool result from crowding out either.
 */
export function buildExtractiveHandoff(messages, options = {}) {
  const maxContentChars = boundedInteger(
    options.maxContentChars,
    DEFAULT_MAX_CONTENT_CHARS,
    512,
    1_000_000,
  );
  const maxItemsPerField = boundedInteger(
    options.maxItemsPerField,
    DEFAULT_MAX_ITEMS_PER_FIELD,
    1,
    256,
  );
  const maxItemChars = boundedInteger(
    options.maxItemChars,
    DEFAULT_MAX_ITEM_CHARS,
    32,
    16_000,
  );
  const maxFallbackSourceChars = boundedInteger(
    options.maxFallbackSourceChars,
    DEFAULT_MAX_FALLBACK_SOURCE_CHARS,
    512,
    1_000_000,
  );
  const sources = selectBoundedSources(messages, maxFallbackSourceChars);
  const firstUser = sources.find((entry) => entry.role === "user");
  const candidates = emptyHandoff(
    truncateText(firstUser?.text || "", maxItemChars),
  );

  for (const source of sources) {
    for (const fragment of fragments(source.text)) {
      candidates.changedFiles.push(...pathsFrom(fragment));
      if (
        /^(?:constraint|constraints|requirement|requirements|must|must not|do not|don't|only|约束|必须|不要|只能|仅限)\b/iu.test(
          fragment,
        ) ||
        /\bwithout\s+(?:widening|changing|removing|losing)\b/iu.test(fragment)
      ) {
        candidates.constraints.push(
          stripLabel(
            fragment,
            "constraint(?:s)?|requirement(?:s)?|must(?: not)?|do not|don't|only|约束|必须|不要|只能|仅限",
          ),
        );
      }
      if (
        /^(?:key decision|decision|decided|approach|we will|选择|决定|方案)\b/iu.test(
          fragment,
        )
      ) {
        candidates.keyDecisions.push(
          stripLabel(
            fragment,
            "key decision|decision|decided|approach|we will|选择|决定|方案",
          ),
        );
      }
      if (
        /\b(?:test|tests|vitest|jest|pytest|playwright|lint|typecheck|build)\b/iu.test(
          fragment,
        ) &&
        /\b(?:passed|failed|run|ran|green|verified|success|succeeded|通过|失败|运行|验证)\b/iu.test(
          fragment,
        )
      ) {
        candidates.tests.push(stripLabel(fragment, "test(?:s)?|测试|验证"));
      }
      if (
        /\b(?:unresolved (?:external )?side effects?|external action|not (?:yet )?(?:published|deployed|merged|sent)|pending (?:publish|deploy|merge)|未发布|未部署|未合并|外部副作用)\b/iu.test(
          fragment,
        )
      ) {
        candidates.unresolvedSideEffects.push(
          stripLabel(
            fragment,
            "unresolved (?:external )?side effects?|external action|外部副作用",
          ),
        );
      }
      if (
        /\b(?:checkpoint|commit\s+[0-9a-f]{7,40}|implemented|completed|done|verified|checkpoint|检查点|已完成|已实现)\b/iu.test(
          fragment,
        )
      ) {
        candidates.checkpoints.push(
          stripLabel(fragment, "checkpoint|status|检查点|状态"),
        );
      }
      if (
        /\b(?:blocker|blocked|blocking|cannot|can't|missing|required external|阻塞|受阻|缺失)\b/iu.test(
          fragment,
        )
      ) {
        candidates.blockers.push(
          stripLabel(fragment, "blocker(?:s)?|blocked|阻塞"),
        );
      }
      if (
        /^(?:next steps?|next|todo|remaining|then|下一步|待办|后续)\b/iu.test(
          fragment,
        )
      ) {
        candidates.nextSteps.push(
          stripLabel(
            fragment,
            "next steps?|next|todo|remaining|then|下一步|待办|后续",
          ),
        );
      }
    }
  }

  for (const field of ARRAY_FIELDS) {
    candidates[field] = uniqueBounded(
      candidates[field],
      maxItemsPerField,
      maxItemChars,
    );
  }
  return fitToContentLimit(candidates, maxContentChars);
}
