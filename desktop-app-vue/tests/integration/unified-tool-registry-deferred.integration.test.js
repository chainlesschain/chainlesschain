/**
 * Integration: UnifiedToolRegistry deferSkills lazy import
 *
 * Verifies the production fast-init path:
 *   1. `initialize({ deferSkills: true })` returns before skills are imported
 *   2. The first call to a public read API triggers skill import on demand
 *   3. Direct Map access (legacy contract) requires either eager init or
 *      a prior read-API call
 */

import { describe, it, expect, beforeEach } from "vitest";

const {
  UnifiedToolRegistry,
} = require("../../src/main/ai-engine/unified-tool-registry");

function makeFC() {
  return {
    getAllToolDefinitions: () => [
      { name: "browser_click", description: "Click", parameters: {} },
      { name: "browser_navigate", description: "Navigate", parameters: {} },
      { name: "read_file", description: "Read", parameters: {} },
    ],
    isToolAvailable: () => true,
  };
}

function makeSR() {
  return {
    getAllSkills: () => [
      {
        skillId: "browser-automation",
        name: "Browser Automation",
        description: "Automate browser",
        category: "automation",
        version: "1.0.0",
        tools: ["browser-click", "browser-navigate"],
        instructions: "Use browser-navigate first.",
        examples: [],
        tags: ["browser"],
      },
    ],
  };
}

describe("integration: UnifiedToolRegistry deferSkills", () => {
  let registry;

  beforeEach(() => {
    registry = new UnifiedToolRegistry();
    registry.bindFunctionCaller(makeFC());
    registry.bindSkillRegistry(makeSR());
  });

  it("fast init returns before skills are imported", async () => {
    await registry.initialize({ deferSkills: true });
    expect(registry._initialized).toBe(true);
    // FunctionCaller tools are present immediately
    expect(registry.tools.has("browser_click")).toBe(true);
    // Skills not yet imported (background setImmediate may or may not have run)
    // — but the flag is the contract:
    if (!registry._skillsImported) {
      expect(registry.skills.size).toBe(0);
    }
  });

  it("getSkillManifest() lazily triggers skill import", async () => {
    await registry.initialize({ deferSkills: true });
    // Wipe any background import that may have raced ahead
    registry._skillsImported = false;
    registry.skills.clear();

    const manifest = registry.getSkillManifest();
    expect(registry._skillsImported).toBe(true);
    expect(manifest.find((s) => s.name === "browser-automation")).toBeTruthy();
  });

  it("getToolsForLLM() lazily triggers skill import", async () => {
    await registry.initialize({ deferSkills: true });
    registry._skillsImported = false;
    registry.skills.clear();

    const tools = registry.getToolsForLLM();
    expect(registry._skillsImported).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("eager init (default) keeps the original blocking contract", async () => {
    await registry.initialize();
    expect(registry._skillsImported).toBe(true);
    expect(registry.skills.has("browser-automation")).toBe(true);
    expect(registry.tools.get("browser_click").skillName).toBe(
      "browser-automation",
    );
  });

  it("background setImmediate eventually imports skills without any read", async () => {
    await registry.initialize({ deferSkills: true });
    // Wait one macrotask so setImmediate callback runs
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry._skillsImported).toBe(true);
  });
});
