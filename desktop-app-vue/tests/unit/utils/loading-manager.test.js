/**
 * loadingManager 测试 — src/renderer/utils/loadingManager.ts
 *
 * Keyed loading-state manager + async wrappers. `message` (ant) mocked;
 * unique keys per test isolate the shared singleton.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

const message = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("ant-design-vue", () => ({ message }));

import {
  useLoading,
  withLoading,
  withBatchLoading,
  withDebounceLoading,
  withThrottleLoading,
  useAsyncData,
} from "@/utils/loadingManager";

afterEach(() => {
  message.success.mockClear();
  message.error.mockClear();
  message.warning.mockClear();
});

let n = 0;
const key = () => `k-${++n}`;

describe("useLoading — lifecycle", () => {
  it("start → finish updates loading/progress/data", () => {
    const l = useLoading(key());
    l.start("loading...");
    expect(l.isLoading.value).toBe(true);
    expect(l.progress.value).toBe(0);
    l.finish({ ok: 1 });
    expect(l.isLoading.value).toBe(false);
    expect(l.progress.value).toBe(100);
    expect(l.data.value).toEqual({ ok: 1 });
  });

  it("updateProgress clamps to 0..100", () => {
    const l = useLoading(key());
    l.updateProgress(150);
    expect(l.progress.value).toBe(100);
    l.updateProgress(-5);
    expect(l.progress.value).toBe(0);
  });

  it("fail records the error and stops loading; reset clears", () => {
    const l = useLoading(key());
    l.start();
    l.fail(new Error("boom"));
    expect(l.isLoading.value).toBe(false);
    expect(l.error.value.message).toBe("boom");
    l.reset();
    expect(l.error.value).toBeNull();
    expect(l.progress.value).toBe(0);
    expect(l.data.value).toBeNull();
  });
});

describe("withLoading", () => {
  it("runs fn, finishes with the result, exposes progress + success toast", async () => {
    const k = key();
    const l = useLoading(k);
    const r = await withLoading(
      k,
      async (updateProgress) => {
        updateProgress(50);
        expect(l.progress.value).toBe(50);
        return "done";
      },
      { showSuccess: true, successMessage: "ok!" },
    );
    expect(r).toBe("done");
    expect(l.data.value).toBe("done");
    expect(message.success).toHaveBeenCalledWith("ok!");
  });

  it("on failure: fails the state, shows error toast, rethrows", async () => {
    const k = key();
    const l = useLoading(k);
    await expect(
      withLoading(
        k,
        async () => {
          throw new Error("nope");
        },
        { errorMessage: "failed" },
      ),
    ).rejects.toThrow("nope");
    expect(l.error.value.message).toBe("nope");
    expect(message.error).toHaveBeenCalledWith("failed");
  });
});

describe("withBatchLoading", () => {
  it("collects per-op results and warns on partial failure", async () => {
    const results = await withBatchLoading([
      async () => "a",
      async () => {
        throw new Error("x");
      },
      async () => "c",
    ]);
    expect(results.map((r) => r.success)).toEqual([true, false, true]);
    expect(results[0].data).toBe("a");
    expect(results[1].error.message).toBe("x");
    expect(message.warning).toHaveBeenCalled();
  });

  it("success toast when all succeed", async () => {
    await withBatchLoading([async () => 1, async () => 2]);
    expect(message.success).toHaveBeenCalled();
  });

  it("error toast when all fail", async () => {
    await withBatchLoading([
      async () => {
        throw new Error("e1");
      },
      async () => {
        throw new Error("e2");
      },
    ]);
    expect(message.error).toHaveBeenCalledWith("所有操作都失败了");
  });
});

describe("withDebounceLoading", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces then resolves with the result", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue("R");
    const d = withDebounceLoading(key(), fn, 100);
    const p = d();
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe("R");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when that key is already loading", async () => {
    const k = key();
    useLoading(k).start();
    const d = withDebounceLoading(k, vi.fn().mockResolvedValue("R"), 100);
    await expect(d()).resolves.toBeUndefined();
  });
});

describe("withThrottleLoading", () => {
  it("runs the first call and throttles an immediate second", async () => {
    const fn = vi.fn().mockResolvedValue("R");
    const t = withThrottleLoading(key(), fn, 10000);
    await expect(t()).resolves.toBe("R");
    await expect(t()).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("useAsyncData", () => {
  it("execute fetches, fills data, calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const ad = useAsyncData(key(), async (x) => `got-${x}`, {
      immediate: false,
      onSuccess,
    });
    const r = await ad.execute("a");
    expect(r).toBe("got-a");
    expect(ad.data.value).toBe("got-a");
    expect(onSuccess).toHaveBeenCalledWith("got-a");
  });

  it("execute failure calls onError and rethrows", async () => {
    const onError = vi.fn();
    const ad = useAsyncData(
      key(),
      async () => {
        throw new Error("bad");
      },
      { immediate: false, onError },
    );
    await expect(ad.execute()).rejects.toThrow("bad");
    expect(onError).toHaveBeenCalled();
    expect(ad.error.value.message).toBe("bad");
  });
});
