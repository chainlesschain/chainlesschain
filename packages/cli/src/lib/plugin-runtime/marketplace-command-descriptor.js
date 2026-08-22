import crypto from "node:crypto";
import path from "node:path";

export const MARKETPLACE_COMMAND_DESCRIPTOR_ERROR = Object.freeze({
  INVALID: "CC_MARKETPLACE_COMMAND_DESCRIPTOR_INVALID",
  SHELL_REJECTED: "CC_MARKETPLACE_COMMAND_DESCRIPTOR_SHELL_REJECTED",
  LINK_UNSUPPORTED: "CC_MARKETPLACE_COMMAND_LINK_UNSUPPORTED",
});

export const MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS = Object.freeze({
  maxArgs: 128,
  maxArgumentBytes: 8 * 1024,
  maxTotalArgumentBytes: 32 * 1024,
  maxEnvironmentEntries: 32,
  maxEnvironmentValueBytes: 8 * 1024,
  minTimeoutMs: 100,
  maxTimeoutMs: 30_000,
  defaultTimeoutMs: 10_000,
  minOutputBytes: 1024,
  maxSourceOutputBytes: 4 * 1024 * 1024,
  maxHeadersOutputBytes: 64 * 1024,
});

const CONTROL = /[\u0000-\u001f\u007f]/u;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
export const MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
]);
const SAFE_ENVIRONMENT_KEYS = new Set(
  MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS,
);
const SHELL_EXECUTABLES = new Set([
  "bash",
  "busybox",
  "cmd",
  "command",
  "dash",
  "env",
  "fish",
  "ksh",
  "nu",
  "powershell",
  "pwsh",
  "sh",
  "zsh",
]);

function descriptorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      `${label} must be a JSON object`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key])) {
      throw descriptorError(
        MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
        `${label} must contain only own data properties`,
      );
    }
  }
  return descriptors;
}

function exactKeys(descriptors, allowed, label) {
  for (const key of Object.keys(descriptors)) {
    if (!allowed.has(key)) {
      throw descriptorError(
        MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
        `${label} contains unsupported field: ${key}`,
      );
    }
  }
}

function boundedString(value, label, maxBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    CONTROL.test(value) ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      `${label} must be a non-empty bounded string`,
    );
  }
  return value;
}

function normalizeAbsolutePath(value, label) {
  const text = boundedString(value, label, 4096);
  if (!path.isAbsolute(text)) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      `${label} must be an absolute path`,
    );
  }
  return path.normalize(text);
}

function executableBasename(value) {
  return path
    .basename(value)
    .replace(/\.(?:cmd|com|exe|bat)$/iu, "")
    .toLowerCase();
}

function normalizeExecutable(value) {
  const executable = normalizeAbsolutePath(
    value,
    "Marketplace command executable",
  );
  if (SHELL_EXECUTABLES.has(executableBasename(executable))) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.SHELL_REJECTED,
      "Marketplace command descriptors must not invoke a shell",
    );
  }
  return executable;
}

function normalizeArguments(value) {
  if (value === undefined) return Object.freeze([]);
  if (
    !Array.isArray(value) ||
    value.length > MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxArgs
  ) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command args must be a bounded string array",
    );
  }
  let totalBytes = 0;
  const args = value.map((argument) => {
    const normalized = boundedString(
      argument,
      "Marketplace command argument",
      MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxArgumentBytes,
    );
    totalBytes += Buffer.byteLength(normalized, "utf8");
    return normalized;
  });
  if (
    totalBytes > MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxTotalArgumentBytes
  ) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command arguments exceed the byte limit",
    );
  }
  return Object.freeze(args);
}

function normalizeEnvironment(value) {
  if (value === undefined) return Object.freeze({});
  const descriptors = plainObject(value, "Marketplace command env");
  const keys = Object.keys(descriptors);
  if (
    keys.length > MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxEnvironmentEntries
  ) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      "Marketplace command env has too many entries",
    );
  }
  const environment = {};
  for (const key of keys.sort()) {
    const normalizedKey = key.toUpperCase();
    if (
      !ENVIRONMENT_KEY.test(key) ||
      key !== normalizedKey ||
      !SAFE_ENVIRONMENT_KEYS.has(normalizedKey)
    ) {
      throw descriptorError(
        MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
        "Marketplace command env contains a disallowed key",
      );
    }
    environment[key] = boundedString(
      descriptors[key].value,
      "Marketplace command env value",
      MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxEnvironmentValueBytes,
    );
  }
  return Object.freeze(environment);
}

function normalizeBoundedInteger(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

/**
 * Parse the intentionally narrow Marketplace process descriptor. The
 * descriptor is JSON-serializable, has no shell-string field, and contains
 * the complete executable/argv/cwd/environment plan that the runner consumes.
 */
export function normalizeMarketplaceCommandDescriptor(raw, options = {}) {
  const label = options.label || "Marketplace command descriptor";
  const kind = options.kind || "source";
  const descriptors = plainObject(raw, label);
  const allowMode = kind === "source";
  exactKeys(
    descriptors,
    new Set([
      ...(options.allowType === true ? ["type"] : []),
      "executable",
      "args",
      "cwd",
      "env",
      "timeoutMs",
      "maxOutputBytes",
      ...(allowMode ? ["mode"] : []),
    ]),
    label,
  );
  if (options.allowType === true && descriptors.type?.value !== "command") {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      `${label}.type must be command`,
    );
  }

  const maxOutputBytes = normalizeBoundedInteger(
    descriptors.maxOutputBytes?.value,
    kind === "headers"
      ? MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxHeadersOutputBytes
      : MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxSourceOutputBytes,
    MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.minOutputBytes,
    kind === "headers"
      ? MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxHeadersOutputBytes
      : MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxSourceOutputBytes,
    `${label}.maxOutputBytes`,
  );
  const mode = allowMode ? descriptors.mode?.value || "copy" : null;
  if (allowMode && !new Set(["copy", "link"]).has(mode)) {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      `${label}.mode must be copy or link`,
    );
  }
  return Object.freeze({
    executable: normalizeExecutable(descriptors.executable?.value),
    args: normalizeArguments(descriptors.args?.value),
    cwd: normalizeAbsolutePath(
      descriptors.cwd?.value,
      "Marketplace command cwd",
    ),
    env: normalizeEnvironment(descriptors.env?.value),
    timeoutMs: normalizeBoundedInteger(
      descriptors.timeoutMs?.value,
      MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.defaultTimeoutMs,
      MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.minTimeoutMs,
      MARKETPLACE_COMMAND_DESCRIPTOR_LIMITS.maxTimeoutMs,
      `${label}.timeoutMs`,
    ),
    maxOutputBytes,
    ...(allowMode ? { mode } : {}),
  });
}

/** A non-secret stable projection suitable for catalog identity only. */
export function marketplaceCommandDescriptorIdentity(descriptor) {
  const normalized = normalizeMarketplaceCommandDescriptor(descriptor, {
    kind: "source",
    allowType: Object.prototype.hasOwnProperty.call(descriptor || {}, "type"),
  });
  const projection = {
    executable: normalized.executable,
    args: normalized.args,
    cwd: normalized.cwd,
    envKeys: Object.keys(normalized.env).sort(),
    timeoutMs: normalized.timeoutMs,
    maxOutputBytes: normalized.maxOutputBytes,
    mode: normalized.mode,
  };
  return `command:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(projection)))
    .digest("hex")
    .slice(0, 32)}`;
}

export function assertMarketplaceCommandModeSupported(
  mode,
  platform = process.platform,
) {
  if (mode === "link" && platform === "win32") {
    throw descriptorError(
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.LINK_UNSUPPORTED,
      "Marketplace command source mode link is not supported on Windows",
    );
  }
}
