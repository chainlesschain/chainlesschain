/**
 * MCP tool search (context scaling, gap-analysis 第二阶段) — unit tests.
 *
 *   1. resolveToolSearchConfig — defaults / settings layer / env override /
 *      invalid values fail-to-defaults.
 *   2. matchesAlwaysLoad — server name, full name, glob.
 *   3. applyToolSearchDeferral — in-place stub rewrite, deterministic order,
 *      registry wiring, alwaysLoad pins, re-entrant (late server) appends.
 *   4. maybeApplyToolSearch — off/auto-below-threshold leave the wiring object
 *      BYTE-IDENTICAL; auto-above / forced apply.
 *   5. searchDeferredTools / executeToolSearch — select: + keyword semantics,
 *      loaded marking, schema delivery, server instructions.
 *   6. gateDeferredMcpCall — self-healing unloaded-call gate.
 *   7. describeMcpToolContext — /context accounting + advice.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  TOOL_SEARCH_TOOL_NAME,
  TOOL_SEARCH_DEFAULTS,
  resolveToolSearchConfig,
  estimateToolDefTokens,
  matchesAlwaysLoad,
  buildToolSearchDefinition,
  applyToolSearchDeferral,
  maybeApplyToolSearch,
  searchDeferredTools,
  executeToolSearch,
  gateDeferredMcpCall,
  describeMcpToolContext,
} from "../../src/runtime/mcp-tool-search.js";

// ─── fixtures ───────────────────────────────────────────────────────────────

function bigSchema(n = 40) {
  const properties = {};
  for (let i = 0; i < n; i++) {
    properties[`field_${i}`] = {
      type: "string",
      description: `A generously documented field number ${i} that pads the schema out.`,
    };
  }
  return { type: "object", properties, required: ["field_0"] };
}

function mcpDef(server, tool, { desc, schema } = {}) {
  return {
    type: "function",
    function: {
      name: `mcp__${server}__${tool}`,
      description: desc || `Tool ${tool} on ${server}.\nSecond line detail.`,
      parameters: schema || bigSchema(),
    },
  };
}

/** Build a resolveAgentMcp-shaped wiring object. */
function fakeMcp(defs, { instructionsByServer } = {}) {
  const externalToolExecutors = {};
  const externalToolDescriptors = {};
  for (const d of defs) {
    const name = d.function.name;
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
    externalToolExecutors[name] = {
      kind: "mcp",
      serverName: m ? m[1] : "srv",
      toolName: m ? m[2] : name,
    };
    externalToolDescriptors[name] = {
      name,
      kind: "mcp",
      category: "mcp",
      source: m ? m[1] : "srv",
    };
  }
  return {
    mcpClient: {},
    extraToolDefinitions: [...defs],
    externalToolExecutors,
    externalToolDescriptors,
    connected: [],
    resources: [],
    prompts: [],
    instructionsByServer: instructionsByServer || {},
  };
}

const ENV_OFF = { CC_TOOL_SEARCH: "" };

// ─── config ─────────────────────────────────────────────────────────────────

describe("resolveToolSearchConfig", () => {
  it("defaults to auto with 10% threshold", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ts-"));
    const cfg = resolveToolSearchConfig({ env: ENV_OFF, cwd });
    expect(cfg.enabled).toBe("auto");
    expect(cfg.thresholdRatio).toBe(TOOL_SEARCH_DEFAULTS.thresholdRatio);
    expect(cfg.maxResults).toBe(TOOL_SEARCH_DEFAULTS.maxResults);
    expect(cfg.alwaysLoad).toEqual([]);
  });

  it("reads settings mcp.toolSearch (explicit file = closest layer)", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ts-"));
    const file = path.join(cwd, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcp: {
          toolSearch: {
            enabled: true,
            thresholdRatio: 0.25,
            maxResults: 9,
            alwaysLoad: ["ide", "mcp__big__*"],
          },
        },
      }),
      "utf-8",
    );
    const cfg = resolveToolSearchConfig({
      env: ENV_OFF,
      cwd,
      settingsFile: file,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.thresholdRatio).toBe(0.25);
    expect(cfg.maxResults).toBe(9);
    expect(cfg.alwaysLoad).toEqual(["ide", "mcp__big__*"]);
  });

  it("ignores invalid values (fail-to-defaults)", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ts-"));
    const file = path.join(cwd, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcp: {
          toolSearch: {
            enabled: "sometimes",
            thresholdRatio: 5,
            maxResults: -2,
            alwaysLoad: [42, "", "ok"],
          },
        },
      }),
      "utf-8",
    );
    const cfg = resolveToolSearchConfig({
      env: ENV_OFF,
      cwd,
      settingsFile: file,
    });
    expect(cfg.enabled).toBe("auto");
    expect(cfg.thresholdRatio).toBe(0.1);
    expect(cfg.maxResults).toBe(5);
    expect(cfg.alwaysLoad).toEqual(["ok"]);
  });

  it("CC_TOOL_SEARCH env overrides settings", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ts-"));
    const file = path.join(cwd, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ mcp: { toolSearch: { enabled: true } } }),
      "utf-8",
    );
    expect(
      resolveToolSearchConfig({
        env: { CC_TOOL_SEARCH: "0" },
        cwd,
        settingsFile: file,
      }).enabled,
    ).toBe(false);
    expect(
      resolveToolSearchConfig({ env: { CC_TOOL_SEARCH: "1" }, cwd }).enabled,
    ).toBe(true);
    expect(
      resolveToolSearchConfig({ env: { CC_TOOL_SEARCH: "auto" }, cwd }).enabled,
    ).toBe("auto");
  });
});

// ─── alwaysLoad ─────────────────────────────────────────────────────────────

describe("matchesAlwaysLoad", () => {
  it("matches server name, full tool name, and glob", () => {
    expect(matchesAlwaysLoad("mcp__ide__openDiff", "ide", ["ide"])).toBe(true);
    expect(matchesAlwaysLoad("mcp__w__get", "w", ["mcp__w__get"])).toBe(true);
    expect(matchesAlwaysLoad("mcp__w__get", "w", ["mcp__w__*"])).toBe(true);
    expect(matchesAlwaysLoad("mcp__w__get", "w", ["mcp__x__*"])).toBe(false);
    expect(matchesAlwaysLoad("mcp__w__get", "w", [])).toBe(false);
    expect(matchesAlwaysLoad("mcp__w__get", "w", ["*__get"])).toBe(true);
  });

  it("does not over-match: glob is anchored", () => {
    expect(matchesAlwaysLoad("mcp__w__getMore", "w", ["mcp__w__get"])).toBe(
      false,
    );
  });
});

// ─── deferral transform ─────────────────────────────────────────────────────

describe("applyToolSearchDeferral", () => {
  it("replaces MCP defs with stubs, sorted, tool_search appended last", () => {
    const mcp = fakeMcp([
      mcpDef("zeta", "b"),
      mcpDef("alpha", "a"),
      mcpDef("zeta", "a"),
    ]);
    const res = applyToolSearchDeferral(mcp, {});
    expect(res.deferredCount).toBe(3);
    expect(res.savedTokens).toBeGreaterThan(0);

    const names = mcp.extraToolDefinitions.map((d) => d.function.name);
    expect(names).toEqual([
      "mcp__alpha__a",
      "mcp__zeta__a",
      "mcp__zeta__b",
      TOOL_SEARCH_TOOL_NAME,
    ]);
    // stubs: [deferred] prefix + tiny schema, first line only
    const stub = mcp.extraToolDefinitions[0];
    expect(stub.function.description).toMatch(
      /^\[deferred\] Tool a on alpha\./,
    );
    expect(stub.function.description).not.toMatch(/Second line/);
    expect(stub.function.parameters.properties).toEqual({});
    // executors marked + registry attached
    const exec = mcp.externalToolExecutors.mcp__alpha__a;
    expect(exec.deferred).toBe(true);
    expect(exec.registry).toBe(mcp.toolSearchRegistry);
    // registry holds the FULL definition
    expect(
      mcp.toolSearchRegistry.deferred.get("mcp__alpha__a").definition.function
        .parameters.required,
    ).toEqual(["field_0"]);
    // tool_search executor + descriptor registered
    expect(mcp.externalToolExecutors[TOOL_SEARCH_TOOL_NAME].kind).toBe(
      "tool-search",
    );
    expect(mcp.externalToolDescriptors[TOOL_SEARCH_TOOL_NAME].kind).toBe(
      "tool-search",
    );
  });

  it("alwaysLoad pins keep their full definition and position", () => {
    const mcp = fakeMcp([mcpDef("ide", "openDiff"), mcpDef("big", "x")]);
    applyToolSearchDeferral(mcp, { alwaysLoad: ["ide"] });
    const first = mcp.extraToolDefinitions[0];
    expect(first.function.name).toBe("mcp__ide__openDiff");
    expect(first.function.description).not.toMatch(/\[deferred\]/);
    expect(
      mcp.externalToolExecutors.mcp__ide__openDiff.deferred,
    ).toBeUndefined();
    expect(mcp.toolSearchRegistry.deferred.has("mcp__ide__openDiff")).toBe(
      false,
    );
    expect(mcp.toolSearchRegistry.deferred.has("mcp__big__x")).toBe(true);
  });

  it("leaves non-mcp executors (mcp-resource generic tools) untouched", () => {
    const mcp = fakeMcp([mcpDef("w", "get")]);
    mcp.extraToolDefinitions.push({
      type: "function",
      function: {
        name: "read_mcp_resource",
        description: "generic",
        parameters: { type: "object", properties: { uri: { type: "string" } } },
      },
    });
    mcp.externalToolExecutors.read_mcp_resource = {
      kind: "mcp-resource",
      op: "read",
    };
    applyToolSearchDeferral(mcp, {});
    const generic = mcp.extraToolDefinitions.find(
      (d) => d.function.name === "read_mcp_resource",
    );
    expect(generic.function.description).toBe("generic");
    expect(generic.function.parameters.properties.uri).toBeDefined();
  });

  it("re-entrant call (late-connected server) appends new stubs at the END", () => {
    const mcp = fakeMcp([mcpDef("w", "get")]);
    applyToolSearchDeferral(mcp, {});
    const before = mcp.extraToolDefinitions.map((d) => d.function.name);

    // late server connects: setupMcpFromConfig pushes a full def + executor
    const late = mcpDef("late", "aaa_first_alphabetically");
    mcp.extraToolDefinitions.push(late);
    mcp.externalToolExecutors[late.function.name] = {
      kind: "mcp",
      serverName: "late",
      toolName: "aaa_first_alphabetically",
    };
    const res2 = applyToolSearchDeferral(mcp, {});
    expect(res2.deferredCount).toBe(1);

    const after = mcp.extraToolDefinitions.map((d) => d.function.name);
    // the prefix the cache already saw is unchanged; new stub strictly appended
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe("mcp__late__aaa_first_alphabetically");
    const lateDef = mcp.extraToolDefinitions.at(-1);
    expect(lateDef.function.description).toMatch(/^\[deferred\]/);
    // only ONE tool_search definition ever
    expect(after.filter((n) => n === TOOL_SEARCH_TOOL_NAME)).toHaveLength(1);
  });

  it("returns null when there is nothing deferrable", () => {
    const mcp = fakeMcp([]);
    expect(applyToolSearchDeferral(mcp, {})).toBeNull();
    expect(mcp.toolSearchRegistry).toBeUndefined();
  });
});

// ─── decision wrapper ───────────────────────────────────────────────────────

describe("maybeApplyToolSearch", () => {
  it("enabled=false leaves the wiring object byte-identical", () => {
    const mcp = fakeMcp([mcpDef("w", "get")]);
    const snapshot = JSON.stringify(mcp.extraToolDefinitions);
    const out = maybeApplyToolSearch(mcp, {
      config: {
        enabled: false,
        thresholdRatio: 0.1,
        maxResults: 5,
        alwaysLoad: [],
      },
    });
    expect(out).toBeNull();
    expect(JSON.stringify(mcp.extraToolDefinitions)).toBe(snapshot);
    expect(mcp.externalToolExecutors.mcp__w__get.deferred).toBeUndefined();
    expect(mcp.toolSearchRegistry).toBeUndefined();
  });

  it("auto mode below threshold is a no-op (byte-identical)", () => {
    const mcp = fakeMcp([mcpDef("w", "get", { schema: { type: "object" } })]);
    const snapshot = JSON.stringify(mcp.extraToolDefinitions);
    const out = maybeApplyToolSearch(mcp, {
      model: "qwen2.5:7b", // 32768 window → tiny schema is way below 10%
      provider: "ollama",
      config: {
        enabled: "auto",
        thresholdRatio: 0.1,
        maxResults: 5,
        alwaysLoad: [],
      },
    });
    expect(out).toBeNull();
    expect(JSON.stringify(mcp.extraToolDefinitions)).toBe(snapshot);
  });

  it("auto mode defers when schemas exceed thresholdRatio × window", () => {
    // 30 fat tools ≈ well above 1% of a 32k window with ratio 0.01
    const defs = [];
    for (let i = 0; i < 30; i++) defs.push(mcpDef("big", `tool_${i}`));
    const mcp = fakeMcp(defs);
    const out = maybeApplyToolSearch(mcp, {
      model: "qwen2.5:7b",
      provider: "ollama",
      config: {
        enabled: "auto",
        thresholdRatio: 0.01,
        maxResults: 5,
        alwaysLoad: [],
      },
    });
    expect(out).not.toBeNull();
    expect(out.deferredCount).toBe(30);
    expect(mcp.toolSearchRegistry.deferred.size).toBe(30);
  });

  it("enabled=true forces deferral regardless of size and reports via writeErr", () => {
    const mcp = fakeMcp([mcpDef("w", "get")]);
    const lines = [];
    const out = maybeApplyToolSearch(mcp, {
      config: {
        enabled: true,
        thresholdRatio: 0.1,
        maxResults: 7,
        alwaysLoad: [],
      },
      writeErr: (s) => lines.push(s),
    });
    expect(out.deferredCount).toBe(1);
    expect(mcp.toolSearchRegistry.maxResults).toBe(7);
    expect(lines.join("")).toMatch(/tool search active — 1 schema/);
  });

  it("returns null on empty / missing wiring", () => {
    expect(maybeApplyToolSearch(null)).toBeNull();
    expect(maybeApplyToolSearch({ extraToolDefinitions: [] }, {})).toBeNull();
  });
});

// ─── search ─────────────────────────────────────────────────────────────────

function deferredMcp() {
  const mcp = fakeMcp(
    [
      mcpDef("github", "create_issue", {
        desc: "Create a new GitHub issue in a repository",
      }),
      mcpDef("github", "list_issues", {
        desc: "List issues for a repository",
      }),
      mcpDef("slack", "send_message", {
        desc: "Send a message to a Slack channel",
      }),
    ],
    { instructionsByServer: { slack: "Prefer channel IDs over names." } },
  );
  applyToolSearchDeferral(mcp, {});
  return mcp;
}

describe("searchDeferredTools", () => {
  it("select: exact full names, comma separated", () => {
    const mcp = deferredMcp();
    const { mode, results, notFound } = searchDeferredTools(
      mcp.toolSearchRegistry,
      "select:mcp__github__create_issue, mcp__slack__send_message",
    );
    expect(mode).toBe("select");
    expect(results.map((r) => r.name)).toEqual([
      "mcp__github__create_issue",
      "mcp__slack__send_message",
    ]);
    expect(notFound).toEqual([]);
  });

  it("select: accepts a unique bare tool name, reports ambiguous/missing", () => {
    const mcp = deferredMcp();
    const r1 = searchDeferredTools(
      mcp.toolSearchRegistry,
      "select:send_message",
    );
    expect(r1.results.map((x) => x.name)).toEqual(["mcp__slack__send_message"]);
    const r2 = searchDeferredTools(mcp.toolSearchRegistry, "select:nope");
    expect(r2.results).toEqual([]);
    expect(r2.notFound).toEqual(["nope"]);
  });

  it("keyword search ranks name hits above description hits", () => {
    const mcp = deferredMcp();
    const { results } = searchDeferredTools(
      mcp.toolSearchRegistry,
      "issue repository",
    );
    // both github tools match "issue" in name (×3) + "repository" in desc;
    // slack matches neither
    expect(results.map((r) => r.name)).toEqual([
      "mcp__github__create_issue",
      "mcp__github__list_issues",
    ]);
  });

  it("+term must appear in the tool name", () => {
    const mcp = deferredMcp();
    const { results } = searchDeferredTools(
      mcp.toolSearchRegistry,
      "+slack message",
    );
    expect(results.map((r) => r.name)).toEqual(["mcp__slack__send_message"]);
  });

  it("caps results at maxResults", () => {
    const mcp = deferredMcp();
    const { results } = searchDeferredTools(mcp.toolSearchRegistry, "issue", {
      maxResults: 1,
    });
    expect(results).toHaveLength(1);
  });
});

describe("executeToolSearch", () => {
  it("returns full schemas, marks tools loaded, carries server instructions", () => {
    const mcp = deferredMcp();
    const reg = mcp.toolSearchRegistry;
    const out = executeToolSearch(reg, {
      query: "select:mcp__slack__send_message",
    });
    expect(out.count).toBe(1);
    expect(out.tools[0].parameters.required).toEqual(["field_0"]);
    expect(out.tools[0].serverInstructions).toBe(
      "Prefer channel IDs over names.",
    );
    expect(reg.loaded.has("mcp__slack__send_message")).toBe(true);
    expect(out.note).toMatch(/call these tools directly/i);
  });

  it("empty query → actionable error; no match → note + available list", () => {
    const mcp = deferredMcp();
    expect(executeToolSearch(mcp.toolSearchRegistry, {}).error).toMatch(
      /requires a "query"/,
    );
    const none = executeToolSearch(mcp.toolSearchRegistry, {
      query: "zzz_no_such_thing",
    });
    expect(none.count).toBe(0);
    expect(none.available).toContain("mcp__github__create_issue");
  });
});

// ─── direct-call gate ───────────────────────────────────────────────────────

describe("gateDeferredMcpCall", () => {
  it("first unloaded call returns schema-embedding error and marks loaded", () => {
    const mcp = deferredMcp();
    const exec = mcp.externalToolExecutors.mcp__github__create_issue;
    const gate = gateDeferredMcpCall("mcp__github__create_issue", exec);
    expect(gate.error).toMatch(/deferred MCP tool/);
    expect(gate.schema.required).toEqual(["field_0"]);
    // second call passes (self-healed)
    expect(gateDeferredMcpCall("mcp__github__create_issue", exec)).toBeNull();
  });

  it("no-op for tools loaded via tool_search and for non-deferred executors", () => {
    const mcp = deferredMcp();
    executeToolSearch(mcp.toolSearchRegistry, {
      query: "select:mcp__slack__send_message",
    });
    expect(
      gateDeferredMcpCall(
        "mcp__slack__send_message",
        mcp.externalToolExecutors.mcp__slack__send_message,
      ),
    ).toBeNull();
    expect(
      gateDeferredMcpCall("anything", { kind: "mcp", serverName: "x" }),
    ).toBeNull();
  });
});

// ─── /context accounting ────────────────────────────────────────────────────

describe("describeMcpToolContext", () => {
  const noopConfig = {
    enabled: "auto",
    thresholdRatio: 0.1,
    maxResults: 5,
    alwaysLoad: [],
  };

  it("reports per-server rows and advises enabling tool search when big", () => {
    const defs = [];
    for (let i = 0; i < 40; i++) defs.push(mcpDef("big", `t${i}`));
    defs.push(mcpDef("small", "one", { schema: { type: "object" } }));
    const mcp = fakeMcp(defs);
    const info = describeMcpToolContext(mcp, {
      model: "qwen2.5:7b",
      provider: "ollama",
      config: noopConfig,
    });
    expect(info.toolSearch.active).toBe(false);
    expect(info.servers[0].server).toBe("big");
    expect(info.servers[0].tools).toBe(40);
    expect(info.sentTokens).toBe(info.fullTokens);
    expect(info.advice.join(" ")).toMatch(/enable tool search/i);
  });

  it("reports savings + loaded counts when deferral is active", () => {
    const defs = [];
    for (let i = 0; i < 10; i++) defs.push(mcpDef("big", `t${i}`));
    const mcp = fakeMcp(defs);
    applyToolSearchDeferral(mcp, {});
    executeToolSearch(mcp.toolSearchRegistry, { query: "select:mcp__big__t0" });
    const info = describeMcpToolContext(mcp, {
      model: "qwen2.5:7b",
      provider: "ollama",
      config: noopConfig,
    });
    expect(info.toolSearch.active).toBe(true);
    expect(info.toolSearch.deferredCount).toBe(10);
    expect(info.toolSearch.loadedCount).toBe(1);
    expect(info.savedTokens).toBeGreaterThan(0);
    expect(info.fullTokens).toBeGreaterThan(info.sentTokens);
    expect(info.advice.join(" ")).toMatch(/saving/i);
  });

  it("returns null when there are no MCP tools", () => {
    expect(
      describeMcpToolContext(fakeMcp([]), { config: noopConfig }),
    ).toBeNull();
    expect(describeMcpToolContext(null)).toBeNull();
  });
});

// ─── misc ───────────────────────────────────────────────────────────────────

describe("buildToolSearchDefinition / estimateToolDefTokens", () => {
  it("tool_search definition is well-formed", () => {
    const def = buildToolSearchDefinition();
    expect(def.function.name).toBe(TOOL_SEARCH_TOOL_NAME);
    expect(def.function.parameters.required).toEqual(["query"]);
  });

  it("estimateToolDefTokens is positive for a real def and 0 for garbage", () => {
    expect(estimateToolDefTokens(mcpDef("w", "get"))).toBeGreaterThan(50);
    const cyclic = {};
    cyclic.self = cyclic;
    expect(estimateToolDefTokens(cyclic)).toBe(0);
  });
});
