import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import OrganizationProjectRiskPanel from "../OrganizationProjectRiskPanel.vue";
import OrganizationProjectWorkbench from "../OrganizationProjectWorkbench.vue";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("../../../../main/task/__tests__/fixtures/organization-project-host-fixture.cjs");
const riskPermissions = ["risk.read", "risk.evaluate", "risk.feedback"];
describe("organization risk UI with real host and SQLite", () => {
  let f: any,
    api: any,
    dialog: any,
    configuration: any,
    wrapper: VueWrapper<any>;
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog);
    vi.spyOn(Date, "now").mockImplementation(() => f.getNow());
    configuration = await f.setup();
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    await grant();
    f.setActor(f.identities.requester);
    dialog.mockClear();
    api = Object.fromEntries(
      Object.keys(f.host).map((method) => [
        method,
        vi.fn(async (input: unknown) =>
          structuredClone(
            await f.host[method](f.event, structuredClone(input)),
          ),
        ),
      ]),
    );
    (window as any).electronAPI = { organizationProject: api };
  });
  afterEach(() => {
    wrapper?.unmount();
    f.db.close();
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });
  async function grant(
    transform = (permissions: string[], _actor: string) => permissions,
  ) {
    f.setActor(f.identities.owner);
    const policy = {
      orgId: "org1",
      workflowIds: configuration.workflowIds,
      permissions: configuration.permissions.map((item: any) => ({
        ...item,
        permissions: transform(
          [...item.permissions, ...riskPermissions],
          item.actorDid,
        ),
      })),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
  }
  async function panel(permissions = riskPermissions) {
    wrapper = mount(OrganizationProjectRiskPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions,
      },
    });
    await flushPromises();
  }
  async function workbench() {
    wrapper = mount(OrganizationProjectWorkbench, {
      props: { open: true, projectId: "p1", identityKey: f.getActor() },
      global: {
        stubs: {
          "a-drawer": {
            props: ["open"],
            template: '<div v-if="open"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();
  }
  async function click(testId: string) {
    await wrapper.get(`[data-testid="${testId}"]`).trigger("click");
    await flushPromises();
  }
  async function evaluate() {
    await click("organization-risk-evaluate");
    return f.db
      .prepare(
        "SELECT id FROM cc_organization_project_risk_reviews ORDER BY rowid DESC LIMIT 1",
      )
      .get().id;
  }
  async function feedback(comment = "Reviewed by member") {
    await wrapper
      .get('[data-testid="organization-risk-feedback-task"]')
      .setValue("t1");
    await wrapper
      .get('[data-testid="organization-risk-feedback-comment"]')
      .setValue(comment);
    await wrapper
      .get('[data-testid="organization-risk-feedback"]')
      .trigger("submit");
    await flushPromises();
  }
  it("evaluates overdue tasks and emits only display facts with actor attribution", async () => {
    await panel();
    await evaluate();
    expect(wrapper.text()).toContain("逾期");
    expect(wrapper.text()).toContain("did:requester");
    expect(wrapper.text()).toContain("模型费用：未知");
    const value = wrapper.emitted("review")!.at(-1)![0] as any;
    expect(Object.keys(value).sort()).toEqual(["evaluation", "review"]);
    expect(value.evaluation.projectRef.scope).toEqual({
      kind: "organization",
      id: "org1",
    });
    expect(JSON.stringify(value)).not.toContain("Original task");
    expect(api.evaluateRisk).toHaveBeenCalledWith({ projectId: "p1" });
  });
  it("serves risk-only members without loading task descriptions or proposals", async () => {
    await grant((permissions, actor) =>
      actor === f.identities.requester ? riskPermissions : permissions,
    );
    f.setActor(f.identities.requester);
    await workbench();
    expect(
      wrapper.find('[data-testid="organization-risk-panel"]').exists(),
    ).toBe(true);
    await evaluate();
    expect(wrapper.text()).not.toContain("Original task");
    expect(
      wrapper.find('[data-testid="organization-description"]').exists(),
    ).toBe(false);
    expect(api.listTasks).not.toHaveBeenCalled();
    expect(api.readTask).not.toHaveBeenCalled();
    expect(api.listProposals).not.toHaveBeenCalled();
  });
  it("does not offer risk to a member whose grants only cover tasks", async () => {
    await grant((permissions, actor) =>
      actor === f.identities.requester
        ? permissions.filter((p) => !p.startsWith("risk."))
        : permissions,
    );
    f.setActor(f.identities.requester);
    await workbench();
    expect(
      wrapper.find('[data-testid="organization-risk-panel"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).toContain("Original task");
    expect(api.evaluateRisk).not.toHaveBeenCalled();
  });
  it("allows independent read history with no evaluate or feedback affordances", async () => {
    const result = f.host.evaluateRisk(f.event, { projectId: "p1" });
    await grant((permissions, actor) =>
      actor === f.identities.first ? ["risk.read"] : permissions,
    );
    f.setActor(f.identities.first);
    await panel(["risk.read"]);
    expect(
      wrapper.find('[data-testid="organization-risk-evaluate"]').exists(),
    ).toBe(false);
    await click("organization-risk-history");
    await wrapper
      .get(`[data-risk-review-id="${result.review.id}"]`)
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("did:requester");
    expect(
      wrapper.find('[data-testid="organization-risk-feedback"]').exists(),
    ).toBe(false);
    expect(api.getRiskReview).toHaveBeenCalledWith({
      reviewId: result.review.id,
    });
  });
  it("shares manual feedback across authorized members and preserves original rule facts", async () => {
    await panel();
    const id = await evaluate();
    await feedback();
    f.setActor(f.identities.first);
    await wrapper.setProps({ identityKey: f.getActor() });
    await click("organization-risk-history");
    await wrapper.get(`[data-risk-review-id="${id}"]`).trigger("click");
    await flushPromises();
    await click("organization-risk-lineage");
    expect(wrapper.text()).toContain("Reviewed by member");
    expect(
      wrapper.get('[data-testid="organization-risk-result"]').text(),
    ).toContain("逾期");
    expect(
      f.db
        .prepare("SELECT actor_did FROM cc_organization_project_risk_feedback")
        .get().actor_did,
    ).toBe(f.identities.requester);
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it("leaves cancelled feedback unwritten and permits an explicit new confirmation", async () => {
    await panel();
    await evaluate();
    dialog.mockResolvedValueOnce({ response: 0 });
    await feedback("Cancelled judgment");
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_feedback",
        )
        .get().n,
    ).toBe(0);
    expect(wrapper.text()).not.toContain("结果待核实");
    await wrapper
      .get('[data-testid="organization-risk-feedback"]')
      .trigger("submit");
    await flushPromises();
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_feedback",
        )
        .get().n,
    ).toBe(1);
    expect(api.recordRiskFeedback).toHaveBeenCalledTimes(2);
  });
  it("records a dismissed manual judgment without rewriting overdue signals", async () => {
    await panel();
    await evaluate();
    await wrapper
      .get('[data-testid="organization-risk-feedback-verdict"]')
      .setValue("dismissed");
    await feedback("Deadline accepted by owner");
    expect(api.recordRiskFeedback.mock.calls.at(-1)[0]).toMatchObject({
      verdict: "dismissed",
      reasonCodes: [],
    });
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_feedback",
        )
        .get().n,
    ).toBe(1);
    await click("organization-risk-lineage");
    expect(wrapper.text()).toContain("排除规则信号");
    expect(
      wrapper.get('[data-testid="organization-risk-result"]').text(),
    ).toContain("逾期");
  });
  it("does not repeat feedback after a persisted write loses its reply", async () => {
    await panel();
    await evaluate();
    api.recordRiskFeedback.mockImplementationOnce(async (input: any) => {
      await f.host.recordRiskFeedback(f.event, input);
      throw new Error("IPC reply lost");
    });
    await feedback();
    expect(wrapper.text()).toContain("核对保存结果待核实");
    await click("organization-risk-lineage");
    expect(wrapper.text()).toContain("Reviewed by member");
    await wrapper
      .get('[data-testid="organization-risk-feedback"]')
      .trigger("submit");
    await flushPromises();
    expect(api.recordRiskFeedback).toHaveBeenCalledTimes(1);
    expect(
      wrapper
        .get('[data-testid="organization-risk-feedback-save"]')
        .attributes("disabled"),
    ).toBeDefined();
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_feedback",
        )
        .get().n,
    ).toBe(1);
  });
  it("enforces the UTF-8 feedback budget before native confirmation", async () => {
    await panel();
    await evaluate();
    await feedback("中".repeat(1366));
    expect(api.recordRiskFeedback).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
  });
  it("does not inherit another member's uncertain feedback state", async () => {
    await panel();
    const id = await evaluate();
    api.recordRiskFeedback.mockRejectedValueOnce(new Error("IPC unavailable"));
    await feedback();
    expect(wrapper.text()).toContain("核对保存结果待核实");
    f.setActor(f.identities.first);
    await wrapper.setProps({ identityKey: f.getActor() });
    await click("organization-risk-history");
    await wrapper.get(`[data-risk-review-id="${id}"]`).trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("核对保存结果待核实");
    await feedback("Independent member review");
    expect(
      f.db
        .prepare("SELECT actor_did FROM cc_organization_project_risk_feedback")
        .get().actor_did,
    ).toBe(f.identities.first);
  });
  it.each(["schema", "dependency"])(
    "shows insufficient data for invalid %s rather than a clean result",
    async (failure) => {
      if (failure === "schema")
        f.db.exec("ALTER TABLE project_tasks DROP COLUMN blocked_by");
      else f.db.prepare("UPDATE project_tasks SET blocked_by='not-json'").run();
      await panel();
      await evaluate();
      expect(wrapper.text()).toContain("数据不足");
      expect(wrapper.text()).not.toContain("未发现所选规则信号");
      expect(
        wrapper.find('[data-testid="organization-risk-feedback"]').exists(),
      ).toBe(false);
    },
  );
  it.each(["project", "organization"])(
    "clears facts when a reply belongs to another %s",
    async (scope) => {
      await panel();
      await evaluate();
      await wrapper
        .get('[data-testid="organization-risk-feedback-comment"]')
        .setValue("private draft");
      api.evaluateRisk.mockImplementationOnce(async (input: any) => {
        const result = structuredClone(f.host.evaluateRisk(f.event, input));
        if (scope === "project") result.review.projectId = "other-project";
        else result.authority.scope.id = "other-org";
        return result;
      });
      await click("organization-risk-evaluate");
      expect(
        wrapper.find('[data-testid="organization-risk-result"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain("private draft");
      expect(wrapper.emitted("authority-error")).toHaveLength(1);
      expect(wrapper.emitted("review")!.at(-1)).toEqual([null]);
    },
  );
  it("clears risk and feedback drafts after current member revocation", async () => {
    await panel();
    await evaluate();
    await wrapper
      .get('[data-testid="organization-risk-feedback-comment"]')
      .setValue("private draft");
    f.db
      .prepare(
        "UPDATE organization_members SET status='inactive' WHERE member_did=?",
      )
      .run(f.identities.requester);
    await click("organization-risk-lineage");
    expect(
      wrapper.find('[data-testid="organization-risk-result"]').exists(),
    ).toBe(false);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it.each(["identity", "project", "permissions"])(
    "drops delayed evaluation after %s changes",
    async (change) => {
      await panel();
      let resolve!: (value: any) => void;
      const saved = structuredClone(
        f.host.evaluateRisk(f.event, { projectId: "p1" }),
      );
      api.evaluateRisk.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      await wrapper
        .get('[data-testid="organization-risk-evaluate"]')
        .trigger("click");
      await wrapper.setProps(
        change === "identity"
          ? { identityKey: "another-login" }
          : change === "project"
            ? { projectId: "p2" }
            : { permissions: [] },
      );
      resolve(saved);
      await flushPromises();
      expect(
        wrapper.find('[data-testid="organization-risk-result"]').exists(),
      ).toBe(false);
      expect(wrapper.emitted("review")!.at(-1)).toEqual([null]);
    },
  );
  it("drops delayed lineage after identity change and never restores old comments", async () => {
    await panel();
    const id = await evaluate();
    await feedback("old member feedback");
    const saved = structuredClone(
      f.host.getRiskLineage(f.event, { reviewId: id, limit: 10 }),
    );
    let resolve!: (value: any) => void;
    api.getRiskLineage.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await wrapper
      .get('[data-testid="organization-risk-lineage"]')
      .trigger("click");
    await wrapper.setProps({ identityKey: "new-login" });
    resolve(saved);
    await flushPromises();
    expect(wrapper.text()).not.toContain("old member feedback");
  });
  it("pages shared history without dropping earlier records", async () => {
    for (let i = 0; i < 12; i++)
      f.host.evaluateRisk(f.event, { projectId: "p1" });
    await panel();
    await click("organization-risk-history");
    expect(wrapper.findAll("[data-risk-review-id]")).toHaveLength(10);
    await click("organization-risk-more");
    expect(wrapper.findAll("[data-risk-review-id]")).toHaveLength(12);
    expect(
      wrapper.find('[data-testid="organization-risk-more"]').exists(),
    ).toBe(false);
  });
  it.each([false, true])(
    "binds risk through preview, two approvals, real %s action and lineage",
    async (create) => {
      await workbench();
      const reviewId = await evaluate();
      if (create)
        await wrapper.get('[data-testid="proposal-kind"]').setValue("create");
      else {
        await wrapper.get('[data-task-id="t1"]').trigger("click");
        await flushPromises();
      }
      await wrapper
        .get('[data-testid="organization-description"]')
        .setValue("Risk-linked action");
      await wrapper
        .get('[data-testid="link-organization-risk"]')
        .setValue(true);
      await click("preview-organization-proposal");
      const method = create ? api.previewCreate : api.previewDescription;
      expect(method.mock.calls.at(-1)[0].reviewId).toBe(reviewId);
      await click("submit-organization-proposal");
      const id = f.db
        .prepare(
          "SELECT id FROM cc_organization_project_proposals ORDER BY rowid DESC LIMIT 1",
        )
        .get().id;
      for (const actor of [f.identities.first, f.identities.second]) {
        f.setActor(actor);
        await wrapper.setProps({ identityKey: actor });
        await flushPromises();
        await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
        await flushPromises();
        await click("view-proposal-risk");
        expect(
          wrapper.get('[data-testid="organization-risk-result"]').text(),
        ).toContain(reviewId);
        await click("approve-organization-proposal");
      }
      f.setActor(f.identities.requester);
      await wrapper.setProps({ identityKey: f.getActor() });
      await flushPromises();
      await wrapper.get(`[data-proposal-id="${id}"]`).trigger("click");
      await flushPromises();
      await click("execute-organization-proposal");
      expect(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM project_tasks WHERE description='Risk-linked action'",
          )
          .get().n,
      ).toBe(1);
      expect(
        wrapper.get('[data-testid="organization-action-receipt"]').text(),
      ).toContain("完成");
      await click("view-proposal-risk");
      await click("organization-risk-lineage");
      expect(
        wrapper.get('[data-testid="organization-risk-lineage-result"]').text(),
      ).toContain("完成");
      expect(dialog).toHaveBeenCalledTimes(3);
      expect(dialog.mock.calls[0][1].detail).toContain("风险来源时间");
    },
  );
  it("invalidates preview if the selected risk association changes", async () => {
    await workbench();
    await evaluate();
    await wrapper.get('[data-task-id="t1"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-description"]')
      .setValue("New description");
    await click("preview-organization-proposal");
    expect(
      wrapper.find('[data-testid="organization-proposal-preview"]').exists(),
    ).toBe(true);
    await wrapper.get('[data-testid="link-organization-risk"]').setValue(true);
    expect(
      wrapper.find('[data-testid="organization-proposal-preview"]').exists(),
    ).toBe(false);
  });
  it("treats stale risk submission as a definite rejection with a fresh-intent recovery", async () => {
    await workbench();
    await evaluate();
    await wrapper.get('[data-task-id="t1"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-description"]')
      .setValue("New description");
    await wrapper.get('[data-testid="link-organization-risk"]').setValue(true);
    await click("preview-organization-proposal");
    f.db.prepare("UPDATE project_tasks SET due_date=2 WHERE id='t1'").run();
    await click("submit-organization-proposal");
    expect(wrapper.text()).not.toContain("提交结果待核实");
    expect(
      wrapper.find('[data-testid="new-organization-intent"]').exists(),
    ).toBe(true);
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_proposals")
        .get().n,
    ).toBe(0);
    expect(
      f.db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Original task");
  });
  it("drops an old preview when a concurrent risk evaluation changes the selected association", async () => {
    await workbench();
    const oldReviewId = await evaluate();
    await wrapper.get('[data-task-id="t1"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-description"]')
      .setValue("New description");
    await wrapper.get('[data-testid="link-organization-risk"]').setValue(true);
    let resolveRisk!: (value: any) => void,
      resolvePreview!: (value: any) => void;
    const newReview = structuredClone(
      f.host.evaluateRisk(f.event, { projectId: "p1" }),
    );
    api.evaluateRisk.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRisk = resolve;
        }),
    );
    api.previewDescription.mockImplementationOnce((input: any) => {
      expect(input.reviewId).toBe(oldReviewId);
      const saved = structuredClone(f.host.previewDescription(f.event, input));
      return new Promise((resolve) => {
        resolvePreview = () => resolve(saved);
      });
    });
    await wrapper
      .get('[data-testid="organization-risk-evaluate"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="preview-organization-proposal"]')
      .trigger("click");
    resolveRisk(newReview);
    await flushPromises();
    resolvePreview(null);
    await flushPromises();
    expect(
      wrapper.get('[data-testid="organization-risk-result"]').text(),
    ).toContain(newReview.review.id);
    expect(
      wrapper.find('[data-testid="organization-proposal-preview"]').exists(),
    ).toBe(false);
    expect(
      (
        wrapper.get('[data-testid="link-organization-risk"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
  });
});
