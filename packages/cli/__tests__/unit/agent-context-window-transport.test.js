import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";

// Fault injection reproduces the old boundary: automatic compaction received
// no current-task binding. The planner and provider guard remain real.
const baseline = vi.hoisted(() => ({ omitTaskBinding: false }));
vi.mock(
  "../../src/lib/context-memory-kernel/live-compaction.js",
  async (original) => {
    const actual = await original();
    return {
      ...actual,
      compactLiveMessagesCanonical: (messages, options) => {
        baseline.budget = options.compressor.getCompactionTokenBudget(messages);
        return actual.compactLiveMessagesCanonical(
          messages,
          baseline.omitTaskBinding
            ? { ...options, requiredUserBindings: [] }
            : options,
        );
      },
    };
  },
);

afterEach(() => {
  baseline.omitTaskBinding = false;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const summary = JSON.stringify({
  objective: "Continue the task",
  constraints: [],
  keyDecisions: [],
  changedFiles: [],
  tests: [],
  unresolvedSideEffects: [],
  checkpoints: [],
  blockers: [],
  nextSteps: ["Verify the result"],
});

function history(toolTail = false) {
  const messages = [{ role: "system", content: "Preserve task constraints." }];
  if (toolTail)
    messages.push({
      role: "user",
      content: "Implement and verify the original task. ".repeat(100),
      name: "original-task-owner",
      taskId: "task-137",
    });
  for (let i = 0; i < 36; i++) {
    if (!toolTail)
      messages.push({ role: "user", content: `Inspect file ${i}` });
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `call_${i}`,
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: `file-${i}.txt` }),
          },
        },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: `call_${i}`,
      content: JSON.stringify({
        content: Array.from({ length: 80 }, (_, j) =>
          String.fromCodePoint(0x4e00 + i * 80 + j),
        )
          .join("")
          .repeat(10),
      }),
    });
    messages.push({
      role: "assistant",
      content: Array.from({ length: 80 }, (_, j) =>
        String.fromCodePoint(0x6000 + i * 80 + j),
      )
        .join("")
        .repeat(80),
    });
  }
  if (!toolTail)
    messages.push({ role: "user", content: "Continue verification." });
  return messages;
}

describe("operator window synthetic Responses preflight", () => {
  it.each([
    [false, false, false, false],
    [true, false, false, false],
    [false, true, false, false],
    [true, true, false, false],
    [false, true, true, true],
    [false, true, false, true],
  ])(
    "bounds serialized compaction requests; protected overflow=%s tool tail=%s binding omitted=%s large handoff=%s",
    async (
      protectedOverflow,
      toolTail,
      omitTaskBinding = false,
      largeHandoff = false,
    ) => {
      baseline.omitTaskBinding = omitTaskBinding;
      const cwd = mkdtempSync(join(tmpdir(), "cc-window-wire-"));
      vi.stubEnv("CHAINLESSCHAIN_HOME", cwd);
      const bodies = [];
      const fetch = vi.fn(async (url, init) => {
        expect(String(url)).toMatch(/\/responses$/);
        const body = JSON.parse(init.body);
        bodies.push(body);
        expect(Buffer.byteLength(init.body)).toBeLessThanOrEqual(256 * 1024);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: `resp_${bodies.length}`,
            status: "completed",
            model: "gpt-6.1-sol",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text:
                      bodies.length === 1
                        ? largeHandoff
                          ? JSON.stringify({
                              ...JSON.parse(summary),
                              objective:
                                String.fromCodePoint(0x6458).repeat(4000),
                            })
                          : summary
                        : "done",
                  },
                ],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          }),
        };
      });
      vi.stubGlobal("fetch", fetch);
      const messages = history(toolTail);
      if (largeHandoff)
        messages[1].content = "Implement and verify the original task. ".repeat(
          400,
        );
      const task = structuredClone(
        messages.findLast((message) => message.role === "user"),
      );
      if (protectedOverflow)
        messages[0].content = "Protected constraint ".repeat(20000);
      const events = [];
      let failure;
      try {
        try {
          for await (const event of agentLoop(messages, {
            cwd,
            provider: "openai",
            model: "gpt-6.1-sol",
            apiKey: "test-key",
            baseUrl: "https://api.openai.com/v1",
            contextMemoryModelWindowTokens: 32768,
            contextMemoryEnv: {
              CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
            },
            contextMemoryFilePath: join(cwd, "kernel.json"),
            maxOutputTokens: 8192,
            enabledToolNames: [],
            autoMicroCompact: false,
            persistCompaction: false,
            iterationBudget: new IterationBudget({ limit: 2 }),
            onUsageBoundary: () => {},
          }))
            events.push(event);
        } catch (error) {
          failure = error;
        }
        expect(bodies.length).toBeGreaterThan(0);
        if (omitTaskBinding) {
          expect(
            failure?.code,
            JSON.stringify({
              failure: String(failure),
              events: events.map(({ type, code, reason, error }) => ({
                type,
                code,
                reason,
                error,
              })),
              requests: bodies.length,
              compactionBudget: baseline.budget,
            }),
          ).toBe("CC_AGENT_TASK_CONTEXT_LOST");
          expect(events.some((event) => event.type === "compaction")).toBe(
            true,
          );
          expect(bodies).toHaveLength(1);
          expect(
            events.some((event) => event.type === "response-complete"),
          ).toBe(false);
        } else if (protectedOverflow) {
          expect(bodies).toHaveLength(1);
          expect(events.some((event) => event.type === "compaction")).toBe(
            false,
          );
          expect(
            failure ||
              events.find(
                (e) => e.type === "compaction-degraded" || e.type === "error",
              ),
          ).toBeTruthy();
          expect(events.some((e) => e.type === "response-complete")).toBe(
            false,
          );
        } else {
          expect(failure).toBeUndefined();
          expect(events.some((e) => e.type === "compaction")).toBe(true);
          expect(
            bodies,
            JSON.stringify(
              events.map((e) => ({
                type: e.type,
                reason: e.reason,
                error: e.error,
              })),
            ),
          ).toHaveLength(2);
          expect(bodies[1].max_output_tokens).toBe(8192);
          if (toolTail)
            expect(
              bodies[1].input.filter((message) => message.role === "user"),
            ).toHaveLength(1);
          expect(JSON.stringify(bodies[1].input)).toContain(task.content);
          expect(
            events.find((e) => e.type === "context.plan.created")?.plan
              .inputBudget,
          ).toBe(22938);
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
  it("does not replenish an exhausted iteration budget to compact or call the model", async () => {
    const budget = new IterationBudget({ limit: 1 });
    budget.consume();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const events = [];
    for await (const event of agentLoop(history(), {
      provider: "openai",
      model: "gpt-6.1-sol",
      apiKey: "test-key",
      contextMemoryModelWindowTokens: 32768,
      maxOutputTokens: 8192,
      iterationBudget: budget,
      enabledToolNames: [],
    }))
      events.push(event);
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.limit).toBe(1);
    expect(budget.consumed).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: "run-ended",
      reason: "budget-exhausted",
    });
  });
});
