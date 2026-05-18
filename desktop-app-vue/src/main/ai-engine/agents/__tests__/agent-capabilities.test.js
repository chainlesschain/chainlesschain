import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  AgentCapabilities,
  CAPABILITY_DEFINITIONS,
  TOOL_DEFINITIONS,
  AGENT_TYPE_CAPABILITIES,
} = require("../agent-capabilities");

describe("AgentCapabilities (pure functions)", () => {
  describe("static catalogs", () => {
    it("CAPABILITY_DEFINITIONS contains all expected security capabilities", () => {
      expect(CAPABILITY_DEFINITIONS.owasp_scanning).toBeDefined();
      expect(CAPABILITY_DEFINITIONS.owasp_scanning.category).toBe("security");
      expect(CAPABILITY_DEFINITIONS.secret_detection).toBeDefined();
      expect(CAPABILITY_DEFINITIONS.dependency_audit).toBeDefined();
      expect(CAPABILITY_DEFINITIONS.vulnerability_assessment).toBeDefined();
    });

    it("AGENT_TYPE_CAPABILITIES has all 8 standard types", () => {
      expect(Object.keys(AGENT_TYPE_CAPABILITIES)).toEqual(
        expect.arrayContaining([
          "security",
          "devops",
          "data-analysis",
          "document",
          "testing",
          "code-generation",
          "performance",
          "compliance",
        ]),
      );
    });

    it("TOOL_DEFINITIONS exports a non-empty registry", () => {
      expect(Object.keys(TOOL_DEFINITIONS).length).toBeGreaterThan(0);
    });
  });

  describe("getCapabilitiesForType", () => {
    it("returns capabilities for a known type", () => {
      const caps = AgentCapabilities.getCapabilitiesForType("security");
      expect(Array.isArray(caps)).toBe(true);
      expect(caps.length).toBe(4);
      const ids = caps.map((c) => c.id);
      expect(ids).toContain("owasp_scanning");
      expect(ids).toContain("secret_detection");
    });

    it("returns null and warns for an unknown type", () => {
      const caps = AgentCapabilities.getCapabilitiesForType("nonexistent");
      expect(caps).toBeNull();
    });

    it("each returned capability has id, name, description, category", () => {
      const caps = AgentCapabilities.getCapabilitiesForType("security");
      for (const cap of caps) {
        expect(cap.id).toBeDefined();
        expect(cap.name).toBeDefined();
        expect(cap.description).toBeDefined();
        expect(cap.category).toBeDefined();
      }
    });
  });

  describe("getToolsForCapabilities", () => {
    it("returns required + optional tool sets", () => {
      const tools = AgentCapabilities.getToolsForCapabilities([
        "owasp_scanning",
      ]);
      expect(tools.required).toBeDefined();
      expect(tools.optional).toBeDefined();
      expect(tools.all).toBeDefined();
      expect(tools.all.length).toBe(
        tools.required.length + tools.optional.length,
      );
    });

    it("deduplicates tools across multiple capabilities", () => {
      // owasp_scanning + secret_detection both reference 'file_reader' as optional
      const tools = AgentCapabilities.getToolsForCapabilities([
        "owasp_scanning",
        "secret_detection",
      ]);
      const fileReaderCount = tools.all.filter(
        (t) => t.id === "file_reader",
      ).length;
      expect(fileReaderCount).toBeLessThanOrEqual(1);
    });

    it("removes a tool from optional if it appears as required in any cap", () => {
      // vulnerability_assessment requires code_analyzer; owasp_scanning also requires it
      const tools = AgentCapabilities.getToolsForCapabilities([
        "vulnerability_assessment",
        "owasp_scanning",
      ]);
      const requiredIds = tools.required.map((t) => t.id);
      const optionalIds = tools.optional.map((t) => t.id);
      expect(requiredIds).toContain("code_analyzer");
      expect(optionalIds).not.toContain("code_analyzer");
    });

    it("ignores unknown capabilities silently", () => {
      const tools = AgentCapabilities.getToolsForCapabilities([
        "owasp_scanning",
        "nonexistent_cap",
      ]);
      expect(tools.required.length).toBeGreaterThan(0);
    });

    it("returns empty sets for an empty input array", () => {
      const tools = AgentCapabilities.getToolsForCapabilities([]);
      expect(tools.required).toEqual([]);
      expect(tools.optional).toEqual([]);
      expect(tools.all).toEqual([]);
    });
  });

  describe("matchCapabilities", () => {
    it("returns 1.0 when required is empty", () => {
      expect(AgentCapabilities.matchCapabilities([], ["a", "b"])).toBe(1.0);
    });

    it("returns 0.0 when available is empty but required is not", () => {
      expect(AgentCapabilities.matchCapabilities(["a"], [])).toBe(0.0);
    });

    it("returns 1.0 for an exact full match", () => {
      const score = AgentCapabilities.matchCapabilities(
        ["owasp_scanning", "secret_detection"],
        ["owasp_scanning", "secret_detection", "dependency_audit"],
      );
      expect(score).toBe(1.0);
    });

    it("returns 0.5 for a single match out of two required", () => {
      const score = AgentCapabilities.matchCapabilities(
        ["owasp_scanning", "totally_unrelated_capability_xyz"],
        ["owasp_scanning"],
      );
      expect(score).toBe(0.5);
    });

    it("uses category-level partial matching when no overlap", () => {
      // Both are in 'security' category but no exact / substring overlap
      const score = AgentCapabilities.matchCapabilities(
        ["owasp_scanning"],
        ["dependency_audit"],
      );
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1.0);
    });

    it("clamps the score to a maximum of 1.0", () => {
      const score = AgentCapabilities.matchCapabilities(
        ["owasp_scanning"],
        ["owasp_scanning", "secret_detection", "dependency_audit"],
      );
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe("findBestAgentType", () => {
    it("returns the security agent for security capabilities", () => {
      const best = AgentCapabilities.findBestAgentType([
        "owasp_scanning",
        "secret_detection",
      ]);
      expect(best).not.toBeNull();
      expect(best.agentType).toBe("security");
      expect(best.score).toBe(1.0);
    });

    it("returns the testing agent for test capabilities", () => {
      const best = AgentCapabilities.findBestAgentType([
        "unit_test_generation",
        "test_coverage",
      ]);
      expect(best.agentType).toBe("testing");
    });

    it("returns null when input is empty", () => {
      expect(AgentCapabilities.findBestAgentType([])).toBeNull();
      expect(AgentCapabilities.findBestAgentType(null)).toBeNull();
    });

    it("breaks ties using the priority field", () => {
      // 'security' has priority 10, 'compliance' has priority 6
      // owasp_scanning is in security only, but owasp_compliance is in compliance.
      // Pass a single capability that both contain partial substrings of.
      const best = AgentCapabilities.findBestAgentType(["owasp_scanning"]);
      expect(best.agentType).toBe("security"); // higher priority wins
    });
  });

  describe("getCategories / getCapabilitiesByCategory", () => {
    it("getCategories returns sorted unique categories", () => {
      const cats = AgentCapabilities.getCategories();
      expect(Array.isArray(cats)).toBe(true);
      expect(cats.length).toBeGreaterThan(0);
      const sorted = [...cats].sort();
      expect(cats).toEqual(sorted);
    });

    it("getCapabilitiesByCategory returns all caps in that category", () => {
      const securityCaps =
        AgentCapabilities.getCapabilitiesByCategory("security");
      expect(securityCaps.length).toBeGreaterThan(0);
      for (const cap of securityCaps) {
        expect(cap.category).toBe("security");
      }
    });

    it("getCapabilitiesByCategory returns empty array for unknown category", () => {
      expect(AgentCapabilities.getCapabilitiesByCategory("nope")).toEqual([]);
    });
  });

  describe("getAgentTypes / getCapability / getTool", () => {
    it("getAgentTypes returns array of all 8 types", () => {
      const types = AgentCapabilities.getAgentTypes();
      expect(types.length).toBe(8);
      for (const t of types) {
        expect(t.type).toBeDefined();
        expect(t.priority).toBeDefined();
      }
    });

    it("getCapability returns the definition with id", () => {
      const cap = AgentCapabilities.getCapability("owasp_scanning");
      expect(cap).not.toBeNull();
      expect(cap.id).toBe("owasp_scanning");
      expect(cap.category).toBe("security");
    });

    it("getCapability returns null for unknown name", () => {
      expect(AgentCapabilities.getCapability("nope")).toBeNull();
    });

    it("getTool returns null for unknown tool", () => {
      expect(AgentCapabilities.getTool("nonexistent_tool")).toBeNull();
    });
  });

  describe("getToolsByCategory", () => {
    it("returns a map of category → tools[]", () => {
      const grouped = AgentCapabilities.getToolsByCategory();
      expect(typeof grouped).toBe("object");
      const totalTools = Object.values(grouped).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      expect(totalTools).toBe(Object.keys(TOOL_DEFINITIONS).length);
    });
  });

  describe("validate", () => {
    it("returns valid=true for the bundled definitions", () => {
      const result = AgentCapabilities.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("exportSummary", () => {
    it("includes capabilities, tools, agentTypes, categories, stats", () => {
      const summary = AgentCapabilities.exportSummary();
      expect(summary.capabilities).toBeDefined();
      expect(summary.tools).toBeDefined();
      expect(summary.agentTypes).toBeDefined();
      expect(summary.categories).toBeDefined();
      expect(summary.stats.totalCapabilities).toBe(
        Object.keys(CAPABILITY_DEFINITIONS).length,
      );
      expect(summary.stats.totalTools).toBe(
        Object.keys(TOOL_DEFINITIONS).length,
      );
      expect(summary.stats.totalAgentTypes).toBe(8);
    });
  });
});
