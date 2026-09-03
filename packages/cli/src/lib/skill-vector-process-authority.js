import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { executionBroker } from "./process-execution-broker/index.js";
import { createSkillVectorAuthority } from "./skill-vector-authority.js";

export const SKILL_VECTOR_PROCESS_REQUEST_SCHEMA =
  "chainlesschain.skill-vector-process-request/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const WORKER_KEYS = new Set([
  "arguments",
  "cwd",
  "entryDigest",
  "entryPath",
  "environment",
  "executableDigest",
  "executablePath",
  "identity",
]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INPUT_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const PROCESS_DEPS = Object.freeze({
  spawn: (...args) => executionBroker.spawn(...args),
});

function plainRecord(value, label, allowedKeys = null) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    (allowedKeys &&
      Reflect.ownKeys(value).some(
        (key) => typeof key !== "string" || !allowedKeys.has(key),
      ))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function pinnedDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be sha256-bound`);
  }
  return value;
}

function absolutePath(value, label) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${label} must be a normalized absolute path`);
  }
  return value;
}

function boundedInteger(value, fallback, label, maximum) {
  const normalized = value === undefined ? fallback : value;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 1 ||
    normalized > maximum
  ) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return normalized;
}

function normalizeArguments(value, label) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 64) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  let bytes = 0;
  const result = value.map((argument, index) => {
    if (
      typeof argument !== "string" ||
      argument.includes("\0") ||
      Buffer.byteLength(argument, "utf8") > 4096
    ) {
      throw new TypeError(`${label}[${index}] is invalid or unbounded`);
    }
    bytes += Buffer.byteLength(argument, "utf8");
    return argument;
  });
  if (bytes > 32 * 1024) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return Object.freeze(result);
}

function normalizeEnvironment(value, label) {
  if (value === undefined) return Object.freeze({});
  plainRecord(value, label);
  const entries = Object.entries(value);
  if (entries.length > 64) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  let bytes = 0;
  const result = Object.create(null);
  const normalizedKeys = new Set();
  for (const [key, entry] of entries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const normalizedKey =
      process.platform === "win32" ? key.toLowerCase() : key;
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key) ||
      normalizedKeys.has(normalizedKey) ||
      typeof entry !== "string" ||
      entry.includes("\0") ||
      Buffer.byteLength(entry, "utf8") > 16 * 1024
    ) {
      throw new TypeError(`${label}.${key} is invalid or unbounded`);
    }
    bytes += Buffer.byteLength(key, "utf8") + Buffer.byteLength(entry, "utf8");
    normalizedKeys.add(normalizedKey);
    result[key] = entry;
  }
  if (bytes > 32 * 1024) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return Object.freeze(result);
}

function normalizeWorker(value, label) {
  plainRecord(value, label, WORKER_KEYS);
  return Object.freeze({
    identity: identifier(value.identity, `${label}.identity`),
    executablePath: absolutePath(
      value.executablePath,
      `${label}.executablePath`,
    ),
    executableDigest: pinnedDigest(
      value.executableDigest,
      `${label}.executableDigest`,
    ),
    entryPath: absolutePath(value.entryPath, `${label}.entryPath`),
    entryDigest: pinnedDigest(value.entryDigest, `${label}.entryDigest`),
    arguments: normalizeArguments(value.arguments, `${label}.arguments`),
    cwd: absolutePath(value.cwd, `${label}.cwd`),
    environment: normalizeEnvironment(
      value.environment,
      `${label}.environment`,
    ),
  });
}

function fileDigest(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertPinnedFile(filePath, expectedDigest, label, maximumBytes) {
  const stat = fs.lstatSync(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > maximumBytes
  ) {
    throw new Error(`${label} is not a regular pinned file`);
  }
  const realPath = fs.realpathSync.native(filePath);
  if (!samePath(realPath, filePath)) {
    throw new Error(`${label} does not resolve to its pinned path`);
  }
  if (fileDigest(filePath) !== expectedDigest) {
    throw new Error(`${label} digest changed`);
  }
}

function assertWorkerIdentity(worker, label) {
  assertPinnedFile(
    worker.executablePath,
    worker.executableDigest,
    `${label} executable`,
    MAX_EXECUTABLE_BYTES,
  );
  assertPinnedFile(
    worker.entryPath,
    worker.entryDigest,
    `${label} entry`,
    MAX_ENTRY_BYTES,
  );
  const cwd = fs.realpathSync.native(worker.cwd);
  if (!samePath(cwd, worker.cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`${label} cwd does not resolve to its pinned directory`);
  }
}

function processFailure(code) {
  const error = new Error(`Skill vector process failed closed (${code})`);
  error.code = code;
  return error;
}

async function invokeWorker(
  worker,
  role,
  payload,
  { timeoutMs, maxInputBytes, maxOutputBytes },
) {
  assertWorkerIdentity(worker, role);
  const input = Buffer.from(
    `${JSON.stringify({
      schema: SKILL_VECTOR_PROCESS_REQUEST_SCHEMA,
      role,
      payload,
    })}\n`,
    "utf8",
  );
  if (input.length > maxInputBytes) {
    throw processFailure("CC_SKILL_VECTOR_PROCESS_INPUT_LIMIT");
  }

  const output = await new Promise((resolve, reject) => {
    let settled = false;
    let pendingFailure = null;
    let timer = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const child = PROCESS_DEPS.spawn(
      worker.executablePath,
      [worker.entryPath, ...worker.arguments],
      {
        cwd: worker.cwd,
        env: { ...worker.environment },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        origin: "skill-vector-process-authority",
        scope: "evolution",
        policy: "allow",
        auditRedactArgIndexes: worker.arguments.map((_, index) => index + 1),
      },
    );
    const terminate = (error) => {
      if (settled || pendingFailure) return;
      pendingFailure = error;
      if (child.exitCode === null) child.kill("SIGKILL");
    };
    timer = setTimeout(() => {
      terminate(processFailure("CC_SKILL_VECTOR_PROCESS_TIMEOUT"));
    }, timeoutMs);
    timer.unref?.();
    child.once("error", () => {
      terminate(processFailure("CC_SKILL_VECTOR_PROCESS_SPAWN_FAILED"));
    });
    child.stdout.on("data", (chunk) => {
      if (pendingFailure) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        terminate(processFailure("CC_SKILL_VECTOR_PROCESS_OUTPUT_LIMIT"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (pendingFailure) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) {
        terminate(processFailure("CC_SKILL_VECTOR_PROCESS_STDERR_LIMIT"));
      }
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingFailure) {
        reject(pendingFailure);
        return;
      }
      if (code !== 0 || signal !== null) {
        reject(processFailure("CC_SKILL_VECTOR_PROCESS_EXITED"));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.once("error", () => {
      terminate(processFailure("CC_SKILL_VECTOR_PROCESS_STDIN_FAILED"));
    });
    child.stdin.end(input);
  });

  assertWorkerIdentity(worker, role);
  const text = output.trim();
  if (text === "" || Buffer.byteLength(text, "utf8") > maxOutputBytes) {
    throw processFailure("CC_SKILL_VECTOR_PROCESS_EMPTY_OUTPUT");
  }
  try {
    const parsed = JSON.parse(text);
    plainRecord(parsed, `${role} process result`);
    return parsed;
  } catch (error) {
    if (error?.code?.startsWith?.("CC_SKILL_VECTOR_")) throw error;
    throw processFailure("CC_SKILL_VECTOR_PROCESS_INVALID_JSON");
  }
}

/**
 * Creates the existing branded vector authority over two independently pinned
 * JSON worker processes. The host supplies all executable and entry digests;
 * no PATH lookup, shell, inherited environment, local key or permissive
 * verifier fallback is used.
 */
export function createSkillVectorProcessAuthority({
  tenantId,
  provider: providerInput,
  verifier: verifierInput,
  timeoutMs: timeoutInput,
  maxInputBytes: maxInputInput,
  maxOutputBytes: maxOutputInput,
} = {}) {
  const provider = normalizeWorker(providerInput, "provider");
  const verifier = normalizeWorker(verifierInput, "verifier");
  if (
    provider.identity === verifier.identity ||
    provider.entryDigest === verifier.entryDigest
  ) {
    throw new TypeError(
      "Skill vector provider and verifier must be independent",
    );
  }
  const limits = Object.freeze({
    timeoutMs: boundedInteger(
      timeoutInput,
      DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      60_000,
    ),
    maxInputBytes: boundedInteger(
      maxInputInput,
      DEFAULT_MAX_INPUT_BYTES,
      "maxInputBytes",
      16 * 1024 * 1024,
    ),
    maxOutputBytes: boundedInteger(
      maxOutputInput,
      DEFAULT_MAX_OUTPUT_BYTES,
      "maxOutputBytes",
      8 * 1024 * 1024,
    ),
  });
  assertWorkerIdentity(provider, "provider");
  assertWorkerIdentity(verifier, "verifier");
  return createSkillVectorAuthority({
    tenantId,
    provider: Object.freeze({
      score: Object.freeze((request) =>
        invokeWorker(provider, "provider", request, limits),
      ),
    }),
    verifier: Object.freeze({
      verify: Object.freeze((request) =>
        invokeWorker(verifier, "verifier", request, limits),
      ),
    }),
  });
}
