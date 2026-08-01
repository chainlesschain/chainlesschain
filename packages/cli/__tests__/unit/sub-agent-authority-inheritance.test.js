import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-child-authority-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function childWriter(target) {
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "child-write",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: target,
                  content: "must-not-exist",
                }),
              },
            },
          ],
        },
        usage: {},
      };
    }
    return {
      message: { role: "assistant", content: "write attempt complete" },
      usage: {},
    };
  });
}

async function spawnWith(target, context = {}) {
  return executeTool(
    "spawn_sub_agent",
    { role: "worker", task: "attempt the requested write" },
    {
      cwd: tmp,
      parentMessages: [],
      llmOptions: {
        chatFn: childWriter(target),
        runnableProviderFallback: false,
      },
      ...context,
    },
  );
}

describe("sub-agent parent authority inheritance", () => {
  it("rejects malformed explicit authority before invoking the child LLM", async () => {
    const chatFn = vi.fn();
    const result = await executeTool(
      "spawn_sub_agent",
      {
        role: "worker",
        task: "must not start",
        skills: { malformed: true },
      },
      {
        cwd: tmp,
        parentMessages: [],
        llmOptions: { chatFn, runnableProviderFallback: false },
      },
    );

    expect(result.error).toContain(
      "authority contract resolution failed closed",
    );
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("inherits parent settings denies instead of rebuilding default authority", async () => {
    const target = path.join(tmp, "settings-denied.txt");
    const result = await spawnWith(target, {
      permissionRules: { allow: [], ask: [], deny: ["Write"] },
    });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(target)).toBe(false);
  }, 30000);

  it("inherits parent host denies", async () => {
    const target = path.join(tmp, "host-denied.txt");
    const result = await spawnWith(target, {
      hostManagedToolPolicy: {
        tools: {
          write_file: { allowed: false, reason: "managed deny" },
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(target)).toBe(false);
  }, 30000);

  it("intersects the child tool set with the parent effective capability set", async () => {
    const target = path.join(tmp, "capability-denied.txt");
    const result = await spawnWith(target, {
      effectiveAllowedToolNames: ["spawn_sub_agent"],
    });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(target)).toBe(false);
  }, 30000);

  it("reuses the session Plan execution lock inside the child", async () => {
    const target = path.join(tmp, "plan-lock-denied.txt");
    const allowed = new Set(["spawn_sub_agent"]);
    const planManager = {
      executionLock: { allowedTools: [...allowed] },
      isActive: () => true,
      isToolAllowed: (name) => allowed.has(name),
      addPlanItem: vi.fn(),
    };
    const result = await spawnWith(target, { planManager });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(target)).toBe(false);
  }, 30000);
});
