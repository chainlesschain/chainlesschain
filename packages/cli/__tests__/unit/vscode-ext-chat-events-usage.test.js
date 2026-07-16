/**
 * Live token/iteration feedback in the chat panel. The CLI emits `token_usage`
 * once per LLM call and `iteration_warning` when a turn approaches its
 * iteration budget — both used to be UI-silent. Now: token_usage maps to a
 * `usage` message the webview accumulates into a live status-line tally, and
 * iteration_warning surfaces as a visible ⚠ info line. Headless (pure mapper +
 * generated-HTML checks).
 */
import { describe, it, expect } from "vitest";
import {
  mapAgentEvent,
  createTurnState,
} from "../../../vscode-extension/src/chat/chat-events.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

const map = (evt) => mapAgentEvent(evt, createTurnState());

describe("chat-events — token_usage mapping", () => {
  it("maps a per-call usage event to kind:usage with the payload intact", () => {
    const usage = {
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_input_tokens: 900,
    };
    expect(map({ type: "token_usage", usage })).toEqual({
      kind: "usage",
      usage,
    });
  });

  it("drops a malformed token_usage (no usage object) instead of posting junk", () => {
    expect(map({ type: "token_usage" })).toBe(null);
    expect(map({ type: "token_usage", usage: "12" })).toBe(null);
  });
});

describe("chat-events — iteration_warning mapping", () => {
  it("surfaces the CLI's message as a visible ⚠ info line", () => {
    const r = map({
      type: "iteration_warning",
      message: "20 of 25 iterations used",
    });
    expect(r.kind).toBe("info");
    expect(r.text).toBe("⚠ 20 of 25 iterations used");
  });

  it("falls back to a generic warning when the message is missing", () => {
    const r = map({ type: "iteration_warning" });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/^⚠ .*iteration/i);
  });

  it("iteration_budget_exhausted renders an info line (a budget stop must not be a silent stall)", () => {
    expect(map({ type: "iteration_budget_exhausted", budget: 25 })).toEqual({
      kind: "info",
      text: "⏹ turn budget exhausted (25 turns)",
    });
    expect(map({ type: "iteration_budget_exhausted" })).toEqual({
      kind: "info",
      text: "⏹ turn budget exhausted",
    });
  });
});

describe("chat webview — live usage tally wiring", () => {
  const html = buildChatHtml({ cspSource: "vscode-resource:", nonce: "n" });

  it("handles the usage message kind and accumulates a per-turn tally", () => {
    expect(html).toContain('case "usage"');
    expect(html).toContain("turnTokens");
    // Accumulates (+=) rather than overwriting — multiple LLM calls per turn.
    expect(html).toMatch(/turnTokens\.inp \+= u\.input_tokens \|\| 0/);
    expect(html).toMatch(/turnTokens\.out \+= u\.output_tokens \|\| 0/);
    expect(html).toMatch(
      /turnTokens\.cached \+= u\.cache_read_input_tokens \|\| 0/,
    );
  });

  it("resets the tally at send time and at turn_end (no cross-turn bleed)", () => {
    const resets = html.match(/turnTokens = null/g) || [];
    // declaration-adjacent reset in send() + turn_end reset
    expect(resets.length).toBeGreaterThanOrEqual(2);
  });

  it("formats large counts compactly via tokfmt in both live and final lines", () => {
    expect(html).toContain("const tokfmt");
    expect(html).toMatch(/tokfmt\(turnTokens\.inp\)/);
    expect(html).toMatch(/tokfmt\(m\.usage\.input_tokens\|\|0\)/);
  });
});
