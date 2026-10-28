import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { computeEventHash } from "../../src/harness/transcript-integrity.js";
import { GOAL_VERIFICATION_SCHEMA } from "../../src/lib/goal-verification-plan.js";
import { goalVerificationError } from "../../src/lib/goal-verification-command.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
function fixture({
  author = () => {},
  failCheckpoint = false,
  seed = [],
} = {}) {
  const root = fs.mkdtempSync(path.join(parent, "cc-headless-verify-"));
  roots.push(root);
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  const program = path.join(root, "check.cjs"),
    manifest = path.join(root, "acceptance.json");
  fs.writeFileSync(
    program,
    "require('node:assert/strict').equal(require('node:fs').readFileSync('result.txt','utf8'), 'correct');\n" +
      "console.log('CC_GOAL_CHECK_RESULT ' + JSON.stringify({schema:'chainlesschain.goal-check-result/v1',checkId:process.env.CC_GOAL_CHECK_ID,invocationId:process.env.CC_GOAL_CHECK_INVOCATION,requirements:[{id:'artifact-content',passed:true}]}));",
  );
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      schema: GOAL_VERIFICATION_SCHEMA,
      artifacts: ["result.txt"],
      checks: [
        {
          id: "artifact-quality",
          executable: "node",
          args: [program],
          checkerFiles: ["check.cjs"],
          requirements: ["artifact-content"],
        },
      ],
    }),
  );
  const log = [...seed],
    output = [];
  const append = (type, data) => {
    if (
      failCheckpoint &&
      type === "goal_snapshot" &&
      data.evaluation?.evidence?.pendingCheckId
    )
      throw Error("disk full before checker dispatch");
    log.push({ type, timestamp: log.length + 1, data: structuredClone(data) });
  };
  const chain = () => {
    let previousHash = null;
    return log.map((event) => {
      const hash = computeEventHash(previousHash, event);
      const next = { ...event, prevHash: previousHash, hash };
      previousHash = hash;
      return next;
    });
  };
  let calls = 0;
  const agentLoop = vi.fn(async function* (_messages, options) {
    options.iterationBudget.consume();
    author({ cwd, program, manifest, turn: ++calls });
    yield {
      type: "response-complete",
      content: "All work is complete and all tests passed.",
    };
    yield { type: "run-ended", reason: "complete" };
  });
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: (value) => output.push(value),
    writeErr: () => {},
    agentLoop,
    getLastSessionId: () => null,
    sessionExists: () => log.length > 0,
    rebuildMessages: () => [],
    startSession: () => {
      if (!log.length) append("session_start", { title: "independent goal" });
    },
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendEvent: (_id, type, data) => append(type, data),
    readEvents: () => log,
    readVerifiedEvents: chain,
    appendAuthorityEvent: (_id, type, data) => {
      append(type, data);
      return true;
    },
  };
  const run = (options = {}) =>
    runAgentHeadless(
      {
        prompt: "Produce the correct deliverable",
        cwd,
        provider: "ollama",
        model: "test-only",
        evolutionIngress: null,
        hermeticExecution: true,
        expandFileRefs: false,
        outputFormat: "stream-json",
        sessionId: "independent-goal-test",
        persistSession: true,
        goalCondition: `verify:${manifest}`,
        maxOuterTurns: 2,
        ...options,
      },
      deps,
    );
  return {
    cwd,
    manifest,
    program,
    log,
    deps,
    agentLoop,
    run,
    events: () => output.join("").trim().split("\n").map(JSON.parse),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-headless-verify-")
    )
      throw Error("unsafe test cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("headless independent Goal checks", () => {
  it("re-drives a false author success and completes only after real acceptance passes", async () => {
    const f = fixture({
      author: ({ cwd, turn }) =>
        fs.writeFileSync(
          path.join(cwd, "result.txt"),
          turn === 1 ? "wrong" : "correct",
        ),
    });
    expect(await f.run()).toMatchObject({ isError: false });
    expect(f.agentLoop).toHaveBeenCalledTimes(2);
    expect(
      f.agentLoop.mock.calls[1][0].some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Independent checker output") &&
          message.content.includes("Expected values to be strictly equal"),
      ),
    ).toBe(true);
    expect(
      f
        .events()
        .filter((event) => event.type === "goal_evaluated")
        .map((event) => event.met),
    ).toEqual([false, true]);
    expect(
      f.events().filter((event) => event.type === "goal_completed"),
    ).toHaveLength(1);
    const snapshots = f.log.filter((event) => event.type === "goal_snapshot");
    expect(snapshots[0].data.condition.verification.digest).toMatch(/^sha256:/);
    expect(
      snapshots.some(
        (event) =>
          event.data.evaluation?.evidence?.pendingCheckId ===
          "artifact-quality",
      ),
    ).toBe(true);
    expect(snapshots.at(-1).data).toMatchObject({
      state: { done: true },
      evaluation: {
        met: true,
        evidence: { coverage: { required: 1, executed: 1, passed: 1 } },
      },
    });
  });
  it("cannot complete when the author produces no artifact", async () => {
    const f = fixture();
    expect(await f.run({ maxOuterTurns: 1 })).toMatchObject({ isError: true });
    expect(f.events().some((event) => event.type === "goal_completed")).toBe(
      false,
    );
    expect(
      f.events().find((event) => event.type === "goal_evaluated").met,
    ).toBe(false);
  });
  it("does not silently ignore a malformed requested goal", async () => {
    const f = fixture();
    expect(await f.run({ goalCondition: "verify:" })).toMatchObject({
      isError: true,
      code: "CC_GOAL_VERIFICATION_FAILED",
    });
    expect(f.agentLoop).not.toHaveBeenCalled();
  });
  it("rejects an invalid manifest before the first author call", async () => {
    const f = fixture();
    fs.writeFileSync(f.manifest, '{"schema":"unknown"}');
    expect(await f.run()).toMatchObject({ isError: true });
    expect(f.agentLoop).not.toHaveBeenCalled();
  });
  it("stops when the author edits a frozen checker", async () => {
    const f = fixture({
      author: ({ cwd, program }) => {
        fs.writeFileSync(path.join(cwd, "result.txt"), "wrong");
        fs.writeFileSync(program, "process.exit(0)");
      },
    });
    expect(await f.run()).toMatchObject({ isError: true });
    expect(f.agentLoop).toHaveBeenCalledTimes(1);
    expect(f.events().some((event) => event.type === "goal_completed")).toBe(
      false,
    );
  });
  it("does not dispatch a checker when its intent checkpoint cannot be saved", async () => {
    const f = fixture({
      failCheckpoint: true,
      author: ({ cwd }) =>
        fs.writeFileSync(path.join(cwd, "result.txt"), "correct"),
    });
    const runCommand = vi.fn();
    f.deps.goalCheck = { runCommand };
    expect(await f.run()).toMatchObject({
      isError: true,
      code: "CC_GOAL_CHECKPOINT_FAILED",
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(f.agentLoop).toHaveBeenCalledTimes(1);
  });
  it("surfaces uncertain process ownership and stops automatic re-drive", async () => {
    const f = fixture({
      author: ({ cwd }) =>
        fs.writeFileSync(path.join(cwd, "result.txt"), "correct"),
    });
    f.deps.goalCheck = {
      runCommand: vi.fn(async () => {
        const error = goalVerificationError("cleanup is unconfirmed");
        error.verification = {
          checkId: "artifact-quality",
          status: "cleanup-unconfirmed",
          manualReviewRequired: true,
          cleanup: { confirmed: false },
        };
        throw error;
      }),
    };
    expect(await f.run()).toMatchObject({
      isError: true,
      verification: {
        status: "cleanup-unconfirmed",
        manualReviewRequired: true,
      },
    });
    expect(f.agentLoop).toHaveBeenCalledTimes(1);
    expect(f.events().some((event) => event.type === "goal_completed")).toBe(
      false,
    );
    expect(
      f.log.filter((event) => event.type === "goal_snapshot").at(-1).data
        .checkpoint.phase,
    ).toBe("running");
  });
});
