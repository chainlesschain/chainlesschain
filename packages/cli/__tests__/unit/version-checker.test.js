import { describe, it, expect, vi, afterEach } from "vitest";

describe("version-checker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filterByChannel filters stable releases", async () => {
    const { filterByChannel } =
      await import("../../src/lib/version-checker.js");
    const releases = [
      { tag_name: "v1.0.0", prerelease: false, draft: false },
      { tag_name: "v1.1.0-beta.1", prerelease: true, draft: false },
      { tag_name: "v1.2.0-draft", prerelease: false, draft: true },
    ];
    const stable = filterByChannel(releases, "stable");
    expect(stable).toHaveLength(1);
    expect(stable[0].tag_name).toBe("v1.0.0");
  });

  it("filterByChannel includes prereleases for beta", async () => {
    const { filterByChannel } =
      await import("../../src/lib/version-checker.js");
    const releases = [
      { tag_name: "v1.0.0", prerelease: false, draft: false },
      { tag_name: "v1.1.0-beta.1", prerelease: true, draft: false },
      { tag_name: "v1.2.0-draft", prerelease: false, draft: true },
    ];
    const beta = filterByChannel(releases, "beta");
    expect(beta).toHaveLength(2);
  });

  it("filterByChannel includes all for dev", async () => {
    const { filterByChannel } =
      await import("../../src/lib/version-checker.js");
    const releases = [
      { tag_name: "v1.0.0", prerelease: false, draft: false },
      { tag_name: "v1.1.0-beta.1", prerelease: true, draft: false },
      { tag_name: "v1.2.0-draft", prerelease: false, draft: true },
    ];
    const dev = filterByChannel(releases, "dev");
    expect(dev).toHaveLength(3);
  });

  it("checkForUpdates returns updateAvailable when newer version exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              tag_name: "v99.0.0",
              prerelease: false,
              draft: false,
              html_url: "https://github.com/test/releases/v99.0.0",
              published_at: "2026-01-01T00:00:00Z",
              body: "Release notes",
              assets: [],
            },
          ]),
      }),
    );

    const { checkForUpdates } =
      await import("../../src/lib/version-checker.js");
    const result = await checkForUpdates({ currentVersion: "0.1.0" });
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("99.0.0");
  });

  it("checkForUpdates returns no update when on latest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { tag_name: "v0.1.0", prerelease: false, draft: false, assets: [] },
          ]),
      }),
    );

    const { checkForUpdates } =
      await import("../../src/lib/version-checker.js");
    const result = await checkForUpdates({ currentVersion: "0.1.0" });
    expect(result.updateAvailable).toBe(false);
  });

  it("checkForUpdates handles fetch errors gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const { checkForUpdates } =
      await import("../../src/lib/version-checker.js");
    const result = await checkForUpdates({ currentVersion: "0.1.0" });
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toContain("Network error");
  });
});
