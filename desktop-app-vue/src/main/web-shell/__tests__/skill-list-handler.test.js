/**
 * Unit tests for the `skill.list` WS handler. The bootstrap test exercises the
 * real CLISkillLoader; here we use the loaderFactory injection seam to cover
 * the shape mapping, caching, and edge cases without hitting the filesystem.
 */

import { describe, it, expect } from "vitest";
import {
  createSkillListHandler,
  shapeSkill,
  deriveExecutionMode,
} from "../handlers/skill-list-handler.js";

describe("deriveExecutionMode", () => {
  it("maps category strings to the four web-panel modes", () => {
    expect(deriveExecutionMode("agent")).toBe("agent");
    expect(deriveExecutionMode("agent-orchestration")).toBe("agent");
    expect(deriveExecutionMode("llm-query")).toBe("llm-query");
    expect(deriveExecutionMode("cli-direct")).toBe("cli-direct");
    expect(deriveExecutionMode("cli-builtin")).toBe("cli-direct");
    expect(deriveExecutionMode("misc")).toBe("built-in");
    expect(deriveExecutionMode(null)).toBe("built-in");
    expect(deriveExecutionMode(undefined)).toBe("built-in");
  });
});

describe("shapeSkill", () => {
  it("maps loader fields to the web-panel-friendly shape", () => {
    expect(
      shapeSkill({
        id: "auto-context",
        displayName: "Auto Context",
        description: "Maximum token budget",
        category: "ai",
        source: "bundled",
        version: "1.0.0",
      }),
    ).toEqual({
      name: "auto-context",
      displayName: "Auto Context",
      description: "Maximum token budget",
      category: "ai",
      executionMode: "built-in",
      source: "bundled",
      version: "1.0.0",
    });
  });

  it("uses skill.id as displayName fallback and empty string for missing description", () => {
    expect(shapeSkill({ id: "x", category: "agent" })).toEqual({
      name: "x",
      displayName: "x",
      description: "",
      category: "agent",
      executionMode: "agent",
      source: null,
      version: null,
    });
  });

  it("respects an explicit executionMode from the loader over derived value", () => {
    expect(
      shapeSkill({ id: "x", category: "misc", executionMode: "hybrid" }),
    ).toEqual(expect.objectContaining({ executionMode: "hybrid" }));
  });
});

describe("createSkillListHandler", () => {
  it("returns the schema:1 envelope and shaped skills", async () => {
    const handler = createSkillListHandler({
      loaderFactory: async () => ({
        loadAll: () => [
          { id: "alpha", description: "first", category: "cli-direct" },
          { id: "beta", description: "second", category: "agent-foo" },
        ],
      }),
    });
    const result = await handler({ type: "skill.list", id: "x" });
    expect(result).toEqual({
      schema: 1,
      skills: [
        {
          name: "alpha",
          displayName: "alpha",
          description: "first",
          category: "cli-direct",
          executionMode: "cli-direct",
          source: null,
          version: null,
        },
        {
          name: "beta",
          displayName: "beta",
          description: "second",
          category: "agent-foo",
          executionMode: "agent",
          source: null,
          version: null,
        },
      ],
    });
  });

  it("returns an empty list when the loader yields a non-array", async () => {
    const handler = createSkillListHandler({
      loaderFactory: async () => ({ loadAll: () => null }),
    });
    expect(await handler({})).toEqual({ schema: 1, skills: [] });
  });

  it("caches the loader instance across calls (factory invoked once)", async () => {
    let factoryCalls = 0;
    const handler = createSkillListHandler({
      loaderFactory: async () => {
        factoryCalls += 1;
        return { loadAll: () => [] };
      },
    });
    await handler({});
    await handler({});
    await handler({});
    expect(factoryCalls).toBe(1);
  });

  it("propagates loader.loadAll() throws as a rejected promise (caller wraps as ok:false)", async () => {
    const handler = createSkillListHandler({
      loaderFactory: async () => ({
        loadAll: () => {
          throw new Error("disk read failed");
        },
      }),
    });
    await expect(handler({})).rejects.toThrow("disk read failed");
  });
});
