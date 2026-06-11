/** cc init --ai — agent-enhanced inventory refine pass (runner injected). */
import { describe, it, expect } from "vitest";
import {
  aiRefineMemoryFile,
  buildRefinePrompt,
  AI_REFINE_TOOLS,
  AI_REFINE_MAX_TURNS,
} from "../../src/lib/init-ai-refine.js";

describe("buildRefinePrompt", () => {
  it("instructs read -> learn -> rewrite Conventions without inventing", () => {
    const p = buildRefinePrompt();
    expect(p).toContain("read_file cc.md");
    expect(p).toContain("## Conventions");
    expect(p).toContain("Do not invent");
  });
});

describe("aiRefineMemoryFile", () => {
  it("runs headless with bounded tools/turns and acceptEdits", async () => {
    let seen = null;
    const res = await aiRefineMemoryFile({
      cwd: "C:/proj",
      provider: "volcengine",
      model: "doubao-x",
      runHeadless: async (opts) => {
        seen = opts;
        return { exitCode: 0, result: "ok", isError: false };
      },
    });
    expect(res.isError).toBe(false);
    expect(seen.cwd).toBe("C:/proj");
    expect(seen.provider).toBe("volcengine");
    expect(seen.permissionMode).toBe("acceptEdits");
    expect(seen.allowedTools).toEqual(AI_REFINE_TOOLS);
    expect(seen.maxTurns).toBe(AI_REFINE_MAX_TURNS);
    expect(seen.expandFileRefs).toBe(false);
  });

  it("sets CC_PROJECT_MEMORY=0 during the run and restores it after", async () => {
    const prev = process.env.CC_PROJECT_MEMORY;
    process.env.CC_PROJECT_MEMORY = "1";
    try {
      let during = null;
      await aiRefineMemoryFile({
        runHeadless: async () => {
          during = process.env.CC_PROJECT_MEMORY;
          return { exitCode: 0, result: "", isError: false };
        },
      });
      expect(during).toBe("0"); // self-reference guard active
      expect(process.env.CC_PROJECT_MEMORY).toBe("1"); // restored
    } finally {
      if (prev === undefined) delete process.env.CC_PROJECT_MEMORY;
      else process.env.CC_PROJECT_MEMORY = prev;
    }
  });

  it("restores the env even when the run throws", async () => {
    const prev = process.env.CC_PROJECT_MEMORY;
    delete process.env.CC_PROJECT_MEMORY;
    try {
      await expect(
        aiRefineMemoryFile({
          runHeadless: async () => {
            throw new Error("LLM down");
          },
        }),
      ).rejects.toThrow("LLM down");
      expect(process.env.CC_PROJECT_MEMORY).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.CC_PROJECT_MEMORY = prev;
    }
  });
});
