import { Worker } from "node:worker_threads";

/** Search an already-authorized text file with bounded memory/output/time. */
export function searchTextFile(file, options = {}) {
  const {
    pattern,
    regex = false,
    caseSensitive = false,
    offset = 0,
    maxMatches = 20,
    contextChars = 150,
    timeout = 5000,
    encoding = "utf8",
  } = options;
  if (
    typeof pattern !== "string" ||
    !pattern ||
    pattern.length > 2048 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(maxMatches) ||
    maxMatches < 1 ||
    maxMatches > 100 ||
    !Number.isSafeInteger(contextChars) ||
    contextChars < 0 ||
    contextChars > 1000 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 30000 ||
    !["utf8", "utf16le"].includes(encoding)
  ) {
    return Promise.resolve({
      error: "Invalid text search options",
      code: "ERR_TEXT_SEARCH_OPTIONS",
    });
  }
  let toolLease = null;
  if (options.hostResourceBudget) {
    try {
      toolLease = options.hostResourceBudget.admitTool({ kind: "text-search" });
    } catch (error) {
      return Promise.resolve({
        error: "Text search unavailable: host resource budget",
        code: "ERR_HOST_RESOURCE_BUDGET",
        reason: String(error?.budgetReason || "unavailable").slice(0, 128),
      });
    }
  }
  return new Promise((resolve) => {
    let worker;
    let timer;
    let settled = false;
    let progress = { matches: [], nextOffset: offset };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      Promise.resolve(worker?.terminate())
        .catch(() => {})
        .finally(() => {
          try {
            toolLease?.release();
          } finally {
            resolve(result);
          }
        });
    };
    try {
      worker = new Worker(
        new URL("./text-file-search-worker.js", import.meta.url),
        {
          workerData: {
            file,
            pattern,
            regex,
            caseSensitive,
            offset,
            maxMatches,
            contextChars,
            encoding,
          },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 64 },
        },
      );
      worker.on("message", (message) => {
        if (message.progress) progress = message.progress;
        else finish(message);
      });
      worker.on("error", (error) =>
        finish({ error: error.message, code: "ERR_TEXT_SEARCH" }),
      );
      worker.on("exit", () =>
        finish({
          error: "Text search worker stopped before completion",
          code: "ERR_TEXT_SEARCH",
        }),
      );
      timer = setTimeout(
        () =>
          finish({
            ...progress,
            error:
              "Text search deadline exceeded; the full file was not searched",
            code: "ERR_TEXT_SEARCH_TIMEOUT",
            truncated: true,
            hasMore: true,
            hint: "Use a simpler literal query or continue from nextOffset. Do not treat partial results as a complete search.",
          }),
        timeout,
      );
    } catch (error) {
      finish({ error: error.message, code: "ERR_TEXT_SEARCH" });
    }
  });
}
