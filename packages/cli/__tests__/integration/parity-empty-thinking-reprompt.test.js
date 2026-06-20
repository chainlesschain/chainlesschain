/**
 * Parity — empty-thinking re-prompt (Claude Code 2.1.183)
 *
 * Upstream fix: "Fixed turns completing silently with only thinking blocks;
 * model now re-prompts." When extended thinking is on, a model can occasionally
 * end a turn with internal reasoning but no visible text and no tool calls. The
 * agent loop must NOT complete silently with an empty answer — it re-prompts the
 * model once to surface its actual response. A genuinely empty completion (no
 * thinking) still ends, and a model that keeps returning empty turns completes
 * after a single re-prompt rather than looping forever.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  createMockLLMProvider,
  mockTextMessage,
  mockThinkingOnlyMessage,
} from "../../src/harness/mock-llm-provider.js";

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    if (event.type === "run-started" || event.type === "run-ended") continue;
    out.push(event);
  }
  return out;
}

describe("parity 2.1.183: empty-thinking re-prompt", () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-empty-thinking-"));
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("re-prompts a thinking-only turn, then completes with the real answer", async () => {
    const mock = createMockLLMProvider([
      // First call: only reasoning, no visible text, no tool calls.
      { response: { message: mockThinkingOnlyMessage("let me think...") } },
      // Second call: must have been re-prompted; now produce the real answer.
      {
        expect: (messages) =>
          messages.some(
            (m) =>
              m.role === "user" &&
              typeof m.content === "string" &&
              /no visible response/i.test(m.content),
          ),
        response: { message: mockTextMessage("the actual answer") },
      },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "hi" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    // Re-prompt event emitted, then the real answer completes the run.
    expect(events.some((e) => e.type === "empty-thinking-reprompt")).toBe(true);
    const complete = events.find((e) => e.type === "response-complete");
    expect(complete).toMatchObject({ content: "the actual answer" });
    expect(mock.calls).toHaveLength(2);
    mock.assertDrained();
  });

  it("re-prompts only ONCE — a second empty turn completes instead of looping", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockThinkingOnlyMessage("first") } },
      { response: { message: mockThinkingOnlyMessage("second") } },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "hi" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    // Exactly one re-prompt, two LLM calls, then a (empty) completion — no loop.
    expect(
      events.filter((e) => e.type === "empty-thinking-reprompt"),
    ).toHaveLength(1);
    expect(mock.calls).toHaveLength(2);
    const complete = events.find((e) => e.type === "response-complete");
    expect(complete).toBeTruthy();
    expect(complete.content).toBe("");
    mock.assertDrained();
  });

  it("a genuinely empty completion (no thinking) does NOT re-prompt", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("") } },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "hi" }], {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events.some((e) => e.type === "empty-thinking-reprompt")).toBe(false);
    expect(mock.calls).toHaveLength(1);
    expect(events.find((e) => e.type === "response-complete")).toMatchObject({
      content: "",
    });
    mock.assertDrained();
  });
});
