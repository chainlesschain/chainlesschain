import { describe, it, expect, vi, afterEach } from "vitest";

describe("update flow (integration)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("checkForUpdates identifies newer version and returns metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              tag_name: "v2.0.0",
              prerelease: false,
              draft: false,
              html_url: "https://github.com/test/releases/v2.0.0",
              published_at: "2026-03-01T00:00:00Z",
              body: "Major update with new features",
              assets: [
                {
                  name: "chainlesschain-win-x64.exe",
                  size: 50000000,
                  browser_download_url: "https://dl/win.exe",
                },
                {
                  name: "chainlesschain-mac-arm64.dmg",
                  size: 55000000,
                  browser_download_url: "https://dl/mac.dmg",
                },
              ],
            },
            {
              tag_name: "v1.0.0",
              prerelease: false,
              draft: false,
              html_url: "https://github.com/test/releases/v1.0.0",
              published_at: "2026-01-01T00:00:00Z",
              body: "Initial release",
              assets: [],
            },
          ]),
      }),
    );

    vi.resetModules();
    const { checkForUpdates } =
      await import("../../src/lib/version-checker.js");
    const result = await checkForUpdates({
      currentVersion: "1.0.0",
      channel: "stable",
    });

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("2.0.0");
    expect(result.assets).toHaveLength(2);
    expect(result.releaseNotes).toContain("Major update");
  });

  it("beta channel includes prerelease versions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              tag_name: "v2.0.0-beta.1",
              prerelease: true,
              draft: false,
              assets: [],
            },
            { tag_name: "v1.0.0", prerelease: false, draft: false, assets: [] },
          ]),
      }),
    );

    vi.resetModules();
    const { checkForUpdates } =
      await import("../../src/lib/version-checker.js");
    const result = await checkForUpdates({
      currentVersion: "1.0.0",
      channel: "beta",
    });

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("2.0.0-beta.1");
  });
});
