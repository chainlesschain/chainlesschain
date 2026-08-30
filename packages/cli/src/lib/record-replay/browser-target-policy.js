import { createHash } from "node:crypto";

const MAX_HTML_CHARS = 1_000_000;
const MAX_ALLOWED_ORIGINS = 8;
const MAX_URL_CHARS = 4_096;
const MAX_STORAGE_STATE_BYTES = 2 * 1024 * 1024;
const MAX_STORAGE_STATE_DEPTH = 16;
const MAX_STORAGE_STATE_NODES = 10_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function targetError(code, message) {
  const error = new Error(message);
  error.name = "RecordedSkillBrowserTargetError";
  error.code = code;
  return error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function boundedCanonicalStorageState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "browser storage state must be a JSON object",
    );
  }
  const seen = new WeakSet();
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const item = current.value;
    nodes += 1;
    if (
      nodes > MAX_STORAGE_STATE_NODES ||
      current.depth > MAX_STORAGE_STATE_DEPTH
    ) {
      throw targetError(
        "CC_RECORD_TARGET_INVALID",
        "browser storage state exceeds its structural limits",
      );
    }
    if (!item || typeof item !== "object") {
      if (
        typeof item === "undefined" ||
        typeof item === "bigint" ||
        typeof item === "function" ||
        typeof item === "symbol" ||
        (typeof item === "number" && !Number.isFinite(item))
      ) {
        throw targetError(
          "CC_RECORD_TARGET_INVALID",
          "browser storage state must contain only JSON values",
        );
      }
      continue;
    }
    if (seen.has(item)) {
      throw targetError(
        "CC_RECORD_TARGET_INVALID",
        "browser storage state must not contain cycles or shared objects",
      );
    }
    seen.add(item);
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype
    ) {
      throw targetError(
        "CC_RECORD_TARGET_INVALID",
        "browser storage state must contain plain JSON objects",
      );
    }
    const children = Array.isArray(item) ? item : Object.values(item);
    if (children.length > MAX_STORAGE_STATE_NODES) {
      throw targetError(
        "CC_RECORD_TARGET_INVALID",
        "browser storage state exceeds its structural limits",
      );
    }
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  const canonical = canonicalValue(value);
  if (
    Buffer.byteLength(JSON.stringify(canonical), "utf8") >
    MAX_STORAGE_STATE_BYTES
  ) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "browser storage state exceeds the 2 MiB limit",
    );
  }
  return deepFreeze(canonical);
}

function digest(value, domain) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(
        typeof value === "string"
          ? value
          : JSON.stringify(canonicalValue(value)),
      );
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(bytes)
    .digest("hex")}`;
}

function isLoopback(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

function safeUrl(value, { originOnly = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_URL_CHARS
  ) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      `browser target URL must be no longer than ${MAX_URL_CHARS} characters`,
    );
  }
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "browser target must be an absolute URL",
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopback(parsed.hostname)))
  ) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "browser targets require HTTPS; HTTP is allowed only for loopback testing and URL credentials are forbidden",
    );
  }
  if (originOnly && parsed.href !== `${parsed.origin}/`) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "allowed origins must not contain a path, query, or fragment",
    );
  }
  return parsed;
}

export function createRecordedSkillNetworkPolicy({
  mode = "deny",
  allowedOrigins = [],
} = {}) {
  if (mode === "deny") {
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length > 0) {
      throw targetError(
        "CC_RECORD_TARGET_INVALID",
        "deny network policy cannot retain allowed origins",
      );
    }
    const body = { mode: "deny", allowedOrigins: [] };
    return deepFreeze({
      ...body,
      digest: digest(body, "cc.record-replay.network-policy/v1"),
    });
  }
  if (mode !== "allowlist" || !Array.isArray(allowedOrigins)) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "browser network policy is invalid",
    );
  }
  const origins = [
    ...new Set(
      allowedOrigins.map(
        (value) => safeUrl(value, { originOnly: true }).origin,
      ),
    ),
  ].sort();
  if (origins.length < 1 || origins.length > MAX_ALLOWED_ORIGINS) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      `browser target requires between 1 and ${MAX_ALLOWED_ORIGINS} allowed origins`,
    );
  }
  const body = { mode: "allowlist", allowedOrigins: origins };
  return deepFreeze({
    ...body,
    digest: digest(body, "cc.record-replay.network-policy/v1"),
  });
}

export function digestRecordedSkillStorageState(storageState) {
  if (storageState == null) return null;
  return digest(
    boundedCanonicalStorageState(storageState),
    "cc.record-replay.browser-storage-state/v1",
  );
}

export function prepareRecordedSkillBrowserTarget({
  html,
  url,
  allowedOrigins = [],
  storageState,
  identity = "anonymous",
} = {}) {
  const hasHtml = typeof html === "string" && html.length > 0;
  const hasUrl = typeof url === "string" && url.length > 0;
  if (hasHtml === hasUrl) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "provide exactly one self-contained HTML fixture or URL target",
    );
  }
  const safeIdentity = String(identity || "anonymous").trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(safeIdentity)) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "browser identity label is invalid",
    );
  }
  if (hasHtml) {
    if (
      html.length > MAX_HTML_CHARS ||
      allowedOrigins.length > 0 ||
      storageState != null
    ) {
      throw targetError(
        "CC_RECORD_TARGET_INVALID",
        "self-contained HTML recording cannot use network origins or browser credentials",
      );
    }
    const networkPolicy = createRecordedSkillNetworkPolicy({ mode: "deny" });
    return deepFreeze({
      adapter: "self-contained-html",
      html,
      url: null,
      targetDigest: digest(html, "cc.record-replay.ui-fixture/v1"),
      networkPolicy,
      storageState: null,
      storageStateDigest: null,
      identity: safeIdentity,
    });
  }
  const target = safeUrl(url);
  const networkPolicy = createRecordedSkillNetworkPolicy({
    mode: "allowlist",
    allowedOrigins:
      allowedOrigins.length > 0 ? allowedOrigins : [target.origin],
  });
  if (!networkPolicy.allowedOrigins.includes(target.origin)) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "target origin must be present in the network allowlist",
    );
  }
  const normalizedStorageState =
    storageState == null ? null : boundedCanonicalStorageState(storageState);
  return deepFreeze({
    adapter: "url-origin",
    html: null,
    url: target.href,
    targetDigest: digest(target.href, "cc.record-replay.ui-url/v1"),
    networkPolicy,
    storageState: normalizedStorageState,
    storageStateDigest: digestRecordedSkillStorageState(normalizedStorageState),
    identity: safeIdentity,
  });
}

export function recordedSkillBrowserEnvironment(target) {
  if (
    !target ||
    !["self-contained-html", "url-origin"].includes(target.adapter) ||
    !SHA256_PATTERN.test(String(target.targetDigest || ""))
  ) {
    throw targetError(
      "CC_RECORD_TARGET_INVALID",
      "prepared browser target is invalid",
    );
  }
  return deepFreeze({
    adapter: target.adapter,
    browser: "chromium",
    targetDigest: target.targetDigest,
    selectorContract: "record-replay-dom-v1",
    networkPolicy: Object.freeze({
      mode: target.networkPolicy.mode,
      allowedOrigins: Object.freeze([...target.networkPolicy.allowedOrigins]),
      digest: target.networkPolicy.digest,
    }),
    identity: target.identity,
    storageStateDigest: target.storageStateDigest,
  });
}

export function assertRecordedSkillBrowserBinding(
  target,
  { source, environment } = {},
) {
  let reviewedPolicy;
  try {
    reviewedPolicy = createRecordedSkillNetworkPolicy({
      mode: environment?.networkPolicy?.mode,
      allowedOrigins: environment?.networkPolicy?.allowedOrigins || [],
    });
  } catch {
    reviewedPolicy = null;
  }
  if (
    !source ||
    target?.adapter !== source.adapter ||
    target?.targetDigest !== source.targetDigest ||
    environment?.adapter !== source.adapter ||
    environment?.targetDigest !== source.targetDigest
  ) {
    throw targetError(
      "CC_RECORD_TARGET_DRIFT",
      "browser target no longer matches the reviewed recording",
    );
  }
  if (
    (environment.storageStateDigest || null) !==
    (target.storageStateDigest || null)
  ) {
    throw targetError(
      "CC_RECORD_CREDENTIAL_DRIFT",
      "browser storage state no longer matches the reviewed credential binding",
    );
  }
  if (
    environment.identity !== target.identity ||
    reviewedPolicy?.digest !== environment.networkPolicy?.digest ||
    reviewedPolicy?.digest !== target.networkPolicy?.digest
  ) {
    throw targetError(
      "CC_RECORD_ENVIRONMENT_DRIFT",
      "browser identity or network policy no longer matches the reviewed recording",
    );
  }
  return true;
}

export function requestAllowedByRecordedSkillPolicy(rawUrl, target) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (["about:", "data:"].includes(parsed.protocol)) return true;
  if (parsed.protocol === "blob:") {
    return (
      target.networkPolicy.mode === "allowlist" &&
      target.networkPolicy.allowedOrigins.includes(parsed.origin)
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  return (
    target.networkPolicy.mode === "allowlist" &&
    target.networkPolicy.allowedOrigins.includes(parsed.origin)
  );
}

export function navigationAllowedByRecordedSkillPolicy(rawUrl, target) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  return (
    ["http:", "https:"].includes(parsed.protocol) &&
    target.networkPolicy.mode === "allowlist" &&
    target.networkPolicy.allowedOrigins.includes(parsed.origin)
  );
}
