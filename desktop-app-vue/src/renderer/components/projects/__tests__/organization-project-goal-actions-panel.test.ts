import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ActionsPanel from "../OrganizationProjectGoalActionsPanel.vue";
import GoalPanel from "../OrganizationProjectGoalPanel.vue";
import Workbench from "../OrganizationProjectWorkbench.vue";
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
  "goal.propose",
];
const riskPermissions = ["risk.read", "risk.evaluate"];
const requesterPermissions = [
  "task.read",
  "task.create",
  "task.update-description",
  ...goalPermissions,
  ...riskPermissions,
];
describe("organization goal suggestions with Vue and real multi-member native SQLite workflow", () => {
  let f: any,
    api: any,
    dialog: any,
    configuration: any,
    directory: string,
    engine: any,
    store: any,
    goal: any,
    wrapper: VueWrapper<any>;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-goal-actions-ui-"));
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
    configuration = await f.setup();
    const policy = {
      orgId: "org1",
      workflowIds: configuration.workflowIds,
      permissions: configuration.permissions.map((p: any) => ({
        ...p,
        permissions: [
          ...new Set([
            ...p.permissions,
            ...goalPermissions,
            ...riskPermissions,
          ]),
        ],
      })),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    f.setActor(f.identities.requester);
    goal = (
      await f.host.createGoal(f.event, {
        projectId: "p1",
        requestId: "seed",
        objective: "Shared delivery goal",
        budgetPolicy: { maxRuns: 20 },
      })
    ).goal;
    goal = (
      await f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "enable",
        patch: {
          allowedActionTypes: ["task.create", "task.update-description"],
        },
      })
    ).goal;
    await f.host.checkGoalNow(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "source-check",
    });
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
  function flows() {
    return configuration.workflowIds.map((id: string, index: number) => ({
      id,
      name: index ? "Create plan" : "Description plan",
      actionType: index ? "task.create" : "task.update-description",
    }));
  }
  async function panel(permissions = requesterPermissions) {
    wrapper = mount(ActionsPanel, {
      props: {
        goal,
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions,
        workflows: flows(),
      },
    });
    await flushPromises();
  }
  async function suggestion(type = "task.update-description") {
    const list = await f.host.listGoalSuggestions(f.event, { goalId: goal.id });
    return list.suggestions.find(
      (item: any) => item.suggestion.actionType === type,
    ).suggestion;
  }
  async function click(attribute: string, id: string) {
    if (attribute === "data-goal-action-prepare") {
      await wrapper
        .get(`[data-goal-suggestion="${id}"] form`)
        .trigger("submit");
    } else await wrapper.get(`[${attribute}="${id}"]`).trigger("click");
    await flushPromises();
  }
  async function prepare(type = "task.update-description") {
    const item = await suggestion(type);
    await wrapper
      .get(`[data-goal-action-description="${item.id}"]`)
      .setValue("Review the overdue delivery and record next steps");
    await click("data-goal-action-prepare", item.id);
    return item;
  }
  it("uses current risk evidence, previews without a write and submits to the existing approval chain", async () => {
    await panel();
    const item = await prepare();
    expect(wrapper.text()).toContain("Original task");
    expect(wrapper.text()).toContain("Review the overdue delivery");
    expect(
      f.db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Original task");
    expect(dialog).not.toHaveBeenCalled();
    await click("data-goal-action-submit", item.id);
    const submission = api.submitGoalAction.mock.results[0];
    const result = await submission.value;
    expect(result.proposal.approvalStatus).toBe("pending");
    expect(wrapper.emitted("proposal-id")?.at(-1)).toEqual([
      result.proposal.proposalId,
    ]);
    expect(
      f.db.prepare("SELECT count(*) AS n FROM approval_responses").get().n,
    ).toBe(0);
    expect(wrapper.find(`[data-goal-action-open="${item.id}"]`).exists()).toBe(
      true,
    );
  });
  it("submits a task create intent with the chosen task type and leaves canonical tasks unchanged", async () => {
    await panel();
    const item = await suggestion("task.create");
    await wrapper
      .get(`[data-goal-action-description="${item.id}"]`)
      .setValue("Analyze delivery risk");
    await wrapper
      .get(`[data-goal-action-type="${item.id}"]`)
      .setValue("analyze_data");
    await click("data-goal-action-prepare", item.id);
    await click("data-goal-action-submit", item.id);
    const result = await api.submitGoalAction.mock.results[0].value;
    const proposal = f.host.readProposal(f.event, {
      proposalId: result.proposal.proposalId,
    });
    expect(proposal.request.input.taskType).toBe("analyze_data");
    expect(proposal.request.input.goalIntent.goalId).toBe(goal.id);
    expect(
      f.db.prepare("SELECT count(*) AS n FROM project_tasks").get().n,
    ).toBe(1);
  });
  it("retains the exact preparation request after a committed reply is lost", async () => {
    const original = api.prepareGoalAction.getMockImplementation();
    let first = true;
    api.prepareGoalAction.mockImplementation(async (input: any) => {
      const result = await original(input);
      if (first) {
        first = false;
        throw new Error("transport lost");
      }
      return result;
    });
    await panel();
    const item = await prepare();
    expect(wrapper.find(`[data-goal-action-retry="${item.id}"]`).exists()).toBe(
      true,
    );
    const input = structuredClone(api.prepareGoalAction.mock.calls[0][0]);
    await click("data-goal-action-retry", item.id);
    expect(api.prepareGoalAction.mock.calls[1][0]).toEqual(input);
    expect(wrapper.find(`[data-goal-action-retry="${item.id}"]`).exists()).toBe(
      false,
    );
    expect(
      f.host
        .listGoalSuggestions(f.event, { goalId: goal.id })
        .suggestions.find((i: any) => i.suggestion.id === item.id).intent.intent
        .id,
    ).toBe((await api.prepareGoalAction.mock.results[1].value).intent.id);
  });
  it("replays the same submitted intent after losing the approval proposal reply", async () => {
    const original = api.submitGoalAction.getMockImplementation();
    let first = true;
    api.submitGoalAction.mockImplementation(async (input: any) => {
      const result = await original(input);
      if (first) {
        first = false;
        throw new Error("transport lost");
      }
      return result;
    });
    await panel();
    const item = await prepare();
    await click("data-goal-action-submit", item.id);
    const input = structuredClone(api.submitGoalAction.mock.calls[0][0]);
    await click("data-goal-action-retry", item.id);
    expect(api.submitGoalAction.mock.calls[1][0]).toEqual(input);
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_proposals")
        .get().n,
    ).toBe(1);
  });
  it("hides preparation without the independent goal.propose permission", async () => {
    await panel(requesterPermissions.filter((p) => p !== "goal.propose"));
    expect(wrapper.findAll("[data-goal-suggestion]").length).toBe(2);
    expect(wrapper.findAll("[data-goal-action-prepare]").length).toBe(0);
    expect(api.prepareGoalAction).not.toHaveBeenCalled();
  });
  it("validates UTF-8 description limits before preparation", async () => {
    await panel();
    const item = await suggestion();
    await wrapper
      .get(`[data-goal-action-description="${item.id}"]`)
      .setValue("界".repeat(2731));
    expect(
      wrapper
        .get(`[data-goal-action-prepare="${item.id}"]`)
        .attributes("disabled"),
    ).toBeDefined();
    expect(api.prepareGoalAction).not.toHaveBeenCalled();
  });
  it("clears a definite rejection and permits correcting the description", async () => {
    api.prepareGoalAction.mockRejectedValueOnce(
      Object.assign(new Error("invalid"), {
        code: "ACTION_GOAL_INVALID_REQUEST",
      }),
    );
    await panel();
    const item = await prepare();
    expect(wrapper.find(`[data-goal-action-retry="${item.id}"]`).exists()).toBe(
      false,
    );
    expect(
      wrapper
        .get(`[data-goal-action-description="${item.id}"]`)
        .attributes("disabled"),
    ).toBeUndefined();
  });
  it("drops late preparation results after switching identity", async () => {
    let resolve: any;
    const original = api.prepareGoalAction.getMockImplementation();
    api.prepareGoalAction.mockImplementationOnce(async (input: any) => {
      const saved = await original(input);
      await new Promise((r) => (resolve = r));
      return saved;
    });
    await panel();
    await prepare();
    expect(resolve).toBeTypeOf("function");
    f.setActor(f.identities.first);
    await wrapper.setProps({
      identityKey: f.getActor(),
      permissions: ["goal.read", "risk.read", "task.read", "task.approve"],
    });
    resolve();
    await flushPromises();
    expect(wrapper.findAll("[data-goal-action-submit]").length).toBe(0);
    expect(wrapper.text()).not.toContain("Review the overdue delivery");
  });
  it("rejects a misbound suggestion response and clears the visible facts", async () => {
    const original = api.listGoalSuggestions.getMockImplementation();
    api.listGoalSuggestions.mockImplementationOnce(async (input: any) => {
      const result = await original(input);
      result.suggestions[0].suggestion.goalId = "another-goal";
      return result;
    });
    await panel();
    expect(wrapper.findAll("[data-goal-suggestion]").length).toBe(0);
    expect(wrapper.emitted("authority-error")?.length).toBe(1);
  });
  it("preserves the original pending request through a parent goal refresh", async () => {
    const original = api.prepareGoalAction.getMockImplementation();
    let first = true;
    api.prepareGoalAction.mockImplementation(async (input: any) => {
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
        permissions: requesterPermissions,
        workflows: flows(),
        refreshRevision: 1,
      },
    });
    await flushPromises();
    const item = await prepare();
    const input = structuredClone(api.prepareGoalAction.mock.calls[0][0]);
    await wrapper.setProps({ parentBusy: true, refreshRevision: 2 });
    await wrapper.setProps({ parentBusy: false });
    await flushPromises();
    await click("data-goal-action-retry", item.id);
    expect(api.prepareGoalAction.mock.calls[1][0]).toEqual(input);
  });
  it("opens a submitted goal proposal in the real workbench and requires two member approvals", async () => {
    wrapper = mount(Workbench, {
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
    const item = await prepare();
    await click("data-goal-action-submit", item.id);
    expect(
      wrapper.get('[data-testid="stored-proposal-body"]').text(),
    ).toContain("Review the overdue delivery");
    expect(wrapper.text()).toContain("关联组织目标");
    const submitted = await api.submitGoalAction.mock.results[0].value;
    const proposalId = submitted.proposal.proposalId;
    for (const [step, actor] of [
      f.identities.first,
      f.identities.second,
    ].entries()) {
      f.setActor(actor);
      await wrapper.setProps({ identityKey: actor });
      await flushPromises();
      await wrapper.get(`[data-proposal-id="${proposalId}"]`).trigger("click");
      await flushPromises();
      await wrapper
        .get('[data-testid="approve-organization-proposal"]')
        .trigger("click");
      await flushPromises();
      expect(dialog.mock.calls.at(-1)[1].detail).toContain(
        "Shared delivery goal",
      );
      const saved = f.host.readProposal(f.event, { proposalId });
      if (step === 0) expect(saved.currentStep).toBe(1);
      expect(saved.approvalStatus).toBe(step === 0 ? "pending" : "approved");
    }
    f.setActor(f.identities.requester);
    await wrapper.setProps({ identityKey: f.getActor() });
    await flushPromises();
    await wrapper.get(`[data-proposal-id="${proposalId}"]`).trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="execute-organization-proposal"]')
      .trigger("click");
    await flushPromises();
    expect(
      f.db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toContain("Review the overdue delivery");
    expect(wrapper.text()).toContain("修改已完成");
    expect(
      (await f.host.getGoalStatus(f.event, { id: goal.id })).usage.totalRuns,
    ).toBe(2);
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
  }, 15000);
  it("requires native confirmation to enable task suggestions", async () => {
    goal = (
      await f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "disable-actions",
        patch: { allowedActionTypes: [] },
      })
    ).goal;
    dialog.mockClear();
    wrapper = mount(GoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions: requesterPermissions,
        workflows: flows(),
      },
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-goal-enable-actions"]')
      .trigger("click");
    await flushPromises();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][1].detail).toContain("task.update-description");
    expect(f.host.getGoal(f.event, { id: goal.id }).allowedActionTypes).toEqual(
      ["task.create", "task.update-description"],
    );
  });
  it("keeps uncertain submission recovery after a same-session parent refresh", async () => {
    const original = api.submitGoalAction.getMockImplementation();
    let first = true;
    api.submitGoalAction.mockImplementation(async (input: any) => {
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
        permissions: requesterPermissions,
        workflows: flows(),
        refreshRevision: 1,
      },
    });
    await flushPromises();
    const item = await prepare();
    await click("data-goal-action-submit", item.id);
    const originalInput = structuredClone(
      api.submitGoalAction.mock.calls[0][0],
    );
    await wrapper.setProps({ parentBusy: true, refreshRevision: 2 });
    await wrapper.setProps({ parentBusy: false });
    await flushPromises();
    await click("data-goal-action-retry", item.id);
    expect(api.submitGoalAction.mock.calls[1][0]).toEqual(originalInput);
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_project_proposals")
        .get().n,
    ).toBe(1);
  });
  it("clears original recovery and draft bodies when proposal permission is removed", async () => {
    api.prepareGoalAction.mockRejectedValueOnce(new Error("lost"));
    await panel();
    const item = await prepare();
    expect(wrapper.find(`[data-goal-action-retry="${item.id}"]`).exists()).toBe(
      true,
    );
    await wrapper.setProps({
      permissions: requesterPermissions.filter((p) => p !== "goal.propose"),
    });
    await flushPromises();
    expect(wrapper.findAll("[data-goal-action-retry]").length).toBe(0);
    expect(wrapper.text()).not.toContain("Review the overdue delivery");
  });
  it("keeps a goal and its risk history readable without task permissions", async () => {
    wrapper = mount(GoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions: ["goal.read", "risk.read"],
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Shared delivery goal");
    expect(
      wrapper.find('[data-testid="organization-goal-actions"]').exists(),
    ).toBe(false);
    expect(wrapper.find(`[data-goal-history="${goal.id}"]`).exists()).toBe(
      true,
    );
    expect(api.listGoalSuggestions).not.toHaveBeenCalled();
  });
});
