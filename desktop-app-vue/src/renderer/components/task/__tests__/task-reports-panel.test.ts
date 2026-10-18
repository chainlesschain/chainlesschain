import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import Component from "../TaskReportsPanel.vue";
import { useAppStore } from "../../../stores/app";
import { useIdentityStore } from "../../../stores/identity";
const row = (extra = {}) => ({
  id: "report-1",
  orgId: "org-1",
  boardId: "board-1",
  updatedAt: 100,
  reportType: "daily_standup",
  yesterdayWork: "Completed work",
  todayPlan: "Plan",
  blockers: "",
  notes: "Notes",
  ...extra,
});
const result = (rows = [row()]) => ({ success: true, reports: rows });
function pending() {
  let resolve!: (value: any) => void;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
describe("task reports panel", () => {
  let wrapper: any, api: any, invalidate: () => void, unsubscribe: any;
  beforeEach(() => {
    setActivePinia(createPinia());
    useAppStore().isAuthenticated = true;
    useAppStore().deviceId = "device-1";
    api = { getReports: vi.fn().mockResolvedValue(result()) };
    unsubscribe = vi.fn();
    (window as any).electronAPI = {
      task: api,
      notification: {
        onInvalidated: vi.fn((fn) => {
          invalidate = fn;
          return unsubscribe;
        }),
      },
    };
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
  });
  async function render() {
    wrapper = mount(Component, {
      props: { orgId: "org-1", boardId: "board-1" },
      global: {
        stubs: {
          TaskReportSummary: true,
          "a-button": { template: "<button><slot /></button>" },
        },
      },
    });
    await flushPromises();
  }
  it("loads the bounded current board and strips legacy summaries and extra fields", async () => {
    api.getReports.mockResolvedValue(
      result([row({ aiSummary: "UNVERIFIED", secret: "SECRET" })]),
    );
    await render();
    expect(api.getReports).toHaveBeenCalledWith({
      orgId: "org-1",
      options: { boardId: "board-1", limit: 20 },
    });
    expect(wrapper.text()).toContain("Completed work");
    expect(wrapper.text()).not.toContain("UNVERIFIED");
    expect(JSON.stringify(wrapper.vm.reports)).not.toContain("SECRET");
    expect(
      wrapper.findComponent({ name: "TaskReportSummary" }).props(),
    ).toEqual({ reportId: "report-1" });
  });
  it("refreshes the source after summary completion", async () => {
    await render();
    api.getReports.mockResolvedValue(
      result([row({ yesterdayWork: "Changed", updatedAt: 200 })]),
    );
    wrapper.findComponent({ name: "TaskReportSummary" }).vm.$emit("updated");
    await flushPromises();
    expect(api.getReports).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Changed");
  });
  it("renders source text safely", async () => {
    api.getReports.mockResolvedValue(
      result([row({ notes: '<img src="secret">' })]),
    );
    await render();
    expect(wrapper.text()).toContain("<img");
    expect(wrapper.findAll("img,iframe,script")).toHaveLength(0);
  });
  it.each([
    [row({ orgId: "org-2" })],
    [row({ boardId: "board-2" })],
    [row({ updatedAt: "now" })],
    [row(), row()],
    Array.from({ length: 21 }, (_, i) => row({ id: `report-${i}` })),
  ])("rejects mismatched or unbounded reports %#", async (...rows) => {
    api.getReports.mockResolvedValue(result(rows as any));
    await render();
    expect(wrapper.findAll("[data-report-id]")).toHaveLength(0);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it("clears old source on failed refresh without logging or exposing native errors", async () => {
    await render();
    api.getReports.mockRejectedValue(new Error("SECRET"));
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Completed work");
    expect(wrapper.text()).not.toContain("SECRET");
  });
  it.each([
    "logout",
    "device",
    "vault",
    "did",
    "notification",
    "unmount",
    "board",
  ])("fences stale report reads on %s", async (change) => {
    const call = pending();
    api.getReports.mockReturnValueOnce(call.promise);
    await render();
    if (change === "logout") {
      useAppStore().isAuthenticated = false;
      useAppStore().isAuthenticated = true;
    }
    if (change === "device") {
      useAppStore().deviceId = "other";
      useAppStore().deviceId = "device-1";
    }
    if (change === "vault") useIdentityStore().currentContext = "org_other";
    if (change === "did") useIdentityStore().primaryDID = "did:other";
    if (change === "notification") invalidate();
    if (change === "unmount") wrapper.unmount();
    if (change === "board") {
      api.getReports.mockResolvedValue(result([]));
      await wrapper.setProps({ boardId: "board-2" });
    }
    call.resolve(result());
    await flushPromises();
    if (change !== "unmount")
      expect(wrapper.findAll("[data-report-id]")).toHaveLength(0);
  });
  it("does not fetch while unauthenticated and cleans up subscriptions", async () => {
    useAppStore().isAuthenticated = false;
    await render();
    expect(api.getReports).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
