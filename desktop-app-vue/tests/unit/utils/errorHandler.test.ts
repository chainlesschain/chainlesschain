/**
 * errorHandler 测试 — src/renderer/utils/errorHandler.ts
 *
 * Error classification + AppError + the singleton handler (log/listeners) and
 * the standalone helpers. ant-design-vue message/notification are mocked so the
 * UI feedback paths don't touch the DOM.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const { message, notification } = vi.hoisted(() => ({
  message: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  notification: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("ant-design-vue", () => ({ message, notification }));

import errorHandler, {
  AppError,
  ErrorType,
  ErrorLevel,
  createError,
  handleError,
  withErrorHandling,
  handlePromise,
  withTimeout,
  isIPCNotReadyError,
  isSerializationError,
} from "@/utils/errorHandler";

beforeEach(() => {
  errorHandler.clearErrorLog();
  Object.values(message).forEach((f) => f.mockClear());
  Object.values(notification).forEach((f) => f.mockClear());
});

describe("errorHandler — normalizeError classification", () => {
  it("infers the type/level from the message", () => {
    expect(errorHandler.normalizeError(new Error("network down")).type).toBe(
      ErrorType.NETWORK,
    );
    const v = errorHandler.normalizeError(new Error("validation failed"));
    expect(v.type).toBe(ErrorType.VALIDATION);
    expect(v.level).toBe(ErrorLevel.WARNING);
    const ipc = errorHandler.normalizeError(new Error("No handler registered"));
    expect(ipc.type).toBe(ErrorType.IPC);
    expect(ipc.level).toBe(ErrorLevel.WARNING);
    expect(
      errorHandler.normalizeError(new Error("could not be cloned")).type,
    ).toBe(ErrorType.SERIALIZATION);
    expect(errorHandler.normalizeError(new Error("timeout reached")).type).toBe(
      ErrorType.TIMEOUT,
    );
    expect(errorHandler.normalizeError(new Error("weird thing")).type).toBe(
      ErrorType.UNKNOWN,
    );
  });

  it("returns an existing AppError unchanged", () => {
    const e = createError("x", ErrorType.NETWORK);
    expect(errorHandler.normalizeError(e)).toBe(e);
  });
});

describe("errorHandler — AppError + createError", () => {
  it("createError builds an AppError with a serializable shape", () => {
    const e = createError("boom", ErrorType.NETWORK, ErrorLevel.WARNING, {
      x: 1,
    });
    expect(e).toBeInstanceOf(AppError);
    expect(e.type).toBe(ErrorType.NETWORK);
    const json = e.toJSON();
    expect(json).toMatchObject({
      name: "AppError",
      message: "boom",
      type: ErrorType.NETWORK,
      level: ErrorLevel.WARNING,
    });
    expect(typeof json.timestamp).toBe("string");
  });
});

describe("errorHandler — handle + listeners + log", () => {
  it("normalizes, logs, shows a toast and notifies listeners", () => {
    const listener = vi.fn();
    errorHandler.addListener(listener);
    const err = errorHandler.handle(new Error("network x"));
    expect(err.type).toBe(ErrorType.NETWORK);
    expect(errorHandler.getErrorLog()).toHaveLength(1);
    expect(message.error).toHaveBeenCalledTimes(1); // ERROR level → message.error
    expect(listener).toHaveBeenCalledWith(err);
    errorHandler.removeListener(listener);
    listener.mockClear();
    errorHandler.handle(new Error("again"), { showMessage: false });
    expect(listener).not.toHaveBeenCalled();
  });

  it("exportErrorLog returns JSON; clearErrorLog empties it", () => {
    errorHandler.handle(new Error("a"), { showMessage: false });
    errorHandler.handle(new Error("b"), { showMessage: false });
    const arr = JSON.parse(errorHandler.exportErrorLog());
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(2);
    errorHandler.clearErrorLog();
    expect(errorHandler.getErrorLog()).toHaveLength(0);
  });

  it("getErrorTitle maps the type to a Chinese title", () => {
    expect(
      errorHandler.getErrorTitle(createError("x", ErrorType.NETWORK)),
    ).toBe("网络错误");
    expect(
      errorHandler.getErrorTitle(createError("x", ErrorType.UNKNOWN)),
    ).toBe("系统错误");
  });
});

describe("errorHandler — helper predicates", () => {
  it("isIPCNotReadyError / isSerializationError match the right messages", () => {
    expect(isIPCNotReadyError(new Error("No handler registered"))).toBe(true);
    expect(isIPCNotReadyError(new Error("ordinary"))).toBe(false);
    expect(isIPCNotReadyError(null)).toBe(false);
    expect(isSerializationError(new Error("could not be cloned"))).toBe(true);
    expect(isSerializationError(new Error("DataCloneError: x"))).toBe(true);
    expect(isSerializationError(new Error("ordinary"))).toBe(false);
  });
});

describe("errorHandler — async wrappers", () => {
  it("withErrorHandling handles + rethrows on failure, passes through on success", async () => {
    const ok = withErrorHandling(async () => 5, { showMessage: false });
    expect(await ok()).toBe(5);
    const bad = withErrorHandling(
      async () => {
        throw new Error("network boom");
      },
      { showMessage: false },
    );
    await expect(bad()).rejects.toThrow("network boom");
    expect(errorHandler.getErrorLog().length).toBeGreaterThan(0);
  });

  it("handlePromise reports the rejection then rethrows", async () => {
    await expect(
      handlePromise(Promise.reject(new Error("nope")), { showMessage: false }),
    ).rejects.toThrow("nope");
    expect(errorHandler.getErrorLog().length).toBeGreaterThan(0);
  });

  it("withTimeout resolves fast promises and rejects with a TIMEOUT error", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise(() => {}), 50).catch((e) => e);
      await vi.advanceTimersByTimeAsync(51);
      const err = await p;
      expect(err).toBeInstanceOf(AppError);
      expect(err.type).toBe(ErrorType.TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });
});
