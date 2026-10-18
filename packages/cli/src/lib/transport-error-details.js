import { types } from "node:util";

const NAMES = new Set([
  "Error",
  "TypeError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "SocketError",
  "RequestAbortedError",
  "ClientDestroyedError",
  "ClientClosedError",
]);
const CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ABORT_ERR",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
  "UND_ERR_DESTROYED",
  "UND_ERR_CLOSED",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
]);

// Never invoke accessors, coercion hooks or Proxy traps. Native Error.name is
// inherited, so inspect a bounded number of prototype data descriptors.
function data(object, key) {
  for (let depth = 0; depth < 4 && object !== null; depth++) {
    if (typeof object !== "object" || types.isProxy(object)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    object = Object.getPrototypeOf(object);
  }
  return undefined;
}

/** Optional diagnostic projection only: no messages, endpoints or request data. */
export function transportErrorDetails(error) {
  try {
    const name = data(error, "name");
    const code = data(error, "code");
    let causeCode;
    const seen = new Set([error]);
    let cause = error;
    for (let depth = 0; depth < 4; depth++) {
      cause = data(cause, "cause");
      if (!cause || seen.has(cause)) break;
      seen.add(cause);
      const value = data(cause, "code");
      if (CODES.has(value)) {
        causeCode = value;
        break;
      }
    }
    if (!CODES.has(code) && !causeCode) return undefined;
    return {
      kind: "transport",
      ...(NAMES.has(name) ? { name } : {}),
      ...(CODES.has(code) ? { code } : {}),
      ...(causeCode ? { causeCode } : {}),
    };
  } catch {
    // Diagnostics must never replace the original error or exit outcome.
    return undefined;
  }
}
