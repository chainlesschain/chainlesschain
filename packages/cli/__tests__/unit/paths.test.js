import { describe, it, expect, afterEach, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getHomeDir returns ~/.chainlesschain", async () => {
    const { getHomeDir } = await import("../../src/lib/paths.js");
    expect(getHomeDir()).toBe(join(homedir(), ".chainlesschain"));
  });

  it("getBinDir returns ~/.chainlesschain/bin", async () => {
    const { getBinDir } = await import("../../src/lib/paths.js");
    expect(getBinDir()).toBe(join(homedir(), ".chainlesschain", "bin"));
  });

  it("getConfigPath returns config.json path", async () => {
    const { getConfigPath } = await import("../../src/lib/paths.js");
    expect(getConfigPath()).toMatch(/config\.json$/);
  });

  it("getStatePath returns state directory", async () => {
    const { getStatePath } = await import("../../src/lib/paths.js");
    expect(getStatePath()).toBe(join(homedir(), ".chainlesschain", "state"));
  });

  it("getPidFilePath returns app.pid path", async () => {
    const { getPidFilePath } = await import("../../src/lib/paths.js");
    expect(getPidFilePath()).toMatch(/app\.pid$/);
  });

  it("getServicesDir returns services directory", async () => {
    const { getServicesDir } = await import("../../src/lib/paths.js");
    expect(getServicesDir()).toBe(
      join(homedir(), ".chainlesschain", "services"),
    );
  });

  it("getLogsDir returns logs directory", async () => {
    const { getLogsDir } = await import("../../src/lib/paths.js");
    expect(getLogsDir()).toBe(join(homedir(), ".chainlesschain", "logs"));
  });

  it("getCacheDir returns cache directory", async () => {
    const { getCacheDir } = await import("../../src/lib/paths.js");
    expect(getCacheDir()).toBe(join(homedir(), ".chainlesschain", "cache"));
  });

  it("getElectronUserDataDir returns platform-specific path", async () => {
    const { getElectronUserDataDir } = await import("../../src/lib/paths.js");
    const dir = getElectronUserDataDir();
    expect(dir).toContain("chainlesschain-desktop-vue");
  });
});
