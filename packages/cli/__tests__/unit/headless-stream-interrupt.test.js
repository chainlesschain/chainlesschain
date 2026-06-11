/**
 * Stream-mode turn interrupt (chat-panel Stop / Claude-Code Esc parity) —
 * stdin is pumped CONCURRENTLY with turn execution, so
 * {"type":"interrupt"} aborts the IN-FLIGHT turn (result
 * subtype:"interrupted", is_error:false) while the conversation keeps going;
 * no assistant message is recorded for the aborted turn.
 */
import { describe, it, expect } from "vitest";
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("parseInputEvent — interrupt", () => {
  it("parses the interrupt control", () => {
    expect(parseInputEvent('{"type":"interrupt"}')).toEqual({
      interrupt: true,
    });
  });
});

describe("stream turn interrupt", () => {
  it("aborts the in-flight turn, then the next turn works normally", async () => {
    const lines = [];
    const seenTurns = [];
    // Fake loop: a "HANG" task waits until the per-turn signal aborts;
    // anything else replies immediately.
    const agentLoop = async function* (messages, opts) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      seenTurns.push(lastUser.content);
      if (/HANG/.test(lastUser.content)) {
        await new Promise((_res, rej) => {
          const fail = () =>
            rej(
              Object.assign(new Error("This operation was aborted"), {
                name: "AbortError",
              }),
            );
          if (opts.signal?.aborted) return fail();
          opts.signal?.addEventListener("abort", fail, { once: true });
        });
      }
      yield { type: "response-complete", content: "done:" + lastUser.content };
      yield { type: "run-ended", reason: "complete" };
    };
    // Timed stdin: user(HANG) → (50ms) interrupt → (20ms) user(next) → EOF.
    async function* input() {
      yield JSON.stringify({ type: "user", text: "HANG forever" }) + "\n";
      await sleep(50);
      yield JSON.stringify({ type: "interrupt" }) + "\n";
      await sleep(20);
      yield JSON.stringify({ type: "user", text: "second question" }) + "\n";
    }
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (s) => lines.push(s),
        writeErr: () => {},
        agentLoop,
        input: input(),
      },
    );
    const events = lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    const results = events.filter((e) => e.type === "result");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      subtype: "interrupted",
      is_error: false,
      interrupted: true,
    });
    expect(results[1]).toMatchObject({
      subtype: "success",
      result: "done:second question",
    });
    // interrupted turn recorded NO assistant message → turn 2's history has
    // the dangling user msg but no fabricated reply
    expect(seenTurns).toEqual(["HANG forever", "second question"]);
    expect(outcome.exitCode).toBe(0); // an interrupt is not an error
  }, 20000);

  it("an interrupt with no in-flight turn is a harmless no-op", async () => {
    const lines = [];
    async function* input() {
      yield JSON.stringify({ type: "interrupt" }) + "\n";
      yield JSON.stringify({ type: "user", text: "hi" }) + "\n";
    }
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (s) => lines.push(s),
        writeErr: () => {},
        agentLoop: async function* () {
          yield { type: "response-complete", content: "ok" };
          yield { type: "run-ended", reason: "complete" };
        },
        input: input(),
      },
    );
    const events = lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(
      events.filter((e) => e.type === "result" && e.subtype === "success"),
    ).toHaveLength(1);
    expect(outcome.exitCode).toBe(0);
  }, 20000);
});
