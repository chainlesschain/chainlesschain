/**
 * XSSSanitizer unit tests — src/main/security/xss-sanitizer.js
 *
 * This security-critical module (XSS defense for HTML/Markdown/URL/JSON in the
 * main process) previously had NO test coverage. Suite documents the contract
 * and guards against regressions. It also locks in two fixes made alongside it:
 *   - validateURL: protocol-relative `//host` is no longer treated as a safe
 *     relative URL (it navigates to an external origin → open-redirect vector).
 *   - sanitizeJSON: string elements inside arrays are now sanitized (they were
 *     bypassing sanitization while object-property strings were cleaned).
 *
 * Pure static methods, zero deps → fully offline-testable.
 */

import { describe, it, expect } from "vitest";
import XSSSanitizer from "../../../src/main/security/xss-sanitizer.js";

describe("XSSSanitizer.sanitizeHTML", () => {
  it("removes <script> and other dangerous tags", () => {
    expect(
      XSSSanitizer.sanitizeHTML("<b>hi</b><script>alert(1)</script>"),
    ).toBe("<b>hi</b>");
    expect(XSSSanitizer.sanitizeHTML("a<iframe src=x></iframe>b")).toBe("ab");
  });

  it("strips dangerous event-handler attributes", () => {
    expect(XSSSanitizer.sanitizeHTML('<div onclick="evil()">x</div>')).toBe(
      "<div>x</div>",
    );
  });

  it("neutralizes javascript: in href and src", () => {
    expect(
      XSSSanitizer.sanitizeHTML('<a href="javascript:alert(1)">x</a>'),
    ).toBe('<a href="#">x</a>');
    expect(
      XSSSanitizer.sanitizeHTML('<img src="javascript:alert(1)">'),
    ).not.toMatch(/javascript:/i);
  });

  it("removes non-image data: URIs in src", () => {
    expect(
      XSSSanitizer.sanitizeHTML('<img src="data:text/html,<script>">'),
    ).not.toMatch(/data:text\/html/i);
  });

  it("keeps safe markup and returns '' for non-strings", () => {
    expect(XSSSanitizer.sanitizeHTML("<p>hello <b>world</b></p>")).toBe(
      "<p>hello <b>world</b></p>",
    );
    expect(XSSSanitizer.sanitizeHTML(null)).toBe("");
    expect(XSSSanitizer.sanitizeHTML(123)).toBe("");
  });
});

describe("XSSSanitizer.sanitizeMarkdown", () => {
  it("removes inline script and dangerous tags", () => {
    expect(
      XSSSanitizer.sanitizeMarkdown("# Title\n<script>alert(1)</script>"),
    ).not.toMatch(/<script/i);
  });

  it("neutralizes javascript: links and images", () => {
    // No-paren URL round-trips cleanly to the `#` placeholder.
    expect(XSSSanitizer.sanitizeMarkdown("[x](javascript:alert)")).toBe(
      "[x](#)",
    );
    expect(XSSSanitizer.sanitizeMarkdown("![x](javascript:alert)")).toBe(
      "![x](#)",
    );
    // The key security property: javascript: never survives (even with parens).
    expect(
      XSSSanitizer.sanitizeMarkdown("[x](javascript:alert(1))"),
    ).not.toMatch(/javascript:/i);
    expect(
      XSSSanitizer.sanitizeMarkdown("![x](javascript:alert(1))"),
    ).not.toMatch(/javascript:/i);
  });

  it("returns '' for non-strings", () => {
    expect(XSSSanitizer.sanitizeMarkdown(undefined)).toBe("");
  });
});

describe("XSSSanitizer.validateURL", () => {
  it("accepts same-origin relative paths", () => {
    for (const u of ["/path", "./x", "../x", "/a/b?c=1"]) {
      expect(XSSSanitizer.validateURL(u).valid).toBe(true);
    }
  });

  it("REJECTS protocol-relative //host (open-redirect vector)", () => {
    // Regression guard: `//evil.com` resolves to https://evil.com, must NOT be
    // classified as a safe relative URL.
    expect(XSSSanitizer.validateURL("//evil.com").valid).toBe(false);
    expect(XSSSanitizer.validateURL("//evil.com/x").valid).toBe(false);
  });

  it("blocks javascript: in any case / with leading space", () => {
    for (const u of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
    ]) {
      expect(XSSSanitizer.validateURL(u).valid).toBe(false);
    }
  });

  it("allows data:image/* but blocks other data: URIs", () => {
    expect(XSSSanitizer.validateURL("data:image/png;base64,AAA").valid).toBe(
      true,
    );
    expect(XSSSanitizer.validateURL("data:text/html,<script>").valid).toBe(
      false,
    );
  });

  it("allows whitelisted protocols, blocks others", () => {
    for (const u of [
      "http://ok.com",
      "https://ok.com/x?y=1",
      "mailto:a@b.com",
      "tel:123",
    ]) {
      expect(XSSSanitizer.validateURL(u).valid).toBe(true);
    }
    for (const u of ["ftp://x", "file:///etc/passwd", "vbscript:msgbox(1)"]) {
      expect(XSSSanitizer.validateURL(u).valid).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(XSSSanitizer.validateURL(null).valid).toBe(false);
    expect(XSSSanitizer.validateURL(42).valid).toBe(false);
  });
});

describe("XSSSanitizer.detectXSS", () => {
  it("detects common XSS patterns", () => {
    const names = (s) => XSSSanitizer.detectXSS(s).map((t) => t.name);
    expect(names("<script>alert(1)</script>")).toContain("Script Tag");
    expect(names('<a onclick="x()">')).toContain("Inline JavaScript");
    expect(names("javascript:alert(1)")).toContain("JavaScript Protocol");
    expect(names("<iframe src=x>")).toContain("Iframe Injection");
    expect(names("<object data=x>")).toContain("Object/Embed Tag");
    expect(names('<div style="x:expression(alert(1))">')).toContain(
      "Style with Expression",
    );
  });

  it("returns [] for clean content / non-strings", () => {
    expect(XSSSanitizer.detectXSS("just some plain text")).toEqual([]);
    expect(XSSSanitizer.detectXSS(null)).toEqual([]);
  });
});

describe("XSSSanitizer entity encode/decode", () => {
  it("encodes all special characters", () => {
    expect(XSSSanitizer.encodeHTMLEntities('<a href="x">\'/&')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&#x2F;&amp;",
    );
  });

  it("round-trips encode → decode", () => {
    const s = '<b>O\'Brien</b> & "co" /x';
    expect(
      XSSSanitizer.decodeHTMLEntities(XSSSanitizer.encodeHTMLEntities(s)),
    ).toBe(s);
  });
});

describe("XSSSanitizer.sanitizeJSON", () => {
  it("sanitizes HTML in object string values, preserves non-strings", () => {
    const out = XSSSanitizer.sanitizeJSON({
      a: "<script>alert(1)</script>",
      b: 5,
      c: null,
      d: "<b>ok</b>",
    });
    expect(out.a).toBe("");
    expect(out.b).toBe(5);
    expect(out.c).toBeNull();
    expect(out.d).toBe("<b>ok</b>"); // safe markup kept
  });

  it("sanitizes string elements inside arrays (regression)", () => {
    // Was a bypass: array string elements weren't sanitized.
    expect(
      XSSSanitizer.sanitizeJSON({ tags: ["<script>alert(1)</script>"] })
        .tags[0],
    ).toBe("");
    expect(XSSSanitizer.sanitizeJSON(["<iframe src=x></iframe>"])[0]).toBe("");
  });

  it("recurses nested objects", () => {
    const out = XSSSanitizer.sanitizeJSON({
      outer: { inner: "<script>x</script>" },
    });
    expect(out.outer.inner).toBe("");
  });

  it("passes through primitives", () => {
    expect(XSSSanitizer.sanitizeJSON(7)).toBe(7);
    expect(XSSSanitizer.sanitizeJSON(null)).toBeNull();
  });
});

describe("XSSSanitizer.sanitizeUserInput", () => {
  it("trims and enforces maxLength", () => {
    expect(XSSSanitizer.sanitizeUserInput("  hi  ")).toBe("hi");
    expect(XSSSanitizer.sanitizeUserInput("hello", { maxLength: 3 })).toBe(
      "hel",
    );
  });

  it("strips control characters", () => {
    expect(XSSSanitizer.sanitizeUserInput("a\x00b\x07c\x7f")).toBe("abc");
  });

  it("optionally encodes HTML, strips SQL chars, and path traversal", () => {
    expect(XSSSanitizer.sanitizeUserInput("<b>", { encodeHTML: true })).toBe(
      "&lt;b&gt;",
    );
    expect(
      XSSSanitizer.sanitizeUserInput("a';\"b", { preventSQLInjection: true }),
    ).toBe("ab");
    expect(
      XSSSanitizer.sanitizeUserInput("../../etc", {
        preventPathTraversal: true,
      }),
    ).not.toMatch(/\.\./);
  });

  it("returns '' for non-strings", () => {
    expect(XSSSanitizer.sanitizeUserInput(null)).toBe("");
  });
});

describe("XSSSanitizer.generateCSP", () => {
  it("produces a restrictive policy", () => {
    const csp = XSSSanitizer.generateCSP();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
  });
});
