import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PROJECTION_ACTIONS,
  PROJECTION_STATES,
  buildSessionProjection,
  canonicalSessionId,
  disconnectedSessionProjection,
  previewSessionProjectionAction,
  projectionRevision,
  recheckSessionProjectionAction,
} from "../../src/lib/session-projection.js";

const generatedAt = "2026-08-01T00:10:00.000Z";

function sample(overrides = {}) {
  return buildSessionProjection({
    generatedAt,
    local: [
      {
        id: "s/1",
        title: "Saved",
        workspace: "C:/repo",
        updated_at: "2026-08-01 00:00:00",
      },
    ],
    background: [
      {
        id: "bg-1",
        title: "Worker",
        status: "running",
        phase: "needs_input",
        sessionId: "s/1",
        interactive: true,
        cwd: "C:/repo",
        heartbeatAt: Date.parse("2026-08-01T00:04:00Z"),
        governance: { owner: "alice" },
        repoRoot: "C:/repo",
        worktreePath: "C:/repo-wt",
        branch: "agent/bg-1",
        baseSha: "abc123",
        transport: { token: "must-not-leak", pipe: "secret-pipe" },
      },
      {
        id: "bg-finished",
        status: "completed",
        sessionId: "s/1",
        interactive: true,
      },
    ],
    remote: [
      {
        remoteSessionId: "remote-1",
        agentSessionId: "s/1",
        peerId: "phone",
        alive: true,
        port: 18800,
        host: "0.0.0.0",
        mode: "direct",
        token: "remote-secret",
        wsUrl: "ws://host:18800/?token=remote-secret",
      },
    ],
    team: [
      {
        id: "team-run-1",
        kind: "team",
        owner: "team:team-run-1",
        status: "running",
        repoRoot: "C:/repo",
        updatedAt: Date.parse("2026-08-01T00:06:00Z"),
        units: [
          {
            key: "review",
            sessionId: "team-session-1",
            branch: "agent/review",
            worktreePath: "C:/repo-review",
            status: "running",
            sideEffects: { unknown: 1, unsettled: 0 },
          },
        ],
      },
    ],
    workflow: [
      {
        id: "wf-1",
        sessionId: "wf-1",
        stage: "plan",
        hasPlan: true,
        approved: false,
        cwd: "C:/repo",
        checkpointAvailable: true,
        checkpointSessionId: "wf-1",
        updatedAt: "2026-08-01T00:05:00Z",
      },
    ],
    artifacts: [
      {
        id: "art-1",
        sessionId: "s/1",
        title: "report.md",
        kind: "report",
        createdAt: "2026-08-01T00:02:00Z",
        sourcePath: "C:/private/report.md",
      },
    ],
    prLinks: {
      "s/1": [
        {
          number: 42,
          repo: "org/repo",
          url: "https://github.com/org/repo/pull/42",
          state: "open",
          updatedAt: Date.parse("2026-08-01T00:03:00Z"),
        },
      ],
    },
    ...overrides,
  });
}

describe("canonical session projection", () => {
  it("binds CLI-owned cross-session inbox state to every linked IDE row", () => {
    const projection = sample({
      sessionMessageFabric: {
        revision: 7,
        endpoints: [
          {
            sessionId: "s/1",
            name: "reviewer",
            address: "cc-session://host-a/@reviewer?epoch=epoch-1",
            policy: "hold",
            online: false,
            idle: false,
            unread: 2,
            held: 1,
          },
        ],
      },
    });
    const linked = projection.sessions.filter((item) =>
      ["local", "background", "remote"].includes(item.kind),
    );
    expect(linked.length).toBeGreaterThan(0);
    for (const item of linked) {
      expect(item.messaging).toEqual({
        authority: "cli",
        registered: true,
        revision: 7,
        unread: 2,
        held: 1,
        endpoints: [
          {
            name: "reviewer",
            address: "cc-session://host-a/@reviewer?epoch=epoch-1",
            policy: "hold",
            online: false,
            idle: false,
            unread: 2,
            held: 1,
          },
        ],
      });
    }
    expect(projection.sources.sessionMessageFabric).toEqual({
      ok: true,
      count: 1,
      error: null,
    });
  });

  it("uses stable kind-prefixed ids, the six-state vocabulary and fixed action vocabulary", () => {
    const projection = sample();
    expect(canonicalSessionId("local", "s/1")).toBe("local:s%2F1");
    expect(projection.authority).toBe("cli");
    expect(projection.connected).toBe(true);
    expect(projection.sessions.map((item) => item.kind).sort()).toEqual([
      "background",
      "background",
      "local",
      "remote",
      "team",
      "workflow",
    ]);
    for (const item of projection.sessions) {
      expect(PROJECTION_STATES).toContain(item.state);
      expect(item.actions.map((action) => action.id)).toEqual(
        PROJECTION_ACTIONS,
      );
      expect(item.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("maps input, approval/recovery and terminal lifecycle without advertising unsupported controls", () => {
    const projection = sample({
      background: [
        { id: "input", status: "running", phase: "needs_input" },
        { id: "approval", status: "running", phase: "waiting_permission" },
        { id: "recovering", status: "running", connection: "reconnecting" },
        { id: "done", status: "completed", phase: "needs_input" },
        { id: "failed", status: "lost" },
        { id: "stopped", status: "stopped" },
      ],
    });
    const states = Object.fromEntries(
      projection.sessions
        .filter((item) => item.kind === "background")
        .map((item) => [item.sourceId, item.state]),
    );
    expect(states).toEqual({
      input: "needs_input",
      approval: "blocked",
      recovering: "blocked",
      done: "done",
      failed: "failed",
      stopped: "stopped",
    });
    for (const item of projection.sessions.filter(
      (entry) => entry.kind === "background",
    )) {
      expect(item.capabilities).not.toContain("pause");
      expect(item.capabilities).not.toContain("resume");
      expect(item.actions.map((action) => action.id)).not.toContain("rollback");
    }
  });

  it("projects revision-bound durable workflow controls and content-free observability", () => {
    const base = {
      schema: "cc-dynamic-workflow-workbench-state/v1",
      workflowId: "release-review",
      definitionDigest: `sha256:${"a".repeat(64)}`,
      admissionDigest: `sha256:${"b".repeat(64)}`,
      stateDigest: `sha256:${"c".repeat(64)}`,
      executionAuthoritySessionId: "session-authority",
      cwd: "C:/repo",
      createdAt: generatedAt,
      updatedAt: generatedAt,
      phase: { status: "paused", transition: "run-paused", at: generatedAt },
      agents: { requested: 2, settled: 2, pending: 0, completed: 2, failed: 0 },
      input: { requested: 0, pending: 0 },
      budget: {
        limits: { maxTokens: 1000, maxUsd: 1, maxDurationMs: 10000 },
        observed: { tokens: 20, usd: 0.01, durationMs: 2000 },
        status: { tokens: "within", usd: "within", duration: "within" },
        overall: "within",
      },
      artifacts: { count: 1 },
      checkpoints: { count: 1 },
      recovery: { prepared: 1, terminal: 1, pending: 0, unavailable: 0 },
      recoveryPolicy: {
        risk: "terminal_checkpoint_recovery",
        severity: "warning",
        recommendedAction: "recover",
        requiresApproval: true,
        automaticallyExecutable: true,
        unattendedMutationAllowed: false,
        notification: {
          key: `sha256:${"f".repeat(64)}`,
          backoffMs: [15000, 60000, 300000, 900000],
        },
      },
      recent: {
        effectId: `sha256:${"d".repeat(64)}`,
        stepId: "review",
        status: "settled",
        taskStatus: "completed",
        requestedAt: generatedAt,
        settledAt: generatedAt,
        resultDigest: `sha256:${"e".repeat(64)}`,
        call: { name: "read_file", status: "completed" },
      },
    };
    const projection = sample({
      dynamicWorkflow: [
        { ...base, runId: "paused-run", status: "paused", revision: 7 },
        {
          ...base,
          runId: "running-run",
          status: "running",
          revision: 3,
          phase: { ...base.phase, status: "running" },
          agents: { ...base.agents, settled: 1, pending: 1 },
          recovery: { ...base.recovery, terminal: 0, pending: 1 },
        },
      ],
    });
    const paused = projection.sessions.find(
      (item) => item.sourceId === "paused-run",
    );
    const running = projection.sessions.find(
      (item) => item.sourceId === "running-run",
    );
    expect(paused.kind).toBe("dynamic_workflow");
    expect(paused.capabilities).toEqual(["peek", "stop", "resume", "recover"]);
    expect(paused.workflow).toMatchObject({
      runtimeRevision: 7,
      agents: { requested: 2, settled: 2 },
      budget: { overall: "within" },
      recovery: { terminal: 1 },
      recoveryPolicy: {
        risk: "terminal_checkpoint_recovery",
        recommendedAction: "recover",
      },
      recent: { stepId: "review", call: { name: "read_file" } },
    });
    expect(
      paused.actions.find((action) => action.id === "resume").preview.argv,
    ).toEqual([
      "cowork",
      "workflow",
      "runtime-resume",
      "paused-run",
      "--expected-revision",
      "7",
      "--cwd",
      "C:/repo",
      "--json",
    ]);
    expect(running.capabilities).toEqual(["peek", "stop", "pause"]);
    expect(JSON.stringify(projection)).not.toContain("tool arguments");
  });

  it("advertises only actions backed by existing control-plane routes", () => {
    const projection = sample();
    const local = projection.sessions.find((item) => item.kind === "local");
    const active = projection.sessions.find((item) => item.sourceId === "bg-1");
    const finished = projection.sessions.find(
      (item) => item.sourceId === "bg-finished",
    );
    const remote = projection.sessions.find((item) => item.kind === "remote");
    const team = projection.sessions.find((item) => item.kind === "team");
    const workflow = projection.sessions.find(
      (item) => item.kind === "workflow",
    );
    expect(local.capabilities).toEqual(["dispatch", "peek"]);
    expect(active.capabilities).toEqual(["peek", "reply", "attach", "stop"]);
    expect(finished.capabilities).toEqual(["dispatch", "peek"]);
    expect(remote.capabilities).toEqual(["peek", "stop"]);
    expect(team.capabilities).toEqual([]);
    expect(workflow.capabilities).toEqual(["peek", "checkpoint"]);
    for (const item of projection.sessions) {
      for (const id of ["detach", "archive"]) {
        expect(item.actions.find((action) => action.id === id)).toMatchObject({
          available: false,
          preview: null,
        });
      }
    }
    expect(
      team.actions.find((action) => action.id === "checkpoint"),
    ).toMatchObject({
      available: false,
      reason: expect.stringContaining("task-scoped"),
      preview: null,
    });
  });

  it("publishes exact secret-free action previews only for real routes", () => {
    const projection = sample();
    const workflow = projection.sessions.find(
      (item) => item.kind === "workflow",
    );
    expect(
      workflow.actions.find((action) => action.id === "peek").preview,
    ).toEqual({
      executor: "cli",
      argv: ["session", "workflow", "wf-1", "--json", "--cwd", "C:/repo"],
      mutates: false,
      input: null,
    });
    expect(
      workflow.actions.find((action) => action.id === "checkpoint").preview,
    ).toEqual({
      executor: "cli",
      argv: [
        "checkpoint",
        "create",
        "--dir",
        "C:/repo",
        "--session",
        "wf-1",
        "--json",
      ],
      mutates: true,
      input: null,
    });
    const finished = projection.sessions.find(
      (item) => item.sourceId === "bg-finished",
    );
    expect(
      finished.actions.find((action) => action.id === "dispatch").preview,
    ).toMatchObject({
      executor: "cli",
      argv: ["daemon", "resume", "bg-finished", "$prompt", "--json"],
      input: "prompt",
    });
    const active = projection.sessions.find((item) => item.sourceId === "bg-1");
    expect(
      active.actions.find((action) => action.id === "reply").preview,
    ).toEqual({
      executor: "cli",
      argv: ["daemon", "reply", "bg-1", "$prompt", "--json"],
      mutates: true,
      input: "prompt",
    });
    expect(JSON.stringify(projection)).not.toContain("must-not-leak");
  });

  it("previews against the rendered revision and CAS rechecks the target item", () => {
    const rendered = sample();
    const workflow = rendered.sessions.find((item) => item.kind === "workflow");
    const request = {
      id: workflow.id,
      action: "checkpoint",
      revision: rendered.revision,
      itemRevision: workflow.revision,
    };
    expect(previewSessionProjectionAction(rendered, request)).toMatchObject({
      ok: true,
      expectedRevision: rendered.revision,
      expectedItemRevision: workflow.revision,
      preview: { executor: "cli", mutates: true },
    });

    const unrelatedChange = sample({
      local: [
        {
          id: "another",
          title: "Unrelated row changed",
          workspace: "C:/repo",
          updated_at: "2026-08-01 00:09:00",
        },
      ],
    });
    expect(unrelatedChange.revision).not.toBe(rendered.revision);
    expect(
      recheckSessionProjectionAction(rendered, unrelatedChange, request),
    ).toMatchObject({ ok: true, currentRevision: unrelatedChange.revision });

    const targetChanged = sample({
      workflow: [
        {
          id: "wf-1",
          sessionId: "wf-1",
          stage: "execute",
          hasPlan: true,
          approved: true,
          cwd: "C:/repo",
          checkpointAvailable: true,
          checkpointSessionId: "wf-1",
          updatedAt: "2026-08-01T00:07:00Z",
        },
      ],
    });
    expect(
      recheckSessionProjectionAction(rendered, targetChanged, request),
    ).toMatchObject({ ok: false, code: "SESSION_PROJECTION_STALE" });
  });

  it("summarizes artifacts, approvals, PRs and worktrees without transport secrets", () => {
    const projection = sample();
    const active = projection.sessions.find((item) => item.sourceId === "bg-1");
    expect(active.owner).toEqual({ type: "local-user", id: "alice" });
    expect(active.approval).toEqual({
      pending: true,
      type: "input",
      count: 0,
    });
    expect(active.worktree.branch).toBe("agent/bg-1");
    expect(active.artifact.count).toBe(1);
    expect(active.pr.latest.number).toBe(42);
    const text = JSON.stringify(projection);
    expect(text).not.toContain("must-not-leak");
    expect(text).not.toContain("remote-secret");
    expect(text).not.toContain("secret-pipe");
    expect(text).not.toContain("sourcePath");
    expect(text).not.toContain("wsUrl");
  });

  it("keeps content revisions stable across generatedAt changes", () => {
    const first = sample({ generatedAt: "2026-08-01T00:10:00Z" });
    const second = sample({ generatedAt: "2026-08-01T00:11:00Z" });
    expect(first.revision).toBe(second.revision);
    expect(first.sessions.map((item) => item.revision)).toEqual(
      second.sessions.map((item) => item.revision),
    );
  });

  it("uses an empty fail-closed envelope on disconnect", () => {
    const projection = disconnectedSessionProjection("socket closed");
    expect(projection.connected).toBe(false);
    expect(projection.sessions).toEqual([]);
    expect(projection.reason).toBe("socket closed");
  });

  it("ships one full local/background/remote/team/workflow fixture for both IDE twins", () => {
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../fixtures/session-projection-v1.json", import.meta.url),
        ),
        "utf8",
      ),
    );
    expect(fixture.schema).toBe("chainlesschain.session-projection/v1");
    expect(fixture.sessions.map((item) => item.kind)).toEqual([
      "workflow",
      "background",
      "team",
      "remote",
      "local",
    ]);
    expect(fixture.sessions[0].actions.map((item) => item.id)).toEqual([
      "dispatch",
      "peek",
      "reply",
      "attach",
      "detach",
      "stop",
      "checkpoint",
      "archive",
    ]);
    for (const session of fixture.sessions) {
      const content = { ...session };
      delete content.revision;
      expect(session.revision).toBe(projectionRevision(content));
    }
    expect(fixture.revision).toBe(
      projectionRevision({
        schema: fixture.schema,
        sources: fixture.sources,
        sessions: fixture.sessions.map(({ id, revision }) => ({
          id,
          revision,
        })),
      }),
    );
  });
});
