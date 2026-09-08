/**
 * Panel event mapping: `ask_user_question` normally round-trips through the
 * in-panel question card, but degrades gracefully when that path is unavailable
 * (old `cc` ignoring CC_INTERACTIVE_QUESTIONS, or the user never answers) — the
 * CLI returns {error:"user_not_reachable"} / {error:"user_timeout"} and the
 * model proceeds. That benign degradation must NOT render as a red
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
  it("shows the saved webpage character range in the tool trace", () => {
    expect(
      map({
        type: "tool_use",
        tool: "web_fetch",
        args: {
          url: "https://example.com",
          snapshotId: "saved",
          offset: 20000,
          maxChars: 5000,
        },
      }),
    ).toMatchObject({
      kind: "tool",
      summary: "https://example.com (chars 20000-24999, saved page)",
    });
  });

  it("preserves download failure details and recovery guidance for the panel", () => {
    const result = map({
      type: "tool_result",
      tool: "web_fetch",
      is_error: true,
      result: {
        error: "web_fetch failed: response exceeds maxBytes (20000)",
        code: "ERR_RESPONSE_TOO_LARGE",
        hint: "Use maxChars to limit extracted text, not maxBytes.",
        body: "Do not display the entire response body",
      },
    });
    expect(result).toMatchObject({
      kind: "tool_done",
      isError: true,
      error: "web_fetch failed: response exceeds maxBytes (20000)",
      errorCode: "ERR_RESPONSE_TOO_LARGE",
      hint: "Use maxChars to limit extracted text, not maxBytes.",
    });
    expect(result.body).toBeUndefined();
  });

  it("bounds error details and handles structured shell errors", () => {
    const result = map({
      type: "tool_result",
      tool: "run_shell",
      is_error: true,
      error: { message: "shell error ".repeat(1000) },
      result: { hint: "hint ".repeat(1000) },
    });
    expect(result.error).toHaveLength(1200);
    expect(result.hint).toHaveLength(1200);
  });

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
