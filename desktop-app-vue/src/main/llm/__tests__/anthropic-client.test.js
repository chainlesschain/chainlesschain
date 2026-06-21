/**
 * AnthropicClient — sampling-param gating tests.
 *
 * Current Claude models (Opus 4.7/4.8, Fable 5/Mythos 5) return a 400 if the
 * request carries temperature/top_p/top_k. The desktop config ships a default
 * temperature, so once the default model moved to claude-opus-4-8 those params
 * had to be omitted for the rejecting models or the default chat would fail.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  AnthropicClient,
  modelRejectsSamplingParams,
} = require("../anthropic-client.js");

describe("modelRejectsSamplingParams", () => {
  it("flags Opus 4.7/4.8 + Fable/Mythos 5 (reject sampling params)", () => {
    expect(modelRejectsSamplingParams("claude-opus-4-8")).toBe(true);
    expect(modelRejectsSamplingParams("claude-opus-4-7")).toBe(true);
    expect(modelRejectsSamplingParams("claude-fable-5")).toBe(true);
    expect(modelRejectsSamplingParams("claude-mythos-5")).toBe(true);
  });

  it("does NOT flag models that accept sampling params", () => {
    expect(modelRejectsSamplingParams("claude-sonnet-4-6")).toBe(false);
    expect(modelRejectsSamplingParams("claude-opus-4-6")).toBe(false);
    expect(modelRejectsSamplingParams("claude-haiku-4-5")).toBe(false);
    expect(modelRejectsSamplingParams("claude-3-5-sonnet-20241022")).toBe(
      false,
    );
  });

  it("handles empty / non-string input", () => {
    expect(modelRejectsSamplingParams("")).toBe(false);
    expect(modelRejectsSamplingParams(null)).toBe(false);
    expect(modelRejectsSamplingParams(undefined)).toBe(false);
  });
});

describe("AnthropicClient.buildPayload — sampling-param gating", () => {
  const mk = (model) => new AnthropicClient({ apiKey: "x", model });
  const msgs = [{ role: "user", content: "hi" }];

  it("OMITS temperature/top_p/top_k for claude-opus-4-8 (would 400)", () => {
    const p = mk("claude-opus-4-8").buildPayload(
      msgs,
      { temperature: 0.7, top_p: 0.9, top_k: 5 },
      false,
    );
    expect(p.model).toBe("claude-opus-4-8");
    expect(p.temperature).toBeUndefined();
    expect(p.top_p).toBeUndefined();
    expect(p.top_k).toBeUndefined();
  });

  it("KEEPS temperature for claude-sonnet-4-6 (accepts it)", () => {
    const p = mk("claude-sonnet-4-6").buildPayload(
      msgs,
      { temperature: 0.7 },
      false,
    );
    expect(p.temperature).toBe(0.7);
  });

  it("KEEPS temperature for legacy claude-3.x", () => {
    const p = mk("claude-3-5-sonnet-20241022").buildPayload(
      msgs,
      { temperature: 0.3 },
      false,
    );
    expect(p.temperature).toBe(0.3);
  });

  it("sends only ONE of temperature/top_p for Sonnet 4.6 (both → 400)", () => {
    // The desktop config defaults BOTH temperature and top_p; Claude 4.x rejects
    // them together. Prefer temperature, drop top_p.
    const p = mk("claude-sonnet-4-6").buildPayload(
      msgs,
      { temperature: 0.7, top_p: 0.9, top_k: 40 },
      false,
    );
    expect(p.temperature).toBe(0.7);
    expect(p.top_p).toBeUndefined();
    expect(p.top_k).toBe(40); // top_k still allowed alongside one of temp/top_p
  });

  it("uses top_p for Sonnet 4.6 when temperature is absent", () => {
    const p = mk("claude-opus-4-6").buildPayload(msgs, { top_p: 0.9 }, false);
    expect(p.top_p).toBe(0.9);
    expect(p.temperature).toBeUndefined();
  });

  it("legacy claude-3.x still accepts BOTH temperature and top_p", () => {
    const p = mk("claude-3-5-sonnet-20241022").buildPayload(
      msgs,
      { temperature: 0.3, top_p: 0.9 },
      false,
    );
    expect(p.temperature).toBe(0.3);
    expect(p.top_p).toBe(0.9);
  });

  it("still works when no sampling params are passed", () => {
    const p = mk("claude-opus-4-8").buildPayload(msgs, {}, false);
    expect(p.temperature).toBeUndefined();
    expect(p.max_tokens).toBeGreaterThan(0);
  });
});
