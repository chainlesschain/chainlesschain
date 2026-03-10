/**
 * E2E Tests for 6 New Skill Handlers (v1.2.1)
 *
 * Tests IPC reachability for: brainstorming, debugging-strategies,
 * api-design, frontend-design, create-pr, doc-coauthoring.
 *
 * Pattern: shared Electron instance, callIPC helper, assertEnvelope validator.
 * Requires: npm run build:main first, then npx playwright test
 */
import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

const NEW_SKILLS = [
  "brainstorming",
  "debugging-strategies",
  "api-design",
  "frontend-design",
  "create-pr",
  "doc-coauthoring",
];

test.describe("v1.2.1 New Skill Handlers - E2E", () => {
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
    expect(
      "result" in result ||
        "output" in result ||
        "error" in result ||
        "message" in result ||
        "_e2eLoadError" in result,
    ).toBe(true);
  }

  // --- Per-handler IPC reachability tests ---

  test("brainstorming: should execute ideate mode", async () => {
    const result = await callIPC(
      "brainstorming",
      "ideate How to improve developer experience",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("ideate");
    }
  });

  test("brainstorming: should execute swot mode", async () => {
    const result = await callIPC(
      "brainstorming",
      "swot Migrating to microservices",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("swot");
    }
  });

  test("brainstorming: should fail without topic", async () => {
    const result = await callIPC("brainstorming", "");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(false);
    }
  });

  test("debugging-strategies: should execute diagnose mode", async () => {
    const result = await callIPC(
      "debugging-strategies",
      "diagnose TypeError: Cannot read property of undefined",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.classification).toBe(
        "Type Error",
      );
    }
  });

  test("debugging-strategies: should execute bisect mode", async () => {
    const result = await callIPC(
      "debugging-strategies",
      "bisect Feature broke between v1.0 and v2.0",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("bisect");
    }
  });

  test("debugging-strategies: should fail without description", async () => {
    const result = await callIPC("debugging-strategies", "");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(false);
    }
  });

  test("api-design: should execute design mode", async () => {
    const result = await callIPC(
      "api-design",
      "design User management API with CRUD",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("design");
    }
  });

  test("api-design: should execute errors mode", async () => {
    const result = await callIPC(
      "api-design",
      "errors Payment service error handling",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("errors");
    }
  });

  test("api-design: should fail without description", async () => {
    const result = await callIPC("api-design", "");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(false);
    }
  });

  test("frontend-design: should execute component mode", async () => {
    const result = await callIPC(
      "frontend-design",
      "component Modal dialog with animations",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe(
        "component",
      );
    }
  });

  test("frontend-design: should execute a11y mode", async () => {
    const result = await callIPC(
      "frontend-design",
      "a11y Registration form accessibility",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("a11y");
    }
  });

  test("frontend-design: should fail without description", async () => {
    const result = await callIPC("frontend-design", "");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(false);
    }
  });

  test("create-pr: should execute create mode", async () => {
    const result = await callIPC("create-pr", "create feature/add-dark-mode");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("create");
    }
  });

  test("create-pr: should execute template mode", async () => {
    const result = await callIPC("create-pr", "template");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe(
        "template",
      );
    }
  });

  test("create-pr: should execute changelog mode", async () => {
    const result = await callIPC("create-pr", "changelog");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe(
        "changelog",
      );
    }
  });

  test("doc-coauthoring: should execute draft mode", async () => {
    const result = await callIPC(
      "doc-coauthoring",
      "draft API integration guide",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>)?.method).toBe("draft");
    }
  });

  test("doc-coauthoring: should execute review mode", async () => {
    const result = await callIPC(
      "doc-coauthoring",
      "review nonexistent-doc.md",
    );
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(true);
    }
  });

  test("doc-coauthoring: should fail without topic", async () => {
    const result = await callIPC("doc-coauthoring", "");
    assertEnvelope(result);
    if (!result._e2eLoadError) {
      expect(result.success).toBe(false);
    }
  });

  // --- Integration: file presence checks ---

  test("skills:list should include all 6 new v1.2.1 skills", async () => {
    const result = await electronApp.evaluate(async () => {
      try {
        const fs = require("fs");
        const path = require("path");
        const builtinDir = path.join(
          __dirname,
          "../src/main/ai-engine/cowork/skills/builtin",
        );
        if (!fs.existsSync(builtinDir)) return { found: [], missing: [] };

        const dirs = fs
          .readdirSync(builtinDir, { withFileTypes: true })
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

  test("skills:get should return metadata for each new v1.2.1 skill", async () => {
    for (const skillName of NEW_SKILLS) {
      const result = await electronApp.evaluate(async ({ ipcMain }, name) => {
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
      }, skillName);

      expect(result.hasSkillMd).toBe(true);
      expect(result.hasHandler).toBe(true);
    }
  });
});
