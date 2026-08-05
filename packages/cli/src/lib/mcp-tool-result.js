import { isProxy } from "node:util/types";

// Final tools/call results cross several amplification boundaries after the
// transport frame is parsed: ledger hashing, stream projection, session/model
// serialization, and direct IDE/host consumers. Admit one strict JSON snapshot
// under a smaller result-specific budget before any of those consumers run.

export const MCP_TOOL_RESULT_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxDepth: 64,
  maxNodes: 50_000,
});

const MCP_TOOL_RESULT_ERROR_CODES = new Set([
  "CC_MCP_TOOL_RESULT_INVALID",
  "CC_MCP_TOOL_RESULT_TOO_LARGE",
  "CC_MCP_TOOL_RESULT_DEPTH_EXCEEDED",
  "CC_MCP_TOOL_RESULT_NODES_EXCEEDED",
]);

const admittedToolResults = new WeakMap();

function tightenedLimit(configured, ceiling) {
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(ceiling, Math.max(1, Math.floor(configured)));
  }
  return ceiling;
}

export function resolveMcpToolResultLimits(config = {}) {
  return Object.freeze({
    maxBytes: tightenedLimit(
      config?.maxToolResultBytes,
      MCP_TOOL_RESULT_LIMITS.maxBytes,
    ),
    maxDepth: tightenedLimit(
      config?.maxToolResultDepth,
      MCP_TOOL_RESULT_LIMITS.maxDepth,
    ),
    maxNodes: tightenedLimit(
      config?.maxToolResultNodes,
      MCP_TOOL_RESULT_LIMITS.maxNodes,
    ),
  });
}

function resultError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "McpToolResultAdmissionError";
  error.code = code;
  error.dispatched = true;
  error.outcomeUnknown = true;
  error.retryable = false;
  if (details.limitBytes != null) error.limitBytes = details.limitBytes;
  if (details.limitDepth != null) error.limitDepth = details.limitDepth;
  if (details.limitNodes != null) error.limitNodes = details.limitNodes;
  return error;
}

export function isMcpToolResultAdmissionError(error) {
  if (!error || typeof error !== "object") return false;
  try {
    if (isProxy(error)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return Boolean(
      descriptor &&
      Object.hasOwn(descriptor, "value") &&
      MCP_TOOL_RESULT_ERROR_CODES.has(descriptor.value),
    );
  } catch {
    return false;
  }
}

function denseArraySnapshot(value) {
  if (!value || typeof value !== "object") return null;
  try {
    if (isProxy(value) || !Array.isArray(value)) return null;
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some((key) => typeof key === "symbol")
    ) {
      return null;
    }
    const descriptors = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      descriptors.push(descriptor);
    }
    return descriptors;
  } catch {
    return null;
  }
}

function plainObjectSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  try {
    if (isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) return null;
    const descriptors = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      descriptors[key] = descriptor;
    }
    return { keys, descriptors };
  } catch {
    return null;
  }
}

function boundedJsonStringBytes(value, available) {
  let bytes = 2;
  if (bytes > available) return available + 1;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
    if (bytes > available) return available + 1;
  }
  return bytes;
}

function consumeBytes(state, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > state.bytesLeft) {
    state.issue = "bytes";
    return false;
  }
  state.bytesLeft -= bytes;
  return true;
}

function consumeNodes(state, count = 1) {
  if (!Number.isSafeInteger(count) || count < 0 || count > state.nodesLeft) {
    state.issue = "nodes";
    return false;
  }
  state.nodesLeft -= count;
  return true;
}

function cloneJsonValue(value, state, depth) {
  if (!consumeNodes(state)) return undefined;

  if (value === null) {
    consumeBytes(state, 4);
    return null;
  }
  if (typeof value === "string") {
    consumeBytes(state, boundedJsonStringBytes(value, state.bytesLeft));
    return value;
  }
  if (typeof value === "boolean") {
    consumeBytes(state, value ? 4 : 5);
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    consumeBytes(state, Buffer.byteLength(JSON.stringify(value), "utf8"));
    return value;
  }
  if (!value || typeof value !== "object") {
    state.issue = "invalid";
    return undefined;
  }
  if (depth > state.maxDepth) {
    state.issue = "depth";
    return undefined;
  }
  state.maxDepthSeen = Math.max(state.maxDepthSeen, depth);
  try {
    if (isProxy(value) || state.seen.has(value)) {
      state.issue = "invalid";
      return undefined;
    }
    state.seen.add(value);
  } catch {
    state.issue = "invalid";
    return undefined;
  }

  if (Array.isArray(value)) {
    const descriptors = denseArraySnapshot(value);
    if (!descriptors || !consumeBytes(state, 2)) {
      if (!state.issue) state.issue = "invalid";
      return undefined;
    }
    const clean = [];
    for (let index = 0; index < descriptors.length; index += 1) {
      if (index > 0 && !consumeBytes(state, 1)) return undefined;
      const cloned = cloneJsonValue(descriptors[index].value, state, depth + 1);
      if (state.issue) return undefined;
      clean.push(cloned);
    }
    return clean;
  }

  const snapshot = plainObjectSnapshot(value);
  if (!snapshot || !consumeBytes(state, 2)) {
    if (!state.issue) state.issue = "invalid";
    return undefined;
  }
  if (!consumeNodes(state, snapshot.keys.length)) return undefined;
  const clean = {};
  for (let index = 0; index < snapshot.keys.length; index += 1) {
    const key = snapshot.keys[index];
    if (index > 0 && !consumeBytes(state, 1)) return undefined;
    if (
      !consumeBytes(state, boundedJsonStringBytes(key, state.bytesLeft)) ||
      !consumeBytes(state, 1)
    ) {
      return undefined;
    }
    const cloned = cloneJsonValue(
      snapshot.descriptors[key].value,
      state,
      depth + 1,
    );
    if (state.issue) return undefined;
    Object.defineProperty(clean, key, {
      value: cloned,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clean;
}

function freezeJsonSnapshot(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || Object.isFrozen(current)) {
      continue;
    }
    for (const key of Object.keys(current)) {
      const child = current[key];
      if (child && typeof child === "object") stack.push(child);
    }
    Object.freeze(current);
  }
  return value;
}

function admissionError(issue, limits) {
  if (issue === "bytes") {
    return resultError(
      "CC_MCP_TOOL_RESULT_TOO_LARGE",
      `MCP tool result exceeded the ${limits.maxBytes}-byte host budget`,
      { limitBytes: limits.maxBytes },
    );
  }
  if (issue === "depth") {
    return resultError(
      "CC_MCP_TOOL_RESULT_DEPTH_EXCEEDED",
      `MCP tool result exceeded the ${limits.maxDepth}-level host depth budget`,
      { limitDepth: limits.maxDepth },
    );
  }
  if (issue === "nodes") {
    return resultError(
      "CC_MCP_TOOL_RESULT_NODES_EXCEEDED",
      `MCP tool result exceeded the ${limits.maxNodes}-node host budget`,
      { limitNodes: limits.maxNodes },
    );
  }
  return resultError(
    "CC_MCP_TOOL_RESULT_INVALID",
    "MCP server returned an invalid tool result",
  );
}

export function admitMcpToolResult(_serverName, value, config = {}) {
  const limits = resolveMcpToolResultLimits(config);
  if (value && typeof value === "object") {
    const prior = admittedToolResults.get(value);
    if (
      prior &&
      prior.bytes <= limits.maxBytes &&
      prior.depth <= limits.maxDepth &&
      prior.nodes <= limits.maxNodes
    ) {
      return Object.freeze({
        result: value,
        bytes: prior.bytes,
        depth: prior.depth,
        nodes: prior.nodes,
        limits,
      });
    }
  }

  const state = {
    issue: null,
    bytesLeft: limits.maxBytes,
    nodesLeft: limits.maxNodes,
    maxDepth: limits.maxDepth,
    maxDepthSeen: 0,
    seen: new WeakSet(),
  };
  const result = cloneJsonValue(value, state, 1);
  if (
    !state.issue &&
    (!result || typeof result !== "object" || Array.isArray(result))
  ) {
    state.issue = "invalid";
  }
  if (state.issue) throw admissionError(state.issue, limits);

  const bytes = limits.maxBytes - state.bytesLeft;
  const nodes = limits.maxNodes - state.nodesLeft;
  freezeJsonSnapshot(result);
  const metrics = Object.freeze({
    bytes,
    depth: state.maxDepthSeen,
    nodes,
  });
  admittedToolResults.set(result, metrics);
  return Object.freeze({ result, ...metrics, limits });
}
