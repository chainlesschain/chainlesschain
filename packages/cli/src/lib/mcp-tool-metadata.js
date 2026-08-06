import { isProxy } from "node:util/types";

export const MCP_TOOL_METADATA_LIMITS = Object.freeze({
  maxTools: 1000,
  maxNameBytes: 256,
  maxDescriptionBytes: 16 * 1024,
  maxSchemaBytes: 256 * 1024,
  maxSchemaDepth: 32,
  maxSchemaNodes: 25_000,
  maxDefinitionBytes: 512 * 1024,
  maxDefinitionNodes: 50_000,
  maxServerBytes: 8 * 1024 * 1024,
  maxClientBytes: 32 * 1024 * 1024,
});

const MCP_TOOL_METADATA_ERROR_CODES = new Set([
  "CC_MCP_TOOL_METADATA_INVALID",
  "CC_MCP_TOOL_COUNT_EXCEEDED",
  "CC_MCP_TOOL_NAME_TOO_LARGE",
  "CC_MCP_TOOL_DESCRIPTION_TOO_LARGE",
  "CC_MCP_TOOL_SCHEMA_TOO_LARGE",
  "CC_MCP_TOOL_SCHEMA_DEPTH_EXCEEDED",
  "CC_MCP_TOOL_SCHEMA_NODES_EXCEEDED",
  "CC_MCP_TOOL_DEFINITION_TOO_LARGE",
  "CC_MCP_TOOL_METADATA_TOO_LARGE",
  "CC_MCP_TOOL_CLIENT_METADATA_TOO_LARGE",
]);

function tightenedLimit(configured, ceiling) {
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(ceiling, Math.max(1, Math.floor(configured)));
  }
  return ceiling;
}

export function resolveMcpToolMetadataLimits(config = {}) {
  return Object.freeze({
    maxTools: tightenedLimit(
      config?.maxTools,
      MCP_TOOL_METADATA_LIMITS.maxTools,
    ),
    maxNameBytes: MCP_TOOL_METADATA_LIMITS.maxNameBytes,
    maxDescriptionBytes: tightenedLimit(
      config?.maxToolDescriptionBytes,
      MCP_TOOL_METADATA_LIMITS.maxDescriptionBytes,
    ),
    maxSchemaBytes: tightenedLimit(
      config?.maxToolSchemaBytes,
      MCP_TOOL_METADATA_LIMITS.maxSchemaBytes,
    ),
    maxSchemaDepth: tightenedLimit(
      config?.maxToolSchemaDepth,
      MCP_TOOL_METADATA_LIMITS.maxSchemaDepth,
    ),
    maxSchemaNodes: tightenedLimit(
      config?.maxToolSchemaNodes,
      MCP_TOOL_METADATA_LIMITS.maxSchemaNodes,
    ),
    maxDefinitionBytes: tightenedLimit(
      config?.maxToolDefinitionBytes,
      MCP_TOOL_METADATA_LIMITS.maxDefinitionBytes,
    ),
    maxDefinitionNodes: MCP_TOOL_METADATA_LIMITS.maxDefinitionNodes,
    maxServerBytes: tightenedLimit(
      config?.maxToolMetadataBytes,
      MCP_TOOL_METADATA_LIMITS.maxServerBytes,
    ),
    maxClientBytes: MCP_TOOL_METADATA_LIMITS.maxClientBytes,
  });
}

function metadataError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "McpToolMetadataError";
  error.code = code;
  if (details.limitBytes != null) error.limitBytes = details.limitBytes;
  if (details.limitDepth != null) error.limitDepth = details.limitDepth;
  if (details.limitNodes != null) error.limitNodes = details.limitNodes;
  if (details.limitTools != null) error.limitTools = details.limitTools;
  return error;
}

export function isMcpToolMetadataError(error) {
  if (!error || typeof error !== "object") return false;
  try {
    if (isProxy(error)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return Boolean(
      descriptor &&
      Object.hasOwn(descriptor, "value") &&
      MCP_TOOL_METADATA_ERROR_CODES.has(descriptor.value),
    );
  } catch {
    return false;
  }
}

function denseArrayValues(value) {
  if (!value || typeof value !== "object") return null;
  try {
    if (isProxy(value) || !Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some((key) => typeof key === "symbol")
    ) {
      return null;
    }
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      values.push(descriptor.value);
    }
    return values;
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

function cloneJsonValue(value, state, depth) {
  state.remaining -= 1;
  if (state.remaining < 0) return { issue: "nodes" };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return { value };
  }
  if (!value || typeof value !== "object" || depth > state.maxDepth) {
    return { issue: depth > state.maxDepth ? "depth" : "invalid" };
  }
  try {
    if (isProxy(value) || state.seen.has(value)) return { issue: "invalid" };
    state.seen.add(value);
  } catch {
    return { issue: "invalid" };
  }

  if (Array.isArray(value)) {
    const values = denseArrayValues(value);
    if (!values) return { issue: "invalid" };
    const clean = [];
    for (const item of values) {
      const cloned = cloneJsonValue(item, state, depth + 1);
      if (cloned.issue) return cloned;
      clean.push(cloned.value);
    }
    return { value: clean };
  }

  const snapshot = plainObjectSnapshot(value);
  if (!snapshot) return { issue: "invalid" };
  state.remaining -= snapshot.keys.length;
  if (state.remaining < 0) return { issue: "nodes" };
  const clean = {};
  for (const key of snapshot.keys) {
    const cloned = cloneJsonValue(
      snapshot.descriptors[key].value,
      state,
      depth + 1,
    );
    if (cloned.issue) return cloned;
    Object.defineProperty(clean, key, {
      value: cloned.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { value: clean };
}

function snapshotJson(value, { maxDepth, maxNodes }) {
  const cloned = cloneJsonValue(
    value,
    { maxDepth, remaining: maxNodes, seen: new WeakSet() },
    1,
  );
  if (cloned.issue) return cloned;
  const wire = JSON.stringify(cloned.value);
  return {
    value: cloned.value,
    wire,
    bytes: Buffer.byteLength(wire, "utf8"),
  };
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

function ownDataValue(snapshot, key) {
  return snapshot?.descriptors?.[key]?.value;
}

function hasDisallowedDescriptionControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const disallowedC0 =
      code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (disallowedC0 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function schemaSnapshot(value, limits) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }
  const snapshot = snapshotJson(value, {
    maxDepth: limits.maxSchemaDepth,
    maxNodes: limits.maxSchemaNodes,
  });
  if (snapshot.issue === "depth") {
    throw metadataError(
      "CC_MCP_TOOL_SCHEMA_DEPTH_EXCEEDED",
      `MCP tool schema exceeded the ${limits.maxSchemaDepth}-level host depth budget`,
      { limitDepth: limits.maxSchemaDepth },
    );
  }
  if (snapshot.issue === "nodes") {
    throw metadataError(
      "CC_MCP_TOOL_SCHEMA_NODES_EXCEEDED",
      `MCP tool schema exceeded the ${limits.maxSchemaNodes}-node host budget`,
      { limitNodes: limits.maxSchemaNodes },
    );
  }
  if (snapshot.issue) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }
  if (snapshot.bytes > limits.maxSchemaBytes) {
    throw metadataError(
      "CC_MCP_TOOL_SCHEMA_TOO_LARGE",
      `MCP tool schema exceeded the ${limits.maxSchemaBytes}-byte host budget`,
      { limitBytes: limits.maxSchemaBytes },
    );
  }
  return snapshot.value;
}

function toolSnapshot(tool, limits) {
  const shallow = plainObjectSnapshot(tool);
  if (!shallow) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }

  const name = ownDataValue(shallow, "name");
  if (typeof name !== "string" || name.length === 0 || /\p{Cc}/u.test(name)) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }
  if (Buffer.byteLength(name, "utf8") > limits.maxNameBytes) {
    throw metadataError(
      "CC_MCP_TOOL_NAME_TOO_LARGE",
      `MCP tool name exceeded the ${limits.maxNameBytes}-byte host budget`,
      { limitBytes: limits.maxNameBytes },
    );
  }

  const description = ownDataValue(shallow, "description");
  if (description !== undefined && typeof description !== "string") {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }
  if (
    typeof description === "string" &&
    Buffer.byteLength(description, "utf8") > limits.maxDescriptionBytes
  ) {
    throw metadataError(
      "CC_MCP_TOOL_DESCRIPTION_TOO_LARGE",
      `MCP tool description exceeded the ${limits.maxDescriptionBytes}-byte host budget`,
      { limitBytes: limits.maxDescriptionBytes },
    );
  }
  if (
    typeof description === "string" &&
    hasDisallowedDescriptionControl(description)
  ) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }

  for (const field of ["inputSchema", "outputSchema"]) {
    if (Object.hasOwn(shallow.descriptors, field)) {
      schemaSnapshot(ownDataValue(shallow, field), limits);
    }
  }

  const snapshot = snapshotJson(tool, {
    maxDepth: limits.maxSchemaDepth + 1,
    maxNodes: limits.maxDefinitionNodes,
  });
  if (snapshot.issue) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool definition",
    );
  }
  if (snapshot.bytes > limits.maxDefinitionBytes) {
    throw metadataError(
      "CC_MCP_TOOL_DEFINITION_TOO_LARGE",
      `MCP tool definition exceeded the ${limits.maxDefinitionBytes}-byte host budget`,
      { limitBytes: limits.maxDefinitionBytes },
    );
  }
  return snapshot;
}

export function admitMcpToolList(
  _serverName,
  value,
  config = {},
  options = {},
) {
  const limits = resolveMcpToolMetadataLimits(config);
  const values = denseArrayValues(value);
  if (!values) {
    throw metadataError(
      "CC_MCP_TOOL_METADATA_INVALID",
      "MCP server returned an invalid tool inventory",
    );
  }
  if (values.length > limits.maxTools) {
    throw metadataError(
      "CC_MCP_TOOL_COUNT_EXCEEDED",
      `MCP tool inventory exceeded the ${limits.maxTools}-tool host budget`,
      { limitTools: limits.maxTools },
    );
  }

  const tools = [];
  const names = new Set();
  let metadataBytes = 0;
  for (const tool of values) {
    const snapshot = toolSnapshot(tool, limits);
    const name = snapshot.value.name;
    if (names.has(name)) {
      throw metadataError(
        "CC_MCP_TOOL_METADATA_INVALID",
        "MCP server returned an invalid tool inventory",
      );
    }
    names.add(name);
    metadataBytes += snapshot.bytes;
    if (metadataBytes > limits.maxServerBytes) {
      throw metadataError(
        "CC_MCP_TOOL_METADATA_TOO_LARGE",
        `MCP tool inventory exceeded the ${limits.maxServerBytes}-byte host budget`,
        { limitBytes: limits.maxServerBytes },
      );
    }
    tools.push(freezeJsonSnapshot(snapshot.value));
  }

  const clientBytesUsed =
    Number.isSafeInteger(options.clientBytesUsed) && options.clientBytesUsed > 0
      ? options.clientBytesUsed
      : 0;
  if (clientBytesUsed + metadataBytes > limits.maxClientBytes) {
    throw metadataError(
      "CC_MCP_TOOL_CLIENT_METADATA_TOO_LARGE",
      `MCP client tool metadata exceeded the ${limits.maxClientBytes}-byte host budget`,
      { limitBytes: limits.maxClientBytes },
    );
  }
  return Object.freeze({
    tools: Object.freeze(tools),
    metadataBytes,
    limits,
  });
}
