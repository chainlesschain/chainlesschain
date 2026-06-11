/** REPL /rewind + double-Esc — pure conversation-rewind helpers. */
import { describe, it, expect } from "vitest";
import {
  listUserTurns,
  rewindToTurn,
  renderTurnList,
  PREVIEW_CHARS,
} from "../../src/lib/repl-rewind.js";

function conv() {
  return [
    { role: "system", content: "SYS" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "answer one" },
    { role: "user", content: "second question with quite a lot of extra words to overflow the preview cap maybe" },
    { role: "assistant", content: "answer two" },
    { role: "user", content: [{ type: "text", text: "multimodal" }] },
    { role: "assistant", content: "answer three" },
  ];
}

describe("listUserTurns", () => {
  it("lists user turns newest-first with 1-based picks", () => {
    const turns = listUserTurns(conv());
    expect(turns.map((t) => t.n)).toEqual([1, 2, 3]);
    expect(turns[0].index).toBe(5);
    expect(turns[2].preview).toBe("first question");
  });

  it("caps previews and respects the limit", () => {
    const turns = listUserTurns(conv(), { limit: 2 });
    expect(turns).toHaveLength(2);
    expect(turns[1].preview.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(turns[1].preview.endsWith("…")).toBe(true);
  });
});

describe("rewindToTurn", () => {
  it("drops the picked user turn and everything after it", () => {
    const messages = conv();
    const res = rewindToTurn(messages, 2); // "second question…"
    expect(res.removed).toBe(4);
    expect(messages).toHaveLength(3);
    expect(messages[messages.length - 1].content).toBe("answer one");
    expect(res.text).toContain("second question");
  });

  it("rewinding to the newest turn just drops it (edit-and-resend)", () => {
    const messages = conv();
    const res = rewindToTurn(messages, 1);
    expect(res.removed).toBe(2);
    expect(res.text).toBeNull(); // multimodal content → no prefill text
    expect(messages[messages.length - 1].content).toBe("answer two");
  });

  it("returns null on a bad pick and leaves messages intact", () => {
    const messages = conv();
    expect(rewindToTurn(messages, 99)).toBeNull();
    expect(rewindToTurn(messages, 0)).toBeNull();
    expect(rewindToTurn(messages, "x")).toBeNull();
    expect(messages).toHaveLength(7);
  });
});

describe("renderTurnList", () => {
  it("renders numbered lines and an empty placeholder", () => {
    const out = renderTurnList(listUserTurns(conv()));
    expect(out).toContain(" 1. ");
    expect(out.split("\n")).toHaveLength(3);
    expect(renderTurnList([])).toContain("no user turns");
  });
});
