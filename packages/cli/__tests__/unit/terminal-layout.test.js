import { describe, expect, it } from "vitest";
import {
  layoutTerminalText,
  terminalDisplayWidth,
  wrapTerminalText,
} from "../../src/repl/terminal-layout.js";

describe("accessible terminal layout", () => {
  it("measures Latin, combining marks, CJK, and emoji by terminal cells", () => {
    expect(terminalDisplayWidth("abc")).toBe(3);
    expect(terminalDisplayWidth("e\u0301")).toBe(1);
    expect(terminalDisplayWidth("中文")).toBe(4);
    expect(terminalDisplayWidth("👩‍💻")).toBe(2);
    expect(terminalDisplayWidth("A中👩‍💻")).toBe(5);
  });

  it("wraps a mixed CJK line for a narrow terminal", () => {
    expect(wrapTerminalText("状态: 中文ABC完成", 8)).toMatchInlineSnapshot(`
      "状态: 中
      文ABC完
      成"
    `);
  });

  it("reflows from the original text after a resize", () => {
    const text = "Suggestion: 继续验证 tests";
    expect({
      narrow: layoutTerminalText(text, { columns: 10 }),
      wide: layoutTerminalText(text, { columns: 24 }),
    }).toMatchInlineSnapshot(`
      {
        "narrow": "Suggestion
      : 继续验证
       tests",
        "wide": "Suggestion: 继续验证 tes
      ts",
      }
    `);
  });

  it("preserves RTL logical order and stable screen-reader lines", () => {
    const rtl = "Status: مرحبا بالعالم";
    const output = layoutTerminalText(rtl, {
      columns: 8,
      screenReader: true,
    });
    expect(output).toBe(rtl);
    expect(output.indexOf("مرحبا")).toBeLessThan(output.indexOf("بالعالم"));
    expect(output).not.toContain(String.fromCharCode(27));
  });
});
