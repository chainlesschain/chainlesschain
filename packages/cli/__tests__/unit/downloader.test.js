import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("downloader", () => {
  it("formatBytes formats byte values correctly", async () => {
    const { formatBytes } = await import("../../src/lib/downloader.js");
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(500)).toBe("500B");
    expect(formatBytes(1024)).toBe("1.0KB");
    expect(formatBytes(1536)).toBe("1.5KB");
    expect(formatBytes(1048576)).toBe("1.0MB");
    expect(formatBytes(1073741824)).toBe("1.0GB");
  });

  it("resolveAssetUrl throws for missing release", async () => {
    const { resolveAssetUrl } = await import("../../src/lib/downloader.js");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    await expect(resolveAssetUrl("99.99.99", "nope.exe")).rejects.toThrow(
      "Failed to find release",
    );
    vi.unstubAllGlobals();
  });

  it("resolveAssetUrl throws for missing asset in release", async () => {
    const { resolveAssetUrl } = await import("../../src/lib/downloader.js");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            assets: [{ name: "other.exe", browser_download_url: "http://x" }],
          }),
      }),
    );
    await expect(resolveAssetUrl("1.0.0", "wanted.exe")).rejects.toThrow(
      "Asset wanted.exe not found",
    );
    vi.unstubAllGlobals();
  });
});
