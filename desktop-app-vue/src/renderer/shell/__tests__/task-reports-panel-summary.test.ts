import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: null as any,
  board: null as any,
  error: vi.fn(),
}));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => mocks.auth }));
vi.mock("@/stores/taskBoard", () => ({ useTaskBoardStore: () => mocks.board }));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("ant-design-vue", () => ({
  message: { error: mocks.error, success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@ant-design/icons-vue", () => ({
  FileTextOutlined: { template: "<i/>" },
  ReloadOutlined: { template: "<i/>" },
}));
import Component from "../TaskReportsPanel.vue";
import { useAppStore } from "../../stores/app";
import { useIdentityStore } from "../../stores/identity";
const row = (extra = {}) => ({
  id: "report-1",
  orgId: "org-1",
  authorName: "Member",
  yesterdayWork: "Current work",
  reportType: "daily_standup",
  reportDate: 100,
  aiSummary: "LEGACY SUMMARY",
  ...extra,
});
function pending() {
  let resolve!: (value: any) => void;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
describe("shell reports use governed summary component", () => {
  let pinia: ReturnType<typeof createPinia>;
  let wrapper: any, api: any, invalidate: () => void;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    useAppStore().isAuthenticated = true;
    useAppStore().deviceId = "device-1";
    mocks.auth = reactive({
      currentOrg: { id: "org-1" },
      currentUser: { did: "did:member" },
    });
    mocks.board = {
      reports: [row({ id: "cached", yesterdayWork: "STALE CACHE" })],
      generateAISummary: vi.fn(),
      loadReports: vi.fn(),
      createReport: vi.fn(),
    };
    mocks.error.mockClear();
    api = {
      getReports: vi
        .fn()
        .mockResolvedValue({ success: true, reports: [row()] }),
    };
    (window as any).electronAPI = {
      task: api,
      notification: {
        onInvalidated: (fn: any) => {
          invalidate = fn;
          return vi.fn();
        },
      },
    };
  });
  afterEach(() => {
    wrapper?.unmount();
    delete (window as any).electronAPI;
  });
  async function render() {
    const pass = {
      template: "<div><slot/><slot name='extra'/><slot name='actions'/></div>",
    };
    const stubs: any = {
      TaskReportSummary: true,
      FileTextOutlined: true,
      ReloadOutlined: true,
      "a-list": {
        props: ["dataSource"],
        template:
          "<div><slot v-for='item in dataSource' name='renderItem' :item='item'/></div>",
      },
    };
    for (const name of [
      "a-modal",
      "a-alert",
      "a-button",
      "a-row",
      "a-col",
      "a-card",
      "a-radio-group",
      "a-radio-button",
      "a-spin",
      "a-list-item",
      "a-list-item-meta",
      "a-avatar",
      "a-empty",
      "a-form",
      "a-form-item",
      "a-select",
      "a-select-option",
      "a-textarea",
      "a-statistic",
      "a-descriptions",
      "a-descriptions-item",
      "a-tag",
      "a-divider",
    ])
      stubs[name] = pass;
    wrapper = mount(Component, {
      props: { open: true },
      global: { plugins: [pinia], stubs },
    });
    await flushPromises();
  }
  it("reads scoped reports and never displays shared cached or legacy summaries", async () => {
    await render();
    expect(api.getReports).toHaveBeenCalledWith({
      orgId: "org-1",
      options: { limit: 50 },
    });
    expect(wrapper.text()).toContain("Current work");
    expect(wrapper.text()).not.toMatch(/LEGACY SUMMARY|STALE CACHE/u);
    expect(mocks.board.loadReports).not.toHaveBeenCalled();
    expect(mocks.board.generateAISummary).not.toHaveBeenCalled();
    wrapper.vm.viewReport(wrapper.vm.reports[0]);
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "TaskReportSummary" }).props(),
    ).toEqual({ reportId: "report-1" });
    expect(wrapper.text()).not.toContain("LEGACY SUMMARY");
  });
  it("refreshes source after governed summary completion", async () => {
    await render();
    wrapper.vm.viewReport(wrapper.vm.reports[0]);
    await flushPromises();
    wrapper.findComponent({ name: "TaskReportSummary" }).vm.$emit("updated");
    await flushPromises();
    expect(api.getReports).toHaveBeenCalledTimes(2);
    expect(mocks.board.generateAISummary).not.toHaveBeenCalled();
  });
  it.each(["logout", "device", "vault", "notification", "closed", "org"])(
    "clears summaries and fences late reports on %s",
    async (change) => {
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
      if (change === "notification") invalidate();
      if (change === "closed") await wrapper.setProps({ open: false });
      if (change === "org") {
        api.getReports.mockResolvedValue({ success: true, reports: [] });
        mocks.auth.currentOrg = { id: "org-2" };
      }
      call.resolve({ success: true, reports: [row()] });
      await flushPromises();
      expect(wrapper.text()).not.toContain("Current work");
      expect(
        wrapper.findComponent({ name: "TaskReportSummary" }).exists(),
      ).toBe(false);
    },
  );
  it("rejects reports for another organization with a fixed message", async () => {
    api.getReports.mockResolvedValue({
      success: true,
      reports: [row({ orgId: "org-secret" })],
    });
    await render();
    expect(wrapper.vm.reports).toEqual([]);
    expect(mocks.error).toHaveBeenCalledWith("加载报告失败");
  });
  it("preserves quick-report submission and unlocks after the authoritative reload", async () => {
    mocks.board.createReport.mockResolvedValue({ success: true });
    await render();
    wrapper.vm.quickReport.yesterdayWork = "New work";
    await wrapper.vm.submitQuickReport();
    await flushPromises();
    expect(api.getReports).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.submitting).toBe(false);
    expect(wrapper.vm.quickReport.yesterdayWork).toBe("");
  });
  it("does not let a late submission refresh a changed session", async () => {
    const call = pending();
    mocks.board.createReport.mockReturnValue(call.promise);
    await render();
    wrapper.vm.quickReport.yesterdayWork = "New work";
    const work = wrapper.vm.submitQuickReport();
    invalidate();
    call.resolve({ success: true });
    await work;
    expect(api.getReports).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.submitting).toBe(false);
    expect(wrapper.vm.reports).toEqual([]);
  });
});
