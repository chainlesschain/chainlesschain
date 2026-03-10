/**
 * Unit tests for summarizer skill handler (v1.2.0)
 * Tests pure text summarization and _deps for URL/file operations
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/summarizer/handler.js");

describe("summarizer handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (handler._deps) {
      handler._deps.fs = {
        existsSync: vi.fn().mockReturnValue(false),
        statSync: vi.fn().mockReturnValue({ size: 1000 }),
        readFileSync: vi.fn().mockReturnValue("Test content for reading."),
      };
      handler._deps.path = {
        resolve: vi.fn((p) => `/resolved/${p}`),
        extname: vi.fn((p) => {
          const m = p.match(/\.[^.]+$/);
          return m ? m[0] : "";
        }),
        basename: vi.fn((p, ext) => {
          const base = p.split("/").pop();
          return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
        }),
      };
    }
  });

  describe("execute() - summarize-text", () => {
    it("should summarize text content", async () => {
      const longText =
        "Artificial intelligence has transformed the technology landscape significantly. Machine learning algorithms process vast amounts of data to find patterns. Natural language processing enables computers to understand human speech. Deep learning neural networks achieve remarkable accuracy in image recognition. These advancements have led to practical applications across many industries.";
      const result = await handler.execute(
        { input: `summarize-text ${longText}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("summarize-text");
      expect(result.summary).toBeDefined();
      expect(result.word_count).toBeGreaterThan(0);
      expect(result.key_points).toBeDefined();
      expect(result.topics).toBeDefined();
    });

    it("should return error for too-short text", async () => {
      const result = await handler.execute(
        { input: "summarize-text hi" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("at least 10");
    });

    it("should calculate reading time", async () => {
      const words = Array(400).fill("word").join(" ");
      const result = await handler.execute(
        { input: `summarize-text ${words}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.reading_time_min).toBe(2);
    });

    it("should extract topics from text", async () => {
      const text =
        "JavaScript frameworks like React and Angular are popular. JavaScript developers use Node.js for backend. JavaScript testing with Jest is common. JavaScript builds with Webpack.";
      const result = await handler.execute(
        { input: `summarize-text ${text}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.topics.length).toBeGreaterThan(0);
      expect(result.topics[0].word).toBeDefined();
      expect(result.topics[0].frequency).toBeGreaterThan(0);
    });
  });

  describe("execute() - summarize-file", () => {
    it("should summarize a file", async () => {
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn().mockReturnValue(true);
        handler._deps.fs.statSync = vi.fn().mockReturnValue({ size: 500 });
        handler._deps.fs.readFileSync = vi
          .fn()
          .mockReturnValue(
            "Technology continues to evolve rapidly in the modern era. Computers process information at incredible speeds. Software development practices have improved significantly. Testing ensures code quality and reliability. Documentation helps teams collaborate effectively.",
          );
        handler._deps.path.extname = vi.fn().mockReturnValue(".txt");
        handler._deps.path.resolve = vi.fn((p) => p);
        handler._deps.path.basename = vi.fn((p) => "test.txt");
      }
      const result = await handler.execute(
        { input: "summarize-file /path/to/test.txt" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("summarize-file");
      expect(result.fileName).toBeDefined();
    });

    it("should return error for missing file", async () => {
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn().mockReturnValue(false);
        handler._deps.path.resolve = vi.fn((p) => p);
      }
      const result = await handler.execute(
        { input: "summarize-file /nonexistent.txt" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("should reject files larger than 10MB", async () => {
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn().mockReturnValue(true);
        handler._deps.fs.statSync = vi
          .fn()
          .mockReturnValue({ size: 11 * 1024 * 1024 });
        handler._deps.path.resolve = vi.fn((p) => p);
      }
      const result = await handler.execute(
        { input: "summarize-file /big-file.txt" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("too large");
    });

    it("should strip HTML for .html files", async () => {
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn().mockReturnValue(true);
        handler._deps.fs.statSync = vi.fn().mockReturnValue({ size: 200 });
        handler._deps.fs.readFileSync = vi
          .fn()
          .mockReturnValue(
            "<html><body><p>This is a paragraph about technology and innovation in software development practices.</p><p>Another paragraph about testing and quality assurance methodologies.</p></body></html>",
          );
        handler._deps.path.extname = vi.fn().mockReturnValue(".html");
        handler._deps.path.resolve = vi.fn((p) => p);
        handler._deps.path.basename = vi.fn((p) => "page.html");
      }
      const result = await handler.execute(
        { input: "summarize-file /page.html" },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });

    it("should return error for empty file path", async () => {
      const result = await handler.execute({ input: "summarize-file" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - auto-detect action", () => {
    it("should detect URL input", async () => {
      // This will fail to fetch since we haven't mocked HTTP, but tests the routing
      if (handler._deps) {
        const { EventEmitter } = require("events");
        handler._deps.https = {
          get: vi.fn((url, opts, cb) => {
            if (typeof opts === "function") {
              cb = opts;
            }
            const res = new EventEmitter();
            res.statusCode = 200;
            process.nextTick(() => {
              res.emit(
                "data",
                "<html><body><p>Hello world this is a test page with enough content to summarize properly for the algorithm.</p></body></html>",
              );
              res.emit("end");
            });
            if (cb) {
              cb(res);
            }
            const req = new EventEmitter();
            req.on = vi.fn().mockReturnThis();
            return req;
          }),
        };
      }
      // Even if mock doesn't work perfectly, test the parsing
      const result = await handler.execute(
        { input: "https://example.com" },
        {},
        {},
      );
      expect(result.action).toBe("summarize-url");
    });
  });

  describe("execute() - empty/default", () => {
    it("should handle empty input gracefully", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      // Empty input defaults to summarize-text with empty target → error
      expect(result.success).toBe(false);
    });
  });
});
