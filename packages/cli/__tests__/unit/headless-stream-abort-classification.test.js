import "../helpers/test-model-egress.js";
import { describe, it, expect } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

describe("stream abort classification", () => {
  async function run(error, interrupt = false) {
    const lines = [];
    let announceStarted;
    const started = new Promise((resolve) => {
      announceStarted = resolve;
    });
    const outcome = await runAgentHeadlessStream(
      { persist: false, expandFileRefs: false, useRegisteredMcp: false },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (s) => lines.push(s),
        writeErr: () => {},
        input: (async function* () {
          yield JSON.stringify({ type: "user", text: "work" }) + "\n";
          if (interrupt) {
            await started;
            yield JSON.stringify({ type: "interrupt" }) + "\n";
          }
        })(),
        agentLoop: async function* (_messages, options) {
          if (interrupt) {
            await new Promise((_resolve, reject) => {
              options.signal.addEventListener("abort", () => reject(error), {
                once: true,
              });
              announceStarted();
            });
          }
          throw error;
        },
      },
    );
    return {
      outcome,
      result: lines
        .join("")
        .trim()
        .split("\n")
        .map(JSON.parse)
        .findLast((e) => e.type === "result"),
    };
  }
  it("does not classify a plain upstream aborted error as user interruption", async () => {
    const r = await run(new Error("DIAGNOSTIC_RESPONSE_ABORTED_USAGE_UNKNOWN"));
    expect(r.result).toMatchObject({
      subtype: "error",
      is_error: true,
      error: "DIAGNOSTIC_RESPONSE_ABORTED_USAGE_UNKNOWN",
    });
    expect(r.result.interrupted).not.toBe(true);
    expect(r.outcome.exitCode).not.toBe(0);
  });
  it.each([{ name: "AbortError" }, { code: "ABORT_ERR" }])(
    "reports provider cancellation without an owned aborted signal as an error: %j",
    async (identity) => {
      const r = await run(
        Object.assign(new Error("provider timeout"), identity),
      );
      expect(r.result).toMatchObject({
        subtype: "error",
        is_error: true,
        error: "provider timeout",
      });
      expect(r.result.interrupted).not.toBe(true);
      expect(r.outcome.exitCode).not.toBe(0);
    },
  );
  it("uses the real input interrupt signal even when the rejection has no AbortError identity", async () => {
    const r = await run(new Error("cancelled by owned signal"), true);
    expect(r.result).toMatchObject({
      subtype: "interrupted",
      is_error: false,
      interrupted: true,
    });
    expect(r.outcome.exitCode).toBe(0);
  });
});
