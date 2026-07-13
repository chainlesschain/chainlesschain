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
import { spawnSync } from "node:child_process";
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
      sessionId: "sess 01\n02", // unsanitized on purpose → normalized on stamp
    })) {
      events.push(ev);
    }
    const runId = events.find((e) => e.type === "run-started").runId;

    const spans = recorder.spans();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.attributes["workflow.run_id"]).toBe(runId);
      expect(s.attributes["workflow.name"]).toBe("my-workflow");
      // P2: session.id is now stamped on every span, charset-sanitized.
      expect(s.attributes["session.id"]).toBe("sess_01_02");
    }
  });

  it("stamps per-span unified ids: turn/prompt on model, turn/tool_use/checkpoint on tool", async () => {
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [readCall("call-abc-123", "a.txt")],
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
    })) {
      events.push(ev);
    }
    const runId = events.find((e) => e.type === "run-started").runId;
    // runId is charset-sanitized before it becomes part of a per-span id token.
    const runToken = runId.replace(/[^\w.\-:/@]/g, "_").replace(/_+/g, "_");

    const modelSpans = recorder.spans().filter((s) => s.name === "agent.model");
    const toolSpans = recorder.spans().filter((s) => s.name === "agent.tool");

    // Model spans: turn.id + prompt.id, one turn per iteration.
    for (const s of modelSpans) {
      expect(s.attributes["turn.id"]).toMatch(
        new RegExp(`^${runToken}:t\\d+$`),
      );
      expect(s.attributes["prompt.id"]).toBe(`${s.attributes["turn.id"]}:p`);
    }
    // Two model iterations → two distinct turn ids.
    const turnIds = modelSpans.map((s) => s.attributes["turn.id"]);
    expect(new Set(turnIds).size).toBe(2);

    // Tool span: carries the provider tool_use.id and the turn.id of its
    // iteration (which matches the FIRST model span — the tool-call turn).
    expect(toolSpans[0].attributes["tool_use.id"]).toBe("call-abc-123");
    expect(toolSpans[0].attributes["turn.id"]).toBe(
      modelSpans[0].attributes["turn.id"],
    );
    // No auto-checkpoint fired for a read-only tool → checkpoint.id omitted.
    expect(toolSpans[0].attributes["checkpoint.id"]).toBeUndefined();
  });

  it("stamps checkpoint.id on the tool span when auto-checkpoint fires before a mutating tool", async () => {
    const git = (...args) => {
      const r = spawnSync("git", args, { cwd: tmp, encoding: "utf-8" });
      if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(" ")}`);
    };
    git("init", "-q");
    git("config", "user.email", "t@test.local");
    git("config", "user.name", "tester");
    git("config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(tmp, "seed.txt"), "seed\n", "utf8");
    git("add", "-A");
    git("commit", "-q", "-m", "init");

    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-write-1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({ path: "out.txt", content: "hi" }),
                },
              },
            ],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
    };

    const recorder = new TelemetryRecorder();
    const events = [];
    for await (const ev of agentLoop([{ role: "user", content: "write it" }], {
      provider: "ollama",
      model: "test-model",
      baseUrl: "http://localhost:11434",
      cwd: tmp,
      chatFn,
      runnableProviderFallback: false,
      recorder,
      autoCheckpoint: true,
      checkpointSession: "t1",
    })) {
      events.push(ev);
    }

    const cpEvent = events.find((e) => e.type === "checkpoint");
    expect(cpEvent).toBeTruthy();
    const toolSpan = recorder.spans().find((s) => s.name === "agent.tool");
    // The tool span's checkpoint.id matches the emitted checkpoint event id.
    expect(toolSpan.attributes["checkpoint.id"]).toBe(cpEvent.id);
    expect(toolSpan.attributes["tool_use.id"]).toBe("call-write-1");
  });

  it("stamps permission.decision_id + permission.decision on a gated (denied) tool span", async () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [readCall("call-denied-9", "a.txt")],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
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
        // settings deny rule → executeTool returns {error, policy:{decision:"deny",via:"settings"}}
        permissionRules: { deny: ["Read"] },
      }),
    );

    const toolSpan = recorder.spans().find((s) => s.name === "agent.tool");
    // The gated decision is identified and low-cardinality-labeled on the span.
    expect(toolSpan.attributes["permission.decision"]).toBe("deny");
    // decision_id is derived from the tool_use id + gate (recomputable).
    expect(toolSpan.attributes["permission.decision_id"]).toBe(
      "call-denied-9:perm:settings",
    );
    // ...and the span is flagged an error (the denial surfaced as {error}).
    expect(toolSpan.attributes["tool.is_error"]).toBe(true);
  });

  it("does NOT stamp permission.decision_id on an ordinary (allowed) tool span", async () => {
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
        };
      }
      return { message: { role: "assistant", content: "done" } };
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
    const toolSpan = recorder.spans().find((s) => s.name === "agent.tool");
    // Allow-path tool executed with no distinct decision → no permission ids.
    expect(toolSpan.attributes["permission.decision_id"]).toBeUndefined();
    expect(toolSpan.attributes["permission.decision"]).toBeUndefined();
  });

  it("stamps content.response (model) + content.tool_arguments (tool) only when --otlp-content is opted in", async () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "calling the tool now",
            tool_calls: [readCall("r1", "a.txt")],
          },
        };
      }
      return { message: { role: "assistant", content: "final answer" } };
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
        otlpIncludeContent: true,
      }),
    );

    const modelSpans = recorder.spans().filter((s) => s.name === "agent.model");
    const toolSpans = recorder.spans().filter((s) => s.name === "agent.tool");
    // Model spans carry the assistant response text.
    expect(modelSpans[0].attributes["content.response"]).toBe(
      "calling the tool now",
    );
    expect(modelSpans[1].attributes["content.response"]).toBe("final answer");
    // Tool span carries the (redacted-shaped) tool arguments JSON.
    expect(toolSpans[0].attributes["content.tool_arguments"]).toBe(
      JSON.stringify({ path: "a.txt" }),
    );
  });

  it("omits content.response and content.tool_arguments by default (byte-identical)", async () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "AAA", "utf-8");
    let n = 0;
    const chatFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          message: {
            role: "assistant",
            content: "hi",
            tool_calls: [readCall("r1", "a.txt")],
          },
        };
      }
      return { message: { role: "assistant", content: "done" } };
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
        // otlpIncludeContent NOT set → both fields absent entirely
      }),
    );
    for (const s of recorder.spans()) {
      expect(s.attributes["content.response"]).toBeUndefined();
      expect(s.attributes["content.tool_arguments"]).toBeUndefined();
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

  it("omits prompt CONTENT from spans by default (privacy — byte-identical)", async () => {
    const chatFn = async () => ({
      message: { role: "assistant", content: "done" },
    });
    const recorder = new TelemetryRecorder();
    await drain(
      agentLoop([{ role: "user", content: "a secret prompt" }], {
        provider: "ollama",
        model: "test-model",
        baseUrl: "http://localhost:11434",
        cwd: tmp,
        chatFn,
        runnableProviderFallback: false,
        recorder,
        // otlpIncludeContent NOT set → default off
      }),
    );
    const spans = recorder.spans();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      // Field is absent entirely (not even the redaction sentinel), so the
      // default OTLP export is unchanged.
      expect(s.attributes["content.prompt"]).toBeUndefined();
    }
  });

  it("stamps the initial prompt as content.prompt when --otlp-content is opted in", async () => {
    const chatFn = async () => ({
      message: { role: "assistant", content: "done" },
    });
    const recorder = new TelemetryRecorder();
    await drain(
      agentLoop([{ role: "user", content: "build the release" }], {
        provider: "ollama",
        model: "test-model",
        baseUrl: "http://localhost:11434",
        cwd: tmp,
        chatFn,
        runnableProviderFallback: false,
        recorder,
        otlpIncludeContent: true,
      }),
    );
    const spans = recorder.spans();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.attributes["content.prompt"]).toBe("build the release");
    }
  });

  it("extracts multimodal text parts for content.prompt when opted in", async () => {
    const chatFn = async () => ({
      message: { role: "assistant", content: "done" },
    });
    const recorder = new TelemetryRecorder();
    await drain(
      agentLoop(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "first line" },
              { type: "image", url: "x" },
              { type: "text", text: "second line" },
            ],
          },
        ],
        {
          provider: "ollama",
          model: "test-model",
          baseUrl: "http://localhost:11434",
          cwd: tmp,
          chatFn,
          runnableProviderFallback: false,
          recorder,
          otlpIncludeContent: true,
        },
      ),
    );
    const spans = recorder.spans();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.attributes["content.prompt"]).toBe("first line\nsecond line");
    }
  });
});
