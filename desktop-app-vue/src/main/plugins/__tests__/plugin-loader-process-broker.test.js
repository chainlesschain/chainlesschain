import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:/unused") },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

  it("does not disclose dependency installer output", async () => {
    const childProcess = createProcess();
    const loader = createLoader(() => childProcess);
    const secret = "dependency-installer-secret";
    const resultPromise = loader.installNpmDependencies("C:/plugins/demo");

    childProcess.stderr.emit("data", Buffer.from(secret));
    childProcess.emit("close", 9);

    await expect(resultPromise).rejects.toMatchObject({
      message: "Plugin dependency installation failed",
      code: "PLUGIN_DEPENDENCY_INSTALL_FAILED",
      exitCode: 9,
    });
    await expect(resultPromise).rejects.not.toThrow(secret);
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

    await expect(resultPromise).resolves.toEqual({
      totalBytes: 4,
      retainedBytes: 4,
      truncated: false,
      digest:
        "sha256:a4c3ed04a95a3da14a9d235c83d868bed7c0f45cf7f3faa751ee8f50598d2211",
    });
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

  it("returns only a bounded receipt for successful command output", async () => {
    const childProcess = createProcess();
    const loader = createLoader(() => childProcess);
    const resultPromise = loader.execCommand("tool", []);
    const secret = "successful-command-secret";

    childProcess.stdout.emit("data", Buffer.from(secret));
    childProcess.stdout.emit("data", Buffer.alloc(70 * 1024, "a"));
    childProcess.emit("close", 0);

    const result = await resultPromise;
    expect(result).toMatchObject({
      totalBytes: Buffer.byteLength(secret, "utf8") + 70 * 1024,
      retainedBytes: 64 * 1024,
      truncated: true,
    });
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not disclose failed command output", async () => {
    const childProcess = createProcess();
    const loader = createLoader(() => childProcess);
    const secret = "plugin-process-secret";
    const resultPromise = loader.execCommand("tool", []);

    childProcess.stderr.emit("data", Buffer.from(secret));
    childProcess.emit("close", 7);

    await expect(resultPromise).rejects.toMatchObject({
      message: "Plugin command failed",
      code: "PLUGIN_COMMAND_FAILED",
      exitCode: 7,
    });
    await expect(resultPromise).rejects.not.toThrow(secret);
  });

  it("does not disclose process spawn errors", async () => {
    const childProcess = createProcess();
    const loader = createLoader(() => childProcess);
    const secret = "spawn-error-secret";
    const resultPromise = loader.execCommand("tool", []);

    childProcess.emit("error", new Error(secret));

    await expect(resultPromise).rejects.toMatchObject({
      message: "Plugin command process failed to start",
      code: "PLUGIN_COMMAND_SPAWN_FAILED",
    });
    await expect(resultPromise).rejects.not.toThrow(secret);
  });
});
