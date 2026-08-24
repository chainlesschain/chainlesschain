import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ClaudeAdapter,
  CodexAdapter,
  EXTERNAL_AGENT_ERROR,
  EXTERNAL_AGENT_PROTOCOL,
  createExternalAgentAdapter,
} from "../../src/lib/external-agent-adapters.js";

function fixture(name) {
  return readFileSync(
    fileURLToPath(
      new URL(`../fixtures/external-agent/${name}`, import.meta.url),
    ),
    "utf8",
  );
}

describe("external agent adapters", () => {
  it("builds Claude Code argv without leaking Codex semantics", () => {
    const adapter = new ClaudeAdapter({ model: "claude-opus-4-6" });
    expect(
      adapter.buildArgs({ prompt: "Fix it", allowedTools: "Read,Edit" }),
    ).toEqual([
      "-p",
      "Fix it",
      "--output-format",
      "stream-json",
      "--model",
      "claude-opus-4-6",
      "--allowedTools",
      "Read,Edit",
    ]);
    expect(adapter.capabilities().protocol).toBe(
      EXTERNAL_AGENT_PROTOCOL.CLAUDE_STREAM_JSON,
    );
  });

  it("builds Codex exec --json argv with the prompt as a positional arg", () => {
    const adapter = new CodexAdapter({
      model: "gpt-test",
      sandbox: "workspace-write",
    });
    expect(adapter.buildArgs({ prompt: "Fix it" })).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-test",
      "--sandbox",
      "workspace-write",
      "Fix it",
    ]);
    expect(adapter.buildArgs({ prompt: "Fix it" })).not.toContain("-p");
    expect(adapter.capabilities().protocol).toBe(
      EXTERNAL_AGENT_PROTOCOL.CODEX_EXEC_JSONL,
    );
  });

  it("rejects Claude-only allowedTools instead of silently weakening Codex policy", () => {
    const adapter = new CodexAdapter();
    let thrown;
    try {
      adapter.buildArgs({ prompt: "Fix it", allowedTools: "Read" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      code: EXTERNAL_AGENT_ERROR.UNSUPPORTED_OPTION,
    });
  });

  it("projects a real Codex JSONL success fixture", () => {
    const projection = new CodexAdapter().parseTranscript(
      fixture("codex-success.jsonl"),
    );
    expect(projection).toMatchObject({
      output: "Repository is clean.",
      terminal: "completed",
      error: null,
      malformedLineCount: 0,
      unknownEventTypes: [],
      unknownItemTypes: [],
      usage: {
        input_tokens: 100,
        output_tokens: 12,
      },
    });
  });

  it("maps turn.failed and preserves its diagnostic", () => {
    const projection = new CodexAdapter().parseTranscript(
      fixture("codex-failed.jsonl"),
    );
    expect(projection.terminal).toBe("failed");
    expect(projection.error).toBe("model request failed");
  });

  it("tolerates additive events while reporting their types", () => {
    const projection = new CodexAdapter().parseTranscript(
      fixture("codex-additive-event.jsonl"),
    );
    expect(projection.terminal).toBe("completed");
    expect(projection.output).toBe("Handled additive events.");
    expect(projection.unknownEventTypes).toEqual(["future.telemetry"]);
    expect(projection.unknownItemTypes).toEqual(["future_item"]);
  });

  it("selects provider-specific adapters", () => {
    expect(createExternalAgentAdapter({ cliCommand: "codex" })).toBeInstanceOf(
      CodexAdapter,
    );
    expect(createExternalAgentAdapter({ cliCommand: "claude" })).toBeInstanceOf(
      ClaudeAdapter,
    );
  });
});
