import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { useAppStore } from "../app";
import { useIdentityStore } from "../identity";
import { useGoalNotificationsStore } from "../goal-notifications";

const reference = {
  schema: "chainlesschain.goal-notice-ref/v1",
  eventId: "n1",
  goalId: "g1",
  projectId: "p1",
  storeId: "store-1",
  sourceVersion: "v1",
};
const row = (overrides = {}) => ({
  id: "n1",
  type: "system",
  title: "SECRET CACHED TEXT",
  content: "SECRET OBJECTIVE",
  data: JSON.stringify(reference),
  is_read: 0,
  created_at: 100,
  ...overrides,
});
const reply = (rows = [row()]) => ({ success: true, notifications: rows });
const target = {
  goalId: "g1",
  projectId: "p1",
  storeId: "store-1",
  sourceVersion: "v1",
};
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (value: any) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("authoritative Goal notification cache", () => {
  let api: any,
    app: ReturnType<typeof useAppStore>,
    identity: ReturnType<typeof useIdentityStore>;
  let store: ReturnType<typeof useGoalNotificationsStore>,
    invalidated: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    app = useAppStore();
    app.isAuthenticated = true;
    app.deviceId = "device-1";
    identity = useIdentityStore();
    identity.primaryDID = "did:alice";
    api = {
      getGoals: vi.fn().mockResolvedValue(reply()),
      markRead: vi.fn().mockResolvedValue({ success: true }),
      openGoal: vi.fn().mockResolvedValue({ success: true, target }),
      onInvalidated: vi.fn((listener) => {
        invalidated = listener;
        return vi.fn();
      }),
      sendDesktop: vi.fn(),
    };
    (window as any).electronAPI = { notification: api };
    localStorage.clear();
    store = useGoalNotificationsStore();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as any).electronAPI;
  });

  it("keeps only reference metadata, never cached text, localStorage or desktop delivery", async () => {
    await store.load();
    expect(store.notices).toEqual([
      { id: "n1", isRead: false, createdAt: 100, sourceVersion: "v1" },
    ]);
    expect(JSON.stringify(store.$state)).not.toContain("SECRET");
    expect(localStorage.length).toBe(0);
    expect(api.sendDesktop).not.toHaveBeenCalled();
    expect(api.getGoals).toHaveBeenCalledWith({ limit: 50 });
  });
  it("does not load without authenticated UI state or an available fixed preload", async () => {
    app.isAuthenticated = false;
    await store.load();
    expect(api.getGoals).not.toHaveBeenCalled();
    app.isAuthenticated = true;
    delete (window as any).electronAPI;
    await store.load();
    expect(store.notices).toEqual([]);
  });
  it.each([
    { success: false, notifications: [row()] },
    [row()],
    reply([row({ data: "damaged" })]),
    reply([row({ data: JSON.stringify({ ...reference, eventId: "forged" }) })]),
  ])(
    "clears projections after a denied or malformed authoritative list %j",
    async (response) => {
      await store.load();
      api.getGoals.mockResolvedValueOnce(response);
      await store.load();
      expect(store.notices).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeTruthy();
    },
  );
  it("discards older success and finally callbacks while a newer read is running", async () => {
    const first = deferred(),
      second = deferred();
    api.getGoals
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const old = store.load(),
      fresh = store.load();
    first.resolve(reply());
    await old;
    expect(store.loading).toBe(true);
    expect(store.notices).toEqual([]);
    second.resolve(reply([row({ is_read: 1 })]));
    await fresh;
    expect(store.notices[0].isRead).toBe(true);
    expect(store.loading).toBe(false);
  });
  it("discards a late failure after a newer authoritative read", async () => {
    const first = deferred();
    api.getGoals.mockReturnValueOnce(first.promise);
    const old = store.load();
    await store.load();
    first.reject(new Error("old permission failure"));
    await old;
    expect(store.notices).toHaveLength(1);
    expect(store.error).toBe("");
  });
  it("clears immediately on logout and rejects a late result after same-device login", async () => {
    await store.load();
    const pending = deferred();
    api.getGoals.mockReturnValueOnce(pending.promise);
    const old = store.load();
    app.isAuthenticated = false;
    expect(store.notices).toEqual([]);
    app.isAuthenticated = true;
    pending.resolve(reply());
    await old;
    expect(store.notices).toEqual([]);
  });
  it("clears an already populated list synchronously on logout without another load", async () => {
    await store.load();
    expect(store.notices).toHaveLength(1);
    app.setAuthenticated(false);
    expect(store.notices).toEqual([]);
    expect(store.unreadCount).toBe(0);
    app.setAuthenticated(true);
    expect(store.notices).toEqual([]);
  });
  it("rejects a late list after device A changes to B and back to A in one turn", async () => {
    const pending = deferred();
    api.getGoals.mockReturnValueOnce(pending.promise);
    const old = store.load();
    app.setDeviceId("device-2");
    app.setDeviceId("device-1");
    pending.resolve(reply());
    await old;
    expect(store.notices).toEqual([]);
    expect(store.loading).toBe(false);
  });
  it("does not clear authorized notifications for unrelated app state changes", async () => {
    await store.load();
    app.sidebarCollapsed = !app.sidebarCollapsed;
    expect(store.notices).toHaveLength(1);
    expect(store.error).toBe("");
  });
  it("rejects late read acknowledgement after same-device reauthentication", async () => {
    await store.load();
    const pending = deferred();
    api.markRead.mockReturnValueOnce(pending.promise);
    const marking = store.markRead("n1");
    app.isAuthenticated = false;
    app.isAuthenticated = true;
    pending.resolve({ success: true });
    expect(await marking).toBe(false);
    expect(store.notices).toEqual([]);
    expect(store.error).toBe("");
  });
  it.each(["open", "mark", "recheck"])(
    "rejects an old navigation when login changes during %s",
    async (phase) => {
      const pending = deferred();
      const entered = deferred();
      const blocked = () => {
        entered.resolve(true);
        return pending.promise;
      };
      if (phase === "open") api.openGoal.mockImplementationOnce(blocked);
      else if (phase === "mark") api.markRead.mockImplementationOnce(blocked);
      else
        api.openGoal
          .mockResolvedValueOnce({ success: true, target })
          .mockImplementationOnce(blocked);
      const opening = store.open("n1");
      await entered.promise;
      if (phase === "recheck") expect(api.openGoal).toHaveBeenCalledTimes(2);
      if (phase === "mark") expect(api.markRead).toHaveBeenCalledOnce();
      app.$patch({ isAuthenticated: false });
      app.$patch({ isAuthenticated: true });
      pending.resolve(
        phase === "mark" ? { success: true } : { success: true, target },
      );
      expect(await opening).toBeNull();
      expect(store.notices).toEqual([]);
      if (phase === "open") expect(api.markRead).not.toHaveBeenCalled();
      expect(store.error).toBe("");
    },
  );
  it("does not let an old session failure erase the new session list", async () => {
    const pending = deferred();
    api.getGoals.mockReturnValueOnce(pending.promise);
    const old = store.load();
    app.isAuthenticated = false;
    app.isAuthenticated = true;
    await store.load();
    pending.reject(new Error("old session denied"));
    await old;
    expect(store.notices).toHaveLength(1);
    expect(store.error).toBe("");
  });
  it.each(["primaryDID", "currentContext", "database"])(
    "clears projections when identity %s changes",
    async (field) => {
      await store.load();
      if (field === "primaryDID") identity.primaryDID = "did:bob";
      else if (field === "currentContext")
        identity.currentContext = "organization:bob";
      else identity.contexts.personal.localDB = "another.db";
      expect(store.notices).toEqual([]);
    },
  );
  it("does not let an older list turn a read notification unread", async () => {
    await store.load();
    const pending = deferred();
    api.getGoals.mockReturnValueOnce(pending.promise);
    const old = store.load();
    expect(await store.markRead("n1")).toBe(true);
    pending.resolve(reply());
    await old;
    expect(store.notices).toEqual([]);
    await store.load();
  });
  it("clears all projections when marking fails and never simulates success", async () => {
    await store.load();
    api.markRead.mockResolvedValueOnce({ success: false });
    expect(await store.markRead("n1")).toBe(false);
    expect(store.notices).toEqual([]);
    expect(store.error).toBeTruthy();
  });
  it("opens only through current host authorization, read mutation, and a second source check", async () => {
    await store.load();
    expect(await store.open("n1")).toEqual(target);
    expect(api.openGoal).toHaveBeenCalledTimes(2);
    expect(api.markRead).toHaveBeenCalledWith("n1");
    expect(store.notices[0].isRead).toBe(true);
  });
  it("does not use a cached project reference when the host denies opening", async () => {
    await store.load();
    api.openGoal.mockResolvedValueOnce({ success: false });
    expect(await store.open("n1")).toBeNull();
    expect(api.markRead).not.toHaveBeenCalled();
    expect(store.notices).toEqual([]);
  });
  it("rejects source changes between open and read acknowledgement", async () => {
    api.openGoal
      .mockResolvedValueOnce({ success: true, target })
      .mockResolvedValueOnce({
        success: true,
        target: { ...target, sourceVersion: "v2" },
      });
    expect(await store.open("n1")).toBeNull();
    expect(store.notices).toEqual([]);
  });
  it("shares polling and removes listeners only after both centers detach", async () => {
    const first = store.attach(),
      second = store.attach();
    await Promise.resolve();
    expect(api.onInvalidated).toHaveBeenCalledOnce();
    expect(api.getGoals).toHaveBeenCalledOnce();
    invalidated();
    expect(store.notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getGoals).toHaveBeenCalledTimes(2);
    first();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getGoals).toHaveBeenCalledTimes(3);
    second();
    expect(api.onInvalidated.mock.results[0].value).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getGoals).toHaveBeenCalledTimes(3);
    expect(store.notices).toEqual([]);
  });
  it("fences a host invalidation while an open IPC is in flight", async () => {
    const detach = store.attach();
    await Promise.resolve();
    const pending = deferred();
    api.openGoal.mockReturnValueOnce(pending.promise);
    const opening = store.open("n1");
    invalidated();
    pending.resolve({ success: true, target });
    expect(await opening).toBeNull();
    expect(api.markRead).not.toHaveBeenCalled();
    detach();
  });
});
