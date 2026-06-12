/**
 * md-lite — the chat webview's whitelist markdown renderer. Safety is the
 * spec: escape-FIRST, output contains ONLY attribute-less
 * pre/code/strong/em/br, so innerHTML is safe by construction. Also pins the
 * embedding constraints (no backticks / dollar-brace / </script> in the
 * source — it is inlined into a template literal) and that BOTH webview
 * scripts still parse.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mdLite,
  escapeHtml,
} from "../../../vscode-extension/src/chat/md-lite.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

const T = "`";

describe("mdLite — safety", () => {
  it("escapes HTML before any formatting (script/img cannot survive)", () => {
    expect(mdLite("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(mdLite("<img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(mdLite('"quotes" & <tags>')).toBe(
      "&quot;quotes&quot; &amp; &lt;tags&gt;",
    );
  });

  it("output uses only the whitelisted attribute-less tags", () => {
    const html = mdLite(
      "# Head\n**b** *i* " +
        T +
        "c" +
        T +
        "\n" +
        T +
        T +
        T +
        "js\n<evil>\n" +
        T +
        T +
        T,
    );
    const tags = [...html.matchAll(/<\/?([a-z]+)(\s[^>]*)?>/g)];
    for (const [, name, attrs] of tags) {
      expect(["pre", "code", "strong", "em", "br"]).toContain(name);
      expect(attrs || "").toBe("");
    }
  });

  it("escapeHtml covers the five metacharacters", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("mdLite — rendering", () => {
  it("fenced code blocks with language tag", () => {
    const html = mdLite(
      "before\n" + T + T + T + "js\nconst a = 1 < 2;\n" + T + T + T + "\nafter",
    );
    expect(html).toContain("<pre><code>const a = 1 &lt; 2;\n</code></pre>");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("inline code, bold, italic, headings, line breaks", () => {
    expect(mdLite("use " + T + "x<y" + T + " now")).toBe(
      "use <code>x&lt;y</code> now",
    );
    expect(mdLite("**bold** and *it*")).toBe(
      "<strong>bold</strong> and <em>it</em>",
    );
    expect(mdLite("# Title\nbody")).toBe("<strong>Title</strong><br>body");
    expect(mdLite("a\nb")).toBe("a<br>b");
  });

  it("markdown inside code spans/fences is NOT formatted", () => {
    expect(mdLite(T + "**not bold**" + T)).toBe("<code>**not bold**</code>");
    const fenced = mdLite(T + T + T + "\n**raw**\n" + T + T + T);
    expect(fenced).toContain("<pre><code>**raw**\n</code></pre>");
  });

  it("unterminated fence degrades to inline text (no hang, no html)", () => {
    const html = mdLite("x " + T + T + T + "js\nbroken");
    expect(html).toContain("broken");
    expect(html).not.toContain("<pre>");
  });

  it("empty/null-ish inputs", () => {
    expect(mdLite("")).toBe("");
    expect(mdLite(null)).toBe("");
  });
});

describe("embedding constraints", () => {
  const src = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../vscode-extension/src/chat/md-lite.js",
    ),
    "utf8",
  );

  it("source contains no backtick, no dollar-brace, no closing script tag", () => {
    expect(src.includes(T)).toBe(false);
    expect(src.includes("${")).toBe(false);
    expect(src.toLowerCase().includes("</script")).toBe(false);
  });

  it("ALL embedded webview scripts parse (md-lite + at-mention + main)", () => {
    const page = buildChatHtml({ cspSource: "x:", nonce: "N" });
    const scripts = [
      ...page.matchAll(/<script nonce="N">([\s\S]*?)<\/script>/g),
    ];
    expect(scripts.length).toBe(3);
    for (const [, body] of scripts) {
      expect(() => new Function(body)).not.toThrow();
    }
    expect(scripts[0][1]).toContain("mdLite"); // renderer loads first
    expect(scripts[1][1]).toContain("ccAtMention"); // helpers before main
  });
});
