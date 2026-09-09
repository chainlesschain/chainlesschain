import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGovernedSkillSynthesisCandidateEvaluator,
  isGovernedSkillSynthesisCandidateEvaluator,
} from "../../src/lib/evolution/governed-skill-synthesis-candidate-evaluator.js";
import {
  createGovernedSkillSynthesisProviderChat,
  isGovernedSkillSynthesisProviderChat,
} from "../../src/lib/evolution/governed-skill-synthesis-provider-chat.js";
import {
  assertDistinctSkillSynthesisModelRoles,
  createGovernedSkillSynthesisModelEvaluator,
  isGovernedSkillSynthesisEvaluationReceipt,
  isGovernedSkillSynthesisModelEvaluator,
} from "../../src/lib/evolution/governed-skill-synthesis-model-evaluator.js";
import { SkillSynthesizer } from "../../src/lib/learning/skill-synthesizer.js";

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
    ).rejects.toThrow("bounded text");
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

describe("governed learning synthesis model evaluator", () => {
  const content = `---
name: review-security-config
description: Review a security configuration
version: 1.0.0
---

## Procedure
1. Read the configuration
2. Analyze the policy
3. Report findings

## Pitfalls
- Avoid unsupported assumptions

## Verification
Confirm every finding identifies its configuration key

## Metadata
- Source: trajectory
`;
  const request = {
    skillName: "review-security-config",
    content,
    pattern: {
      name: "review-security-config",
      tools: ["read_config", "analyze_policy", "report_findings"],
    },
    trajectory: {
      id: "trajectory-model-grade",
      toolChain: [
        { tool: "read_config" },
        { tool: "analyze_policy" },
        { tool: "report_findings" },
      ],
    },
  };
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;

  function evaluatorFixture({
    contents,
    reasons = ["clear-procedure"],
    score = 0.91,
  } = {}) {
    const responses = contents || [
      JSON.stringify({
        candidate_digest: digest,
        score,
        reasons,
      }),
    ];
    let responseIndex = 0;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                responses[Math.min(responseIndex++, responses.length - 1)],
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const graderChat = createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "pilot-secret",
      maxTokens: 256,
      timeoutMs: 1_000,
    });
    const deterministicEvaluator =
      createGovernedSkillSynthesisCandidateEvaluator();
    const evaluator = createGovernedSkillSynthesisModelEvaluator({
      descriptor: {
        authorityId: "authority:model-grader",
        revision: 3,
        handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
      },
      deterministicEvaluator,
      graderChat,
      minScore: 0.8,
      attestReceipt: async ({ receiptDigest }) => `attested:${receiptDigest}`,
      verifyAttestation: async ({ receiptDigest, attestation }) =>
        attestation === `attested:${receiptDigest}`,
    });
    return { evaluator, fetchMock, graderChat };
  }

  it("binds a separate model grade to the exact candidate digest", async () => {
    const { evaluator, graderChat } = evaluatorFixture();
    expect(isGovernedSkillSynthesisModelEvaluator(evaluator)).toBe(true);
    expect(assertDistinctSkillSynthesisModelRoles(evaluator, vi.fn())).toBe(
      true,
    );
    expect(() =>
      assertDistinctSkillSynthesisModelRoles(evaluator, graderChat),
    ).toThrow("must be distinct");

    const result = await evaluator(request);
    expect(result).toMatchObject({
      accepted: true,
      reason: "model-evaluation-passed",
      receipt: {
        authenticated: true,
        durable: false,
        candidateDigest: digest,
        trajectoryId: "trajectory-model-grade",
        modelScore: 0.91,
        minScore: 0.8,
      },
    });
    expect(isGovernedSkillSynthesisEvaluationReceipt(result.receipt)).toBe(
      true,
    );
  });

  it("treats safety reason codes as a hard rejection despite a high score", async () => {
    const { evaluator } = evaluatorFixture({
      reasons: ["clear-procedure", "unsafe-instruction"],
      score: 0.99,
    });
    await expect(evaluator(request)).resolves.toMatchObject({
      accepted: false,
      receipt: {
        accepted: false,
        reasons: ["clear-procedure", "unsafe-instruction"],
      },
    });
  });

  it("retries malformed model output within the fixed attempt bound", async () => {
    const { evaluator, fetchMock } = evaluatorFixture({
      contents: [
        "not-json",
        JSON.stringify({
          candidate_digest: digest,
          score: 0.9,
          reasons: ["grounded-tools", "verifiable-outcome"],
        }),
      ],
    });

    await expect(evaluator(request)).resolves.toMatchObject({
      accepted: true,
      receipt: { attempts: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when receipt attestation cannot be verified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidate_digest: digest,
                  score: 0.9,
                  reasons: ["clear-procedure"],
                }),
              },
            },
          ],
        }),
      })),
    );
    const evaluator = createGovernedSkillSynthesisModelEvaluator({
      descriptor: {
        authorityId: "authority:model-grader",
        revision: 1,
        handlerArtifactDigest: `sha256:${"b".repeat(64)}`,
      },
      deterministicEvaluator: createGovernedSkillSynthesisCandidateEvaluator(),
      graderChat: createGovernedSkillSynthesisProviderChat({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "pilot-secret",
      }),
      minScore: 0.8,
      attestReceipt: async () => "invalid",
      verifyAttestation: async () => false,
    });

    await expect(evaluator(request)).rejects.toThrow("attestation rejected");
  });

  it("persists a governed evaluation receipt before committing SKILL.md", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-synthesis-model-eval-"),
    );
    try {
      const candidateOutputDir = path.join(root, "candidates");
      const activeSkillsDir = path.join(root, "active");
      fs.mkdirSync(activeSkillsDir);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, requestOptions) => {
          const body = JSON.parse(requestOptions.body);
          const match = body.messages[1].content.match(
            /Candidate digest: (sha256:[a-f0-9]{64})/u,
          );
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      candidate_digest: match[1],
                      score: 0.92,
                      reasons: ["grounded-tools", "verifiable-outcome"],
                    }),
                  },
                },
              ],
            }),
          };
        }),
      );
      const graderChat = createGovernedSkillSynthesisProviderChat({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "pilot-secret",
      });
      const evaluator = createGovernedSkillSynthesisModelEvaluator({
        descriptor: {
          authorityId: "authority:model-grader",
          revision: 1,
          handlerArtifactDigest: `sha256:${"c".repeat(64)}`,
        },
        deterministicEvaluator:
          createGovernedSkillSynthesisCandidateEvaluator(),
        graderChat,
        minScore: 0.8,
        attestReceipt: async ({ receiptDigest }) => `attested:${receiptDigest}`,
        verifyAttestation: async ({ receiptDigest, attestation }) =>
          attestation === `attested:${receiptDigest}`,
      });
      const trajectory = {
        id: "trajectory-persisted-evaluation",
        userIntent: "Review security configuration",
        toolChain: [
          { tool: "read_config", status: "success" },
          { tool: "analyze_policy", status: "success" },
          { tool: "report_findings", status: "success" },
        ],
        outcomeScore: 0.95,
      };
      const trajectoryStore = {
        findComplexUnprocessed: vi.fn(() => [trajectory]),
        findSimilar: vi.fn(() => [{ id: "similar" }]),
        markSynthesized: vi.fn(),
      };
      const synthesizer = new SkillSynthesizer(
        { prepare: vi.fn(() => ({ all: vi.fn(() => []) })) },
        async () =>
          JSON.stringify({
            name: "review-security-config",
            description: "Review a security configuration",
            procedure: [
              "Read the configuration",
              "Analyze the policy",
              "Report findings",
            ],
            pitfalls: ["Avoid unsupported assumptions"],
            verification: "Confirm every finding identifies its key",
            tools: ["read_config", "analyze_policy", "report_findings"],
          }),
        trajectoryStore,
        {
          minToolCount: 1,
          minScore: 0,
          minSimilar: 1,
          candidateOutputDir,
          activeSkillsDirs: [activeSkillsDir],
          evaluateCandidate: evaluator,
        },
      );

      await expect(synthesizer.synthesize()).resolves.toMatchObject({
        status: "completed",
        created: ["review-security-config"],
      });
      const versionDir = path.join(
        candidateOutputDir,
        "review-security-config",
        "1.0.0",
      );
      const persisted = JSON.parse(
        fs.readFileSync(path.join(versionDir, "EVALUATION.json"), "utf8"),
      );
      expect(persisted).toMatchObject({
        authenticated: true,
        durable: false,
        modelScore: 0.92,
        accepted: true,
      });
      expect(fs.existsSync(path.join(versionDir, "SKILL.md"))).toBe(true);
      expect(fs.readdirSync(activeSkillsDir)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
