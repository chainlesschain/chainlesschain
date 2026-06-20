/**
 * Panel event mapping: `ask_user_question` degrades gracefully in the chat panel
 * (no interactive Q&A round-trip yet) — the CLI returns {error:"user_not_reachable"}
 * and the model proceeds. That benign degradation must NOT render as a red
 * "✗ … failed"; it should be a quiet note. Regression guard for the user-reported
 * scary "ask_user_question failed" line.
 */
import { describe, it, expect } from "vitest";
import {
  mapAgentEvent,
  createTurnState,
} from "../../../vscode-extension/src/chat/chat-events.js";

const map = (evt) => mapAgentEvent(evt, createTurnState());

describe("chat-events — graceful ask_user_question degradation", () => {
  it("user_not_reachable → non-error tool_done with a quiet note", () => {
    const r = map({
      type: "tool_result",
      tool: "ask_user_question",
      is_error: true,
      error: "user_not_reachable",
      result: { error: "user_not_reachable", hint: "Proceed autonomously." },
    });
    expect(r.kind).toBe("tool_done");
    expect(r.isError).toBe(false); // NOT a failure — model proceeds
    expect(r.note).toMatch(/proceeding/i);
  });

  it("user_timeout (nested in result.error) is also benign", () => {
    const r = map({
      type: "tool_result",
      tool: "ask_user_question",
      is_error: true,
      result: { error: "user_timeout" },
    });
    expect(r.isError).toBe(false);
    expect(r.note).toMatch(/proceeding/i);
  });

  it("a REAL tool error still surfaces as a failure (no false downgrade)", () => {
    const r = map({
      type: "tool_result",
      tool: "run_shell",
      is_error: true,
      error: "command not found",
      result: { error: "command not found" },
    });
    expect(r.isError).toBe(true);
    expect(r.note).toBe(null);
  });

  it("a successful tool stays a clean non-error tool_done", () => {
    const r = map({
      type: "tool_result",
      tool: "read_file",
      is_error: false,
      result: { ok: true },
    });
    expect(r.isError).toBe(false);
    expect(r.note).toBe(null);
  });
});
