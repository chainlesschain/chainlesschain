import { describe, it, expect, vi, afterEach } from "vitest";
import {
  compare,
  DEFAULT_CRITERIA,
  VARIANT_PROFILES,
} from "../../src/lib/cowork/ab-comparator-cli.js";

describe("ab-comparator-cli", () => {
  afterEach(() => {
    if (globalThis._originalFetch) {
      globalThis.fetch = globalThis._originalFetch;
      delete globalThis._originalFetch;
    }
  });

  function mockFetch(responses) {
    globalThis._originalFetch = globalThis.fetch;
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => {
        const resp = responses[callIndex] || responses[responses.length - 1];
        callIndex++;
        return resp;
      },
    }));
  }

  // ─── Constants ────────────────────────────────────────

  describe("DEFAULT_CRITERIA", () => {
    it("has 3 default criteria", () => {
      expect(DEFAULT_CRITERIA).toEqual([
        "quality",
        "performance",
        "readability",
      ]);
    });
  });

  describe("VARIANT_PROFILES", () => {
    it("has 4 profiles", () => {
      expect(VARIANT_PROFILES).toHaveLength(4);
    });

    it("each profile has name and system prompt", () => {
      for (const p of VARIANT_PROFILES) {
        expect(p.name).toBeTruthy();
        expect(p.system).toBeTruthy();
      }
    });

    it("profiles have unique names", () => {
      const names = VARIANT_PROFILES.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  // ─── compare ──────────────────────────────────────────

  describe("compare", () => {
    it("generates variants and scores them", async () => {
      mockFetch([
        // Variant 1 (conservative)
        {
          message: {
            content:
              "## Approach\nUse simple for loop.\n## Trade-offs\nSimple but slow.",
          },
        },
        // Variant 2 (innovative)
        {
          message: {
            content:
              "## Approach\nUse Array.reduce.\n## Trade-offs\nModern but complex.",
          },
        },
        // Variant 3 (pragmatic)
        {
          message: {
            content: "## Approach\nUse forEach.\n## Trade-offs\nBalanced.",
          },
        },
        // Judge scoring
        {
          message: {
            content: `SCORES:
Variant 1 (conservative): quality=7, performance=8, readability=9
Variant 2 (innovative): quality=8, performance=6, readability=5
Variant 3 (pragmatic): quality=7, performance=7, readability=8

RANKING: conservative, pragmatic, innovative
WINNER: conservative
REASON: Best balance of performance and readability.`,
          },
        },
      ]);

      const result = await compare({
        prompt: "Sum an array of numbers",
        variants: 3,
        llmOptions: { provider: "ollama" },
      });

      expect(result.prompt).toBe("Sum an array of numbers");
      expect(result.criteria).toEqual(DEFAULT_CRITERIA);
      expect(result.variants).toHaveLength(3);
      expect(result.winner).toBe("conservative");
      expect(result.reason).toContain("readability");

      // Check that variants have scores
      expect(result.variants[0].scores.quality).toBe(7);
      expect(result.variants[0].totalScore).toBeGreaterThan(0);
    });

    it("limits variants to available profiles", async () => {
      mockFetch([
        { message: { content: "Solution A" } },
        { message: { content: "Solution B" } },
        { message: { content: "Solution C" } },
        { message: { content: "Solution D" } },
        {
          message: {
            content: `SCORES:
Variant 1 (conservative): quality=5
Variant 2 (innovative): quality=6
Variant 3 (pragmatic): quality=7
Variant 4 (performance-focused): quality=8

RANKING: performance-focused, pragmatic, innovative, conservative
WINNER: performance-focused
REASON: Best quality.`,
          },
        },
      ]);

      const result = await compare({
        prompt: "test",
        variants: 10, // More than available profiles
        llmOptions: { provider: "ollama" },
      });

      // Should cap at 4 (VARIANT_PROFILES.length)
      expect(result.variants.length).toBeLessThanOrEqual(4);
    });

    it("uses custom criteria", async () => {
      mockFetch([
        { message: { content: "Solution" } },
        {
          message: {
            content: `SCORES:
Variant 1 (conservative): speed=8, safety=9

RANKING: conservative
WINNER: conservative
REASON: Good.`,
          },
        },
      ]);

      const result = await compare({
        prompt: "test",
        variants: 1,
        criteria: ["speed", "safety"],
        llmOptions: { provider: "ollama" },
      });

      expect(result.criteria).toEqual(["speed", "safety"]);
    });

    it("handles variant generation error", async () => {
      globalThis._originalFetch = globalThis.fetch;
      let callIndex = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) {
          return { ok: false, status: 500 };
        }
        return {
          ok: true,
          json: async () => ({
            message: {
              content:
                "SCORES:\nVariant 1 (conservative): quality=5\nRANKING: conservative\nWINNER: conservative\nREASON: Only option.",
            },
          }),
        };
      });

      const result = await compare({
        prompt: "test",
        variants: 1,
        llmOptions: { provider: "ollama" },
      });

      expect(result.variants[0].solution).toContain("Error");
    });

    it("defaults scores to 5 when parsing fails", async () => {
      mockFetch([
        { message: { content: "Solution" } },
        {
          message: {
            content:
              "No parseable scores here\nWINNER: conservative\nREASON: Default.",
          },
        },
      ]);

      const result = await compare({
        prompt: "test",
        variants: 1,
        llmOptions: { provider: "ollama" },
      });

      // Default score is 5 per criterion
      for (const score of Object.values(result.variants[0].scores)) {
        expect(score).toBe(5);
      }
    });
  });
});
