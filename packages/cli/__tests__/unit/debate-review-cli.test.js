import { describe, it, expect, vi, afterEach } from "vitest";
import {
  startDebate,
  DEFAULT_PERSPECTIVES,
  PERSPECTIVE_PROMPTS,
} from "../../src/lib/cowork/debate-review-cli.js";

describe("debate-review-cli", () => {
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

  describe("DEFAULT_PERSPECTIVES", () => {
    it("has 3 default perspectives", () => {
      expect(DEFAULT_PERSPECTIVES).toEqual([
        "performance",
        "security",
        "maintainability",
      ]);
    });
  });

  describe("PERSPECTIVE_PROMPTS", () => {
    it("has prompts for all default perspectives", () => {
      for (const p of DEFAULT_PERSPECTIVES) {
        expect(PERSPECTIVE_PROMPTS[p]).toBeDefined();
        expect(PERSPECTIVE_PROMPTS[p].role).toBeTruthy();
        expect(PERSPECTIVE_PROMPTS[p].system).toBeTruthy();
      }
    });

    it("has prompts for additional perspectives", () => {
      expect(PERSPECTIVE_PROMPTS.correctness).toBeDefined();
      expect(PERSPECTIVE_PROMPTS.architecture).toBeDefined();
    });
  });

  // ─── startDebate ──────────────────────────────────────

  describe("startDebate", () => {
    it("runs debate with 3 perspectives + moderator = 4 LLM calls", async () => {
      mockFetch([
        // Performance reviewer
        {
          message: {
            content:
              "## Issues Found\n- LOW: Minor allocation\n## Verdict\nAPPROVE with minor notes",
          },
        },
        // Security reviewer
        {
          message: {
            content:
              "## Issues Found\n- HIGH: SQL injection risk\n## Verdict\nNEEDS_WORK due to security",
          },
        },
        // Maintainability reviewer
        {
          message: {
            content:
              "## Issues Found\n- MEDIUM: Long function\n## Verdict\nAPPROVE",
          },
        },
        // Moderator
        {
          message: {
            content:
              "Final Verdict: NEEDS_WORK\nConsensus Score: 65\nKey findings: security issue found.",
          },
        },
      ]);

      const result = await startDebate({
        target: "test.js",
        code: "const query = `SELECT * FROM users WHERE id = ${id}`;",
        llmOptions: { provider: "ollama" },
      });

      expect(result.target).toBe("test.js");
      expect(result.perspectives).toEqual(DEFAULT_PERSPECTIVES);
      expect(result.reviews).toHaveLength(3);
      expect(result.verdict).toBe("NEEDS_WORK");
      expect(result.consensusScore).toBe(65);
      expect(result.summary).toContain("security");
    });

    it("uses custom perspectives", async () => {
      mockFetch([
        { message: { content: "## Verdict\nAPPROVE" } },
        { message: { content: "Final Verdict: APPROVE\nConsensus Score: 90" } },
      ]);

      const result = await startDebate({
        target: "test",
        code: "console.log('hello');",
        perspectives: ["correctness"],
        llmOptions: { provider: "ollama" },
      });

      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].perspective).toBe("correctness");
    });

    it("handles unknown perspectives gracefully", async () => {
      mockFetch([
        { message: { content: "## Verdict\nAPPROVE" } },
        { message: { content: "Final Verdict: APPROVE\nConsensus Score: 80" } },
      ]);

      const result = await startDebate({
        target: "test",
        code: "code",
        perspectives: ["custom-unknown"],
        llmOptions: { provider: "ollama" },
      });

      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].perspective).toBe("custom-unknown");
    });

    it("handles LLM error for individual reviewer", async () => {
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
            message: { content: "Final Verdict: APPROVE\nConsensus Score: 50" },
          }),
        };
      });

      const result = await startDebate({
        target: "test",
        code: "code",
        perspectives: ["performance"],
        llmOptions: { provider: "ollama" },
      });

      expect(result.reviews[0].verdict).toBe("ERROR");
      expect(result.reviews[0].review).toContain("Error:");
    });

    it("extracts REJECT verdict", async () => {
      mockFetch([
        { message: { content: "## Verdict\nREJECT - critical vulnerability" } },
        { message: { content: "Final Verdict: REJECT\nConsensus Score: 30" } },
      ]);

      const result = await startDebate({
        target: "test",
        code: "eval(userInput)",
        perspectives: ["security"],
        llmOptions: { provider: "ollama" },
      });

      expect(result.reviews[0].verdict).toBe("REJECT");
    });

    it("defaults consensus score to 50 when not parseable", async () => {
      mockFetch([
        { message: { content: "## Verdict\nAPPROVE" } },
        {
          message: {
            content: "Final Verdict: APPROVE\nNo numeric score here.",
          },
        },
      ]);

      const result = await startDebate({
        target: "test",
        code: "good code",
        perspectives: ["performance"],
        llmOptions: { provider: "ollama" },
      });

      expect(result.consensusScore).toBe(50);
    });
  });
});
