import { describe, it, expect } from "vitest";
import {
  TUI_MODES,
  DEFAULT_TUI_MODE,
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  resolveTuiMode,
  envNoFlicker,
  windowLines,
  diffRepaint,
  searchTranscript,
  formatHyperlink,
  supportsHyperlinks,
  renderTuiStatus,
} from "../../src/repl/fullscreen-tui.js";

describe("resolveTuiMode precedence", () => {
  it("defaults to default when nothing is set", () => {
    expect(resolveTuiMode()).toBe("default");
    expect(DEFAULT_TUI_MODE).toBe("default");
    expect(TUI_MODES).toEqual(["default", "fullscreen"]);
  });

  it("an explicit arg beats env and setting", () => {
    expect(
      resolveTuiMode({ arg: "default", env: "1", setting: "fullscreen" }),
    ).toBe("default");
    expect(resolveTuiMode({ arg: "fullscreen", setting: "default" })).toBe(
      "fullscreen",
    );
  });

  it("CC_NO_FLICKER forces fullscreen over the persisted setting", () => {
    expect(resolveTuiMode({ env: "1", setting: "default" })).toBe("fullscreen");
    expect(resolveTuiMode({ env: "true" })).toBe("fullscreen");
  });

  it("falls back to the persisted setting, then default", () => {
    expect(resolveTuiMode({ setting: "fullscreen" })).toBe("fullscreen");
    expect(resolveTuiMode({ setting: "nonsense" })).toBe("default");
    expect(resolveTuiMode({ arg: "bogus" })).toBe("default");
  });
});

describe("envNoFlicker", () => {
  it("recognizes truthy spellings only", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE"]) {
      expect(envNoFlicker(v)).toBe(true);
    }
    for (const v of ["0", "", "off", "no", null, undefined]) {
      expect(envNoFlicker(v)).toBe(false);
    }
  });
});

describe("windowLines", () => {
  it("shows everything when it fits", () => {
    const w = windowLines(["a", "b", "c"], { rows: 24, reserveBottom: 2 });
    expect(w.visible).toEqual(["a", "b", "c"]);
    expect(w.hiddenCount).toBe(0);
    expect(w.firstVisible).toBe(0);
  });

  it("tail-anchors and reports the hidden count when it overflows", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `L${i}`);
    const w = windowLines(lines, { rows: 10, reserveBottom: 2 });
    // capacity = 10 - 2 = 8, newest 8 visible
    expect(w.visible).toHaveLength(8);
    expect(w.visible[0]).toBe("L22");
    expect(w.visible[7]).toBe("L29");
    expect(w.hiddenCount).toBe(22);
    expect(w.firstVisible).toBe(22);
  });

  it("keeps at least one visible row for tiny terminals", () => {
    const w = windowLines(["a", "b", "c"], { rows: 1, reserveBottom: 5 });
    expect(w.visible).toHaveLength(1);
    expect(w.visible[0]).toBe("c");
  });
});

describe("diffRepaint (no-flicker)", () => {
  it("emits nothing when the frame is unchanged", () => {
    expect(diffRepaint(["a", "b"], ["a", "b"])).toBe("");
  });

  it("rewrites only the changed rows, cursor-addressed", () => {
    const out = diffRepaint(["a", "b", "c"], ["a", "X", "c"], { origin: 1 });
    // only row 2 rewritten (origin 1 + index 1)
    expect(out).toContain("[2;1H");
    expect(out).toContain("X");
    expect(out).not.toContain("[1;1H");
    expect(out).not.toContain("[3;1H");
  });

  it("clears rows that disappeared and honors a non-1 origin", () => {
    const out = diffRepaint(["a", "b", "c"], ["a"], { origin: 5 });
    // rows for indexes 1,2 (screen rows 6,7) cleared to empty
    expect(out).toContain("[6;1H");
    expect(out).toContain("[7;1H");
    expect(out).toContain("[2K");
  });
});

describe("searchTranscript", () => {
  const messages = [
    { role: "user", text: "please FIX the login bug" },
    { role: "assistant", text: "line one\nfound a bug in auth\nline three" },
  ];

  it("finds case-insensitive matches with position + snippet", () => {
    const hits = searchTranscript(messages, "bug");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ index: 0, line: 0, role: "user" });
    expect(hits[1]).toMatchObject({ index: 1, line: 1, role: "assistant" });
    expect(hits[1].snippet).toBe("found a bug in auth");
  });

  it("respects caseSensitive and empty query", () => {
    expect(
      searchTranscript(messages, "FIX", { caseSensitive: true }),
    ).toHaveLength(1);
    expect(
      searchTranscript(messages, "fix", { caseSensitive: true }),
    ).toHaveLength(0);
    expect(searchTranscript(messages, "")).toEqual([]);
  });
});

describe("formatHyperlink", () => {
  it("wraps text in an OSC-8 escape when supported", () => {
    const link = formatHyperlink("PR #12", "https://x/pr/12");
    expect(link).toContain("]8;;https://x/pr/12");
    expect(link).toContain("PR #12");
  });

  it("degrades to text + url when unsupported", () => {
    expect(
      formatHyperlink("PR #12", "https://x/pr/12", { supported: false }),
    ).toBe("PR #12 (https://x/pr/12)");
    expect(
      formatHyperlink("https://x", "https://x", { supported: false }),
    ).toBe("https://x");
  });

  it("returns bare text when there is no url", () => {
    expect(formatHyperlink("plain", "")).toBe("plain");
  });
});

describe("supportsHyperlinks", () => {
  it("honors overrides and known terminals", () => {
    expect(supportsHyperlinks({ FORCE_HYPERLINK: "1" })).toBe(true);
    expect(supportsHyperlinks({ TERM_PROGRAM: "iTerm.app" })).toBe(true);
    expect(supportsHyperlinks({ WT_SESSION: "abc" })).toBe(true);
    expect(
      supportsHyperlinks({ TERM_PROGRAM: "iTerm.app", NO_HYPERLINK: "1" }),
    ).toBe(false);
    expect(supportsHyperlinks({})).toBe(false);
  });
});

describe("alt-screen + status", () => {
  it("exposes distinct enter/leave sequences", () => {
    expect(ALT_SCREEN_ENTER).toContain("?1049h");
    expect(ALT_SCREEN_LEAVE).toContain("?1049l");
    expect(ALT_SCREEN_ENTER).not.toBe(ALT_SCREEN_LEAVE);
  });

  it("describes each mode", () => {
    expect(renderTuiStatus("fullscreen")).toMatch(/fullscreen/);
    expect(renderTuiStatus("default")).toMatch(/default/);
    expect(renderTuiStatus("bogus")).toMatch(/default/);
  });
});
