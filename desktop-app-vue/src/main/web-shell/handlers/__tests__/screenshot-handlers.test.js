import { describe, expect, it, vi } from "vitest";

const { createScreenshotOcrHandler } = require("../screenshot-handlers");

describe("web-shell screenshot OCR contract", () => {
  it("reads a validated screenshot into memory before dispatching OCR", async () => {
    const filePath = "/tmp/cc-screenshot-contract.png";
    const imageBuffer = Buffer.from("trusted screenshot bytes");
    const helpers = {
      isInsideTmpDir: vi.fn(() => true),
      readScreenshotFile: vi.fn().mockResolvedValue(imageBuffer),
      recognizeDispatch: vi.fn().mockResolvedValue({
        text: "recognized",
        engine: "contract",
      }),
      recognize: vi.fn(),
      recognizeWithLLM: vi.fn(),
    };
    const handler = createScreenshotOcrHandler({ _internal: helpers });

    const result = await handler({
      path: filePath,
      engine: "tesseract",
      lang: "eng",
    });

    expect(helpers.isInsideTmpDir).toHaveBeenCalledWith(filePath);
    expect(helpers.readScreenshotFile).toHaveBeenCalledWith(filePath);
    expect(helpers.isInsideTmpDir.mock.invocationCallOrder[0]).toBeLessThan(
      helpers.readScreenshotFile.mock.invocationCallOrder[0],
    );
    expect(helpers.recognizeDispatch).toHaveBeenCalledWith(imageBuffer, {
      engine: "tesseract",
      lang: "eng",
      llmManager: null,
      tesseractImpl: helpers.recognize,
      llmImpl: helpers.recognizeWithLLM,
    });
    expect(helpers.readScreenshotFile.mock.invocationCallOrder[0]).toBeLessThan(
      helpers.recognizeDispatch.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      success: true,
      text: "recognized",
      engine: "contract",
    });
  });
});
