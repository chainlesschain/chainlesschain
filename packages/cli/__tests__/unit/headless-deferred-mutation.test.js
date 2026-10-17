import { describe, expect, it } from "vitest";
import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

const loop = async function* () {
  yield {
    type: "response-complete",
    content: "Incomplete: deferred mutation remains.",
  };
  yield { type: "run-ended", reason: "deferred-mutation-unresolved" };
};
function deps() {
  const lines = [];
  return {
    lines,
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop: loop,
  };
}
describe("headless deferred mutation result", () => {
  it("reports an error and nonzero exit in single prompt mode", async () => {
    const d = deps();
    const result = await runAgentHeadless(
      {
        prompt: "write",
        outputFormat: "stream-json",
        persist: false,
        expandFileRefs: false,
        useRegisteredMcp: false,
      },
      d,
    );
    expect(result.isError).toBe(true);
    expect(result.exitCode).not.toBe(0);
    const terminal = d.lines
      .join("")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .findLast((e) => e.type === "result");
    expect(terminal.is_error).toBe(true);
    expect(terminal.subtype).not.toBe("success");
  });
  it("reports an error in stream input mode", async () => {
    const d = deps();
    d.input = (async function* () {
      yield JSON.stringify({ type: "user", message: { content: "write" } }) +
        "\n";
    })();
    await runAgentHeadlessStream(
      { persist: false, expandFileRefs: false, useRegisteredMcp: false },
      d,
    );
    const terminal = d.lines
      .join("")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .findLast((e) => e.type === "result");
    expect(terminal.is_error).toBe(true);
    expect(terminal.subtype).not.toBe("success");
  });
});
