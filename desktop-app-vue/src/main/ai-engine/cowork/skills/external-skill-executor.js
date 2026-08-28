/**
 * One-shot isolated executor for signed external Markdown Skill handlers.
 *
 * Handler bytes are never written to disk or loaded by Electron main. The
 * trusted worker is launched through ProcessExecutionBroker with filesystem
 * and network boundaries, then receives one bounded JSON-lines request over
 * stdio. Privileged operations can only return through SkillCapabilityBroker.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { logger } = require("../../../utils/logger.js");

const PROTOCOL_VERSION = 1;
const MAX_HANDLER_BYTES = 1024 * 1024;
const MAX_DATA_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_PROTOCOL_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_CAPABILITY_REQUESTS = 64;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
const DEFAULT_CAPABILITY_TIMEOUT_MS = 5_000;
const MAX_EXECUTION_TIMEOUT_MS = 120_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const CAPABILITY_RE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const OPERATION_RE = /^[a-z][a-z0-9-]{0,63}$/;
const IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ERROR_CODE_RE = /^CC_SKILL_[A-Z0-9_]{1,80}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SANDBOX_POLICY = Object.freeze({
  requiredBoundaries: Object.freeze(["filesystem", "network"]),
});

let defaultExecutor = null;
let processBrokerPromise = null;

function executorError(code, message, details = {}) {
  const error = new Error(
    message,
    details.cause ? { cause: details.cause } : undefined,
  );
  error.name = "ExternalSkillExecutorError";
  error.code = code;
  for (const [key, value] of Object.entries(details)) {
    if (key !== "cause" && value !== undefined) {
      error[key] = value;
    }
  }
  return error;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, maximum);
}

function boundedText(value, maxBytes = 512) {
  const text = String(value ?? "").replace(/[\r\n\0]/g, " ");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  let output = "";
  for (const character of text) {
    if (Buffer.byteLength(output + character, "utf8") > maxBytes) {
      break;
    }
    output += character;
  }
  return output;
}

function normalizeIdentifier(value, label) {
  const normalized = String(value || "").trim();
  if (!IDENTIFIER_RE.test(normalized)) {
    throw executorError(
      "CC_SKILL_EXECUTOR_REQUEST_INVALID",
      `${label} is invalid`,
    );
  }
  return normalized;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw executorError(
      "CC_SKILL_EXECUTOR_REQUEST_INVALID",
      "executionCapabilities must contain between 1 and 64 entries",
    );
  }
  const capabilities = [];
  for (const raw of value) {
    const capability = String(raw || "").trim();
    if (!CAPABILITY_RE.test(capability)) {
      throw executorError(
        "CC_SKILL_EXECUTOR_REQUEST_INVALID",
        `Invalid execution capability: ${boundedText(capability)}`,
      );
    }
    if (!capabilities.includes(capability)) {
      capabilities.push(capability);
    }
  }
  return capabilities.sort();
}

function cloneJsonData(value, label, maxBytes = MAX_DATA_BYTES) {
  const state = { nodes: 0 };
  const visit = (input, depth) => {
    state.nodes += 1;
    if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw executorError(
        "CC_SKILL_EXECUTOR_DATA_INVALID",
        `${label} exceeds the structured-data complexity limit`,
      );
    }
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    ) {
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw executorError(
          "CC_SKILL_EXECUTOR_DATA_INVALID",
          `${label} contains a non-finite number`,
        );
      }
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((item) => visit(item, depth + 1));
    }
    if (typeof input !== "object") {
      throw executorError(
        "CC_SKILL_EXECUTOR_DATA_INVALID",
        `${label} must contain JSON-compatible data only`,
      );
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw executorError(
        "CC_SKILL_EXECUTOR_DATA_INVALID",
        `${label} contains a non-plain object`,
      );
    }
    const output = Object.create(null);
    for (const [key, item] of Object.entries(input)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw executorError(
          "CC_SKILL_EXECUTOR_DATA_INVALID",
          `${label} contains a forbidden object key`,
        );
      }
      output[key] = visit(item, depth + 1);
    }
    return output;
  };

  const cloned = visit(value === undefined ? {} : value, 0);
  const serialized = JSON.stringify(cloned);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) {
    throw executorError(
      "CC_SKILL_EXECUTOR_DATA_TOO_LARGE",
      `${label} exceeds the ${maxBytes}-byte limit`,
      { bytes, maxBytes },
    );
  }
  return { value: cloned, serialized, bytes };
}

function defaultAuditSink(event) {
  const level = event.outcome === "denied" ? "warn" : "info";
  logger[level](`[ExternalSkillExecutor] ${JSON.stringify(event)}`);
}

function emitAudit(auditSink, event) {
  try {
    auditSink(
      Object.freeze({
        timestamp: new Date().toISOString(),
        ...event,
      }),
    );
  } catch (cause) {
    throw executorError(
      "CC_SKILL_EXECUTOR_AUDIT_UNAVAILABLE",
      "External Skill execution audit is unavailable",
      { cause },
    );
  }
}

function normalizePorts(ports) {
  if (ports instanceof Map) {
    return new Map(ports);
  }
  if (!ports || typeof ports !== "object" || Array.isArray(ports)) {
    return new Map();
  }
  return new Map(Object.entries(ports));
}

class SkillCapabilityBroker {
  constructor(options = {}) {
    this.ports = normalizePorts(options.ports);
    this.auditSink = options.auditSink || defaultAuditSink;
    this.maxRequests = positiveInteger(
      options.maxRequests,
      MAX_CAPABILITY_REQUESTS,
      MAX_CAPABILITY_REQUESTS,
    );
    this.timeoutMs = positiveInteger(
      options.timeoutMs,
      DEFAULT_CAPABILITY_TIMEOUT_MS,
      MAX_EXECUTION_TIMEOUT_MS,
    );
  }

  async invoke(request, execution) {
    execution.capabilityRequests += 1;
    const auditBase = {
      event: "capability",
      executionId: execution.executionId,
      skillId: execution.skillId,
      capability: boundedText(request.capability, 128),
      operation: boundedText(request.operation, 64),
      requestIndex: execution.capabilityRequests,
    };
    if (execution.capabilityRequests > this.maxRequests) {
      emitAudit(this.auditSink, {
        ...auditBase,
        outcome: "denied",
        reason: "request_limit",
      });
      throw executorError(
        "CC_SKILL_CAPABILITY_REQUEST_LIMIT",
        "External Skill capability request limit exceeded",
      );
    }

    const capability = String(request.capability || "");
    const operation = String(request.operation || "");
    if (!CAPABILITY_RE.test(capability) || !OPERATION_RE.test(operation)) {
      emitAudit(this.auditSink, {
        ...auditBase,
        outcome: "denied",
        reason: "invalid_request",
      });
      throw executorError(
        "CC_SKILL_CAPABILITY_REQUEST_INVALID",
        "External Skill capability request is invalid",
      );
    }
    if (!execution.capabilities.has(capability)) {
      emitAudit(this.auditSink, {
        ...auditBase,
        outcome: "denied",
        reason: "undeclared",
      });
      throw executorError(
        "CC_SKILL_CAPABILITY_UNDECLARED",
        `External Skill did not declare capability ${capability}`,
      );
    }

    const port = this.ports.get(capability);
    const handler =
      typeof port === "function"
        ? port
        : port &&
            Object.hasOwn(port, operation) &&
            typeof port[operation] === "function"
          ? port[operation].bind(port)
          : null;
    if (!handler) {
      emitAudit(this.auditSink, {
        ...auditBase,
        outcome: "denied",
        reason: "port_unavailable",
      });
      throw executorError(
        "CC_SKILL_CAPABILITY_UNAVAILABLE",
        `Capability ${capability} is not connected to an approved host port`,
      );
    }

    const input = cloneJsonData(request.input, "capability input");
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            executorError(
              "CC_SKILL_CAPABILITY_TIMEOUT",
              `Capability ${capability} timed out`,
            ),
          );
        }, this.timeoutMs);
        timer.unref?.();
      });
      const result = await Promise.race([
        Promise.resolve(
          handler({
            skillId: execution.skillId,
            executionId: execution.executionId,
            capability,
            operation,
            input: input.value,
            signal: controller.signal,
          }),
        ),
        timeout,
      ]);
      const output = cloneJsonData(result, "capability result");
      emitAudit(this.auditSink, {
        ...auditBase,
        outcome: "allowed",
        inputBytes: input.bytes,
        outputBytes: output.bytes,
      });
      return output.value;
    } catch (error) {
      if (error?.code?.startsWith("CC_SKILL_")) {
        throw error;
      }
      emitAudit(this.auditSink, {
        ...auditBase,
        outcome: "denied",
        reason: "port_error",
      });
      throw executorError(
        "CC_SKILL_CAPABILITY_FAILED",
        `Capability ${capability} failed: ${boundedText(error?.message || error)}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveCliProcessBrokerModule() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(
      path.join(
        process.resourcesPath,
        "packages",
        "cli",
        "src",
        "lib",
        "process-execution-broker",
        "index.js",
      ),
    );
  }
  candidates.push(
    path.resolve(
      __dirname,
      "../../../../../../packages/cli/src/lib/process-execution-broker/index.js",
    ),
  );
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) {
    throw executorError(
      "CC_SKILL_EXECUTOR_BROKER_UNAVAILABLE",
      "ProcessExecutionBroker is unavailable for external Skill isolation",
    );
  }
  return selected;
}

function loadProcessBroker() {
  if (!processBrokerPromise) {
    const modulePath = resolveCliProcessBrokerModule();
    processBrokerPromise = import(pathToFileURL(modulePath).href)
      .then((module) => {
        const broker = module.executionBroker || module.default;
        if (!broker || typeof broker.spawn !== "function") {
          throw new Error("ProcessExecutionBroker exports are unavailable");
        }
        return broker;
      })
      .catch((cause) => {
        processBrokerPromise = null;
        throw executorError(
          "CC_SKILL_EXECUTOR_BROKER_UNAVAILABLE",
          "ProcessExecutionBroker could not be loaded",
          { cause },
        );
      });
  }
  return processBrokerPromise;
}

function resolveWorkerPath() {
  const sourceWorker = path.join(
    __dirname,
    "runtime",
    "external-skill-worker.js",
  );
  const packagedWorkers = process.resourcesPath
    ? [
        path.join(
          process.resourcesPath,
          "skill-runtime",
          "external-skill-worker.js",
        ),
        path.join(process.resourcesPath, "runtime", "external-skill-worker.js"),
      ]
    : [];
  const candidates = __dirname.includes("app.asar")
    ? [...packagedWorkers, sourceWorker]
    : [sourceWorker, ...packagedWorkers];
  const selected = candidates.find(
    (candidate) => candidate && fs.existsSync(candidate),
  );
  if (!selected) {
    throw executorError(
      "CC_SKILL_EXECUTOR_WORKER_UNAVAILABLE",
      "Trusted external Skill worker is unavailable",
    );
  }
  return fs.realpathSync(selected);
}

function minimalWorkerEnv() {
  const env = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of ["SystemRoot", "WINDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) {
    if (process.env[key] != null) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function workerArguments(workerPath) {
  return [
    "--permission",
    "--no-addons",
    "--disable-proto=delete",
    `--allow-fs-read=${workerPath}`,
    workerPath,
  ];
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw executorError(
      "CC_SKILL_EXECUTOR_REQUEST_INVALID",
      "External Skill execution request must be an object",
    );
  }
  const handlerSource = String(request.handlerSource || "");
  const handlerBytes = Buffer.byteLength(handlerSource, "utf8");
  if (!handlerSource || handlerBytes > MAX_HANDLER_BYTES) {
    throw executorError(
      "CC_SKILL_EXECUTOR_SOURCE_INVALID",
      `External Skill handler source must be between 1 and ${MAX_HANDLER_BYTES} bytes`,
      { handlerBytes },
    );
  }
  for (const [label, value] of [
    ["contentDigest", request.contentDigest],
    ["publicKeySha256", request.publicKeySha256],
  ]) {
    if (!/^[a-f0-9]{64}$/i.test(String(value || ""))) {
      throw executorError(
        "CC_SKILL_EXECUTOR_REQUEST_INVALID",
        `${label} must be a SHA-256 digest`,
      );
    }
  }
  const task = cloneJsonData(request.task, "task");
  const contextInput = { ...(request.context || {}) };
  delete contextInput.signal;
  const context = cloneJsonData(contextInput, "context");
  return {
    skillId: normalizeIdentifier(request.skillId, "skillId"),
    source: normalizeIdentifier(request.source || "external", "source"),
    handlerFileName: boundedText(request.handlerFileName || "handler.js", 256),
    handlerSource,
    handlerBytes,
    handlerSha256: crypto
      .createHash("sha256")
      .update(handlerSource)
      .digest("hex"),
    contentDigest: String(request.contentDigest).toLowerCase(),
    publicKeySha256: String(request.publicKeySha256).toLowerCase(),
    executionCapabilities: normalizeCapabilities(request.executionCapabilities),
    task: task.value,
    context: context.value,
    abortSignal: request.context?.signal || null,
  };
}

function serializeFrame(frame) {
  const payload = `${JSON.stringify(frame)}\n`;
  const bytes = Buffer.byteLength(payload, "utf8");
  if (bytes > MAX_PROTOCOL_FRAME_BYTES) {
    throw executorError(
      "CC_SKILL_EXECUTOR_FRAME_TOO_LARGE",
      "External Skill protocol frame exceeds the configured limit",
      { bytes, maxBytes: MAX_PROTOCOL_FRAME_BYTES },
    );
  }
  return payload;
}

function writeFrame(stream, frame) {
  const payload = serializeFrame(frame);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      stream.off("error", onError);
      reject(error);
    };
    stream.once("error", onError);
    stream.write(payload, "utf8", () => {
      stream.off("error", onError);
      resolve();
    });
  });
}

function normalizeWorkerError(frame) {
  const code = ERROR_CODE_RE.test(String(frame.code || ""))
    ? String(frame.code)
    : "CC_SKILL_HANDLER_EXECUTION_FAILED";
  return executorError(
    code,
    boundedText(frame.message || "External Skill handler execution failed"),
    { phase: boundedText(frame.phase || "execute", 32) },
  );
}

function createExternalSkillExecutor(options = {}) {
  const auditSink = options.auditSink || defaultAuditSink;
  const capabilityBroker =
    options.capabilityBroker ||
    new SkillCapabilityBroker({
      ports: options.capabilityPorts,
      auditSink,
      timeoutMs: options.capabilityTimeoutMs,
      maxRequests: options.maxCapabilityRequests,
    });
  const loadBroker = options.loadProcessBroker || loadProcessBroker;
  const getWorkerPath = options.resolveWorkerPath || resolveWorkerPath;
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    DEFAULT_EXECUTION_TIMEOUT_MS,
    MAX_EXECUTION_TIMEOUT_MS,
  );

  return async function executeExternalSkill(rawRequest) {
    const request = validateRequest(rawRequest);
    const executionId = crypto.randomUUID();
    const execution = {
      executionId,
      skillId: request.skillId,
      capabilities: new Set(request.executionCapabilities),
      capabilityRequests: 0,
    };
    const workerPath = getWorkerPath();
    const executeFrame = {
      protocolVersion: PROTOCOL_VERSION,
      type: "execute",
      executionId,
      skillId: request.skillId,
      source: request.source,
      handlerFileName: request.handlerFileName,
      handlerSource: request.handlerSource,
      handlerSha256: request.handlerSha256,
      contentDigest: request.contentDigest,
      publicKeySha256: request.publicKeySha256,
      executionCapabilities: request.executionCapabilities,
      task: request.task,
      context: request.context,
      limits: {
        maxResultBytes: MAX_RESULT_BYTES,
        maxCapabilityRequests: MAX_CAPABILITY_REQUESTS,
      },
    };
    // Validate the exact wire representation before any process is spawned.
    serializeFrame(executeFrame);
    const broker = await loadBroker();
    emitAudit(auditSink, {
      event: "execution-start",
      executionId,
      skillId: request.skillId,
      source: request.source,
      handlerSha256: request.handlerSha256,
      contentDigest: request.contentDigest,
      publicKeySha256: request.publicKeySha256,
      capabilities: request.executionCapabilities,
      handlerBytes: request.handlerBytes,
      outcome: "admitted",
    });

    return await new Promise((resolve, reject) => {
      let child;
      let settled = false;
      let stdoutBuffer = Buffer.alloc(0);
      let stderrBuffer = Buffer.alloc(0);
      let timer = null;
      const abortSignal = request.abortSignal;

      const cleanup = () => {
        clearTimeout(timer);
        abortSignal?.removeEventListener?.("abort", onAbort);
        child?.stdout?.removeAllListeners();
        child?.stderr?.removeAllListeners();
        child?.removeAllListeners();
      };
      const finish = (error, result) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (child && child.exitCode == null && child.signalCode == null) {
          child.kill();
        }
        const outcome = error ? "failed" : "succeeded";
        try {
          emitAudit(auditSink, {
            event: "execution-finish",
            executionId,
            skillId: request.skillId,
            outcome,
            capabilityRequests: execution.capabilityRequests,
            ...(error
              ? { code: error.code || "CC_SKILL_HANDLER_EXECUTION_FAILED" }
              : {}),
          });
        } catch (auditError) {
          error = auditError;
        }
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };
      const failProtocol = (code, message, details) => {
        finish(executorError(code, message, details));
      };
      const onAbort = () => {
        failProtocol(
          "CC_SKILL_EXECUTION_ABORTED",
          "External Skill execution was aborted",
        );
      };

      const handleFrame = async (frame) => {
        if (
          !frame ||
          typeof frame !== "object" ||
          frame.protocolVersion !== PROTOCOL_VERSION ||
          frame.executionId !== executionId
        ) {
          failProtocol(
            "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
            "External Skill worker returned an invalid protocol frame",
          );
          return;
        }
        if (frame.type === "result") {
          try {
            const result = cloneJsonData(
              frame.result,
              "handler result",
              MAX_RESULT_BYTES,
            );
            finish(null, result.value);
          } catch (error) {
            finish(error);
          }
          return;
        }
        if (frame.type === "error") {
          finish(normalizeWorkerError(frame));
          return;
        }
        if (frame.type !== "capability-request") {
          failProtocol(
            "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
            "External Skill worker returned an unsupported frame type",
          );
          return;
        }
        const requestId = String(frame.requestId || "");
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) {
          failProtocol(
            "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
            "External Skill worker returned an invalid capability request id",
          );
          return;
        }
        try {
          const result = await capabilityBroker.invoke(frame, execution);
          if (!settled) {
            await writeFrame(child.stdin, {
              protocolVersion: PROTOCOL_VERSION,
              type: "capability-response",
              executionId,
              requestId,
              ok: true,
              result,
            });
          }
        } catch (error) {
          if (!settled) {
            await writeFrame(child.stdin, {
              protocolVersion: PROTOCOL_VERSION,
              type: "capability-response",
              executionId,
              requestId,
              ok: false,
              code: ERROR_CODE_RE.test(String(error?.code || ""))
                ? error.code
                : "CC_SKILL_CAPABILITY_FAILED",
              message: boundedText(error?.message || error),
            });
          }
        }
      };

      const consumeStdout = (chunk) => {
        if (settled) {
          return;
        }
        stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
        if (stdoutBuffer.length > MAX_PROTOCOL_FRAME_BYTES) {
          failProtocol(
            "CC_SKILL_EXECUTOR_FRAME_TOO_LARGE",
            "External Skill worker output exceeds the frame limit",
          );
          return;
        }
        let newline;
        while (!settled && (newline = stdoutBuffer.indexOf(0x0a)) !== -1) {
          const frameBytes = stdoutBuffer.subarray(0, newline);
          stdoutBuffer = stdoutBuffer.subarray(newline + 1);
          let frame;
          try {
            frame = JSON.parse(frameBytes.toString("utf8"));
          } catch {
            failProtocol(
              "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
              "External Skill worker emitted invalid JSON",
            );
            return;
          }
          Promise.resolve(handleFrame(frame)).catch((error) => finish(error));
        }
      };

      try {
        child = broker.spawn(process.execPath, workerArguments(workerPath), {
          origin: `skill:external:${request.skillId}`,
          scope: "cowork-external-skill",
          policy: "allow",
          cwd: path.dirname(workerPath),
          env: minimalWorkerEnv(),
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          sandboxPolicy: SANDBOX_POLICY,
        });
      } catch (cause) {
        finish(
          executorError(
            "CC_SKILL_EXECUTOR_SPAWN_FAILED",
            "External Skill worker could not be started with required sandbox boundaries",
            { cause },
          ),
        );
        return;
      }

      child.stdout.on("data", consumeStdout);
      child.stderr.on("data", (chunk) => {
        if (settled) {
          return;
        }
        stderrBuffer = Buffer.concat([stderrBuffer, Buffer.from(chunk)]);
        if (stderrBuffer.length > MAX_STDERR_BYTES) {
          failProtocol(
            "CC_SKILL_EXECUTOR_STDERR_LIMIT",
            "External Skill worker exceeded its diagnostic output limit",
          );
        }
      });
      child.once("error", (cause) => {
        finish(
          executorError(
            "CC_SKILL_EXECUTOR_PROCESS_FAILED",
            "External Skill worker process failed",
            { cause },
          ),
        );
      });
      child.once("close", (code, signal) => {
        if (settled) {
          return;
        }
        finish(
          executorError(
            "CC_SKILL_EXECUTOR_PROCESS_EXITED",
            `External Skill worker exited before a result (code=${code}, signal=${signal || "none"})`,
            { diagnostic: boundedText(stderrBuffer.toString("utf8"), 1024) },
          ),
        );
      });

      timer = setTimeout(() => {
        failProtocol(
          "CC_SKILL_EXECUTION_TIMEOUT",
          `External Skill execution exceeded ${timeoutMs}ms`,
          { timeoutMs },
        );
      }, timeoutMs);
      timer.unref?.();
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      abortSignal?.addEventListener?.("abort", onAbort, { once: true });

      writeFrame(child.stdin, executeFrame).catch((cause) => {
        finish(
          executorError(
            "CC_SKILL_EXECUTOR_PROTOCOL_WRITE_FAILED",
            "External Skill execution request could not be delivered",
            { cause },
          ),
        );
      });
    });
  };
}

function getDefaultExternalSkillExecutor() {
  if (!defaultExecutor) {
    defaultExecutor = createExternalSkillExecutor();
  }
  return defaultExecutor;
}

module.exports = {
  PROTOCOL_VERSION,
  MAX_HANDLER_BYTES,
  MAX_DATA_BYTES,
  MAX_RESULT_BYTES,
  MAX_PROTOCOL_FRAME_BYTES,
  SANDBOX_POLICY,
  SkillCapabilityBroker,
  createExternalSkillExecutor,
  getDefaultExternalSkillExecutor,
  cloneJsonData,
  resolveWorkerPath,
};
