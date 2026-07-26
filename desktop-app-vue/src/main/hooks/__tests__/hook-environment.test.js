import { describe, expect, it } from "vitest";
import hookEnvironment from "../hook-environment";

const { buildManagedHookEnvironment } = hookEnvironment;

describe("Desktop managed hook environment", () => {
  it("does not inherit credentials or runtime injection variables", () => {
    const env = buildManagedHookEnvironment({
      source: {
        PATH: "C:\\bin",
        TEMP: "C:\\tmp",
        API_TOKEN: "secret",
        NODE_OPTIONS: "--require injected.js",
      },
      values: { HOOK_EVENT: "PreToolUse" },
    });

    expect(env).toEqual({
      PATH: "C:\\bin",
      TEMP: "C:\\tmp",
      HOOK_EVENT: "PreToolUse",
    });
  });

  it("requires managed and per-hook allowlists to agree", () => {
    const env = buildManagedHookEnvironment({
      source: { EXTRA: "allowed", OTHER: "denied" },
      managedAllowlist: ["EXTRA"],
      requestedAllowlist: ["EXTRA", "OTHER"],
    });

    expect(env).toEqual({ EXTRA: "allowed" });
  });
});
