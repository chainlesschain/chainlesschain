/**
 * agentLoop surfaces the final answer's extended-thinking reasoning on the
 * response-complete event (non-streaming path) so the REPL can render it.
 */
import { describe, it, expect, vi } from "vitest";
import { agentLoop } from "../../src/runtime/agent-core.js";

async function drain(gen) {
  const events = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("agentLoop response-complete — extended-thinking reasoning", () => {
  it("includes joined thinking text from the message's _thinkingBlocks", async () => {
    const chatFn = vi.fn(async () => ({
      message: {
        role: "assistant",
        content: "the answer",
        _thinkingBlocks: [
          { type: "thinking", thinking: "step one ", signature: "s" },
          { type: "thinking", thinking: "step two", signature: "s2" },
        ],
      },
    }));
    const events = await drain(
      agentLoop([{ role: "user", content: "u" }], { chatFn }),
    );
    expect(events.find((e) => e.type === "response-complete")).toMatchObject({
      content: "the answer",
      thinking: "step one step two",
    });
  });

  it("omits thinking when there are no _thinkingBlocks", async () => {
    const chatFn = vi.fn(async () => ({
      message: { role: "assistant", content: "plain" },
    }));
    const events = await drain(
      agentLoop([{ role: "user", content: "u" }], { chatFn }),
    );
    const done = events.find((e) => e.type === "response-complete");
    expect(done.content).toBe("plain");
    expect(done.thinking).toBeUndefined();
  });
});
