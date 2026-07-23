import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

const { LocalTTSClient } = await import("../local-tts-client.js");

function createProcess() {
  const process = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdin = { write: vi.fn(), end: vi.fn() };
  return process;
}

describe("LocalTTSClient process execution", () => {
  it("routes Piper probes through the desktop execFile broker boundary", async () => {
    const execFileProcess = vi.fn((file, args, options, callback) => {
      callback(null, "piper help", "");
      return {};
    });
    const client = new LocalTTSClient(
      { piperPath: "piper-custom" },
      { execFileProcess },
    );

    await expect(client._runCommand(["--help"], 1234)).resolves.toBe(
      "piper help",
    );
    expect(execFileProcess).toHaveBeenCalledWith(
      "piper-custom",
      ["--help"],
      {
        timeout: 1234,
        windowsHide: true,
        origin: "desktop:speech-local-tts-probe",
      },
      expect.any(Function),
    );
  });

  it("routes Piper synthesis through the desktop spawn broker boundary", async () => {
    const process = createProcess();
    const spawnProcess = vi.fn(() => process);
    const client = new LocalTTSClient(
      { piperPath: "piper-custom" },
      { spawnProcess },
    );

    const resultPromise = client._synthesizeWithStdin(
      "hello",
      ["--model", "voice.onnx"],
      "unused.wav",
    );
    process.stderr.emit("data", Buffer.from("piper failed"));
    process.emit("close", 3);

    await expect(resultPromise).rejects.toThrow("piper failed");
    expect(spawnProcess).toHaveBeenCalledWith(
      "piper-custom",
      ["--model", "voice.onnx"],
      {
        windowsHide: true,
        origin: "desktop:speech-local-tts-synthesize",
      },
    );
    expect(process.stdin.write).toHaveBeenCalledWith("hello");
    expect(process.stdin.end).toHaveBeenCalledOnce();
  });
});
