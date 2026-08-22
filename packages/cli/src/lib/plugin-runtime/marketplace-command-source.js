import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import executionBroker from "../process-execution-broker/index.js";
import {
  assertMarketplaceCommandModeSupported,
  MARKETPLACE_COMMAND_DESCRIPTOR_ERROR,
  MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS,
  normalizeMarketplaceCommandDescriptor,
} from "./marketplace-command-descriptor.js";
import {
  assertSafeInstalledPluginStructure,
  buildMarketplacePayloadSbom,
} from "./marketplace-artifact-readback.js";

export const MARKETPLACE_HEADERS_HELPER_ERROR = Object.freeze({
  INVALID_OUTPUT: "CC_MARKETPLACE_HEADERS_HELPER_OUTPUT_INVALID",
  PROCESS_FAILED: "CC_MARKETPLACE_HEADERS_HELPER_PROCESS_FAILED",
  PROCESS_TIMEOUT: "CC_MARKETPLACE_HEADERS_HELPER_TIMEOUT",
  PROCESS_OUTPUT_LIMIT: "CC_MARKETPLACE_HEADERS_HELPER_OUTPUT_LIMIT",
  PROCESS_START: "CC_MARKETPLACE_HEADERS_HELPER_PROCESS_START_FAILED",
});

export const MARKETPLACE_COMMAND_SOURCE_ERROR = Object.freeze({
  INVALID_OUTPUT: "CC_MARKETPLACE_COMMAND_SOURCE_OUTPUT_INVALID",
  PROCESS_FAILED: "CC_MARKETPLACE_COMMAND_SOURCE_PROCESS_FAILED",
  PROCESS_TIMEOUT: "CC_MARKETPLACE_COMMAND_SOURCE_TIMEOUT",
  PROCESS_OUTPUT_LIMIT: "CC_MARKETPLACE_COMMAND_SOURCE_OUTPUT_LIMIT",
  PROCESS_START: "CC_MARKETPLACE_COMMAND_SOURCE_PROCESS_START_FAILED",
});

export const MARKETPLACE_HEADERS_HELPER_LIMITS = Object.freeze({
  maxHeaders: 64,
  maxHeaderValueBytes: 16 * 1024,
});

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const TRANSPORT_OWNED_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "transfer-encoding",
  "upgrade",
]);

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function outputError(kind, suffix, message) {
  const codes =
    kind === "headers"
      ? MARKETPLACE_HEADERS_HELPER_ERROR
      : MARKETPLACE_COMMAND_SOURCE_ERROR;
  return runtimeError(codes[suffix], message);
}

function hasInvalidHeaderValueCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || (code >= 0x0a && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function normalizeHeaderMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw runtimeError(
      MARKETPLACE_HEADERS_HELPER_ERROR.INVALID_OUTPUT,
      "Marketplace headers helper must emit a JSON object of string headers",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length > MARKETPLACE_HEADERS_HELPER_LIMITS.maxHeaders ||
    keys.some(
      (key) => typeof key !== "string" || !("value" in descriptors[key]),
    )
  ) {
    throw runtimeError(
      MARKETPLACE_HEADERS_HELPER_ERROR.INVALID_OUTPUT,
      "Marketplace headers helper emitted unsupported headers",
    );
  }
  const headers = {};
  for (const name of keys.sort()) {
    const valueAtName = descriptors[name].value;
    if (
      !HEADER_NAME.test(name) ||
      typeof valueAtName !== "string" ||
      hasInvalidHeaderValueCharacter(valueAtName) ||
      Buffer.byteLength(valueAtName, "utf8") >
        MARKETPLACE_HEADERS_HELPER_LIMITS.maxHeaderValueBytes ||
      TRANSPORT_OWNED_HEADERS.has(name.toLowerCase())
    ) {
      throw runtimeError(
        MARKETPLACE_HEADERS_HELPER_ERROR.INVALID_OUTPUT,
        "Marketplace headers helper emitted an invalid header",
      );
    }
    headers[name] = valueAtName;
  }
  return Object.freeze(headers);
}

function canonicalExecutable(plan, deps, platform) {
  let original;
  let executable;
  try {
    original = deps.lstatSync(plan.executable);
    executable = deps.realpathSync(plan.executable);
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command executable is unavailable",
    );
  }
  if (original.isSymbolicLink() || !original.isFile()) {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command executable must be a regular non-symlink file",
    );
  }
  let finalStat;
  try {
    finalStat = deps.lstatSync(executable);
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command executable is unavailable",
    );
  }
  if (finalStat.isSymbolicLink() || !finalStat.isFile()) {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command executable changed while validating",
    );
  }
  if (platform !== "win32" && (finalStat.mode & 0o111) === 0) {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command executable is not executable",
    );
  }
  return executable;
}

function canonicalCwd(plan, deps) {
  let cwd;
  let stat;
  try {
    cwd = deps.realpathSync(plan.cwd);
    stat = deps.lstatSync(cwd);
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command working directory is unavailable",
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw runtimeError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command working directory must be a real directory",
    );
  }
  return cwd;
}

function terminateProcessTree(child, { platform, kill, spawnSync } = {}) {
  const activePlatform = platform || process.platform;
  const processKill = kill || process.kill.bind(process);
  const pid = Number(child?.pid);
  if (activePlatform !== "win32" && Number.isInteger(pid) && pid > 0) {
    try {
      processKill(-pid, "SIGKILL");
      return;
    } catch {
      // The child may already have exited or not own a process group.
    }
  }
  if (activePlatform === "win32" && Number.isInteger(pid) && pid > 0) {
    try {
      (spawnSync || executionBroker.spawnSync.bind(executionBroker))(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        {
          shell: false,
          windowsHide: true,
          origin: "marketplace:descriptor:taskkill",
          policy: "allow",
          scope: "marketplace",
        },
      );
      return;
    } catch {
      // Fall through to the direct child handle.
    }
  }
  try {
    child?.kill?.("SIGKILL");
  } catch {
    // Best effort: the process may have already exited.
  }
}

function sanitizedMarketplaceEnvironment(descriptorEnvironment, platform) {
  const allowed = new Set(MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS);
  const inherited = {};
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = platform === "win32" ? key.toUpperCase() : key;
    if (
      allowed.has(normalized) &&
      typeof value === "string" &&
      value.length <= 8 * 1024
    ) {
      // Preserve the actual key spelling. Windows environment lookup is case
      // insensitive, while POSIX callers may require the conventional spelling.
      inherited[key] = value;
    }
  }
  return { ...inherited, ...descriptorEnvironment };
}

/**
 * Launch a bounded direct-argv Marketplace descriptor. This intentionally
 * never starts a shell and never inherits the host environment.
 */
export function runMarketplaceProcessDescriptor(descriptor, options = {}) {
  const kind = options.kind === "headers" ? "headers" : "source";
  const plan = normalizeMarketplaceCommandDescriptor(descriptor, {
    kind,
    allowType: options.allowType === true,
    label:
      kind === "headers"
        ? "Marketplace headers helper descriptor"
        : "Marketplace command source descriptor",
  });
  const platform = options.platform || process.platform;
  if (kind === "source")
    assertMarketplaceCommandModeSupported(plan.mode, platform);
  const realpathSync = options.realpathSync || fs.realpathSync.native;
  const deps = {
    lstatSync: options.lstatSync || fs.lstatSync,
    realpathSync,
  };
  const executable = canonicalExecutable(plan, deps, platform);
  const cwd = canonicalCwd(plan, deps);
  const spawn = options.spawn || executionBroker.spawn.bind(executionBroker);
  const spawnOptions = {
    cwd,
    // An empty environment breaks ordinary Windows binaries (notably Node,
    // which needs SystemRoot/temporary-directory state). Retain only the
    // descriptor's narrow runtime whitelist; credentials and arbitrary host
    // configuration remain absent unless explicitly permitted by the schema.
    env: sanitizedMarketplaceEnvironment(plan.env, platform),
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: platform !== "win32",
    origin:
      kind === "headers"
        ? "marketplace:headers-helper"
        : "marketplace:command-source",
    policy: "allow",
    scope: "marketplace",
    // Descriptor arguments may contain an access token supplied by a local
    // operator. Keep all argv out of broker audit records.
    auditRedactArgIndexes: plan.args.map((_, index) => index),
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, [...plan.args], spawnOptions);
    } catch {
      reject(
        outputError(
          kind,
          "PROCESS_START",
          "Marketplace command process could not be started",
        ),
      );
      return;
    }
    if (!child?.stdout || !child?.stderr) {
      terminateProcessTree(child, {
        platform,
        kill: options.kill,
        spawnSync: options.spawnSync,
      });
      reject(
        outputError(
          kind,
          "PROCESS_START",
          "Marketplace command process did not expose output streams",
        ),
      );
      return;
    }

    let state = "running";
    let stdout = "";
    let totalOutputBytes = 0;
    const settle = (callback, value) => {
      if (state === "settled") return;
      state = "settled";
      clearTimeout(timeout);
      callback(value);
    };
    const fail = (error) => {
      if (state !== "running") return;
      state = "terminating";
      clearTimeout(timeout);
      terminateProcessTree(child, {
        platform,
        kill: options.kill,
        spawnSync: options.spawnSync,
      });
      settle(reject, error);
    };
    const appendOutput = (chunk, keep) => {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), "utf8");
      totalOutputBytes += buffer.byteLength;
      if (totalOutputBytes > plan.maxOutputBytes) {
        fail(
          outputError(
            kind,
            "PROCESS_OUTPUT_LIMIT",
            "Marketplace command process exceeded its bounded output limit",
          ),
        );
        return;
      }
      if (keep) stdout += buffer.toString("utf8");
    };
    const timeout = setTimeout(
      () =>
        fail(
          outputError(
            kind,
            "PROCESS_TIMEOUT",
            "Marketplace command process exceeded its timeout",
          ),
        ),
      plan.timeoutMs,
    );
    timeout.unref?.();
    child.stdout.on("data", (chunk) => {
      if (state === "running") appendOutput(chunk, true);
    });
    child.stderr.on("data", (chunk) => {
      if (state === "running") appendOutput(chunk, false);
    });
    child.once("error", () =>
      fail(
        outputError(
          kind,
          "PROCESS_START",
          "Marketplace command process failed to start",
        ),
      ),
    );
    child.once("close", (code, signal) => {
      if (state !== "running") return;
      if (code !== 0) {
        fail(
          outputError(
            kind,
            "PROCESS_FAILED",
            `Marketplace command process exited unsuccessfully (code ${code ?? "null"}, signal ${signal || "none"})`,
          ),
        );
        return;
      }
      settle(resolve, stdout);
    });
  });
}

/** Run a descriptor whose stdout must be a bounded JSON object of HTTP headers. */
export async function runMarketplaceHeadersHelper(descriptor, options = {}) {
  const stdout = await runMarketplaceProcessDescriptor(descriptor, {
    ...options,
    kind: "headers",
  });
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw runtimeError(
      MARKETPLACE_HEADERS_HELPER_ERROR.INVALID_OUTPUT,
      "Marketplace headers helper stdout must be one JSON header object",
    );
  }
  return normalizeHeaderMap(parsed);
}

function sourcePathFromOutput(value, deps) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 1 ||
    typeof value.source !== "string" ||
    value.source.length === 0 ||
    value.source.includes("\0") ||
    !path.isAbsolute(value.source)
  ) {
    throw runtimeError(
      MARKETPLACE_COMMAND_SOURCE_ERROR.INVALID_OUTPUT,
      'Marketplace command source stdout must be {"source": "/absolute/plugin/path"}',
    );
  }
  let source;
  let original;
  let stat;
  try {
    original = deps.lstatSync(value.source);
    source = deps.realpathSync(value.source);
    stat = deps.lstatSync(source);
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_SOURCE_ERROR.INVALID_OUTPUT,
      "Marketplace command source returned an unavailable plugin directory",
    );
  }
  if (
    original.isSymbolicLink() ||
    stat.isSymbolicLink() ||
    !stat.isDirectory()
  ) {
    throw runtimeError(
      MARKETPLACE_COMMAND_SOURCE_ERROR.INVALID_OUTPUT,
      "Marketplace command source must return a real plugin directory",
    );
  }
  return source;
}

/**
 * Run a Marketplace command source and turn its one JSON response into a
 * validated local plugin directory. `mode: link` is intentionally limited to
 * POSIX at this boundary; the immutable installer still snapshots the payload
 * before activation, so a command cannot make an installed version mutable.
 */
export async function runMarketplaceCommandSource(descriptor, options = {}) {
  const plan = normalizeMarketplaceCommandDescriptor(descriptor, {
    kind: "source",
    allowType: options.allowType === true,
    label: "Marketplace command source descriptor",
  });
  const stdout = await runMarketplaceProcessDescriptor(plan, {
    ...options,
    kind: "source",
  });
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_SOURCE_ERROR.INVALID_OUTPUT,
      "Marketplace command source stdout must be one JSON object",
    );
  }
  const deps = {
    lstatSync: options.lstatSync || fs.lstatSync,
    realpathSync: options.realpathSync || fs.realpathSync.native,
  };
  const source = sourcePathFromOutput(parsed, deps);
  try {
    assertSafeInstalledPluginStructure(source);
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_SOURCE_ERROR.INVALID_OUTPUT,
      "Marketplace command source returned an unsafe plugin structure",
    );
  }
  let payload;
  try {
    payload = buildMarketplacePayloadSbom(source);
  } catch {
    throw runtimeError(
      MARKETPLACE_COMMAND_SOURCE_ERROR.INVALID_OUTPUT,
      "Marketplace command source payload could not be verified",
    );
  }
  return Object.freeze({
    source,
    mode: plan.mode,
    payloadSha256: payload.digest,
    fileCount: payload.fileCount,
    totalBytes: payload.totalBytes,
  });
}

function headersEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.forEach === "function") {
    const entries = [];
    value.forEach((headerValue, name) => entries.push([name, headerValue]));
    return entries;
  }
  return Object.entries(value);
}

function mergeHeaders(existing, dynamic) {
  const merged = {};
  const seen = new Set();
  for (const [name, value] of headersEntries(existing)) {
    const normalized = String(name).toLowerCase();
    seen.add(normalized);
    merged[name] = String(value);
  }
  for (const [name, value] of Object.entries(dynamic)) {
    if (!seen.has(name.toLowerCase())) merged[name] = value;
  }
  return merged;
}

/**
 * Decorate a fetch implementation so helper headers can leave the process
 * only for the catalog origin. The artifact client invokes this per redirect
 * hop, which naturally drops headers on every cross-origin hop.
 */
export function createSameOriginMarketplaceHeaderFetch(
  fetchImpl,
  trustedOrigin,
  dynamicHeaders,
) {
  if (typeof fetchImpl !== "function") {
    throw runtimeError(
      MARKETPLACE_HEADERS_HELPER_ERROR.PROCESS_START,
      "Marketplace transport is unavailable",
    );
  }
  const headers = normalizeHeaderMap(dynamicHeaders);
  const origin = new URL(trustedOrigin).origin;
  return (url, options = {}) => {
    let matchesOrigin = false;
    try {
      matchesOrigin = new URL(String(url)).origin === origin;
    } catch {
      // Let the underlying transport preserve its own URL error behavior.
    }
    return fetchImpl(url, {
      ...options,
      ...(matchesOrigin
        ? { headers: mergeHeaders(options.headers, headers) }
        : {}),
    });
  };
}

/**
 * A non-secret binding fingerprint for short-lived in-memory authority maps.
 * It intentionally hashes header names only; helper values are credentials and
 * must never become cache/provenance/display material.
 */
export function marketplaceHeaderNamesFingerprint(headers) {
  return crypto
    .createHash("sha256")
    .update(
      Object.keys(headers || {})
        .map((key) => key.toLowerCase())
        .sort()
        .join("\0"),
    )
    .digest("hex");
}
