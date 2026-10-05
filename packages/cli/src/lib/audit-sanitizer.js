/**
 * JSON-safe audit details. Limits apply before string processing and while
 * traversing; getters and user-provided toJSON methods are never invoked.
 * This is field/credential redaction, not detection of arbitrary secrets in prose.
 */
const REDACTED = "[REDACTED]";
const TRUNCATED = "[Truncated]";
const LIMITS = Object.freeze({
  depth: 8,
  entries: 100,
  nodes: 512,
  stringLength: 4096,
  keyLength: 256,
  totalCharacters: 16384,
  serializedBytes: 65536,
});

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "secretkey",
  "privatekey",
  "apikey",
  "token",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "mnemonic",
  "seedphrase",
  "credentials",
  "credential",
  "encryptionkey",
  "signingkey",
  "sessionid",
  "auth",
]);

function normalizeKey(key) {
  return key.toLowerCase().replace(/[\s_.-]/g, "");
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    /(?:password|secret|privatekey|apikey|token)$/.test(normalized)
  );
}

function isSensitiveQueryKey(key) {
  return isSensitiveKey(key) || /^(?:key|code|sig|signature)$/i.test(key);
}

function sanitizeUrl(text) {
  try {
    const url = new URL(text);
    if (url.username || url.password) {
      url.username = REDACTED;
      url.password = "";
    }
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      params.append(key, isSensitiveQueryKey(key) ? REDACTED : value);
    }
    url.search = params.toString();
    // OAuth implicit responses put credentials in the fragment instead of query.
    if (url.hash.includes("=")) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      const sanitized = new URLSearchParams();
      for (const [key, value] of fragment) {
        sanitized.append(key, isSensitiveQueryKey(key) ? REDACTED : value);
      }
      url.hash = sanitized.toString();
    }
    return url.toString();
  } catch {
    return "[REDACTED URL]";
  }
}

function sanitizeString(value) {
  // Drop oversized strings whole: slicing can expose half of a credential.
  if (value.length > LIMITS.stringLength) return TRUNCATED;
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, sanitizeUrl)
    .replace(/\b(?:Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi, REDACTED)
    .replace(
      /\b((?:proxy[-_ ]?)?authorization|(?:set[-_ ]?)?cookie)\s*:\s*[^\r\n]+/gi,
      "$1: [REDACTED]",
    )
    .replace(
      /\b((?:[a-z0-9_.-]{0,64})?(?:password|secret|private[-_.]?key|api[-_.]?key|token)|passwd|pwd|passphrase|mnemonic|seed[-_.]?phrase|credentials?|encryption[-_.]?key|signing[-_.]?key|session[-_.]?id|auth|(?:proxy[-_.]?)?authorization|(?:set[-_.]?)?cookie)(["']?\s*[=:]\s*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s&,;"']+)/gi,
      (_match, key, separator, value) => {
        const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
        return `${key}${separator}${quote}${REDACTED}${quote}`;
      },
    );
}

function readDataProperty(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor
    ? descriptor.value
    : "[Accessor omitted]";
}

function errorName(value) {
  let prototype = value;
  for (let i = 0; prototype && i < LIMITS.depth; i += 1) {
    if (Object.hasOwn(prototype, "name")) {
      const name = readDataProperty(prototype, "name");
      return typeof name === "string" ? name : "Error";
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return "Error";
}

function setDataProperty(target, key, value) {
  // Defining __proto__ as data cannot mutate the output object's prototype.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function sanitizeAuditDetails(details) {
  const ancestors = new WeakSet();
  let remainingNodes = LIMITS.nodes;
  let remainingCharacters = LIMITS.totalCharacters;

  function text(value) {
    const sanitized = sanitizeString(value);
    if (sanitized.length > remainingCharacters) return TRUNCATED;
    remainingCharacters -= sanitized.length;
    return sanitized;
  }

  function visit(value, depth = 0, context = "") {
    if (remainingNodes-- <= 0) return TRUNCATED;
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return text(value);
    if (typeof value === "bigint") return text(value.toString());
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    if (typeof value === "function") return "[Function omitted]";
    if (typeof value === "symbol") return "[Symbol omitted]";
    if (depth >= LIMITS.depth) return TRUNCATED;
    if (ancestors.has(value)) return "[Circular Reference]";
    ancestors.add(value);
    try {
      if (value instanceof Date) {
        return text(Date.prototype.toISOString.call(value));
      }
      if (value instanceof URL) {
        return text(URL.prototype.toString.call(value));
      }
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return "[Binary omitted]";
      }

      // Native fetch headers and query objects have no useful enumerable fields.
      if (value instanceof Headers || value instanceof URLSearchParams) {
        const result = {};
        const iterator =
          value instanceof Headers
            ? Headers.prototype.entries.call(value)
            : URLSearchParams.prototype.entries.call(value);
        let count = 0;
        for (const [key, item] of iterator) {
          if (count++ >= LIMITS.entries || remainingNodes <= 0) {
            setDataProperty(result, "[Truncated]", true);
            break;
          }
          if (key.length > LIMITS.keyLength) continue;
          setDataProperty(
            result,
            text(key),
            isSensitiveQueryKey(key) ? REDACTED : visit(item, depth + 1),
          );
        }
        return result;
      }

      if (Array.isArray(value)) {
        const result = [];
        const isHeaderList = normalizeKey(context).endsWith("headers");
        // Header tuple arrays are commonly returned by fetch/HTTP clients.
        const first = readDataProperty(value, "0");
        const isSensitivePair =
          value.length === 2 &&
          typeof first === "string" &&
          isSensitiveKey(first);
        for (let i = 0; i < value.length; i += 1) {
          if (i >= LIMITS.entries || remainingNodes <= 0) {
            result.push(TRUNCATED);
            break;
          }
          const previous =
            i % 2 === 1 && isHeaderList
              ? readDataProperty(value, String(i - 1))
              : null;
          const redact =
            (isSensitivePair && i === 1) ||
            (typeof previous === "string" && isSensitiveKey(previous));
          result.push(
            redact
              ? REDACTED
              : visit(readDataProperty(value, String(i)), depth + 1, context),
          );
        }
        return result;
      }

      const result = {};
      if (value instanceof Error) {
        setDataProperty(result, "name", text(errorName(value)));
        // message/stack/cause are usually non-enumerable. Do not call getters.
        for (const key of ["name", "message", "stack", "cause"]) {
          if (Object.hasOwn(value, key)) {
            setDataProperty(
              result,
              key,
              visit(readDataProperty(value, key), depth + 1),
            );
          }
        }
      }
      let count = 0;
      const headerName = normalizeKey(context).endsWith("headers")
        ? readDataProperty(value, "name")
        : null;
      for (const key in value) {
        if (
          count++ >= LIMITS.entries ||
          remainingNodes <= 0 ||
          remainingCharacters <= 0
        ) {
          setDataProperty(result, "[Truncated]", true);
          break;
        }
        if (!Object.hasOwn(value, key)) continue;
        if (key.length > LIMITS.keyLength) {
          setDataProperty(result, "[Truncated key]", true);
          continue;
        }
        setDataProperty(
          result,
          text(key),
          isSensitiveKey(key) ||
            (key === "value" &&
              typeof headerName === "string" &&
              isSensitiveKey(headerName))
            ? REDACTED
            : visit(readDataProperty(value, key), depth + 1, key),
        );
      }
      return result;
    } catch {
      // Proxies, invalid native objects, etc. must not break event persistence.
      return "[Unserializable]";
    } finally {
      ancestors.delete(value);
    }
  }

  const sanitized = visit(details);
  const serialized = JSON.stringify(sanitized);
  return serialized &&
    Buffer.byteLength(serialized, "utf8") > LIMITS.serializedBytes
    ? TRUNCATED
    : sanitized;
}
