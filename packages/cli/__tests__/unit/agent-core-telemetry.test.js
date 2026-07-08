/**
 * agent-core OTel instrumentation — the REAL agent loop emits model/tool/retry
 * spans when a TelemetryRecorder is attached via `options.recorder`, and is
 * zero-cost when it isn't. Driven through the `chatFn` seam so no live model is
 * needed; the recorder is the dependency-free OTel-shaped TelemetryRecorder.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { agentLoop } from "../../src/runtime/agent-core.js";
import { TelemetryRecorder } from "../../src/lib/telemetry/span-recorder.js";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tel-"));
});
afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const readCall = (id, name) => ({
  id,
  type: "function",
  function: { name: "read_file", arguments: JSON.stringify({ path: name }) },
});

async function drain(gen) {
  const events = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("agent-core telemetry spans", () => {
  it("emits model + tool spans with usage/token attributes and counters", async () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [readCall("r1", "a.txt")],
          },
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            cache_read_input_tokens: 40,
          },
        };
      }
      return {
        message: { role: "assistant", content: "done" },
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      };
    };

    const recorder = new TelemetryRecorder();
    await drain(
      agentLoop([{ role: "user", content: "read a.txt" }], {
        provider: "ollama",
        model: "test-model",
        baseUrl: "http://localhost:11434",
        cwd: tmp,
        chatFn,
        runnableProviderFallback: false,
        recorder,
      }),
    );

    const spans = recorder.spans();
    const modelSpans = spans.filter((s) => s.name === "agent.model");
    const toolSpans = spans.filter((s) => s.name === "agent.tool");

    // Two model calls (tool-call turn + final turn), one tool call.
    expect(modelSpans).toHaveLength(2);
    expect(toolSpans).toHaveLength(1);

    // Usage tokens (incl. prompt-cache read) are stamped on the first model span.
    expect(modelSpans[0].attributes["gen_ai.usage.input_tokens"]).toBe(100);
    expect(modelSpans[0].attributes["gen_ai.usage.output_tokens"]).toBe(20);
    expect(modelSpans[0].attributes["gen_ai.usage.cache_read_tokens"]).toBe(40);
    expect(modelSpans[0].attributes["gen_ai.request.model"]).toBe("test-model");
    expect(modelSpans[0].attributes["agent.has_tool_calls"]).toBe(true);
    expect(modelSpans[1].attributes["agent.has_tool_calls"]).toBe(false);

    // Tool span carries the tool name and a clean (non-error) status.
    expect(toolSpans[0].attributes["tool.name"]).toBe("read_file");
    expect(toolSpans[0].attributes["tool.is_error"]).toBe(false);

    const sum = recorder.summary();
    expect(sum.counters["agent.model.calls"].total).toBe(2);
    expect(sum.counters["agent.tool.calls"].total).toBe(1);
    // OTLP export includes the real spans.
    const otlp = recorder.toOtlp();
    const names = otlp.resourceSpans[0].scopeSpans[0].spans.map((s) => s.name);
    expect(names).toContain("agent.model");
    expect(names).toContain("agent.tool");
  });

  it("flags a tool span as an error when the tool returns {error}", async () => {
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [readCall("r1", "does-not-exist.txt")],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
    };

    const recorder = new TelemetryRecorder();
    await drain(
      agentLoop([{ role: "user", content: "read missing" }], {
        provider: "ollama",
        model: "test-model",
        baseUrl: "http://localhost:11434",
        cwd: tmp,
        chatFn,
        runnableProviderFallback: false,
        recorder,
      }),
    );

    const toolSpans = recorder.spans().filter((s) => s.name === "agent.tool");
    expect(toolSpans).toHaveLength(1);
    // read_file on a missing path returns {error} (not a throw) → flagged.
    expect(toolSpans[0].attributes["tool.is_error"]).toBe(true);
  });

  it("stamps workflow.run_id (and workflow.name) onto every span", async () => {
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [readCall("r1", "a.txt")],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
    };

    const recorder = new TelemetryRecorder();
    const events = [];
    for await (const ev of agentLoop([{ role: "user", content: "go" }], {
      provider: "ollama",
      model: "test-model",
      baseUrl: "http://localhost:11434",
      cwd: tmp,
      chatFn,
      runnableProviderFallback: false,
      recorder,
      workflowName: "my-workflow",
    })) {
      events.push(ev);
    }
    const runId = events.find((e) => e.type === "run-started").runId;

    const spans = recorder.spans();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.attributes["workflow.run_id"]).toBe(runId);
      expect(s.attributes["workflow.name"]).toBe("my-workflow");
    }
  });

  it("is a no-op when no recorder is attached (loop still completes)", async () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
    const chatFn = async () => ({
      message: { role: "assistant", content: "done" },
    });
    const events = await drain(
      agentLoop([{ role: "user", content: "hi" }], {
        provider: "ollama",
        model: "test-model",
        baseUrl: "http://localhost:11434",
        cwd: tmp,
        chatFn,
        runnableProviderFallback: false,
      }),
    );
    expect(events.some((e) => e.type === "response-complete")).toBe(true);
  });
});
