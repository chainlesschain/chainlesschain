import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
import { CODING_CHANGE_REVIEW_PROMPT } from "../../src/lib/coding-task-guidance.js";
import { canReserveChangeReview } from "../../src/lib/coding-change-review-context.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function run({
  limit = 20,
  firstWrite = 1,
  earlyFinal = false,
  repair = false,
  readBack = false,
  authorReads = false,
  terminalTool = false,
  unknownUsage = false,
  sessionBudget,
  controller,
  abortAfterWrite = false,
} = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-review-budget-")),
  );
  roots.push(root);
  fs.writeFileSync(path.join(root, "deliverable.js"), "// initial\n");
  for (let i = 1; i <= limit; i++)
    fs.writeFileSync(
      path.join(root, `source-${i}.js`),
      `export const source${i} = ${i};\n`,
    );
  const budget = new IterationBudget({ limit });
  const requests = [],
    events = [];
  let authorCalls = 0;
  let reviewCalls = 0;
  const tool = (name, args, id) => ({
    message: {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
  });
  const text = (content) => ({ message: { role: "assistant", content } });
  const chatFn = async (messages, options) => {
    expect(options.iterationBudget).toBe(budget);
    expect(options.enabledToolNames).toEqual([
      "read_file",
      "write_file",
      "edit_file",
    ]);
    const reviewing = messages.some(
      (m) =>
        m.role === "user" &&
        String(m.content).includes(CODING_CHANGE_REVIEW_PROMPT),
    );
    requests.push({
      reviewing,
      messages: structuredClone(messages),
      consumed: budget.consumed,
    });
    let response;
    if (reviewing) {
      reviewCalls++;
      if (reviewCalls === 1)
        response = tool("read_file", { path: "deliverable.js" }, "review-read");
      else if (repair && reviewCalls === 2)
        response = tool(
          "edit_file",
          {
            path: "deliverable.js",
            old_string: "// authored",
            new_string: "// reviewed",
          },
          "review-repair",
        );
      else if ((readBack && reviewCalls === 3) || terminalTool)
        response = tool(
          "read_file",
          { path: "deliverable.js" },
          `review-read-${reviewCalls}`,
        );
      else
        response = text("Reviewed current files; execution was unavailable.");
    } else {
      authorCalls++;
      if (authorCalls < firstWrite || (authorReads && authorCalls > firstWrite))
        response = tool(
          "read_file",
          { path: `source-${authorCalls}.js` },
          `author-read-${authorCalls}`,
        );
      else if (earlyFinal && authorCalls > firstWrite)
        response = text("Author says the work is complete.");
      else
        response = tool(
          "write_file",
          { path: "deliverable.js", content: `// authored ${authorCalls}\n` },
          `author-write-${authorCalls}`,
        );
    }
    return {
      ...response,
      ...(unknownUsage && requests.length === 1
        ? {}
        : { usage: { input_tokens: 2, output_tokens: 1 } }),
    };
  };
  let error;
  try {
    for await (const event of agentLoop(
      [
        { role: "system", content: "Use only the exposed tools." },
        {
          role: "user",
          content: "Update deliverable.js within the authorized scope.",
        },
      ],
      {
        cwd: root,
        provider: "ollama",
        model: "fixture",
        chatFn,
        hermeticExecution: true,
        exactToolNames: true,
        enabledToolNames: ["read_file", "write_file", "edit_file"],
        fileMutationScope: {
          exact: true,
          worktreeRoot: root,
          allowedPaths: ["deliverable.js"],
        },
        reviewChanges: true,
        iterationBudget: budget,
        sessionBudget,
        signal: controller?.signal,
        contextMemorySkipPlanning: true,
        autoCompact: false,
        runnableProviderFallback: false,
      },
    )) {
      events.push(event);
      if (
        abortAfterWrite &&
        event.type === "tool-result" &&
        event.tool === "write_file"
      )
        controller.abort();
    }
  } catch (cause) {
    error = cause;
  }
  return { root, budget, requests, events, error, authorCalls, reviewCalls };
}

describe("independent review request reservation", () => {
  it("never hands off while child work or deferred mutations remain unresolved", () => {
    const state = {
      enabled: true,
      changed: true,
      requested: false,
      usageKnown: true,
      pendingMutations: 0,
      pendingChildren: 0,
      remaining: 4,
      limit: 20,
    };
    expect(canReserveChangeReview(state)).toBe(true);
    for (const blocked of [
      { pendingChildren: 1 },
      { pendingMutations: 1 },
      { usageKnown: false },
      { changed: false },
      { requested: true },
    ])
      expect(canReserveChangeReview({ ...state, ...blocked })).toBe(false);
  });
  it("keeps inspect, repair and terminal requests inside the original twenty-call budget", async () => {
    const r = await run({
      repair: true,
      readBack: true,
      firstWrite: 9,
      authorReads: true,
    });
    expect(r.error).toBeUndefined();
    expect(r.budget.consumed).toBe(20);
    expect(r.authorCalls).toBe(16);
    expect(r.reviewCalls).toBe(4);
    expect(
      r.requests.filter((x) => x.reviewing).map((x) => x.consumed),
    ).toEqual([17, 18, 19, 20]);
    expect(r.requests[0].messages.at(-1).content).toContain(
      "Author allocation: 16 requests",
    );
    expect(r.requests[16].messages.some((m) => m.role === "tool")).toBe(false);
    expect(
      r.requests[17].messages.some(
        (m) => m.role === "tool" && String(m.content).includes("// authored 9"),
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(r.root, "deliverable.js"), "utf8"),
    ).toContain("// reviewed 9");
    expect(
      r.requests[19].messages.some(
        (m) => m.role === "tool" && String(m.content).includes("// reviewed 9"),
      ),
    ).toBe(true);
    expect(
      r.events
        .filter((e) => e.type === "response-complete")
        .map((e) => e.content),
    ).toEqual(["Reviewed current files; execution was unavailable."]);
  });
  it("does not turn a tool call on the last review request into success", async () => {
    const r = await run({ repair: true, readBack: true, terminalTool: true });
    expect(r.budget.consumed).toBe(20);
    expect(
      r.events.some((e) => e.type === "run-ended" && e.reason === "complete"),
    ).toBe(false);
    expect(r.events.some((e) => e.type === "iteration-budget-exhausted")).toBe(
      true,
    );
    expect(r.requests.at(-1).messages.at(-1).content).toContain(
      "final model request",
    );
  });
  it("reserves inspection and a terminal response even with three total requests", async () => {
    const r = await run({ limit: 3 });
    expect(r.error).toBeUndefined();
    expect(r.requests.map((x) => x.reviewing)).toEqual([false, true, true]);
    expect(r.budget.consumed).toBe(3);
    expect(
      r.events.some((e) => e.type === "run-ended" && e.reason === "complete"),
    ).toBe(true);
  });
  it("still starts independent review when the author finishes earlier", async () => {
    const r = await run({ limit: 8, earlyFinal: true });
    expect(r.error).toBeUndefined();
    expect(r.requests.map((x) => x.reviewing)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(JSON.stringify(r.requests[2].messages)).not.toContain(
      "Author says the work is complete",
    );
  });
  it("fails explicitly instead of starting a fresh review with one request left", async () => {
    const r = await run({ limit: 4, firstWrite: 3 });
    expect(r.error).toMatchObject({
      code: "CC_CHANGE_REVIEW_BUDGET_INSUFFICIENT",
    });
    expect(r.requests).toHaveLength(3);
    expect(r.reviewCalls).toBe(0);
    expect(r.events.some((e) => e.type === "response-complete")).toBe(false);
  });
  it("does not bypass the shared session request gate at handoff", async () => {
    let calls = 0;
    const sessionBudget = {
      consumeTurn: () =>
        ++calls === 1
          ? { ok: true }
          : { ok: false, reason: "turn-budget-exhausted" },
    };
    const r = await run({ limit: 3, sessionBudget });
    expect(r.error).toBeDefined();
    expect(r.requests).toHaveLength(1);
    expect(calls).toBe(2);
    expect(r.budget.consumed).toBe(1);
  });
  it("does not admit review after cancellation", async () => {
    const r = await run({
      limit: 3,
      controller: new AbortController(),
      abortAfterWrite: true,
    });
    expect(r.error).toMatchObject({ name: "AbortError" });
    expect(r.requests).toHaveLength(1);
    expect(r.reviewCalls).toBe(0);
  });
  it("does not add review requests when model usage is unknown", async () => {
    const r = await run({ limit: 8, earlyFinal: true, unknownUsage: true });
    expect(r.error).toMatchObject({ code: "CC_CHANGE_REVIEW_USAGE_UNKNOWN" });
    expect(r.requests).toHaveLength(1);
    expect(r.reviewCalls).toBe(0);
    expect(r.events.some((e) => e.type === "response-complete")).toBe(false);
  });
});
