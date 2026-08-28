"use strict";

/**
 * Branded filesystem authority for reviewed bundled Skills.
 *
 * Handlers receive only a compatibility proxy. Every filesystem call is routed
 * through an AsyncLocalStorage-bound host authority, which owns the exact
 * operation allowlist, canonical roots, byte limits, and audit decision. There
 * is deliberately no native filesystem fallback in the handler-facing proxy.
 */

const { AsyncLocalStorage } = require("node:async_hooks");
const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { logger } = require("../../../utils/logger.js");

const FILESYSTEM_BROKER_BRAND = Symbol("bundled-skill-filesystem-broker");
const MAX_AUTHORITY_ID_LENGTH = 256;
const MAX_ALLOWED_ROOTS = 16;
const MAX_ALLOWED_OPERATIONS = 32;
const MAX_PATH_BYTES = 16 * 1024;
const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_WRITE_BYTES = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_ACTIVE_WATCHERS = 8;
const MAX_WATCH_EVENTS = 10_000;
const MAX_WATCHER_LIFETIME_MS = 24 * 60 * 60 * 1000;

const SUPPORTED_OPERATIONS = new Set([
  "appendFileSync",
  "existsSync",
  "mkdtempSync",
  "mkdirSync",
  "readFileSync",
  "readdirSync",
  "realpathSync",
  "rmdirSync",
  "statSync",
  "unlinkSync",
  "watch",
  "writeFileSync",
]);
const WRITE_OPERATIONS = new Set([
  "appendFileSync",
  "mkdtempSync",
  "mkdirSync",
  "rmdirSync",
  "unlinkSync",
  "writeFileSync",
]);
const executionStorage = new AsyncLocalStorage();
const brokerMetadata = new WeakMap();

function filesystemError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultAuditSink(event) {
  logger.info("[BundledSkillFilesystemBroker] filesystem decision", event);
}

function isWithinRoot(candidate, root) {
  const relative = nodePath.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${nodePath.sep}`) &&
      relative !== ".." &&
      !nodePath.isAbsolute(relative))
  );
}

function canonicalExistingPath(candidate) {
  if (
    typeof candidate !== "string" ||
    !candidate ||
    candidate.includes("\0") ||
    Buffer.byteLength(candidate, "utf8") > MAX_PATH_BYTES
  ) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_PATH_INVALID",
      "A bounded filesystem path is required",
    );
  }
  return nodeFs.realpathSync(nodePath.resolve(candidate));
}

function findExistingAncestor(candidate) {
  let current = candidate;
  const missingSegments = [];
  while (!nodeFs.existsSync(current)) {
    const parent = nodePath.dirname(current);
    if (parent === current) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_PATH_INVALID",
        "Filesystem path has no existing ancestor",
      );
    }
    missingSegments.unshift(nodePath.basename(current));
    current = parent;
  }
  return {
    ancestor: nodeFs.realpathSync(current),
    missingSegments,
  };
}

function normalizePolicy(options = {}) {
  const skillId = String(options.skillId || "").trim();
  const authorityId = String(options.authorityId || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(skillId)) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_SKILL_INVALID",
      "A canonical bundled Skill ID is required",
    );
  }
  if (
    !authorityId ||
    authorityId.length > MAX_AUTHORITY_ID_LENGTH ||
    Array.from(authorityId).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_AUTHORITY_INVALID",
      "A bounded filesystem authority decision ID is required",
    );
  }
  if (
    !Array.isArray(options.allowedRoots) ||
    options.allowedRoots.length === 0 ||
    options.allowedRoots.length > MAX_ALLOWED_ROOTS
  ) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_ROOTS_REQUIRED",
      `Between 1 and ${MAX_ALLOWED_ROOTS} approved roots are required`,
    );
  }
  if (
    !Array.isArray(options.allowedOperations) ||
    options.allowedOperations.length === 0 ||
    options.allowedOperations.length > MAX_ALLOWED_OPERATIONS ||
    options.allowedOperations.some(
      (operation) => !SUPPORTED_OPERATIONS.has(operation),
    )
  ) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_OPERATIONS_INVALID",
      "Filesystem authority requires a bounded exact operation allowlist",
    );
  }
  const allowedRoots = Object.freeze([
    ...new Set(options.allowedRoots.map(canonicalExistingPath)),
  ]);
  const cwd = canonicalExistingPath(options.cwd || allowedRoots[0]);
  if (!allowedRoots.some((root) => isWithinRoot(cwd, root))) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_CWD_DENIED",
      "Filesystem authority cwd is outside approved roots",
    );
  }
  const normalizeLimit = (value, fallback, maximum, code) => {
    const resolved = value === undefined ? fallback : value;
    if (
      !Number.isSafeInteger(resolved) ||
      resolved <= 0 ||
      resolved > maximum
    ) {
      throw filesystemError(code, "Filesystem authority limit is invalid");
    }
    return resolved;
  };
  return Object.freeze({
    skillId,
    authorityId,
    allowedRoots,
    allowedOperations: Object.freeze([...new Set(options.allowedOperations)]),
    cwd,
    maxReadBytes: normalizeLimit(
      options.maxReadBytes,
      MAX_READ_BYTES,
      MAX_READ_BYTES,
      "CC_BUNDLED_SKILL_FILESYSTEM_READ_LIMIT_INVALID",
    ),
    maxWriteBytes: normalizeLimit(
      options.maxWriteBytes,
      MAX_WRITE_BYTES,
      MAX_WRITE_BYTES,
      "CC_BUNDLED_SKILL_FILESYSTEM_WRITE_LIMIT_INVALID",
    ),
    maxDirectoryEntries: normalizeLimit(
      options.maxDirectoryEntries,
      MAX_DIRECTORY_ENTRIES,
      MAX_DIRECTORY_ENTRIES,
      "CC_BUNDLED_SKILL_FILESYSTEM_DIRECTORY_LIMIT_INVALID",
    ),
    maxActiveWatchers: normalizeLimit(
      options.maxActiveWatchers,
      MAX_ACTIVE_WATCHERS,
      MAX_ACTIVE_WATCHERS,
      "CC_BUNDLED_SKILL_FILESYSTEM_WATCHER_LIMIT_INVALID",
    ),
    maxWatchEvents: normalizeLimit(
      options.maxWatchEvents,
      MAX_WATCH_EVENTS,
      MAX_WATCH_EVENTS,
      "CC_BUNDLED_SKILL_FILESYSTEM_WATCH_EVENT_LIMIT_INVALID",
    ),
    maxWatcherLifetimeMs: normalizeLimit(
      options.maxWatcherLifetimeMs,
      MAX_WATCHER_LIFETIME_MS,
      MAX_WATCHER_LIFETIME_MS,
      "CC_BUNDLED_SKILL_FILESYSTEM_WATCH_LIFETIME_INVALID",
    ),
  });
}

function createBundledSkillFilesystemBroker(options, deps = {}) {
  const policy = normalizePolicy(options);
  const invokeAdapter = deps.invoke;
  const auditSink = deps.auditSink || defaultAuditSink;
  if (typeof invokeAdapter !== "function") {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_ADAPTER_REQUIRED",
      "A trusted filesystem adapter is required",
    );
  }
  let activeWatcherCount = 0;

  function audit(operation, canonicalPath, outcome, reason = null) {
    auditSink(
      Object.freeze({
        event: "bundled-skill-filesystem-operation",
        skillId: policy.skillId,
        authorityId: policy.authorityId,
        operation,
        pathSha256: nodeCrypto
          .createHash("sha256")
          .update(canonicalPath)
          .digest("hex"),
        outcome,
        ...(reason ? { reason } : {}),
      }),
    );
  }

  function resolveContainedPath(rawPath, operation) {
    if (
      typeof rawPath !== "string" ||
      !rawPath ||
      rawPath.includes("\0") ||
      Buffer.byteLength(rawPath, "utf8") > MAX_PATH_BYTES
    ) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_PATH_INVALID",
        "A bounded filesystem path is required",
      );
    }
    const resolved = nodePath.resolve(policy.cwd, rawPath);
    let canonical;
    if (nodeFs.existsSync(resolved)) {
      canonical = nodeFs.realpathSync(resolved);
    } else {
      const { ancestor, missingSegments } = findExistingAncestor(resolved);
      canonical = nodePath.join(ancestor, ...missingSegments);
    }
    if (!policy.allowedRoots.some((root) => isWithinRoot(canonical, root))) {
      audit(operation, canonical, "denied", "path_denied");
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_PATH_DENIED",
        "Filesystem path is outside approved roots",
      );
    }
    if (
      (operation === "unlinkSync" || operation === "rmdirSync") &&
      policy.allowedRoots.some((root) => canonical === root)
    ) {
      audit(operation, canonical, "denied", "root_mutation_denied");
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_ROOT_MUTATION_DENIED",
        "An approved root cannot be removed",
      );
    }
    return canonical;
  }

  function validateWriteData(operation, data) {
    if (
      !WRITE_OPERATIONS.has(operation) ||
      operation === "mkdirSync" ||
      operation === "mkdtempSync" ||
      operation === "rmdirSync"
    ) {
      return;
    }
    if (operation === "unlinkSync") {
      return;
    }
    if (
      typeof data !== "string" &&
      !Buffer.isBuffer(data) &&
      !(data instanceof Uint8Array)
    ) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_WRITE_INVALID",
        "Filesystem writes require string or byte data",
      );
    }
    if (Buffer.byteLength(data) > policy.maxWriteBytes) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_WRITE_TOO_LARGE",
        "Filesystem write exceeded the authority byte limit",
      );
    }
  }

  function validateOutput(operation, output, canonicalPath) {
    if (operation === "readFileSync") {
      if (typeof output !== "string" && !Buffer.isBuffer(output)) {
        audit(operation, canonicalPath, "denied", "read_type_invalid");
        throw filesystemError(
          "CC_BUNDLED_SKILL_FILESYSTEM_READ_INVALID",
          "Filesystem adapter returned an unsupported read result",
        );
      }
      if (Buffer.byteLength(output) > policy.maxReadBytes) {
        audit(operation, canonicalPath, "denied", "read_too_large");
        throw filesystemError(
          "CC_BUNDLED_SKILL_FILESYSTEM_READ_TOO_LARGE",
          "Filesystem read exceeded the authority byte limit",
        );
      }
    }
    if (
      operation === "readdirSync" &&
      (!Array.isArray(output) || output.length > policy.maxDirectoryEntries)
    ) {
      audit(operation, canonicalPath, "denied", "directory_too_large");
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_DIRECTORY_TOO_LARGE",
        "Filesystem directory result exceeded the authority entry limit",
      );
    }
    if (operation === "mkdtempSync" || operation === "realpathSync") {
      if (typeof output !== "string") {
        audit(operation, canonicalPath, "denied", "path_result_invalid");
        throw filesystemError(
          "CC_BUNDLED_SKILL_FILESYSTEM_PATH_RESULT_INVALID",
          "Filesystem adapter returned an unsupported path result",
        );
      }
      const canonicalOutput = canonicalExistingPath(output);
      if (
        !policy.allowedRoots.some((root) => isWithinRoot(canonicalOutput, root))
      ) {
        audit(operation, canonicalPath, "denied", "path_result_denied");
        throw filesystemError(
          "CC_BUNDLED_SKILL_FILESYSTEM_PATH_RESULT_DENIED",
          "Filesystem adapter returned a path outside approved roots",
        );
      }
    }
  }

  function invokeWatch(canonicalPath, args) {
    if (args.length !== 3 || typeof args[2] !== "function") {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_WATCH_ARGUMENTS_INVALID",
        "Filesystem watch requires bounded options and a listener",
      );
    }
    if (activeWatcherCount >= policy.maxActiveWatchers) {
      audit("watch", canonicalPath, "denied", "watcher_limit_reached");
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_WATCHER_LIMIT_REACHED",
        "Filesystem watcher limit reached",
      );
    }
    const rawOptions = args[1];
    if (
      rawOptions !== undefined &&
      (rawOptions === null ||
        typeof rawOptions !== "object" ||
        Array.isArray(rawOptions))
    ) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_WATCH_ARGUMENTS_INVALID",
        "Filesystem watch options are invalid",
      );
    }
    const options = Object.freeze({
      persistent: rawOptions?.persistent !== false,
      recursive: rawOptions?.recursive === true,
      encoding: "utf8",
    });
    const listener = args[2];
    let watcher;
    let eventCount = 0;
    let closed = false;
    let lifetimeTimer;

    const close = (reason = "watcher_closed") => {
      if (closed) return;
      closed = true;
      activeWatcherCount = Math.max(0, activeWatcherCount - 1);
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      try {
        watcher?.close();
      } finally {
        audit("watch", canonicalPath, "allowed", reason);
      }
    };
    const boundedListener = (eventType, rawFilename) => {
      if (closed) return;
      eventCount += 1;
      if (eventCount > policy.maxWatchEvents) {
        close("watch_event_limit_reached");
        return;
      }
      if (eventType !== "change" && eventType !== "rename") {
        audit("watch", canonicalPath, "denied", "watch_event_invalid");
        return;
      }
      const filename =
        rawFilename === null || rawFilename === undefined
          ? null
          : String(rawFilename);
      if (
        filename !== null &&
        (filename.includes("\0") ||
          Buffer.byteLength(filename, "utf8") > MAX_PATH_BYTES)
      ) {
        audit("watch", canonicalPath, "denied", "watch_filename_invalid");
        return;
      }
      try {
        listener(eventType, filename);
      } catch {
        audit("watch", canonicalPath, "failed", "watch_listener_failed");
      }
    };

    activeWatcherCount += 1;
    try {
      watcher = invokeAdapter(
        Object.freeze({
          operation: "watch",
          args: Object.freeze([canonicalPath, options, boundedListener]),
        }),
      );
    } catch (error) {
      closed = true;
      activeWatcherCount = Math.max(0, activeWatcherCount - 1);
      audit("watch", canonicalPath, "failed", "adapter_failed");
      throw error;
    }
    if (!watcher || typeof watcher.close !== "function") {
      watcher?.close?.();
      closed = true;
      activeWatcherCount = Math.max(0, activeWatcherCount - 1);
      audit("watch", canonicalPath, "denied", "watcher_invalid");
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_WATCHER_INVALID",
        "Filesystem adapter returned an invalid watcher",
      );
    }
    if (closed) watcher.close();
    lifetimeTimer = setTimeout(
      () => close("watch_lifetime_expired"),
      policy.maxWatcherLifetimeMs,
    );
    lifetimeTimer.unref?.();
    audit("watch", canonicalPath, "allowed");
    return Object.freeze({ close: () => close() });
  }

  function invoke(operation, args = []) {
    if (!policy.allowedOperations.includes(operation)) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_OPERATION_DENIED",
        `Filesystem operation ${operation} is not approved for ${policy.skillId}`,
      );
    }
    if (!Array.isArray(args) || args.length === 0 || args.length > 3) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_ARGUMENTS_INVALID",
        "Filesystem arguments are invalid",
      );
    }
    const canonicalPath = resolveContainedPath(args[0], operation);
    if (operation === "watch") {
      return invokeWatch(canonicalPath, args);
    }
    validateWriteData(operation, args[1]);
    let output;
    try {
      output = invokeAdapter(
        Object.freeze({
          operation,
          args: Object.freeze([canonicalPath, ...args.slice(1)]),
        }),
      );
    } catch (error) {
      audit(operation, canonicalPath, "failed", "adapter_failed");
      throw error;
    }
    if (output && typeof output.then === "function") {
      audit(operation, canonicalPath, "denied", "async_result_denied");
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_ASYNC_RESULT_DENIED",
        "Synchronous filesystem operations cannot return a Promise",
      );
    }
    validateOutput(operation, output, canonicalPath);
    audit(operation, canonicalPath, "allowed");
    return output;
  }

  const broker = Object.freeze({
    [FILESYSTEM_BROKER_BRAND]: true,
    skillId: policy.skillId,
    invoke,
  });
  brokerMetadata.set(broker, policy);
  return broker;
}

function requireBundledSkillFilesystemBroker(context, skillId) {
  const broker = context?.host?.filesystem;
  if (
    !broker ||
    broker[FILESYSTEM_BROKER_BRAND] !== true ||
    broker.skillId !== skillId ||
    !brokerMetadata.has(broker) ||
    typeof broker.invoke !== "function"
  ) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_AUTHORITY_REQUIRED",
      `Branded filesystem authority is required for ${skillId}`,
    );
  }
  return broker;
}

function activeBroker() {
  const active = executionStorage.getStore();
  if (!active) {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_CONTEXT_REQUIRED",
      "Filesystem operation ran outside a bundled Skill execution context",
    );
  }
  return requireBundledSkillFilesystemBroker(active.context, active.skillId);
}

const bundledSkillFs = new Proxy(Object.create(null), {
  get(_target, operation) {
    if (typeof operation !== "string" || !SUPPORTED_OPERATIONS.has(operation)) {
      throw filesystemError(
        "CC_BUNDLED_SKILL_FILESYSTEM_OPERATION_UNSUPPORTED",
        `Unsupported bundled filesystem operation: ${String(operation)}`,
      );
    }
    return (...args) => activeBroker().invoke(operation, args);
  },
  set() {
    return false;
  },
});

function withBundledSkillFilesystem(skillId, handler) {
  if (!handler || typeof handler.execute !== "function") {
    throw filesystemError(
      "CC_BUNDLED_SKILL_FILESYSTEM_HANDLER_INVALID",
      "A bundled Skill handler with execute() is required",
    );
  }
  const execute = handler.execute;
  return {
    ...handler,
    execute(...args) {
      const context = args[1] || {};
      return executionStorage.run({ context, skillId }, () =>
        execute.apply(handler, args),
      );
    },
  };
}

module.exports = {
  FILESYSTEM_BROKER_BRAND,
  SUPPORTED_OPERATIONS,
  bundledSkillFs,
  createBundledSkillFilesystemBroker,
  requireBundledSkillFilesystemBroker,
  withBundledSkillFilesystem,
};
