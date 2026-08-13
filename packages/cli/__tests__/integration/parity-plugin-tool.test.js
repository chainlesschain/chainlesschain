/**
 * Parity Harness — plugin-installed skill invocation via `run_skill`
 *
 * Phase 7 Step 5. Drives `agentLoop` with the mock LLM provider to assert
 * the deterministic event stream when the model invokes `run_skill` with
 * a skill that was installed by the plugin system.
 *
 * Plugins, in the CLI runtime, don't register bespoke tool names — they
 * install `SKILL.md` + `handler.js` bundles into the marketplace layer,
 * and those skills are then invoked uniformly through the builtin
 * `run_skill` dispatch path. Direct in-process handler execution is denied;
 * handler-backed skills must opt into the controlled isolated-agent route.
 * The parity concern for a legacy/direct plugin bundle is therefore:
 *
 *   "a skill whose presence is provided by the plugin path is discovered,
 *    but its handler is never invoked, and the policy denial surfaces as a
 *    deterministic structured tool-result without crashing the loop."
 *
 * The physical layout mirrors what `installPluginSkills` produces: a
 * directory with `SKILL.md` + `handler.js`. A minimal stub `skillLoader`
 * is injected via `options.skillLoader` — it returns a single resolved
 * skill pointing at that directory, which is exactly the shape
 * `CLISkillLoader.getResolvedSkills()` yields for marketplace skills.
 * The real `run_skill` executor reaches the production execution boundary;
 * no mocking of the executor path itself is used.
 *
 * Plugin-manager DB mechanics (install/enable/remove) have dedicated
 * unit coverage in `__tests__/unit/plugin-manager.test.js` — this file
 * focuses exclusively on agent-loop parity.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { PlanModeManager } from "../../src/lib/plan-mode.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    if (
      event.type !== "tool-executing" &&
      event.type !== "tool-result" &&
      event.type !== "response-complete"
    ) {
      continue;
    }
    out.push(event);
  }
  return out;
}

/**
 * Write a plugin skill bundle (SKILL.md + handler.js) into `skillDir`.
 * `handlerBody` is an ES module source that must default-export an
 * object with an `execute(task, context, skill)` method.
 */
function writePluginSkill(skillDir, { name, handlerBody }) {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Parity fixture plugin skill\nversion: 1.0.0\ncategory: plugin\n---\n\n# ${name}\n\nFixture body.\n`,
    "utf8",
  );
  writeFileSync(join(skillDir, "handler.js"), handlerBody, "utf8");
}

/**
 * Minimal stub that implements the `skillLoader` contract consumed by
 * the `run_skill` executor: a single `getResolvedSkills()` method
 * returning skill records with `id`, `dirName`, `hasHandler`, and
 * `skillDir`. This matches what `installPluginSkills` +
 * `CLISkillLoader._loadFromDir` would produce for a marketplace-layer
 * skill, without touching the Electron userData directory.
 */
function stubSkillLoader(skills) {
  return {
    getResolvedSkills: () => skills,
  };
}

function buildLoopOptions({ mock, skillLoader, workDir }) {
  return {
    provider: "mock",
    model: "mock-1",
    cwd: workDir,
    chatFn: mock.chatFn,
    skillLoader,
    // Fresh plan manager to avoid singleton leakage
    planManager: new PlanModeManager(),
  };
}

function buildRunSkillScript(skillName, input, finalText = "done") {
  return createMockLLMProvider([
    {
      response: {
        message: mockToolCallMessage(
          "run_skill",
          { skill_name: skillName, input },
          "call_run_skill_1",
        ),
      },
    },
    {
      expect: (messages) =>
        messages.some(
          (m) => m.role === "tool" && m.tool_call_id === "call_run_skill_1",
        ),
      response: { message: mockTextMessage(finalText) },
    },
  ]);
}

describe("Phase 7 parity: plugin-installed skill via run_skill", () => {
  let workDir;
  let pluginRoot;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-plugin-"));
    pluginRoot = mkdtempSync(join(tmpdir(), "parity-plugin-mkt-"));
  });

  afterEach(() => {
    for (const dir of [workDir, pluginRoot]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("SUCCESS-HANDLER: direct plugin execution fails closed before invocation", async () => {
    const skillName = "plugin-greet";
    const skillDir = join(pluginRoot, skillName);
    writePluginSkill(skillDir, {
      name: skillName,
      handlerBody: `
        export default {
          async execute(task, context, skill) {
            return {
              success: true,
              greeting: "hello, " + (task.input || "world"),
              skillName: skill.id,
              workspace: context.workspacePath,
            };
          },
        };
      `,
    });

    const skillLoader = stubSkillLoader([
      {
        id: skillName,
        dirName: skillName,
        hasHandler: true,
        skillDir,
        source: "marketplace",
        mcpServers: [],
        body: `# ${skillName}\n\nFixture body.`,
      },
    ]);

    const mock = buildRunSkillScript(skillName, "parity", "greeted");

    const events = await drain(
      agentLoop([{ role: "user", content: "run it" }], {
        ...buildLoopOptions({ mock, skillLoader, workDir }),
      }),
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "tool-executing",
      tool: "run_skill",
      args: { skill_name: skillName, input: "parity" },
    });

    expect(events[1].type).toBe("tool-result");
    expect(events[1].error).toBeNull();
    expect(events[1].result).toMatchObject({
      code: "CC_SKILL_DIRECT_HANDLER_BLOCKED",
      policy: {
        decision: "blocked",
        via: "skill-execution-boundary",
      },
    });
    expect(events[1].result.error).toMatch(
      /cannot execute handler\.js directly/i,
    );

    expect(events[2]).toEqual({
      type: "response-complete",
      content: "greeted",
    });

    mock.assertDrained();
  });

  it("THROWING-HANDLER: plugin code is not executed before the denial", async () => {
    const skillName = "plugin-boom";
    const skillDir = join(pluginRoot, skillName);
    writePluginSkill(skillDir, {
      name: skillName,
      handlerBody: `
        export default {
          async execute() {
            throw new Error("intentional plugin failure");
          },
        };
      `,
    });

    const skillLoader = stubSkillLoader([
      {
        id: skillName,
        dirName: skillName,
        hasHandler: true,
        skillDir,
        source: "marketplace",
        mcpServers: [],
        body: `# ${skillName}\n\nFixture body.`,
      },
    ]);

    const mock = buildRunSkillScript(skillName, null, "failure noted");

    const events = await drain(
      agentLoop([{ role: "user", content: "run boom" }], {
        ...buildLoopOptions({ mock, skillLoader, workDir }),
      }),
    );

    expect(events[1].type).toBe("tool-result");
    // The policy boundary runs before invoking handler.js, so the handler's
    // own exception cannot replace the stable security error.
    expect(events[1].error).toBeNull();
    expect(events[1].result).toMatchObject({
      code: "CC_SKILL_DIRECT_HANDLER_BLOCKED",
      policy: {
        decision: "blocked",
        via: "skill-execution-boundary",
      },
    });
    expect(events[1].result.error).not.toContain("intentional plugin failure");
    expect(events[2].content).toBe("failure noted");
    mock.assertDrained();
  });

  it("NOT-FOUND: unknown skill name yields a 'not found' tool-result", async () => {
    const skillLoader = stubSkillLoader([
      {
        id: "plugin-greet",
        dirName: "plugin-greet",
        hasHandler: true,
        skillDir: join(pluginRoot, "plugin-greet"),
        source: "marketplace",
        mcpServers: [],
      },
    ]);
    // Intentionally DO NOT write the handler — the dispatch should fail
    // with "not found" before it ever tries to import anything, because
    // the LLM asks for a different skill name.

    const mock = buildRunSkillScript(
      "plugin-does-not-exist",
      null,
      "missing noted",
    );

    const events = await drain(
      agentLoop([{ role: "user", content: "run missing" }], {
        ...buildLoopOptions({ mock, skillLoader, workDir }),
      }),
    );

    expect(events[1].type).toBe("tool-result");
    expect(events[1].result.error).toMatch(
      /Skill "plugin-does-not-exist" not found/,
    );
  });

  it("NO-HANDLER: skill present but hasHandler=false is rejected", async () => {
    const skillName = "plugin-docs-only";
    const skillLoader = stubSkillLoader([
      {
        id: skillName,
        dirName: skillName,
        hasHandler: false,
        skillDir: join(pluginRoot, skillName),
        source: "marketplace",
        mcpServers: [],
      },
    ]);

    const mock = buildRunSkillScript(skillName, null, "cannot run");

    const events = await drain(
      agentLoop([{ role: "user", content: "run docs" }], {
        ...buildLoopOptions({ mock, skillLoader, workDir }),
      }),
    );

    expect(events[1].result.error).toMatch(
      new RegExp(`Skill "${skillName}" not found or has no handler`),
    );
  });
});
