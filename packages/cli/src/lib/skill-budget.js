/**
 * Host-owned admission limits for file-backed CLI skills.
 *
 * These are security ceilings, not defaults that callers may raise. Loader
 * options can only tighten them through resolveSkillLimits().
 */
export const HOST_SKILL_LIMITS = Object.freeze({
  maxSkillFileBytes: 256 * 1024,
  maxSkillTotalBytes: 512 * 1024,
  maxSkillDiscoveryEntries: 16_384,
  maxSkillDiscoveryFiles: 4096,
  maxSkillDiscoveryBytes: 64 * 1024 * 1024,
  maxSkillNestDepth: 5,
  maxSkillPromptBytes: 48_000,
  // Provider-neutral conservative ceiling: one token cannot require fewer
  // than zero bytes, and byte-level tokenizers cannot produce more tokens than
  // the UTF-8 byte sequence. Hosts with a smaller context may tighten this.
  maxSkillPromptTokens: 48_000,
  maxSkillPromptTotalBytes: 192_000,
  maxSkillPromptTotalTokens: 192_000,
});

const LIMIT_KEYS = Object.freeze(Object.keys(HOST_SKILL_LIMITS));

function tighteningLimit(value, hardLimit) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return hardLimit;
  }
  return Math.min(hardLimit, Math.max(1, Math.floor(value)));
}

export function resolveSkillLimits(options = {}) {
  const limits = {};
  for (const key of LIMIT_KEYS) {
    limits[key] = tighteningLimit(options?.[key], HOST_SKILL_LIMITS[key]);
  }
  return Object.freeze(limits);
}

export function skillBudgetError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SkillBudgetError";
  error.code = code;
  if (Number.isFinite(details.limit)) error.limit = details.limit;
  if (Number.isFinite(details.actual)) error.actual = details.actual;
  if (details.component) error.component = details.component;
  return error;
}

export function isSkillBudgetError(error) {
  return error?.name === "SkillBudgetError";
}

export function assertSkillFileSize(component, size, limitsInput = {}) {
  const limits = resolveSkillLimits(limitsInput);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw skillBudgetError(
      "CC_SKILL_FILE_SIZE_INVALID",
      `Skill component size is invalid: ${component}`,
      { component },
    );
  }
  if (size > limits.maxSkillFileBytes) {
    throw skillBudgetError(
      "CC_SKILL_FILE_TOO_LARGE",
      `Skill component exceeds the host byte limit: ${component}`,
      { component, limit: limits.maxSkillFileBytes, actual: size },
    );
  }
  return size;
}

export function assertSkillTotalSize(size, limitsInput = {}) {
  const limits = resolveSkillLimits(limitsInput);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw skillBudgetError(
      "CC_SKILL_TOTAL_SIZE_INVALID",
      "Skill component total is invalid.",
    );
  }
  if (size > limits.maxSkillTotalBytes) {
    throw skillBudgetError(
      "CC_SKILL_TOTAL_BYTES_EXCEEDED",
      "Skill components exceed the host aggregate byte limit.",
      { limit: limits.maxSkillTotalBytes, actual: size },
    );
  }
  return size;
}

export function createSkillDiscoveryBudget(limitsInput = {}) {
  return {
    limits: resolveSkillLimits(limitsInput),
    entries: 0,
    files: 0,
    bytes: 0,
  };
}

export function debitSkillDiscoveryEntry(budget) {
  const nextEntries = budget.entries + 1;
  if (
    !Number.isSafeInteger(nextEntries) ||
    nextEntries > budget.limits.maxSkillDiscoveryEntries
  ) {
    throw skillBudgetError(
      "CC_SKILL_DISCOVERY_ENTRIES_EXCEEDED",
      "Recursive skill discovery exceeds the host directory-entry limit.",
      {
        limit: budget.limits.maxSkillDiscoveryEntries,
        actual: nextEntries,
      },
    );
  }
  budget.entries = nextEntries;
  return budget;
}

export function debitSkillDiscoveryBudget(budget, fileCount, byteCount) {
  const nextFiles = budget.files + fileCount;
  const nextBytes = budget.bytes + byteCount;
  if (
    !Number.isSafeInteger(nextFiles) ||
    nextFiles > budget.limits.maxSkillDiscoveryFiles
  ) {
    throw skillBudgetError(
      "CC_SKILL_DISCOVERY_FILES_EXCEEDED",
      "Recursive skill discovery exceeds the host file-count limit.",
      {
        limit: budget.limits.maxSkillDiscoveryFiles,
        actual: nextFiles,
      },
    );
  }
  if (
    !Number.isSafeInteger(nextBytes) ||
    nextBytes > budget.limits.maxSkillDiscoveryBytes
  ) {
    throw skillBudgetError(
      "CC_SKILL_DISCOVERY_BYTES_EXCEEDED",
      "Recursive skill discovery exceeds the host aggregate byte limit.",
      {
        limit: budget.limits.maxSkillDiscoveryBytes,
        actual: nextBytes,
      },
    );
  }
  budget.files = nextFiles;
  budget.bytes = nextBytes;
  return budget;
}

export function measureSkillPrompt(body) {
  if (typeof body !== "string") {
    throw skillBudgetError(
      "CC_SKILL_PROMPT_INVALID",
      "Skill instructions must be a string before model projection.",
    );
  }
  const bytes = Buffer.byteLength(body, "utf8");
  return Object.freeze({
    bytes,
    // Conservative provider-neutral upper bound for text-derived tokens. This
    // intentionally does not trust a configurable estimator that could return
    // zero or NaN.
    tokenUpperBound: bytes,
  });
}

export function admitSkillPrompt(body, limitsInput = {}) {
  const limits = resolveSkillLimits(limitsInput);
  const measured = measureSkillPrompt(body);
  if (measured.bytes > limits.maxSkillPromptBytes) {
    throw skillBudgetError(
      "CC_SKILL_PROMPT_BYTES_EXCEEDED",
      "Skill instructions exceed the host model-projection byte limit.",
      { limit: limits.maxSkillPromptBytes, actual: measured.bytes },
    );
  }
  if (measured.tokenUpperBound > limits.maxSkillPromptTokens) {
    throw skillBudgetError(
      "CC_SKILL_PROMPT_TOKENS_EXCEEDED",
      "Skill instructions exceed the host model-projection token limit.",
      { limit: limits.maxSkillPromptTokens, actual: measured.tokenUpperBound },
    );
  }
  return measured;
}

export function debitSkillPromptBudget(budget, measured) {
  const nextBytes = budget.bytes + measured.bytes;
  const nextTokens = budget.tokens + measured.tokenUpperBound;
  if (
    !Number.isSafeInteger(nextBytes) ||
    nextBytes > budget.limits.maxSkillPromptTotalBytes
  ) {
    throw skillBudgetError(
      "CC_SKILL_PROMPT_TOTAL_BYTES_EXCEEDED",
      "Skill instructions exceed the host aggregate model-projection byte limit.",
      {
        limit: budget.limits.maxSkillPromptTotalBytes,
        actual: nextBytes,
      },
    );
  }
  if (
    !Number.isSafeInteger(nextTokens) ||
    nextTokens > budget.limits.maxSkillPromptTotalTokens
  ) {
    throw skillBudgetError(
      "CC_SKILL_PROMPT_TOTAL_TOKENS_EXCEEDED",
      "Skill instructions exceed the host aggregate model-projection token limit.",
      {
        limit: budget.limits.maxSkillPromptTotalTokens,
        actual: nextTokens,
      },
    );
  }
  budget.bytes = nextBytes;
  budget.tokens = nextTokens;
  return budget;
}
