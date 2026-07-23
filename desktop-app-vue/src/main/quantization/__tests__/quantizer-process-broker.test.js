import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const ggufModule = await import("../gguf-quantizer.js");
const gptqModule = await import("../gptq-quantizer.js");
const { GGUFQuantizer, _deps: ggufDeps } = ggufModule;
const { GPTQQuantizer, _deps: gptqDeps } = gptqModule;
const originalGGUFSpawn = ggufDeps.spawn;
const originalGPTQSpawn = gptqDeps.spawn;

function createProcess() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.kill = vi.fn();
  return process;
}

afterEach(() => {
  ggufDeps.spawn = originalGGUFSpawn;
  gptqDeps.spawn = originalGPTQSpawn;
});

describe("quantizer process execution", () => {
  it("routes llama-quantize through the desktop process broker boundary", async () => {
    const process = createProcess();
    ggufDeps.spawn = vi.fn(() => process);
    const quantizer = new GGUFQuantizer();

    const resultPromise = quantizer.quantize(
      "input.gguf",
      "output.gguf",
      "Q4_K_M",
    );
    process.emit("close", 0);

    await expect(resultPromise).resolves.toBeUndefined();
    expect(ggufDeps.spawn).toHaveBeenCalledWith(
      "llama-quantize",
      ["input.gguf", "output.gguf", "Q4_K_M"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        origin: "desktop:quantization-gguf",
      },
    );
  });

  it("routes AutoGPTQ through the desktop process broker boundary", async () => {
    const process = createProcess();
    gptqDeps.spawn = vi.fn(() => process);
    const quantizer = new GPTQQuantizer();

    const resultPromise = quantizer.quantize("model-dir", "output-dir", {
      bits: 4,
      groupSize: 64,
      descAct: true,
      dataset: "c4",
      numSamples: 32,
    });
    process.emit("close", 0);

    await expect(resultPromise).resolves.toBeUndefined();
    expect(gptqDeps.spawn).toHaveBeenCalledWith(
      "python",
      [
        "-m",
        "auto_gptq.quantize",
        "--model",
        "model-dir",
        "--output",
        "output-dir",
        "--bits",
        "4",
        "--group-size",
        "64",
        "--desc-act",
        "--dataset",
        "c4",
        "--num-samples",
        "32",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        origin: "desktop:quantization-gptq",
      },
    );
  });
});
