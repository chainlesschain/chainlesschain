import { describe, expect, it } from "vitest";

import { ADB_AUTO_PULL_BYPASS_ADAPTERS } from "../../src/gateways/ws/personal-data-hub-protocol.js";

describe("personal-data-hub WS protocol", () => {
  it("bypasses Android snapshot auto-pull for desktop-local adapters", () => {
    expect(ADB_AUTO_PULL_BYPASS_ADAPTERS).toEqual(
      expect.arrayContaining([
        "git-activity",
        "hbuilderx",
        "jetbrains-ide",
        "shell-history",
        "vscode",
        "vscodium",
      ]),
    );
    expect(new Set(ADB_AUTO_PULL_BYPASS_ADAPTERS).size).toBe(
      ADB_AUTO_PULL_BYPASS_ADAPTERS.length,
    );
  });
});
