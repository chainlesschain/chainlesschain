import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OrganizationProjectGoalPanel from "../OrganizationProjectGoalPanel.vue";
import OrganizationProjectWorkbench from "../OrganizationProjectWorkbench.vue";
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
  ],
  riskPermissions = ["risk.read", "risk.evaluate"];
describe("organization goals with Vue, actual native host, shared SQLite and scheduler", () => {
  let f: any,
    api: any,
    dialog: any,
    configuration: any,
    wrapper: VueWrapper<any>,
    directory: string,
    engine: any,
    store: any;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-organization-goal-ui-"));
    engine = null;
    store = null;
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog, {
      goalMonitoringController: {
        async initialize() {
          if (!engine) {
            store = openSchedulerStore({
              file: join(directory, "scheduler.sqlite"),
              Database,
              clock: () => f.getNow(),
              protectStorage: () => true,
            });
            const authority = new OrganizationProjectAuthority({
              db: f.db,
              getActor: () => f.getActor(),
              now: () => f.getNow(),
              confirm: () => false,
            });
            engine = new OrganizationProjectGoalMonitoringEngine({
              db: f.db,
              getActor: () => f.getActor(),
              authority,
              store,
              clock: () => f.getNow(),
            });
          }
          return engine;
        },
        async close() {
          if (engine) await engine.close();
          if (store) store.close();
        },
      },
    });
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
  afterEach(async () => {
    wrapper?.unmount();
    await f.host.close();
    f.db.close();
    rmSync(directory, { recursive: true, force: true });
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
          [...item.permissions, ...goalPermissions, ...riskPermissions],
          item.actorDid,
        ),
      })),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
  }
  async function panel(permissions = [...goalPermissions, ...riskPermissions]) {
    wrapper = mount(OrganizationProjectGoalPanel, {
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
  async function create(maxRuns = 20) {
    await wrapper
      .get('[data-testid="organization-goal-objective"]')
      .setValue("Shared delivery objective");
    await wrapper
      .get('[data-testid="organization-goal-max-runs"]')
      .setValue(maxRuns);
    await wrapper
      .get('[data-testid="organization-goal-create"]')
      .trigger("submit");
    await flushPromises();
    return f.host.listGoals(f.event, { projectId: "p1" }).goals[0];
  }
  async function switchActor(actor: string) {
    f.setActor(actor);
    await wrapper.setProps({ identityKey: actor });
    await flushPromises();
  }
  async function clickGoal(attribute: string, id: string) {
    await wrapper.get(`[${attribute}="${id}"]`).trigger("click");
    await flushPromises();
  }
  it("creates a native-confirmed shared goal and shows scoped monitoring capability", async () => {
    await panel();
    const goal = await create();
    expect(goal.ownerRef).toBe(f.identities.requester);
    expect(goal.projectRef.scope).toEqual({ kind: "organization", id: "org1" });
    expect(wrapper.text()).toContain("Shared delivery objective");
    expect(wrapper.text()).toContain("手动检查");
    expect(wrapper.text()).toContain("模型费用：未知");
    expect(wrapper.text()).toContain("所有成员共用目标预算");
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][1].detail).toContain(
      "Shared delivery objective",
    );
    expect(
      f.db.prepare("SELECT count(*) AS n FROM project_tasks").get().n,
    ).toBe(1);
  });
  it("serves goal-only readers without loading tasks, risk reviews or check history", async () => {
    await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "seed",
      objective: "Shared objective",
    });
    await grant((permissions, actor) =>
      actor === f.identities.first ? ["goal.read"] : permissions,
    );
    f.setActor(f.identities.first);
    await workbench();
    expect(
      wrapper.find('[data-testid="organization-goal-panel"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain("Shared objective");
    expect(
      wrapper.find('[data-testid="organization-risk-panel"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain("Original task");
    expect(api.listTasks).not.toHaveBeenCalled();
    expect(api.listProposals).not.toHaveBeenCalled();
    expect(api.evaluateRisk).not.toHaveBeenCalled();
    expect(api.listGoalChecks).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="organization-goal-create"]').exists(),
    ).toBe(false);
  });
  it("does not show goals to a member with only task and risk permissions", async () => {
    await grant((permissions, actor) =>
      actor === f.identities.requester
        ? permissions.filter((p) => !p.startsWith("goal."))
        : permissions,
    );
    f.setActor(f.identities.requester);
    await workbench();
    expect(
      wrapper.find('[data-testid="organization-goal-panel"]').exists(),
    ).toBe(false);
    expect(api.listGoals).not.toHaveBeenCalled();
  });
  it("allows a second explicitly authorized member to update, pause and end shared follow-up", async () => {
    await panel();
    const goal = await create();
    await switchActor(f.identities.first);
    expect(wrapper.text()).toContain("did:requester");
    await wrapper
      .get(`[data-goal-draft="${goal.id}"]`)
      .setValue("Revised by reviewer");
    await clickGoal("data-goal-update", goal.id);
    expect(wrapper.text()).toContain("Revised by reviewer");
    await clickGoal("data-goal-pause", goal.id);
    expect(wrapper.text()).toContain("已暂停");
    await clickGoal("data-goal-resume", goal.id);
    await clickGoal("data-goal-end", goal.id);
    expect(wrapper.text()).toContain("跟进已结束，保留历史");
    expect(wrapper.text()).not.toContain("已验收");
    expect(f.host.getGoal(f.event, { id: goal.id }).ownerRef).toBe(
      f.identities.requester,
    );
  });
  it("leaves a cancelled creation unwritten and retains the user's draft", async () => {
    await panel();
    dialog.mockResolvedValueOnce({ response: 0 });
    await create();
    expect(f.host.listGoals(f.event, { projectId: "p1" }).goals).toHaveLength(
      0,
    );
    expect(
      (
        wrapper.get('[data-testid="organization-goal-objective"]')
          .element as HTMLTextAreaElement
      ).value,
    ).toBe("Shared delivery objective");
  });
  it("recovers a lost create reply using the identical request without a second dialog or goal", async () => {
    await panel();
    api.createGoal.mockImplementationOnce(async (input: any) => {
      await f.host.createGoal(f.event, input);
      throw new Error("IPC reply lost");
    });
    await create();
    expect(wrapper.text()).toContain("创建结果待核对");
    const request = api.createGoal.mock.calls[0][0];
    await click("organization-goal-create-retry");
    expect(api.createGoal.mock.calls[1][0]).toEqual(request);
    expect(wrapper.text()).not.toContain("创建结果待核对");
    expect(f.host.listGoals(f.event, { projectId: "p1" }).goals).toHaveLength(
      1,
    );
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it.each(["create", "revise"])(
    "retains an in-flight %s request when a parent refresh precedes a lost reply",
    async (kind) => {
      await workbench();
      let rejectReply!: (value: unknown) => void;
      let goal: any;
      if (kind === "create") {
        api.createGoal.mockImplementationOnce(async (input: any) => {
          await f.host.createGoal(f.event, input);
          return new Promise((_resolve, reject) => {
            rejectReply = reject;
          });
        });
        await create();
      } else {
        goal = await create();
        api.reviseGoal.mockImplementationOnce(async (input: any) => {
          await f.host.reviseGoal(f.event, input);
          return new Promise((_resolve, reject) => {
            rejectReply = reject;
          });
        });
        await wrapper
          .get(`[data-goal-draft="${goal.id}"]`)
          .setValue("In-flight update");
        await clickGoal("data-goal-update", goal.id);
      }
      const method = kind === "create" ? api.createGoal : api.reviseGoal;
      const request = method.mock.calls[0][0];
      await click("refresh-organization");
      rejectReply(new Error("IPC reply lost"));
      await flushPromises();
      if (kind === "create") await click("organization-goal-create-retry");
      else await clickGoal("data-goal-revise-retry", goal.id);
      expect(method.mock.calls[1][0]).toEqual(request);
      expect(f.host.listGoals(f.event, { projectId: "p1" }).goals).toHaveLength(
        1,
      );
      expect(dialog).toHaveBeenCalledTimes(kind === "create" ? 1 : 2);
    },
  );
  it("recovers a lost revise reply with the original CAS request instead of changing revision again", async () => {
    await panel();
    const goal = await create();
    api.reviseGoal.mockImplementationOnce(async (input: any) => {
      await f.host.reviseGoal(f.event, input);
      throw new Error("IPC reply lost");
    });
    await wrapper
      .get(`[data-goal-draft="${goal.id}"]`)
      .setValue("Revised objective");
    await clickGoal("data-goal-update", goal.id);
    expect(wrapper.text()).toContain("更新结果待核对");
    await clickGoal("data-goal-revise-retry", goal.id);
    expect(api.reviseGoal.mock.calls[1][0]).toEqual(
      api.reviseGoal.mock.calls[0][0],
    );
    expect(f.host.getGoal(f.event, { id: goal.id }).revision).toBe(2);
    expect(dialog).toHaveBeenCalledTimes(2);
  });
  it("preserves an uncertain creation across a same-session parent workbench refresh", async () => {
    await workbench();
    api.createGoal.mockImplementationOnce(async (input: any) => {
      await f.host.createGoal(f.event, input);
      throw new Error("IPC reply lost");
    });
    await create();
    const request = api.createGoal.mock.calls[0][0];
    await click("refresh-organization");
    expect(wrapper.text()).toContain("创建结果待核对");
    await click("organization-goal-create-retry");
    expect(api.createGoal.mock.calls[1][0]).toEqual(request);
    expect(f.host.listGoals(f.event, { projectId: "p1" }).goals).toHaveLength(
      1,
    );
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it("runs a real manual check and opens its associated organization risk review", async () => {
    await workbench();
    const goal = await create();
    await clickGoal("data-goal-check", goal.id);
    expect(wrapper.text()).toContain("1 个任务有信号");
    const reviewId = wrapper
      .findAll("[data-goal-review]")[0]
      .attributes("data-goal-review");
    await clickGoal("data-goal-review", reviewId);
    expect(
      wrapper.get('[data-testid="organization-risk-result"]').text(),
    ).toContain(reviewId);
    expect(
      wrapper.get('[data-testid="organization-risk-result"]').text(),
    ).toContain("逾期");
    expect(api.checkGoalNow).toHaveBeenCalledTimes(1);
    expect(
      store.db.prepare("SELECT count(*) AS n FROM occurrences").get().n,
    ).toBe(1);
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it("unlocks the create draft when an unknown request is later definitely rejected", async () => {
    await panel();
    api.createGoal.mockRejectedValueOnce(new Error("IPC reply lost"));
    await create();
    expect(wrapper.text()).toContain("创建结果待核对");
    api.createGoal.mockRejectedValueOnce(new Error("GOAL_REQUEST_CONFLICT"));
    await click("organization-goal-create-retry");
    expect(wrapper.text()).not.toContain("创建结果待核对");
    expect(
      wrapper
        .get('[data-testid="organization-goal-objective"]')
        .attributes("disabled"),
    ).toBeUndefined();
  });
  it("unlocks a lost update after another member changes the current revision", async () => {
    await panel();
    const goal = await create();
    api.reviseGoal.mockRejectedValueOnce(new Error("IPC reply lost"));
    await wrapper
      .get(`[data-goal-draft="${goal.id}"]`)
      .setValue("Pending description");
    await clickGoal("data-goal-update", goal.id);
    f.setActor(f.identities.first);
    await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: 1,
      requestId: "other-change",
      patch: { objective: "Changed by another member" },
    });
    f.setActor(f.identities.requester);
    await clickGoal("data-goal-revise-retry", goal.id);
    expect(wrapper.text()).not.toContain("更新结果待核对");
    expect(
      wrapper.get(`[data-goal-draft="${goal.id}"]`).attributes("disabled"),
    ).toBeUndefined();
    await click("organization-goal-refresh");
    await wrapper
      .get(`[data-goal-draft="${goal.id}"]`)
      .setValue("Fresh intent");
    await clickGoal("data-goal-update", goal.id);
    expect(f.host.getGoal(f.event, { id: goal.id }).objective).toBe(
      "Fresh intent",
    );
  });
  it("clears mismatched review metadata instead of emitting another risk review ID", async () => {
    await panel();
    const goal = await create();
    await clickGoal("data-goal-check", goal.id);
    api.listGoalChecks.mockImplementationOnce(async (input: any) => {
      const result = structuredClone(
        await f.host.listGoalChecks(f.event, input),
      );
      result.checks[0].reviewId = "other-review";
      return result;
    });
    await clickGoal("data-goal-history", goal.id);
    expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(wrapper.emitted("review-id")).toBeUndefined();
  });
  it("shares a check budget across members and refuses a new request after exhaustion", async () => {
    await panel();
    const goal = await create(1);
    await clickGoal("data-goal-check", goal.id);
    await switchActor(f.identities.first);
    expect(wrapper.text()).toContain("1 / 1 次");
    await clickGoal("data-goal-check", goal.id);
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_reviews",
        )
        .get().n,
    ).toBe(1);
    expect(wrapper.text()).not.toContain("检查结果待核对");
  });
  it("recovers a lost check reply without spending the shared budget twice", async () => {
    await panel();
    const goal = await create();
    api.checkGoalNow.mockImplementationOnce(async (input: any) => {
      await f.host.checkGoalNow(f.event, input);
      throw new Error("IPC reply lost");
    });
    await clickGoal("data-goal-check", goal.id);
    expect(wrapper.text()).toContain("检查结果待核对");
    await clickGoal("data-goal-check", goal.id);
    expect(api.checkGoalNow.mock.calls[1][0]).toEqual(
      api.checkGoalNow.mock.calls[0][0],
    );
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_reviews",
        )
        .get().n,
    ).toBe(1);
    expect(wrapper.text()).toContain("1 / 20 次");
  });
  it("preserves the original check request after a storage-result error", async () => {
    await panel();
    const goal = await create();
    api.checkGoalNow.mockRejectedValueOnce(new Error("GOAL_STORAGE_FAILED"));
    await clickGoal("data-goal-check", goal.id);
    expect(wrapper.text()).toContain("检查结果待核对");
    await clickGoal("data-goal-check", goal.id);
    expect(api.checkGoalNow.mock.calls[1][0]).toEqual(
      api.checkGoalNow.mock.calls[0][0],
    );
  });
  it.each(["goal.check", "risk.read", "risk.evaluate"])(
    "does not offer a check when %s is missing",
    async (missing) => {
      await panel(
        [...goalPermissions, ...riskPermissions].filter((p) => p !== missing),
      );
      const goal = await create();
      expect(wrapper.find(`[data-goal-check="${goal.id}"]`).exists()).toBe(
        false,
      );
      expect(api.checkGoalNow).not.toHaveBeenCalled();
    },
  );
  it("rejects oversized UTF-8 goal text and invalid budget without a native dialog", async () => {
    await panel();
    await wrapper
      .get('[data-testid="organization-goal-objective"]')
      .setValue("中".repeat(2731));
    await wrapper
      .get('[data-testid="organization-goal-create"]')
      .trigger("submit");
    await flushPromises();
    expect(api.createGoal).not.toHaveBeenCalled();
    await wrapper
      .get('[data-testid="organization-goal-objective"]')
      .setValue("Valid objective");
    await wrapper.get('[data-testid="organization-goal-max-runs"]').setValue(0);
    await wrapper
      .get('[data-testid="organization-goal-create"]')
      .trigger("submit");
    await flushPromises();
    expect(api.createGoal).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
  });
  it("clears goal facts and private drafts after membership revocation", async () => {
    await panel();
    const goal = await create();
    await wrapper
      .get(`[data-goal-draft="${goal.id}"]`)
      .setValue("private edit");
    f.db
      .prepare(
        "UPDATE organization_members SET status='inactive' WHERE member_did=?",
      )
      .run(f.identities.requester);
    await click("organization-goal-refresh");
    expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("private edit");
  });
  it.each(["identity", "project", "permissions"])(
    "drops delayed goal list after %s changes",
    async (change) => {
      await panel();
      await create();
      const saved = structuredClone(
        f.host.listGoals(f.event, { projectId: "p1" }),
      );
      let resolve!: (value: any) => void;
      api.listGoals.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      api.listGoals.mockResolvedValue({ goals: [], nextCursor: null });
      await wrapper
        .get('[data-testid="organization-goal-refresh"]')
        .trigger("click");
      if (change === "identity")
        await wrapper.setProps({ identityKey: "other-login" });
      else if (change === "project")
        await wrapper.setProps({ projectId: "p2" });
      else await wrapper.setProps({ permissions: [] });
      resolve(saved);
      await flushPromises();
      expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
    },
  );
  it.each(["project", "organization"])(
    "rejects a goal reply for another %s",
    async (change) => {
      await panel();
      await create();
      api.listGoals.mockImplementationOnce(async (input: any) => {
        const saved = structuredClone(f.host.listGoals(f.event, input));
        if (change === "project") saved.goals[0].projectRef.id = "other";
        else saved.goals[0].projectRef.scope.id = "other";
        return saved;
      });
      await click("organization-goal-refresh");
      expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
      expect(wrapper.emitted("authority-error")).toHaveLength(1);
    },
  );
  it("pages shared goals with actual stable server cursors", async () => {
    for (let i = 0; i < 22; i++)
      await f.host.createGoal(f.event, {
        projectId: "p1",
        requestId: `seed-${i}`,
        objective: `Shared goal ${i}`,
      });
    await panel();
    expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(20);
    await click("organization-goal-more");
    expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(22);
    expect(
      wrapper.find('[data-testid="organization-goal-more"]').exists(),
    ).toBe(false);
  });
});
