import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  installWindowsSandboxAdapterTestCleanup,
  WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV,
} from "../../test/helpers/windows-sandbox-adapter-cleanup.js";

describe("Windows sandbox adapter Vitest cleanup", () => {
  it("sets TTL zero, resets at suite teardown, and restores a prior value", () => {
    const env = { [WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV]: "1234" };
    const reset = vi.fn(() => true);
    let teardown;

    expect(
      installWindowsSandboxAdapterTestCleanup({
        platform: "win32",
        env,
        reset,
        registerAfterAll: (callback) => {
          teardown = callback;
        },
      }),
    ).toEqual({ installed: true });
    expect(env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV]).toBe("0");

    teardown();

    expect(reset).toHaveBeenCalledOnce();
    expect(env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV]).toBe("1234");
  });

  it("removes a suite-created value even when reset throws", () => {
    const env = {};
    let teardown;

    installWindowsSandboxAdapterTestCleanup({
      platform: "win32",
      env,
      reset: () => {
        throw new Error("cleanup failed");
      },
      registerAfterAll: (callback) => {
        teardown = callback;
      },
    });

    expect(() => teardown()).toThrow("cleanup failed");
    expect(env).not.toHaveProperty(WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV);
  });

  it("does nothing outside Windows", () => {
    const env = { [WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV]: "preserve" };
    const registerAfterAll = vi.fn();
    const reset = vi.fn();

    expect(
      installWindowsSandboxAdapterTestCleanup({
        platform: "linux",
        env,
        registerAfterAll,
        reset,
      }),
    ).toEqual({ installed: false });
    expect(env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV]).toBe("preserve");
    expect(registerAfterAll).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "win32")(
    "is inherited by a real child process",
    () => {
      expect(process.env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV]).toBe("0");
      const child = spawnSync(
        process.execPath,
        ["-p", `process.env.${WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV}`],
        { encoding: "utf8" },
      );

      expect(child.status).toBe(0);
      expect(child.stdout.trim()).toBe("0");
    },
  );
});
