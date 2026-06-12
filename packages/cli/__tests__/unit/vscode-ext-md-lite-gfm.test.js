/**
 * md-lite GFM extensions — tables as bordered grids + task-list checkboxes
 * (Claude Code 2.1.136 / 2.1.149 parity). The whitelist invariant must hold:
 * output tags ⊆ {pre, code, strong, em, br, table, tr, th, td}, all
 * attribute-less — innerHTML stays safe by construction.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { mdLite } from "../../../vscode-extension/src/chat/md-lite.js";

const SRC = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../vscode-extension/src/chat/md-lite.js",
  ),
  "utf8",
);

describe("GFM tables", () => {
  it("renders header + body rows as table/th/td", () => {
    const html = mdLite("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    expect(html).toBe(
      "<table><tr><th>a</th><th>b</th></tr>" +
        "<tr><td>1</td><td>2</td></tr>" +
        "<tr><td>3</td><td>4</td></tr></table>",
    );
  });

  it("keeps inline formatting and escaping inside cells", () => {
    const html = mdLite(
      "| name | note |\n|:--|--:|\n| **bold** | <script>alert(1)</script> |",
    );
    expect(html).toContain("<td><strong>bold</strong></td>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("pipes without a separator line are NOT a table", () => {
    const html = mdLite("| just | text |\nplain line");
    expect(html).not.toContain("<table>");
    expect(html).toContain("| just | text |");
  });

  it("text around a table still renders", () => {
    const html = mdLite("before\n| a |\n|---|\n| 1 |\nafter");
    expect(html).toContain("before");
    expect(html).toContain("<table>");
    expect(html).toContain("after");
  });
});

describe("GFM task lists", () => {
  it("renders checked and unchecked boxes as text glyphs", () => {
    const html = mdLite("- [ ] todo\n- [x] done\n- [X] DONE\n* [ ] star");
    expect(html).toBe("☐ todo<br>☑ done<br>☑ DONE<br>☐ star");
  });

  it("preserves indentation and leaves plain bullets alone", () => {
    expect(mdLite("  - [ ] nested")).toBe("  ☐ nested");
    expect(mdLite("- plain item")).toBe("- plain item");
    expect(mdLite("a [x] mid-line stays")).toBe("a [x] mid-line stays");
  });
});

describe("whitelist invariant", () => {
  it("output tags stay within the attribute-less whitelist", () => {
    const html = mdLite(
      "# h\n**b** *i* `c`\n| a | <b>x</b> |\n|---|---|\n| [ ] | [x] |\n" +
        "- [ ] t\n```js\n<img src=x onerror=alert(1)>\n```",
    );
    const tags = [...html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)];
    const allowed = new Set([
      "pre", "code", "strong", "em", "br", "table", "tr", "th", "td",
    ]);
    for (const [, name, attrs] of tags) {
      expect(allowed.has(name.toLowerCase()), `tag <${name}>`).toBe(true);
      expect(attrs.trim(), `attrs on <${name}>`).toBe("");
    }
  });

  it("source keeps the embedding constraints (no backtick / dollar-brace / close-script)", () => {
    expect(SRC.includes(String.fromCharCode(96))).toBe(false);
    expect(SRC.includes("${")).toBe(false);
    expect(SRC.toLowerCase().includes("</script")).toBe(false);
  });
});
