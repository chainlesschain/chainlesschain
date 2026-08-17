import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleWorkflowList,
  handleWorkflowGet,
  handleWorkflowSave,
  handleWorkflowRemove,
  handleWorkflowRun,
} from "../../src/gateways/ws/action-protocol.js";
import {
  COWORK_WORKFLOW_RUN_ADMISSION_INVALID_CODE,
  COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE,
  _deps as wfDeps,
  executeWorkflow,
  getWorkflowRecord,
} from "../../src/lib/cowork-workflow.js";
import {
  SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
  buildDynamicWorkflowRunAdmission,
} from "../../src/lib/dynamic-workflow-facade.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import { createWorkflowDefinitionAuthority } from "../../src/lib/workflow-definition-contract.js";

const { productionAuthorityFallback } = vi.hoisted(() => ({
  productionAuthorityFallback: vi.fn(),
}));
vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  getVerifiedSessionExecutionLocationAuthority: productionAuthorityFallback,
}));

const EXECUTION_AUTHORITY_SESSION_ID = "workflow-authority-session";

function executionBinding() {
  return createExecutionLocationBinding({
    location: "local",
    observed: true,
    observedAt: "2026-08-15T00:00:00.000Z",
    source: {
      cwd: "/proj",
      git: { root: "/proj", commit: "a".repeat(40) },
    },
    runtime: { platform: "linux", arch: "x64", tools: ["node"] },
    permissions: {
      status: "declared",
      file: "read",
      shell: false,
      network: false,
      mcp: false,
      externalSystems: false,
    },
    policy: {
      network: "offline",
      sandbox: "strong",
      dataBoundary: { kind: "repository", root: "/proj" },
    },
  });
}

function executionProof(sessionId = EXECUTION_AUTHORITY_SESSION_ID) {
  return Object.freeze({
    sessionId,
    headHash: "d".repeat(64),
    eventCount: 3,
    binding: executionBinding(),
  });
}

function strictExecutionAuthority(sessionId = EXECUTION_AUTHORITY_SESSION_ID) {
  return Object.freeze({
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: "verified-session-start",
    ...executionProof(sessionId),
  });
}

function governedWorkflow(workflow) {
  return {
    ...workflow,
    facade: {
      requirements: {
        capabilities: ["cowork-task", "dag", "parallel", "variables"],
        executionLocations: ["local"],
        permissions: {
          file: "read",
          shell: false,
          network: false,
          mcp: false,
          externalSystems: false,
        },
        sandbox: "strong",
        dataBoundary: "repository",
        credentials: [],
      },
      estimates: {
        tokensPerTask: 10,
        usdPerTask: 0.001,
        durationMsPerTask: 10,
      },
      budget: {
        maxExpandedTasks: 10,
        maxParallel: 2,
        maxTokens: 1000,
        maxUsd: 1,
        maxDurationMs: 1000,
      },
    },
  };
}

function workflowRunMessage(input = {}) {
  return {
    executionAuthoritySessionId: EXECUTION_AUTHORITY_SESSION_ID,
    maxParallel: 2,
    ...input,
  };
}

function makeServer() {
  const sent = [];
  return {
    projectRoot: "/proj",
    workflowRunTask: vi.fn((options) => wfDeps.runTask(options)),
    workflowExecutionAuthorityProvider: vi.fn(async (sessionId) =>
      executionProof(sessionId),
    ),
    _send: (_ws, msg) => sent.push(msg),
    _sent: sent,
  };
}

function installFakeFs() {
  const files = new Map();
  const dirs = new Set();
  const norm = (p) => p.replace(/\\/g, "/");
  wfDeps.existsSync = vi.fn((p) => {
    const n = norm(p);
    return files.has(n) || dirs.has(n);
  });
  wfDeps.readFileSync = vi.fn((p) => {
    const n = norm(p);
    if (!files.has(n)) throw new Error(`ENOENT: ${p}`);
    return files.get(n);
  });
  wfDeps.writeFileSync = vi.fn((p, content) => files.set(norm(p), content));
  wfDeps.mkdirSync = vi.fn((p) => dirs.add(norm(p)));
  wfDeps.appendFileSync = vi.fn(() => {});
  wfDeps.unlinkSync = vi.fn((p) => files.delete(norm(p)));
  // Simulate atomic temp+rename in the in-memory fs.
  wfDeps.renameSync = vi.fn((from, to) => {
    const nf = norm(from);
    if (!files.has(nf)) throw new Error(`ENOENT: ${from}`);
    files.set(norm(to), files.get(nf));
    files.delete(nf);
  });
  wfDeps.readdirSync = vi.fn((dir) => {
    const prefix = norm(dir).replace(/\/$/, "") + "/";
    return [...files.keys()]
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length))
      .filter((f) => !f.includes("/"));
  });
  wfDeps.now = () => new Date("2026-04-15T00:00:00Z").getTime();
  return files;
}

function buildAdmittedExecution(record, options = {}) {
  const maxParallel = options.maxParallel ?? 2;
  const pipeline = options.pipeline ?? false;
  const admission = buildDynamicWorkflowRunAdmission(
    {
      definitionAuthority: record,
      executionAuthoritySessionId: EXECUTION_AUTHORITY_SESSION_ID,
      maxParallel,
      execution: {
        cwd: "/proj",
        continueOnError: false,
        pipeline,
      },
    },
    {
      verifyAuthorities: () => ({
        definitionAuthority: record,
        executionLocationAuthority: strictExecutionAuthority(),
      }),
    },
  );
  if (!admission.allowed) {
    throw new Error(
      `test admission unexpectedly blocked: ${admission.preflight.blockers.join(",")}`,
    );
  }
  return {
    workflow: record.definition,
    definitionDigest: record.definitionDigest,
    maxParallel,
    cwd: "/proj",
    continueOnError: false,
    pipeline,
    llmOptions: { provider: null, model: null },
    runAdmission: admission.admission,
  };
}

describe("workflow WS handlers (N1)", () => {
  let server;
  let fakeFiles;
  beforeEach(() => {
    server = makeServer();
    fakeFiles = installFakeFs();
    productionAuthorityFallback.mockReset().mockReturnValue(null);
  });

  it("workflow-list returns [] when no workflows", async () => {
    await handleWorkflowList(server, "1", {});
    expect(server._sent).toEqual([
      { id: "1", type: "workflow:list", workflows: [] },
    ]);
  });

  it("workflow-save persists a valid workflow then list shows it", async () => {
    const workflow = {
      id: "wf1",
      name: "F",
      steps: [{ id: "s1", message: "hello" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "workflow:save",
      saved: true,
      workflowId: "wf1",
      definitionSchema: "cc-dynamic-workflow-definition/v1",
      definitionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    await handleWorkflowList(server, "2", {});
    const listMsg = server._sent[1];
    expect(listMsg.type).toBe("workflow:list");
    expect(listMsg.workflows.map((w) => w.id)).toContain("wf1");
  });

  it("workflow-save rejects cyclic dependsOn", async () => {
    const workflow = {
      id: "wf-cycle",
      name: "C",
      steps: [
        { id: "a", message: "a", dependsOn: ["b"] },
        { id: "b", message: "b", dependsOn: ["a"] },
      ],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "WORKFLOW_INVALID",
    });
  });

  it("workflow-save rejects missing workflow object", async () => {
    await handleWorkflowSave(server, "1", {}, {});
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "INVALID_WORKFLOW",
    });
  });

  it("workflow-save overwrites by id", async () => {
    const wf1 = { id: "wf1", name: "F", steps: [{ id: "s1", message: "v1" }] };
    const wf2 = { id: "wf1", name: "F", steps: [{ id: "s1", message: "v2" }] };
    await handleWorkflowSave(server, "1", {}, { workflow: wf1 });
    await handleWorkflowSave(server, "2", {}, { workflow: wf2 });
    await handleWorkflowGet(server, "3", {}, { id: "wf1" });
    const getMsg = server._sent.find((m) => m.type === "workflow:get");
    expect(getMsg.workflow.steps[0].message).toBe("v2");
  });

  it("workflow-get returns null for unknown id", async () => {
    await handleWorkflowGet(server, "1", {}, { id: "nope" });
    expect(server._sent[0]).toEqual({
      id: "1",
      type: "workflow:get",
      workflow: null,
      definitionAuthority: null,
    });
  });

  it("workflow-get errors when id missing", async () => {
    await handleWorkflowGet(server, "1", {}, {});
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "MISSING_ID",
    });
  });

  it("workflow-remove returns removed=true then false", async () => {
    const workflow = {
      id: "wf1",
      name: "F",
      steps: [{ id: "s1", message: "x" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRemove(server, "2", {}, { id: "wf1" });
    const first = server._sent.find((m) => m.type === "workflow:remove");
    expect(first.removed).toBe(true);
    await handleWorkflowRemove(server, "3", {}, { id: "wf1" });
    const second = server._sent.filter((m) => m.type === "workflow:remove")[1];
    expect(second.removed).toBe(false);
  });

  it("workflow-run emits started, step events, and done", async () => {
    wfDeps.runTask = vi.fn(async ({ userMessage }) => ({
      taskId: "t1",
      status: "completed",
      result: { summary: `ran ${userMessage}` },
    }));
    const workflow = governedWorkflow({
      id: "wf-run",
      name: "R",
      steps: [{ id: "s1", message: "hello" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: "wf-run" }),
    );

    const types = server._sent.map((m) => m.type);
    expect(types).toContain("workflow:started");
    expect(types).toContain("workflow:step-start");
    expect(types).toContain("workflow:step-complete");
    expect(types).toContain("workflow:done");
    const done = server._sent.find((m) => m.type === "workflow:done");
    expect(done.status).toBe("completed");
    const started = server._sent.find((m) => m.type === "workflow:started");
    expect(started.definitionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(done.definitionDigest).toBe(started.definitionDigest);
    for (const event of server._sent.filter((message) =>
      message.type.startsWith("workflow:"),
    )) {
      if (["workflow:save"].includes(event.type)) continue;
      expect(event).toMatchObject({
        definitionDigest: started.definitionDigest,
        admissionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        preflightDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        executionLocationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
    }
    const history = JSON.parse(wfDeps.appendFileSync.mock.calls[0][1]);
    expect(server.workflowExecutionAuthorityProvider).toHaveBeenCalledTimes(2);
    expect(history.runAdmission).toMatchObject({
      definitionDigest: started.definitionDigest,
      admissionDigest: started.admissionDigest,
      credentialValuesTransferred: false,
      executionLocation: {
        session: { sessionId: EXECUTION_AUTHORITY_SESSION_ID },
      },
      executionPolicy: {
        cwd: "/proj",
        continueOnError: false,
        pipeline: false,
        provider: null,
        model: null,
      },
    });
    expect(JSON.stringify(history.runAdmission)).not.toMatch(
      /token|password|secret/i,
    );
  });

  it("preserves a verified location-handoff authority in WS run admission", async () => {
    wfDeps.runTask = vi.fn(async ({ userMessage }) => ({
      taskId: "t-handoff",
      status: "completed",
      result: { summary: `ran ${userMessage}` },
    }));
    server.workflowExecutionAuthorityProvider = vi.fn(async (sessionId) => ({
      authority: "verified-session-location-handoff",
      ...executionProof(sessionId),
    }));
    const workflow = governedWorkflow({
      id: "wf-handoff",
      name: "Handoff",
      steps: [{ id: "s1", message: "hello" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });

    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: "wf-handoff" }),
    );

    expect(
      JSON.parse(wfDeps.appendFileSync.mock.calls[0][1]).runAdmission
        .executionLocation.authority,
    ).toBe("verified-session-location-handoff");
    expect(server.workflowExecutionAuthorityProvider).toHaveBeenCalledTimes(2);
  });

  it("runs from a ready server runner seam with fresh global workflow deps", async () => {
    const previousRunTask = wfDeps.runTask;
    const readyRunner = vi.fn(async ({ userMessage }) => ({
      taskId: "ready-runner-task",
      status: "completed",
      result: { summary: `ready:${userMessage}` },
    }));
    server.workflowRunTask = readyRunner;
    wfDeps.runTask = null;
    const workflow = governedWorkflow({
      id: "wf-ready-runner",
      name: "Ready runner",
      steps: [{ id: "s1", message: "fresh process" }],
    });

    try {
      await handleWorkflowSave(server, "1", {}, { workflow });
      await handleWorkflowRun(
        server,
        "2",
        {},
        workflowRunMessage({ id: workflow.id }),
      );

      expect(readyRunner).toHaveBeenCalledTimes(1);
      expect(wfDeps.runTask).toBeNull();
      expect(server._sent.at(-1)).toMatchObject({
        type: "workflow:done",
        status: "completed",
      });
    } finally {
      wfDeps.runTask = previousRunTask;
    }
  });

  it("blocks before started when an explicit server runner seam is not ready", async () => {
    server.workflowRunTask = null;
    const workflow = governedWorkflow({
      id: "wf-runner-unavailable",
      name: "Runner unavailable",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "WORKFLOW_RUN_ADMISSION_FAILED",
    });
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) => message.type === "workflow:started"),
    ).toBe(false);
  });

  it("emits a correlated workflow failure with the original post-start code", async () => {
    server.workflowRunTask = vi.fn(async () => null);
    const workflow = governedWorkflow({
      id: "wf-post-start-invalid-result",
      name: "Post-start invalid result",
      steps: [{ id: "s1", message: "invalid result" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    const started = server._sent.find(
      (message) => message.type === "workflow:started",
    );
    const failed = server._sent.at(-1);
    expect(started).toBeDefined();
    expect(failed).toMatchObject({
      id: "2",
      type: "workflow:failed",
      code: COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE,
      runId: started.runId,
      workflowId: workflow.id,
      executionStarted: true,
      definitionDigest: started.definitionDigest,
      admissionDigest: started.admissionDigest,
      preflightDigest: started.preflightDigest,
      executionLocationDigest: started.executionLocationDigest,
    });
    expect(
      server._sent.some((message) => message.type === "workflow:done"),
    ).toBe(false);
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
  });

  it.each(["null", "accessor"])(
    "fails closed for an explicit %s authority provider seam",
    async (kind) => {
      let getterReads = 0;
      if (kind === "null") {
        server.workflowExecutionAuthorityProvider = null;
      } else {
        delete server.workflowExecutionAuthorityProvider;
        Object.defineProperty(server, "workflowExecutionAuthorityProvider", {
          configurable: true,
          get() {
            getterReads += 1;
            return async (sessionId) => executionProof(sessionId);
          },
        });
      }
      const workflow = governedWorkflow({
        id: `wf-provider-${kind}`,
        name: "Provider seam",
        steps: [{ id: "s1", message: "never" }],
      });
      await handleWorkflowSave(server, "1", {}, { workflow });
      await handleWorkflowRun(
        server,
        "2",
        {},
        workflowRunMessage({ id: workflow.id }),
      );

      expect(server._sent.at(-1)).toMatchObject({
        type: "workflow:blocked",
        code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID",
      });
      expect(getterReads).toBe(0);
      expect(server.workflowRunTask).not.toHaveBeenCalled();
      expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
      expect(
        server._sent.some((message) => message.type === "workflow:started"),
      ).toBe(false);
    },
  );

  it("ignores an inherited authority provider and uses the production fallback", async () => {
    let inheritedGetterReads = 0;
    delete server.workflowExecutionAuthorityProvider;
    Object.setPrototypeOf(server, {
      get workflowExecutionAuthorityProvider() {
        inheritedGetterReads += 1;
        return async (sessionId) => executionProof(sessionId);
      },
    });
    const workflow = governedWorkflow({
      id: "wf-provider-production-fallback",
      name: "Provider production fallback",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      {
        id: workflow.id,
        executionAuthoritySessionId:
          "workflow-authority-session-that-does-not-exist",
        maxParallel: 2,
      },
    );

    expect(inheritedGetterReads).toBe(0);
    expect(productionAuthorityFallback).toHaveBeenCalledWith(
      "workflow-authority-session-that-does-not-exist",
    );
    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID",
    });
    expect(server.workflowRunTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) => message.type === "workflow:started"),
    ).toBe(false);
  });

  it("workflow-run replays an exact immutable definition digest", async () => {
    const messages = [];
    wfDeps.runTask = vi.fn(async ({ userMessage }) => {
      messages.push(userMessage);
      return {
        taskId: "t1",
        status: "completed",
        result: { summary: userMessage },
      };
    });
    const first = governedWorkflow({
      id: "wf-replay",
      name: "Replay",
      steps: [{ id: "s1", message: "v1" }],
    });
    const second = {
      ...first,
      steps: [{ id: "s1", message: "v2" }],
    };
    await handleWorkflowSave(server, "1", {}, { workflow: first });
    const firstDigest = server._sent[0].definitionDigest;
    await handleWorkflowSave(server, "2", {}, { workflow: second });
    await handleWorkflowRun(
      server,
      "3",
      {},
      workflowRunMessage({
        id: "wf-replay",
        definitionDigest: firstDigest,
      }),
    );

    expect(messages).toEqual(["v1"]);
    expect(
      server._sent.find((message) => message.type === "workflow:started")
        .definitionDigest,
    ).toBe(firstDigest);
    expect(
      server._sent.find((message) => message.type === "workflow:done")
        .definitionDigest,
    ).toBe(firstDigest);
  });

  it("workflow-run blocks before tasks, events, and history when authority is missing", async () => {
    wfDeps.runTask = vi.fn();
    const workflow = governedWorkflow({
      id: "wf-no-authority",
      name: "No authority",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(server, "2", {}, { id: workflow.id });

    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "WORKFLOW_EXECUTION_AUTHORITY_MISSING",
      workflowId: workflow.id,
      preflight: null,
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) =>
        [
          "workflow:started",
          "workflow:step-start",
          "workflow:step-complete",
          "workflow:done",
        ].includes(message.type),
      ),
    ).toBe(false);
  });

  it("workflow-run blocks an invalid maxParallel without falling back", async () => {
    wfDeps.runTask = vi.fn();
    const workflow = governedWorkflow({
      id: "wf-bad-parallel",
      name: "Bad parallel",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id, maxParallel: "not-a-number" }),
    );

    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "CC_DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED",
      definitionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      preflightDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      executionLocationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      preflight: {
        allowed: false,
        blockers: expect.arrayContaining(["requested-parallel-invalid"]),
      },
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) => message.type === "workflow:started"),
    ).toBe(false);
  });

  it("workflow-run rejects a session proof for a different requested session", async () => {
    wfDeps.runTask = vi.fn();
    server.workflowExecutionAuthorityProvider = vi.fn(async () =>
      executionProof("different-session"),
    );
    const workflow = governedWorkflow({
      id: "wf-session-drift",
      name: "Session drift",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID",
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
  });

  it("snapshots provider authority getters once before admission", async () => {
    wfDeps.runTask = vi.fn(async () => ({
      taskId: "snapshot-task",
      status: "completed",
      result: { summary: "snapshotted" },
    }));
    let eventCountReads = 0;
    const proof = { ...executionProof() };
    Object.defineProperty(proof, "eventCount", {
      enumerable: true,
      get() {
        eventCountReads += 1;
        return 3;
      },
    });
    server.workflowExecutionAuthorityProvider = vi.fn(async () => proof);
    const workflow = governedWorkflow({
      id: "wf-authority-snapshot",
      name: "Authority snapshot",
      steps: [{ id: "s1", message: "run" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    expect(eventCountReads).toBe(2);
    expect(wfDeps.runTask).toHaveBeenCalledTimes(1);
    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:done",
      status: "completed",
    });
  });

  it("blocks when the verified session proof drifts before admission is announced", async () => {
    wfDeps.runTask = vi.fn();
    let verification = 0;
    server.workflowExecutionAuthorityProvider = vi.fn(async (sessionId) => ({
      ...executionProof(sessionId),
      eventCount: ++verification,
    }));
    const workflow = governedWorkflow({
      id: "wf-session-proof-drift",
      name: "Session proof drift",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    expect(server.workflowExecutionAuthorityProvider).toHaveBeenCalledTimes(2);
    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID",
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) => message.type === "workflow:started"),
    ).toBe(false);
  });

  it("blocks when the immutable definition drifts before admission is announced", async () => {
    wfDeps.runTask = vi.fn();
    const workflow = governedWorkflow({
      id: "wf-definition-reverify-drift",
      name: "Definition reverify drift",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    server.workflowExecutionAuthorityProvider = vi.fn(async (sessionId) => {
      const versionPath = [...fakeFiles.keys()].find((candidate) =>
        candidate.includes(`/workflow-versions/${workflow.id}/`),
      );
      const tampered = JSON.parse(fakeFiles.get(versionPath));
      tampered.definition.steps[0].message = "tampered-after-first-read";
      fakeFiles.set(versionPath, JSON.stringify(tampered));
      return executionProof(sessionId);
    });

    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    expect(server.workflowExecutionAuthorityProvider).toHaveBeenCalledTimes(1);
    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID",
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) => message.type === "workflow:started"),
    ).toBe(false);
  });

  it("re-reads the definition after the second asynchronous authority lookup", async () => {
    wfDeps.runTask = vi.fn();
    const workflow = governedWorkflow({
      id: "wf-definition-await-drift",
      name: "Definition await drift",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    let authorityLookup = 0;
    server.workflowExecutionAuthorityProvider = vi.fn(async (sessionId) => {
      authorityLookup += 1;
      if (authorityLookup === 2) {
        const versionPath = [...fakeFiles.keys()].find((candidate) =>
          candidate.includes(`/workflow-versions/${workflow.id}/`),
        );
        const tampered = JSON.parse(fakeFiles.get(versionPath));
        tampered.definition.steps[0].message = "tampered-during-final-await";
        fakeFiles.set(versionPath, JSON.stringify(tampered));
      }
      await Promise.resolve();
      return executionProof(sessionId);
    });

    await handleWorkflowRun(
      server,
      "2",
      {},
      workflowRunMessage({ id: workflow.id }),
    );

    expect(server.workflowExecutionAuthorityProvider).toHaveBeenCalledTimes(2);
    expect(server._sent.at(-1)).toMatchObject({
      type: "workflow:blocked",
      code: "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID",
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) => message.type === "workflow:started"),
    ).toBe(false);
  });

  it("workflow-run rejects inline execution bindings", async () => {
    wfDeps.runTask = vi.fn();
    await handleWorkflowRun(
      server,
      "1",
      {},
      {
        id: "wf-inline-authority",
        executionAuthoritySessionId: EXECUTION_AUTHORITY_SESSION_ID,
        executionLocationBinding: executionBinding(),
      },
    );

    expect(server._sent).toEqual([
      expect.objectContaining({
        type: "workflow:blocked",
        code: "WORKFLOW_EXECUTION_AUTHORITY_INLINE_FORBIDDEN",
      }),
    ]);
    expect(server.workflowExecutionAuthorityProvider).not.toHaveBeenCalled();
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
  });

  it("blocks top-level and nested credential inputs before authority or execution", async () => {
    const secret = "must-never-cross-workflow-boundary";
    const forbiddenInputs = [
      { llmOptions: { provider: "remote", apiKey: secret } },
      { apiKey: secret },
      { execution: { llmOptions: { apiKey: secret } } },
      { credentials: [{ name: "provider", value: secret }] },
    ];

    for (const [index, forbidden] of forbiddenInputs.entries()) {
      await handleWorkflowRun(
        server,
        `secret-${index}`,
        {},
        {
          id: "wf-secret-input",
          executionAuthoritySessionId: EXECUTION_AUTHORITY_SESSION_ID,
          maxParallel: 2,
          ...forbidden,
        },
      );
    }

    expect(server._sent).toHaveLength(forbiddenInputs.length);
    for (const event of server._sent) {
      expect(event).toMatchObject({
        type: "workflow:blocked",
        code: "WORKFLOW_EXECUTION_SECRET_INPUT_FORBIDDEN",
        workflowId: "wf-secret-input",
      });
      expect(JSON.stringify(event)).not.toContain(secret);
    }
    expect(server.workflowExecutionAuthorityProvider).not.toHaveBeenCalled();
    expect(productionAuthorityFallback).not.toHaveBeenCalled();
    expect(server.workflowRunTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    expect(
      server._sent.some((message) =>
        [
          "workflow:started",
          "workflow:step-start",
          "workflow:step-complete",
          "workflow:done",
          "workflow:failed",
        ].includes(message.type),
      ),
    ).toBe(false);
  });

  it("low-level execution rejects admission definition drift before tasks and history", async () => {
    wfDeps.runTask = vi.fn();
    const workflow = governedWorkflow({
      id: "wf-definition-drift",
      name: "Definition drift",
      steps: [{ id: "s1", message: "original" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    const definitionRecord = getWorkflowRecord("/proj", workflow.id);
    const admission = buildDynamicWorkflowRunAdmission(
      {
        definitionAuthority: definitionRecord,
        executionAuthoritySessionId: EXECUTION_AUTHORITY_SESSION_ID,
        maxParallel: 2,
        execution: {
          cwd: "/proj",
          continueOnError: false,
          pipeline: false,
        },
      },
      {
        verifyAuthorities: () => ({
          definitionAuthority: definitionRecord,
          executionLocationAuthority: strictExecutionAuthority(),
        }),
      },
    );
    expect(admission.allowed).toBe(true);

    const driftedWorkflow = {
      ...workflow,
      steps: [{ id: "s1", message: "changed-after-admission" }],
    };
    const driftedAuthority = createWorkflowDefinitionAuthority(driftedWorkflow);
    await expect(
      executeWorkflow({
        workflow: driftedWorkflow,
        definitionDigest: driftedAuthority.definitionDigest,
        maxParallel: 2,
        cwd: "/proj",
        continueOnError: false,
        pipeline: false,
        llmOptions: { provider: null, model: null },
        runAdmission: admission.admission,
      }),
    ).rejects.toMatchObject({
      code: COWORK_WORKFLOW_RUN_ADMISSION_INVALID_CODE,
    });
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
  });

  it("rejects hidden or accessor llmOptions before admitted tasks receive them", async () => {
    wfDeps.runTask = vi.fn();
    const workflow = governedWorkflow({
      id: "wf-hidden-llm-options",
      name: "Hidden llm options",
      steps: [{ id: "s1", message: "never" }],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    const definitionRecord = getWorkflowRecord("/proj", workflow.id);
    const admission = buildDynamicWorkflowRunAdmission(
      {
        definitionAuthority: definitionRecord,
        executionAuthoritySessionId: EXECUTION_AUTHORITY_SESSION_ID,
        maxParallel: 2,
        execution: {
          cwd: "/proj",
          continueOnError: false,
          pipeline: false,
        },
      },
      {
        verifyAuthorities: () => ({
          definitionAuthority: definitionRecord,
          executionLocationAuthority: strictExecutionAuthority(),
        }),
      },
    );
    const hiddenSecret = { provider: null, model: null };
    Object.defineProperty(hiddenSecret, "apiKey", {
      value: "must-not-reach-runner",
      enumerable: false,
    });
    const accessor = { model: null };
    Object.defineProperty(accessor, "provider", {
      enumerable: true,
      get() {
        return null;
      },
    });

    for (const llmOptions of [hiddenSecret, accessor]) {
      let caught;
      try {
        await executeWorkflow({
          workflow,
          definitionDigest: definitionRecord.definitionDigest,
          maxParallel: 2,
          cwd: "/proj",
          continueOnError: false,
          pipeline: false,
          llmOptions,
          runAdmission: admission.admission,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: COWORK_WORKFLOW_RUN_ADMISSION_INVALID_CODE,
      });
      expect(JSON.stringify(caught)).not.toContain("must-not-reach-runner");
    }
    expect(wfDeps.runTask).not.toHaveBeenCalled();
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "isolates admitted completion callbacks from control flow (pipeline=%s)",
    async (pipeline) => {
      const workflow = governedWorkflow({
        id: `wf-callback-isolation-${pipeline}`,
        name: "Callback isolation",
        ...(pipeline ? { pipeline: true } : {}),
        steps: [
          { id: "a", message: "fail" },
          { id: "b", message: "must skip", dependsOn: ["a"] },
        ],
      });
      if (pipeline) {
        workflow.facade.requirements.capabilities.push("pipeline");
      }
      await handleWorkflowSave(server, "1", {}, { workflow });
      const definitionRecord = getWorkflowRecord("/proj", workflow.id);
      const callbackViews = [];
      const runTask = vi.fn(async () => ({
        taskId: "failed-task",
        status: "failed",
        result: { summary: "real failure" },
      }));

      const record = await executeWorkflow({
        ...buildAdmittedExecution(definitionRecord, { pipeline }),
        workflow,
        runTask,
        onStepComplete(view) {
          callbackViews.push(view);
          try {
            view.status = "completed";
            view.result.summary = "forged success";
          } catch {
            // A deep-frozen callback view is expected in module strict mode.
          }
        },
      });

      expect(runTask).toHaveBeenCalledTimes(1);
      expect(callbackViews).toHaveLength(1);
      expect(Object.isFrozen(callbackViews[0])).toBe(true);
      expect(Object.isFrozen(callbackViews[0].result)).toBe(true);
      expect(record).toMatchObject({
        status: "failed",
        steps: [
          { id: "a", status: "failed", result: { summary: "real failure" } },
          { id: "b", status: "skipped" },
        ],
      });
      expect(JSON.parse(wfDeps.appendFileSync.mock.calls[0][1])).toMatchObject({
        status: "failed",
        steps: [
          { id: "a", status: "failed" },
          { id: "b", status: "skipped" },
        ],
      });
    },
  );

  it("executes only the immutable admitted definition after callback mutation", async () => {
    const workflow = governedWorkflow({
      id: "wf-runtime-definition-snapshot",
      name: "Runtime definition snapshot",
      steps: [
        {
          id: "s1",
          templateId: "original-template",
          message: "original-message",
        },
      ],
    });
    await handleWorkflowSave(server, "1", {}, { workflow });
    const definitionRecord = getWorkflowRecord("/proj", workflow.id);
    const observed = [];

    const record = await executeWorkflow({
      ...buildAdmittedExecution(definitionRecord),
      workflow,
      runTask: vi.fn(async ({ templateId, userMessage }) => {
        observed.push({ templateId, userMessage });
        return {
          taskId: "snapshot-task",
          status: "completed",
          result: { summary: userMessage },
        };
      }),
      onStepStart() {
        workflow.steps[0].templateId = "tampered-template";
        workflow.steps[0].message = "tampered-message";
      },
    });

    expect(workflow.steps[0]).toMatchObject({
      templateId: "tampered-template",
      message: "tampered-message",
    });
    expect(observed).toEqual([
      {
        templateId: "original-template",
        userMessage: "original-message",
      },
    ]);
    expect(record.status).toBe("completed");
    expect(record.definitionDigest).toBe(definitionRecord.definitionDigest);
  });

  it.each([
    ["null", () => null],
    [
      "cyclic",
      () => {
        const result = { summary: "cycle" };
        result.self = result;
        return { taskId: "cycle", status: "completed", result };
      },
    ],
    [
      "oversized",
      () => ({
        taskId: "oversized",
        status: "completed",
        result: { summary: "x".repeat(1024 * 1024 + 1) },
      }),
    ],
  ])(
    "rejects an admitted %s task result before workflow history",
    async (_label, makeResult) => {
      const workflow = governedWorkflow({
        id: "wf-invalid-task-result",
        name: "Invalid task result",
        steps: [{ id: "s1", message: "run" }],
      });
      await handleWorkflowSave(server, "1", {}, { workflow });
      const definitionRecord = getWorkflowRecord("/proj", workflow.id);

      await expect(
        executeWorkflow({
          ...buildAdmittedExecution(definitionRecord),
          runTask: vi.fn(async () => makeResult()),
        }),
      ).rejects.toMatchObject({
        code: COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE,
      });
      expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
    },
  );

  it("aborts a timed-out admitted task and waits for physical settle before retry or history", async () => {
    const workflow = governedWorkflow({
      id: "wf-admitted-timeout-settle",
      name: "Admitted timeout settle",
      steps: [
        {
          id: "fan",
          message: "fan-${item}",
          forEach: ["a", "b"],
          retries: 1,
          timeoutMs: 10,
        },
      ],
    });
    workflow.facade.requirements.capabilities.push(
      "for-each",
      "retry",
      "timeout",
    );
    await handleWorkflowSave(server, "1", {}, { workflow });
    const definitionRecord = getWorkflowRecord("/proj", workflow.id);
    const originalSetTimeout = wfDeps.setTimeout;
    const originalClearTimeout = wfDeps.clearTimeout;
    let timerCount = 0;
    let active = 0;
    let maxActive = 0;
    let abortObserved = false;
    let settleFirst;
    wfDeps.setTimeout = (callback) => {
      timerCount += 1;
      if (timerCount === 1) queueMicrotask(callback);
      return timerCount;
    };
    wfDeps.clearTimeout = vi.fn();
    const runTask = vi.fn(({ signal, userMessage }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (runTask.mock.calls.length === 1) {
        signal.addEventListener(
          "abort",
          () => {
            abortObserved = true;
          },
          { once: true },
        );
        return new Promise((_resolve, reject) => {
          settleFirst = () => {
            active -= 1;
            reject(new Error("physical task settled after abort"));
          };
        });
      }
      active -= 1;
      return Promise.resolve({
        taskId: `task-${runTask.mock.calls.length}`,
        status: "completed",
        result: { summary: userMessage },
      });
    });

    try {
      let executionSettled = false;
      const execution = executeWorkflow({
        ...buildAdmittedExecution(definitionRecord, { maxParallel: 1 }),
        runTask,
      }).finally(() => {
        executionSettled = true;
      });
      for (let index = 0; index < 12; index++) await Promise.resolve();

      expect(abortObserved).toBe(true);
      expect(settleFirst).toBeTypeOf("function");
      expect(runTask).toHaveBeenCalledTimes(1);
      expect(active).toBe(1);
      expect(maxActive).toBe(1);
      expect(executionSettled).toBe(false);
      expect(wfDeps.appendFileSync).not.toHaveBeenCalled();

      settleFirst();
      const record = await execution;

      expect(record.status).toBe("completed");
      expect(runTask).toHaveBeenCalledTimes(3);
      expect(active).toBe(0);
      expect(maxActive).toBe(1);
      expect(wfDeps.appendFileSync).toHaveBeenCalledTimes(1);
    } finally {
      wfDeps.setTimeout = originalSetTimeout;
      wfDeps.clearTimeout = originalClearTimeout;
    }
  });

  it("releases an acquired permit when an admitted start-view snapshot fails", async () => {
    const workflow = governedWorkflow({
      id: "wf-start-view-permit-release",
      name: "Start view permit release",
      steps: [
        { id: "source", message: "produce-large-result" },
        {
          id: "fan",
          dependsOn: ["source"],
          forEach: ["a", "b"],
          message: "${step.source.summary}${step.source.summary}-${item}",
        },
      ],
    });
    workflow.facade.requirements.capabilities.push("for-each");
    await handleWorkflowSave(server, "1", {}, { workflow });
    const definitionRecord = getWorkflowRecord("/proj", workflow.id);
    let active = 0;
    const runTask = vi.fn(async ({ userMessage }) => {
      active += 1;
      try {
        return {
          taskId: "large-source",
          status: "completed",
          result: {
            summary:
              userMessage === "produce-large-result"
                ? "x".repeat(600_000)
                : userMessage,
          },
        };
      } finally {
        active -= 1;
      }
    });
    const execution = executeWorkflow({
      ...buildAdmittedExecution(definitionRecord, { maxParallel: 1 }),
      runTask,
      onStepStart() {},
    });
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve("hung"), 1000);
    });

    const settled = await Promise.race([
      execution.then(
        () => "resolved",
        (error) => error,
      ),
      timeout,
    ]);
    clearTimeout(timeoutId);

    expect(settled).toMatchObject({
      code: COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE,
    });
    expect(settled).not.toBe("hung");
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(active).toBe(0);
    expect(wfDeps.appendFileSync).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "enforces one global maxParallel semaphore for concrete tasks (pipeline=%s)",
    async (pipeline) => {
      let active = 0;
      let maxActive = 0;
      const attempts = new Map();
      wfDeps.runTask = vi.fn(async ({ userMessage }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => setImmediate(resolve));
          const attempt = (attempts.get(userMessage) || 0) + 1;
          attempts.set(userMessage, attempt);
          const shouldRetry = userMessage.startsWith("fan-") && attempt === 1;
          return {
            taskId: `${userMessage}-${attempt}`,
            status: shouldRetry ? "failed" : "completed",
            result: { summary: userMessage },
          };
        } finally {
          active -= 1;
        }
      });
      const workflow = {
        id: `wf-global-limit-${pipeline}`,
        name: "Global task limit",
        steps: [
          {
            id: "fan",
            message: "fan-${item}",
            forEach: ["a", "b", "c"],
            retries: 1,
          },
          {
            id: "loop",
            message: "loop-${iter}",
            loopWhile: "${iter} < 2",
            maxIterations: 2,
          },
          { id: "plain", message: "plain" },
        ],
      };

      const record = await executeWorkflow({
        workflow,
        cwd: "/proj",
        maxParallel: 2,
        pipeline,
      });

      expect(record.status).toBe("completed");
      expect(maxActive).toBe(2);
      expect(wfDeps.runTask).toHaveBeenCalledTimes(9);
      expect(attempts.get("fan-a")).toBe(2);
      expect(attempts.get("fan-b")).toBe(2);
      expect(attempts.get("fan-c")).toBe(2);
      expect(attempts.get("loop-1")).toBe(1);
      expect(attempts.get("loop-2")).toBe(1);
      expect(attempts.get("plain")).toBe(1);
    },
  );

  it("holds a timed-out task permit until late settle before retrying or fanning out", async () => {
    let active = 0;
    let maxActive = 0;
    let lateSettle;
    let timeoutCount = 0;
    const originalSetTimeout = wfDeps.setTimeout;
    const originalClearTimeout = wfDeps.clearTimeout;
    wfDeps.setTimeout = (fn) => {
      timeoutCount += 1;
      if (timeoutCount === 1) queueMicrotask(fn);
      return timeoutCount;
    };
    wfDeps.clearTimeout = vi.fn();
    wfDeps.runTask = vi.fn(({ userMessage }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (wfDeps.runTask.mock.calls.length === 1) {
        return new Promise((resolve) => {
          lateSettle = () => {
            active -= 1;
            resolve({
              taskId: "late",
              status: "completed",
              result: { summary: userMessage },
            });
          };
        });
      }
      active -= 1;
      return Promise.resolve({
        taskId: `task-${wfDeps.runTask.mock.calls.length}`,
        status: "completed",
        result: { summary: userMessage },
      });
    });
    const workflow = {
      id: "wf-timeout-global-limit",
      name: "Timeout global limit",
      steps: [
        {
          id: "fan",
          message: "fan-${item}",
          forEach: ["a", "b"],
          retries: 1,
          timeoutMs: 10,
        },
      ],
    };

    try {
      const execution = executeWorkflow({
        workflow,
        cwd: "/proj",
        maxParallel: 1,
      });
      for (let index = 0; index < 8; index++) await Promise.resolve();

      expect(lateSettle).toBeTypeOf("function");
      expect(wfDeps.runTask).toHaveBeenCalledTimes(1);
      expect(active).toBe(1);
      expect(maxActive).toBe(1);

      lateSettle();
      const record = await execution;

      expect(record.status).toBe("completed");
      expect(wfDeps.runTask).toHaveBeenCalledTimes(3);
      expect(active).toBe(0);
      expect(maxActive).toBe(1);
    } finally {
      wfDeps.setTimeout = originalSetTimeout;
      wfDeps.clearTimeout = originalClearTimeout;
    }
  });

  it("workflow-run errors when workflow not found", async () => {
    await handleWorkflowRun(
      server,
      "1",
      {},
      workflowRunMessage({ id: "ghost" }),
    );
    expect(server._sent[0]).toMatchObject({
      id: "1",
      type: "error",
      code: "WORKFLOW_NOT_FOUND",
    });
  });
});
