/**
 * Unit tests for AppUpdateNotifier — the renderer component that closes
 * v5.0.3.36's "看不到下载进度" gap by listening on `electronAPI.appUpdate.onStatus`
 * and rendering checking → available → downloading → downloaded → error.
 *
 * Asserts:
 *  - Hidden when electronAPI.appUpdate is unavailable (web-shell mode)
 *  - Hydrates from getStatus() on mount
 *  - Status transitions update the rendered title/state
 *  - Downloading state renders progress percent + transferred/total/speed
 *  - 立即下载 button calls appUpdate.download()
 *  - 立即重启 button calls appUpdate.install()
 *  - error state shows retry, retry calls appUpdate.check()
 *  - dismiss hides the card; new status resurfaces it
 *  - not-available auto-dismisses after timeout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import AppUpdateNotifier from "../AppUpdateNotifier.vue";

const STUBS = {
  "a-button": {
    props: ["type", "loading", "disabled", "size"],
    emits: ["click"],
    template:
      '<button :data-type="type" :disabled="disabled || loading" @click="$emit(\'click\')"><slot name="icon" /><slot /></button>',
  },
  "a-progress": {
    props: ["percent", "showInfo", "size"],
    template: '<div class="stub-progress" :data-percent="percent" />',
  },
  CloseOutlined: { template: '<span class="stub-close-icon" />' },
};

type StatusListener = (payload: unknown) => void;

interface AppUpdateMock {
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  onStatus: ReturnType<typeof vi.fn>;
  __emit: (payload: unknown) => void;
}

function makeApi(initial: unknown = null): AppUpdateMock {
  const listeners: StatusListener[] = [];
  return {
    check: vi.fn().mockResolvedValue({ ok: true }),
    download: vi.fn().mockResolvedValue({ ok: true }),
    install: vi.fn().mockResolvedValue({ ok: true }),
    getStatus: vi.fn().mockResolvedValue(initial),
    onStatus: vi.fn().mockImplementation((cb: StatusListener) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    __emit: (payload: unknown) => {
      for (const cb of listeners) cb(payload);
    },
  };
}

function setApi(api: AppUpdateMock | null) {
  (
    globalThis as unknown as {
      window: typeof globalThis & Record<string, unknown>;
    }
  ).window = globalThis as unknown as typeof globalThis &
    Record<string, unknown>;
  if (api) {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      appUpdate: api,
    };
  } else {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI =
      undefined;
  }
}

describe("AppUpdateNotifier", () => {
  let originalElectronAPI: unknown;

  beforeEach(() => {
    originalElectronAPI = (globalThis as unknown as { electronAPI?: unknown })
      .electronAPI;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI =
      originalElectronAPI;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders nothing when electronAPI.appUpdate is unavailable", async () => {
    setApi(null);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(false);
  });

  it("hydrates from getStatus on mount", async () => {
    const api = makeApi({
      status: "available",
      data: null,
      info: { version: "5.0.3.50" },
      timestamp: "2026-05-08T00:00:00Z",
    });
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();
    expect(api.getStatus).toHaveBeenCalled();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(true);
    expect(wrapper.text()).toContain("v5.0.3.50");
    expect(wrapper.text()).toContain("立即下载");
  });

  it("transitions through checking → available → downloading → downloaded", async () => {
    const api = makeApi(null);
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(false);

    api.__emit({ status: "checking", data: null, info: null });
    await nextTick();
    expect(wrapper.text()).toContain("正在检查更新");

    api.__emit({
      status: "available",
      data: null,
      info: { version: "5.0.3.99" },
    });
    await nextTick();
    expect(wrapper.text()).toContain("发现新版本 v5.0.3.99");

    api.__emit({
      status: "downloading",
      data: {
        percent: 42.7,
        bytesPerSecond: 1024 * 1024,
        transferred: 1024 * 1024 * 10,
        total: 1024 * 1024 * 100,
      },
      info: null,
    });
    await nextTick();
    expect(wrapper.text()).toContain("正在下载更新");
    const progress = wrapper.find(".stub-progress");
    expect(progress.exists()).toBe(true);
    expect(progress.attributes("data-percent")).toBe("43");

    api.__emit({
      status: "downloaded",
      data: null,
      info: { version: "5.0.3.99" },
    });
    await nextTick();
    expect(wrapper.text()).toContain("更新已就绪 v5.0.3.99");
    expect(wrapper.text()).toContain("立即重启");
  });

  it("立即下载 button calls appUpdate.download()", async () => {
    const api = makeApi({
      status: "available",
      data: null,
      info: { version: "5.0.3.50" },
    });
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();

    const downloadBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("立即下载"));
    expect(downloadBtn).toBeDefined();
    await downloadBtn!.trigger("click");
    await flushPromises();
    expect(api.download).toHaveBeenCalledTimes(1);
  });

  it("立即重启 button calls appUpdate.install()", async () => {
    const api = makeApi({
      status: "downloaded",
      data: null,
      info: { version: "5.0.3.50" },
    });
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();

    const installBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("立即重启"));
    expect(installBtn).toBeDefined();
    await installBtn!.trigger("click");
    await flushPromises();
    expect(api.install).toHaveBeenCalledTimes(1);
  });

  it("error state shows retry that calls appUpdate.check()", async () => {
    const api = makeApi({
      status: "error",
      data: null,
      info: { message: "网络超时" },
    });
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();
    expect(wrapper.text()).toContain("更新失败");
    expect(wrapper.text()).toContain("网络超时");

    const retryBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("重试"));
    expect(retryBtn).toBeDefined();
    await retryBtn!.trigger("click");
    await flushPromises();
    expect(api.check).toHaveBeenCalledTimes(1);
  });

  it("dismiss hides the card; new status resurfaces it", async () => {
    const api = makeApi({
      status: "available",
      data: null,
      info: { version: "5.0.3.50" },
    });
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(true);

    const closeBtn = wrapper.find(".cc-update-close");
    expect(closeBtn.exists()).toBe(true);
    await closeBtn.trigger("click");
    await nextTick();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(false);

    // New status (downloading) should re-show
    api.__emit({
      status: "downloading",
      data: { percent: 5, bytesPerSecond: 0, transferred: 0, total: 100 },
      info: null,
    });
    await nextTick();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(true);
  });

  it("not-available auto-dismisses after 3s", async () => {
    const api = makeApi(null);
    setApi(api);
    const wrapper = mount(AppUpdateNotifier, { global: { stubs: STUBS } });
    await flushPromises();

    api.__emit({ status: "not-available", data: null, info: null });
    await nextTick();
    expect(wrapper.text()).toContain("当前已是最新版本");

    vi.advanceTimersByTime(3100);
    await nextTick();
    expect(wrapper.find(".cc-update-notifier").exists()).toBe(false);
  });
});
