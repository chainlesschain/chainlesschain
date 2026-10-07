import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Panel from "../OrganizationProjectGoalMemoryPanel.vue";
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
const permissions = [
  "goal.read",
  "goal.create",
  "goal.memory.read",
  "goal.memory.write",
  "goal.memory.delete",
];
const goal = {
  id: "g1",
  revision: 2,
  status: "active",
  projectRef: {
    id: "p1",
    sourceKind: "desktop.organization-project-goals",
    scope: { kind: "organization", id: "org1" },
  },
  ownerRef: "did:creator",
  objective: "Shared goal",
  budgetPolicy: { maxRuns: 20 },
  expiresAt: null,
};
const scope = {
  goalId: "g1",
  projectId: "p1",
  orgId: "org1",
  actorDid: "did:member",
};
function item(overrides: any = {}) {
  return {
    memoryId: "m1",
    reference: {
      kind: "context-memory-kernel",
      id: "m1",
      version: "v1:r1:sha256:initial",
    },
    currentVersion: "v1:r1:sha256:initial",
    grantState: "active",
    state: "active",
    record: {
      content: "Sensitive shared fact",
      category: "user-fact",
      revision: 1,
      provenance: {
        source: "member-explicit",
        observedAt: "2026-10-07T00:00:00.000Z",
      },
      retentionPolicy: {},
    },
    ...overrides,
  };
}
function operation(overrides: any = {}) {
  return {
    requestId: "original-op",
    type: "create",
    status: "prepared",
    actorDid: "did:member",
    result: null,
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("organization shared memory UI with fresh grants and body-free recovery", () => {
  let wrapper: VueWrapper<any>,
    api: any,
    invalidate: () => void,
    unsubscribe: any;
  const props = {
    goal,
    projectId: "p1",
    orgId: "org1",
    identityKey: "did:member:session1",
    actorDid: "did:member",
    permissions,
  };
  beforeEach(() => {
    unsubscribe = vi.fn();
    const result = (input: any, type: string) => ({
      goal,
      operation: operation({
        requestId: input.operationRequestId || input.requestId,
        type,
        status: type === "discard" ? "discarded" : "complete",
      }),
    });
    api = {
      listGoalMemories: vi.fn(async () => ({
        ...scope,
        goalRevision: 2,
        authorityExpiresAt: Date.now() + 60_000,
        items: [item()],
        nextCursor: null,
      })),
      listGoalMemoryOperations: vi.fn(async () => ({
        ...scope,
        items: [],
        nextCursor: null,
      })),
      onGoalMemoryInvalidated: vi.fn((callback: any) => {
        invalidate = callback;
        return unsubscribe;
      }),
    };
    for (const [method, type] of Object.entries({
      createGoalMemory: "create",
      correctGoalMemory: "correct",
      revokeGoalMemory: "revoke",
      deleteGoalMemory: "delete",
      recoverGoalMemory: "create",
      discardGoalMemory: "discard",
    }))
      api[method] = vi.fn(async (input: any) => result(input, type));
    (window as any).electronAPI = { organizationProject: api };
    wrapper = mount(Panel, { props });
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const find = (id: string) =>
    wrapper.get(`[data-testid="organization-memory-${id}"]`);
  async function submit(text = "Explicit member note") {
    await find("content").setValue(text);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
  }
  it("shows shared facts to the actual member independently of creator or authentication key", async () => {
    await flushPromises();
    expect(find("body").text()).toBe("Sensitive shared fact");
    expect(wrapper.text()).toContain("组织目标共享记忆");
    expect(api.createGoalMemory).not.toHaveBeenCalled();
  });
  it("submits explicit content and records only nonce recovery in the parent", async () => {
    await flushPromises();
    await find("category").setValue("agent-inference");
    await submit();
    const input = api.createGoalMemory.mock.calls[0][0];
    expect(input).toMatchObject({
      goalId: "g1",
      expectedRevision: 2,
      content: "Explicit member note",
      category: "agent-inference",
    });
    const saved = wrapper
      .emitted("recovery")!
      .map(([value]) => value)
      .filter(Boolean);
    expect(saved[0]).toEqual({
      method: "recoverGoalMemory",
      type: "create",
      input: { goalId: "g1", requestId: input.requestId },
    });
    expect(JSON.stringify(saved)).not.toContain("Explicit member note");
  });
  it("converts a lost write reply to recovery of the same nonce without repeating the save", async () => {
    await flushPromises();
    api.createGoalMemory.mockRejectedValueOnce(new Error("Reply lost"));
    await submit();
    const input = api.createGoalMemory.mock.calls[0][0];
    expect((find("content").element as HTMLTextAreaElement).value).toBe("");
    await find("retry").trigger("click");
    await flushPromises();
    expect(api.recoverGoalMemory).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: input.requestId,
    });
    expect(api.createGoalMemory).toHaveBeenCalledTimes(1);
  });
  it("cancels a native write without leaving a pending request", async () => {
    await flushPromises();
    api.createGoalMemory.mockImplementationOnce(async (input: any) => ({
      cancelled: true,
      goalId: input.goalId,
      requestId: input.requestId,
      operation: "create",
    }));
    await submit();
    expect(
      wrapper.find('[data-testid="organization-memory-retry"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).toContain("已取消");
  });
  it("corrects an authorized version and supplies its exact source reference", async () => {
    await flushPromises();
    await find("edit").trigger("click");
    expect((find("content").element as HTMLTextAreaElement).value).toBe(
      "Sensitive shared fact",
    );
    await submit("Member correction");
    expect(api.correctGoalMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: "m1",
        memoryVersion: item().currentVersion,
        content: "Member correction",
      }),
    );
  });
  it.each(["revoke", "delete"])(
    "clears displayed bodies while %s awaits native confirmation",
    async (type) => {
      await flushPromises();
      const wait = deferred<any>();
      api[
        type === "revoke" ? "revokeGoalMemory" : "deleteGoalMemory"
      ].mockReturnValueOnce(wait.promise);
      await find(type).trigger("click");
      expect(
        wrapper.find('[data-testid="organization-memory-body"]').exists(),
      ).toBe(false);
      const input =
        api[type === "revoke" ? "revokeGoalMemory" : "deleteGoalMemory"].mock
          .calls[0][0];
      wait.resolve({
        goal,
        operation: operation({
          requestId: input.requestId,
          type,
          status: "complete",
        }),
      });
      await flushPromises();
    },
  );
  it("replaces bodies on pagination and never retains the previous authorized page", async () => {
    api.listGoalMemories.mockResolvedValueOnce({
      ...scope,
      goalRevision: 2,
      authorityExpiresAt: Date.now() + 60_000,
      items: [item()],
      nextCursor: "m1",
    });
    await find("refresh").trigger("click");
    await flushPromises();
    api.listGoalMemories.mockResolvedValueOnce({
      ...scope,
      goalRevision: 2,
      authorityExpiresAt: Date.now() + 60_000,
      items: [
        item({
          memoryId: "m2",
          record: { ...item().record, content: "Second page" },
        }),
      ],
      nextCursor: null,
    });
    await find("more").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Sensitive shared fact");
    expect(find("body").text()).toBe("Second page");
  });
  it("ignores an older page when a later authorization refresh finishes first", async () => {
    await flushPromises();
    const wait = deferred<any>();
    api.listGoalMemories.mockReturnValueOnce(wait.promise);
    await find("refresh").trigger("click");
    invalidate();
    await flushPromises();
    wait.resolve({
      ...scope,
      goalRevision: 2,
      authorityExpiresAt: Date.now() + 60_000,
      items: [item({ record: { ...item().record, content: "Stale page" } })],
      nextCursor: null,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Stale page");
  });
  it("clears memory and correction drafts immediately on invalidation", async () => {
    await flushPromises();
    await find("edit").trigger("click");
    const wait = deferred<any>();
    api.listGoalMemories.mockReturnValueOnce(wait.promise);
    invalidate();
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-testid="organization-memory-body"]').exists(),
    ).toBe(false);
    expect((find("content").element as HTMLTextAreaElement).value).toBe("");
    wait.reject(new Error("ORG_AUTH_NOT_FOUND_OR_DENIED"));
    await flushPromises();
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it("denies wrong project or actor output and clears prior content", async () => {
    await flushPromises();
    api.listGoalMemories.mockResolvedValueOnce({
      ...scope,
      projectId: "p2",
      goalRevision: 2,
      authorityExpiresAt: Date.now() + 60_000,
      items: [item()],
      nextCursor: null,
    });
    await find("refresh").trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="organization-memory-body"]').exists(),
    ).toBe(false);
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it("clears cached facts and pending identity on permission or session changes", async () => {
    await flushPromises();
    api.createGoalMemory.mockRejectedValueOnce(new Error("Reply lost"));
    await submit();
    await wrapper.setProps({
      identityKey: "did:member:session2",
      permissions: ["goal.read"],
    });
    expect(
      wrapper.find('[data-testid="organization-goal-memory-panel"]').exists(),
    ).toBe(false);
    expect(wrapper.emitted("recovery")!.at(-1)).toEqual([null]);
  });
  it("removes idle memory when retention expires and does not restore an expired body", async () => {
    await flushPromises();
    vi.useFakeTimers();
    const now = Date.now();
    api.listGoalMemories.mockImplementation(async () => ({
      ...scope,
      goalRevision: 2,
      authorityExpiresAt: now + 60_000,
      items: [
        item({
          record: {
            ...item().record,
            retentionPolicy: { expiresAt: new Date(now + 1000).toISOString() },
          },
        }),
      ],
      nextCursor: null,
    }));
    await find("refresh").trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(
      wrapper.find('[data-testid="organization-memory-body"]').exists(),
    ).toBe(false);
  });
  it("removes idle facts and drafts at the grant deadline", async () => {
    await flushPromises();
    vi.useFakeTimers();
    const deadline = Date.now() + 1000;
    api.listGoalMemories.mockImplementation(async () => ({
      ...scope,
      goalRevision: 2,
      authorityExpiresAt: deadline,
      items: [item()],
      nextCursor: null,
    }));
    await find("refresh").trigger("click");
    await flushPromises();
    await find("content").setValue("Private draft");
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Sensitive shared fact");
    expect((find("content").element as HTMLTextAreaElement).value).toBe("");
    expect(wrapper.emitted("authority-error")).toHaveLength(1);
  });
  it("offers read-only members no shared write or delete buttons", async () => {
    await wrapper.setProps({ permissions: ["goal.read", "goal.memory.read"] });
    await flushPromises();
    expect(find("body").exists()).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
    expect(
      wrapper.find('[data-testid="organization-memory-delete"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="organization-memory-revoke"]').exists(),
    ).toBe(false);
  });
  it("recovers a delete with delete permission even after write permission is removed", async () => {
    await wrapper.setProps({
      permissions: ["goal.read", "goal.memory.read", "goal.memory.delete"],
    });
    await flushPromises();
    api.listGoalMemoryOperations.mockResolvedValueOnce({
      ...scope,
      items: [operation({ type: "delete", status: "denied" })],
      nextCursor: null,
    });
    await find("refresh").trigger("click");
    await flushPromises();
    await find("recover").trigger("click");
    await flushPromises();
    expect(api.recoverGoalMemory).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: "original-op",
    });
  });
  it("abandons an unknown save with a stable discard request", async () => {
    await flushPromises();
    api.createGoalMemory.mockRejectedValueOnce(new Error("Reply lost"));
    await submit();
    const source = api.createGoalMemory.mock.calls[0][0];
    api.discardGoalMemory.mockRejectedValueOnce(
      new Error("Discard reply lost"),
    );
    await find("discard-pending").trigger("click");
    await flushPromises();
    const input = api.discardGoalMemory.mock.calls[0][0];
    expect(input.operationRequestId).toBe(source.requestId);
    await find("retry").trigger("click");
    await flushPromises();
    expect(api.discardGoalMemory.mock.calls[1][0]).toEqual(input);
  });
  it("retains pending recovery through a same-goal revision change", async () => {
    await flushPromises();
    api.createGoalMemory.mockRejectedValueOnce(new Error("Reply lost"));
    await submit();
    const input = api.createGoalMemory.mock.calls[0][0];
    api.listGoalMemories.mockResolvedValueOnce({
      ...scope,
      goalRevision: 3,
      authorityExpiresAt: Date.now() + 60_000,
      items: [],
      nextCursor: null,
    });
    await wrapper.setProps({ goal: { ...goal, revision: 3 } });
    await flushPromises();
    await find("retry").trigger("click");
    await flushPromises();
    expect(api.recoverGoalMemory).toHaveBeenCalledWith({
      goalId: "g1",
      requestId: input.requestId,
    });
    expect(api.createGoalMemory).toHaveBeenCalledTimes(1);
  });
  it("blocks content over the byte limit and invalid expiry before IPC", async () => {
    await flushPromises();
    await find("content").setValue("中".repeat(3000));
    await wrapper.get("form").trigger("submit");
    expect(api.createGoalMemory).not.toHaveBeenCalled();
    await find("content").setValue("Valid note");
    await find("expiry").setValue("2000-01-01T00:00");
    await wrapper.get("form").trigger("submit");
    expect(api.createGoalMemory).not.toHaveBeenCalled();
  });
  it("unsubscribes and drops late reads after unmount", async () => {
    await flushPromises();
    const wait = deferred<any>();
    api.listGoalMemories.mockReturnValueOnce(wait.promise);
    await find("refresh").trigger("click");
    wrapper.unmount();
    wait.resolve({
      ...scope,
      goalRevision: 2,
      authorityExpiresAt: Date.now() + 60_000,
      items: [item()],
      nextCursor: null,
    });
    await flushPromises();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("shared memory through the organization workbench and real Kernel SQLite", () => {
  let f: any,
    wrapper: VueWrapper<any>,
    api: any,
    dialog: any,
    sharedGoal: any,
    directory: string,
    engine: any,
    store: any;
  beforeEach(async () => {
    wrapper = undefined as any;
    dialog = vi.fn(async () => ({ response: 1 }));
    directory = mkdtempSync(join(tmpdir(), "cc-organization-memory-ui-"));
    engine = null;
    store = null;
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
    const setup = await f.setup();
    const policy = {
      orgId: "org1",
      workflowIds: setup.workflowIds,
      permissions: setup.permissions.map((grant: any) => ({
        ...grant,
        permissions: [...new Set([...grant.permissions, ...permissions])],
      })),
    };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
    sharedGoal = (
      await f.host.createGoal(f.event, {
        projectId: "p1",
        requestId: "seed-goal",
        objective: "Shared memory delivery",
      })
    ).goal;
    api = Object.fromEntries(
      Object.keys(f.host).map((method) => [
        method,
        vi.fn(async (input: any) =>
          structuredClone(
            await f.host[method](f.event, structuredClone(input)),
          ),
        ),
      ]),
    );
    api.onGoalMemoryInvalidated = vi.fn(() => () => {});
    (window as any).electronAPI = { organizationProject: api };
    dialog.mockClear();
  });
  afterEach(async () => {
    wrapper?.unmount();
    await f.host.close();
    f.db.close();
    if (!directory.startsWith(join(tmpdir(), "cc-organization-memory-ui-")))
      throw new Error("Unexpected test directory");
    rmSync(directory, { recursive: true, force: true });
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });
  async function openWorkbench() {
    wrapper = mount(Workbench, {
      props: {
        open: true,
        projectId: "p1",
        identityKey: f.getActor() + ":session1",
      },
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
  async function save(text: string) {
    await wrapper
      .get('[data-testid="organization-memory-content"]')
      .setValue(text);
    await wrapper
      .get('[data-testid="organization-goal-memory-panel"] form')
      .trigger("submit");
    await flushPromises();
  }
  it("reaches shared memory from the workbench and lets another authorized member correct it", async () => {
    await openWorkbench();
    await save("Explicit shared business context");
    expect(wrapper.get('[data-testid="organization-memory-body"]').text()).toBe(
      "Explicit shared business context",
    );
    f.setActor(f.identities.first);
    await wrapper.setProps({ identityKey: f.getActor() + ":session2" });
    await flushPromises();
    expect(wrapper.get('[data-testid="organization-memory-body"]').text()).toBe(
      "Explicit shared business context",
    );
    await wrapper
      .get('[data-testid="organization-memory-edit"]')
      .trigger("click");
    await save("Corrected by another member");
    expect(wrapper.text()).not.toContain("Explicit shared business context");
    expect(wrapper.get('[data-testid="organization-memory-body"]').text()).toBe(
      "Corrected by another member",
    );
    const stored = f.host.getGoal(f.event, { id: sharedGoal.id });
    expect(stored.ownerRef).toBe(f.identities.requester);
    expect(JSON.stringify(stored)).not.toContain("Corrected by another member");
    expect(dialog).toHaveBeenCalledTimes(2);
  }, 15000);
  it("preserves the original unknown request across a full workbench refresh", async () => {
    await openWorkbench();
    api.createGoalMemory.mockImplementationOnce(async (input: any) => {
      await f.host.createGoalMemory(f.event, input);
      throw new Error("Lost committed reply");
    });
    await save("Committed once");
    const input = api.createGoalMemory.mock.calls[0][0];
    expect(
      wrapper.find('[data-testid="organization-memory-retry"]').exists(),
    ).toBe(true);
    await wrapper.get('[data-testid="refresh-organization"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-memory-retry"]')
      .trigger("click");
    await flushPromises();
    expect(api.recoverGoalMemory).toHaveBeenCalledWith({
      goalId: sharedGoal.id,
      requestId: input.requestId,
    });
    expect(api.createGoalMemory).toHaveBeenCalledTimes(1);
    expect(
      f.db
        .prepare("SELECT COUNT(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(1);
    expect(wrapper.get('[data-testid="organization-memory-body"]').text()).toBe(
      "Committed once",
    );
  }, 15000);
  it("retains body-free recovery through a parent goal refresh and clears it on identity change", async () => {
    api.createGoalMemory.mockRejectedValueOnce(new Error("Lost before reply"));
    wrapper = mount(GoalPanel, {
      props: {
        projectId: "p1",
        orgId: "org1",
        identityKey: f.getActor(),
        actorDid: f.getActor(),
        permissions,
      },
    });
    await flushPromises();
    await save("Do not persist draft upstairs");
    const input = api.createGoalMemory.mock.calls[0][0];
    await wrapper
      .get('[data-testid="organization-goal-refresh"]')
      .trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="organization-memory-retry"]')
      .trigger("click");
    await flushPromises();
    expect(api.recoverGoalMemory).toHaveBeenCalledWith({
      goalId: sharedGoal.id,
      requestId: input.requestId,
    });
    f.setActor(f.identities.first);
    await wrapper.setProps({
      identityKey: f.getActor(),
      actorDid: f.getActor(),
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="organization-memory-retry"]').exists(),
    ).toBe(false);
  }, 15000);
});
