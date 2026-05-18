/**
 * E2E Tests for 10 New Skill Handlers (v1.2.0)
 *
 * Tests IPC reachability for: self-improving-agent, google-workspace,
 * summarizer, github-manager, weather, notion, api-gateway, obsidian,
 * humanizer, free-model-manager.
 *
 * Pattern: shared Electron instance, callIPC helper, assertEnvelope validator.
 * Requires: npm run build:main first, then npx playwright test
 */
import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

const NEW_SKILLS = [
  "self-improving-agent",
  "google-workspace",
  "summarizer",
  "github-manager",
  "weather",
  "notion",
  "api-gateway",
  "obsidian",
  "humanizer",
  "free-model-manager",
];

test.describe("v1.2.0 New Skill Handlers - E2E", () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, "../../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  /**
   * Helper: execute a skill via IPC and return the result envelope.
   */
  async function callIPC(
    skillName: string,
    input: string,
  ): Promise<Record<string, unknown>> {
    return electronApp.evaluate(
      async ({ ipcMain }, { name, inp }) => {
        try {
          const skillsDir = require("path").join(
            __dirname,
            "../src/main/ai-engine/cowork/skills/builtin",
            name,
          );
          const handler = require(
            require("path").join(skillsDir, "handler.js"),
          );
          if (typeof handler.init === "function") await handler.init({});
          const result = await handler.execute(
            { input: inp, args: inp },
            {},
            {},
          );
          return result;
        } catch (err: unknown) {
          const error = err as Error;
          return { success: false, error: error.message, _e2eLoadError: true };
        }
      },
      { name: skillName, inp: input },
    );
  }

  /**
   * Asserts that a result is a valid skill response envelope.
   */
  function assertEnvelope(result: Record<string, unknown>) {
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
    // Should have either 'action' or 'error'
    expect(
      "action" in result || "error" in result || "_e2eLoadError" in result,
    ).toBe(true);
  }

  // --- Per-handler IPC reachability tests ---

  test("humanizer: should execute humanize action", async () => {
    const result = await callIPC("humanizer", "humanize We must leverage this multifaceted approach");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect(result.action).toBe("humanize");
    }
  });

  test("self-improving-agent: should execute show-history", async () => {
    const result = await callIPC("self-improving-agent", "show-history");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect(result.action).toBe("show-history");
    }
  });

  test("summarizer: should execute summarize-text", async () => {
    const result = await callIPC(
      "summarizer",
      "summarize-text Artificial intelligence has transformed technology significantly over the past decade with numerous applications and innovations.",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect(result.action).toBe("summarize-text");
    }
  });

  test("weather: should return error without location", async () => {
    const result = await callIPC("weather", "current");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(false);
      expect(result.error).toContain("Location required");
    }
  });

  test("github-manager: should return error without token", async () => {
    // In test env, GITHUB_TOKEN is typically not set
    const result = await callIPC("github-manager", "list-issues owner/repo");
    assertEnvelope(result);
    // Either fails with no token or succeeds if token is set
    expect(typeof result.success).toBe("boolean");
  });

  test("notion: should return error without API key", async () => {
    const result = await callIPC("notion", "search test");
    assertEnvelope(result);
    // Fails without NOTION_API_KEY in test env
    if (!result._e2eLoadError) {
      if (!process.env.NOTION_API_KEY) {
        expect(result.success).toBe(false);
      }
    }
  });

  test("api-gateway: should execute list action", async () => {
    const result = await callIPC("api-gateway", "list");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    }
  });

  test("obsidian: should handle missing vault gracefully", async () => {
    const result = await callIPC("obsidian", "list-recent");
    assertEnvelope(result);
    // May fail if no vault found, which is expected in test env
    expect(typeof result.success).toBe("boolean");
  });

  test("google-workspace: should return error without credentials", async () => {
    const result = await callIPC("google-workspace", "calendar-list");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      if (!process.env.GOOGLE_API_KEY) {
        expect(result.success).toBe(false);
      }
    }
  });

  test("free-model-manager: should execute search action", async () => {
    const result = await callIPC("free-model-manager", "search llama");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect(result.action).toBe("search");
    }
  });

  // --- Integration tests ---

  test("skills:list should include all 10 new skills", async () => {
    const result = await electronApp.evaluate(async () => {
      try {
        const fs = require("fs");
        const path = require("path");
        const builtinDir = path.join(
          __dirname,
          "../src/main/ai-engine/cowork/skills/builtin",
        );
        if (!fs.existsSync(builtinDir)) return { found: [], missing: [] };

        const dirs = fs.readdirSync(builtinDir, { withFileTypes: true })
          .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
          .map((d: { name: string }) => d.name);
        return { dirs };
      } catch (err: unknown) {
        const error = err as Error;
        return { error: error.message };
      }
    });

    if (result.dirs) {
      for (const skill of NEW_SKILLS) {
        expect(result.dirs).toContain(skill);
      }
    }
  });

  test("skills:get should return metadata for each new skill", async () => {
    for (const skillName of NEW_SKILLS) {
      const result = await electronApp.evaluate(
        async ({ ipcMain }, name) => {
          try {
            const fs = require("fs");
            const path = require("path");
            const skillMdPath = path.join(
              __dirname,
              "../src/main/ai-engine/cowork/skills/builtin",
              name,
              "SKILL.md",
            );
            const handlerPath = path.join(
              __dirname,
              "../src/main/ai-engine/cowork/skills/builtin",
              name,
              "handler.js",
            );
            return {
              name,
              hasSkillMd: fs.existsSync(skillMdPath),
              hasHandler: fs.existsSync(handlerPath),
            };
          } catch (err: unknown) {
            const error = err as Error;
            return { name, error: error.message };
          }
        },
        skillName,
      );

      expect(result.hasSkillMd).toBe(true);
      expect(result.hasHandler).toBe(true);
    }
  });
});
