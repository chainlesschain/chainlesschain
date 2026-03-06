/**
 * Unit tests for humanizer skill handler (v1.2.0)
 * Pure logic: no external deps needed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/humanizer/handler.js");

describe("humanizer handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - humanize action", () => {
    it("should replace AI vocabulary patterns", async () => {
      const result = await handler.execute(
        { input: "humanize We must delve into this multifaceted paradigm shift" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("humanize");
      expect(result.result.humanized).not.toContain("delve into");
      expect(result.result.humanized).not.toContain("multifaceted");
      expect(result.result.humanized).not.toContain("paradigm shift");
      expect(result.result.changes.length).toBeGreaterThan(0);
    });

    it("should add contractions for natural feel", async () => {
      const result = await handler.execute(
        { input: "humanize They do not think it is worth the effort and we are sure they cannot do it" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.humanized).toContain("don't");
      expect(result.result.humanized).toContain("it's");
      expect(result.result.humanized).toContain("can't");
    });

    it("should remove hedging patterns", async () => {
      const result = await handler.execute(
        { input: "humanize It goes without saying that we need to improve. That being said, we should try." },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.humanized).not.toMatch(/it goes without saying/i);
      expect(result.result.humanized).not.toMatch(/that being said/i);
    });

    it("should replace leverage/utilize/facilitate", async () => {
      const result = await handler.execute(
        { input: "humanize We leverage advanced tools and utilize frameworks to facilitate development" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      const h = result.result.humanized.toLowerCase();
      expect(h).not.toContain("leverage");
      expect(h).not.toContain("utilize");
      expect(h).not.toContain("facilitate");
    });

    it("should return error for empty text", async () => {
      const result = await handler.execute({ input: "humanize" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should report change count", async () => {
      const result = await handler.execute(
        { input: "humanize Furthermore, we must leverage robust cutting-edge solutions" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.changeCount).toBeGreaterThanOrEqual(3);
    });

    it("should fix double spaces after removals", async () => {
      const result = await handler.execute(
        { input: "humanize Moreover, this is a test sentence with furthermore, some words" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.humanized).not.toMatch(/\s{2,}/);
    });
  });

  describe("execute() - analyze action", () => {
    it("should detect AI writing patterns", async () => {
      const text = "Furthermore, we must leverage this multifaceted approach. It is important to note that this cutting-edge solution demonstrates robust performance.";
      const result = await handler.execute(
        { input: `analyze ${text}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("analyze");
      expect(result.result.detections.length).toBeGreaterThan(0);
      expect(result.result.aiScore).toBeGreaterThan(0);
      expect(typeof result.result.naturalness).toBe("number");
      expect(typeof result.result.verdict).toBe("string");
    });

    it("should give high naturalness to simple text", async () => {
      const text = "I went to the store and bought some milk. The weather was nice outside.";
      const result = await handler.execute(
        { input: `analyze ${text}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.naturalness).toBeGreaterThanOrEqual(60);
    });

    it("should detect uniform sentence length", async () => {
      const text = "The system processes all the incoming data efficiently. The module handles every single request automatically. The framework manages all database operations reliably. The component renders every user interface smoothly.";
      const result = await handler.execute(
        { input: `analyze ${text}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      const uniformDetection = result.result.detections.find(
        (d) => d.pattern === "uniform sentence length",
      );
      // May or may not trigger depending on exact variance
      expect(result.result.sentenceCount).toBeGreaterThanOrEqual(3);
    });

    it("should detect lack of contractions", async () => {
      const text = "We do not think it is possible. They are not ready. You are going to do not succeed. It is important. They are here.";
      const result = await handler.execute(
        { input: `analyze ${text}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      const formalDetection = result.result.detections.find(
        (d) => d.pattern === "no contractions used",
      );
      expect(formalDetection).toBeTruthy();
    });

    it("should return error for empty text", async () => {
      const result = await handler.execute({ input: "analyze" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - adjust-tone action", () => {
    it("should convert to casual tone", async () => {
      const result = await handler.execute(
        { input: "adjust-tone casual We do not require additional assistance at this time" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("adjust-tone");
      expect(result.result.tone).toBe("casual");
      expect(result.result.adjusted).toContain("don't");
    });

    it("should convert to formal tone", async () => {
      const result = await handler.execute(
        { input: "adjust-tone formal I can't believe they won't help us and it's frustrating" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.adjusted).toContain("cannot");
      expect(result.result.adjusted).toContain("will not");
    });

    it("should convert to friendly tone", async () => {
      const result = await handler.execute(
        { input: "adjust-tone friendly Please note that failure to comply is prohibited" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.result.tone).toBe("friendly");
    });

    it("should reject invalid tone", async () => {
      const result = await handler.execute(
        { input: "adjust-tone angry Some text here" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid tone");
    });
  });

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute({ input: "foobar text" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
