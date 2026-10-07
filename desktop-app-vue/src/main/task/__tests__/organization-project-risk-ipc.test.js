import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");

describe("organization risk IPC with real SQLite authority and native confirmation", () => {
  const reader = "did:risk-reader",
    evaluator = "did:risk-evaluator";
  let f, dialog, workflowIds, permissions;

  async function attest() {
    f.setActor(f.identities.owner);
    const policy = { orgId: "org1", permissions, workflowIds };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
  }
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog);
    ({ workflowIds, permissions } = await f.setup());
    for (const [index, did] of [reader, evaluator].entries())
      f.db
        .prepare(
          "INSERT INTO organization_members VALUES(?,'org1',?,'member','active',?)",
        )
        .run(`risk-member-${index}`, did, `Risk member ${index}`);
    for (const grant of permissions) {
      grant.permissions.push("risk.read");
      if ([f.identities.owner, f.identities.requester].includes(grant.actorDid))
        grant.permissions.push("risk.evaluate", "risk.feedback");
      if (grant.actorDid === f.identities.first)
        grant.permissions.push("risk.feedback");
    }
    permissions.push(
      {
        actorDid: reader,
        projectId: "p1",
        permissions: ["risk.read"],
        expiresAt: 100000000,
      },
      {
        actorDid: evaluator,
        projectId: "p1",
        permissions: ["risk.read", "risk.evaluate"],
        expiresAt: 100000000,
      },
    );
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    await attest();
    dialog.mockClear();
  });
  afterEach(() => f.db.close());

  const evaluate = () => f.host.evaluateRisk(f.event, { projectId: "p1" });
  const lineage = (reviewId) => f.host.getRiskLineage(f.event, { reviewId });
  const feedbackInput = (reviewId, extra = {}) => ({
    reviewId,
    taskId: "t1",
    verdict: "affirmed",
    reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
    comment: "Reviewed with the team",
    ...extra,
  });
  const feedback = (reviewId, extra) =>
    f.host.recordRiskFeedback(f.event, feedbackInput(reviewId, extra));
  const feedbackCount = () =>
    f.db
      .prepare(
        "SELECT count(*) AS n FROM cc_organization_project_risk_feedback",
      )
      .get().n;
  const body = () =>
    f.db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
      .description;

  function proposal(reviewId, create = false, key = "risk-proposal") {
    const preview = create
      ? f.host.previewCreate(f.event, {
          projectId: "p1",
          taskType: "query_info",
          description: "Risk follow-up task",
          idempotencyKey: key,
          reviewId,
        })
      : f.host.previewDescription(f.event, {
          taskId: "t1",
          description: "Risk-reviewed description",
          idempotencyKey: key,
          reviewId,
        });
    return f.host.submitProposal(f.event, {
      projectId: "p1",
      workflowId: workflowIds[create ? 1 : 0],
      request: preview.request,
    });
  }
  async function approve(p) {
    for (const [step, actor] of [
      f.identities.first,
      f.identities.second,
    ].entries()) {
      f.setActor(actor);
      await f.host.respondProposal(f.event, {
        proposalId: p.proposalId,
        step,
        decision: "approve",
      });
    }
    f.setActor(f.identities.requester);
  }

  it("allows risk-only readers and evaluators without granting task or feedback access", async () => {
    const review = evaluate();
    f.setActor(reader);
    expect(f.host.context(f.event, { projectId: "p1" })).toMatchObject({
      mode: "organization",
      permissions: ["risk.read"],
      canManage: false,
    });
    expect(
      f.host.getRiskReview(f.event, { reviewId: review.review.id }),
    ).toEqual(review);
    expect(
      f.host
        .listRiskReviews(f.event, { projectId: "p1" })
        .reviews.map((item) => item.review.id),
    ).toEqual([review.review.id]);
    expect(lineage(review.review.id).actionRuns).toEqual([]);
    expect(() => f.host.readTask(f.event, { taskId: "t1" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => f.host.listTasks(f.event, { projectId: "p1" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => evaluate()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    await expect(feedback(review.review.id)).rejects.toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    f.setActor(evaluator);
    expect(evaluate()).toMatchObject({
      review: { actorDid: evaluator },
      sourceSnapshot: { scope: { kind: "organization", id: "org1" } },
    });
    expect(dialog).not.toHaveBeenCalled();
  });

  it("shares creator attribution and append-only human feedback across current members", async () => {
    const review = evaluate();
    f.setActor(f.identities.first);
    const saved = await feedback(review.review.id);
    expect(saved.feedback.actorDid).toBe(f.identities.first);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][0]).toBe(f.parent);
    expect(dialog.mock.calls[0][1]).toMatchObject({
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    for (const text of [
      review.review.id,
      "t1",
      "affirmed",
      "OVERDUE_INCOMPLETE_TASK",
      "Reviewed with the team",
    ])
      expect(dialog.mock.calls[0][1].detail).toContain(text);
    f.setActor(reader);
    expect(lineage(review.review.id)).toMatchObject({
      review: { actorDid: f.identities.requester },
      evaluation: review.evaluation,
      feedback: [saved],
    });
    expect(body()).toBe("Original task");
    await attest();
    dialog.mockClear();
    expect(
      f.host.getRiskReview(f.event, { reviewId: review.review.id }),
    ).toEqual(review);
    await feedback(review.review.id, { verdict: "dismissed", reasonCodes: [] });
    f.setActor(reader);
    expect(lineage(review.review.id).feedback).toHaveLength(2);
    expect(lineage(review.review.id).evaluation).toEqual(review.evaluation);
  });

  it.each([false, true])(
    "carries risk references through separate reviewers, execution, and shared lineage (create=%s)",
    async (create) => {
      const review = evaluate(),
        p = proposal(review.review.id, create);
      const proposed = f.host.readProposal(f.event, {
        proposalId: p.proposalId,
      });
      expect(proposed.request.input.riskReview.id).toBe(review.review.id);
      await approve(p);
      expect(
        f.host.readProposal(f.event, { proposalId: p.proposalId }).canExecute,
      ).toBe(true);
      const result = await f.host.executeProposal(f.event, {
        proposalId: p.proposalId,
      });
      expect(result.run.status).toBe("succeeded");
      expect(dialog).toHaveBeenCalledTimes(3);
      for (const call of dialog.mock.calls) {
        expect(call[1].detail).toContain(review.review.id);
        expect(call[1].detail).toContain(
          proposed.request.input.riskReview.contentDigest,
        );
      }
      const execution = result.evidence.find(
        (item) =>
          item.kind ===
          (create ? "sqlite-task-create" : "sqlite-task-description-update"),
      );
      expect(execution.organizationApproval).toMatchObject({
        approvalId: p.approvalId,
        runId: result.run.id,
      });
      expect(
        f.db
          .prepare(
            "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
          )
          .get(p.approvalId).consumed_run_id,
      ).toBe(result.run.id);
      if (create) {
        expect(
          f.db
            .prepare("SELECT description,status FROM project_tasks WHERE id=?")
            .get(execution.createdTaskRef.id),
        ).toEqual({ description: "Risk follow-up task", status: "pending" });
      } else expect(body()).toBe("Risk-reviewed description");
      const replay = await f.host.executeProposal(f.event, {
        proposalId: p.proposalId,
      });
      expect(replay.replayed).toBe(true);
      expect(dialog).toHaveBeenCalledTimes(3);
      f.setActor(reader);
      expect(lineage(review.review.id).actionRuns).toEqual([
        { run: result.run, evidence: result.evidence },
      ]);
    },
  );

  it("records nothing when the native feedback confirmation is cancelled", async () => {
    const review = evaluate();
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(await feedback(review.review.id)).toEqual({ status: "cancelled" });
    expect(feedbackCount()).toBe(0);
    expect(body()).toBe("Original task");
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "identity switch",
      "ORG_AUTH_IDENTITY_CHANGED",
      () => f.setActor(f.identities.first),
    ],
    [
      "same-identity reauthentication",
      "ORG_AUTH_IDENTITY_CHANGED",
      () => f.setActor(f.identities.requester),
    ],
    [
      "main-frame navigation and restoration",
      "ORG_AUTH_WINDOW_UNAVAILABLE",
      () =>
        f.event.sender.emit(
          "did-start-navigation",
          {},
          "http://localhost:5173/other",
          false,
          true,
        ),
    ],
    [
      "frame replacement",
      "ORG_AUTH_WINDOW_UNAVAILABLE",
      () => {
        f.event.senderFrame = { ...f.event.senderFrame };
        f.event.sender.mainFrame = f.event.senderFrame;
      },
    ],
    [
      "sender trust revocation",
      "ORG_AUTH_UNTRUSTED_SENDER",
      () => f.setTrusted(false),
    ],
    [
      "member revocation",
      "ORG_AUTH_POLICY_STALE",
      () =>
        f.db
          .prepare(
            "UPDATE organization_members SET status='removed' WHERE member_did=?",
          )
          .run(f.identities.requester),
    ],
  ])(
    "rejects feedback after %s while the native dialog is open",
    async (_label, code, change) => {
      const review = evaluate();
      dialog.mockImplementationOnce(async () => {
        change();
        return { response: 1 };
      });
      await expect(feedback(review.review.id)).rejects.toThrow(code);
      expect(feedbackCount()).toBe(0);
      expect(dialog).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["unknown task", { taskId: "missing" }],
    ["oversized comment", { comment: "x".repeat(500000) }],
    ["UTF-8 comment budget", { comment: "界".repeat(1366) }],
    ["unsupported verdict", { verdict: "execute" }],
    [
      "unrecorded reason",
      { reasonCodes: ["BLOCKED_BY_INCOMPLETE_DEPENDENCY"] },
    ],
    [
      "duplicate reasons",
      { reasonCodes: ["OVERDUE_INCOMPLETE_TASK", "OVERDUE_INCOMPLETE_TASK"] },
    ],
    ["dismissal with reasons", { verdict: "dismissed" }],
    ["injected identity", { actorDid: "did:owner" }],
    ["injected authority", { expectedAuthority: {} }],
  ])(
    "rejects %s before showing native feedback confirmation",
    async (_name, extra) => {
      const review = evaluate();
      await expect(feedback(review.review.id, extra)).rejects.toThrow(
        /PROJECT_RISK_|ORG_AUTH_INVALID_REQUEST/,
      );
      expect(dialog).not.toHaveBeenCalled();
      expect(feedbackCount()).toBe(0);
    },
  );

  it("does not retry feedback when native confirmation rejects with an error", async () => {
    const review = evaluate();
    dialog.mockRejectedValueOnce(new Error("native dialog unavailable"));
    await expect(feedback(review.review.id)).rejects.toThrow(
      "native dialog unavailable",
    );
    await Promise.resolve();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(feedbackCount()).toBe(0);
  });

  it("reveals a single committed feedback entry after its IPC response is lost", async () => {
    const review = evaluate();
    const transport = vi.fn(async () => {
      await feedback(review.review.id);
      throw new Error("IPC response lost");
    });
    await expect(transport()).rejects.toThrow("IPC response lost");
    f.setActor(reader);
    expect(lineage(review.review.id).feedback).toHaveLength(1);
    expect(lineage(review.review.id).feedback[0].feedback.actorDid).toBe(
      f.identities.requester,
    );
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(feedbackCount()).toBe(1);
  });

  it("keeps a stale approved proposal readable and cancellable while refusing execution", async () => {
    const review = evaluate(),
      p = proposal(review.review.id);
    await approve(p);
    dialog.mockClear();
    f.db.prepare("UPDATE project_tasks SET due_date=2 WHERE id='t1'").run();
    const state = f.host.readProposal(f.event, { proposalId: p.proposalId });
    expect(state).toMatchObject({
      canExecute: false,
      canCancel: true,
      eligibilityReason: "ORG_AUTH_VERSION_CONFLICT",
    });
    await expect(
      f.host.executeProposal(f.event, { proposalId: p.proposalId }),
    ).rejects.toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(dialog).not.toHaveBeenCalled();
    expect(body()).toBe("Original task");
    expect(
      f.db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(p.approvalId).consumed_run_id,
    ).toBeNull();
    await f.host.cancelProposal(f.event, { proposalId: p.proposalId });
    expect(
      f.host.readProposal(f.event, { proposalId: p.proposalId }).approvalStatus,
    ).toBe("cancelled");
  });

  it("rejects a stale review before proposal admission and does not execute when freshness changes during confirmation", async () => {
    const review = evaluate();
    f.db.prepare("UPDATE project_tasks SET due_date=2 WHERE id='t1'").run();
    expect(() => proposal(review.review.id)).toThrow(
      "ORG_AUTH_VERSION_CONFLICT",
    );
    expect(dialog).not.toHaveBeenCalled();
    const fresh = evaluate(),
      p = proposal(fresh.review.id, false, "fresh-proposal");
    await approve(p);
    dialog.mockClear();
    dialog.mockImplementationOnce(async () => {
      f.db.prepare("UPDATE project_tasks SET due_date=3 WHERE id='t1'").run();
      return { response: 1 };
    });
    await expect(
      f.host.executeProposal(f.event, { proposalId: p.proposalId }),
    ).rejects.toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(body()).toBe("Original task");
    expect(
      f.host.readProposal(f.event, { proposalId: p.proposalId }),
    ).toMatchObject({ canExecute: false, canCancel: true });
    f.setActor(reader);
    expect(lineage(fresh.review.id).actionRuns[0].run.status).toBe("denied");
  });
});
