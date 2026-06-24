/**
 * interpolatePlaceholders — `{placeholder}` 插值的两处易错点回归：
 *  - value 含 `$`（`$&` / `$$` 等）不得被 String.replace 当成替换模式展开；
 *  - placeholder 键含正则元字符须转义，不得误匹配其它内容。
 */

import { describe, it, expect } from "vitest";
import { interpolatePlaceholders } from "../useMultimediaI18n";

describe("interpolatePlaceholders", () => {
  it("replaces a simple placeholder", () => {
    expect(interpolatePlaceholders("Hello, {name}!", { name: "John" })).toBe(
      "Hello, John!",
    );
  });

  it("coerces number values and replaces all occurrences", () => {
    expect(interpolatePlaceholders("{n}/{n} files", { n: 5 })).toBe(
      "5/5 files",
    );
  });

  it("does NOT interpret $ patterns in the value (regression)", () => {
    // 字符串替换会把 $& 当成整段匹配、$$ 当成单个 $；函数替换原样保留。
    expect(interpolatePlaceholders("{a}", { a: "$&" })).toBe("$&");
    expect(interpolatePlaceholders("{a}", { a: "$$" })).toBe("$$");
    expect(interpolatePlaceholders("cost {p}", { p: "$$5" })).toBe("cost $$5");
  });

  it("escapes regex metacharacters in the placeholder key (regression)", () => {
    // 键 "a.b" 不转义会变成 /\{a.b\}/（. 匹配任意字符）→ 误匹配 "{aXb}"。
    expect(interpolatePlaceholders("{aXb} {a.b}", { "a.b": "Y" })).toBe(
      "{aXb} Y",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(interpolatePlaceholders("{a} {b}", { a: "1" })).toBe("1 {b}");
  });
});
