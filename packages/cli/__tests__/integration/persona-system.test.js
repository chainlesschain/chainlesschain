/**
 * Integration tests for the Persona System
 *
 * Tests real module interactions between:
 * - buildSystemPrompt (agent-core) + project-detector + skill-loader
 * - chatWithTools tool filtering with persona.toolsDisabled
 * - executeTool persona guard
 *
 * Uses real filesystem with temp directories, mocks only LLM fetch and plan-mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock plan-mode (required by agent-core)
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

// Mock hook-manager (required by agent-core)
vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

// NOTE: We do NOT mock project-detector or skill-loader here.
// This is an integration test — we test their real interactions.

const { buildSystemPrompt, getBaseSystemPrompt, executeTool, chatWithTools } =
  await import("../../src/lib/agent-core.js");

describe("Integration: Persona System", () => {
  let tempDir;
  let ccDir;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-persona-integ-"));
    ccDir = join(tempDir, ".chainlesschain");
    mkdirSync(ccDir, { recursive: true });
    mkdirSync(join(ccDir, "skills"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── buildSystemPrompt integration ────────────────

  describe("buildSystemPrompt + real project-detector", () => {
    it("returns default prompt for non-project directory", () => {
      const noProjectDir = mkdtempSync(join(tmpdir(), "cc-noproj-"));
      try {
        const prompt = buildSystemPrompt(noProjectDir);
        expect(prompt).toContain("ChainlessChain AI Assistant");
        expect(prompt).toContain("agentic coding assistant");
        expect(prompt).not.toContain("## Project Rules");
      } finally {
        rmSync(noProjectDir, { recursive: true, force: true });
      }
    });

    it("includes rules.md content when present", () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({ name: "test-proj" }),
        "utf-8",
      );
      writeFileSync(
        join(ccDir, "rules.md"),
        "# My Rules\n\nAlways write tests first.",
        "utf-8",
      );

      const prompt = buildSystemPrompt(tempDir);
      expect(prompt).toContain("## Project Rules");
      expect(prompt).toContain("Always write tests first");
    });

    it("uses persona prompt when config has persona", () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "clinic",
          persona: {
            name: "Triage Assistant",
            role: "You are a medical triage AI assistant",
            behaviors: ["Ask symptoms first", "Use ESI classification"],
          },
        }),
        "utf-8",
      );

      const prompt = buildSystemPrompt(tempDir);
      expect(prompt).toContain("Triage Assistant");
      expect(prompt).toContain("You are a medical triage AI assistant");
      expect(prompt).toContain("Ask symptoms first");
      expect(prompt).toContain("Use ESI classification");
      // Should NOT contain the default coding assistant prompt
      expect(prompt).not.toContain("agentic coding assistant");
    });

    it("combines persona config + rules.md", () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "clinic",
          persona: {
            name: "Medical Assistant",
            role: "You are a medical AI",
          },
        }),
        "utf-8",
      );
      writeFileSync(
        join(ccDir, "rules.md"),
        "Never give definitive diagnoses.",
        "utf-8",
      );

      const prompt = buildSystemPrompt(tempDir);
      expect(prompt).toContain("Medical Assistant");
      expect(prompt).toContain("## Project Rules");
      expect(prompt).toContain("Never give definitive diagnoses");
    });

    it("includes toolsPriority in persona prompt", () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "proj",
          persona: {
            name: "Data Bot",
            role: "You help analyze data",
            toolsPriority: ["read_file", "run_code", "search_files"],
          },
        }),
        "utf-8",
      );

      const prompt = buildSystemPrompt(tempDir);
      expect(prompt).toContain("Preferred tools:");
      expect(prompt).toContain("read_file, run_code, search_files");
    });
  });

  // ─── Auto-activated persona skill integration ──────

  describe("buildSystemPrompt + auto-activated persona skills", () => {
    it("skill-loader can load persona skills with activation field", async () => {
      // Test the skill-loader directly with a temp directory
      const { CLISkillLoader } = await import("../../src/lib/skill-loader.js");

      // Create a persona skill in temp dir
      const personaSkillDir = join(ccDir, "skills", "my-persona");
      mkdirSync(personaSkillDir, { recursive: true });
      writeFileSync(
        join(personaSkillDir, "SKILL.md"),
        `---
name: my-persona
display-name: Custom Persona
category: persona
activation: auto
user-invocable: false
---

# Custom Persona Instructions

You are a specialized assistant for this project.`,
        "utf-8",
      );

      const manualDir = join(ccDir, "skills", "manual-persona");
      mkdirSync(manualDir, { recursive: true });
      writeFileSync(
        join(manualDir, "SKILL.md"),
        `---
name: manual-persona
display-name: Manual Persona
category: persona
activation: manual
---

This should NOT be auto-activated.`,
        "utf-8",
      );

      const loader = new CLISkillLoader();
      const skills = loader._loadFromDir(join(ccDir, "skills"), "workspace");

      const autoPersonas = skills.filter(
        (s) => s.category === "persona" && s.activation === "auto",
      );
      expect(autoPersonas).toHaveLength(1);
      expect(autoPersonas[0].id).toBe("my-persona");
      expect(autoPersonas[0].body).toContain("specialized assistant");

      const manualPersonas = skills.filter(
        (s) => s.category === "persona" && s.activation === "manual",
      );
      expect(manualPersonas).toHaveLength(1);
      expect(manualPersonas[0].id).toBe("manual-persona");
    });
  });

  // ─── executeTool persona guard integration ─────────

  describe("executeTool + persona.toolsDisabled", () => {
    it("blocks disabled tools with clear error message", async () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "restricted-proj",
          persona: {
            name: "Safe Bot",
            toolsDisabled: ["run_shell", "run_code"],
          },
        }),
        "utf-8",
      );

      const shellResult = await executeTool(
        "run_shell",
        { command: "echo hi" },
        { cwd: tempDir },
      );
      expect(shellResult.error).toContain("disabled by project persona");

      const codeResult = await executeTool(
        "run_code",
        { language: "node", code: "console.log(1)" },
        { cwd: tempDir },
      );
      expect(codeResult.error).toContain("disabled by project persona");
    });

    it("allows non-disabled tools", async () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "restricted-proj",
          persona: {
            name: "Safe Bot",
            toolsDisabled: ["run_shell"],
          },
        }),
        "utf-8",
      );

      // read_file is not disabled
      const testFile = join(tempDir, "hello.txt");
      writeFileSync(testFile, "world", "utf-8");

      const result = await executeTool(
        "read_file",
        { path: "hello.txt" },
        { cwd: tempDir },
      );
      expect(result.content).toBe("world");
    });

    it("no blocking when toolsDisabled is empty", async () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "open-proj",
          persona: {
            name: "Open Bot",
            toolsDisabled: [],
          },
        }),
        "utf-8",
      );

      const result = await executeTool(
        "run_shell",
        { command: "echo persona-open" },
        { cwd: tempDir },
      );
      expect(result.stdout).toContain("persona-open");
    });
  });

  // ─── chatWithTools tool filtering integration ──────

  describe("chatWithTools + persona tool filtering", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("Ollama request excludes disabled tools", async () => {
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "filtered-proj",
          persona: {
            name: "Filtered Bot",
            toolsDisabled: ["run_shell", "write_file"],
          },
        }),
        "utf-8",
      );

      let capturedBody;
      globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            message: { role: "assistant", content: "ok" },
          }),
        };
      });

      await chatWithTools([{ role: "user", content: "test" }], {
        provider: "ollama",
        model: "test",
        baseUrl: "http://localhost:11434",
        cwd: tempDir,
      });

      const toolNames = capturedBody.tools.map((t) => t.function.name);
      expect(toolNames).not.toContain("run_shell");
      expect(toolNames).not.toContain("write_file");
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("search_files");
      expect(capturedBody.tools.length).toBe(7); // 9 - 2 disabled
    });

    it("no filtering when no persona configured", async () => {
      // Use a directory without .chainlesschain
      const noProjectDir = mkdtempSync(join(tmpdir(), "cc-noproj-chat-"));

      let capturedBody;
      globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            message: { role: "assistant", content: "ok" },
          }),
        };
      });

      try {
        await chatWithTools([{ role: "user", content: "test" }], {
          provider: "ollama",
          model: "test",
          baseUrl: "http://localhost:11434",
          cwd: noProjectDir,
        });

        expect(capturedBody.tools.length).toBe(9); // All tools
      } finally {
        rmSync(noProjectDir, { recursive: true, force: true });
      }
    });
  });

  // ─── Full persona lifecycle integration ────────────

  describe("full persona lifecycle", () => {
    it("init template → persona in prompt → tool blocking → reset → default prompt", async () => {
      // Step 1: Create a project with persona (use ASCII to avoid encoding issues in temp dirs)
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "my-clinic",
          template: "medical-triage",
          persona: {
            name: "Triage Bot",
            role: "You are a medical triage AI assistant",
            behaviors: ["Always ask symptoms first"],
            toolsDisabled: ["run_code"],
          },
        }),
        "utf-8",
      );
      writeFileSync(
        join(ccDir, "rules.md"),
        "Never provide definitive diagnoses.",
        "utf-8",
      );

      // Step 2: Verify persona in system prompt
      let prompt = buildSystemPrompt(tempDir);
      expect(prompt).toContain("Triage Bot");
      expect(prompt).toContain("You are a medical triage AI assistant");
      expect(prompt).toContain("## Project Rules");
      expect(prompt).not.toContain("agentic coding assistant");

      // Step 3: Verify tool blocking
      const blocked = await executeTool(
        "run_code",
        { language: "node", code: "1+1" },
        { cwd: tempDir },
      );
      expect(blocked.error).toContain("disabled by project persona");

      // Step 4: Verify allowed tool works
      const testFile = join(tempDir, "patient.txt");
      writeFileSync(testFile, "Headache, fever", "utf-8");
      const allowed = await executeTool(
        "read_file",
        { path: "patient.txt" },
        { cwd: tempDir },
      );
      expect(allowed.content).toBe("Headache, fever");

      // Step 5: Reset persona (simulating persona reset)
      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      delete config.persona;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify(config),
        "utf-8",
      );

      // Step 6: Verify default prompt is restored
      prompt = buildSystemPrompt(tempDir);
      expect(prompt).toContain("ChainlessChain AI Assistant");
      expect(prompt).toContain("agentic coding assistant");
      expect(prompt).toContain("## Project Rules"); // rules.md still there
    });
  });
});
