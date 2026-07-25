import { describe, expect, it } from "vitest";

import {
  ADB_AUTO_PULL_BYPASS_ADAPTERS,
  PERSONAL_DATA_HUB_HANDLERS,
  PERSONAL_DATA_HUB_STREAMING_HANDLERS,
  _tryAdbAutoPullInputPath,
  hasExplicitLiveSourceOptions,
} from "../../src/gateways/ws/personal-data-hub-protocol.js";

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

  it.each([
    ["cookie", "sid=runtime-secret"],
    ["accessToken", "oauth-runtime-secret"],
    ["appKey", "app-runtime-secret"],
    ["apiKey", "api-runtime-secret"],
    ["token", "runtime-secret"],
    ["sourceUrl", "https://api.example.test/orders"],
    ["cookies", [{ name: "sid", value: "runtime-secret" }]],
  ])(
    "keeps explicit %s live options ahead of an implicit Android snapshot",
    async (key, value) => {
      const options = { [key]: value, accountId: "runtime-account" };
      expect(hasExplicitLiveSourceOptions(options)).toBe(true);
      await expect(
        _tryAdbAutoPullInputPath(null, "shopping-jd", options),
      ).resolves.toBe(options);
    },
  );

  it("uses the guarded auto-pull path in both ordinary and streaming sync handlers", () => {
    expect(
      String(PERSONAL_DATA_HUB_HANDLERS["personal-data-hub.sync-adapter"]),
    ).toContain("_tryAdbAutoPullInputPath");
    expect(
      String(
        PERSONAL_DATA_HUB_STREAMING_HANDLERS[
          "personal-data-hub.sync-adapter-stream"
        ],
      ),
    ).toContain("_tryAdbAutoPullInputPath");
  });
});
