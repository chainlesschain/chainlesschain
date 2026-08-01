import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCliSkillReauthorizer,
  createControlledSkillScaffold,
  resolveControlledSkillLlmOptions,
  runControlledSkill,
} from "../../src/commands/skill.js";
import { CLISkillLoader } from "../../src/lib/skill-loader.js";

const roots = [];

function fixtureLoader(root, options = {}) {
  const loader = new CLISkillLoader({ contextLedger: null, ...options });
  loader._cache = loader._loadFromDir(root, "workspace");
  return loader;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("controlled skill command path", () => {
  it("creates an isolated scaffold and routes it through run_skill after async digest authorization", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-command-"));
    roots.push(root);
    const skillDir = path.join(root, "review-notes");
    createControlledSkillScaffold("review-notes", skillDir);

    const skillMd = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    const handler = fs.readFileSync(path.join(skillDir, "handler.js"), "utf8");
    expect(skillMd).toContain("isolation: true");
    expect(handler).toContain('executionMode: "controlled-agent-tools"');
    expect(handler).not.toContain("async execute");

    const authorize = vi.fn(async () => {
      await Promise.resolve();
      return { authorized: true };
    });
    const loader = fixtureLoader(root, { reauthorizeSkill: authorize });
    const executeTool = vi.fn(async (_toolName, args, context) => {
      // Simulate the committed runtime, which performs a synchronous defense-
      // in-depth recheck. The command's awaited authorization must make that
      // exact digest reusable without calling the async authorizer again.
      const materialized = context.skillLoader.materializeSkill(
        context.skillLoader.getResolvedSkills()[0],
        { loadedBecause: "run_skill" },
      );
      return {
        success: true,
        isolated: materialized.isolation,
        summary: `controlled:${args.input}`,
      };
    });
    const llmOptions = {
      provider: "openai",
      model: "gpt-test",
      baseUrl: "https://llm.invalid/v1",
      apiKey: "test-key",
    };

    const result = await runControlledSkill({
      name: "review-notes",
      input: "inspect this",
      cwd: root,
      loader,
      executeTool,
      llmOptions,
    });

    expect(result).toMatchObject({
      success: true,
      isolated: true,
      summary: "controlled:inspect this",
    });
    expect(executeTool).toHaveBeenCalledWith(
      "run_skill",
      { skill_name: "review-notes", input: "inspect this" },
      { cwd: root, skillLoader: loader, llmOptions },
    );
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("keeps an untrusted project skill fail-closed when no authorizer exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-command-"));
    roots.push(root);
    createControlledSkillScaffold("untrusted", path.join(root, "untrusted"));
    const loader = fixtureLoader(root);

    await expect(
      loader.materializeSkillForExecution(loader.getResolvedSkills()[0], {
        loadedBecause: "run_skill",
      }),
    ).rejects.toMatchObject({ code: "CC_SKILL_TRUST_REQUIRED" });
  });

  it("supports explicit non-interactive authorization without making it the default", async () => {
    const deny = createCliSkillReauthorizer({
      stdin: { isTTY: false },
      stdout: { isTTY: false },
    });
    const allow = createCliSkillReauthorizer({ assumeYes: true });

    await expect(deny({})).resolves.toBe(false);
    await expect(allow({})).resolves.toEqual({ authorized: true });
  });

  it("resolves the existing command LLM config and a runnable local default", () => {
    expect(
      resolveControlledSkillLlmOptions({
        config: {
          llm: {
            provider: "openai",
            model: "gpt-configured",
            baseUrl: "https://gateway.invalid/v1",
            apiKey: "configured-key",
          },
        },
        env: {},
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-configured",
      baseUrl: "https://gateway.invalid/v1",
      apiKey: "configured-key",
    });
    expect(
      resolveControlledSkillLlmOptions({ config: {}, env: {} }),
    ).toMatchObject({
      provider: "ollama",
      model: expect.any(String),
      baseUrl: "http://localhost:11434",
    });
  });

  it.each([
    {
      result: { error: "Isolated skill execution failed: provider rejected" },
      expected: /provider rejected/,
    },
    {
      result: {
        success: true,
        isolated: true,
        summary: "Sub-agent failed: Unsupported provider: undefined",
      },
      expected: /Unsupported provider/,
    },
  ])(
    "fails closed when controlled execution reports a child failure",
    async ({ result, expected }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-command-"));
      roots.push(root);
      createControlledSkillScaffold("failing", path.join(root, "failing"));
      const loader = fixtureLoader(root, {
        reauthorizeSkill: async () => ({ authorized: true }),
      });

      const output = await runControlledSkill({
        name: "failing",
        loader,
        executeTool: vi.fn(async () => result),
        llmOptions: { provider: "ollama" },
      });

      expect(output).toMatchObject({
        success: false,
        code: "CC_SKILL_CONTROLLED_RUN_FAILED",
      });
      expect(output.error).toMatch(expected);
    },
  );
});
