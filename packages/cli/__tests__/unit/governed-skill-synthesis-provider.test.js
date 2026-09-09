import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGovernedSkillSynthesisCandidateEvaluator,
  isGovernedSkillSynthesisCandidateEvaluator,
} from "../../src/lib/evolution/governed-skill-synthesis-candidate-evaluator.js";
import {
  createGovernedSkillSynthesisProviderChat,
  isGovernedSkillSynthesisProviderChat,
} from "../../src/lib/evolution/governed-skill-synthesis-provider-chat.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("governed learning synthesis provider chat", () => {
  it("uses a bounded cloud request without exposing its credential", async () => {
    const fetchMock = vi.fn(async (_url, request) => {
      expect(request.headers.Authorization).toBe("Bearer pilot-secret");
      expect(JSON.parse(request.body)).toMatchObject({
        model: "doubao-test",
        max_tokens: 256,
      });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"name":"safe-skill"}' } }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const chat = createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "pilot-secret",
      maxTokens: 256,
      timeoutMs: 1_000,
    });

    expect(isGovernedSkillSynthesisProviderChat(chat)).toBe(true);
    expect(Object.keys(chat)).toEqual([]);
    await expect(
      chat([
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Create a safe candidate." },
      ]),
    ).resolves.toBe('{"name":"safe-skill"}');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects unsafe endpoints, unsupported fields, and oversized prompts", async () => {
    expect(() =>
      createGovernedSkillSynthesisProviderChat({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "secret",
        baseUrl: "http://example.test/api/v3",
      }),
    ).toThrow("credential-free HTTPS");
    expect(() =>
      createGovernedSkillSynthesisProviderChat({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "secret",
        baseUrl: "https://example.test/api/v3",
      }),
    ).toThrow("built-in provider endpoint");
    expect(() =>
      createGovernedSkillSynthesisProviderChat({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "secret",
        fetch: vi.fn(),
      }),
    ).toThrow("unsupported fields");

    const chat = createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "secret",
    });
    await expect(
      chat([{ role: "user", content: "x".repeat(64 * 1024 + 1) }]),
    ).rejects.toThrow("bounded string");
  });
});

describe("governed learning synthesis deterministic evaluator", () => {
  const request = {
    skillName: "review-security-config",
    content: `---
name: review-security-config
description: Review a security configuration
version: 1.0.0
---

## Procedure
1. Inspect the configuration

## Pitfalls
- Avoid unsupported assumptions

## Verification
Report the risky settings

## Metadata
- Source: trajectory
`,
    pattern: {
      name: "review-security-config",
      tools: ["read", "audit"],
    },
    trajectory: { toolChain: [{ tool: "read" }, { tool: "audit" }] },
  };

  it("accepts grounded, schema-complete, plaintext-safe candidates", async () => {
    const evaluator = createGovernedSkillSynthesisCandidateEvaluator();
    expect(isGovernedSkillSynthesisCandidateEvaluator(evaluator)).toBe(true);
    await expect(evaluator(request)).resolves.toEqual({
      accepted: true,
      reason: "deterministic-precheck-passed",
    });
  });

  it("rejects ungrounded tools and persisted credentials", async () => {
    const evaluator = createGovernedSkillSynthesisCandidateEvaluator();
    await expect(
      evaluator({
        ...request,
        pattern: { ...request.pattern, tools: ["shell"] },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: "candidate-tools-not-grounded-in-trajectory",
    });
    await expect(
      evaluator({
        ...request,
        content: `${request.content}\napi_key=sk-abcdefghijklmnop\n`,
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: "candidate-secret-or-pii-detected",
    });
  });
});
