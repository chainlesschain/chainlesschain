/**
 * `cc team` monitor — pure parse + summarize of legacy and v6 snapshots.
 */
import { describe, it, expect } from "vitest";
import {
  parseTeamState,
  summarizeTeam,
  TEAM_STATUSES,
} from "../../../vscode-extension/src/team-monitor.js";
import {
  computeTeamControlAdjudicationDigest,
  computeTeamControlAttemptDigest,
} from "../../src/lib/agent-team/team-control-store.js";

const SIDE_EFFECT_DIGEST = `sha256:${"a".repeat(64)}`;
const AUTHORITY_DIGEST = "c".repeat(64);

// A minimal v2 snapshot, matching team.js persist(): registry.tasks.tasks[]
// with lease/dependsOn/key/attempts under each task's metadata.
function snap(tasks, extra = {}) {
  return JSON.stringify({
    version: extra.version || 2,
    ...(extra.stateId ? { stateId: extra.stateId } : {}),
    registry: { registry: { byKey: [] }, tasks: { tasks } },
    members: extra.members || [],
    budget: extra.budget || null,
  });
}
const task = (id, status, md = {}) => ({
  id,
  title: id + " title",
  status,
  metadata: { key: id, dependsOn: [], ...md },
});

describe("parseTeamState", () => {
  it("flattens tasks with lease holder, deps, attempts from metadata", () => {
    const state = parseTeamState(
      snap([
        task("a", "completed"),
        task("b", "in_progress", {
          dependsOn: ["a"],
          attempts: 2,
          lease: { holder: "mate-1", expiresAt: 9_000 },
        }),
      ]),
    );
    expect(state.ok).toBe(true);
    expect(state.version).toBe(2);
    expect(state.tasks[0]).toMatchObject({
      id: "a",
      title: "a title",
      status: "completed",
      holder: null,
    });
    expect(state.tasks[1]).toMatchObject({
      id: "b",
      status: "in_progress",
      dependsOn: ["a"],
      attempts: 2,
      holder: "mate-1",
      leaseExpiresAt: 9000,
    });
  });

  it("accepts a pre-parsed object as well as a JSON string", () => {
    const obj = JSON.parse(snap([task("a", "pending")]));
    expect(parseTeamState(obj).ok).toBe(true);
  });

  it("fails cleanly on non-JSON, non-object, and a wrong-shape file", () => {
    expect(parseTeamState("{bad").ok).toBe(false);
    expect(parseTeamState(null).ok).toBe(false);
    expect(parseTeamState(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(parseTeamState("{bad").error).toMatch(/not JSON/);
  });

  it("tolerates missing metadata / fields without throwing", () => {
    const state = parseTeamState(
      snap([{ id: "x", status: "pending" }]), // no metadata, no title
    );
    expect(state.ok).toBe(true);
    expect(state.tasks[0]).toMatchObject({
      id: "x",
      title: "x",
      dependsOn: [],
      holder: null,
      attempts: 0,
    });
  });

  it("exposes v6 state identity and fail-closed adjudication metadata", () => {
    const state = parseTeamState(
      snap(
        [
          task("ambiguous", "cancelled", {
            lastError: "worker disappeared",
            adjudication: {
              required: true,
              code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
              reason: "unknown external effect",
              evidenceDigest: SIDE_EFFECT_DIGEST,
              requestedAt: 12_345,
              case: {
                caseId: "case-1",
                registryDigest: `sha256:${"b".repeat(64)}`,
                sideEffectDigest: SIDE_EFFECT_DIGEST,
              },
              decision: null,
            },
          }),
          task("accepted", "completed", {
            adjudication: {
              required: false,
              decision: {
                id: "decision-1",
                action: "accept",
                actor: "vscode",
                reason: "verified externally",
                decidedAt: 13_000,
              },
            },
          }),
        ],
        { version: 6, stateId: "state-6" },
      ),
    );

    expect(state).toMatchObject({
      ok: true,
      version: 6,
      stateId: "state-6",
    });
    expect(state.tasks[0]).toMatchObject({
      key: "ambiguous",
      lastError: "worker disappeared",
      adjudication: {
        required: true,
        code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
        reason: "unknown external effect",
        evidenceDigest: SIDE_EFFECT_DIGEST,
        requestedAt: 12_345,
        case: {
          caseId: "case-1",
          registryDigest: `sha256:${"b".repeat(64)}`,
          sideEffectDigest: SIDE_EFFECT_DIGEST,
        },
        decision: null,
      },
    });
    expect(state.tasks[1].adjudication.decision).toMatchObject({
      id: "decision-1",
      action: "accept",
      actor: "vscode",
      reason: "verified externally",
      decidedAt: 13_000,
    });
    expect(summarizeTeam(state).adjudicationRequired).toBe(1);
  });

  it("matches the CLI attempt/case digests and changes on lease reacquire", () => {
    const first = parseTeamState(
      snap(
        [
          task("running", "in_progress", {
            lease: {
              holder: "mate-1",
              leaseId: "lease-epoch:1",
              expiresAt: 10_000,
            },
          }),
          task("ambiguous", "cancelled", {
            adjudication: {
              required: true,
              case: {
                caseId: "case-1",
                sideEffectDigest: SIDE_EFFECT_DIGEST,
              },
            },
          }),
        ],
        { version: 6, stateId: "state-6" },
      ),
    );
    const running = first.tasks.find((item) => item.key === "running");
    const ambiguous = first.tasks.find((item) => item.key === "ambiguous");

    expect(running).toMatchObject({
      leaseId: "lease-epoch:1",
      fencingToken: "lease-epoch:1",
      attemptDigest: computeTeamControlAttemptDigest({
        holder: "mate-1",
        leaseId: "lease-epoch:1",
        fencingToken: "lease-epoch:1",
      }),
    });
    expect(ambiguous.adjudicationDigest).toBe(
      computeTeamControlAdjudicationDigest({
        caseId: "case-1",
        evidenceDigest: SIDE_EFFECT_DIGEST,
      }),
    );

    const reacquired = parseTeamState(
      snap(
        [
          task("running", "in_progress", {
            lease: {
              holder: "mate-1",
              leaseId: "lease-epoch:2",
              fencingToken: 2,
              expiresAt: 20_000,
            },
          }),
        ],
        { version: 6, stateId: "state-6" },
      ),
    );
    expect(reacquired.stateId).toBe(first.stateId);
    expect(reacquired.tasks[0].attemptDigest).not.toBe(running.attemptDigest);
    expect(reacquired.tasks[0].attemptDigest).toBe(
      computeTeamControlAttemptDigest({
        holder: "mate-1",
        leaseId: "lease-epoch:2",
        fencingToken: 2,
      }),
    );
  });

  it("fails closed when a control binding is incomplete or malformed", () => {
    const state = parseTeamState(
      snap(
        [
          task("running", "in_progress", {
            lease: { holder: "mate-1", expiresAt: 10_000 },
          }),
          task("ambiguous", "cancelled", {
            adjudication: {
              required: true,
              case: {
                caseId: "case-1",
                sideEffectDigest: "sha256:not-a-real-digest",
              },
            },
          }),
          task("unbound", "cancelled", {
            adjudication: {
              required: true,
              case: { sideEffectDigest: SIDE_EFFECT_DIGEST },
            },
          }),
        ],
        { version: 6, stateId: "state-6" },
      ),
    );
    expect(state.tasks[0].attemptDigest).toBeNull();
    expect(state.tasks[1].adjudicationDigest).toBeNull();
    expect(state.tasks[2].adjudicationDigest).toBeNull();
  });

  it("recognizes distributed queue authority, exact fences, and checkpoint recovery", () => {
    const state = parseTeamState({
      schemaVersion: 1,
      queueId: "queue-1",
      revision: 17,
      authorityDigest: AUTHORITY_DIGEST,
      authority: {
        repoRoot: "C:/repo with spaces",
        runId: "run-1",
        mode: "agent-worktree",
      },
      registry: {
        tasks: {
          tasks: [
            task("running", "in_progress", {
              lease: {
                holder: "worker-1:agent",
                leaseId: "lease-1",
                fencingToken: 7,
                expiresAt: 20_000,
              },
              interruption: {
                requestId: "request-1",
                actor: "operator",
                reason: "take over",
                requestedAt: 15_000,
                evidenceDigest: SIDE_EFFECT_DIGEST,
              },
            }),
            task("recovery", "cancelled", {
              adjudication: {
                required: true,
                code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
                evidenceDigest: SIDE_EFFECT_DIGEST,
              },
              workspaceExecution: {
                phase: "rollback-recovery-required",
                workerId: "worker-2",
                worktree: {
                  branch: "cc/team/run-1/recovery",
                  path: "C:/worktree",
                  baselineCommitOid: "d".repeat(40),
                },
                checkpoint: {
                  transactionId: "tx-1",
                  checkpointId: "checkpoint-1",
                  state: "rollback_failed",
                  coverage: "partial",
                  fileCoverage: "full",
                  recoveryRequired: true,
                },
              },
            }),
          ],
        },
      },
      budget: { limits: {}, totals: {} },
    });

    expect(state).toMatchObject({
      ok: true,
      stateKind: "distributed-queue",
      distributed: true,
      schemaVersion: 1,
      queueId: "queue-1",
      revision: 17,
      authorityDigest: AUTHORITY_DIGEST,
      authority: {
        repoRoot: "C:/repo with spaces",
        runId: "run-1",
        mode: "agent-worktree",
      },
    });
    expect(state.tasks[0]).toMatchObject({
      key: "running",
      holder: "worker-1:agent",
      leaseId: "lease-1",
      fencingToken: 7,
      interruption: {
        requestId: "request-1",
        evidenceDigest: SIDE_EFFECT_DIGEST,
      },
    });
    expect(state.tasks[1]).toMatchObject({
      evidenceDigest: SIDE_EFFECT_DIGEST,
      checkpointRecoveryRequired: true,
      workspaceExecution: {
        phase: "rollback-recovery-required",
        checkpoint: {
          transactionId: "tx-1",
          state: "rollback_failed",
          recoveryRequired: true,
        },
      },
    });
  });

  it("fails closed on malformed distributed authority or fencing tokens", () => {
    const malformed = {
      schemaVersion: 1,
      queueId: "queue-1",
      authorityDigest: "sha256:not-valid",
      authority: { repoRoot: "C:/repo", runId: "run-1" },
      registry: { tasks: { tasks: [] } },
    };
    expect(parseTeamState(malformed)).toMatchObject({ ok: false });

    malformed.authorityDigest = AUTHORITY_DIGEST;
    malformed.registry.tasks.tasks = [
      task("running", "in_progress", {
        lease: {
          holder: "worker-1",
          leaseId: "lease-1",
          fencingToken: "7",
        },
      }),
    ];
    const parsed = parseTeamState(malformed);
    expect(parsed.ok).toBe(true);
    expect(parsed.tasks[0].fencingToken).toBeNull();
  });
});

describe("summarizeTeam", () => {
  const state = parseTeamState(
    snap([
      task("a", "completed"),
      task("b", "completed"),
      task("c", "in_progress", { lease: { holder: "m1", expiresAt: 10_000 } }),
      task("d", "in_progress", { lease: { holder: "m2", expiresAt: 1_000 } }), // expired
      task("e", "blocked"),
      task("f", "pending"),
    ]),
  );

  it("counts per status, live vs stale leases, and done%", () => {
    const s = summarizeTeam(state, { now: 5_000 });
    expect(s.total).toBe(6);
    expect(s.counts).toMatchObject({
      completed: 2,
      in_progress: 2,
      blocked: 1,
      pending: 1,
    });
    expect(s.active).toBe(1); // c's lease is live at now=5000
    expect(s.stale).toBe(1); // d's lease expired at 1000
    expect(s.adjudicationRequired).toBe(0);
    expect(s.donePct).toBe(33); // 2/6
  });

  it("is empty-safe (no tasks → zero counts, 0%)", () => {
    const s = summarizeTeam({ tasks: [] });
    expect(s.total).toBe(0);
    expect(s.donePct).toBe(0);
    for (const st of TEAM_STATUSES) expect(s.counts[st]).toBe(0);
  });
});
