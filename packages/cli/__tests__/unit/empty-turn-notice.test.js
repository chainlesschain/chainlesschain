/**
 * empty-turn-notice — the REPL notice shown when an agent turn completes with
 * no answer text (Claude-Code 2.1.183 "silent turn completion with only
 * thinking blocks" parity).
 */
import { describe, it, expect } from "vitest";
import { emptyTurnNotice } from "../../src/repl/empty-turn-notice.js";

describe("emptyTurnNotice", () => {
  it("returns null when the turn produced an answer (nothing to add)", () => {
    expect(emptyTurnNotice({ response: "hello" })).toBeNull();
    expect(
      emptyTurnNotice({ response: "hi", reasoning: "thought" }),
    ).toBeNull();
    // whitespace is still rendered by the REPL's truthiness branch
    expect(emptyTurnNotice({ response: " " })).toBeNull();
  });

  it("notes reasoning-only turns (thinking blocks, no answer)", () => {
    const n = emptyTurnNotice({ response: "", reasoning: "let me think…" });
    expect(n).toBe("(the model returned reasoning but no answer text)");
  });

  it("notes a fully empty turn (no answer, no reasoning)", () => {
    expect(emptyTurnNotice({ response: "", reasoning: "" })).toBe(
      "(the model returned no text response)",
    );
    expect(emptyTurnNotice({})).toBe("(the model returned no text response)");
    expect(emptyTurnNotice({ response: null, reasoning: null })).toBe(
      "(the model returned no text response)",
    );
  });

  it("returns null when a hook suppressed the answer (handled elsewhere)", () => {
    expect(emptyTurnNotice({ response: "", suppressed: true })).toBeNull();
    expect(
      emptyTurnNotice({ response: "", reasoning: "x", suppressed: true }),
    ).toBeNull();
  });
});
