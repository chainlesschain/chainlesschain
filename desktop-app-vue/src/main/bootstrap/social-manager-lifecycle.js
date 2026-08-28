const DEFAULT_MANAGER_CLOSE_TIMEOUT_MS = 10_000;
const MAX_MANAGER_CLOSE_TIMEOUT_MS = 60_000;

function validateCloseTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_MANAGER_CLOSE_TIMEOUT_MS
  ) {
    throw new TypeError(
      `closeTimeoutMs must be an integer between 1 and ${MAX_MANAGER_CLOSE_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

function validateCleanupEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("cleanup entries must be an array");
  }
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      entry[0].length === 0 ||
      typeof entry[1] !== "string" ||
      entry[1].length === 0
    ) {
      throw new TypeError("cleanup entries must contain [managerName, method]");
    }
  }
}

async function runBoundedClose(operation, timeoutMs) {
  let timeoutHandle = null;
  const operationResult = Promise.resolve()
    .then(operation)
    .then(
      () => ({ status: "closed" }),
      (error) => ({ status: "error", error }),
    );
  const timeoutResult = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
    timeoutHandle.unref?.();
  });

  try {
    return await Promise.race([operationResult, timeoutResult]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Releases a dependency-ordered list of managers without allowing one broken
 * close path to retain the application shutdown forever. Ownership is fenced
 * before close begins so late callbacks cannot rediscover the manager through
 * the main application object.
 */
async function cleanupOwnedManagers(
  owner,
  entries,
  {
    logger = console,
    closeTimeoutMs = DEFAULT_MANAGER_CLOSE_TIMEOUT_MS,
    logPrefix = "[Main]",
  } = {},
) {
  if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
    throw new TypeError("owner must be an object");
  }
  validateCleanupEntries(entries);
  validateCloseTimeout(closeTimeoutMs);

  const outcomes = [];
  for (const [managerName, closeMethod] of entries) {
    const manager = owner[managerName];
    if (!manager) {
      outcomes.push({ managerName, status: "absent" });
      continue;
    }

    owner[managerName] = null;
    if (typeof manager[closeMethod] !== "function") {
      const error = new TypeError(
        `${managerName}.${closeMethod} is not a function`,
      );
      logger.error?.(`${logPrefix} ${managerName} cleanup error:`, error);
      outcomes.push({ managerName, status: "error", error });
      continue;
    }

    const outcome = await runBoundedClose(
      () => manager[closeMethod](),
      closeTimeoutMs,
    );
    outcomes.push({ managerName, ...outcome });
    if (outcome.status === "closed") {
      logger.info?.(`${logPrefix} ${managerName} cleanup completed`);
    } else if (outcome.status === "timeout") {
      logger.error?.(
        `${logPrefix} ${managerName} cleanup timed out after ${closeTimeoutMs}ms`,
      );
    } else {
      logger.error?.(
        `${logPrefix} ${managerName} cleanup error:`,
        outcome.error,
      );
    }
  }
  return outcomes;
}

module.exports = {
  DEFAULT_MANAGER_CLOSE_TIMEOUT_MS,
  MAX_MANAGER_CLOSE_TIMEOUT_MS,
  cleanupOwnedManagers,
  validateCloseTimeout,
};
