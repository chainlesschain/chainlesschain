import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(
  new URL("./local-semantic-worker.py", import.meta.url),
);
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const UNCONFIRMED_WORKERS = new Set();
let workerActive = false;
export const LOCAL_SEMANTIC_SCHEMA = "chainlesschain.memory-local-semantic/v1";

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function absoluteFile(value, label) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.includes("\0")
  ) {
    throw failure(
      "CC_MEMORY_SEMANTIC_CONFIG",
      `${label} must be an absolute path`,
    );
  }
  return fs.realpathSync(value);
}

function digestFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Local-only opt-in. No PATH lookup, download, inherited provider credentials or fallback encoder. */
export function resolveLocalSemanticConfiguration(env = process.env) {
  const mode = env.CC_MEMORY_SEMANTIC_MODE || "off";
  if (mode === "off") return null;
  if (mode !== "local-bge")
    throw failure("CC_MEMORY_SEMANTIC_CONFIG", "Unknown Memory semantic mode");
  const python = absoluteFile(
    env.CC_MEMORY_SEMANTIC_PYTHON,
    "Python executable",
  );
  const modelDirectory = absoluteFile(
    env.CC_MEMORY_SEMANTIC_MODEL_DIR,
    "BGE model directory",
  );
  const pythonDigest = env.CC_MEMORY_SEMANTIC_PYTHON_SHA256;
  if (!/^[a-f0-9]{64}$/.test(pythonDigest || "")) {
    throw failure(
      "CC_MEMORY_SEMANTIC_CONFIG",
      "Python executable SHA-256 is required",
    );
  }
  const threads = Number(env.CC_MEMORY_SEMANTIC_THREADS || 2);
  const timeoutMs = Number(env.CC_MEMORY_SEMANTIC_TIMEOUT_MS || 60_000);
  if (
    !Number.isInteger(threads) ||
    threads < 1 ||
    threads > 8 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 300_000
  ) {
    throw failure(
      "CC_MEMORY_SEMANTIC_CONFIG",
      "Invalid semantic CPU/time bounds",
    );
  }
  const environment = {};
  for (const name of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  Object.assign(environment, {
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false",
    CUDA_VISIBLE_DEVICES: "",
    OMP_NUM_THREADS: String(threads),
    MKL_NUM_THREADS: String(threads),
  });
  return Object.freeze({
    python,
    pythonDigest,
    modelDirectory,
    threads,
    timeoutMs,
    environment: Object.freeze(environment),
  });
}

/** Only one encoder per CLI process; concurrent requests fail explicitly instead of oversubscribing CPU. */
export async function runLocalSemanticWorker(
  configuration,
  request,
  controls = {},
) {
  controls.signal?.throwIfAborted();
  if (workerActive)
    throw failure(
      "CC_MEMORY_SEMANTIC_BUSY",
      "Another local Memory encoder is running; retry after it completes",
    );
  workerActive = true;
  try {
    return await executeLocalSemanticWorker(configuration, request, controls);
  } finally {
    workerActive = false;
  }
}

/** Normal Stop waits for close; unconfirmed cleanup rejects with an execution fence. */
async function executeLocalSemanticWorker(
  configuration,
  request,
  { signal } = {},
) {
  signal?.throwIfAborted();
  if (UNCONFIRMED_WORKERS.size) {
    throw failure(
      "CC_MEMORY_SEMANTIC_CLEANUP_UNCONFIRMED",
      "A previous semantic worker has not confirmed exit; no new worker may start",
    );
  }
  const { executionBroker } =
    await import("../process-execution-broker/index.js");
  signal?.throwIfAborted();
  if (digestFile(configuration.python) !== configuration.pythonDigest) {
    throw failure(
      "CC_MEMORY_SEMANTIC_IDENTITY",
      "Python executable identity changed",
    );
  }
  const workerDigest = digestFile(WORKER);
  const input = JSON.stringify({
    ...request,
    schema: LOCAL_SEMANTIC_SCHEMA,
    modelDirectory: configuration.modelDirectory,
    threads: configuration.threads,
  });
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
    throw failure(
      "CC_MEMORY_SEMANTIC_CAPACITY",
      "Memory semantic input exceeds 8 MiB",
    );
  }
  signal?.throwIfAborted();
  const output = await new Promise((resolve, reject) => {
    const child = executionBroker.spawn(
      configuration.python,
      ["-I", "-B", WORKER],
      {
        cwd: path.dirname(WORKER),
        env: { ...configuration.environment },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        origin: "memory-local-semantic",
        scope: "memory",
        policy: "allow",
      },
    );
    let pendingError = null;
    let cleanupTimer = null;
    let settled = false;
    let outputBytes = 0;
    let stderrBytes = 0;
    const chunks = [];
    const stop = (error) => {
      if (pendingError) return;
      pendingError = error;
      UNCONFIRMED_WORKERS.add(child);
      cleanupTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        const error = failure(
          "CC_MEMORY_SEMANTIC_CLEANUP_UNCONFIRMED",
          "Local semantic worker termination was not confirmed; semantic execution remains blocked until close",
        );
        error.recoveryRequired = true;
        error.cause = pendingError;
        reject(error);
      }, 5000);
      try {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      } catch {
        /* The cleanup deadline reports unconfirmed termination without claiming success. */
      }
    };
    const abort = () =>
      stop(
        signal.reason ||
          failure("ABORT_ERR", "Memory semantic recall interrupted"),
      );
    const timer = setTimeout(
      () =>
        stop(
          failure(
            "CC_MEMORY_SEMANTIC_TIMEOUT",
            "Local semantic worker timed out",
          ),
        ),
      configuration.timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () =>
      stop(
        failure(
          "CC_MEMORY_SEMANTIC_SPAWN",
          "Could not launch local semantic worker",
        ),
      ),
    );
    child.stdin.once("error", () =>
      stop(
        failure(
          "CC_MEMORY_SEMANTIC_INPUT",
          "Local semantic worker input failed",
        ),
      ),
    );
    child.stdout.on("data", (chunk) => {
      if (pendingError) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        stop(
          failure(
            "CC_MEMORY_SEMANTIC_OUTPUT",
            "Local semantic worker output exceeded its bound",
          ),
        );
      } else chunks.push(chunk);
    });
    // Never echo stderr: a failed dependency may include private query/record text.
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 64 * 1024)
        stop(
          failure(
            "CC_MEMORY_SEMANTIC_OUTPUT",
            "Local semantic worker diagnostics exceeded their bound",
          ),
        );
    });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      UNCONFIRMED_WORKERS.delete(child);
      signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      if (pendingError) return reject(pendingError);
      if (code !== 0 || exitSignal) {
        return reject(
          failure(
            "CC_MEMORY_SEMANTIC_WORKER",
            "Local semantic worker failed; verify the pinned model and local Python dependencies",
          ),
        );
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    if (signal?.aborted) abort();
    if (!pendingError) child.stdin.end(input);
  });
  signal?.throwIfAborted();
  if (
    digestFile(WORKER) !== workerDigest ||
    digestFile(configuration.python) !== configuration.pythonDigest
  ) {
    throw failure(
      "CC_MEMORY_SEMANTIC_IDENTITY",
      "Semantic executable identity changed during inference",
    );
  }
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw failure(
      "CC_MEMORY_SEMANTIC_OUTPUT",
      "Malformed local semantic result",
    );
  }
  if (
    result?.schema !== LOCAL_SEMANTIC_SCHEMA ||
    result.requestDigest !== createHash("sha256").update(input).digest("hex") ||
    result.modelRevision !== "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a" ||
    result.networkCalls !== 0 ||
    !Array.isArray(result.scores) ||
    result.scores.length !== request.records.length
  ) {
    throw failure(
      "CC_MEMORY_SEMANTIC_OUTPUT",
      "Local semantic result identity or cardinality mismatch",
    );
  }
  const ids = new Set(request.records.map((record) => record.memoryId));
  const seen = new Set();
  for (const row of result.scores) {
    if (
      !ids.has(row.memoryId) ||
      seen.has(row.memoryId) ||
      !Number.isFinite(row.score) ||
      row.score < 0 ||
      row.score > 1
    ) {
      throw failure(
        "CC_MEMORY_SEMANTIC_OUTPUT",
        "Invalid local semantic score",
      );
    }
    seen.add(row.memoryId);
  }
  return result.scores;
}

export function createLocalSemanticSource({
  memoryPort,
  env,
  clock = Date.now,
}) {
  // Resolve lazily: disabled recall/shadow must never inspect or launch a model.
  return Object.freeze({
    isEnabled() {
      return ((env || process.env).CC_MEMORY_SEMANTIC_MODE || "off") !== "off";
    },
    async candidates(request, { signal } = {}) {
      signal?.throwIfAborted();
      const configuration = resolveLocalSemanticConfiguration(env);
      if (!configuration || request.query === "*") return undefined;
      if (
        !Array.isArray(request.scopeAdmissions) ||
        request.scopeAdmissions.length === 0 ||
        typeof request.sink !== "string" ||
        !request.sink ||
        typeof request.query !== "string" ||
        !request.query.trim() ||
        request.query.length > 32 * 1024
      ) {
        throw failure(
          "CC_MEMORY_SEMANTIC_REQUEST",
          "Semantic recall requires query, scope admissions and sink",
        );
      }
      // Retrieval limits apply only after the full admitted corpus has been scored.
      const records = await memoryPort.query(
        {
          query: "*",
          sink: request.sink,
          scopeAdmissions: request.scopeAdmissions,
        },
        { signal },
      );
      signal?.throwIfAborted();
      const now = Number(clock());
      const eligible = records.filter(
        (record) =>
          ["active", "reinforced"].includes(record.state) &&
          (!record.retentionPolicy.expiresAt ||
            Date.parse(record.retentionPolicy.expiresAt) > now) &&
          request.scopeAdmissions.some(
            (scope) =>
              scope.scope === record.scope &&
              (scope.scopeId === record.scopeId ||
                (scope.scope === "global" &&
                  scope.scopeId == null &&
                  record.scopeId == null)),
          ) &&
          (record.allowedSinks.includes("*") ||
            record.allowedSinks.includes(request.sink)),
      );
      if (eligible.length > MAX_RECORDS) {
        throw failure(
          "CC_MEMORY_SEMANTIC_CAPACITY",
          "Local semantic recall exceeds 10000 admitted records; no partial corpus was searched",
        );
      }
      if (!eligible.length) return [];
      const scores = await runLocalSemanticWorker(
        configuration,
        {
          query: request.query,
          records: eligible.map((record) => ({
            memoryId: record.memoryId,
            content: record.content,
          })),
        },
        { signal },
      );
      signal?.throwIfAborted();
      const byId = new Map(eligible.map((record) => [record.memoryId, record]));
      return scores
        .filter((row) => row.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.memoryId.localeCompare(right.memoryId, "en"),
        )
        .slice(0, 1000)
        .map((row) => {
          const record = byId.get(row.memoryId);
          return {
            memoryId: record.memoryId,
            revision: record.revision,
            recordDigest: record.digest,
            score: row.score,
          };
        });
    },
  });
}
