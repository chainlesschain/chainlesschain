import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

describe("paths", () => {
  const originalChainlesschainHome = process.env.CHAINLESSCHAIN_HOME;
  const originalSecurityAnchorHome =
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;

  beforeEach(() => {
    delete process.env.CHAINLESSCHAIN_HOME;
    delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  });

  afterEach(() => {
    if (originalChainlesschainHome === undefined) {
      delete process.env.CHAINLESSCHAIN_HOME;
    } else {
      process.env.CHAINLESSCHAIN_HOME = originalChainlesschainHome;
    }
    if (originalSecurityAnchorHome === undefined) {
      delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    } else {
      process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME =
        originalSecurityAnchorHome;
    }
    vi.restoreAllMocks();
  });

  it("getHomeDir returns ~/.chainlesschain", async () => {
    const { getHomeDir } = await import("../../src/lib/paths.js");
    expect(getHomeDir()).toBe(join(homedir(), ".chainlesschain"));
  });

  it("getHomeDir honors CHAINLESSCHAIN_HOME", async () => {
    process.env.CHAINLESSCHAIN_HOME = join(
      homedir(),
      "custom",
      "chainlesschain-home",
    );
    const { getHomeDir } = await import("../../src/lib/paths.js");
    expect(getHomeDir()).toBe(join(homedir(), "custom", "chainlesschain-home"));
  });

  it("rejects a relative CHAINLESSCHAIN_HOME", async () => {
    process.env.CHAINLESSCHAIN_HOME = "..";
    const { getHomeDir } = await import("../../src/lib/paths.js");
    expect(() => getHomeDir()).toThrow(/must be an absolute path/i);
  });

  it("rejects an explicit home at the workspace or one of its ancestors", async () => {
    const { getHomeDir } = await import("../../src/lib/paths.js");
    for (const unsafe of [
      process.cwd(),
      dirname(process.cwd()),
      `\\\\?\\${process.cwd()}`,
    ]) {
      process.env.CHAINLESSCHAIN_HOME = unsafe;
      expect(() => getHomeDir(), unsafe).toThrow(
        /current working directory|device namespace/i,
      );
    }
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

  it("keeps the machine security anchor outside the default home", async () => {
    const { getHomeDir, getMachineSecurityAnchorDir } =
      await import("../../src/lib/paths.js");
    expect(getMachineSecurityAnchorDir()).not.toContain(getHomeDir());
  });

  it("requires an absolute explicit machine security anchor", async () => {
    const { getMachineSecurityAnchorDir } =
      await import("../../src/lib/paths.js");
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = "relative-anchor";
    expect(() => getMachineSecurityAnchorDir()).toThrow(/absolute path/i);
  });

  it("rejects a session anti-rollback anchor nested in the configured home", async () => {
    const configuredHome = join(tmpdir(), "cc-path-anchor-home");
    process.env.CHAINLESSCHAIN_HOME = configuredHome;
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(
      configuredHome,
      "security-anchors",
    );
    const { getSessionAntiRollbackDirectory } =
      await import("../../src/lib/session-anti-rollback-anchor.js");
    expect(() => getSessionAntiRollbackDirectory()).toThrow(
      expect.objectContaining({
        code: "CC_SESSION_ANTI_ROLLBACK_UNAVAILABLE",
      }),
    );
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

  it("refuses filesystem, drive, UNC-share, and user-home roots", async () => {
    const { assertSafePrivateDirectoryPath } =
      await import("../../src/lib/paths.js");
    for (const unsafe of [
      "/",
      "C:\\",
      "C:",
      "\\\\server\\share\\",
      "\\\\?\\C:\\",
      "\\\\?\\C:\\private",
      "\\\\?\\UNC\\server\\share\\",
      "\\\\?\\UNC\\server\\share\\private",
      "\\\\?\\UNC\\server\\share\\child\\..",
      "\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\",
      "\\\\.\\PhysicalDrive0",
      homedir(),
      ".",
      "..",
      "../..",
      "C:.",
      "C:child\\..",
      "C:..",
    ]) {
      expect(() => assertSafePrivateDirectoryPath(unsafe), unsafe).toThrow(
        /Refusing/,
      );
    }
    expect(() =>
      assertSafePrivateDirectoryPath(join(homedir(), ".chainlesschain")),
    ).not.toThrow();
  });
});
