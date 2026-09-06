import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  collectFileReadProgress,
  FILE_READ_PROGRESS_PREFIX,
} from "../../src/lib/read-file-page.js";

describe("interactive long tasks", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-long-task-"));
    vi.stubEnv("CC_ITERATION_BUDGET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(cwd, { recursive: true, force: true });
  });

  it.each(["shadow", "canonical_default"])(
    "finishes an 80-page file task through repeated %s compactions without rereading pages",
    async (stage) => {
      const source = Array.from(
        { length: 80 },
        (_, i) => `section ${i + 1}: ${"text ".repeat(80)}`,
      ).join("\n");
      writeFileSync(join(cwd, "long.txt"), source);
      const lines = [];
      const offsets = [];
      let compactedCalls = 0;
      const chatFn = vi.fn(async (messages) => {
        if (
          messages.some((m) => m.content?.includes(FILE_READ_PROGRESS_PREFIX))
        )
          compactedCalls++;
        const progress = collectFileReadProgress(messages).at(-1);
        if (progress && !progress.nextRead) {
          return {
            message: {
              role: "assistant",
              content: "All 80 sections reviewed.",
            },
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        const args = progress?.nextRead || {
          path: "long.txt",
          offset: 1,
          limit: 1,
        };
        offsets.push(args.offset);
        if (offsets.length > 85)
          throw new Error(
            `file reading made no progress: offsets=${offsets.slice(-12)}; last=${messages.at(-1)?.content?.slice(0, 300)}`,
          );
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `read-${offsets.length}`,
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify(args),
                },
              },
            ],
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      });
      async function* input() {
        yield JSON.stringify({ text: "Review every section of long.txt" }) +
          "\n";
      }
      const outcome = await runAgentHeadlessStream(
        { cwd, expandFileRefs: false, interactiveApprovals: true },
        {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          writeOut: (line) => lines.push(line),
          writeErr: () => {},
          input: input(),
          chatFn,
          agentLoop: (messages, options) =>
            agentLoop(messages, {
              ...options,
              // Exercise real count-based compaction and tool-pair repair without
              // relying on any paid provider for the summarization itself.
              autoMicroCompact: false,
              contextMemoryEnv: {
                CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: stage,
              },
              compactionLlmQuery: async () => ({
                summary: JSON.stringify({
                  objective: "Review all 80 sections",
                  constraints: [],
                  keyDecisions: [],
                  changedFiles: [],
                  tests: [],
                  unresolvedSideEffects: [],
                  checkpoints: [],
                  blockers: [],
                  nextSteps: ["Continue reviewing the remaining sections"],
                }),
                usage: { input_tokens: 1, output_tokens: 1 },
                provider: "mock-summary",
                model: "summary-test",
              }),
              runnableProviderFallback: false,
            }),
        },
      );
      const events = lines.join("").trim().split("\n").map(JSON.parse);
      expect(events.filter((event) => event.type === "result")).toEqual([
        expect.objectContaining({
          subtype: "success",
          result: "All 80 sections reviewed.",
        }),
      ]);
      expect(outcome.exitCode).toBe(0);
      expect(offsets).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
      expect(compactedCalls).toBeGreaterThan(0);
      expect(
        events.filter((event) => event.type === "compaction").length,
      ).toBeGreaterThanOrEqual(2);
      expect(events.find((event) => event.type === "result")).toMatchObject({
        subtype: "success",
        result: "All 80 sections reviewed.",
      });
      expect(
        events.some((event) => event.type === "iteration_budget_exhausted"),
      ).toBe(false);
    },
    90000,
  );

  it("still enforces an explicit turn cap in an interactive conversation", async () => {
    const lines = [];
    const budgets = [];
    async function* input() {
      yield '{"text":"task"}\n{"text":"continue"}\n';
    }
    const outcome = await runAgentHeadlessStream(
      { cwd, expandFileRefs: false, interactiveApprovals: true, maxTurns: 2 },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (line) => lines.push(line),
        writeErr: () => {},
        input: input(),
        agentLoop: async function* (_messages, options) {
          const budget = options.iterationBudget;
          budgets.push(budget);
          expect(budget.consumed).toBe(0);
          while (budget.hasRemaining()) budget.consume();
          yield { type: "iteration-budget-exhausted", budget: budget.limit };
          yield { type: "run-ended", reason: "budget-exhausted" };
        },
      },
    );
    const events = lines.join("").trim().split("\n").map(JSON.parse);
    expect(outcome.turns).toBe(2);
    expect(budgets[0]).not.toBe(budgets[1]);
    expect(
      events
        .filter((event) => event.type === "iteration_budget_exhausted")
        .map((event) => event.budget),
    ).toEqual([2, 2]);
    expect(
      events
        .filter((event) => event.type === "result")
        .every((event) => event.subtype === "error_max_turns"),
    ).toBe(true);
  });
});
