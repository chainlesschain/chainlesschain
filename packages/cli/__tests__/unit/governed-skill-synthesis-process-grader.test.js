import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import executionBroker from "../../src/lib/process-execution-broker/index.js";
import {
  GOVERNED_SKILL_SYNTHESIS_PROCESS_GRADER_SCHEMA,
  createGovernedSkillSynthesisProcessGrader,
  getGovernedSkillSynthesisProcessGraderDescriptor,
  isGovernedSkillSynthesisProcessGrader,
} from "../../src/lib/evolution/governed-skill-synthesis-process-grader.js";

function childFixture(onInput) {
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
      queueMicrotask(() => onInput({ child, input }));
      callback();
    },
  });
  child.kill = vi.fn((signal) => {
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  });
  return child;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("governed Skill synthesis process grader", () => {
  it("uses fixed artifacts and delegates a single-use credential reference to the broker", async () => {
    let request;
    let launch;
    vi.spyOn(executionBroker, "spawn").mockImplementation(
      (command, args, options) => {
        launch = { command, args, options };
        return childFixture(({ child, input }) => {
          request = JSON.parse(input);
          child.stdout.end(
            `${JSON.stringify({
              ok: true,
              content:
                '{"candidate_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","score":0.9,"reasons":["clear-procedure"]}',
            })}\n`,
          );
          child.emit("close", 0, null);
        });
      },
    );
    const grader = createGovernedSkillSynthesisProcessGrader({
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "process-only-test-secret",
      maxTokens: 512,
      timeoutMs: 1_000,
      memoryLimitMb: 64,
    });

    await expect(
      grader([
        { role: "system", content: "Return only JSON." },
        { role: "user", content: "Grade this candidate.\n" },
      ]),
    ).resolves.toContain('"score":0.9');

    expect(isGovernedSkillSynthesisProcessGrader(grader)).toBe(true);
    expect(getGovernedSkillSynthesisProcessGraderDescriptor(grader)).toEqual({
      schema: GOVERNED_SKILL_SYNTHESIS_PROCESS_GRADER_SCHEMA,
      isolation: "process",
      provider: "volcengine",
      model: "doubao-test",
      workerArtifactDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      credentialResolverArtifactDigest: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u,
      ),
      inheritedEnvironment: false,
      credentialDelivery: "single-use-broker-reference",
      credentialTargetHost: "ark.cn-beijing.volces.com",
      credentialMaxUses: 1,
      credentialTtlMs: 6_000,
      hardDeadlineEnforced: true,
      sandboxProfile: "network-only",
      requiredSandboxBoundaries: [
        "privilege-reduction",
        "process-tree",
        "resource-limits",
      ],
      persistentProcessAuditRequired: true,
    });
    expect(launch.command).toBe(process.execPath);
    expect(launch.options).toMatchObject({
      requirePersistentAudit: true,
      credentialTargetHost: "ark.cn-beijing.volces.com",
      credentialTtlMs: 6_000,
      credentialMaxUses: 1,
      sandboxPolicy: {
        profile: "network-only",
        requiredBoundaries: [
          "privilege-reduction",
          "process-tree",
          "resource-limits",
        ],
      },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(launch.options.env.VOLCENGINE_API_KEY).toBe(
      "process-only-test-secret",
    );
    expect(launch.options.env.LLM_API_KEY).toBeUndefined();
    expect(launch.options.env.ARK_API_KEY).toBeUndefined();
    expect(launch.args.join(" ")).not.toContain("process-only-test-secret");
    expect(JSON.stringify(request)).not.toContain("process-only-test-secret");
    expect(request).not.toHaveProperty("apiKey");
    expect(request.schema).toBe(
      "chainlesschain.skill-synthesis-process-grader-request/v2",
    );
    expect(request.messages).toEqual([
      { role: "system", content: "Return only JSON." },
      { role: "user", content: "Grade this candidate.\n" },
    ]);
  });

  it("hard-terminates a grader that exceeds its deadline", async () => {
    vi.useFakeTimers();
    let child;
    vi.spyOn(executionBroker, "spawn").mockImplementation(() => {
      child = childFixture(() => {});
      return child;
    });
    const grader = createGovernedSkillSynthesisProcessGrader({
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "process-only-test-secret",
      timeoutMs: 1_000,
    });
    const pending = grader([{ role: "user", content: "Grade candidate" }]);
    const rejection = expect(pending).rejects.toMatchObject({
      code: "LEARNING_SYNTHESIS_PROCESS_GRADER_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(1_001);

    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects endpoint substitution and does not brand plain callables", () => {
    expect(() =>
      createGovernedSkillSynthesisProcessGrader({
        provider: "volcengine",
        model: "doubao-test",
        apiKey: "process-only-test-secret",
        baseUrl: "https://example.test/api/v3",
      }),
    ).toThrow("built-in endpoint");
    expect(isGovernedSkillSynthesisProcessGrader(async () => "{}")).toBe(false);
  });
});
