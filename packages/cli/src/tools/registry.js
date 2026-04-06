function normalizeDescriptor(descriptor = {}) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("Tool descriptor must be an object.");
  }

  const name = String(descriptor.name || "").trim();
  if (!name) {
    throw new Error("Tool descriptor requires a name.");
  }

  return {
    name,
    title: descriptor.title || name,
    kind: descriptor.kind || "custom",
    description: descriptor.description || "",
    schema: descriptor.schema || { type: "object", properties: {} },
    permissions: {
      level: descriptor.permissions?.level || "standard",
      scopes: Array.isArray(descriptor.permissions?.scopes)
        ? [...descriptor.permissions.scopes]
        : [],
    },
    telemetry: {
      category: descriptor.telemetry?.category || descriptor.kind || "custom",
      tags: Array.isArray(descriptor.telemetry?.tags)
        ? [...descriptor.telemetry.tags]
        : [],
    },
    source: descriptor.source || "runtime",
    enabled: descriptor.enabled !== false,
  };
}

export class ToolRegistry {
  constructor(seed = []) {
    this._tools = new Map();
    seed.forEach((descriptor) => this.register(descriptor));
  }

  register(descriptor) {
    const normalized = normalizeDescriptor(descriptor);
    this._tools.set(normalized.name, normalized);
    return normalized;
  }

  has(name) {
    return this._tools.has(name);
  }

  get(name) {
    return this._tools.get(name) || null;
  }

  list({ enabledOnly = false, kind = null } = {}) {
    return [...this._tools.values()].filter((descriptor) => {
      if (enabledOnly && descriptor.enabled === false) return false;
      if (kind && descriptor.kind !== kind) return false;
      return true;
    });
  }

  toJSON() {
    return this.list();
  }
}

export const DEFAULT_TOOL_DESCRIPTORS = [
  {
    name: "shell",
    title: "Shell Command Runner",
    kind: "shell",
    description: "Execute shell commands with runtime-managed policy checks.",
    schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace"],
    },
    telemetry: {
      category: "shell",
      tags: ["tool:shell", "runtime:managed"],
    },
  },
  {
    name: "git",
    title: "Git Operation Runner",
    kind: "git",
    description: "Run git-oriented commands with runtime telemetry tagging.",
    schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
    permissions: {
      level: "elevated",
      scopes: ["process:spawn", "filesystem:workspace", "vcs:git"],
    },
    telemetry: {
      category: "git",
      tags: ["tool:git", "runtime:managed"],
    },
  },
  {
    name: "mcp",
    title: "MCP Tool Gateway",
    kind: "mcp",
    description: "Invoke MCP-managed capabilities through the runtime registry.",
    schema: {
      type: "object",
      properties: {
        server: { type: "string" },
        tool: { type: "string" },
        args: { type: "object" },
      },
      required: ["server", "tool"],
    },
    permissions: {
      level: "standard",
      scopes: ["mcp:invoke"],
    },
    telemetry: {
      category: "mcp",
      tags: ["tool:mcp", "runtime:managed"],
    },
  },
];

export function createDefaultToolRegistry() {
  return new ToolRegistry(DEFAULT_TOOL_DESCRIPTORS);
}

export { normalizeDescriptor as normalizeToolDescriptor };
