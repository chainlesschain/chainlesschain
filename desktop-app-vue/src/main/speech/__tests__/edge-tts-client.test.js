import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

const { EdgeTTSClient } = await import("../edge-tts-client.js");

function createProcess() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  return process;
}

describe("EdgeTTSClient process execution", () => {
  it("routes edge-tts through the desktop process broker boundary", async () => {
    const process = createProcess();
    const spawnProcess = vi.fn(() => process);
    const client = new EdgeTTSClient(
      { pythonPath: "python-custom" },
      { spawnProcess },
    );

    const resultPromise = client._runCommand(["--version"]);
    process.stdout.emit("data", Buffer.from("edge-tts 7.2.3"));
    process.emit("close", 0);

    await expect(resultPromise).resolves.toBe("edge-tts 7.2.3");
    expect(spawnProcess).toHaveBeenCalledWith(
      "python-custom",
      ["-m", "edge_tts", "--version"],
      {
        windowsHide: true,
        origin: "desktop:speech-edge-tts",
      },
    );
  });

  it("propagates stderr from a failed edge-tts process", async () => {
    const process = createProcess();
    const client = new EdgeTTSClient({}, { spawnProcess: () => process });

    const resultPromise = client._runCommand(["--list-voices"]);
    process.stderr.emit("data", Buffer.from("edge-tts failed"));
    process.emit("close", 2);

    await expect(resultPromise).rejects.toThrow("edge-tts failed");
  });
});
