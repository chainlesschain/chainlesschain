import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTeamControlArgs,
  executeTeamControl,
  parseControlOutput,
  parseTeamMonitorMessage,
  renderHtml,
  snapshot,
  validateControlTarget,
} from "../../../vscode-extension/src/ui/team-monitor-view.js";
import {
  computeTeamControlAdjudicationDigest,
  computeTeamControlAttemptDigest,
} from "../../src/lib/agent-team/team-control-store.js";

const temporaryDirectories = [];
const DEFAULT_LEASE = Object.freeze({
  holder: "mate-1",
  leaseId: "lease-epoch:1",
  fencingToken: "lease-epoch:1",
  expiresAt: Date.now() + 60_000,
});
const DEFAULT_CASE = Object.freeze({
  caseId: "case-1",
  registryDigest: `sha256:${"b".repeat(64)}`,
  sideEffectDigest: `sha256:${"a".repeat(64)}`,
});
const ATTEMPT_DIGEST = computeTeamControlAttemptDigest(DEFAULT_LEASE);
const ADJUDICATION_DIGEST = computeTeamControlAdjudicationDigest({
  caseId: DEFAULT_CASE.caseId,
  evidenceDigest: DEFAULT_CASE.sideEffectDigest,
});
const AUTHORITY_DIGEST = "c".repeat(64);
const DISTRIBUTED_AUTHORITY = Object.freeze({
  repoRoot: "C:/repo with spaces",
  runId: "distributed-run-1",
  mode: "agent-worktree",
});
const DISTRIBUTED_LEASE = Object.freeze({
  holder: "worker-1:agent",
  leaseId: "distributed-lease-1",
  fencingToken: 9,
  expiresAt: Date.now() + 60_000,
});

function stateFile(tasks, extra = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-monitor-view-"),
  );
  temporaryDirectories.push(directory);
  const file = path.join(directory, "state.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 6,
      stateId: "state-6",
      registry: {
        registry: { byKey: [] },
        tasks: { tasks },
      },
      members: [],
      budget: {},
      ...extra,
    }),
  );
  return file;
}

function distributedStateFile(tasks, extra = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-queue-monitor-view-"),
  );
  temporaryDirectories.push(directory);
  const file = path.join(directory, "queue.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      queueId: "queue-1",
      revision: 4,
      authorityDigest: AUTHORITY_DIGEST,
      authority: DISTRIBUTED_AUTHORITY,
      registry: {
        registry: { byKey: [] },
        tasks: { tasks },
      },
      budget: { limits: {}, totals: {} },
      ...extra,
    }),
  );
  return file;
}

function task(key, status, metadata = {}) {
  const normalized = { ...metadata };
  if (status === "in_progress" && normalized.lease == null) {
    normalized.lease = { ...DEFAULT_LEASE };
  }
  if (
    normalized.adjudication?.required === true &&
    normalized.adjudication.case == null
  ) {
    normalized.adjudication = {
      ...normalized.adjudication,
      case: { ...DEFAULT_CASE },
    };
  }
  return {
    id: `task-${key}`,
    title: `${key} title`,
    status,
    metadata: { key, dependsOn: [], ...normalized },
  };
}

function fakeVscode({
  reason = "human verified the prior attempt",
  confirm,
  onConfirm,
} = {}) {
  const notices = { errors: [], information: [], warnings: [] };
  return {
    notices,
    window: {
      showInputBox: vi.fn(async (options) => {
        expect(options.validateInput("")).toMatch(/required/i);
        expect(options.validateInput(reason)).toBeNull();
        return reason;
      }),
      showWarningMessage: vi.fn(async (message, options, action) => {
        notices.warnings.push({ message, options, action });
        if (onConfirm) await onConfirm();
        return confirm === false ? undefined : action;
      }),
      showErrorMessage: vi.fn((message) => notices.errors.push(message)),
      showInformationMessage: vi.fn((message) =>
        notices.information.push(message),
      ),
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("team monitor webview protocol", () => {
  it("accepts only the exact refresh/control message schema", () => {
    expect(parseTeamMonitorMessage({ command: "refresh" })).toEqual({
      command: "refresh",
    });
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "interrupt",
        taskKey: "task-a",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      }),
    ).toEqual({
      command: "control",
      action: "interrupt",
      taskKey: "task-a",
      stateId: "state-6",
      attemptDigest: ATTEMPT_DIGEST,
    });
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "adjudicate",
        decision: "accept",
        taskKey: "task-a",
        stateId: "state-6",
        adjudicationDigest: ADJUDICATION_DIGEST,
      }),
    ).toMatchObject({
      action: "adjudicate",
      decision: "accept",
      adjudicationDigest: ADJUDICATION_DIGEST,
    });

    expect(parseTeamMonitorMessage(null)).toBeNull();
    expect(parseTeamMonitorMessage({ command: "unknown" })).toBeNull();
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "interrupt",
        taskKey: "task-a",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
        statePath: "C:/forged.json",
      }),
    ).toBeNull();
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "adjudicate",
        decision: "erase",
        taskKey: "task-a",
        stateId: "state-6",
        adjudicationDigest: ADJUDICATION_DIGEST,
      }),
    ).toBeNull();
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "interrupt",
        taskKey: "task-a",
        stateId: "state-6",
      }),
    ).toBeNull();
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "adjudicate",
        decision: "accept",
        taskKey: "task-a",
        stateId: "state-6",
        adjudicationDigest: "sha256:forged",
      }),
    ).toBeNull();

    const distributedInterrupt = {
      command: "control",
      action: "interrupt",
      taskKey: "task-a",
      queueId: "queue-1",
      authorityDigest: AUTHORITY_DIGEST,
      repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
      runId: DISTRIBUTED_AUTHORITY.runId,
      holder: DISTRIBUTED_LEASE.holder,
      leaseId: DISTRIBUTED_LEASE.leaseId,
      fencingToken: DISTRIBUTED_LEASE.fencingToken,
    };
    expect(parseTeamMonitorMessage(distributedInterrupt)).toEqual(
      distributedInterrupt,
    );
    expect(
      parseTeamMonitorMessage({
        command: "control",
        action: "recover",
        taskKey: "task-a",
        queueId: "queue-1",
        authorityDigest: AUTHORITY_DIGEST,
        repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
        runId: DISTRIBUTED_AUTHORITY.runId,
        evidenceDigest: DEFAULT_CASE.sideEffectDigest,
      }),
    ).toMatchObject({
      action: "recover",
      evidenceDigest: DEFAULT_CASE.sideEffectDigest,
    });
    expect(
      parseTeamMonitorMessage({
        ...distributedInterrupt,
        requestId: "forged-webview-id",
      }),
    ).toBeNull();
    expect(
      parseTeamMonitorMessage({
        ...distributedInterrupt,
        fencingToken: "9",
      }),
    ).toBeNull();
  });

  it("builds fixed-authority CLI argv without shell interpolation", () => {
    expect(
      buildTeamControlArgs({
        action: "interrupt",
        statePath: "C:/team state.json",
        expectedStateId: "state-6",
        expectedAttemptDigest: ATTEMPT_DIGEST,
        taskKey: "task & one",
        reason: "operator request",
      }),
    ).toEqual([
      "team",
      "interrupt",
      "--state",
      "C:/team state.json",
      "--expected-state-id",
      "state-6",
      "--expected-attempt-digest",
      ATTEMPT_DIGEST,
      "--task",
      "task & one",
      "--actor",
      "vscode",
      "--reason",
      "operator request",
      "--json",
    ]);
    expect(
      buildTeamControlArgs({
        action: "adjudicate",
        statePath: "C:/team.json",
        expectedStateId: "state-6",
        expectedAdjudicationDigest: ADJUDICATION_DIGEST,
        taskKey: "task-a",
        decision: "retry",
        reason: "safe to retry",
      }),
    ).toEqual([
      "team",
      "adjudicate",
      "--state",
      "C:/team.json",
      "--expected-state-id",
      "state-6",
      "--expected-adjudication-digest",
      ADJUDICATION_DIGEST,
      "--task",
      "task-a",
      "--decision",
      "retry",
      "--authority",
      "vscode",
      "--reason",
      "safe to retry",
      "--json",
    ]);
    expect(() =>
      buildTeamControlArgs({
        action: "interrupt",
        statePath: "C:/team.json",
        taskKey: "task-a",
        reason: "operator request",
      }),
    ).toThrow(/stateId/i);
    expect(() =>
      buildTeamControlArgs({
        action: "interrupt",
        statePath: "C:/team.json",
        expectedStateId: "state-6",
        taskKey: "task-a",
        reason: "operator request",
      }),
    ).toThrow(/attempt digest/i);
    expect(() =>
      buildTeamControlArgs({
        action: "adjudicate",
        statePath: "C:/team.json",
        expectedStateId: "state-6",
        taskKey: "task-a",
        decision: "retry",
        reason: "safe to retry",
      }),
    ).toThrow(/adjudication digest/i);
  });

  it("builds exact distributed queue argv with host-owned ids and no accept result", () => {
    const common = {
      statePath: "C:/queue state.json",
      queueId: "queue-1",
      authorityDigest: AUTHORITY_DIGEST,
      repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
      runId: DISTRIBUTED_AUTHORITY.runId,
      taskKey: "task & one",
      reason: "operator checked",
    };
    expect(
      buildTeamControlArgs({
        ...common,
        action: "interrupt",
        ...DISTRIBUTED_LEASE,
        operationId: "vscode-request-id-1",
      }),
    ).toEqual([
      "team",
      "queue",
      "interrupt",
      "--state",
      "C:/queue state.json",
      "--repo",
      DISTRIBUTED_AUTHORITY.repoRoot,
      "--run-id",
      DISTRIBUTED_AUTHORITY.runId,
      "--queue-id",
      "queue-1",
      "--authority-digest",
      AUTHORITY_DIGEST,
      "--task",
      "task & one",
      "--holder",
      DISTRIBUTED_LEASE.holder,
      "--lease-id",
      DISTRIBUTED_LEASE.leaseId,
      "--fencing-token",
      "9",
      "--request-id",
      "vscode-request-id-1",
      "--actor",
      "vscode",
      "--reason",
      "operator checked",
      "--json",
    ]);
    const accept = buildTeamControlArgs({
      ...common,
      action: "adjudicate",
      decision: "accept",
      evidenceDigest: DEFAULT_CASE.sideEffectDigest,
      operationId: "vscode-decision-id-1",
    });
    expect(accept).toEqual([
      "team",
      "queue",
      "adjudicate",
      "--state",
      "C:/queue state.json",
      "--repo",
      DISTRIBUTED_AUTHORITY.repoRoot,
      "--run-id",
      DISTRIBUTED_AUTHORITY.runId,
      "--queue-id",
      "queue-1",
      "--authority-digest",
      AUTHORITY_DIGEST,
      "--task",
      "task & one",
      "--decision",
      "accept",
      "--decision-id",
      "vscode-decision-id-1",
      "--evidence-digest",
      DEFAULT_CASE.sideEffectDigest,
      "--actor",
      "vscode",
      "--reason",
      "operator checked",
      "--json",
    ]);
    expect(accept).not.toContain("--result");
    expect(
      buildTeamControlArgs({
        ...common,
        action: "recover",
        evidenceDigest: DEFAULT_CASE.sideEffectDigest,
        operationId: "vscode-recovery-id-1",
      }),
    ).toContain("--recovery-id");
  });

  it("binds actions to v6 stateId and current task eligibility", () => {
    const parsed = {
      ok: true,
      version: 6,
      stateId: "state-6",
      tasks: [
        {
          key: "running",
          status: "in_progress",
          attemptDigest: ATTEMPT_DIGEST,
          adjudication: null,
        },
        {
          key: "ambiguous",
          status: "cancelled",
          adjudication: { required: true },
          adjudicationDigest: ADJUDICATION_DIGEST,
        },
      ],
    };
    expect(
      validateControlTarget(parsed, {
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      }).ok,
    ).toBe(true);
    expect(
      validateControlTarget(parsed, {
        action: "adjudicate",
        decision: "retry",
        taskKey: "ambiguous",
        stateId: "state-6",
        adjudicationDigest: ADJUDICATION_DIGEST,
      }).ok,
    ).toBe(true);
    expect(
      validateControlTarget(parsed, {
        action: "interrupt",
        taskKey: "running",
        stateId: "stale",
        attemptDigest: ATTEMPT_DIGEST,
      }).error,
    ).toMatch(/changed/i);
    expect(
      validateControlTarget(parsed, {
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: `sha256:${"c".repeat(64)}`,
      }).error,
    ).toMatch(/attempt changed/i);
    expect(
      validateControlTarget(parsed, {
        action: "adjudicate",
        decision: "retry",
        taskKey: "ambiguous",
        stateId: "state-6",
        adjudicationDigest: `sha256:${"d".repeat(64)}`,
      }).error,
    ).toMatch(/case changed/i);
  });

  it("CAS-validates distributed queue authority, lease fence, evidence, and recovery phase", () => {
    const parsed = {
      ok: true,
      stateKind: "distributed-queue",
      schemaVersion: 1,
      queueId: "queue-1",
      authorityDigest: AUTHORITY_DIGEST,
      authority: DISTRIBUTED_AUTHORITY,
      tasks: [
        {
          key: "running",
          status: "in_progress",
          ...DISTRIBUTED_LEASE,
        },
        {
          key: "recovery",
          status: "cancelled",
          adjudication: { required: true },
          evidenceDigest: DEFAULT_CASE.sideEffectDigest,
          checkpointRecoveryRequired: true,
        },
      ],
    };
    const common = {
      queueId: "queue-1",
      authorityDigest: AUTHORITY_DIGEST,
      repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
      runId: DISTRIBUTED_AUTHORITY.runId,
    };
    expect(
      validateControlTarget(parsed, {
        ...common,
        action: "interrupt",
        taskKey: "running",
        ...DISTRIBUTED_LEASE,
      }).ok,
    ).toBe(true);
    expect(
      validateControlTarget(parsed, {
        ...common,
        action: "recover",
        taskKey: "recovery",
        evidenceDigest: DEFAULT_CASE.sideEffectDigest,
      }).ok,
    ).toBe(true);
    expect(
      validateControlTarget(parsed, {
        ...common,
        authorityDigest: "d".repeat(64),
        action: "interrupt",
        taskKey: "running",
        ...DISTRIBUTED_LEASE,
      }).error,
    ).toMatch(/authority changed/i);
    expect(
      validateControlTarget(parsed, {
        ...common,
        action: "interrupt",
        taskKey: "running",
        ...DISTRIBUTED_LEASE,
        fencingToken: 10,
      }).error,
    ).toMatch(/lease fence changed/i);
    expect(
      validateControlTarget(parsed, {
        ...common,
        action: "adjudicate",
        decision: "retry",
        taskKey: "recovery",
        evidenceDigest: `sha256:${"d".repeat(64)}`,
      }).error,
    ).toMatch(/evidence changed/i);
  });

  it("renders a nonce-only CSP and DOM-only task rendering", () => {
    const html = renderHtml();
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).toMatch(/style-src 'nonce-[a-f0-9]+'/);
    expect(html).toMatch(/script-src 'nonce-[a-f0-9]+'/);
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain(".innerHTML");
    expect(html).toContain("Take over");
    expect(html).toContain("Recover checkpoint");
    expect(html).toContain("controlButton('Retry'");
    expect(html).toContain(
      "const clickBinding = Object.freeze({ ...request })",
    );
    expect(html).toContain("attemptDigest: task.attemptDigest");
    expect(html).toContain("fencingToken: task.fencingToken");
    expect(html).toContain("evidenceDigest: task.evidenceDigest");
  });
});

describe("team monitor CLI controls", () => {
  it("prompts, confirms, and invokes the resolved CLI for takeover", async () => {
    const file = stateFile([task("running", "in_progress")]);
    const vscode = fakeVscode();
    const runCliResult = vi.fn(async () => ({
      ok: true,
      code: 0,
      stdout: JSON.stringify({ ok: true }),
      stderr: "",
    }));

    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      },
      {
        command: "C:/managed/cc.cmd",
        cwd: "C:/workspace",
        runCliResult,
      },
    );

    expect(result.ok).toBe(true);
    expect(vscode.window.showInputBox).toHaveBeenCalledOnce();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
    expect(runCliResult).toHaveBeenCalledWith({
      command: "C:/managed/cc.cmd",
      args: [
        "team",
        "interrupt",
        "--state",
        file,
        "--expected-state-id",
        "state-6",
        "--expected-attempt-digest",
        ATTEMPT_DIGEST,
        "--task",
        "running",
        "--actor",
        "vscode",
        "--reason",
        "human verified the prior attempt",
        "--json",
      ],
      cwd: "C:/workspace",
      timeoutMs: 30000,
    });
    expect(vscode.notices.information).toEqual([
      'Takeover requested for "running title".',
    ]);
  });

  it("re-reads and invokes an exact distributed interrupt with a host-generated id", async () => {
    const file = distributedStateFile([
      task("running", "in_progress", { lease: { ...DISTRIBUTED_LEASE } }),
    ]);
    const vscode = fakeVscode();
    const runCliResult = vi.fn(async () => ({
      ok: true,
      code: 0,
      stdout: JSON.stringify({ requestId: "vscode-request-uuid-1" }),
      stderr: "",
    }));
    const request = {
      command: "control",
      action: "interrupt",
      taskKey: "running",
      queueId: "queue-1",
      authorityDigest: AUTHORITY_DIGEST,
      repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
      runId: DISTRIBUTED_AUTHORITY.runId,
      ...DISTRIBUTED_LEASE,
    };

    const result = await executeTeamControl(vscode, file, request, {
      command: "C:/managed/cc.cmd",
      cwd: "C:/workspace",
      randomUUID: () => "uuid-1",
      runCliResult,
    });

    expect(result.ok).toBe(true);
    expect(runCliResult).toHaveBeenCalledWith({
      command: "C:/managed/cc.cmd",
      args: [
        "team",
        "queue",
        "interrupt",
        "--state",
        file,
        "--repo",
        DISTRIBUTED_AUTHORITY.repoRoot,
        "--run-id",
        DISTRIBUTED_AUTHORITY.runId,
        "--queue-id",
        "queue-1",
        "--authority-digest",
        AUTHORITY_DIGEST,
        "--task",
        "running",
        "--holder",
        DISTRIBUTED_LEASE.holder,
        "--lease-id",
        DISTRIBUTED_LEASE.leaseId,
        "--fencing-token",
        "9",
        "--request-id",
        "vscode-request-uuid-1",
        "--actor",
        "vscode",
        "--reason",
        "human verified the prior attempt",
        "--json",
      ],
      cwd: "C:/workspace",
      timeoutMs: 30000,
    });
  });

  it("routes distributed checkpoint recovery without writing state or repairing Git", async () => {
    const file = distributedStateFile([
      task("recovery", "cancelled", {
        adjudication: {
          required: true,
          reason: "checkpoint rollback needs recovery",
          evidenceDigest: DEFAULT_CASE.sideEffectDigest,
        },
        workspaceExecution: {
          phase: "rollback-recovery-required",
          workerId: "worker-1",
          checkpoint: {
            transactionId: "tx-1",
            checkpointId: "checkpoint-1",
            state: "rollback_failed",
            recoveryRequired: true,
          },
        },
      }),
    ]);
    const before = fs.readFileSync(file, "utf8");
    const vscode = fakeVscode({
      reason: "owner is dead and writes are settled",
    });
    const runCliResult = vi.fn(async () => ({
      ok: true,
      code: 0,
      stdout: JSON.stringify({ recoveryId: "vscode-recovery-uuid-2" }),
      stderr: "",
    }));
    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "recover",
        taskKey: "recovery",
        queueId: "queue-1",
        authorityDigest: AUTHORITY_DIGEST,
        repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
        runId: DISTRIBUTED_AUTHORITY.runId,
        evidenceDigest: DEFAULT_CASE.sideEffectDigest,
      },
      {
        randomUUID: () => "uuid-2",
        runCliResult,
      },
    );

    expect(result.ok).toBe(true);
    const args = runCliResult.mock.calls[0][0].args;
    expect(args).toContain("vscode-recovery-uuid-2");
    expect(args).toContain("--evidence-digest");
    expect(args).not.toContain("--repair-git-baseline");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("rejects distributed authority, fence, and evidence races before CLI invocation", async () => {
    const scenarios = [
      {
        task: task("running", "in_progress", {
          lease: { ...DISTRIBUTED_LEASE },
        }),
        request: {
          action: "interrupt",
          taskKey: "running",
          ...DISTRIBUTED_LEASE,
        },
        mutate(state) {
          state.registry.tasks.tasks[0].metadata.lease.fencingToken += 1;
        },
        expected: /lease fence changed/i,
      },
      {
        task: task("ambiguous", "cancelled", {
          adjudication: {
            required: true,
            evidenceDigest: DEFAULT_CASE.sideEffectDigest,
          },
        }),
        request: {
          action: "adjudicate",
          decision: "cancel",
          taskKey: "ambiguous",
          evidenceDigest: DEFAULT_CASE.sideEffectDigest,
        },
        mutate(state) {
          state.registry.tasks.tasks[0].metadata.adjudication.evidenceDigest = `sha256:${"d".repeat(64)}`;
        },
        expected: /evidence changed/i,
      },
    ];
    for (const scenario of scenarios) {
      const file = distributedStateFile([scenario.task]);
      const vscode = fakeVscode({
        onConfirm: () => {
          const state = JSON.parse(fs.readFileSync(file, "utf8"));
          scenario.mutate(state);
          fs.writeFileSync(file, JSON.stringify(state));
        },
      });
      const runCliResult = vi.fn();
      const result = await executeTeamControl(
        vscode,
        file,
        {
          command: "control",
          queueId: "queue-1",
          authorityDigest: AUTHORITY_DIGEST,
          repoRoot: DISTRIBUTED_AUTHORITY.repoRoot,
          runId: DISTRIBUTED_AUTHORITY.runId,
          ...scenario.request,
        },
        { randomUUID: () => "not-used", runCliResult },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(scenario.expected);
      expect(runCliResult).not.toHaveBeenCalled();
    }
  });

  it("routes adjudication through the CLI and never writes the state itself", async () => {
    const file = stateFile([
      task("ambiguous", "cancelled", {
        adjudication: {
          required: true,
          reason: "unknown external effect",
          decision: null,
        },
      }),
    ]);
    const before = fs.readFileSync(file, "utf8");
    const vscode = fakeVscode({ reason: "verified in the external system" });
    const runCliResult = vi.fn(async () => ({
      ok: true,
      code: 0,
      stdout: '{\n  "decision": "accept"\n}',
      stderr: "",
    }));

    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "adjudicate",
        decision: "accept",
        taskKey: "ambiguous",
        stateId: "state-6",
        adjudicationDigest: ADJUDICATION_DIGEST,
      },
      { command: "cc", runCliResult },
    );

    expect(result.ok).toBe(true);
    expect(runCliResult.mock.calls[0][0].args).toEqual([
      "team",
      "adjudicate",
      "--state",
      file,
      "--expected-state-id",
      "state-6",
      "--expected-adjudication-digest",
      ADJUDICATION_DIGEST,
      "--task",
      "ambiguous",
      "--decision",
      "accept",
      "--authority",
      "vscode",
      "--reason",
      "verified in the external system",
      "--json",
    ]);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("does not invoke the CLI when modal confirmation is declined", async () => {
    const file = stateFile([task("running", "in_progress")]);
    const vscode = fakeVscode({ confirm: false });
    const runCliResult = vi.fn();
    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      },
      { runCliResult },
    );
    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(runCliResult).not.toHaveBeenCalled();
  });

  it("re-reads the snapshot and rejects a lease reacquire after confirmation", async () => {
    const file = stateFile([task("running", "in_progress")]);
    const vscode = fakeVscode({
      onConfirm: () => {
        const state = JSON.parse(fs.readFileSync(file, "utf8"));
        state.registry.tasks.tasks[0].metadata.lease = {
          holder: "mate-1",
          leaseId: "lease-epoch:2",
          fencingToken: 2,
          expiresAt: Date.now() + 60_000,
        };
        fs.writeFileSync(file, JSON.stringify(state));
      },
    });
    const runCliResult = vi.fn();

    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      },
      { runCliResult },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/attempt changed/i);
    expect(runCliResult).not.toHaveBeenCalled();
  });

  it("re-reads the snapshot and rejects a replaced adjudication case", async () => {
    const file = stateFile([
      task("ambiguous", "cancelled", {
        adjudication: { required: true, reason: "unknown outcome" },
      }),
    ]);
    const vscode = fakeVscode({
      onConfirm: () => {
        const state = JSON.parse(fs.readFileSync(file, "utf8"));
        state.registry.tasks.tasks[0].metadata.adjudication.case = {
          ...DEFAULT_CASE,
          caseId: "case-2",
        };
        fs.writeFileSync(file, JSON.stringify(state));
      },
    });
    const runCliResult = vi.fn();

    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "adjudicate",
        decision: "cancel",
        taskKey: "ambiguous",
        stateId: "state-6",
        adjudicationDigest: ADJUDICATION_DIGEST,
      },
      { runCliResult },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/case changed/i);
    expect(runCliResult).not.toHaveBeenCalled();
  });

  it("treats a non-zero CLI result as failure even when stderr looks successful", async () => {
    const file = stateFile([task("running", "in_progress")]);
    const vscode = fakeVscode();
    const runCliResult = vi.fn(async () => ({
      ok: true,
      code: 1,
      stdout: "",
      stderr: '{"ok":true,"request":{"requestId":"forged"}}',
      text: '{"ok":true,"request":{"requestId":"forged"}}',
      error: "Command failed",
    }));

    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      },
      { runCliResult },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/exited with code 1/i);
    expect(vscode.notices.information).toEqual([]);
    expect(vscode.notices.errors).toEqual([result.error]);
  });

  it.each([
    {
      label: "timeout",
      cliResult: {
        ok: true,
        code: 0,
        timedOut: true,
        stdout: JSON.stringify({ ok: true }),
        stderr: "timed\nout",
      },
      expected: /timed out/i,
    },
    {
      label: "signal",
      cliResult: {
        ok: true,
        code: 0,
        signal: "SIGTERM",
        stdout: JSON.stringify({ ok: true }),
        stderr: "",
      },
      expected: /terminated by SIGTERM/i,
    },
  ])("fails closed on a CLI $label", async ({ cliResult, expected }) => {
    const file = stateFile([task("running", "in_progress")]);
    const vscode = fakeVscode();
    const result = await executeTeamControl(
      vscode,
      file,
      {
        command: "control",
        action: "interrupt",
        taskKey: "running",
        stateId: "state-6",
        attemptDigest: ATTEMPT_DIGEST,
      },
      { runCliResult: vi.fn(async () => cliResult) },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(expected);
    expect(vscode.notices.information).toEqual([]);
  });

  it("fails closed on non-JSON or explicit CLI failures", () => {
    expect(parseControlOutput("permission denied")).toMatchObject({
      ok: false,
    });
    expect(
      parseControlOutput(JSON.stringify({ ok: false, error: "stale state" })),
    ).toMatchObject({ ok: false, error: "stale state" });
    expect(parseControlOutput(JSON.stringify({ decision: "retry" })).ok).toBe(
      true,
    );
    const bounded = parseControlOutput(
      JSON.stringify({ ok: false, error: `secret\n${"x".repeat(2_000)}` }),
    );
    expect(bounded.error).not.toContain("\n");
    expect(bounded.error.length).toBeLessThanOrEqual(500);
  });

  it("includes v6 identity and adjudication data in webview snapshots", () => {
    const file = stateFile([
      task("ambiguous", "cancelled", {
        adjudication: { required: true, reason: "unknown outcome" },
      }),
    ]);
    expect(snapshot(file)).toMatchObject({
      type: "update",
      ok: true,
      version: 6,
      stateId: "state-6",
      summary: { adjudicationRequired: 1 },
      tasks: [
        {
          key: "ambiguous",
          adjudication: { required: true, reason: "unknown outcome" },
          adjudicationDigest: ADJUDICATION_DIGEST,
        },
      ],
    });
  });

  it("includes distributed authority and recovery data in webview snapshots", () => {
    const file = distributedStateFile([
      task("recovery", "cancelled", {
        adjudication: {
          required: true,
          evidenceDigest: DEFAULT_CASE.sideEffectDigest,
        },
        workspaceExecution: {
          phase: "rollback-recovery-required",
          checkpoint: {
            state: "rollback_failed",
            recoveryRequired: true,
          },
        },
      }),
    ]);
    expect(snapshot(file)).toMatchObject({
      type: "update",
      ok: true,
      stateKind: "distributed-queue",
      schemaVersion: 1,
      queueId: "queue-1",
      authorityDigest: AUTHORITY_DIGEST,
      authority: DISTRIBUTED_AUTHORITY,
      tasks: [
        {
          key: "recovery",
          evidenceDigest: DEFAULT_CASE.sideEffectDigest,
          checkpointRecoveryRequired: true,
        },
      ],
    });
  });
});
