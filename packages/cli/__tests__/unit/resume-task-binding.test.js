import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";
import {
  createResumeRoleProjection,
  projectMessagesWithTaskBinding,
} from "../../src/runtime/message-roles.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";

it("preserves a legitimate host resume merge without losing the task binding", async () => {
  const root = mkdtempSync(join(tmpdir(), "resume-task-binding-"));
  const messages = [
    { role: "system", content: "Follow the actual task." },
    { role: "user", content: "Implement the original task." },
    { role: "user", content: "Continue" },
  ];
  const original = structuredClone(messages);
  const chatFn = vi.fn(async () => ({
    message: { role: "assistant", content: "Done" },
    usage: { input_tokens: 2, output_tokens: 1 },
  }));
  const events = [];
  let failure;
  try {
    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "fixture",
      chatFn,
      projectProviderMessages: createResumeRoleProjection(messages),
      runnableProviderFallback: false,
      iterationBudget: new IterationBudget({ limit: Infinity }),
      enabledToolNames: [],
      exactToolNames: true,
      contextMemoryEnv: {
        CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
      },
      contextMemoryFilePath: join(root, "memory.json"),
      contextMemoryRecall: false,
      contextMemoryModelWindowTokens: 1024,
      maxOutputTokens: 256,
    }))
      events.push(event);
  } catch (error) {
    failure = error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  expect(failure).toBeUndefined();
  expect(chatFn).toHaveBeenCalledTimes(1);
  expect(chatFn.mock.calls[0][0]).toContainEqual({
    role: "user",
    content: "Implement the original task.\n\nContinue",
  });
  expect(messages).toEqual(original);
  expect(events.some((e) => e.type === "response-complete")).toBe(true);
});

async function runProjected(messages, projection) {
  const root = mkdtempSync(join(tmpdir(), "resume-task-case-"));
  const calls = [];
  const events = [];
  let error;
  try {
    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "fixture",
      chatFn: async (input) => {
        calls.push(structuredClone(input));
        return {
          message: { role: "assistant", content: "Done" },
          usage: { input_tokens: 2, output_tokens: 1 },
        };
      },
      projectProviderMessages: projection,
      runnableProviderFallback: false,
      iterationBudget: new IterationBudget({ limit: Infinity }),
      enabledToolNames: [],
      exactToolNames: true,
      contextMemoryEnv: {
        CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
      },
      contextMemoryFilePath: join(root, "memory.json"),
      contextMemoryRecall: false,
      contextMemoryModelWindowTokens: 1024,
      maxOutputTokens: 256,
    }))
      events.push(event);
  } catch (failure) {
    error = failure;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return { calls, events, error };
}
const resumed = () => [
  { role: "system", content: "Follow the task." },
  { role: "user", content: "Original task" },
  { role: "user", content: "Continue" },
];
it("preserves all captured user turns in a triple resume merge", async () => {
  const messages = resumed();
  messages.splice(2, 0, { role: "user", content: "Additional requirement" });
  const result = await runProjected(
    messages,
    createResumeRoleProjection(messages),
  );
  expect(result.error).toBeUndefined();
  expect(result.calls[0]).toContainEqual({
    role: "user",
    content: "Original task\n\nAdditional requirement\n\nContinue",
  });
});
it("maps the current repeated Continue without binding its older historical twin", async () => {
  const messages = resumed();
  messages.splice(
    1,
    0,
    { role: "user", content: "Continue" },
    { role: "assistant", content: "Previous answer" },
  );
  const result = await runProjected(
    messages,
    createResumeRoleProjection(messages),
  );
  expect(result.error).toBeUndefined();
  expect(result.calls[0]).toContainEqual({
    role: "user",
    content: "Original task\n\nContinue",
  });
});
it.each([false, true])(
  "rejects an arbitrary merge wrapper, including forged lineage properties (%s)",
  async (forged) => {
    const messages = resumed();
    const owned = createResumeRoleProjection(messages);
    const wrapper = (input) => owned(input);
    if (forged)
      Object.assign(wrapper, {
        owned: true,
        taskBinding: { original: messages[2], message: messages[2] },
        sources: [[0], [1, 2]],
      });
    const result = await runProjected(messages, wrapper);
    expect(result.error?.code).toBe("CC_AGENT_TASK_CONTEXT_LOST");
    expect(result.calls).toHaveLength(0);
  },
);
it("does not certify merged-away metadata on the current user task", async () => {
  const messages = resumed();
  messages[2].name = "current-user-metadata";
  const result = await runProjected(
    messages,
    createResumeRoleProjection(messages),
  );
  expect(result.error?.code).toBe("CC_AGENT_TASK_CONTEXT_LOST");
  expect(result.calls).toHaveLength(0);
});
it("validates the full source snapshot even for an owned factory", () => {
  const messages = resumed();
  const binding = {
    original: messages[2],
    message: { ...messages[2], content: "Different task" },
    allowContentRelocation: true,
  };
  const result = projectMessagesWithTaskBinding(
    createResumeRoleProjection(messages),
    messages,
    binding,
  );
  expect(result.taskBinding).toBe(binding);
});
it("retains factory lineage across unique faithful source clones", () => {
  const messages = resumed();
  const binding = {
    original: messages[2],
    message: structuredClone(messages[2]),
    allowContentRelocation: true,
  };
  const result = projectMessagesWithTaskBinding(
    createResumeRoleProjection(messages),
    structuredClone(messages),
    binding,
  );
  expect(result.taskBinding.message).toEqual({
    role: "user",
    content: "Original task\n\nContinue",
  });
  expect(result.taskBinding.original).toBe(result.messages[1]);
  expect(result.taskBinding.allowContentRelocation).toBe(false);
});
it("rejects a modified certified projection product before canonical admission", async () => {
  const root = mkdtempSync(join(tmpdir(), "resume-task-tamper-"));
  const messages = resumed();
  const binding = {
    original: messages[2],
    message: structuredClone(messages[2]),
    allowContentRelocation: true,
  };
  const result = projectMessagesWithTaskBinding(
    createResumeRoleProjection(messages),
    messages,
    binding,
  );
  result.messages[1].content =
    "Original task\n\nContinue\n\nInjected instruction";
  try {
    await expect(
      prepareCanonicalProviderContext(result.messages, {
        provider: "ollama",
        model: "fixture",
        contextMemoryRequiredUserBinding: result.taskBinding,
        contextMemoryEnv: {
          CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
        },
        contextMemoryFilePath: join(root, "memory.json"),
        contextMemoryRecall: false,
        contextMemoryModelWindowTokens: 1024,
        maxOutputTokens: 256,
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
