import { describe, it, expect, vi } from "vitest";
import { agentLoop } from "../../src/runtime/agent-core.js";

async function drain(gen) {
  const events = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("agent-core — prepareCall turn injection", () => {
  it("injects systemSuffix as transient system message for each call", async () => {
    const capturedMessages = [];
    const chatFn = vi.fn(async (msgs) => {
      capturedMessages.push(
        msgs.map((m) => ({ role: m.role, content: m.content })),
      );
      return { message: { role: "assistant", content: "ok" } };
    });

    const prepareCall = vi.fn(async ({ iteration }) => ({
      systemSuffix: `TURN=${iteration}`,
    }));

    const messages = [
      { role: "system", content: "base" },
      { role: "user", content: "hi" },
    ];
    await drain(agentLoop(messages, { chatFn, prepareCall }));

    expect(prepareCall).toHaveBeenCalledTimes(1);
    expect(chatFn).toHaveBeenCalledTimes(1);

    const seen = capturedMessages[0];
    expect(seen[seen.length - 1]).toEqual({
      role: "system",
      content: "TURN=1",
    });
    // Original messages must NOT contain the transient supplement
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.content === "TURN=1")).toBe(false);
  });

  it("skips injection when prepareCall returns null", async () => {
    const capturedMessages = [];
    const chatFn = vi.fn(async (msgs) => {
      capturedMessages.push(msgs.length);
      return { message: { role: "assistant", content: "ok" } };
    });
    const prepareCall = vi.fn(async () => null);

    await drain(
      agentLoop(
        [
          { role: "system", content: "s" },
          { role: "user", content: "u" },
        ],
        { chatFn, prepareCall },
      ),
    );

    expect(capturedMessages[0]).toBe(2);
  });

  it("tolerates prepareCall errors without breaking the loop", async () => {
    const chatFn = vi.fn(async () => ({
      message: { role: "assistant", content: "fine" },
    }));
    const prepareCall = vi.fn(async () => {
      throw new Error("boom");
    });

    const events = await drain(
      agentLoop([{ role: "user", content: "u" }], { chatFn, prepareCall }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "response-complete",
      content: "fine",
    });
  });

  it("is a no-op when prepareCall is absent", async () => {
    const chatFn = vi.fn(async () => ({
      message: { role: "assistant", content: "ok" },
    }));
    const events = await drain(
      agentLoop([{ role: "user", content: "u" }], { chatFn }),
    );
    expect(events.at(-1)).toMatchObject({ type: "response-complete" });
  });
});
