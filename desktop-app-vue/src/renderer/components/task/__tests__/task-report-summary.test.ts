import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import Component from "../TaskReportSummary.vue";
import { useAppStore } from "../../../stores/app";
import { useIdentityStore } from "../../../stores/identity";

function pending() {
  let resolve!: (value: any) => void;
  let reject!: (value: any) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
const result = (status = "succeeded", extra = {}) => ({
  success: true,
  run: {
    requestId: "request-1",
    status,
    provider: "ollama",
    model: "local-model",
    sourceHash: "hash",
    createdAt: 1,
    updatedAt: 2,
    usage: null,
  },
  ...(status === "succeeded" ? { summary: "Current summary" } : {}),
  ...extra,
});

describe("task report summary", () => {
  let wrapper: any, api: any, invalidate: () => void, unsubscribe: any;
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    useAppStore().isAuthenticated = true;
    useAppStore().deviceId = "device-1";
    api = {
      getSummaryStatus: vi.fn().mockResolvedValue(result()),
      generateAISummary: vi.fn().mockImplementation(async ({ requestId }) => ({
        ...result(),
        run: { ...result().run, requestId },
      })),
      cancelSummary: vi.fn().mockImplementation(async ({ requestId }) => ({
        ...result("cancelled"),
        run: { ...result("cancelled").run, requestId },
      })),
    };
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
    vi.restoreAllMocks();
  });
  async function render() {
    wrapper = mount(Component, {
      props: { reportId: "report-1" },
      global: {
        plugins: [pinia],
        stubs: { "a-button": { template: "<button><slot /></button>" } },
      },
    });
    await flushPromises();
  }
  async function action(name: string) {
    await wrapper.find(`[data-action="${name}"]`).trigger("click");
    await flushPromises();
  }
  it("only reads current status on mount and retains a minimal projection", async () => {
    api.getSummaryStatus.mockResolvedValue(
      result("succeeded", { secret: "SECRET" }),
    );
    await render();
    expect(api.getSummaryStatus).toHaveBeenCalledWith({ reportId: "report-1" });
    expect(api.generateAISummary).not.toHaveBeenCalled();
    expect(wrapper.find("pre").text()).toBe("Current summary");
    expect(wrapper.vm.run).toEqual({
      requestId: "request-1",
      status: "succeeded",
    });
  });
  it("sends only report ID and a fresh nonce, then requests authoritative reload", async () => {
    await render();
    await action("generate");
    const params = api.generateAISummary.mock.calls[0][0];
    expect(Object.keys(params).sort()).toEqual(["reportId", "requestId"]);
    expect(params.reportId).toBe("report-1");
    expect(params.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(wrapper.emitted("updated")).toHaveLength(1);
    await action("generate");
    expect(api.generateAISummary.mock.calls[1][0].requestId).not.toBe(
      params.requestId,
    );
  });
  it.each([
    "prepared",
    "dispatched",
    "cancelled",
    "stale",
    "failed",
    "unknown",
  ])("queries %s without replaying generation", async (status) => {
    api.getSummaryStatus.mockResolvedValue(result(status));
    await render();
    await action("status");
    expect(api.generateAISummary).not.toHaveBeenCalled();
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.find("[data-summary-status]").exists()).toBe(true);
  });
  it("renders model output as plain text", async () => {
    api.getSummaryStatus.mockResolvedValue(
      result("succeeded", { summary: '<img src=x onerror="oops()">' }),
    );
    await render();
    expect(wrapper.find("pre").text()).toContain("<img");
    expect(wrapper.findAll("img,iframe,object,embed,script")).toHaveLength(0);
  });
  it("marks lost dispatch replies unknown without retry or raw errors", async () => {
    api.generateAISummary.mockRejectedValue(new Error("SECRET response BODY"));
    await render();
    await action("generate");
    expect(wrapper.text()).toContain("结果未知");
    expect(wrapper.text()).not.toContain("SECRET");
    expect(api.generateAISummary).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("updated")).toBeUndefined();
  });
  it("native dialog cancellation is terminal and does not refresh or resend", async () => {
    api.generateAISummary.mockImplementation(async ({ requestId }) => ({
      ...result("cancelled"),
      run: { ...result("cancelled").run, requestId },
    }));
    await render();
    await action("generate");
    expect(wrapper.text()).toContain("请求已取消");
    expect(wrapper.emitted("updated")).toBeUndefined();
    expect(api.generateAISummary).toHaveBeenCalledTimes(1);
  });
  it("can end an unknown wait with the original nonce after a lost reply", async () => {
    api.generateAISummary.mockRejectedValue(new Error("lost reply"));
    api.cancelSummary.mockImplementation(async ({ requestId }) => ({
      ...result("unknown"),
      run: { ...result("unknown").run, requestId },
    }));
    await render();
    await action("generate");
    const requestId = api.generateAISummary.mock.calls[0][0].requestId;
    expect(wrapper.find('[data-action="cancel"]').text()).toBe("结束本次等待");
    await action("cancel");
    expect(api.cancelSummary).toHaveBeenCalledWith({
      reportId: "report-1",
      requestId,
    });
    expect(api.generateAISummary).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("结果未知");
  });
  it("cancels the exact pending nonce and fences its late success", async () => {
    const call = pending();
    api.generateAISummary.mockReturnValue(call.promise);
    await render();
    await action("generate");
    const params = api.generateAISummary.mock.calls[0][0];
    await action("cancel");
    expect(api.cancelSummary).toHaveBeenCalledWith(params);
    call.resolve({
      ...result(),
      run: { ...result().run, requestId: params.requestId },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("请求已取消");
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.emitted("updated")).toBeUndefined();
  });
  it("failed cancellation remains unknown and never implies remote erasure", async () => {
    api.getSummaryStatus.mockResolvedValue(result("dispatched"));
    api.cancelSummary.mockRejectedValue(new Error("SECRET"));
    await render();
    await action("cancel");
    expect(wrapper.text()).toContain("结果未知");
    expect(wrapper.text()).not.toContain("SECRET");
    expect(api.generateAISummary).not.toHaveBeenCalled();
  });
  it.each([
    result("unknown", { success: false, summary: "untrusted" }),
    result("succeeded", { summary: "x".repeat(65537) }),
    result("succeeded", { run: { ...result().run, provider: "cloud" } }),
    result("succeeded", { run: { ...result().run, status: "__proto__" } }),
  ])("rejects malformed success projections %#", async (response) => {
    api.getSummaryStatus.mockResolvedValue(response);
    await render();
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it("rejects a generate result for a different nonce", async () => {
    api.generateAISummary.mockResolvedValue(result());
    await render();
    await action("generate");
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.emitted("updated")).toBeUndefined();
  });
  it.each(["unknown", "cancelled"])(
    "accepts an empty status and a verified prior summary alongside latest %s",
    async (status) => {
      api.getSummaryStatus.mockResolvedValue({ success: true, summary: null });
      await render();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      api.getSummaryStatus.mockResolvedValue(
        result(status, { summary: "Verified prior summary" }),
      );
      await action("status");
      expect(wrapper.find("pre").text()).toBe("Verified prior summary");
      expect(wrapper.text()).toContain(
        status === "unknown" ? "结果未知" : "请求已取消",
      );
    },
  );
  it("fences a late generated summary after authentication ABA", async () => {
    const call = pending();
    api.generateAISummary.mockReturnValue(call.promise);
    await render();
    await action("generate");
    const requestId = api.generateAISummary.mock.calls[0][0].requestId;
    useAppStore().isAuthenticated = false;
    useAppStore().isAuthenticated = true;
    call.resolve({ ...result(), run: { ...result().run, requestId } });
    await flushPromises();
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.emitted("updated")).toBeUndefined();
  });
  it.each([
    "logout",
    "device",
    "vault",
    "did",
    "notification",
    "unmount",
    "report",
  ])("fences pending status across %s changes", async (change) => {
    const call = pending();
    api.getSummaryStatus.mockReturnValueOnce(call.promise);
    await render();
    if (change === "logout") {
      useAppStore().isAuthenticated = false;
      useAppStore().isAuthenticated = true;
    }
    if (change === "device") {
      useAppStore().deviceId = "device-2";
      useAppStore().deviceId = "device-1";
    }
    if (change === "vault") useIdentityStore().currentContext = "org_other";
    if (change === "did") useIdentityStore().primaryDID = "did:other";
    if (change === "notification") invalidate();
    if (change === "unmount") wrapper.unmount();
    if (change === "report") {
      api.getSummaryStatus.mockResolvedValue({ success: true });
      await wrapper.setProps({ reportId: "report-2" });
    }
    call.resolve(result());
    await flushPromises();
    if (change !== "unmount") expect(wrapper.find("pre").exists()).toBe(false);
    expect(api.generateAISummary).not.toHaveBeenCalled();
  });
  it("does not send while unauthenticated and removes listeners on unmount", async () => {
    useAppStore().isAuthenticated = false;
    await render();
    await action("generate");
    expect(api.getSummaryStatus).not.toHaveBeenCalled();
    expect(api.generateAISummary).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
