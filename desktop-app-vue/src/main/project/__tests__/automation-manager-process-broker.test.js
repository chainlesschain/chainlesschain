import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const { AutomationManager } = require("../automation-manager.js");

describe("AutomationManager process execution", () => {
  it("routes project scripts through the desktop process broker boundary", async () => {
    const process = new EventEmitter();
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    const spawnProcess = vi.fn(() => process);
    const manager = new AutomationManager({ spawnProcess });

    const resultPromise = manager.runScript({
      scriptPath: "C:/scripts/task.cmd",
      args: ["literal arg", "& echo ignored"],
    });
    process.stdout.emit("data", Buffer.from("done"));
    process.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "done",
      stderr: "",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:/scripts/task.cmd",
      ["literal arg", "& echo ignored"],
      {
        shell: false,
        windowsHide: true,
        origin: "desktop:project-automation-script",
      },
    );
  });
});
