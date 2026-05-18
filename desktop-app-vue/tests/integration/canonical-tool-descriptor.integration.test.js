/**
 * Integration test — Canonical Tool Descriptor propagation
 *
 * Covers the end-to-end flow:
 *   FunctionCaller.registerTool() →
 *   ToolMaskingSystem.registerTool() (canonical projection) →
 *   FunctionCaller.getAllToolDefinitions() →
 *   UnifiedToolRegistry._importFunctionCallerTools() →
 *   Registry.getAllTools() / getToolsForLLM()
 *
 * Verifies that every canonical field survives each hop intact, no ad-hoc
 * shapes leak through, and that clone-on-read boundaries hold across the
 * registry boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const FunctionCaller = require("../../src/main/ai-engine/function-caller.js");
const {
  UnifiedToolRegistry,
} = require("../../src/main/ai-engine/unified-tool-registry.js");

describe("Canonical Tool Descriptor — FC → Registry integration", () => {
  let fc;
  let registry;

  beforeEach(() => {
    fc = new FunctionCaller({ logMaskChanges: false });
    registry = new UnifiedToolRegistry();
  });

  afterEach(() => {
    // Defensive: clean up any in-process state leaks between tests
    fc = null;
    registry = null;
  });

  it("propagates all canonical fields end-to-end through the registry", async () => {
    // Register a tool with the full canonical metadata set
    const canonicalSchema = {
      description: "End-to-end canonical probe tool",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "search query" },
          limit: { type: "integer", minimum: 1 },
        },
        required: ["query"],
      },
      category: "search",
      kind: "builtin",
      source: "test-fixture",
      isReadOnly: true,
      riskLevel: "low",
      availableInPlanMode: true,
      requiresPlanApproval: false,
      requiresConfirmation: false,
      approvalFlow: "auto",
      permissions: { level: "readonly", scopes: ["search:read"] },
      telemetry: { tags: ["probe", "integration"] },
      skillName: "search-skill",
      skillCategory: "knowledge",
      instructions: "Use me to probe canonical field propagation.",
      examples: [{ input: { query: "foo" }, output: { results: [] } }],
      tags: ["canonical-probe"],
      title: "Canonical Probe",
    };

    fc.registerTool(
      "canonical_probe",
      async (params) => ({ ok: true, params }),
      canonicalSchema,
    );

    // --- Hop 1: FC.getAllToolDefinitions() must emit canonical fields
    const fcDefs = fc.getAllToolDefinitions();
    const fcProbe = fcDefs.find((t) => t.name === "canonical_probe");
    expect(fcProbe).toBeDefined();
    expect(fcProbe.inputSchema).toEqual(canonicalSchema.inputSchema);
    expect(fcProbe.parameters).toEqual(canonicalSchema.inputSchema);
    expect(fcProbe.riskLevel).toBe("low");
    expect(fcProbe.isReadOnly).toBe(true);
    expect(fcProbe.category).toBe("search");
    expect(fcProbe.availableInPlanMode).toBe(true);
    expect(fcProbe.requiresPlanApproval).toBe(false);
    expect(fcProbe.skillName).toBe("search-skill");
    expect(fcProbe.instructions).toBe(canonicalSchema.instructions);
    expect(fcProbe.examples).toEqual(canonicalSchema.examples);
    // Handler / internal state never leaks out of the masking system
    expect(fcProbe.handler).toBeUndefined();

    // --- Hop 2: Registry._importFunctionCallerTools absorbs canonical shape
    registry.bindFunctionCaller(fc);
    await registry.initialize();

    const all = registry.getAllTools();
    const reg = all.find((t) => t.name === "canonical_probe");
    expect(reg).toBeDefined();
    expect(reg.inputSchema).toEqual(canonicalSchema.inputSchema);
    expect(reg.parameters).toEqual(canonicalSchema.inputSchema);
    expect(reg.riskLevel).toBe("low");
    expect(reg.isReadOnly).toBe(true);
    expect(reg.category).toBe("search");
    expect(reg.availableInPlanMode).toBe(true);
    expect(reg.requiresPlanApproval).toBe(false);
    expect(reg.approvalFlow).toBe("auto");
    // permissions/telemetry clone forwarded
    expect(reg.permissions).toEqual(
      expect.objectContaining({ level: "readonly" }),
    );
    expect(reg.telemetry.tags).toEqual(expect.arrayContaining(["probe"]));
    // tags accumulated without losing the source tag
    expect(reg.tags).toEqual(
      expect.arrayContaining(["canonical-probe", "source:builtin"]),
    );

    // --- Hop 3: getToolsForLLM projects the same canonical schema
    const llmTools = registry.getToolsForLLM();
    const llmProbe = llmTools.find((t) => t.name === "canonical_probe");
    expect(llmProbe).toBeDefined();
    // LLM-facing shape must still reference canonical schema
    expect(
      llmProbe.inputSchema ||
        llmProbe.parameters ||
        llmProbe.function?.parameters,
    ).toEqual(canonicalSchema.inputSchema);
  });

  it("read-only canonical defaults are respected when fields are omitted", async () => {
    fc.registerTool("bare_reader", async () => ({ ok: true }), {
      description: "minimal",
      inputSchema: { type: "object" },
      isReadOnly: true,
    });

    registry.bindFunctionCaller(fc);
    await registry.initialize();

    const reg = registry.getAllTools().find((t) => t.name === "bare_reader");
    expect(reg).toBeDefined();
    // read-only tools default to `low` risk and `allow` plan-mode behavior
    expect(reg.isReadOnly).toBe(true);
    expect(reg.riskLevel).toBe("low");
    expect(reg.availableInPlanMode).toBe(true);
    expect(reg.planModeBehavior).toBe("allow");
    // category inferred to "read" when tool is read-only
    expect(reg.category).toBe("read");
  });

  it("mutating the registry clone does not corrupt subsequent reads", async () => {
    fc.registerTool("mutation_target", async () => ({ ok: true }), {
      description: "probe",
      inputSchema: {
        type: "object",
        properties: { x: { type: "string" } },
      },
      riskLevel: "low",
      isReadOnly: true,
    });

    registry.bindFunctionCaller(fc);
    await registry.initialize();

    const a = registry.getAllTools().find((t) => t.name === "mutation_target");
    a.riskLevel = "high";
    a.inputSchema.properties.x.type = "number";
    a.tags = ["poisoned"];

    const b = registry.getAllTools().find((t) => t.name === "mutation_target");
    expect(b.riskLevel).toBe("low");
    expect(b.inputSchema.properties.x.type).toBe("string");
    expect(b.tags).not.toContain("poisoned");
  });

  it("getToolsForLLM filters by activeSkillNames end-to-end", async () => {
    fc.registerTool("search_web", async () => ({ ok: true }), {
      description: "web search",
      inputSchema: { type: "object", properties: {} },
    });
    fc.registerTool("file_read", async () => ({ ok: true }), {
      description: "read file",
      inputSchema: { type: "object", properties: {} },
      isReadOnly: true,
    });
    fc.registerTool("shell_exec", async () => ({ ok: true }), {
      description: "run shell",
      inputSchema: { type: "object", properties: {} },
    });

    registry.bindFunctionCaller(fc);
    registry.bindSkillRegistry({
      getAllSkills: () => [
        {
          skillId: "web-skill",
          name: "web-skill",
          tools: ["search_web"],
        },
      ],
      on: () => {},
    });
    await registry.initialize();

    // No filter: all available tools
    const unfiltered = registry.getToolsForLLM();
    const unfilteredNames = unfiltered.map((t) => t.name).sort();
    expect(unfilteredNames).toEqual(
      expect.arrayContaining(["file_read", "search_web", "shell_exec"]),
    );

    // Filter by active skill — only its tools surface
    const scoped = registry.getToolsForLLM({ activeSkillNames: "web-skill" });
    expect(scoped.map((t) => t.name)).toEqual(["search_web"]);

    // alwaysAvailable lets core tools pass through
    const scopedPlus = registry.getToolsForLLM({
      activeSkillNames: "web-skill",
      alwaysAvailable: ["file_read"],
    });
    expect(scopedPlus.map((t) => t.name).sort()).toEqual([
      "file_read",
      "search_web",
    ]);

    // Unknown skill → empty (unless alwaysAvailable is provided)
    const empty = registry.getToolsForLLM({ activeSkillNames: "nope" });
    expect(empty).toEqual([]);
  });
});
