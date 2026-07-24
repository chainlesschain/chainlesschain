import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:/unused") },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const PluginLoader = require("../plugin-loader.js");

function createProcess() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  return process;
}

function createLoader(spawnProcess) {
  return new PluginLoader({
    pluginsDir: "C:/plugins",
    tempDir: "C:/plugin-temp",
    spawnProcess,
  });
}

describe("PluginLoader process execution", () => {
  it("installs plugin dependencies through the broker with provenance", async () => {
    const childProcess = createProcess();
    const spawnProcess = vi.fn(() => childProcess);
    const loader = createLoader(spawnProcess);

    const resultPromise = loader.installNpmDependencies("C:/plugins/demo");
    childProcess.emit("close", 0);

    await expect(resultPromise).resolves.toBeUndefined();
    expect(spawnProcess).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--production"],
      {
        cwd: "C:/plugins/demo",
        stdio: "pipe",
        shell: false,
        windowsHide: true,
        origin: "desktop:plugin-loader-dependencies",
        provenance: { pluginSource: "C:/plugins/demo" },
      },
    );
  });

  it("keeps plugin command arguments literal with shell disabled", async () => {
    const childProcess = createProcess();
    const spawnProcess = vi.fn(() => childProcess);
    const loader = createLoader(spawnProcess);

    const resultPromise = loader.execCommand(
      "unzip",
      ["archive.zip", "-d", "dir & echo ignored"],
      {
        origin: "desktop:plugin-loader-extract",
        provenance: { pluginSource: "archive.zip" },
      },
    );
    childProcess.stdout.emit("data", Buffer.from("done"));
    childProcess.emit("close", 0);

    await expect(resultPromise).resolves.toBe("done");
    expect(spawnProcess).toHaveBeenCalledWith(
      "unzip",
      ["archive.zip", "-d", "dir & echo ignored"],
      {
        stdio: "pipe",
        shell: false,
        windowsHide: true,
        origin: "desktop:plugin-loader-extract",
        provenance: { pluginSource: "archive.zip" },
      },
    );
  });
});
