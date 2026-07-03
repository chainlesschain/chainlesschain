/**
 * runAgentHeadless --otlp: the runner builds a TelemetryRecorder, threads it
 * into the agent loop as `loopOptions.recorder`, and writes the captured spans
 * as OTLP/JSON on exit. A fake agentLoop records a span through the recorder it
 * receives — proving the wiring end-to-end without a live model.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hl-otlp-"));
});
afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function makeDeps(agentLoop) {
  const out = [];
  const err = [];
  return {
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      agentLoop,
    },
    out,
    err,
  };
}

// A loop that records one model span through whatever recorder it's handed.
async function* recordingLoop(_messages, opts) {
  if (opts.recorder) {
    const span = opts.recorder.startSpan("agent.model", {
      "gen_ai.request.model": "fake-model",
    });
    span.setAttribute("gen_ai.usage.input_tokens", 42);
    span.end();
    opts.recorder.counter("agent.model.calls", 1);
  }
  yield { type: "response-complete", content: "done" };
  yield { type: "run-ended", runId: "r", reason: "complete" };
}

describe("runAgentHeadless --otlp", () => {
  it("writes captured spans as OTLP/JSON to the requested file", async () => {
    const otlpFile = path.join(tmp, "spans.json");
    const { deps } = makeDeps(recordingLoop);
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        otlp: otlpFile,
      },
      deps,
    );
    expect(res.isError).toBe(false);
    expect(fs.existsSync(otlpFile)).toBe(true);

    const otlp = JSON.parse(fs.readFileSync(otlpFile, "utf-8"));
    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.map((s) => s.name)).toContain("agent.model");
    const model = spans.find((s) => s.name === "agent.model");
    const attr = model.attributes.find(
      (a) => a.key === "gen_ai.usage.input_tokens",
    );
    expect(attr.value.doubleValue).toBe(42);
    // The service.name is the agent runner.
    const svc = otlp.resourceSpans[0].resource.attributes.find(
      (a) => a.key === "service.name",
    );
    expect(svc.value.stringValue).toBe("cc-agent");
  });

  it("does not write a file and stays clean when --otlp is absent", async () => {
    const { deps } = makeDeps(recordingLoop);
    const res = await runAgentHeadless(
      { prompt: "do work", outputFormat: "json", expandFileRefs: false },
      deps,
    );
    expect(res.isError).toBe(false);
    // No otlp path → nothing written into tmp.
    expect(fs.readdirSync(tmp)).toHaveLength(0);
  });
});
