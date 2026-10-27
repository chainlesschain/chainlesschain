import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatWithTools,
  agentLoop,
  runAgentHeadless,
  _environmentProcessDeps,
} from "../helpers/test-model-egress.js";
import {
  applyToolSearchDeferral,
  buildToolSearchDefinition,
  describeMcpToolContext,
  executeToolSearch,
  gateDeferredMcpCall,
  projectMcpToolDefinitions,
  resolveToolSearchConfig,
  TOOL_SEARCH_DEFAULTS,
} from "../../src/runtime/mcp-tool-search.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";

vi.mock("../../src/lib/context-memory-kernel/provider-context.js", () => ({
  prepareCanonicalProviderContext: vi.fn(async (messages) => ({
    messages,
    plan: null,
  })),
}));
vi.mock("../../src/lib/cli-anything-bridge.js", async (original) => ({
  ...(await original()),
  detectPython: () => ({ found: false }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wiring(
  specs = [
    ["alpha", "read"],
    ["beta", "write"],
  ],
) {
  const externalToolExecutors = {},
    externalToolDescriptors = {};
  const extraToolDefinitions = specs.map(([serverName, toolName]) => {
    const name = `mcp__${serverName}__${toolName}`;
    externalToolExecutors[name] = { kind: "mcp", serverName, toolName };
    externalToolDescriptors[name] = { name, kind: "mcp", source: serverName };
    return {
      type: "function",
      function: {
        name,
        description: `Read or write a fixture on ${serverName}.`,
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    };
  });
  return {
    extraToolDefinitions,
    externalToolExecutors,
    externalToolDescriptors,
  };
}
const names = (definitions) => definitions.map((def) => def.function.name);
const project = (mcp) =>
  projectMcpToolDefinitions(
    mcp.extraToolDefinitions,
    mcp.externalToolExecutors,
  );

describe("compact MCP provider catalog", () => {
  it("is opt-in and leaves the host definitions intact while exposing selected schemas", () => {
    expect(TOOL_SEARCH_DEFAULTS.catalogMode).toBe("stubs");
    expect(
      resolveToolSearchConfig({ env: { CC_TOOL_SEARCH_CATALOG: "compact" } })
        .catalogMode,
    ).toBe("compact");
    expect(
      resolveToolSearchConfig({ env: { CC_TOOL_SEARCH_CATALOG: "stubs" } })
        .catalogMode,
    ).toBe("stubs");
    const legacy = wiring();
    applyToolSearchDeferral(legacy);
    expect(project(legacy)).toBe(legacy.extraToolDefinitions);
    expect(
      buildToolSearchDefinition().function.parameters.properties,
    ).not.toHaveProperty("offset");
    const mcp = wiring();
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
    });
    const hostBefore = JSON.stringify(mcp.extraToolDefinitions);
    const initial = project(mcp);
    expect(names(initial)).toEqual(["tool_search"]);
    expect(initial[0].function.parameters.properties).toHaveProperty("offset");
    expect(
      executeToolSearch(registry, { query: "select:mcp__beta__write" }).count,
    ).toBe(1);
    expect(names(project(mcp))).toEqual(["tool_search", "mcp__beta__write"]);
    executeToolSearch(registry, { query: "select:mcp__alpha__read" });
    expect(names(project(mcp))).toEqual([
      "tool_search",
      "mcp__beta__write",
      "mcp__alpha__read",
    ]);
    expect(project(mcp)[1].function.parameters.required).toEqual(["path"]);
    expect(names(initial)).toEqual(["tool_search"]);
    expect(JSON.stringify(mcp.extraToolDefinitions)).toBe(hostBefore);
  });

  it("retains pins, direct-call schema recovery and an explicit ceiling without discovery", () => {
    const mcp = wiring();
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
      alwaysLoad: ["alpha"],
    });
    expect(names(project(mcp))).toEqual(["mcp__alpha__read", "tool_search"]);
    const gate = gateDeferredMcpCall(
      "mcp__beta__write",
      mcp.externalToolExecutors.mcp__beta__write,
    );
    expect(gate.schema.required).toEqual(["path"]);
    expect(names(project(mcp))).toContain("mcp__beta__write");
    expect(registry.loaded.has("mcp__beta__write")).toBe(true);
    const withoutSearch = mcp.extraToolDefinitions.filter(
      (def) => def.function.name !== "tool_search",
    );
    expect(
      projectMcpToolDefinitions(withoutSearch, mcp.externalToolExecutors),
    ).toBe(withoutSearch);
  });

  it("filters both provider exposure and discovery by the admitted tool names", () => {
    const mcp = wiring();
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
    });
    executeToolSearch(registry, { query: "select:mcp__beta__write" });
    const allowedToolNames = ["tool_search", "mcp__alpha__read"];
    const subset = mcp.extraToolDefinitions.filter((def) =>
      allowedToolNames.includes(def.function.name),
    );
    expect(
      names(projectMcpToolDefinitions(subset, mcp.externalToolExecutors)),
    ).toEqual(["tool_search"]);
    expect(
      executeToolSearch(
        registry,
        { query: "select:mcp__beta__write" },
        { allowedToolNames },
      ).count,
    ).toBe(0);
    expect(
      executeToolSearch(registry, { query: "servers:" }, { allowedToolNames })
        .servers,
    ).toEqual([{ name: "alpha", toolCount: 1 }]);
    expect(
      executeToolSearch(
        registry,
        { query: "servers:" },
        { allowedToolNames: [] },
      ).servers,
    ).toEqual([]);
  });

  it("paginates a live server directory without loading schemas or dumping tool names", () => {
    const mcp = wiring(
      Array.from({ length: 70 }, (_, i) => [
        `server_${String(i).padStart(2, "0")}`,
        "read",
      ]),
    );
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
    });
    const first = executeToolSearch(registry, {
      query: "servers:",
      max_results: 500,
    });
    expect(first.servers).toHaveLength(50);
    expect(first.nextOffset).toBe(50);
    const second = executeToolSearch(registry, {
      query: "servers:",
      offset: first.nextOffset,
      max_results: 50,
    });
    expect(second.servers).toHaveLength(20);
    expect(second.nextOffset).toBeNull();
    expect(registry.loaded.size).toBe(0);
    expect(
      executeToolSearch(registry, { query: "servers:", offset: -1 }).error,
    ).toBeTruthy();
    expect(
      executeToolSearch(registry, { query: "unknown-future-tool" }),
    ).not.toHaveProperty("available");
  });

  it("hides replaced and revoked schemas until fresh discovery", () => {
    const mcp = wiring();
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
    });
    executeToolSearch(registry, { query: "select:mcp__alpha__read" });
    const prior = mcp.externalToolExecutors.mcp__alpha__read;
    mcp.externalToolExecutors.mcp__alpha__read = {
      kind: "mcp",
      serverName: "alpha",
      toolName: "read",
    };
    applyToolSearchDeferral(mcp);
    expect(names(project(mcp))).not.toContain("mcp__alpha__read");
    expect(gateDeferredMcpCall("mcp__alpha__read", prior).code).toBe(
      "CC_MCP_TOOL_CATALOG_STALE",
    );
    expect(executeToolSearch(registry, { query: "servers:" }).servers).toEqual([
      { name: "beta", toolCount: 1 },
    ]);
    registry.deferred.delete("mcp__beta__write");
    expect(names(project(mcp))).not.toContain("mcp__beta__write");
  });

  it("bounds directory labels while retaining an exact discovery example", () => {
    const mcp = wiring([["alpha", "read"]]);
    mcp.externalToolExecutors.mcp__alpha__read.serverName =
      "long-label-".repeat(2000);
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
    });
    const page = executeToolSearch(registry, { query: "servers:" });
    expect(page.servers[0]).toMatchObject({
      nameTruncated: true,
      exampleToolName: "mcp__alpha__read",
    });
    expect(page.servers[0].name.length).toBeLessThanOrEqual(192);
    expect(JSON.stringify(page).length).toBeLessThan(1024);
    expect(registry.loaded.size).toBe(0);
  });

  it("accounts for hidden schemas separately from the actual compact projection", () => {
    const mcp = wiring(
      Array.from({ length: 200 }, (_, i) => ["catalog", `read_${i}`]),
    );
    const { registry } = applyToolSearchDeferral(mcp, {
      catalogMode: "compact",
    });
    const initial = describeMcpToolContext(mcp, {
      config: TOOL_SEARCH_DEFAULTS,
    });
    expect(initial.toolSearch).toMatchObject({
      catalogMode: "compact",
      deferredCount: 200,
      visibleDeferredCount: 0,
    });
    expect(initial.sentTokens).toBeLessThan(initial.fullTokens);
    executeToolSearch(registry, { query: "select:mcp__catalog__read_0" });
    const loaded = describeMcpToolContext(mcp, {
      config: TOOL_SEARCH_DEFAULTS,
    });
    expect(loaded.sentTokens).toBeGreaterThan(initial.sentTokens);
    expect(loaded.toolSearch.visibleDeferredCount).toBe(1);
  });
});

const connection = (provider) => ({
  provider,
  apiKey: "test-only-key",
  model:
    provider === "anthropic"
      ? "claude-sonnet-5-5"
      : provider === "ollama"
        ? "qwen2.5:7b"
        : "gpt-4o",
  baseUrl:
    provider === "anthropic"
      ? "https://api.anthropic.com/v1"
      : provider === "ollama"
        ? "http://localhost:11434"
        : "https://api.openai.com/v1",
});
const reply = (provider, tool_calls) =>
  provider === "openai-responses"
    ? {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: "ok" }] },
        ],
        usage: { input_tokens: 10, output_tokens: 2 },
      }
    : provider === "anthropic"
      ? {
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 10, output_tokens: 2 },
        }
      : provider === "ollama"
        ? {
            message: { role: "assistant", content: "ok" },
            prompt_eval_count: 10,
            eval_count: 2,
          }
        : {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: tool_calls ? "" : "ok",
                  ...(tool_calls ? { tool_calls } : {}),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          };
const call = (id, name, args) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

describe("compact catalog at the model request boundary", () => {
  it("persists the projected schemas while retaining the full execution directory", async () => {
    vi.spyOn(_environmentProcessDeps, "run").mockReturnValue("");
    const mcp = wiring();
    const snapshots = [];
    const appendAuthorityEvent = vi.fn(() => true);
    const result = await runAgentHeadless(
      {
        prompt: "Inspect a fixture",
        outputFormat: "json",
        sessionId: "compact-source-fixture",
        persistSession: true,
        expandFileRefs: false,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => ({
          setSessionPolicy() {},
          setConfirmer() {},
          decide: async () => ({ decision: "allow" }),
        }),
        resolveAgentMcp: async () => mcp,
        maybeApplyToolSearch: (bundle) =>
          applyToolSearchDeferral(bundle, { catalogMode: "compact" }),
        writeOut() {},
        writeErr() {},
        sessionExists: () => false,
        startSession() {},
        appendUserMessage() {},
        appendAssistantMessage() {},
        appendTokenUsage() {},
        appendAuthorityEvent,
        appendEvent: (_session, type, data) => {
          if (type === "context_sources") snapshots.push(data);
          return true;
        },
        agentLoop: async function* (_messages, options) {
          expect(names(options.extraToolDefinitions)).toEqual([
            "mcp__alpha__read",
            "mcp__beta__write",
            "tool_search",
          ]);
          executeToolSearch(mcp.toolSearchRegistry, {
            query: "select:mcp__alpha__read",
          });
          yield { type: "response-complete", content: "ok" };
          yield { type: "run-ended", reason: "complete" };
        },
      },
    );
    expect(result.exitCode, result.result || result.persistence?.code).toBe(0);
    expect(appendAuthorityEvent).toHaveBeenCalled();
    expect(names(snapshots[0].mcp)).toEqual(["tool_search"]);
    expect(names(snapshots.at(-1).mcp)).toEqual([
      "tool_search",
      "mcp__alpha__read",
    ]);
  });

  it.each(["openai", "openai-responses", "anthropic", "ollama"])(
    "declares only discovered MCP schemas in the %s request",
    async (provider) => {
      const mcp = wiring();
      const { registry } = applyToolSearchDeferral(mcp, {
        catalogMode: "compact",
      });
      const bodies = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options) => {
          bodies.push(JSON.parse(options.body));
          return { ok: true, json: async () => reply(provider) };
        }),
      );
      const options = {
        ...connection(provider === "openai-responses" ? "openai" : provider),
        ...(provider === "openai-responses" ? { model: "gpt-6.1-sol" } : {}),
        ...mcp,
        contextMemorySkipPlanning: true,
      };
      await chatWithTools(
        [{ role: "user", content: "Inspect a fixture" }],
        options,
      );
      const sentNames = (body) =>
        body.tools.map((tool) => tool.name || tool.function.name);
      expect(sentNames(bodies[0])).toContain("tool_search");
      expect(
        sentNames(bodies[0]).filter((name) => name.startsWith("mcp__")),
      ).toEqual([]);
      executeToolSearch(registry, { query: "select:mcp__alpha__read" });
      await chatWithTools(
        [{ role: "user", content: "Inspect a fixture" }],
        options,
      );
      expect(
        sentNames(bodies[1]).filter((name) => name.startsWith("mcp__")),
      ).toEqual(["mcp__alpha__read"]);
      expect(sentNames(bodies[1])).not.toContain("mcp__beta__write");
    },
  );

  it.each([false, true])(
    "keeps execution admission after search (target disabled: %s)",
    async (disabled) => {
      const mcp = wiring();
      applyToolSearchDeferral(mcp, { catalogMode: "compact" });
      const bodies = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options) => {
          bodies.push(JSON.parse(options.body));
          const calls =
            bodies.length === 1
              ? [
                  call("search", "tool_search", {
                    query: "select:mcp__alpha__read",
                  }),
                ]
              : bodies.length === 2
                ? [call("read", "mcp__alpha__read", { path: "README.md" })]
                : undefined;
          return { ok: true, json: async () => reply("openai", calls) };
        }),
      );
      const callTool = vi.fn(async () => ({ content: "fixture content" }));
      const events = [];
      for await (const event of agentLoop(
        [{ role: "user", content: "Read a fixture" }],
        {
          ...connection("openai"),
          ...mcp,
          mcpClient: { callTool },
          maxIterations: 4,
          disabledTools: disabled ? ["mcp__alpha__read"] : [],
          permissionConfirm: async () => true,
        },
      ))
        events.push(event);
      expect(callTool).toHaveBeenCalledTimes(disabled ? 0 : 1);
      if (!disabled)
        expect(callTool.mock.calls[0].slice(0, 3)).toEqual([
          "alpha",
          "read",
          { path: "README.md" },
        ]);
      const projectedForPlanner = vi
        .mocked(prepareCanonicalProviderContext)
        .mock.calls.at(-1)[1].contextMemoryToolDefinitions;
      expect(names(projectedForPlanner).includes("mcp__alpha__read")).toBe(
        !disabled,
      );
      expect(names(projectedForPlanner)).not.toContain("mcp__beta__write");
      expect(
        events.some(
          (event) =>
            event.type === "tool-result" || event.type === "tool_result",
        ),
      ).toBe(true);
    },
  );
});
