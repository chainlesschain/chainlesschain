import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
  DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE,
  DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE,
  DYNAMIC_WORKFLOW_DEFINITION_SCHEMA,
  DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED_CODE,
  DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA,
  DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA,
  SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
  buildDynamicWorkflowPreflight,
  buildDynamicWorkflowRunAdmission,
  createDynamicWorkflowManifest,
  executeDynamicWorkflowWithAdmission,
} from "../../src/lib/dynamic-workflow-facade.js";
import { COWORK_WORKFLOW_RUN_RECORD_SCHEMA } from "../../src/lib/cowork-workflow.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import {
  createCoworkWorkflowRecord,
  verifyCoworkWorkflowRecord,
} from "../../src/lib/workflow-definition-contract.js";

const WORKFLOW = JSON.parse(
  readFileSync(
    new URL("../fixtures/dynamic-workflow-facade-valid.json", import.meta.url),
    "utf8",
  ),
);

function executionLocation(overrides = {}) {
  return createExecutionLocationBinding({
    location: "local",
    observed: true,
    observedAt: "2026-08-15T00:00:00.000Z",
    source: {
      cwd: "/repo",
      git: { root: "/repo", commit: "a".repeat(40) },
    },
    model: {
      provider: "fixture",
      name: "fixture-model",
      credentialSource: "env",
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
      dataBoundary: { kind: "repository", root: "/repo" },
    },
    ...overrides,
  });
}

function definitionAuthority(workflow = WORKFLOW) {
  return verifyCoworkWorkflowRecord(createCoworkWorkflowRecord(workflow));
}

function executionLocationAuthority(overrides = {}) {
  return {
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: "verified-session-start",
    sessionId: "session-run-1",
    headHash: "d".repeat(64),
    eventCount: 7,
    binding: executionLocation(),
    ...overrides,
  };
}

function verifiedAuthorities(overrides = {}) {
  return {
    definitionAuthority: definitionAuthority(),
    executionLocationAuthority: executionLocationAuthority(),
    ...overrides,
  };
}

function authorityVerifier(overrides = {}) {
  return vi.fn(() => verifiedAuthorities(overrides));
}

function runInput(overrides = {}) {
  return {
    definitionAuthority: definitionAuthority(),
    executionAuthoritySessionId: "session-run-1",
    maxParallel: 2,
    ...overrides,
  };
}

function completedOutcome(id, result = { summary: `completed:${id}` }) {
  return {
    id,
    status: "completed",
    taskId: `task-${id}`,
    result,
  };
}

function successfulRunRecord(options, overrides = {}) {
  return {
    schema: COWORK_WORKFLOW_RUN_RECORD_SCHEMA,
    workflowId: options.workflow.id,
    workflowName: options.workflow.name,
    definitionSchema: options.runAdmission.definition.schema,
    definitionDigest: options.definitionDigest,
    runAdmission: options.runAdmission,
    status: "completed",
    steps: options.workflow.steps.map((step) => completedOutcome(step.id)),
    startedAt: "2026-08-15T00:00:00.000Z",
    finishedAt: "2026-08-15T00:00:01.000Z",
    ...overrides,
  };
}

describe("dynamic workflow manifest", () => {
  it("produces a deterministic versioned digest, DAG plan, and honest runtime claims", () => {
    const manifest = createDynamicWorkflowManifest(WORKFLOW);
    const reordered = {
      facade: WORKFLOW.facade,
      steps: WORKFLOW.steps,
      name: WORKFLOW.name,
      id: WORKFLOW.id,
    };

    expect(manifest.schema).toBe(DYNAMIC_WORKFLOW_DEFINITION_SCHEMA);
    expect(manifest.definitionDigest).toBe(
      createDynamicWorkflowManifest(reordered).definitionDigest,
    );
    expect(manifest.plan.batches.map((batch) => batch.steps)).toEqual([
      ["collect", "scan"],
      ["review"],
    ]);
    expect(manifest.plan.worstCaseTaskCalls).toBe(4);
    expect(manifest.usedCapabilities).toEqual([
      "cowork-task",
      "dag",
      "parallel",
      "retry",
      "variables",
    ]);
    expect(manifest.runtimeClaims).toEqual({
      durablePauseResume: false,
      exactlyOnceAfterResume: false,
      historyDurability: "best-effort",
      needsInputBetweenStages: false,
    });
    expect(Object.isFrozen(manifest.definition.steps)).toBe(true);
  });

  it("rejects credential values before the raw definition can be projected", () => {
    const unsafe = structuredClone(WORKFLOW);
    unsafe.facade.requirements.credentials = [
      { name: "GH_TOKEN", source: "env", scope: "repo", api_key: "secret" },
    ];

    expect(() => createDynamicWorkflowManifest(unsafe)).toThrow(
      /credential requirements must not contain values/,
    );
  });
});

describe("dynamic workflow preflight", () => {
  it("rejects an undeclared parallel capability derived from the DAG", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.capabilities =
      workflow.facade.requirements.capabilities.filter(
        (capability) => capability !== "parallel",
      );

    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain("undeclared-capability:parallel");
  });

  it("allows a fully declared workflow within capability, scale, and cost budgets", () => {
    const preflight = buildDynamicWorkflowPreflight({
      workflow: WORKFLOW,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(preflight.schema).toBe(DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA);
    expect(preflight.allowed).toBe(true);
    expect(preflight.blockers).toEqual([]);
    expect(preflight.scale).toMatchObject({
      expansionKnown: true,
      worstCaseTaskCalls: 4,
      requestedParallel: 2,
    });
    expect(preflight.cost).toMatchObject({
      projectedTokens: 400,
      projectedUsd: 0.04,
      projectedDurationMs: 3000,
      projectedDurationSlots: 3,
    });
    expect(preflight.permissions.credentialValuesTransferred).toBe(false);
  });

  it("binds preflight to versioned persistence and blocks legacy authority", () => {
    const versioned = verifyCoworkWorkflowRecord(
      createCoworkWorkflowRecord(WORKFLOW),
    );
    const legacy = verifyCoworkWorkflowRecord(WORKFLOW, {
      allowLegacy: true,
    });
    const allowed = buildDynamicWorkflowPreflight({
      workflow: WORKFLOW,
      definitionAuthority: versioned,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });
    const blocked = buildDynamicWorkflowPreflight({
      workflow: WORKFLOW,
      definitionAuthority: legacy,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.definition.authority.status).toBe("versioned");
    expect(blocked.blockers).toContain("definition-authority-unversioned");
  });

  it("blocks parallel and token budget overruns", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.budget.maxTokens = 300;
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 3,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain("parallel-budget-exceeded");
    expect(preflight.blockers).toContain("token-budget-exceeded");
  });

  it("does not treat a network grant as an override for an offline policy", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.permissions.network = true;
    const binding = executionLocation({
      permissions: {
        status: "declared",
        file: "read",
        shell: false,
        network: true,
        mcp: false,
        externalSystems: false,
      },
    });
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: binding,
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain(
      "environment-network-policy-insufficient",
    );
  });

  it("requires credential references to match observed environment sources", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.credentials = [
      { name: "GH_TOKEN", source: "env", scope: "repo" },
    ];
    const missing = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });
    const available = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation({
        credentials: [{ name: "GH_TOKEN", source: "env", scope: "repo" }],
      }),
      maxParallel: 2,
    });

    expect(missing.allowed).toBe(false);
    expect(missing.blockers).toContain(
      "environment-credential-missing:GH_TOKEN",
    );
    expect(available.allowed).toBe(true);
  });

  it("enforces the engine task-call ceiling and rejects invalid parallel input", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.budget.maxExpandedTasks = 1000;
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: "many",
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain(
      "expanded-task-budget-exceeds-engine-limit",
    );
    expect(preflight.blockers).toContain("requested-parallel-invalid");
    expect(preflight.scale.hardTaskLimit).toBe(64);
  });

  it("blocks runtime-sized fan-out instead of guessing a cost", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.steps[0].forEach = "${step.source.items}";
    workflow.facade.requirements.capabilities.push("for-each");
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain("runtime-expansion-unknown");
    expect(preflight.blockers).toContain("token-budget-unevaluable");
    expect(preflight.cost.projectedTokens).toBeNull();
  });

  it("blocks unknown capabilities, unobserved environment authority, and digest drift", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.capabilities.push("teleport");
    const manifest = {
      ...createDynamicWorkflowManifest(workflow),
      definitionDigest: `sha256:${"f".repeat(64)}`,
    };
    const binding = executionLocation({
      permissions: { status: "not-observed", file: "read" },
      policy: {
        network: "unknown",
        sandbox: "unknown",
        dataBoundary: { kind: "unknown" },
      },
    });
    const preflight = buildDynamicWorkflowPreflight({
      manifest,
      executionLocation: binding,
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toEqual(
      expect.arrayContaining([
        "definition-digest-mismatch",
        "unsupported-capability:teleport",
        "environment-permissions-not-observed",
        "environment-sandbox-unknown",
        "environment-data-boundary-unknown",
      ]),
    );
  });
});

describe("dynamic workflow run admission", () => {
  it("executes only after two exact authority reads and binds execution policy", async () => {
    const events = [];
    const onStepStart = vi.fn();
    const onStepComplete = vi.fn();
    const verifyAuthorities = vi.fn(() => {
      events.push("verify");
      return verifiedAuthorities();
    });
    const executor = vi.fn(async (options) => {
      events.push("execute");
      return successfulRunRecord(options);
    });
    const input = runInput({
      maxParallel: "2",
      execution: {
        cwd: "/repo",
        continueOnError: true,
        pipeline: false,
        provider: "fixture",
        model: "fixture-model",
        onStepStart,
        onStepComplete,
      },
      onAdmitted(admission) {
        events.push(`admit:${admission.admissionDigest}`);
      },
    });

    const first = buildDynamicWorkflowRunAdmission(input, {
      verifyAuthorities: authorityVerifier(),
    });
    const second = buildDynamicWorkflowRunAdmission(input, {
      verifyAuthorities: authorityVerifier(),
    });
    const result = await executeDynamicWorkflowWithAdmission(input, {
      executeWorkflow: executor,
      verifyAuthorities,
    });

    expect(first).toEqual(second);
    expect(result).toMatchObject({
      allowed: true,
      authorityVerified: true,
      executionStarted: true,
      error: null,
      definitionDigest: definitionAuthority().definitionDigest,
      admissionDigest: result.admission.admissionDigest,
      admission: {
        schema: DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA,
        maxParallel: 2,
        credentialValuesTransferred: false,
        executionPolicy: {
          cwd: "/repo",
          continueOnError: true,
          pipeline: false,
          provider: "fixture",
          model: "fixture-model",
        },
      },
      record: { status: "completed" },
    });
    for (const digest of [
      result.executionLocationDigest,
      result.preflightDigest,
      result.admission.admissionDigest,
    ]) {
      expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
    expect(events).toEqual([
      "verify",
      "verify",
      `admit:${result.admission.admissionDigest}`,
      "execute",
    ]);
    expect(verifyAuthorities).toHaveBeenCalledTimes(2);
    expect(verifyAuthorities).toHaveBeenNthCalledWith(1, {
      workflowId: WORKFLOW.id,
      definitionDigest: definitionAuthority().definitionDigest,
      executionAuthoritySessionId: "session-run-1",
    });
    expect(executor.mock.calls[0][0]).toMatchObject({
      cwd: "/repo",
      continueOnError: true,
      pipeline: false,
      llmOptions: { provider: "fixture", model: "fixture-model" },
      onStepStart,
      onStepComplete,
      workflow: definitionAuthority().definition,
      definitionDigest: definitionAuthority().definitionDigest,
      maxParallel: 2,
      runAdmission: result.admission,
    });
    expect(Object.isFrozen(result.record)).toBe(true);
    expect(Object.isFrozen(result.record.steps)).toBe(true);
  });

  it("returns a non-started outcome when preflight blocks", async () => {
    const executor = vi.fn();
    const verifyAuthorities = authorityVerifier();
    const result = await executeDynamicWorkflowWithAdmission(
      runInput({ maxParallel: 3 }),
      { executeWorkflow: executor, verifyAuthorities },
    );

    expect(result).toMatchObject({
      allowed: false,
      authorityVerified: true,
      admission: null,
      admissionDigest: null,
      record: null,
      executionStarted: false,
      error: { code: DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED_CODE },
    });
    expect(result.preflight.blockers).toContain("parallel-budget-exceeded");
    expect(result.preflightDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(verifyAuthorities).toHaveBeenCalledTimes(1);
    expect(executor).not.toHaveBeenCalled();
  });

  it("blocks a valid legacy definition authority instead of executing it", async () => {
    const legacy = verifyCoworkWorkflowRecord(WORKFLOW, { allowLegacy: true });
    const executor = vi.fn();
    const result = await executeDynamicWorkflowWithAdmission(
      runInput({ definitionAuthority: legacy }),
      {
        executeWorkflow: executor,
        verifyAuthorities: authorityVerifier({ definitionAuthority: legacy }),
      },
    );

    expect(result).toMatchObject({
      allowed: false,
      executionStarted: false,
      record: null,
      error: { code: DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED_CODE },
    });
    expect(result.preflight.blockers).toContain(
      "definition-authority-unversioned",
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects secret-bearing store authority before execution", async () => {
    const executor = vi.fn();
    const secret = "never-serialize-this-value";
    const binding = structuredClone(executionLocation());
    binding.credentials = [
      { name: "GH_TOKEN", source: "env", scope: "repo", value: secret },
    ];

    let caught;
    try {
      await executeDynamicWorkflowWithAdmission(runInput(), {
        executeWorkflow: executor,
        verifyAuthorities: authorityVerifier({
          executionLocationAuthority: executionLocationAuthority({ binding }),
        }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      record: null,
      executionStarted: false,
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(executor).not.toHaveBeenCalled();
  });

  it("binds exact verified-session proof into the digest", () => {
    const first = buildDynamicWorkflowRunAdmission(runInput(), {
      verifyAuthorities: authorityVerifier(),
    });
    const second = buildDynamicWorkflowRunAdmission(runInput(), {
      verifyAuthorities: authorityVerifier({
        executionLocationAuthority: executionLocationAuthority({
          eventCount: 8,
        }),
      }),
    });

    expect(first.allowed).toBe(true);
    expect(first.admission.executionLocation.session).toEqual({
      sessionId: "session-run-1",
      headHash: "d".repeat(64),
      eventCount: 7,
    });
    expect(first.executionLocationDigest).not.toBe(
      second.executionLocationDigest,
    );
    expect(first.admission.admissionDigest).not.toBe(
      second.admission.admissionDigest,
    );
  });

  it("admits and preserves a verified location-handoff authority", () => {
    const result = buildDynamicWorkflowRunAdmission(runInput(), {
      verifyAuthorities: authorityVerifier({
        executionLocationAuthority: executionLocationAuthority({
          authority: "verified-session-location-handoff",
        }),
      }),
    });

    expect(result.allowed).toBe(true);
    expect(result.admission.executionLocation).toMatchObject({
      authority: "verified-session-location-handoff",
      session: {
        sessionId: "session-run-1",
        headHash: "d".repeat(64),
        eventCount: 7,
      },
    });
  });

  it("rejects a current-process observation returned by the verifier", async () => {
    const executor = vi.fn();
    await expect(
      executeDynamicWorkflowWithAdmission(runInput(), {
        executeWorkflow: executor,
        verifyAuthorities: authorityVerifier({
          executionLocationAuthority: {
            schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
            authority: "current-process-observation",
            sessionId: "session-run-1",
            headHash: "d".repeat(64),
            eventCount: 7,
            binding: executionLocation(),
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      executionStarted: false,
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it.each([
    ["cwd", { cwd: "/outside" }],
    ["pipeline", { pipeline: true }],
    ["provider", { provider: "other" }],
    ["model", { model: "other-model" }],
    ["continueOnError", { continueOnError: "true" }],
    ["llmOptions", { llmOptions: {} }],
  ])(
    "rejects non-authoritative execution option %s",
    async (_name, execution) => {
      const executor = vi.fn();
      await expect(
        executeDynamicWorkflowWithAdmission(runInput({ execution }), {
          executeWorkflow: executor,
          verifyAuthorities: authorityVerifier(),
        }),
      ).rejects.toMatchObject({
        code: DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE,
        executionStarted: false,
      });
      expect(executor).not.toHaveBeenCalled();
    },
  );

  it("requires a real synchronous verifier for admission builds", () => {
    expect(() => buildDynamicWorkflowRunAdmission(runInput())).toThrowError(
      expect.objectContaining({
        code: DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      }),
    );
    expect(() =>
      buildDynamicWorkflowRunAdmission(runInput(), {
        verifyAuthorities: async () => verifiedAuthorities(),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      }),
    );
  });

  it("validates dependencies before reading authority or announcing admission", async () => {
    const onAdmitted = vi.fn();
    const verifyAuthorities = authorityVerifier();
    await expect(
      executeDynamicWorkflowWithAdmission(runInput({ onAdmitted }), {
        executeWorkflow: null,
        verifyAuthorities,
      }),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE,
      executionStarted: false,
    });
    expect(verifyAuthorities).not.toHaveBeenCalled();
    expect(onAdmitted).not.toHaveBeenCalled();
  });

  it("blocks authority drift before onAdmitted and execution", async () => {
    const onAdmitted = vi.fn();
    const executor = vi.fn();
    const verifyAuthorities = vi
      .fn()
      .mockReturnValueOnce(verifiedAuthorities())
      .mockReturnValueOnce(
        verifiedAuthorities({
          executionLocationAuthority: executionLocationAuthority({
            eventCount: 8,
          }),
        }),
      );

    await expect(
      executeDynamicWorkflowWithAdmission(runInput({ onAdmitted }), {
        executeWorkflow: executor,
        verifyAuthorities,
      }),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      executionStarted: false,
    });
    expect(verifyAuthorities).toHaveBeenCalledTimes(2);
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects authority accessors without invoking them", () => {
    const executionAuthority = executionLocationAuthority();
    let reads = 0;
    Object.defineProperty(executionAuthority, "eventCount", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return 7;
      },
    });

    expect(() =>
      buildDynamicWorkflowRunAdmission(runInput(), {
        verifyAuthorities: authorityVerifier({
          executionLocationAuthority: executionAuthority,
        }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      }),
    );
    expect(reads).toBe(0);
  });

  it("declares forEach parallelism and projects it through maxParallel", () => {
    const fanOutWorkflow = {
      id: "fan-out",
      name: "Fan out",
      steps: [
        {
          id: "fan",
          message: "Process ${item}",
          forEach: Array.from({ length: 10 }, (_, index) => index),
        },
      ],
      facade: {
        requirements: {
          capabilities: [
            "cowork-task",
            "dag",
            "for-each",
            "parallel",
            "variables",
          ],
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
          tokensPerTask: 1,
          usdPerTask: 0,
          durationMsPerTask: 1000,
        },
        budget: {
          maxExpandedTasks: 10,
          maxParallel: 2,
          maxTokens: 10,
          maxUsd: 0,
          maxDurationMs: 5000,
        },
      },
    };
    const manifest = createDynamicWorkflowManifest(fanOutWorkflow);
    const preflight = buildDynamicWorkflowPreflight({
      workflow: fanOutWorkflow,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(manifest.usedCapabilities).toContain("parallel");
    expect(preflight.allowed).toBe(true);
    expect(preflight.cost.projectedDurationMs).toBe(5000);
  });

  it.each([
    ["schema", (options) => successfulRunRecord(options, { schema: "wrong" })],
    [
      "workflow id",
      (options) => successfulRunRecord(options, { workflowId: "other" }),
    ],
    [
      "definition digest",
      (options) =>
        successfulRunRecord(options, {
          definitionDigest: `sha256:${"f".repeat(64)}`,
        }),
    ],
    [
      "run admission",
      (options) =>
        successfulRunRecord(options, {
          runAdmission: {
            ...options.runAdmission,
            admissionDigest: `sha256:${"f".repeat(64)}`,
          },
        }),
    ],
    [
      "status semantics",
      (options) => successfulRunRecord(options, { status: "failed" }),
    ],
  ])("rejects executor record mismatch: %s", async (_name, recordFor) => {
    const executor = vi.fn(async (options) => recordFor(options));
    await expect(
      executeDynamicWorkflowWithAdmission(runInput(), {
        executeWorkflow: executor,
        verifyAuthorities: authorityVerifier(),
      }),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE,
      record: null,
      executionStarted: true,
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "extra", "duplicate"])(
    "rejects a completed record with a %s ordinary-step outcome",
    async (mutation) => {
      const executor = vi.fn(async (options) => {
        const record = successfulRunRecord(options);
        if (mutation === "missing") record.steps.pop();
        if (mutation === "extra") {
          record.steps.push(completedOutcome("outside-definition"));
        }
        if (mutation === "duplicate") {
          record.steps.push(structuredClone(record.steps[0]));
        }
        return record;
      });

      await expect(
        executeDynamicWorkflowWithAdmission(runInput(), {
          executeWorkflow: executor,
          verifyAuthorities: authorityVerifier(),
        }),
      ).rejects.toMatchObject({
        code: DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE,
        executionStarted: true,
      });
    },
  );

  it("requires exact literal-forEach children while preserving batch and loop outcomes", async () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.steps = [
      { id: "left", message: "left" },
      { id: "right", message: "right" },
      {
        id: "fan",
        message: "fan ${item}",
        dependsOn: ["left"],
        forEach: ["a", "b"],
      },
      {
        id: "loop",
        message: "loop ${iter}",
        dependsOn: ["right"],
        loopUntil: "${iter} >= 1",
        maxIterations: 2,
      },
      {
        id: "review",
        message: "review",
        dependsOn: ["fan", "loop"],
      },
    ];
    workflow.facade.requirements.capabilities = [
      ...new Set([
        ...workflow.facade.requirements.capabilities,
        "for-each",
        "loop",
      ]),
    ];
    const authority = definitionAuthority(workflow);
    const exactSteps = [
      completedOutcome("right"),
      completedOutcome("fan[1]", { summary: "b" }),
      completedOutcome("left"),
      completedOutcome("loop", { summary: "loop", iterations: 1 }),
      completedOutcome("fan[0]", { summary: "a" }),
      completedOutcome("review"),
    ];
    const input = runInput({ definitionAuthority: authority });
    const verifier = () =>
      authorityVerifier({ definitionAuthority: authority });

    const accepted = await executeDynamicWorkflowWithAdmission(input, {
      executeWorkflow: async (options) =>
        successfulRunRecord(options, {
          steps: structuredClone(exactSteps),
        }),
      verifyAuthorities: verifier(),
    });
    expect(accepted.record.steps.map((step) => step.id)).toEqual(
      exactSteps.map((step) => step.id),
    );

    for (const invalidSteps of [
      exactSteps.filter((step) => step.id !== "fan[1]"),
      [...exactSteps, completedOutcome("fan[2]")],
    ]) {
      await expect(
        executeDynamicWorkflowWithAdmission(input, {
          executeWorkflow: async (options) =>
            successfulRunRecord(options, {
              steps: structuredClone(invalidSteps),
            }),
          verifyAuthorities: verifier(),
        }),
      ).rejects.toMatchObject({
        code: DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE,
        executionStarted: true,
      });
    }
  });

  it("rejects accessor, circular, and oversized executor records", async () => {
    const cases = [
      (options) => {
        const record = successfulRunRecord(options);
        Object.defineProperty(record, "definitionDigest", {
          configurable: true,
          enumerable: true,
          get() {
            throw new Error("must not run");
          },
        });
        return record;
      },
      (options) => {
        const record = successfulRunRecord(options);
        record.steps = [
          { id: "step", status: "completed", taskId: null, result: {} },
        ];
        record.steps[0].result.self = record.steps[0].result;
        return record;
      },
      (options) =>
        successfulRunRecord(options, {
          steps: [
            {
              id: "step",
              status: "completed",
              taskId: null,
              result: { summary: "x".repeat(1024 * 1024) },
            },
          ],
        }),
    ];

    for (const recordFor of cases) {
      await expect(
        executeDynamicWorkflowWithAdmission(runInput(), {
          executeWorkflow: async (options) => recordFor(options),
          verifyAuthorities: authorityVerifier(),
        }),
      ).rejects.toMatchObject({
        code: DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE,
        executionStarted: true,
      });
    }
  });
});
