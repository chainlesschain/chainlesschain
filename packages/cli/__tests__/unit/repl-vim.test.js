/** Vim-mode NORMAL interpreter — pure keymap, no TTY. */
import { describe, it, expect } from "vitest";
import {
  createVimState,
  feedNormalKey,
  modeLabel,
} from "../../src/lib/repl-vim.js";

/** Normal-mode state seeded as if Esc was just pressed from insert. */
function normal(line, cursor = 0) {
  return { ...createVimState(line, cursor), mode: "normal" };
}
/** Feed a sequence of plain chars; returns final state. */
function type(state, keys) {
  let s = state;
  for (const ch of keys) s = feedNormalKey(s, ch, {});
  return s;
}

describe("motions", () => {
  it("h/l move within bounds", () => {
    let s = normal("hello", 2);
    expect(feedNormalKey(s, "h", {}).cursor).toBe(1);
    expect(feedNormalKey(s, "l", {}).cursor).toBe(3);
    expect(feedNormalKey(normal("hi", 0), "h", {}).cursor).toBe(0); // clamp
  });
  it("0 ^ $ jump to line ends", () => {
    expect(feedNormalKey(normal("  abc", 4), "0", {}).cursor).toBe(0);
    expect(feedNormalKey(normal("  abc", 4), "^", {}).cursor).toBe(2);
    expect(feedNormalKey(normal("abc", 0), "$", {}).cursor).toBe(2); // last char
  });
  it("w/b/e word motions", () => {
    expect(feedNormalKey(normal("foo bar baz", 0), "w", {}).cursor).toBe(4);
    expect(feedNormalKey(normal("foo bar baz", 4), "b", {}).cursor).toBe(0);
    expect(feedNormalKey(normal("foo bar", 0), "e", {}).cursor).toBe(2);
    // punctuation is its own word
    expect(feedNormalKey(normal("a.b", 0), "w", {}).cursor).toBe(1);
  });
  it("counts repeat motions (3l, 2w)", () => {
    expect(type(normal("abcdef", 0), "3l").cursor).toBe(3);
    expect(type(normal("a b c d", 0), "2w").cursor).toBe(4);
  });
});

describe("find motions f/F/t/T", () => {
  it("f<c> lands on the char, t<c> just before", () => {
    let s = feedNormalKey(normal("hello", 0), "f", {});
    expect(s.awaitChar.kind).toBe("f");
    expect(feedNormalKey(s, "l", {}).cursor).toBe(2);
    s = feedNormalKey(normal("hello", 0), "t", {});
    expect(feedNormalKey(s, "l", {}).cursor).toBe(1);
  });
  it("F<c> searches backward; miss rings the bell", () => {
    let s = feedNormalKey(normal("hello", 4), "F", {});
    expect(feedNormalKey(s, "e", {}).cursor).toBe(1);
    s = feedNormalKey(normal("hello", 0), "f", {});
    expect(feedNormalKey(s, "z", {}).message).toBe("bell");
  });
});

describe("entering insert mode", () => {
  it("i/a/A/I set cursor and switch mode", () => {
    expect(feedNormalKey(normal("abc", 1), "i", {})).toMatchObject({
      mode: "insert",
      cursor: 1,
    });
    expect(feedNormalKey(normal("abc", 1), "a", {})).toMatchObject({
      mode: "insert",
      cursor: 2,
    });
    expect(feedNormalKey(normal("abc", 1), "A", {})).toMatchObject({
      mode: "insert",
      cursor: 3,
    });
    expect(feedNormalKey(normal("  ab", 3), "I", {})).toMatchObject({
      mode: "insert",
      cursor: 2,
    });
  });
});

describe("char edits", () => {
  it("x deletes under cursor into register", () => {
    const s = feedNormalKey(normal("hello", 1), "x", {});
    expect(s.line).toBe("hllo");
    expect(s.cursor).toBe(1);
    expect(s.register.text).toBe("e");
  });
  it("X deletes before cursor", () => {
    expect(feedNormalKey(normal("hello", 2), "X", {}).line).toBe("hllo");
  });
  it("D deletes to end of line", () => {
    const s = feedNormalKey(normal("hello", 2), "D", {});
    expect(s.line).toBe("he");
    expect(s.register.text).toBe("llo");
  });
  it("C deletes to end and enters insert", () => {
    expect(feedNormalKey(normal("hello", 2), "C", {})).toMatchObject({
      line: "he",
      mode: "insert",
    });
  });
  it("r<c> replaces one char, ~ toggles case", () => {
    let s = feedNormalKey(normal("cat", 0), "r", {});
    expect(feedNormalKey(s, "b", {}).line).toBe("bat");
    expect(feedNormalKey(normal("aB", 0), "~", {})).toMatchObject({
      line: "AB",
      cursor: 1,
    });
  });
  it("3x deletes a run", () => {
    expect(type(normal("abcdef", 0), "3x").line).toBe("def");
  });
});

describe("operators d/c/y + motion", () => {
  it("dw deletes a word", () => {
    const s = type(normal("foo bar baz", 0), "dw");
    expect(s.line).toBe("bar baz");
    expect(s.register.text).toBe("foo ");
  });
  it("d$ deletes to end, d0 to start", () => {
    expect(type(normal("hello", 2), "d$").line).toBe("he");
    expect(type(normal("hello", 3), "d0").line).toBe("lo");
  });
  it("cw deletes word and enters insert", () => {
    expect(type(normal("foo bar", 0), "cw")).toMatchObject({
      line: "bar",
      mode: "insert",
    });
  });
  it("yw yanks without changing the line; p pastes after", () => {
    const y = type(normal("foo bar", 0), "yw");
    expect(y.line).toBe("foo bar");
    expect(y.register.text).toBe("foo ");
    const p = feedNormalKey({ ...y, cursor: 0 }, "p", {});
    expect(p.line).toBe("ffoo oo bar");
  });
  it("de inclusive deletes through word end", () => {
    expect(type(normal("foo bar", 0), "de").line).toBe(" bar");
  });
  it("df<c> deletes through the found char (inclusive)", () => {
    let s = feedNormalKey(normal("a,b,c", 0), "d", {});
    s = feedNormalKey(s, "f", {});
    expect(feedNormalKey(s, ",", {}).line).toBe("b,c");
  });
});

describe("linewise dd/cc/yy and paste", () => {
  it("dd clears the line into a linewise register", () => {
    const s = type(normal("hello world", 3), "dd");
    expect(s.line).toBe("");
    expect(s.register).toMatchObject({ text: "hello world", linewise: true });
  });
  it("yy then p appends the linewise text", () => {
    const y = type(normal("abc", 0), "yy");
    expect(y.line).toBe("abc");
    const p = feedNormalKey({ ...y, cursor: 1 }, "p", {});
    expect(p.line).toBe("abcabc"); // linewise paste → at end
  });
  it("cc clears and enters insert", () => {
    expect(type(normal("abc", 0), "cc")).toMatchObject({
      line: "",
      mode: "insert",
    });
  });
});

describe("submit / esc / unknown", () => {
  it("Enter sets submit", () => {
    expect(feedNormalKey(normal("hi", 0), "", { name: "return" }).submit).toBe(
      true,
    );
  });
  it("Esc clears pending without leaving normal", () => {
    const pending = feedNormalKey(normal("abc", 0), "d", {});
    expect(pending.pending).not.toBeNull();
    const cleared = feedNormalKey(pending, "", { name: "escape" });
    expect(cleared.pending).toBeNull();
    expect(cleared.mode).toBe("normal");
  });
  it("unknown key rings the bell and resets count", () => {
    const s = feedNormalKey({ ...normal("abc", 0), count: "2" }, "Z", {});
    expect(s.message).toBe("bell");
    expect(s.count).toBe("");
  });
  it("Backspace/arrows act as h/l motions", () => {
    expect(
      feedNormalKey(normal("abc", 2), "", { name: "backspace" }).cursor,
    ).toBe(1);
    expect(feedNormalKey(normal("abc", 0), "", { name: "right" }).cursor).toBe(
      1,
    );
  });
});

describe("modeLabel", () => {
  it("renders NORMAL/INSERT", () => {
    expect(modeLabel(normal("", 0))).toBe("NORMAL");
    expect(modeLabel(createVimState())).toBe("INSERT");
  });
});
