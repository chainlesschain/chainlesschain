import { describe, expect, it } from "vitest";
import { filterInheritedMcp } from "../../src/lib/subagent-inheritance.js";
import {
  applyToolSearchDeferral,
  executeToolSearch,
  gateDeferredMcpCall,
  projectMcpToolDefinitions,
} from "../../src/runtime/mcp-tool-search.js";

const weather = "mcp__weather__get";
const privateTool = "mcp__private__lookup";

function parentCatalog(catalogMode = "compact") {
  const parent = {
    mcpClient: {},
    extraToolDefinitions: [],
    externalToolDescriptors: {},
    externalToolExecutors: {},
    instructionsByServer: {
      weather: "Use city names.",
      private: "Private server instructions.",
    },
  };
  for (const server of ["weather", "private"]) {
    const tool = server === "weather" ? "get" : "lookup";
    const name = `mcp__${server}__${tool}`;
    parent.extraToolDefinitions.push({
      type: "function",
      function: {
        name,
        description: `Query ${server}`,
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    });
    parent.externalToolDescriptors[name] = { kind: "mcp", serverName: server };
    parent.externalToolExecutors[name] = {
      kind: "mcp",
      serverName: server,
      toolName: tool,
    };
  }
  applyToolSearchDeferral(parent, { catalogMode });
  parent.toolSearchRegistry.maxResults = 3;
  return parent;
}

function registryOf(child) {
  return child.externalToolExecutors.tool_search?.registry;
}

function visibleNames(child) {
  return projectMcpToolDefinitions(
    child.extraToolDefinitions,
    child.externalToolExecutors,
  ).map((definition) => definition.function.name);
}

describe("subagent MCP discovery inheritance", () => {
  it.each(["compact", "stubs"])(
    "retains discovery for a named server with a scoped %s registry",
    (mode) => {
      const parent = parentCatalog(mode);
      const child = filterInheritedMcp(parent, ["weather"]);
      const registry = registryOf(child);
      expect(registry).toBeDefined();
      expect(registry).not.toBe(parent.toolSearchRegistry);
      expect([...registry.deferred.keys()]).toEqual([weather]);
      expect(registry.instructionsByServer).toEqual({
        weather: "Use city names.",
      });
      expect(registry.maxResults).toBe(3);
      const result = executeToolSearch(registry, {
        query: `select:${weather},${privateTool}`,
      });
      expect(result.tools.map((tool) => tool.name)).toEqual([weather]);
      expect(result.notFound).toEqual([privateTool]);
      expect(result.tools[0].serverInstructions).toBe("Use city names.");
      expect(
        gateDeferredMcpCall(weather, child.externalToolExecutors[weather]),
      ).toBeNull();
      expect(parent.toolSearchRegistry.loaded.size).toBe(0);
    },
  );

  it("keeps compact projection and discovery separate from parent and siblings", () => {
    const parent = parentCatalog();
    const child = filterInheritedMcp(parent, null);
    const sibling = filterInheritedMcp(parent, null);
    expect(visibleNames(child)).toEqual(["tool_search"]);
    executeToolSearch(registryOf(child), { query: `select:${weather}` });
    expect(visibleNames(child)).toEqual(["tool_search", weather]);
    expect(visibleNames(parent)).toEqual(["tool_search"]);
    expect(visibleNames(sibling)).toEqual(["tool_search"]);
    expect(child.externalToolExecutors[weather]).not.toBe(
      parent.externalToolExecutors[weather],
    );
  });

  it("copies already discovered schemas without sharing subsequent discoveries", () => {
    const parent = parentCatalog();
    executeToolSearch(parent.toolSearchRegistry, {
      query: `select:${weather}`,
    });
    const child = filterInheritedMcp(parent, null);
    expect(visibleNames(child)).toEqual(["tool_search", weather]);
    executeToolSearch(parent.toolSearchRegistry, {
      query: `select:${privateTool}`,
    });
    expect(visibleNames(child)).toEqual(["tool_search", weather]);
    const result = executeToolSearch(registryOf(child), {
      query: `select:${weather}`,
    });
    result.tools[0].parameters.required.push("child-only");
    expect(
      parent.toolSearchRegistry.deferred.get(weather).definition.function
        .parameters.required,
    ).toEqual(["city"]);
  });

  it.each(["executor", "descriptor"])(
    "does not expose %s non-inheritable schemas or instructions",
    (kind) => {
      const parent = parentCatalog();
      const map =
        kind === "executor"
          ? parent.externalToolExecutors
          : parent.externalToolDescriptors;
      map[weather].inheritable = false;
      const child = filterInheritedMcp(parent, null);
      const registry = registryOf(child);
      expect([...registry.deferred.keys()]).toEqual([privateTool]);
      expect(registry.instructionsByServer).not.toHaveProperty("weather");
      expect(
        executeToolSearch(registry, { query: "servers:" }).servers.map(
          (server) => server.name,
        ),
      ).toEqual(["private"]);
    },
  );

  it("does not grant search when it is explicitly non-inheritable", () => {
    const parent = parentCatalog();
    parent.externalToolExecutors.tool_search.inheritable = false;
    const child = filterInheritedMcp(parent, null);
    expect(child.externalToolExecutors.tool_search).toBeUndefined();
    gateDeferredMcpCall(weather, child.externalToolExecutors[weather]);
    expect(parent.toolSearchRegistry.loaded.size).toBe(0);
  });

  it.each(["remove", "replace", "revoke"])(
    "invalidates inherited discovery after parent %s",
    (change) => {
      const parent = parentCatalog();
      const child = filterInheritedMcp(parent, ["weather"]);
      const grandchild = filterInheritedMcp(child, null);
      executeToolSearch(registryOf(child), { query: `select:${weather}` });
      if (change === "remove") {
        parent.extraToolDefinitions = parent.extraToolDefinitions.filter(
          (def) => def.function.name !== weather,
        );
        delete parent.externalToolExecutors[weather];
        applyToolSearchDeferral(parent);
      } else if (change === "replace") {
        parent.externalToolExecutors[weather] = {
          kind: "mcp",
          serverName: "weather",
          toolName: "get",
        };
        applyToolSearchDeferral(parent);
      } else {
        parent.externalToolDescriptors[weather].inheritable = false;
      }
      for (const scoped of [child, grandchild]) {
        expect(
          executeToolSearch(registryOf(scoped), { query: `select:${weather}` })
            .count,
        ).toBe(0);
        expect(visibleNames(scoped)).toEqual(["tool_search"]);
        expect(
          gateDeferredMcpCall(weather, scoped.externalToolExecutors[weather]),
        ).toMatchObject({ code: "CC_MCP_TOOL_CATALOG_STALE" });
      }
    },
  );

  it("preserves the default no-inheritance and unmatched-server behavior", () => {
    const parent = parentCatalog();
    expect(filterInheritedMcp(parent, [])).toBeNull();
    expect(filterInheritedMcp(parent, ["absent"])).toBeNull();
    expect(filterInheritedMcp(null, null)).toBeNull();
    expect(filterInheritedMcp({ extraToolDefinitions: {} }, null)).toBeNull();
  });
});
