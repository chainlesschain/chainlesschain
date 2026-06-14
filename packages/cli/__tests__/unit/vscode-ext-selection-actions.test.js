/**
 * "Explain / Refactor selection" editor context-menu actions (Claude Code
 * parity). The pure prompt builder seeds the chat input with an `@selection`
 * request (the CLI expands it to the live selection via the bridge) plus a
 * file + line pointer; explain is send-ready, refactor leaves the caret open.
 */
import { describe, it, expect } from "vitest";

import {
  formatSelectionPrompt,
  formatRange,
} from "../../../vscode-extension/src/chat/selection-actions.js";

describe("formatRange", () => {
  it("formats a single line and a span (0-based → 1-based)", () => {
    expect(formatRange(0, 0)).toBe("line 1");
    expect(formatRange(10, 19)).toBe("lines 11-20");
  });
  it("treats a missing/identical end as a single line", () => {
    expect(formatRange(4)).toBe("line 5");
    expect(formatRange(4, 4)).toBe("line 5");
    expect(formatRange(4, 2)).toBe("line 5"); // defensive: end before start
  });
});

describe("formatSelectionPrompt", () => {
  it("explain → a send-ready @selection prompt with file + lines", () => {
    const out = formatSelectionPrompt("explain", {
      relPath: "src/app.ts",
      startLine: 10,
      endLine: 19,
    });
    expect(out).toBe(
      "Explain @selection (in src/app.ts, lines 11-20) — what it does and how it works.\n",
    );
  });

  it("refactor → an open prompt ending with ': ' so the user can describe it", () => {
    const out = formatSelectionPrompt("refactor", {
      relPath: "src/app.ts",
      startLine: 4,
      endLine: 4,
    });
    expect(out).toBe(
      "Refactor @selection (in src/app.ts, line 5) — describe the change you want, then send: ",
    );
  });

  it("normalizes Windows paths and omits the (in …) clause without a path", () => {
    expect(
      formatSelectionPrompt("explain", {
        relPath: "src\\a.ts",
        startLine: 0,
        endLine: 0,
      }),
    ).toContain("@selection (in src/a.ts, line 1)");
    const noPath = formatSelectionPrompt("explain", {
      startLine: 0,
      endLine: 0,
    });
    expect(noPath).toBe(
      "Explain @selection — what it does and how it works.\n",
    );
  });

  it("defaults unknown actions to explain", () => {
    expect(
      formatSelectionPrompt("whatever", {
        relPath: "x.ts",
        startLine: 0,
        endLine: 0,
      }),
    ).toContain("Explain @selection");
  });
});
