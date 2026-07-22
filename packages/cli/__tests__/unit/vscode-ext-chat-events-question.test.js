/**
 * Panel event mapping for the ask_user_question round-trip (Option B): the CLI
 * emits `question_request` when the agent is blocked on the user, and
 * `question_resolved` once answered/cancelled. chat-events maps them onto the
 * `question` UI kind (chat-view shows a QuickPick) and a closing info line.
 */
import { describe, it, expect } from "vitest";
import {
  mapAgentEvent,
  createTurnState,
} from "../../../vscode-extension/src/chat/chat-events.js";

const map = (evt) => mapAgentEvent(evt, createTurnState());

describe("chat-events — ask_user_question round-trip", () => {
  it("question_request → a question UI message with options + multiSelect", () => {
    const r = map({
      type: "question_request",
      id: "q-1",
      question: "Pick a color",
      options: [{ label: "Blue" }, { label: "Red" }],
      multiSelect: true,
    });
    expect(r).toEqual({
      kind: "question",
      id: "q-1",
      question: "Pick a color",
      options: [{ label: "Blue" }, { label: "Red" }],
      multiSelect: true,
    });
  });

  it("question_request with no options → free-text (null options)", () => {
    const r = map({ type: "question_request", id: "q-2", question: "Your name?" });
    expect(r).toMatchObject({ kind: "question", id: "q-2", options: null, multiSelect: false });
  });

  it("maps MCP elicitation metadata and requested schema for native forms", () => {
    const schema = { type: "object", properties: { token: { type: "string", format: "password" } }, required: ["token"] };
    const r = map({
      type: "question_request",
      id: "mcp-1",
      question: "Authentication required",
      metadata: { kind: "mcp_elicitation", server: "github", requestedSchema: schema },
    });
    expect(r).toMatchObject({
      kind: "question", elicitation: true, server: "github", requestedSchema: schema,
    });
  });

  it("question_resolved (answered) → a quiet confirmation line", () => {
    const r = map({ type: "question_resolved", id: "q-1", via: "user-answer" });
    expect(r).toEqual({ kind: "info", text: "✓ answered" });
  });

  it("question_resolved (timeout/cancel) → 'no answer — proceeding'", () => {
    expect(map({ type: "question_resolved", id: "q-1", via: "timeout" })).toEqual({
      kind: "info",
      text: "ask_user_question: no answer — proceeding",
    });
    expect(map({ type: "question_resolved", id: "q-1", via: "cancelled" }).text).toMatch(
      /proceeding/,
    );
  });
});
