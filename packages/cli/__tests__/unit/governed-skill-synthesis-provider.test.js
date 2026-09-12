import "../helpers/test-model-egress.js";
import { createHash, createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";

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
  isGovernedSkillSynthesisModelEvaluatorProcessIsolated,
} from "../../src/lib/evolution/governed-skill-synthesis-model-evaluator.js";
import { createGovernedSkillSynthesisProcessGrader } from "../../src/lib/evolution/governed-skill-synthesis-process-grader.js";
import {
  GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT,
  GovernedSkillSynthesisEvaluationLedgerAdapter,
} from "../../src/lib/evolution/governed-skill-synthesis-evaluation-ledger-adapter.js";
import { SkillSynthesizer } from "../../src/lib/learning/skill-synthesizer.js";

const roots = [];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createEvaluationPersistence(descriptor, verifyAttestation) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-synthesis-eval-ledger-"),
  );
  roots.push(root);
  const now = Date.parse("2026-09-09T00:00:00.000Z");
  const secret = "test-only-synthesis-evaluation-artifact-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/synthesis-evaluation-artifacts";
  const policyDigest = sha256("synthesis-evaluation-policy");
  const signature = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: "tenant-a",
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm,
        keyId,
        value: signature(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature: value }) =>
        value.algorithm === algorithm &&
        value.keyId === keyId &&
        value.value === signature(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now).toISOString(),
          decisionExpiresAt: new Date(now + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: sha256(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = { events: [] };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch-a",
      ledgerId: "ledger-a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent: (input, expected) => {
      const previous = state.events.at(-1);
      if (
        expected.expectedSequence !== state.events.length ||
        expected.expectedHeadDigest !== (previous?.eventDigest ?? null)
      ) {
        throw new Error("ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: sha256(canonical(input)),
      };
      state.events.push(event);
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: sha256(canonical(event)),
      };
    },
  };
  const adapter = new GovernedSkillSynthesisEvaluationLedgerAdapter({
    descriptor: {
      tenantId: "tenant-a",
      artifactTenantId: "tenant-a",
      streamId: "learning-synthesis",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      ...descriptor,
    },
    artifactPorts,
    ledger,
    ledgerArtifactResolver: artifactPorts.createEvolutionLedgerArtifactResolver(
      {
        purpose: "evolution-ledger",
      },
    ),
    verifyAttestation,
    allowSameProcessAttestationVerifier: true,
  });
  return {
    adapter,
    receiptPersistence: adapter.createReceiptPersistencePort(),
    state,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    const descriptor = {
      authorityId: "authority:model-grader",
      revision: 3,
      handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
    };
    const verifyAttestation = async ({ receiptDigest, attestation }) =>
      attestation === `attested:${receiptDigest}`;
    const persistence = createEvaluationPersistence(
      descriptor,
      verifyAttestation,
    );
    const evaluator = createGovernedSkillSynthesisModelEvaluator({
      allowSameProcessGrader: true,
      allowSameProcessAttestor: true,
      descriptor,
      deterministicEvaluator,
      graderChat,
      minScore: 0.8,
      attestReceipt: async ({ receiptDigest }) => `attested:${receiptDigest}`,
      verifyAttestation,
      receiptPersistence: persistence.receiptPersistence,
    });
    return { evaluator, fetchMock, graderChat, persistence };
  }

  it("requires a branded durable receipt persistence port", () => {
    expect(() =>
      createGovernedSkillSynthesisModelEvaluator({
        allowSameProcessGrader: true,
        allowSameProcessAttestor: true,
        descriptor: {
          authorityId: "authority:model-grader",
          revision: 1,
          handlerArtifactDigest: `sha256:${"e".repeat(64)}`,
        },
        deterministicEvaluator:
          createGovernedSkillSynthesisCandidateEvaluator(),
        graderChat: createGovernedSkillSynthesisProviderChat({
          provider: "volcengine",
          model: "doubao-test",
          apiKey: "pilot-secret",
        }),
        minScore: 0.8,
        attestReceipt: async () => "attested",
        verifyAttestation: async () => true,
        receiptPersistence: async () => ({
          authenticated: true,
          durable: true,
          persisted: true,
        }),
      }),
    ).toThrow("governed durable receipt persistence port");
  });

  it("rejects a same-process grader unless compatibility is explicit", () => {
    const descriptor = {
      authorityId: "authority:model-grader",
      revision: 1,
      handlerArtifactDigest: `sha256:${"9".repeat(64)}`,
    };
    const verifyAttestation = async () => true;
    const persistence = createEvaluationPersistence(
      descriptor,
      verifyAttestation,
    );
    expect(() =>
      createGovernedSkillSynthesisModelEvaluator({
        allowSameProcessAttestor: true,
        descriptor,
        deterministicEvaluator:
          createGovernedSkillSynthesisCandidateEvaluator(),
        graderChat: createGovernedSkillSynthesisProviderChat({
          provider: "volcengine",
          model: "doubao-test",
          apiKey: "pilot-secret",
        }),
        minScore: 0.8,
        attestReceipt: async () => "attested",
        verifyAttestation,
        receiptPersistence: persistence.receiptPersistence,
      }),
    ).toThrow("process-isolated grader");
  });

  it("rejects direct attestation ports unless compatibility is explicit", () => {
    const descriptor = {
      authorityId: "authority:model-attestor",
      revision: 1,
      handlerArtifactDigest: `sha256:${"8".repeat(64)}`,
    };
    const verifyAttestation = async () => true;
    const persistence = createEvaluationPersistence(
      descriptor,
      verifyAttestation,
    );
    expect(() =>
      createGovernedSkillSynthesisModelEvaluator({
        descriptor,
        deterministicEvaluator:
          createGovernedSkillSynthesisCandidateEvaluator(),
        graderChat: createGovernedSkillSynthesisProcessGrader({
          provider: "volcengine",
          model: "doubao-test",
          apiKey: "process-only-test-secret",
          timeoutMs: 1_000,
        }),
        minScore: 0.8,
        attestReceipt: async () => "attested",
        verifyAttestation,
        receiptPersistence: persistence.receiptPersistence,
      }),
    ).toThrow("isolated attestor");
  });

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
      persistence: {
        authenticated: true,
        durable: true,
        persisted: true,
      },
    });
    expect(isGovernedSkillSynthesisEvaluationReceipt(result.receipt)).toBe(
      true,
    );
    expect(result.persistence.receiptDigest).toBe(result.receipt.receiptDigest);
    expect(result.persistence.subjectRef.digest).toMatch(/^sha256:/u);
    expect(result.persistence).not.toHaveProperty("ledgerReceiptDigest");
    expect(result.persistence).toMatchObject({ recovered: false });
  });

  it("binds the fixed worker digest when grading occurs in a separate process", async () => {
    vi.spyOn(executionBroker, "spawn").mockImplementation(() => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let input = "";
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          input += chunk.toString("utf8");
          callback();
        },
        final(callback) {
          queueMicrotask(() => {
            const processRequest = JSON.parse(input);
            const match = processRequest.messages[1].content.match(
              /Candidate digest: (sha256:[a-f0-9]{64})/u,
            );
            child.stdout.end(
              `${JSON.stringify({
                ok: true,
                content: JSON.stringify({
                  candidate_digest: match[1],
                  score: 0.93,
                  reasons: ["grounded-tools", "verifiable-outcome"],
                }),
              })}\n`,
              () => child.emit("close", 0, null),
            );
          });
          callback();
        },
      });
      child.kill = vi.fn();
      return child;
    });
    const descriptor = {
      authorityId: "authority:process-grader",
      revision: 1,
      handlerArtifactDigest: `sha256:${"f".repeat(64)}`,
    };
    const verifyAttestation = async ({ receiptDigest, attestation }) =>
      attestation === `attested:${receiptDigest}`;
    const persistence = createEvaluationPersistence(
      descriptor,
      verifyAttestation,
    );
    const evaluator = createGovernedSkillSynthesisModelEvaluator({
      allowSameProcessAttestor: true,
      descriptor,
      deterministicEvaluator: createGovernedSkillSynthesisCandidateEvaluator(),
      graderChat: createGovernedSkillSynthesisProcessGrader({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "process-only-test-secret",
        timeoutMs: 1_000,
      }),
      minScore: 0.8,
      attestReceipt: async ({ receiptDigest }) => `attested:${receiptDigest}`,
      verifyAttestation,
      receiptPersistence: persistence.receiptPersistence,
    });

    expect(
      isGovernedSkillSynthesisModelEvaluatorProcessIsolated(evaluator),
    ).toBe(true);
    await expect(evaluator(request)).resolves.toMatchObject({
      accepted: true,
      receipt: {
        graderIsolation: "process",
        graderProvider: "volcengine",
        graderModel: "doubao-test",
        graderWorkerArtifactDigest: expect.stringMatching(
          /^sha256:[a-f0-9]{64}$/u,
        ),
        graderCredentialResolverArtifactDigest: expect.stringMatching(
          /^sha256:[a-f0-9]{64}$/u,
        ),
        graderInheritedEnvironment: false,
        graderCredentialDelivery: "single-use-broker-reference",
        graderCredentialTargetHost: "ark.cn-beijing.volces.com",
        graderCredentialMaxUses: 1,
        graderCredentialTtlMs: 6_000,
        graderHardDeadlineEnforced: true,
        graderSandboxProfile: "network-only",
        graderRequiredSandboxBoundaries: [
          "privilege-reduction",
          "process-tree",
          "resource-limits",
        ],
        graderPersistentProcessAuditRequired: true,
      },
    });
  });

  it("reloads the exact receipt and rejects a substituted ledger subject", async () => {
    const { evaluator, persistence } = evaluatorFixture();
    const result = await evaluator(request);
    await expect(
      persistence.adapter.load(result.receipt.receiptDigest),
    ).resolves.toMatchObject({
      receipt: { receiptDigest: result.receipt.receiptDigest },
      persistence: { durable: true, recovered: true },
    });
    expect(persistence.state.events).toHaveLength(1);
    expect(persistence.state.events[0].type).toBe(
      GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT,
    );
    persistence.state.events[0].subjectRef.digest = `sha256:${"0".repeat(64)}`;
    await expect(
      persistence.adapter.load(result.receipt.receiptDigest),
    ).rejects.toMatchObject({
      code: "CC_LEARNING_SYNTHESIS_EVALUATION_CORRUPT",
    });
  });

  it("does not persist candidate bytes that differ from the ledgered digest", async () => {
    const { evaluator } = evaluatorFixture();
    const evaluation = await evaluator(request);
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-synthesis-candidate-binding-"),
    );
    roots.push(root);
    const activeSkillsDir = path.join(root, "active");
    fs.mkdirSync(activeSkillsDir);
    const synthesizer = new SkillSynthesizer(
      { prepare: vi.fn(() => ({ all: vi.fn(() => []) })) },
      vi.fn(),
      {},
      {
        candidateOutputDir: path.join(root, "candidates"),
        activeSkillsDirs: [activeSkillsDir],
        evaluateCandidate: evaluator,
      },
    );

    await expect(
      synthesizer._persistSkill(
        request.skillName,
        `${request.content}\nSubstituted content.\n`,
        evaluation,
      ),
    ).rejects.toThrow("does not bind the persisted candidate");
    expect(fs.readdirSync(activeSkillsDir)).toEqual([]);
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
    const descriptor = {
      authorityId: "authority:model-grader",
      revision: 1,
      handlerArtifactDigest: `sha256:${"b".repeat(64)}`,
    };
    const persistence = createEvaluationPersistence(
      descriptor,
      async () => false,
    );
    const evaluator = createGovernedSkillSynthesisModelEvaluator({
      allowSameProcessGrader: true,
      allowSameProcessAttestor: true,
      descriptor,
      deterministicEvaluator: createGovernedSkillSynthesisCandidateEvaluator(),
      graderChat: createGovernedSkillSynthesisProviderChat({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "pilot-secret",
      }),
      minScore: 0.8,
      attestReceipt: async () => "invalid",
      verifyAttestation: async () => false,
      receiptPersistence: persistence.receiptPersistence,
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
      const descriptor = {
        authorityId: "authority:model-grader",
        revision: 1,
        handlerArtifactDigest: `sha256:${"c".repeat(64)}`,
      };
      const verifyAttestation = async ({ receiptDigest, attestation }) =>
        attestation === `attested:${receiptDigest}`;
      const persistence = createEvaluationPersistence(
        descriptor,
        verifyAttestation,
      );
      const evaluator = createGovernedSkillSynthesisModelEvaluator({
        allowSameProcessGrader: true,
        allowSameProcessAttestor: true,
        descriptor,
        deterministicEvaluator:
          createGovernedSkillSynthesisCandidateEvaluator(),
        graderChat,
        minScore: 0.8,
        attestReceipt: async ({ receiptDigest }) => `attested:${receiptDigest}`,
        verifyAttestation,
        receiptPersistence: persistence.receiptPersistence,
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
        schema: "chainlesschain.learning-synthesis-evaluation-document/v1",
        receipt: {
          authenticated: true,
          durable: false,
          modelScore: 0.92,
          accepted: true,
        },
        persistence: {
          authenticated: true,
          durable: true,
          persisted: true,
        },
      });
      expect(fs.existsSync(path.join(versionDir, "SKILL.md"))).toBe(true);
      expect(fs.readdirSync(activeSkillsDir)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
