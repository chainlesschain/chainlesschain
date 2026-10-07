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
const permissions = [
  "goal.read",
  "goal.create",
  "goal.update",
  "goal.check",
  "goal.monitor",
  "risk.read",
  "risk.evaluate",
];
describe("organization periodic controls through Vue, native consent and actual scheduler", () => {
  let f: any,
    api: any,
    dialog: any,
    configuration: any,
    wrapper: VueWrapper<any>,
    directory: string,
    engine: any,
    store: any,
    goal: any;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-periodic-ui-"));
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
    goal = (
      await f.host.createGoal(f.event, {
        projectId: "p1",
        requestId: "seed-goal",
        objective: "Shared periodic goal",
        budgetPolicy: { maxRuns: 20 },
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
  async function grant(
    transform = (grants: string[], _actor: string) => grants,
  ) {
    f.setActor(f.identities.owner);
    const policy = {
      orgId: "org1",
      workflowIds: configuration.workflowIds,
      permissions: configuration.permissions.map((item: any) => ({
        ...item,
        permissions: transform(
          [...item.permissions, ...permissions],
          item.actorDid,
        ),
      })),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
  }
  async function panel(grants = permissions) {
    wrapper = mount(OrganizationProjectGoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        permissions: grants,
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
  async function click(attribute: string, value = goal.id) {
    await wrapper.get(`[${attribute}="${value}"]`).trigger("click");
    await flushPromises();
  }
  async function refresh() {
    await click("data-testid", "organization-goal-refresh");
  }
  function status() {
    return engine.status({ id: goal.id });
  }
  it("starts native-confirmed monitoring under the enabler and refreshes its truthful status", async () => {
    f.setActor(f.identities.first);
    await panel();
    await click("data-goal-monitor-start");
    expect(status().monitor.executorDid).toBe(f.identities.first);
    expect(status().monitor.executorDid).not.toBe(goal.ownerRef);
    expect(wrapper.text()).toContain("did:first");
    expect(wrapper.text()).toContain("同意截止");
    expect(wrapper.text()).toContain("等待周期检查");
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][1].detail).toContain("执行身份");
    expect(dialog.mock.calls[0][1].detail).toContain("Shared periodic goal");
    f.setNow(f.getNow() + 3_600_000);
    await engine.tick();
    await refresh();
    expect(wrapper.text()).toContain("1 / 20");
  });
  it("changes interval and duration before confirmation while keeping the expiry fixed in the request", async () => {
    await panel();
    await wrapper
      .get(`[data-goal-monitor-interval="${goal.id}"]`)
      .setValue("60000");
    await wrapper.get(`[data-goal-monitor-hours="${goal.id}"]`).setValue(2);
    await click("data-goal-monitor-start");
    expect(api.startGoalMonitoring.mock.calls[0][0]).toMatchObject({
      intervalMs: 60_000,
      expiresAt: f.getNow() + 7_200_000,
    });
    expect(status().monitor.intervalMs).toBe(60_000);
  });
  it("does not activate a cancelled native consent", async () => {
    await panel();
    dialog.mockResolvedValueOnce({ response: 0 });
    await click("data-goal-monitor-start");
    expect(status().monitor).toBeNull();
    expect(wrapper.text()).not.toContain("巡检设置结果待核对");
  });
  it.each(["goal.monitor", "goal.check", "risk.read", "risk.evaluate"])(
    "does not offer start without %s",
    async (missing) => {
      await panel(permissions.filter((p) => p !== missing));
      expect(
        wrapper.find(`[data-goal-monitor-start="${goal.id}"]`).exists(),
      ).toBe(false);
      expect(api.startGoalMonitoring).not.toHaveBeenCalled();
    },
  );
  it("requires a valid duration before opening native consent", async () => {
    await panel();
    await wrapper.get(`[data-goal-monitor-hours="${goal.id}"]`).setValue(25);
    await click("data-goal-monitor-start");
    expect(api.startGoalMonitoring).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
  });
  it("closes future periods without ending the goal and permits separate manual checks", async () => {
    await panel();
    await click("data-goal-monitor-start");
    await click("data-goal-monitor-stop");
    expect(status().monitor.enabled).toBe(false);
    expect(status().goal.status).toBe("active");
    await click("data-goal-check");
    expect(status().usage.totalRuns).toBe(1);
    expect(dialog.mock.calls[1][1].detail).toContain("手动检查不会因此停止");
  });
  it("shows a stop request without promising that an admitted check has already been aborted", async () => {
    await panel();
    await click("data-goal-monitor-start");
    await click("data-goal-monitor-abort");
    expect(status().monitor.enabled).toBe(false);
    expect(api.stopGoalMonitoring.mock.calls[0][0].mode).toBe("abort");
    expect(dialog.mock.calls[1][1].detail).toContain("不表示尚在执行");
  });
  it("retains the same start identity after a lost response, even across a parent refresh", async () => {
    await workbench();
    api.startGoalMonitoring.mockImplementationOnce(async (input: any) => {
      await f.host.startGoalMonitoring(f.event, input);
      throw new Error("IPC reply lost");
    });
    await click("data-goal-monitor-start");
    const request = api.startGoalMonitoring.mock.calls[0][0];
    await click("data-testid", "refresh-organization");
    expect(wrapper.text()).toContain("巡检设置结果待核对");
    await click("data-goal-monitor-retry");
    expect(api.startGoalMonitoring.mock.calls[1][0]).toEqual(request);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(status().monitor.enabled).toBe(true);
  });
  it("retains in-flight stop identity when the parent refresh invalidates the old reply", async () => {
    await workbench();
    await click("data-goal-monitor-start");
    let reject!: (value: any) => void;
    api.stopGoalMonitoring.mockImplementationOnce(async (input: any) => {
      await f.host.stopGoalMonitoring(f.event, input);
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    });
    await click("data-goal-monitor-stop");
    const request = api.stopGoalMonitoring.mock.calls[0][0];
    await click("data-testid", "refresh-organization");
    reject(new Error("IPC reply lost"));
    await flushPromises();
    await click("data-goal-monitor-retry");
    expect(api.stopGoalMonitoring.mock.calls[1][0]).toEqual(request);
    expect(dialog).toHaveBeenCalledTimes(2);
    expect(status().monitor.enabled).toBe(false);
  });
  it("keeps stop available after risk evaluation permission is removed", async () => {
    await panel();
    await click("data-goal-monitor-start");
    await grant((grants, actor) =>
      actor === f.identities.requester
        ? grants.filter((p) => p !== "risk.evaluate")
        : grants,
    );
    f.setActor(f.identities.requester);
    await wrapper.setProps({
      permissions: permissions.filter((p) => p !== "risk.evaluate"),
      identityKey: "requester-new-policy",
    });
    await flushPromises();
    expect(
      wrapper.find(`[data-goal-monitor-start="${goal.id}"]`).exists(),
    ).toBe(false);
    await click("data-goal-monitor-stop");
    expect(status().monitor.enabled).toBe(false);
  });
  it("shows blocked old consent after goal revision and allows a fresh native enable", async () => {
    await panel();
    await click("data-goal-monitor-start");
    const original = status().monitor.id;
    await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "change",
      patch: { objective: "Updated periodic objective" },
    });
    await refresh();
    expect(wrapper.text()).toContain("重新核对授权");
    await click("data-goal-monitor-start");
    expect(status().monitor.id).not.toBe(original);
    expect(status().monitor.goalRevision).toBe(2);
  });
  it("clears metadata and pending monitor request on membership revocation", async () => {
    await panel();
    api.startGoalMonitoring.mockRejectedValueOnce(new Error("IPC reply lost"));
    await click("data-goal-monitor-start");
    f.db
      .prepare(
        "UPDATE organization_members SET status='inactive' WHERE member_did=?",
      )
      .run(f.identities.requester);
    await refresh();
    expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("巡检设置结果待核对");
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it.each(["goal", "scope"])(
    "rejects mismatched %s in monitor metadata",
    async (field) => {
      await panel();
      await click("data-goal-monitor-start");
      api.getGoalStatus.mockImplementationOnce(async (input: any) => {
        const result = structuredClone(
          await f.host.getGoalStatus(f.event, input),
        );
        if (field === "goal") result.monitor.goalId = "other";
        else result.monitor.scope.id = "other-org";
        return result;
      });
      await refresh();
      expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
      expect(wrapper.emitted("authority-error")).toHaveLength(1);
    },
  );
  it("drops a late start reply after identity change without restoring the old consent display", async () => {
    await panel();
    let resolve!: (value: any) => void;
    api.startGoalMonitoring.mockImplementationOnce(async (input: any) => {
      const result = structuredClone(
        await f.host.startGoalMonitoring(f.event, input),
      );
      return new Promise((done) => {
        resolve = () => done(result);
      });
    });
    await click("data-goal-monitor-start");
    await wrapper.setProps({ identityKey: "another-login", permissions: [] });
    resolve(null);
    await flushPromises();
    expect(wrapper.findAll("[data-organization-goal-id]")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("巡检设置结果待核对");
  });
});
