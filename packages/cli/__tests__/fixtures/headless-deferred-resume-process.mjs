import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

const phase = process.argv[2];
if (!new Set(["request", "resume"]).has(phase)) {
  throw new TypeError("phase must be request or resume");
}

const sessionId = "deferred-process-session";

async function* agentLoop(_messages, options) {
  if (phase === "request") {
    const receipt = options.interaction.deferUserQuestion({
      question: "Pick a color",
      options: ["Blue", "Red"],
      purpose: "preference",
    });
    yield { type: "response-complete", content: JSON.stringify(receipt) };
  } else {
    const prepared = await options.prepareCall({});
    yield {
      type: "response-complete",
      content: prepared?.userContext || "missing deferred answer",
    };
  }
  yield { type: "run-ended", reason: "complete" };
}

await runAgentHeadlessStream(
  {
    cwd: process.cwd(),
    sessionId,
    interactiveQuestions: true,
    contextMemorySkipPlanning: true,
  },
  {
    bootstrap: async () => ({ db: null }),
    agentLoop,
    writeOut: (value) => process.stdout.write(value),
    writeErr: (value) => process.stderr.write(value),
  },
);
