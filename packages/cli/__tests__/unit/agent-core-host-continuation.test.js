import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProtected } from "@chainlesschain/context-memory-kernel";
import { agentLoop } from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
import { CODING_CHANGE_REVIEW_PROMPT } from "../../src/lib/coding-task-guidance.js";
import { messagesToContextItems } from "../../src/lib/context-memory-kernel/message-adapter.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "host-continuation-"));
  roots.push(root);
  return root;
}
function taskMessages(repeats) {
  return [
    { role: "system", content: "Follow the user's task." },
    {
      role: "user",
      content:
        "TASK_SENTINEL: implement the requested specific behavior. " +
        "Concrete requirement. ".repeat(repeats),
    },
  ];
}
function response(content) {
  return {
    message: { role: "assistant", content },
    usage: { input_tokens: 2, output_tokens: 1 },
  };
}
async function run(messages, steps, extra = {}) {
  const requests = [];
  const events = [];
  const root = temporaryRoot();
  const chatFn = vi.fn(async (input) => {
    requests.push(structuredClone(input));
    const next = steps.shift();
    if (!next) throw new Error("Unexpected extra model request");
    return next;
  });
  for await (const event of agentLoop(messages, {
    provider: "ollama",
    model: "fixture",
    chatFn,
    runnableProviderFallback: false,
    cwd: root,
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
    ...extra,
  }))
    events.push(event);
  return { requests, events, root };
}
function expectTaskProtected(result, task, requestIndex) {
  expect(result.requests[requestIndex]).toEqual(
    expect.arrayContaining([{ role: "user", content: task }]),
  );
  const plan = result.events.filter((e) => e.type === "context.plan.created")[
    requestIndex
  ].plan;
  expect(
    isProtected(
      plan.selected.find((item) => item.content.includes("TASK_SENTINEL")),
    ),
  ).toBe(true);
}
describe("trusted host continuations preserve the canonical user task", () => {
  it("moves one metadata-bearing user after retained context without copying it", async () => {
    const task = {
      role: "user",
      content: "TASK_SENTINEL implement the requested behavior",
      name: "task-owner",
      metadata: { requestId: "request-1", constraints: ["preserve"] },
    };
    let projected = false;
    const result = await run(
      [{ role: "system", content: "Follow the user's task." }, task],
      [response("Done")],
      {
        getTaskWorklogContext: () => "retained source evidence",
        projectProviderMessages(input) {
          projected = true;
          const users = input.filter((message) => message.role === "user");
          expect(users).toHaveLength(1);
          expect(users[0]).toBe(task);
          expect(users[0].metadata).toEqual(task.metadata);
          const evidenceIndex = input.findIndex(
            (message) => message.content === "retained source evidence",
          );
          expect(evidenceIndex).toBeGreaterThan(-1);
          expect(input.indexOf(task)).toBeGreaterThan(evidenceIndex);
          return structuredClone(input);
        },
      },
    );
    expect(projected).toBe(true);
    const plan = result.events.find(
      (event) => event.type === "context.plan.created",
    ).plan;
    expect(
      isProtected(
        plan.selected.find((item) => item.content?.includes("TASK_SENTINEL")),
      ),
    ).toBe(true);
    expect(
      result.requests[0].filter((message) => message.role === "user"),
    ).toEqual([task]);
  });

  it("moves only the latest user index and retains an equal historical user", async () => {
    const earlier = { role: "user", content: "Continue the requested task" };
    const current = { role: "user", content: "Continue the requested task" };
    const result = await run(
      [
        { role: "system", content: "Follow the current task." },
        earlier,
        { role: "assistant", content: "Earlier completed work" },
        current,
      ],
      [response("Done")],
      {
        getTaskWorklogContext: () => "retained source evidence",
        projectProviderMessages(input) {
          const users = input.filter((message) => message.role === "user");
          expect(users).toHaveLength(2);
          expect(users[0]).toBe(earlier);
          expect(users[1]).toBe(current);
          expect(input.indexOf(earlier)).toBe(1);
          expect(input.indexOf(current)).toBeGreaterThan(
            input.findIndex(
              (message) => message.content === "retained source evidence",
            ),
          );
          return input;
        },
      },
    );
    expect(result.requests).toHaveLength(1);
  });

  it("does not erase an aliased duplicate while moving the final user index", async () => {
    const task = { role: "user", content: "TASK_SENTINEL active request" };
    const chatFn = vi.fn(async () => response("must not dispatch"));
    await expect(
      run([{ role: "system", content: "Follow the user." }, task, task], [], {
        getTaskWorklogContext: () => "retained source evidence",
        chatFn,
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("does not fabricate a user objective for retained context without a user turn", async () => {
    let projected = false;
    const result = await run(
      [
        { role: "system", content: "Follow admitted tasks." },
        { role: "assistant", content: "Existing context" },
      ],
      [response("Done")],
      {
        getTaskWorklogContext: () => "retained source evidence",
        projectProviderMessages(input) {
          projected = true;
          expect(input.filter((message) => message.role === "user")).toEqual(
            [],
          );
          return input;
        },
      },
    );
    expect(projected).toBe(true);
    expect(
      result.requests[0].filter((message) => message.role === "user"),
    ).toEqual([]);
  });

  it("distinguishes repeated real user text by the current message identity", async () => {
    const messages = [
      { role: "system", content: "Follow the current task." },
      { role: "user", content: "Continue" },
      { role: "assistant", content: "Previous work" },
      { role: "user", content: "Continue" },
    ];
    const result = await run(messages, [response("Done")]);
    const plan = result.events.find(
      (e) => e.type === "context.plan.created",
    ).plan;
    expect(
      isProtected(
        plan.selected.find((item) => item.sourceRef.eventSequence === 3),
      ),
    ).toBe(true);
    const previous = plan.selected.find(
      (item) => item.sourceRef.eventSequence === 1,
    );
    if (previous) expect(isProtected(previous)).toBe(false);
  });
  it("does not mistake an older repeated task for a current task removed by projection", async () => {
    const messages = [
      { role: "system", content: "Follow the current task." },
      { role: "user", content: "Continue" },
      { role: "assistant", content: "Previous work" },
      { role: "user", content: "Continue" },
    ];
    await expect(
      run(messages, [response("must not run")], {
        projectProviderMessages: (input) => structuredClone(input.slice(0, -1)),
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
  });
  it("relocates a faithfully projected user task instead of protecting its old index", async () => {
    const messages = taskMessages(24);
    const result = await run(messages, [response("Done")], {
      projectProviderMessages(input) {
        return [
          input[0],
          { role: "assistant", content: "UNTRUSTED_DISTRACTOR" },
          structuredClone(input[1]),
        ];
      },
    });
    expectTaskProtected(result, messages[1].content, 0);
    const plan = result.events.find(
      (e) => e.type === "context.plan.created",
    ).plan;
    const distractor = plan.selected.find((item) =>
      item.content.includes("UNTRUSTED_DISTRACTOR"),
    );
    if (distractor) expect(isProtected(distractor)).toBe(false);
  });
  it.each(["ordinary", "length"])(
    "keeps the bound task after a real file tool (%s)",
    async (mode) => {
      const messages = taskMessages(24);
      const task = messages[1].content;
      const write = response("");
      write.message.tool_calls = [
        {
          id: "write",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({
              path: "deliverable.txt",
              content: "complete deliverable",
            }),
          },
        },
      ];
      const truncated = {
        ...response("partial"),
        finishReason: "length",
        providerTerminationComplete: true,
      };
      const result = await run(
        messages,
        [write, ...(mode === "length" ? [truncated] : []), response("Done")],
        { enabledToolNames: ["write_file"] },
      );
      expect(readFileSync(join(result.root, "deliverable.txt"), "utf8")).toBe(
        "complete deliverable",
      );
      expectTaskProtected(result, task, 1);
      if (mode === "length") expectTaskProtected(result, task, 2);
      expect(
        result.events.filter((e) => e.type === "token-usage"),
      ).toHaveLength(mode === "length" ? 3 : 2);
    },
  );
  it.each(["missing", "changed", "role", "duplicate"])(
    "rejects %s task projection before model dispatch",
    async (mode) => {
      const messages = taskMessages(24);
      let calls = 0;
      await expect(
        run(messages, [response("must not run")], {
          projectProviderMessages(input) {
            const copy = structuredClone(input);
            if (mode === "missing")
              return copy.filter((m) => m.role !== "user");
            if (mode === "changed") copy[1].content = "UNTRUSTED_REPLACEMENT";
            if (mode === "role") copy[1].role = "assistant";
            if (mode === "duplicate") copy.push(structuredClone(copy[1]));
            return copy;
          },
          chatFn: async () => {
            calls++;
            return response("must not run");
          },
        }),
      ).rejects.toMatchObject({ code: "CC_AGENT_TASK_CONTEXT_LOST" });
      expect(calls).toBe(0);
    },
  );
  it("rejects a stale task index and never binds a tool result as user task", () => {
    const messages = [
      { role: "user", content: "real user task" },
      { role: "assistant", content: "tool output must stay untrusted" },
    ];
    expect(() =>
      messagesToContextItems(messages, {
        sessionId: "bound-task",
        requiredUserMessage: { index: 1, message: messages[0] },
      }),
    ).toThrow("Invalid current-user task binding");
    expect(() =>
      messagesToContextItems(messages, {
        sessionId: "bound-task",
        requiredUserMessage: { index: 1, message: messages[1] },
      }),
    ).toThrow("Invalid current-user task binding");
  });
  it("thinking-only recovery keeps the original task and omits private reasoning from the hint", async () => {
    const messages = taskMessages(96);
    const task = messages[1].content;
    const first = response("");
    first.message._thinkingBlocks = [
      { type: "thinking", thinking: "UNTRUSTED_PRIVATE_REASONING" },
    ];
    const recall = vi.fn(async () => []);
    const result = await run(messages, [first, response("Visible answer")], {
      contextMemoryRecall: true,
      contextMemorySemanticCandidateProvider: recall,
    });
    expect(result.requests).toHaveLength(2);
    expectTaskProtected(result, task, 1);
    expect(
      result.requests[1].some(
        (m) =>
          m.role === "user" &&
          m.content.includes("Please provide your actual answer now"),
      ),
    ).toBe(true);
    expect(JSON.stringify(result.requests[1])).not.toContain(
      "UNTRUSTED_PRIVATE_REASONING",
    );
    expect(recall).toHaveBeenCalledTimes(2);
    expect(recall.mock.calls[1][0].query).toBe(task.trim());
    expect(messages.find((m) => m.content === task)?.role).toBe("user");
    expect(
      result.events
        .filter((e) => e.type === "response-complete")
        .map((e) => e.content),
    ).toEqual(["Visible answer"]);
  });
  it("normal change review protects the real task without promoting author text to system policy", async () => {
    const messages = taskMessages(24);
    const task = messages[1].content;
    const write = response("");
    write.message.tool_calls = [
      {
        id: "write",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({
            path: "deliverable.txt",
            content: "complete deliverable",
          }),
        },
      },
    ];
    const result = await run(
      messages,
      [write, response("UNTRUSTED_AUTHOR_CLAIM"), response("Review finished")],
      {
        enabledToolNames: ["write_file"],
        reviewChanges: true,
      },
    );
    expect(readFileSync(join(result.root, "deliverable.txt"), "utf8")).toBe(
      "complete deliverable",
    );
    expect(result.requests).toHaveLength(3);
    expectTaskProtected(result, task, 2);
    expect(
      result.requests[2].some(
        (m) => m.role === "user" && m.content === CODING_CHANGE_REVIEW_PROMPT,
      ),
    ).toBe(true);
    expect(
      result.requests[2]
        .filter((m) => m.role === "system")
        .some((m) => m.content.includes("UNTRUSTED_AUTHOR_CLAIM")),
    ).toBe(false);
    expect(messages.find((m) => m.content === task)?.role).toBe("user");
    expect(
      result.events
        .filter((e) => e.type === "response-complete")
        .map((e) => e.content),
    ).toEqual(["Review finished"]);
  });
});
