"use strict";

/**
 * Trusted one-shot worker for external Markdown Skill handlers.
 *
 * This file runs in a separate Node process with the permission model enabled
 * and inside ProcessExecutionBroker's filesystem/network sandbox. Untrusted
 * source runs in a context with string code generation disabled and receives
 * no Node globals. stdout is reserved exclusively for the bounded protocol.
 */

const vm = require("node:vm");

const PROTOCOL_VERSION = 1;
const MAX_INBOUND_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_CAPABILITY_REQUESTS = 64;
const MAX_SYNC_SLICE_MS = 1_000;
const CAPABILITY_RE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const OPERATION_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ERROR_CODE_RE = /^CC_SKILL_[A-Z0-9_]{1,80}$/;

let inbound = Buffer.alloc(0);
let executionId = null;
let started = false;
let finished = false;
let capabilitySequence = 0;
const pendingCapabilities = new Map();

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

function send(frame) {
  if (finished && frame.type !== "error" && frame.type !== "result") {
    return Promise.reject(new Error("worker_finished"));
  }
  const payload = `${JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    executionId,
    ...frame,
  })}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_INBOUND_FRAME_BYTES) {
    return Promise.reject(
      Object.assign(new Error("protocol_frame_too_large"), {
        code: "CC_SKILL_EXECUTOR_FRAME_TOO_LARGE",
      }),
    );
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(payload, "utf8", (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function workerError(code, message, phase = "execute") {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  return error;
}

function normalizeError(error) {
  return {
    type: "error",
    code: ERROR_CODE_RE.test(String(error?.code || ""))
      ? String(error.code)
      : "CC_SKILL_HANDLER_EXECUTION_FAILED",
    message: boundedText(error?.message || error || "Skill execution failed"),
    phase: boundedText(error?.phase || "execute", 32),
  };
}

function exitAfter(frame, exitCode) {
  if (finished) {
    return;
  }
  finished = true;
  for (const pending of pendingCapabilities.values()) {
    pending.reject(
      workerError(
        "CC_SKILL_EXECUTOR_PROCESS_EXITED",
        "Skill worker exited before the capability response arrived",
        "capability",
      ),
    );
  }
  pendingCapabilities.clear();
  send(frame)
    .catch(() => {})
    .finally(() => process.exit(exitCode));
}

function requestCapability(capability, operation, input = null) {
  capabilitySequence += 1;
  if (capabilitySequence > MAX_CAPABILITY_REQUESTS) {
    return Promise.reject(
      workerError(
        "CC_SKILL_CAPABILITY_REQUEST_LIMIT",
        "Skill capability request limit exceeded",
        "capability",
      ),
    );
  }
  const normalizedCapability = String(capability || "");
  const normalizedOperation = String(operation || "");
  if (
    !CAPABILITY_RE.test(normalizedCapability) ||
    !OPERATION_RE.test(normalizedOperation)
  ) {
    return Promise.reject(
      workerError(
        "CC_SKILL_CAPABILITY_REQUEST_INVALID",
        "Skill capability request is invalid",
        "capability",
      ),
    );
  }
  const requestId = `${capabilitySequence}-${Date.now().toString(36)}`;
  return new Promise((resolve, reject) => {
    pendingCapabilities.set(requestId, { resolve, reject });
    send({
      type: "capability-request",
      requestId,
      capability: normalizedCapability,
      operation: normalizedOperation,
      input,
    }).catch((error) => {
      pendingCapabilities.delete(requestId);
      reject(error);
    });
  });
}

function acceptCapabilityResponse(frame) {
  const pending = pendingCapabilities.get(String(frame.requestId || ""));
  if (!pending) {
    throw workerError(
      "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
      "Unknown capability response id",
      "protocol",
    );
  }
  pendingCapabilities.delete(frame.requestId);
  if (frame.ok === true) {
    pending.resolve(frame.result);
  } else {
    pending.reject(
      workerError(
        ERROR_CODE_RE.test(String(frame.code || ""))
          ? String(frame.code)
          : "CC_SKILL_CAPABILITY_FAILED",
        boundedText(frame.message || "Capability request failed"),
        "capability",
      ),
    );
  }
}

function createSandbox(hostCapabilityCall) {
  const sandbox = Object.create(null);
  sandbox.__hostCapabilityCall = (capability, operation, inputJson, settle) => {
    try {
      hostCapabilityCall(
        String(capability || ""),
        String(operation || ""),
        String(inputJson || "null"),
      ).then(
        (resultJson) => settle(true, resultJson, "", ""),
        (error) =>
          settle(
            false,
            "null",
            ERROR_CODE_RE.test(String(error?.code || ""))
              ? String(error.code)
              : "CC_SKILL_CAPABILITY_FAILED",
            boundedText(error?.message || error),
          ),
      );
    } catch (error) {
      settle(
        false,
        "null",
        ERROR_CODE_RE.test(String(error?.code || ""))
          ? String(error.code)
          : "CC_SKILL_CAPABILITY_FAILED",
        boundedText(error?.message || error),
      );
    }
  };
  const context = vm.createContext(sandbox, {
    name: "chainlesschain-external-skill",
    codeGeneration: { strings: false, wasm: false },
  });
  const bootstrap = new vm.Script(
    `
    "use strict";
    globalThis.module = { exports: {} };
    globalThis.exports = globalThis.module.exports;
    const __callCapability = globalThis.__hostCapabilityCall;
    delete globalThis.__hostCapabilityCall;
    globalThis.chainlesschain = Object.freeze({
      capabilities: Object.freeze({
        call(capability, operation, input = null) {
          return new Promise((resolve, reject) => {
            let inputJson;
            try {
              inputJson = JSON.stringify(input);
            } catch (_error) {
              const error = new Error("Capability input must be JSON-compatible");
              error.code = "CC_SKILL_CAPABILITY_REQUEST_INVALID";
              reject(error);
              return;
            }
            __callCapability(
              String(capability || ""),
              String(operation || ""),
              inputJson,
              (ok, resultJson, code, message) => {
                if (ok) {
                  try {
                    resolve(JSON.parse(resultJson));
                  } catch (_error) {
                    const error = new Error("Capability result is invalid");
                    error.code = "CC_SKILL_CAPABILITY_FAILED";
                    reject(error);
                  }
                  return;
                }
                const error = new Error(message || "Capability request failed");
                error.code = code || "CC_SKILL_CAPABILITY_FAILED";
                reject(error);
              }
            );
          });
        }
      })
    });
    globalThis.console = Object.freeze({
      log() {}, info() {}, warn() {}, error() {}, debug() {}
    });
    globalThis.process = undefined;
    globalThis.require = undefined;
    globalThis.Buffer = undefined;
    globalThis.global = undefined;
  `,
    { filename: "external-skill-bootstrap.js" },
  );
  bootstrap.runInContext(context, { timeout: MAX_SYNC_SLICE_MS });
  return context;
}

async function execute(frame) {
  const source = String(frame.handlerSource || "");
  if (!source) {
    throw workerError(
      "CC_SKILL_EXECUTOR_SOURCE_INVALID",
      "External Skill handler source is empty",
      "load",
    );
  }
  const declaredCapabilities = new Set(
    Array.isArray(frame.executionCapabilities)
      ? frame.executionCapabilities.map(String)
      : [],
  );
  const context = createSandbox((capability, operation, inputJson) => {
    const normalized = String(capability || "");
    if (!declaredCapabilities.has(normalized)) {
      return Promise.reject(
        workerError(
          "CC_SKILL_CAPABILITY_UNDECLARED",
          `Skill did not declare capability ${boundedText(normalized, 128)}`,
          "capability",
        ),
      );
    }
    let input;
    try {
      input = JSON.parse(inputJson);
    } catch {
      return Promise.reject(
        workerError(
          "CC_SKILL_CAPABILITY_REQUEST_INVALID",
          "Skill capability input is invalid",
          "capability",
        ),
      );
    }
    return requestCapability(normalized, operation, input).then((result) =>
      JSON.stringify(result),
    );
  });

  const loadScript = new vm.Script(
    `"use strict";\n(function (module, exports, chainlesschain) {\n${source}\n})(module, exports, chainlesschain);`,
    { filename: "external-skill-handler.cjs" },
  );
  loadScript.runInContext(context, { timeout: MAX_SYNC_SLICE_MS });

  context.__taskJson = JSON.stringify(frame.task ?? {});
  context.__contextJson = JSON.stringify(frame.context ?? {});
  context.__skillJson = JSON.stringify({
    skillId: frame.skillId,
    source: frame.source,
    executionCapabilities: [...declaredCapabilities],
  });
  const invokeScript = new vm.Script(
    `
    (async () => {
      "use strict";
      const task = JSON.parse(__taskJson);
      const executionContext = JSON.parse(__contextJson);
      const skill = Object.freeze(JSON.parse(__skillJson));
      delete globalThis.__taskJson;
      delete globalThis.__contextJson;
      delete globalThis.__skillJson;
      const handler = module.exports;
      if (handler && typeof handler.init === "function") {
        await handler.init(skill);
      }
      if (handler && typeof handler.execute === "function") {
        return await handler.execute(task, executionContext, skill);
      }
      if (typeof handler === "function") {
        return await handler(task, executionContext, skill);
      }
      throw Object.assign(
        new Error("External Skill handler does not export an execute function"),
        { code: "CC_SKILL_HANDLER_EXPORT_INVALID", phase: "load" }
      );
    })()
  `,
    { filename: "external-skill-invoke.js" },
  );
  const result = await invokeScript.runInContext(context, {
    timeout: MAX_SYNC_SLICE_MS,
  });
  context.__handlerResult = result;
  const serialized = new vm.Script("JSON.stringify(__handlerResult)", {
    filename: "external-skill-result.js",
  }).runInContext(context, { timeout: MAX_SYNC_SLICE_MS });
  delete context.__handlerResult;
  if (typeof serialized !== "string") {
    throw workerError(
      "CC_SKILL_HANDLER_RESULT_INVALID",
      "External Skill handler result must be JSON-compatible",
      "result",
    );
  }
  const resultBytes = Buffer.byteLength(serialized, "utf8");
  const configuredLimit = Number.isSafeInteger(frame.limits?.maxResultBytes)
    ? Math.min(frame.limits.maxResultBytes, MAX_RESULT_BYTES)
    : MAX_RESULT_BYTES;
  if (resultBytes > configuredLimit) {
    throw workerError(
      "CC_SKILL_HANDLER_RESULT_TOO_LARGE",
      `External Skill handler result exceeds ${configuredLimit} bytes`,
      "result",
    );
  }
  return JSON.parse(serialized);
}

function handleFrame(frame) {
  if (
    !frame ||
    typeof frame !== "object" ||
    frame.protocolVersion !== PROTOCOL_VERSION
  ) {
    throw workerError(
      "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
      "Invalid external Skill protocol frame",
      "protocol",
    );
  }
  if (frame.type === "capability-response") {
    if (!started || frame.executionId !== executionId) {
      throw workerError(
        "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
        "Capability response does not match the active execution",
        "protocol",
      );
    }
    acceptCapabilityResponse(frame);
    return;
  }
  if (frame.type !== "execute" || started) {
    throw workerError(
      "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
      "Worker accepts exactly one execution request",
      "protocol",
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(frame.executionId || ""))) {
    throw workerError(
      "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
      "Execution id is invalid",
      "protocol",
    );
  }
  started = true;
  executionId = frame.executionId;
  execute(frame)
    .then((result) => exitAfter({ type: "result", result }, 0))
    .catch((error) => exitAfter(normalizeError(error), 1));
}

process.stdin.on("data", (chunk) => {
  if (finished) {
    return;
  }
  inbound = Buffer.concat([inbound, Buffer.from(chunk)]);
  if (inbound.length > MAX_INBOUND_FRAME_BYTES) {
    exitAfter(
      normalizeError(
        workerError(
          "CC_SKILL_EXECUTOR_FRAME_TOO_LARGE",
          "External Skill protocol input exceeds the frame limit",
          "protocol",
        ),
      ),
      1,
    );
    return;
  }
  let newline;
  while (!finished && (newline = inbound.indexOf(0x0a)) !== -1) {
    const frameBytes = inbound.subarray(0, newline);
    inbound = inbound.subarray(newline + 1);
    try {
      handleFrame(JSON.parse(frameBytes.toString("utf8")));
    } catch (error) {
      exitAfter(normalizeError(error), 1);
    }
  }
});

process.stdin.on("end", () => {
  if (!finished && !started) {
    exitAfter(
      normalizeError(
        workerError(
          "CC_SKILL_EXECUTOR_PROTOCOL_INVALID",
          "External Skill worker received no execution request",
          "protocol",
        ),
      ),
      1,
    );
  }
});

process.stdin.on("error", (error) => {
  exitAfter(
    normalizeError(
      workerError(
        "CC_SKILL_EXECUTOR_PROTOCOL_READ_FAILED",
        boundedText(error?.message || error),
        "protocol",
      ),
    ),
    1,
  );
});
