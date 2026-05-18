import { describe, it, expect } from "vitest";
import {
  extractText,
  extractTitle,
  extractMeta,
  querySelectorAll,
  extractLinks,
} from "../../src/lib/browser-automation.js";

describe("Browser Automation", () => {
  // ─── extractText ──────────────────────────────────────────────

  describe("extractText", () => {
    it("should strip HTML tags", () => {
      expect(extractText("<p>Hello <b>world</b></p>")).toContain("Hello world");
    });

    it("should remove script tags", () => {
      const html = '<p>Text</p><script>alert("x")</script><p>More</p>';
      const text = extractText(html);
      expect(text).toContain("Text");
      expect(text).toContain("More");
      expect(text).not.toContain("alert");
    });

    it("should remove style tags", () => {
      const html = "<style>body{color:red}</style><p>Content</p>";
      const text = extractText(html);
      expect(text).not.toContain("color");
      expect(text).toContain("Content");
    });

    it("should remove nav and footer", () => {
      const html = "<nav>Menu</nav><main>Content</main><footer>Footer</footer>";
      const text = extractText(html);
      expect(text).not.toContain("Menu");
      expect(text).not.toContain("Footer");
      expect(text).toContain("Content");
    });

    it("should decode HTML entities", () => {
      expect(extractText("&amp; &lt; &gt; &quot;")).toBe('& < > "');
    });

    it("should decode numeric entities", () => {
      expect(extractText("&#65;&#66;")).toBe("AB");
    });

    it("should convert br to newlines", () => {
      const text = extractText("A<br>B<br/>C");
      expect(text).toContain("A\nB\nC");
    });

    it("should collapse multiple newlines", () => {
      const text = extractText("<p>A</p><p></p><p></p><p>B</p>");
      expect(text).not.toMatch(/\n{3,}/);
    });

    it("should handle empty string", () => {
      expect(extractText("")).toBe("");
    });
  });

  // ─── extractTitle ─────────────────────────────────────────────

  describe("extractTitle", () => {
    it("should extract title", () => {
      expect(
        extractTitle("<html><head><title>My Page</title></head></html>"),
      ).toBe("My Page");
    });

    it("should return empty string if no title", () => {
      expect(extractTitle("<html><head></head></html>")).toBe("");
    });

    it("should trim whitespace", () => {
      expect(extractTitle("<title>  Spaced  Title  </title>")).toBe(
        "Spaced Title",
      );
    });
  });

  // ─── extractMeta ──────────────────────────────────────────────

  describe("extractMeta", () => {
    it("should extract meta description (name first)", () => {
      const html = '<meta name="description" content="A great page">';
      expect(extractMeta(html)).toBe("A great page");
    });

    it("should extract meta description (content first)", () => {
      const html = '<meta content="Another page" name="description">';
      expect(extractMeta(html)).toBe("Another page");
    });

    it("should return empty string if no meta description", () => {
      expect(extractMeta("<html></html>")).toBe("");
    });
  });

  // ─── querySelectorAll ─────────────────────────────────────────

  describe("querySelectorAll", () => {
    it("should find elements by tag", () => {
      const html = "<p>First</p><p>Second</p><div>Not this</div>";
      const results = querySelectorAll(html, "p");
      expect(results).toHaveLength(2);
      expect(results[0].text).toContain("First");
    });

    it("should find elements by class", () => {
      const html =
        '<div class="item active">Match</div><div class="other">Skip</div>';
      const results = querySelectorAll(html, "div.item");
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain("Match");
    });

    it("should find elements by id", () => {
      const html = '<div id="main">Target</div><div id="sidebar">Other</div>';
      const results = querySelectorAll(html, "div#main");
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain("Target");
    });

    it("should return empty for no matches", () => {
      const html = "<p>Text</p>";
      const results = querySelectorAll(html, "span");
      expect(results).toHaveLength(0);
    });

    it("should include html and text in results", () => {
      const html = "<p>Hello <b>world</b></p>";
      const results = querySelectorAll(html, "p");
      expect(results[0].html).toContain("<p>");
      expect(results[0].text).toContain("Hello world");
    });
  });

  // ─── extractLinks ────────────────────────────────────────────

  describe("extractLinks", () => {
    it("should extract links", () => {
      const html = '<a href="https://example.com">Example</a>';
      const links = extractLinks(html);
      expect(links).toHaveLength(1);
      expect(links[0].href).toBe("https://example.com");
      expect(links[0].text).toBe("Example");
    });

    it("should resolve relative URLs", () => {
      const html = '<a href="/about">About</a>';
      const links = extractLinks(html, "https://example.com");
      expect(links).toHaveLength(1);
      expect(links[0].href).toBe("https://example.com/about");
    });

    it("should skip hash-only links", () => {
      const html = '<a href="#section">Jump</a>';
      const links = extractLinks(html);
      expect(links).toHaveLength(0);
    });

    it("should skip empty text links", () => {
      const html = '<a href="https://example.com"><img src="x.png"></a>';
      const links = extractLinks(html);
      expect(links).toHaveLength(0);
    });

    it("should extract multiple links", () => {
      const html =
        '<a href="https://a.com">A</a> <a href="https://b.com">B</a>';
      const links = extractLinks(html);
      expect(links).toHaveLength(2);
    });
  });
});
