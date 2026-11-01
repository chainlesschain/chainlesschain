import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactLiveMessagesCanonical } from "../../src/lib/context-memory-kernel/live-compaction.js";
import {
  startSession,
  appendCompactEvent,
  appendAuthorityEvent,
  readVerifiedMessages,
} from "../../src/harness/jsonl-session-store.js";
import {
  createResumeRoleProjection,
  getTaskCompactionBindings,
  projectMessagesWithTaskBinding,
} from "../../src/runtime/message-roles.js";

let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cc-task-compact-"));
  vi.stubEnv("CHAINLESSCHAIN_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});
const env = { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" };
function fixture() {
  const task = {
    role: "user",
    content: "Implement exact original requirements",
    name: "owner",
    taskId: "unique-137",
  };
  const messages = [
    task,
    ...Array.from({ length: 30 }, (_, index) => ({
      role: "assistant",
      content: `Progress ${index} ${"detail ".repeat(300)}`,
    })),
  ];
  const binding = {
    original: task,
    message: structuredClone(task),
    allowContentRelocation: true,
  };
  return { messages, task, binding };
}
function options(binding, extra = {}) {
  return {
    env,
    persist: false,
    requiredUserBindings: [binding],
    memoryFilePath: join(home, "memory.json"),
    compressor: {
      maxTokens: 2048,
      compress: vi.fn(async () => ({
        messages: [{ role: "assistant", content: "Bounded summary" }],
        stats: { saved: 100 },
      })),
    },
    ...extra,
  };
}
it.each(["memory", "callback", "jsonl", "jsonl-callback"])(
  "retains the exact early task and metadata through %s canonical compaction",
  async (mode) => {
    const { messages, task, binding } = fixture();
    const opts = options(binding);
    if (mode.startsWith("jsonl")) {
      opts.sessionId = startSession();
      appendCompactEvent(opts.sessionId, { messages });
      opts.persist = true;
    }
    let committed;
    if (mode.endsWith("callback"))
      opts.commit = vi.fn(async (stats, output) => {
        committed = structuredClone(output);
        if (opts.persist) {
          const event = appendAuthorityEvent(opts.sessionId, "compact", {
            ...stats,
            messages: output,
          });
          return { newHead: event.hash };
        }
        return true;
      });
    const result = await compactLiveMessagesCanonical(messages, opts);
    expect(result.receipt.status).toBe("committed");
    expect(
      result.messages.filter((message) => message.role === "user"),
    ).toEqual([task]);
    expect(opts.compressor.compress.mock.calls[0][0]).not.toContainEqual(task);
    if (committed) expect(committed).toContainEqual(task);
    if (opts.persist)
      expect(readVerifiedMessages(opts.sessionId)).toContainEqual(task);
  },
);
it.each(["loss", "rewrite", "duplicate"])(
  "rejects %s before summarization or commit",
  async (kind) => {
    const { messages, binding } = fixture();
    if (kind === "loss") messages.shift();
    if (kind === "rewrite") messages[0].content = "Changed task";
    if (kind === "duplicate") messages.push(structuredClone(messages[0]));
    const commit = vi.fn();
    const opts = options(binding, { commit });
    await expect(
      compactLiveMessagesCanonical(messages, opts),
    ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
    expect(opts.compressor.compress).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  },
);
it("rejects a summary that duplicates the protected task before commit", async () => {
  const { messages, task, binding } = fixture();
  const commit = vi.fn();
  const opts = options(binding, { commit });
  opts.compressor.compress.mockResolvedValue({
    messages: [structuredClone(task)],
    stats: { saved: 100 },
  });
  const original = structuredClone(messages);
  await expect(
    compactLiveMessagesCanonical(messages, opts),
  ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
  expect(commit).not.toHaveBeenCalled();
  expect(messages).toEqual(original);
});
it("preserves the original sources of an owned resume merge across compaction", async () => {
  const { messages } = fixture();
  messages[0] = { role: "user", content: "Original requirements" };
  const task = { role: "user", content: "Continue" };
  messages.splice(1, 0, task);
  const binding = {
    original: task,
    message: structuredClone(task),
    allowContentRelocation: true,
  };
  const projection = createResumeRoleProjection(messages);
  const result = await compactLiveMessagesCanonical(
    messages,
    options(binding, {
      requiredUserBindings: getTaskCompactionBindings(
        projection,
        messages,
        binding,
      ),
    }),
  );
  expect(result.receipt.status).toBe("committed");
  const projected = projectMessagesWithTaskBinding(
    projection,
    result.messages,
    binding,
  );
  expect(projected.taskBinding.message.content).toBe(
    "Original requirements\n\nContinue",
  );
  expect(projected.messages).toContainEqual(projected.taskBinding.message);
});

it("does not weaken the budget when the original task alone is too large", async () => {
  const { messages, task } = fixture();
  task.content = "Required original constraint ".repeat(4000);
  const binding = {
    original: task,
    message: structuredClone(task),
    allowContentRelocation: true,
  };
  const commit = vi.fn();
  const original = structuredClone(messages);
  await expect(
    compactLiveMessagesCanonical(messages, options(binding, { commit })),
  ).rejects.toMatchObject({ code: "context_over_budget" });
  expect(commit).not.toHaveBeenCalled();
  expect(messages).toEqual(original);
});

it.each([false, true])(
  "uses host source identity for repeated Continue across two compactions; persistent=%s",
  async (persistent) => {
    const { messages } = fixture();
    const old = { role: "user", content: "Continue" };
    const current = { role: "user", content: "Continue" };
    messages.splice(
      0,
      1,
      old,
      { role: "assistant", content: "Prior response" },
      current,
    );
    const binding = {
      original: current,
      message: structuredClone(current),
      allowContentRelocation: false,
    };
    const bindings = getTaskCompactionBindings(undefined, messages, binding);
    const opts = options(binding, { requiredUserBindings: bindings });
    if (persistent) {
      opts.sessionId = startSession();
      appendCompactEvent(opts.sessionId, { messages });
      opts.persist = true;
    }
    const first = await compactLiveMessagesCanonical(messages, opts);
    expect(first.receipt.status).toBe("committed");
    expect(
      first.messages.filter((message) => message === current),
    ).toHaveLength(1);
    const second = await compactLiveMessagesCanonical(first.messages, opts);
    expect(second.receipt.status).toBe("committed");
    expect(
      second.messages.filter((message) => message === current),
    ).toHaveLength(1);
    second.messages.push({ ...current, sourceIndex: 2, original: true });
    second.messages.push(structuredClone(current));
    await expect(
      compactLiveMessagesCanonical(second.messages, opts),
    ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
  },
);

it.each(["loss", "rewrite", "duplicate"])(
  "rejects asynchronous live %s before durable commit",
  async (kind) => {
    const { messages, binding } = fixture();
    const commit = vi.fn();
    const opts = options(binding, { commit });
    opts.compressor.compress.mockImplementation(async () => {
      if (kind === "loss") messages.shift();
      if (kind === "rewrite") messages[0].content = "Changed task";
      if (kind === "duplicate") messages.push(structuredClone(messages[0]));
      return {
        messages: [{ role: "assistant", content: "Bounded summary" }],
        stats: { saved: 100 },
      };
    });
    await expect(
      compactLiveMessagesCanonical(messages, opts),
    ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
    expect(commit).not.toHaveBeenCalled();
  },
);

it("admits a faithful older identical user from verified dropped summary parents", async () => {
  const current = {
    role: "user",
    content: "Continue with the same requirement. ".repeat(12),
  };
  const messages = Array.from({ length: 20 }, () => structuredClone(current));
  messages.push(
    { role: "assistant", content: "Previous result" },
    current,
    ...fixture().messages.slice(1),
  );
  const binding = {
    original: current,
    message: structuredClone(current),
    allowContentRelocation: false,
  };
  const opts = options(binding, {
    requiredUserBindings: getTaskCompactionBindings(
      undefined,
      messages,
      binding,
    ),
  });
  opts.compressor.compress.mockImplementation(async (dropped) => {
    expect(dropped).toContainEqual(current);
    return {
      messages: [
        { role: "assistant", content: "Summary" },
        structuredClone(current),
      ],
      stats: { saved: 100 },
    };
  });
  const result = await compactLiveMessagesCanonical(messages, opts);
  expect(result.receipt.status).toBe("committed");
  expect(result.messages.filter((message) => message === current)).toHaveLength(
    1,
  );
  expect(
    result.messages.filter((message) => message.role === "user").length,
  ).toBeLessThanOrEqual(21);
});
