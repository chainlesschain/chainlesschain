export const WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV =
  "CC_WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_MS";

/**
 * Keep Windows helper artifacts suite-local during Vitest runs. Setting the
 * value on process.env also makes real CLI children inherit the zero TTL.
 * Production entry points never import this test helper.
 */
export function installWindowsSandboxAdapterTestCleanup({
  platform = process.platform,
  env = process.env,
  registerAfterAll,
  reset,
} = {}) {
  if (platform !== "win32") {
    return { installed: false };
  }
  if (typeof registerAfterAll !== "function") {
    throw new TypeError("Windows sandbox adapter teardown must be registered");
  }
  if (typeof reset !== "function") {
    throw new TypeError("Windows sandbox adapter reset must be a function");
  }

  const hadPreviousValue = Object.hasOwn(
    env,
    WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV,
  );
  const previousValue = env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV];
  env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV] = "0";

  registerAfterAll(() => {
    try {
      if (!reset()) {
        throw new Error(
          "Windows sandbox adapter cleanup did not remove every temporary artifact",
        );
      }
    } finally {
      if (hadPreviousValue) {
        env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV] = previousValue;
      } else {
        delete env[WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_ENV];
      }
    }
  });

  return { installed: true };
}
