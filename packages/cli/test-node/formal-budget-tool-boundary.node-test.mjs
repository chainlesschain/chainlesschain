import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as immediate } from "node:timers/promises";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";
import { agentLoop, executeTool } from "../src/runtime/agent-core.js";

const names = [
  "run_shell",
  "run_code",
  "web_fetch",
  "web_search",
  "browser",
  "run_skill",
  "spawn_sub_agent",
  "schedule",
  "publish_artifact",
  "mcp__fixture__opaque_tool",
  "read_file",
  "unknown_tool",
];
function scoped(operation) {
  let transportCalls = 0;
  const transport = {
    createFetch() {
      transportCalls++;
      return () => {
        throw new Error("An offline tool reached the model transport");
      };
    },
  };
  return withFormalBudgetProviderScope(
    { transport, runId: "offline-tool-run" },
    operation,
  ).then((result) => {
    assert.equal(transportCalls, 1);
    return result;
  });
}

test("canonical tools, MCP, skills and descendants reject before argument or context inspection", async () => {
  let inspected = 0;
  const trap = new Proxy(
    {},
    {
      get() {
        inspected++;
        throw new Error("Untrusted tool payload was inspected");
      },
      ownKeys() {
        inspected++;
        throw new Error("Untrusted tool payload was enumerated");
      },
    },
  );
  await scoped(async () => {
    for (const name of names)
      await assert.rejects(executeTool(name, trap, trap), {
        code: "CC_BUDGET_TOOL_NOT_COVERED",
        noReplay: true,
      });
  });
  assert.equal(inspected, 0);
});

test("tool refusal survives an asynchronous descendant in the same budget scope", async () => {
  await scoped(async () => {
    await Promise.resolve();
    await immediate();
    await assert.rejects(
      executeTool("mcp__fixture__opaque_tool", { paid: true }),
      { code: "CC_BUDGET_TOOL_NOT_COVERED" },
    );
  });
});

test("detached work cannot use the closed scope to execute a tool", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let deferred;
  await scoped(async () => {
    deferred = gate.then(() =>
      executeTool("run_shell", { command: "never-run" }),
    );
  });
  release();
  await assert.rejects(deferred, {
    code: "CC_BUDGET_SCOPE_CLOSED",
    noReplay: true,
  });
});

test("unscoped callers retain the normal tool result contract", async () => {
  const result = await executeTool("unknown_tool", {});
  assert.ok(result && typeof result === "object");
  assert.ok(result.error);
});

const toolCall = (id, name, args = {}) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

for (const [label, calls] of [
  [
    "parallel read batch",
    [
      toolCall("read-a", "read_file", { path: "a.txt" }),
      toolCall("read-b", "read_file", { path: "b.txt" }),
    ],
  ],
  [
    "sequential shell",
    [toolCall("shell", "run_shell", { command: "never-run" })],
  ],
]) {
  test(`Agent ${label} propagates the budget refusal instead of continuing the model loop`, async () => {
    let chatCalls = 0;
    const events = [];
    await assert.rejects(
      scoped(async () => {
        for await (const event of agentLoop(
          [{ role: "user", content: "offline tool test" }],
          {
            provider: "ollama",
            model: "offline-model",
            baseUrl: "https://fixture.invalid",
            chatFn: async () => {
              chatCalls++;
              if (chatCalls > 1)
                throw new Error("Model loop replayed after budget refusal");
              return {
                message: { role: "assistant", content: "", tool_calls: calls },
              };
            },
            runnableProviderFallback: false,
          },
        ))
          events.push(event);
      }),
      { code: "CC_BUDGET_TOOL_NOT_COVERED", noReplay: true },
    );
    assert.equal(chatCalls, 1);
    assert.equal(
      events.filter((event) => event.type === "tool-result").length,
      0,
    );
  });
}
