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
      expect.objectContaining({
        cwd: root,
        skillLoader: loader,
        llmOptions,
        signal: expect.objectContaining({ aborted: false }),
      }),
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

  it("passes the parent signal into an interactive authorization prompt", async () => {
    const controller = new AbortController();
    const confirm = vi.fn(async (_question, context) => {
      expect(context.signal).toBe(controller.signal);
      return false;
    });
    const authorize = createCliSkillReauthorizer({
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      confirm,
    });

    await expect(
      authorize({
        skill: { id: "cancel-aware", source: "workspace" },
        currentDigest: "sha256:test",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ authorized: false });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("cancels an interactive authorization even when the prompt adapter ignores its signal", async () => {
    let resolvePrompt;
    const confirm = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const authorize = createCliSkillReauthorizer({
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      confirm,
    });
    const controller = new AbortController();
    const reason = Object.assign(new Error("authorization stopped"), {
      name: "AbortError",
    });
    const waiting = authorize({
      skill: { id: "cancel-prompt", source: "workspace" },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());

    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    resolvePrompt(true);
    await Promise.resolve();
    await expect(waiting).rejects.toBe(reason);
  });

  it("cancels a pending controlled command dispatch and fences its late result", async () => {
    const skill = {
      id: "pending",
      dirName: "pending",
      isolation: true,
    };
    const loader = {
      getResolvedSkills: () => [skill],
      materializeSkillForExecution: vi.fn(async () => skill),
    };
    let resolveDispatch;
    const executeTool = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDispatch = resolve;
        }),
    );
    const controller = new AbortController();
    const reason = Object.assign(new Error("controlled command stopped"), {
      name: "AbortError",
    });
    const running = runControlledSkill({
      name: "pending",
      loader,
      executeTool,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalledOnce());
    expect(executeTool.mock.calls[0][2].signal).toBe(controller.signal);

    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
    resolveDispatch({ success: true, summary: "late command success" });
    await Promise.resolve();
    await expect(running).rejects.toBe(reason);
  });

  it("revokes a pending controlled command from another loader and fences its late result", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-command-"));
    roots.push(root);
    createControlledSkillScaffold(
      "revoke-running",
      path.join(root, "revoke-running"),
    );
    const loader = fixtureLoader(root, {
      reauthorizeSkill: async () => ({ authorized: true }),
    });
    let resolveDispatch;
    const executeTool = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDispatch = resolve;
        }),
    );
    const running = runControlledSkill({
      name: "revoke-running",
      loader,
      executeTool,
    });
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalledOnce());
    const executionSignal = executeTool.mock.calls[0][2].signal;
    expect(executionSignal.aborted).toBe(false);

    const revoker = new CLISkillLoader({ contextLedger: null });
    const revoked = revoker.revokeExecutionAuthorizations();
    expect(revoked.interruptedLeases).toBe(1);
    expect(executionSignal.aborted).toBe(true);
    await expect(running).rejects.toMatchObject({
      name: "AbortError",
      code: "CC_SKILL_EXECUTION_REVOKED",
      generation: revoked.generation,
    });

    resolveDispatch({ success: true, summary: "late revoked success" });
    await Promise.resolve();
    await expect(running).rejects.toMatchObject({
      code: "CC_SKILL_EXECUTION_REVOKED",
    });
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
