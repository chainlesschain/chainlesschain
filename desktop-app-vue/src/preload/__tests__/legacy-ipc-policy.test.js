import { describe, expect, it } from "vitest";

const {
  legacyGenericIpcEnabled,
  assertLegacyGenericIpcEnabled,
} = require("../legacy-ipc-policy.js");

describe("legacy generic IPC policy", () => {
  it("is disabled by default", () => {
    expect(legacyGenericIpcEnabled({})).toBe(false);
    expect(() => assertLegacyGenericIpcEnabled({})).toThrowError(
      expect.objectContaining({ code: "LEGACY_GENERIC_IPC_DISABLED" }),
    );
  });

  it("requires the explicit compatibility switch", () => {
    const env = { CC_ENABLE_LEGACY_GENERIC_IPC: "1" };
    expect(legacyGenericIpcEnabled(env)).toBe(true);
    expect(() => assertLegacyGenericIpcEnabled(env)).not.toThrow();
  });
});
