"use strict";

/**
 * coding-agent-contract-shared tests (previously untested) — the single source
 * of truth for the coding agent's tool surface (the function-calling contracts
 * the LLM sees). Rather than hardcode the whole table, this pins the accessor
 * contracts + cross-table invariants: every listed name resolves to a contract
 * AND a function definition, lookups return defensive clones, unknown -> null,
 * the OpenAI function-tool shape, names/tier filtering, MVP/extension membership
 * and the policy projection. Anchored on the stable `read_file` tool. No I/O.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  CODING_AGENT_MVP_TOOL_NAMES,
  CODING_AGENT_EXTENSION_TOOL_NAMES,
  getCodingAgentFunctionToolDefinition,
  getCodingAgentFunctionToolDefinitions,
  getCodingAgentToolContract,
  getCodingAgentToolContracts,
  getCodingAgentToolPolicy,
  isCodingAgentMvpTool,
  listCodingAgentToolNames,
} = require("../coding-agent-contract-shared.cjs");

describe("listCodingAgentToolNames + consistency", () => {
  it("returns a non-empty list of unique names including read_file", () => {
    const names = listCodingAgentToolNames();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("read_file");
  });

  it("every listed name resolves to both a contract and a function definition", () => {
    for (const n of listCodingAgentToolNames()) {
      expect(getCodingAgentToolContract(n)).toBeTruthy();
      expect(getCodingAgentFunctionToolDefinition(n)).toBeTruthy();
    }
  });
});

describe("getCodingAgentToolContract", () => {
  it("returns the contract for a known tool", () => {
    const c = getCodingAgentToolContract("read_file");
    expect(c.name).toBe("read_file");
    expect(c.tier).toBe("mvp");
  });

  it("returns null for an unknown tool", () => {
    expect(getCodingAgentToolContract("__nope__")).toBe(null);
  });

  it("returns a defensive clone (mutation does not leak back)", () => {
    const a = getCodingAgentToolContract("read_file");
    a.name = "MUTATED";
    expect(getCodingAgentToolContract("read_file").name).toBe("read_file");
  });
});

describe("getCodingAgentFunctionToolDefinition", () => {
  it("emits an OpenAI function-tool definition for a known tool", () => {
    const def = getCodingAgentFunctionToolDefinition("read_file");
    expect(def.type).toBe("function");
    expect(def.function.name).toBe("read_file");
    expect(typeof def.function.description).toBe("string");
    expect(def.function.parameters.type).toBe("object");
    expect(def.function.parameters.required).toContain("path");
  });

  it("returns null for an unknown tool", () => {
    expect(getCodingAgentFunctionToolDefinition("__nope__")).toBe(null);
  });
});

describe("getCodingAgentFunctionToolDefinitions filtering", () => {
  it("filters by an explicit names allow-list", () => {
    const defs = getCodingAgentFunctionToolDefinitions({
      names: ["read_file"],
    });
    expect(defs).toHaveLength(1);
    expect(defs[0].function.name).toBe("read_file");
  });

  it("treats an empty names array as no filter (returns all)", () => {
    const all = getCodingAgentFunctionToolDefinitions();
    expect(getCodingAgentFunctionToolDefinitions({ names: [] })).toHaveLength(
      all.length,
    );
  });

  it("returns [] for unknown names", () => {
    expect(
      getCodingAgentFunctionToolDefinitions({ names: ["__nope__"] }),
    ).toHaveLength(0);
  });
});

describe("tier filtering", () => {
  it("getCodingAgentToolContracts({tier}) returns only that tier", () => {
    const mvp = getCodingAgentToolContracts({ tier: "mvp" });
    expect(mvp.length).toBeGreaterThan(0);
    expect(mvp.every((t) => t.tier === "mvp")).toBe(true);
  });
});

describe("isCodingAgentMvpTool + membership", () => {
  it("is true for every MVP name and false for unknown", () => {
    for (const n of CODING_AGENT_MVP_TOOL_NAMES)
      expect(isCodingAgentMvpTool(n)).toBe(true);
    expect(isCodingAgentMvpTool("__nope__")).toBe(false);
  });

  it("MVP and extension names are all valid tool names", () => {
    const all = new Set(listCodingAgentToolNames());
    for (const n of CODING_AGENT_MVP_TOOL_NAMES) expect(all.has(n)).toBe(true);
    for (const n of CODING_AGENT_EXTENSION_TOOL_NAMES)
      expect(all.has(n)).toBe(true);
  });
});

describe("getCodingAgentToolPolicy", () => {
  it("projects the policy fields for a known tool", () => {
    const p = getCodingAgentToolPolicy("read_file");
    expect(p).toHaveProperty("tier");
    expect(p).toHaveProperty("riskLevel");
    expect(p).toHaveProperty("permissions");
    expect(typeof p.planModeBehavior).toBe("string"); // defaults to "standard"
  });

  it("returns null for an unknown tool", () => {
    expect(getCodingAgentToolPolicy("__nope__")).toBe(null);
  });
});
