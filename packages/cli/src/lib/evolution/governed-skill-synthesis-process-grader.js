import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import executionBroker, {
  SANDBOX_BOUNDARIES,
} from "../process-execution-broker/index.js";
import { BUILT_IN_PROVIDERS } from "../llm-providers.js";

export const GOVERNED_SKILL_SYNTHESIS_PROCESS_GRADER_SCHEMA =
  "chainlesschain.governed-skill-synthesis-process-grader/v1";

const WORKER = fileURLToPath(
  new URL(
    "./governed-skill-synthesis-process-grader-worker.mjs",
    import.meta.url,
  ),
);
const PROCESS_GRADERS = new WeakMap();
const OPTION_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "maxTokens",
  "memoryLimitMb",
  "model",
  "provider",
  "timeoutMs",
]);
const MAX_MESSAGES = 8;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 96 * 1024;
const REQUIRED_SANDBOX_BOUNDARIES = Object.freeze([
  SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
  SANDBOX_BOUNDARIES.PROCESS_TREE,
  SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function plainRecord(value, label, allowedKeys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new TypeError(`${label} contains unsupported fields`);
    }
  }
  return value;
}

function boundedString(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be non-empty bounded text`);
  }
  return value;
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizeBaseUrl(provider, value) {
  const expected = BUILT_IN_PROVIDERS[provider]?.baseUrl;
  if (!expected) throw new TypeError("process grader provider is unsupported");
  let actual;
  try {
    actual = new URL(value || expected);
  } catch {
    throw new TypeError("process grader baseUrl is invalid");
  }
  if (
    actual.protocol !== "https:" ||
    actual.username ||
    actual.password ||
    actual.search ||
    actual.hash ||
    actual.href.replace(/\/$/u, "") !==
      new URL(expected).href.replace(/\/$/u, "")
  ) {
    throw new TypeError(
      "process grader baseUrl must match the credential-free built-in endpoint",
    );
  }
  return actual.href.replace(/\/$/u, "");
}

function normalizeMessages(value) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    value.length === 0 ||
    value.length > MAX_MESSAGES
  ) {
    throw new TypeError("process grader messages are invalid");
  }
  let bytes = 0;
  const result = value.map((message, index) => {
    plainRecord(
      message,
      `process grader message ${index}`,
      new Set(["content", "role"]),
    );
    if (!["assistant", "system", "user"].includes(message.role)) {
      throw new TypeError(`process grader message ${index} role is invalid`);
    }
    const content = boundedText(
      message.content,
      `process grader message ${index} content`,
      MAX_PROMPT_BYTES,
    );
    bytes += Buffer.byteLength(content, "utf8");
    return { role: message.role, content };
  });
  if (bytes > MAX_PROMPT_BYTES) {
    throw new TypeError("process grader prompt exceeds 65536 bytes");
  }
  return result;
}

function workerSnapshot() {
  const stat = fs.lstatSync(WORKER);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error("process grader worker is not a single-link regular file");
  }
  const physical = fs.realpathSync.native(WORKER);
  const bytes = fs.readFileSync(physical);
  if (bytes.length === 0 || bytes.length > 128 * 1024) {
    throw new Error("process grader worker size is invalid");
  }
  return Object.freeze({
    physical,
    digest: sha256(bytes),
    size: bytes.length,
  });
}

function minimalProcessEnvironment() {
  if (process.platform !== "win32") return Object.freeze({});
  const environment = {};
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 32 * 1024 &&
      !value.includes("\0")
    ) {
      environment[key] = value;
    }
  }
  if (!environment.SystemRoot && !environment.WINDIR) {
    throw new Error("Windows process grader requires a system root");
  }
  return Object.freeze(environment);
}

function runProcess({ input, snapshot, timeoutMs, memoryLimitMb }) {
  return new Promise((resolve, reject) => {
    const child = executionBroker.spawn(
      process.execPath,
      [
        `--max-old-space-size=${memoryLimitMb}`,
        ...(process.platform === "win32"
          ? []
          : [
              "--experimental-permission",
              `--allow-fs-read=${snapshot.physical}`,
            ]),
        snapshot.physical,
      ],
      {
        cwd: path.dirname(snapshot.physical),
        env: minimalProcessEnvironment(),
        policy: "allow",
        requirePersistentAudit: true,
        sandboxPolicy: {
          profile: "network-only",
          requiredBoundaries: REQUIRED_SANDBOX_BOUNDARIES,
        },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        origin: "governed-skill-synthesis-process-grader",
        reason:
          "Run the bounded learning synthesis grader in a killable process",
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminalError = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      terminalError = new Error(
        `learning synthesis process grader timed out after ${timeoutMs}ms`,
      );
      terminalError.code = "LEARNING_SYNTHESIS_PROCESS_GRADER_TIMEOUT";
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        terminalError = new Error("process grader stdout exceeded its bound");
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_BYTES) {
        terminalError = new Error("process grader stderr exceeded its bound");
        child.kill("SIGKILL");
      }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) => {
      if (terminalError) return finish(reject, terminalError);
      if (code !== 0) {
        return finish(
          reject,
          new Error(
            `learning synthesis process grader exited ${code ?? "null"}/${signal ?? "none"}: ${stderr.slice(0, 256)}`,
          ),
        );
      }
      try {
        const lines = stdout.trimEnd().split("\n");
        if (lines.length !== 1) throw new Error("multiple output records");
        const message = JSON.parse(lines[0]);
        plainRecord(
          message,
          "process grader output",
          new Set(["content", "ok"]),
        );
        if (message.ok !== true) throw new Error("grader output was not ok");
        const content = boundedText(
          message.content,
          "process grader output content",
          64 * 1024,
        );
        finish(resolve, content);
      } catch (cause) {
        finish(
          reject,
          new Error("learning synthesis process grader output is invalid", {
            cause,
          }),
        );
      }
    });
    child.stdin.once("error", (error) => {
      terminalError ??= error;
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export function createGovernedSkillSynthesisProcessGrader(options = {}) {
  plainRecord(options, "process grader options", OPTION_KEYS);
  const provider = boundedString(
    options.provider,
    "process grader provider",
    64,
  );
  if (provider !== "volcengine") {
    throw new TypeError("process grader currently requires volcengine");
  }
  const model = boundedString(
    options.model || BUILT_IN_PROVIDERS[provider].models[0],
    "process grader model",
    256,
  );
  const apiKey = boundedString(
    options.apiKey,
    "process grader credential",
    16 * 1024,
  );
  const baseUrl = normalizeBaseUrl(provider, options.baseUrl);
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? 30_000,
    "process grader timeoutMs",
    1_000,
    120_000,
  );
  const maxTokens = boundedInteger(
    options.maxTokens ?? 2_048,
    "process grader maxTokens",
    128,
    4_096,
  );
  const memoryLimitMb = boundedInteger(
    options.memoryLimitMb ?? 128,
    "process grader memoryLimitMb",
    32,
    512,
  );
  const snapshot = workerSnapshot();
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_PROCESS_GRADER_SCHEMA,
    isolation: "process",
    provider,
    model,
    workerArtifactDigest: snapshot.digest,
    inheritedEnvironment: false,
    credentialDelivery: "bounded-stdin",
    hardDeadlineEnforced: true,
    sandboxProfile: "network-only",
    requiredSandboxBoundaries: REQUIRED_SANDBOX_BOUNDARIES,
    persistentProcessAuditRequired: true,
  });
  const port = async (messages) => {
    const current = workerSnapshot();
    if (
      current.physical !== snapshot.physical ||
      current.digest !== snapshot.digest ||
      current.size !== snapshot.size
    ) {
      throw new Error("process grader worker changed after construction");
    }
    const content = await runProcess({
      snapshot,
      timeoutMs,
      memoryLimitMb,
      input: {
        schema: "chainlesschain.skill-synthesis-process-grader-request/v1",
        provider,
        model,
        baseUrl,
        apiKey,
        maxTokens,
        timeoutMs,
        messages: normalizeMessages(messages),
      },
    });
    const after = workerSnapshot();
    if (
      after.digest !== snapshot.digest ||
      after.physical !== snapshot.physical
    ) {
      throw new Error("process grader worker changed during execution");
    }
    return content;
  };
  Object.freeze(port);
  PROCESS_GRADERS.set(port, descriptor);
  return port;
}

export function isGovernedSkillSynthesisProcessGrader(value) {
  return PROCESS_GRADERS.has(value);
}

export function getGovernedSkillSynthesisProcessGraderDescriptor(value) {
  const descriptor = PROCESS_GRADERS.get(value);
  return descriptor ? Object.freeze(structuredClone(descriptor)) : null;
}
