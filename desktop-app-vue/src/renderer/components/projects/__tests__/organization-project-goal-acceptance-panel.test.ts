import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AcceptancePanel from "../OrganizationProjectGoalAcceptancePanel.vue";
import GoalPanel from "../OrganizationProjectGoalPanel.vue";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("../../../../main/task/__tests__/fixtures/organization-project-host-fixture.cjs");
const {
  OrganizationProjectAuthority,
} = require("@chainlesschain/session-core/organization-project-authority");
const {
  OrganizationProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/organization-project-goal-monitoring");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const Database = require("better-sqlite3");
const goalPermissions = [
  "goal.read",
  "goal.create",
  "goal.update",
  "goal.check",
  "goal.accept",
  "goal.propose",
];
const permissions = [
  "task.read",
  "task.create",
  "task.update-description",
  ...goalPermissions,
  "risk.read",
  "risk.evaluate",
];
const taskCriterion = {
  id: "tasks-completed",
  kind: "business-assertion",
  description: "Project must be nonempty and every task completed",
};
const manualCriterion = {
  id: "member-accepted",
  kind: "manual",
  description: "A member verified the delivered business files",
};
describe("organization independent acceptance with Vue, current facts, actual members and native SQLite", () => {
  let f: any,
    api: any,
    dialog: any,
    directory: string,
    engine: any,
    store: any,
    goal: any,
    wrapper: VueWrapper<any>;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-acceptance-ui-"));
    engine = null;
    store = null;
    wrapper = undefined as any;
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog, {
      goalMonitoringController: {
        async initialize() {
          if (!engine) {
            store = openSchedulerStore({
              file: join(directory, "scheduler.sqlite"),
              Database,
              clock: f.getNow,
              protectStorage: () => true,
            });
            const authority = new OrganizationProjectAuthority({
              db: f.db,
              getActor: f.getActor,
              now: f.getNow,
              confirm: () => false,
            });
            engine = new OrganizationProjectGoalMonitoringEngine({
              db: f.db,
              getActor: f.getActor,
              authority,
              store,
              clock: f.getNow,
            });
          }
          return engine;
        },
        async close() {
          await engine?.close();
          store?.close();
        },
      },
    });
    vi.spyOn(Date, "now").mockImplementation(f.getNow);
    const configuration = await f.setup();
    const policy = {
      orgId: "org1",
      workflowIds: configuration.workflowIds,
      permissions: configuration.permissions.map((p: any) => ({
        ...p,
        permissions: [
          ...new Set([
            ...p.permissions,
            ...goalPermissions,
            "risk.read",
            "risk.evaluate",
          ]),
        ],
      })),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
    goal = (
      await f.host.createGoal(f.event, {
        projectId: "p1",
        requestId: "seed",
        objective: "Shared independently verified delivery",
        budgetPolicy: { maxRuns: 30 },
      })
    ).goal;
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
    dialog.mockClear();
  });
  afterEach(async () => {
    wrapper?.unmount();
    await f.host.close();
    f.db.close();
    rmSync(directory, { recursive: true, force: true });
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });
  async function configure(
    criteria = [taskCriterion, manualCriterion],
    assertions = [
      { criterionId: taskCriterion.id, type: "all-tasks-completed" },
    ],
  ) {
    goal = (
      await f.host.configureGoalAcceptance(f.event, {
        goalId: goal.id,
        expectedRevision: goal.revision,
        requestId: globalThis.crypto.randomUUID(),
        acceptanceCriteria: criteria,
        assertions,
      })
    ).goal;
  }
  async function panel(memberPermissions = permissions) {
    wrapper = mount(AcceptancePanel, {
      props: {
        goal,
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions: memberPermissions,
      },
    });
    await flushPromises();
  }
  async function click(id: string) {
    await wrapper.get(`[data-testid="${id}"]`).trigger("click");
    await flushPromises();
  }
  function doneTasks() {
    f.db
      .prepare(
        "UPDATE project_tasks SET status='completed',updated_at=11 WHERE id='t1'",
      )
      .run();
  }
  async function acknowledge() {
    await click("organization-acceptance-acknowledge");
  }
  it("requires native plan confirmation and shows typed conditions", async () => {
    await panel();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][1].detail).toContain("all-tasks-completed");
    expect(wrapper.emitted("changed")?.length).toBe(1);
    expect(f.host.getGoal(f.event, { id: goal.id }).revision).toBe(2);
  });
  it("keeps incomplete tasks separate from the native manual acknowledgement", async () => {
    await configure();
    await panel();
    await acknowledge();
    await click("organization-acceptance-complete");
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
    expect(wrapper.text()).toContain("仍有未完成任务");
    expect(wrapper.text()).toContain("did:requester");
    expect(api.completeGoal).toHaveBeenCalledTimes(1);
  });
  it("completes from fresh facts and a different authorized member, then shares the report", async () => {
    await configure();
    doneTasks();
    f.setActor(f.identities.first);
    await panel();
    await acknowledge();
    await click("organization-acceptance-complete");
    goal = f.host.getGoal(f.event, { id: goal.id });
    expect(goal.status).toBe("done");
    expect(goal.ownerRef).toBe(f.identities.requester);
    expect(dialog.mock.calls.at(-1)[1].detail).toContain(
      "Shared independently verified delivery",
    );
    expect(wrapper.emitted("changed")?.length).toBe(1);
    await wrapper.setProps({ goal });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="organization-acceptance-done"]').exists(),
    ).toBe(true);
    f.setActor(f.identities.requester);
    await wrapper.setProps({ identityKey: f.getActor() });
    await flushPromises();
    expect(wrapper.text()).toContain("did:first");
    expect(wrapper.text()).toContain("该次条件满足");
  });
  it("keeps cancellation out of successful manual acceptance", async () => {
    await configure();
    doneTasks();
    await panel();
    dialog.mockResolvedValueOnce({ response: 0 });
    await acknowledge();
    await click("organization-acceptance-complete");
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
    const result = await api.acknowledgeGoalAcceptance.mock.results[0].value;
    expect(result.acknowledgement.status).toBe("cancelled");
    expect(wrapper.text()).toContain("未确认");
  });
  it("hides mutation controls without goal.accept while sharing existing reports", async () => {
    await configure(
      [taskCriterion],
      [{ criterionId: taskCriterion.id, type: "all-tasks-completed" }],
    );
    await f.host.checkGoalAcceptance(f.event, {
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "reader-report",
    });
    await panel(permissions.filter((p) => p !== "goal.accept"));
    expect(
      wrapper
        .find('[data-testid="organization-acceptance-configure"]')
        .exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="organization-acceptance-check"]').exists(),
    ).toBe(false);
    expect(
      wrapper.findAll("[data-organization-acceptance-report]").length,
    ).toBe(1);
  });
  it("does not use an old met report to complete after task facts change", async () => {
    await configure(
      [taskCriterion],
      [{ criterionId: taskCriterion.id, type: "all-tasks-completed" }],
    );
    doneTasks();
    await panel();
    await click("organization-acceptance-check");
    expect(wrapper.text()).toContain("该次条件满足");
    f.db
      .prepare(
        "UPDATE project_tasks SET status='pending',updated_at=12 WHERE id='t1'",
      )
      .run();
    await click("organization-acceptance-complete");
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
    expect(wrapper.text()).toContain("该次条件未满足");
  });
  it("recovers the exact inspect request when its paid report reply is lost", async () => {
    await configure();
    const original = api.checkGoalAcceptance.getMockImplementation();
    let first = true;
    api.checkGoalAcceptance.mockImplementation(async (input: any) => {
      const result = await original(input);
      if (first) {
        first = false;
        throw new Error("lost");
      }
      return result;
    });
    await panel();
    await click("organization-acceptance-check");
    const originalInput = structuredClone(
      api.checkGoalAcceptance.mock.calls[0][0],
    );
    expect(
      wrapper
        .get('[data-testid="organization-acceptance-complete"]')
        .attributes("disabled"),
    ).toBeDefined();
    await click("organization-acceptance-retry");
    expect(api.checkGoalAcceptance.mock.calls[1][0]).toEqual(originalInput);
    expect(
      (await f.host.getGoalStatus(f.event, { id: goal.id })).usage.totalRuns,
    ).toBe(1);
  });
  it("recovers successful completion after losing its response without a second native confirmation", async () => {
    await configure(
      [taskCriterion],
      [{ criterionId: taskCriterion.id, type: "all-tasks-completed" }],
    );
    doneTasks();
    const original = api.completeGoal.getMockImplementation();
    let first = true;
    api.completeGoal.mockImplementation(async (input: any) => {
      const result = await original(input);
      if (first) {
        first = false;
        throw new Error("lost");
      }
      return result;
    });
    await panel();
    dialog.mockClear();
    await click("organization-acceptance-complete");
    const originalInput = structuredClone(api.completeGoal.mock.calls[0][0]);
    await click("organization-acceptance-retry");
    expect(api.completeGoal.mock.calls[1][0]).toEqual(originalInput);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(
      (await f.host.getGoalStatus(f.event, { id: goal.id })).usage.totalRuns,
    ).toBe(1);
  });
  it("preserves a pending completed request through parent refresh and done status", async () => {
    await configure(
      [taskCriterion],
      [{ criterionId: taskCriterion.id, type: "all-tasks-completed" }],
    );
    doneTasks();
    const original = api.completeGoal.getMockImplementation();
    let first = true;
    api.completeGoal.mockImplementation(async (input: any) => {
      const result = await original(input);
      if (first) {
        first = false;
        throw new Error("lost");
      }
      return result;
    });
    wrapper = mount(GoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions,
        refreshRevision: 1,
      },
    });
    await flushPromises();
    await click("organization-acceptance-complete");
    const originalInput = structuredClone(api.completeGoal.mock.calls[0][0]);
    await wrapper.setProps({ parentBusy: true, refreshRevision: 2 });
    await wrapper.setProps({ parentBusy: false });
    await flushPromises();
    expect(wrapper.text()).toContain("目标已通过该次独立验收");
    await click("organization-acceptance-retry");
    expect(api.completeGoal.mock.calls[1][0]).toEqual(originalInput);
  });
  it("clears pending recovery when acceptance permission is removed", async () => {
    await configure();
    api.checkGoalAcceptance.mockRejectedValueOnce(new Error("lost"));
    await panel();
    await click("organization-acceptance-check");
    await wrapper.setProps({
      permissions: permissions.filter((p) => p !== "goal.accept"),
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="organization-acceptance-retry"]').exists(),
    ).toBe(false);
  });
  it("drops a late report from the previous identity", async () => {
    await configure();
    let resolve: any;
    const original = api.checkGoalAcceptance.getMockImplementation();
    api.checkGoalAcceptance.mockImplementationOnce(async (input: any) => {
      const saved = await original(input);
      await new Promise((r) => (resolve = r));
      return saved;
    });
    await panel();
    await click("organization-acceptance-check");
    f.setActor(f.identities.first);
    await wrapper.setProps({ identityKey: f.getActor() });
    await flushPromises();
    const before = wrapper.findAll(
      "[data-organization-acceptance-report]",
    ).length;
    resolve();
    await flushPromises();
    expect(
      wrapper.findAll("[data-organization-acceptance-report]").length,
    ).toBe(before);
  });
  it("rejects cross-goal report responses and clears visible facts", async () => {
    await configure();
    const original = api.getGoalAcceptanceStatus.getMockImplementation();
    api.getGoalAcceptanceStatus.mockImplementationOnce(async (input: any) => {
      const result = await original(input);
      result.reports = [
        { id: "wrong", goalId: "other", actorDid: f.getActor(), criteria: [] },
      ];
      return result;
    });
    await panel();
    expect(
      wrapper.findAll("[data-organization-acceptance-report]").length,
    ).toBe(0);
    expect(wrapper.emitted("authority-error")?.length).toBe(1);
  });
  it("allows goal metadata readers to use the parent without loading acceptance facts", async () => {
    wrapper = mount(GoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions: ["goal.read", "risk.read"],
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Shared independently verified delivery");
    expect(
      wrapper.find('[data-testid="organization-goal-acceptance"]').exists(),
    ).toBe(false);
    expect(api.getGoalAcceptanceStatus).not.toHaveBeenCalled();
  });
  it("keeps manual acknowledgement available without definition update controls", async () => {
    await configure();
    await panel(
      permissions.filter((permission) => permission !== "goal.update"),
    );
    expect(
      wrapper
        .find('[data-testid="organization-acceptance-configure"]')
        .exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="organization-acceptance-complete"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .find('[data-testid="organization-acceptance-acknowledge"]')
        .exists(),
    ).toBe(true);
    await acknowledge();
    expect(
      (await api.acknowledgeGoalAcceptance.mock.results[0].value)
        .acknowledgement.status,
    ).toBe("accepted");
  });
  it("rejects a completion result whose report belongs to another request", async () => {
    await configure(
      [taskCriterion],
      [{ criterionId: taskCriterion.id, type: "all-tasks-completed" }],
    );
    doneTasks();
    const original = api.completeGoal.getMockImplementation();
    api.completeGoal.mockImplementationOnce(async (input: any) => {
      const result = await original(input);
      result.report.requestId = "unrelated-request";
      return result;
    });
    await panel();
    await click("organization-acceptance-complete");
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(wrapper.emitted("authority-error")?.length).toBe(1);
    expect(
      wrapper.findAll("[data-organization-acceptance-report]").length,
    ).toBe(0);
  });
  it("retains configuration recovery through a parent version refresh", async () => {
    const original = api.configureGoalAcceptance.getMockImplementation();
    let first = true;
    api.configureGoalAcceptance.mockImplementation(async (input: any) => {
      const result = await original(input);
      if (first) {
        first = false;
        throw new Error("lost");
      }
      return result;
    });
    wrapper = mount(GoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions,
        refreshRevision: 1,
      },
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-goal-acceptance"] form')
      .trigger("submit");
    await flushPromises();
    const originalInput = structuredClone(
      api.configureGoalAcceptance.mock.calls[0][0],
    );
    await wrapper.setProps({ parentBusy: true, refreshRevision: 2 });
    await wrapper.setProps({ parentBusy: false });
    await flushPromises();
    await click("organization-acceptance-retry");
    expect(api.configureGoalAcceptance.mock.calls[1][0]).toEqual(originalInput);
    expect(f.host.getGoal(f.event, { id: goal.id }).revision).toBe(2);
  });
  it("marks a previous revision's plan historical and requires new configuration", async () => {
    await configure();
    await panel();
    goal = (
      await f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "change-definition",
        patch: { objective: "Updated shared delivery objective" },
      })
    ).goal;
    await wrapper.setProps({ goal });
    await flushPromises();
    expect(wrapper.text()).toContain("当前版本尚无有效验收计划");
    expect(
      wrapper.find('[data-testid="organization-acceptance-complete"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .find('[data-testid="organization-acceptance-acknowledge"]')
        .exists(),
    ).toBe(false);
  });
});
