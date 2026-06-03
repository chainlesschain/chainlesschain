/**
 * llm-manager-media-categories.test.js — Path B-3 tests
 *
 * Tests the 3 new media LLM categories (ASR, AUDIO_ANALYSIS, VIDEO_VLM)
 * and verifies no regression on existing 7 categories.
 */

import { describe, test, expect } from "vitest";

const {
  LLM_CATEGORIES,
  CATEGORY_PROVIDER_PRIORITY,
  CATEGORY_OPTIONS,
  inferCategoryFromModelHints,
  pickProviderForCategory,
  isProviderConfigured,
} = require("../../../src/main/llm/llm-manager.js");

// ── LLM_CATEGORIES enum ──────────────────────────────────────────

describe("LLM_CATEGORIES", () => {
  test("has 10 categories (7 original + 3 media)", () => {
    expect(Object.keys(LLM_CATEGORIES)).toHaveLength(10);
  });

  test("original 7 categories unchanged", () => {
    expect(LLM_CATEGORIES.QUICK).toBe("quick");
    expect(LLM_CATEGORIES.DEEP).toBe("deep");
    expect(LLM_CATEGORIES.REASONING).toBe("reasoning");
    expect(LLM_CATEGORIES.VISION).toBe("vision");
    expect(LLM_CATEGORIES.CREATIVE).toBe("creative");
    expect(LLM_CATEGORIES.EMBEDDING).toBe("embedding");
    expect(LLM_CATEGORIES.AUDIO).toBe("audio");
  });

  test("3 new media categories exist", () => {
    expect(LLM_CATEGORIES.ASR).toBe("asr");
    expect(LLM_CATEGORIES.AUDIO_ANALYSIS).toBe("audio-analysis");
    expect(LLM_CATEGORIES.VIDEO_VLM).toBe("video-vlm");
  });
});

// ── CATEGORY_PROVIDER_PRIORITY ────────────────────────────────────

describe("CATEGORY_PROVIDER_PRIORITY", () => {
  test("asr priority starts with openai (whisper)", () => {
    const p = CATEGORY_PROVIDER_PRIORITY["asr"];
    expect(p[0]).toBe("openai");
    expect(p).toContain("gemini");
    expect(p).toContain("ollama");
  });

  test("audio-analysis priority starts with ollama (local tools)", () => {
    const p = CATEGORY_PROVIDER_PRIORITY["audio-analysis"];
    expect(p[0]).toBe("ollama");
  });

  test("video-vlm priority starts with gemini (native video)", () => {
    const p = CATEGORY_PROVIDER_PRIORITY["video-vlm"];
    expect(p[0]).toBe("gemini");
    expect(p).toContain("openai");
    expect(p).toContain("anthropic");
  });
});

// ── CATEGORY_OPTIONS ──────────────────────────────────────────────

describe("CATEGORY_OPTIONS", () => {
  test("asr has transcription task", () => {
    expect(CATEGORY_OPTIONS["asr"].requireAudio).toBe(true);
    expect(CATEGORY_OPTIONS["asr"].task).toBe("transcription");
  });

  test("audio-analysis is localOnly", () => {
    expect(CATEGORY_OPTIONS["audio-analysis"].localOnly).toBe(true);
    expect(CATEGORY_OPTIONS["audio-analysis"].task).toBe("beat-detection");
  });

  test("video-vlm requires multimodal", () => {
    expect(CATEGORY_OPTIONS["video-vlm"].requireMultimodal).toBe(true);
    expect(CATEGORY_OPTIONS["video-vlm"].task).toBe("video-review");
  });
});

// ── inferCategoryFromModelHints ───────────────────────────────────

describe("inferCategoryFromModelHints — media categories", () => {
  test("capability: transcription → asr", () => {
    expect(inferCategoryFromModelHints({ capability: "transcription" })).toBe(
      "asr",
    );
  });

  test("capability: asr → asr", () => {
    expect(inferCategoryFromModelHints({ capability: "asr" })).toBe("asr");
  });

  test("capability: audio-analysis → audio-analysis", () => {
    expect(inferCategoryFromModelHints({ capability: "audio-analysis" })).toBe(
      "audio-analysis",
    );
  });

  test("capability: beat-detection → audio-analysis", () => {
    expect(inferCategoryFromModelHints({ capability: "beat-detection" })).toBe(
      "audio-analysis",
    );
  });

  test("beatDetection: true → audio-analysis", () => {
    expect(inferCategoryFromModelHints({ beatDetection: true })).toBe(
      "audio-analysis",
    );
  });

  test("capability: video-vlm → video-vlm", () => {
    expect(inferCategoryFromModelHints({ capability: "video-vlm" })).toBe(
      "video-vlm",
    );
  });

  test("capability: video-review → video-vlm", () => {
    expect(inferCategoryFromModelHints({ capability: "video-review" })).toBe(
      "video-vlm",
    );
  });

  test("videoVlm: true → video-vlm", () => {
    expect(inferCategoryFromModelHints({ videoVlm: true })).toBe("video-vlm");
  });

  // Regression: existing categories still work
  test("capability: audio still → audio (not asr)", () => {
    expect(inferCategoryFromModelHints({ capability: "audio" })).toBe("audio");
  });

  test("capability: vision still → vision", () => {
    expect(inferCategoryFromModelHints({ capability: "vision" })).toBe(
      "vision",
    );
  });

  test("no hints → quick", () => {
    expect(inferCategoryFromModelHints({})).toBe("quick");
  });

  test("null → quick", () => {
    expect(inferCategoryFromModelHints(null)).toBe("quick");
  });
});

// ── pickProviderForCategory — media categories ────────────────────

describe("pickProviderForCategory — media categories", () => {
  const fakeConfig = {
    ollama: { url: "http://localhost:11434", model: "qwen2:7b" },
    openai: { apiKey: "sk-test", model: "gpt-4o" },
    gemini: { apiKey: "gem-test", model: "gemini-2.0-flash" },
    anthropic: { apiKey: "ant-test", model: "claude-opus-4-6" },
  };

  test("asr resolves to openai", () => {
    const result = pickProviderForCategory("asr", fakeConfig, "ollama");
    expect(result.provider).toBe("openai");
    expect(result.options.requireAudio).toBe(true);
  });

  test("audio-analysis resolves to ollama (local)", () => {
    const result = pickProviderForCategory(
      "audio-analysis",
      fakeConfig,
      "ollama",
    );
    expect(result.provider).toBe("ollama");
    expect(result.options.localOnly).toBe(true);
  });

  test("video-vlm resolves to gemini (native video)", () => {
    const result = pickProviderForCategory("video-vlm", fakeConfig, "ollama");
    expect(result.provider).toBe("gemini");
    expect(result.options.requireMultimodal).toBe(true);
  });

  test("video-vlm falls back when gemini not configured", () => {
    const noGemini = { ...fakeConfig };
    delete noGemini.gemini;
    const result = pickProviderForCategory("video-vlm", noGemini, "ollama");
    expect(result.provider).toBe("openai");
  });
});
