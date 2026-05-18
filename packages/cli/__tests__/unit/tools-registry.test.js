import { describe, it, expect } from "vitest";
import {
  ToolRegistry,
  createDefaultToolRegistry,
  normalizeToolDescriptor,
} from "../../src/tools/registry.js";
import { createToolContext, extendToolContext } from "../../src/tools/tool-context.js";
import {
  normalizeToolPermissions,
  isToolAllowed,
} from "../../src/tools/tool-permissions.js";
import {
  createToolTelemetryRecord,
  createToolTelemetryTags,
} from "../../src/tools/tool-telemetry.js";

describe("tools registry", () => {
  it("registers and lists descriptors", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "shell",
      kind: "shell",
      permissions: { level: "elevated" },
    });

    expect(registry.has("shell")).toBe(true);
    expect(registry.get("shell")).toEqual(
      expect.objectContaining({
        name: "shell",
        kind: "shell",
        permissions: expect.objectContaining({ level: "elevated" }),
      }),
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("creates default registry with shell git mcp descriptors", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.list({ enabledOnly: true }).map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["shell", "git", "mcp"]),
    );
  });

  it("normalizes descriptor defaults", () => {
    expect(
      normalizeToolDescriptor({
        name: "custom",
      }),
    ).toEqual(
      expect.objectContaining({
        name: "custom",
        title: "custom",
        kind: "custom",
        enabled: true,
      }),
    );
  });
});

describe("tool context", () => {
  it("creates and extends tool context", () => {
    const base = createToolContext({
      toolName: "shell",
      cwd: "C:/code/chainlesschain",
      sessionId: "sess-1",
      runtimeKind: "agent",
      metadata: { source: "test" },
    });
    const extended = extendToolContext(base, {
      metadata: { branch: "main" },
      toolName: "git",
    });

    expect(extended).toEqual(
      expect.objectContaining({
        toolName: "git",
        sessionId: "sess-1",
        metadata: {
          source: "test",
          branch: "main",
        },
      }),
    );
  });
});

describe("tool permissions", () => {
  it("normalizes permissions and checks allow/deny policies", () => {
    const descriptor = {
      name: "shell",
      permissions: normalizeToolPermissions({
        level: "elevated",
        scopes: ["process:spawn"],
      }),
    };

    expect(
      isToolAllowed(descriptor, {
        allowlist: ["shell"],
        maxLevel: "elevated",
      }),
    ).toBe(true);

    expect(
      isToolAllowed(descriptor, {
        allowlist: ["shell"],
        maxLevel: "standard",
      }),
    ).toBe(false);

    expect(
      isToolAllowed(descriptor, {
        denylist: ["shell"],
        maxLevel: "elevated",
      }),
    ).toBe(false);
  });
});

describe("tool telemetry", () => {
  it("creates telemetry tags and normalized tool execution records", () => {
    const descriptor = {
      name: "mcp",
      kind: "mcp",
      telemetry: {
        category: "mcp",
        tags: ["runtime:managed"],
      },
    };

    expect(createToolTelemetryTags(descriptor)).toEqual(
      expect.arrayContaining(["runtime:managed", "tool:mcp", "kind:mcp"]),
    );

    expect(
      createToolTelemetryRecord({
        descriptor,
        status: "completed",
        durationMs: 125,
        sessionId: "sess-2",
        metadata: { server: "filesystem" },
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "tool-execution",
        sessionId: "sess-2",
        category: "mcp",
        status: "completed",
        durationMs: 125,
        toolName: "mcp",
        metadata: { server: "filesystem" },
      }),
    );
  });
});
