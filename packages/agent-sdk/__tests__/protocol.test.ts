import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  contentDelta,
  isAgentEvent,
  isApprovalRequest,
  isContentDelta,
  isQuestionRequest,
  isMcpElicitationRequest,
  isResult,
  isSystemInit,
  type AgentStreamEvent,
} from "../src/protocol.js";
import {
  isApprovalDecision,
  validateApprovalDecision,
} from "../src/generated/app-protocol.js";

describe("protocol type guards", () => {
  it("validates canonical structured approval decisions from the generated schema", () => {
    expect(isApprovalDecision({ kind: "acceptOnce" })).toBe(true);
    expect(
      isApprovalDecision({
        kind: "acceptForSession",
        permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
      }),
    ).toBe(true);
    expect(
      validateApprovalDecision({ kind: "acceptOnce", unexpected: true }),
    ).toMatchObject({ ok: false });
    expect(isApprovalDecision({ kind: "allowEverything" })).toBe(false);
  });

  it("matches the shared ApprovalDecision conformance fixture", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          "../../agent-protocol/test/fixtures/approval-decisions.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Array<{ name: string; valid: boolean; value: unknown }>;
    for (const fixture of fixtures) {
      expect(validateApprovalDecision(fixture.value).ok, fixture.name).toBe(
        fixture.valid,
      );
    }
  });

  it("isAgentEvent requires an object with a string type", () => {
    expect(isAgentEvent({ type: "result" })).toBe(true);
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent("result")).toBe(false);
    expect(isAgentEvent({ type: 42 })).toBe(false);
  });

  it("isSystemInit matches only init with a session_id", () => {
    expect(
      isSystemInit({
        type: "system",
        subtype: "init",
        session_id: "s-1",
      } as AgentStreamEvent),
    ).toBe(true);
    expect(
      isSystemInit({ type: "system", subtype: "end" } as AgentStreamEvent),
    ).toBe(false);
    expect(
      isSystemInit({ type: "system", subtype: "init" } as AgentStreamEvent),
    ).toBe(false);
  });

  it("contentDelta extracts text and thinking deltas", () => {
    const text: AgentStreamEvent = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      },
    };
    const thinking: AgentStreamEvent = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "hmm" },
      },
    };
    expect(contentDelta(text)).toEqual({ kind: "text", text: "hi" });
    expect(contentDelta(thinking)).toEqual({ kind: "thinking", text: "hmm" });
    expect(isContentDelta({ type: "tool_use", tool: "x" })).toBe(false);
    expect(contentDelta({ type: "result" } as AgentStreamEvent)).toBeNull();
  });

  it("approval / question / result guards", () => {
    expect(
      isApprovalRequest({
        type: "approval_request",
        id: "appr-1",
        tool: "shell",
        command: "rm -rf x",
        risk: "high",
        rule: null,
        reason: null,
      }),
    ).toBe(true);
    expect(
      isApprovalRequest({ type: "approval_request" } as AgentStreamEvent),
    ).toBe(false);
    expect(
      isQuestionRequest({ type: "question_request", id: "q-1", question: "?" }),
    ).toBe(true);
    expect(
      isMcpElicitationRequest({
        type: "question_request",
        id: "mcp-1",
        question: "?",
        metadata: { kind: "mcp_elicitation" },
      }),
    ).toBe(true);
    expect(isResult({ type: "result" } as AgentStreamEvent)).toBe(true);
  });
});
