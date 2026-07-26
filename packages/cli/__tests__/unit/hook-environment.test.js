import { describe, expect, it } from "vitest";
import hookEnvironment from "../../src/lib/hook-environment.cjs";

const { buildManagedHookEnvironment } = hookEnvironment;

describe("managed hook environment", () => {
  it("inherits only the safe baseline and explicit protocol values", () => {
    const env = buildManagedHookEnvironment({
      source: {
        PATH: "/bin",
        TEMP: "/tmp",
        API_TOKEN: "secret",
        NODE_OPTIONS: "--require evil.js",
      },
      values: { HOOK_EVENT: "PreToolUse" },
    });

    expect(env).toEqual({
      PATH: "/bin",
      TEMP: "/tmp",
      HOOK_EVENT: "PreToolUse",
    });
  });

  it("requires both managed approval and a hook request for extra keys", () => {
    const source = {
      PATH: "/bin",
      APPROVED_VALUE: "yes",
      MANAGED_ONLY: "no",
      REQUESTED_ONLY: "no",
    };
    const env = buildManagedHookEnvironment({
      source,
      managedAllowlist: ["APPROVED_VALUE", "MANAGED_ONLY"],
      requestedAllowlist: ["APPROVED_VALUE", "REQUESTED_ONLY"],
    });

    expect(env.APPROVED_VALUE).toBe("yes");
    expect(env.MANAGED_ONLY).toBeUndefined();
    expect(env.REQUESTED_ONLY).toBeUndefined();
  });
});
