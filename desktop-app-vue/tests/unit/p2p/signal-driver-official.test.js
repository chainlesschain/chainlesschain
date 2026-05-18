import { describe, it, expect, beforeEach } from "vitest";

describe("OfficialSignalDriver", () => {
  let OfficialSignalDriver;

  beforeEach(async () => {
    OfficialSignalDriver = (
      await import("../../../src/main/p2p/signal-driver-official.js")
    ).default;
  });

  it("should report missing dependency when official package is unavailable", async () => {
    const driver = new OfficialSignalDriver({
      _deps: {
        importOfficialLibrary: async () => {
          throw new Error("should not import when package is missing");
        },
        resolveOfficialPackageJson: () => {
          throw new Error("Cannot find module '@signalapp/libsignal-client/package.json'");
        },
        readPackageJson: async () => ({}),
        platform: () => "win32",
        arch: () => "x64",
        versions: () => ({ node: "22.0.0", electron: "35.0.0" }),
      },
    });

    const diagnostics = await driver.probeSupport();

    expect(diagnostics.status).toBe("missing_dependency");
    expect(diagnostics.packageInstalled).toBe(false);
    expect(diagnostics.recommendedDriver).toBe("legacy");
    expect(diagnostics.errors[0]).toContain("Cannot find module");
  });

  it("should report package_loaded when official package can be resolved and imported", async () => {
    const driver = new OfficialSignalDriver({
      _deps: {
        importOfficialLibrary: async () => ({
          ProtocolAddress: class ProtocolAddress {},
          ServiceId: class ServiceId {},
        }),
        resolveOfficialPackageJson: () =>
          "C:/code/chainlesschain/desktop-app-vue/node_modules/@signalapp/libsignal-client/package.json",
        readPackageJson: async () => ({
          name: "@signalapp/libsignal-client",
          version: "0.1.0-test",
        }),
        platform: () => "win32",
        arch: () => "x64",
        versions: () => ({ node: "22.0.0", electron: "35.0.0" }),
      },
    });

    const diagnostics = await driver.probeSupport();

    expect(diagnostics.status).toBe("package_loaded");
    expect(diagnostics.packageInstalled).toBe(true);
    expect(diagnostics.packageVersion).toBe("0.1.0-test");
    expect(diagnostics.exportKeys).toEqual(["ProtocolAddress", "ServiceId"]);
  });

  it("should fail initialize with actionable POC message after successful load", async () => {
    const driver = new OfficialSignalDriver({
      _deps: {
        importOfficialLibrary: async () => ({
          ProtocolAddress: class ProtocolAddress {},
        }),
        resolveOfficialPackageJson: () =>
          "C:/code/chainlesschain/desktop-app-vue/node_modules/@signalapp/libsignal-client/package.json",
        readPackageJson: async () => ({
          name: "@signalapp/libsignal-client",
          version: "0.1.0-test",
        }),
        platform: () => "win32",
        arch: () => "x64",
        versions: () => ({ node: "22.0.0", electron: "35.0.0" }),
      },
    });

    await expect(driver.initialize()).rejects.toThrow(
      "protocol adapter is not implemented yet",
    );
  });
});
