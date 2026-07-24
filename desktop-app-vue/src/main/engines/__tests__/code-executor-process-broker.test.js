import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { CodeExecutor } = await import("../code-executor.js");

function createProcess() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdin = { write: vi.fn(), end: vi.fn() };
  process.kill = vi.fn();
  return process;
}

describe("CodeExecutor process execution", () => {
  it("routes interpreter probes through the desktop process broker boundary", async () => {
    const process = createProcess();
    const spawnProcess = vi.fn(() => process);
    const executor = new CodeExecutor({ spawnProcess });

    const resultPromise = executor.getPythonVersion("python-custom");
    process.stdout.emit("data", Buffer.from("Python 3.13.5"));
    process.emit("close", 0);

    await expect(resultPromise).resolves.toBe("Python 3.13.5");
    expect(spawnProcess).toHaveBeenCalledWith("python-custom", ["--version"], {
      windowsHide: true,
      origin: "desktop:code-executor-python-probe",
    });
  });

  it("keeps command arguments literal and shell disabled", async () => {
    const process = createProcess();
    const spawnProcess = vi.fn(() => process);
    const executor = new CodeExecutor({ spawnProcess });

    const resultPromise = executor.runCommand(
      "node",
      ["script.js", "&", "echo injected"],
      {
        workingDir: "C:/safe-workdir",
        env: { CC_SAFE_VALUE: "kept" },
      },
    );
    process.stdout.emit("data", Buffer.from("done"));
    process.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({
      stdout: "done",
      exitCode: 0,
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      "node",
      ["script.js", "&", "echo injected"],
      expect.objectContaining({
        cwd: "C:/safe-workdir",
        shell: false,
        origin: "desktop:code-executor-run",
        env: expect.objectContaining({ CC_SAFE_VALUE: "kept" }),
      }),
    );
  });
});
