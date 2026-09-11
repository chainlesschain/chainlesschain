import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { default: OCRService } = await import("../ocr-service.js");
const { default: OCRWorkerPool } = await import("../ocr-worker-pool.js");
const { OCREngine } = await import("../../browser/diagnostics/ocr-engine.js");
const { _internal: screenshotInternal } =
  await import("../../screenshot/screenshot-ipc.js");
const { ScreenRecorder } =
  await import("../../ai-engine/cowork/screen-recorder.js");
const { ModalityFusion } =
  await import("../../ai-engine/cowork/modality-fusion.js");
const { default: ocrScanner } = await import(
  "../../ai-engine/cowork/skills/builtin/ocr-scanner/handler.js"
);
const { default: pdfToolkit } = await import(
  "../../ai-engine/cowork/skills/builtin/pdf-toolkit/handler.js"
);

async function expectDenied(operation) {
  await expect(operation()).rejects.toMatchObject({
    code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
  });
}

describe("Desktop OCR model egress default deny", () => {
  it("rejects OCR service calls before creating a worker or recognizing image content", async () => {
    const createWorker = vi.fn();
    const service = new OCRService({}, { createWorker });

    await expectDenied(() => service.recognize(Buffer.from("private-image")));
    await expectDenied(() => service.recognizeBatch([Buffer.from("private-image")]));
    await expectDenied(() => service.detectTextRegions(Buffer.from("private-image")));

    expect(createWorker).not.toHaveBeenCalled();
  });

  it("rejects worker-pool calls before queuing image content to a worker", async () => {
    const workerRecognize = vi.fn();
    const pool = new OCRWorkerPool({ maxWorkers: 1 });
    pool.isInitialized = true;
    pool.workers = [{ recognize: workerRecognize }];

    await expectDenied(() => pool.recognize(Buffer.from("private-image")));
    await expectDenied(() => pool.recognizeBatch([Buffer.from("private-image")]));

    expect(workerRecognize).not.toHaveBeenCalled();
  });

  it("rejects browser OCR before initialization or page screenshots", async () => {
    const engine = new OCREngine();
    const screenshot = vi.fn();
    const page = { screenshot, locator: vi.fn(() => ({ screenshot })) };

    await expectDenied(() => engine.recognize(Buffer.from("private-image")));
    await expectDenied(() => engine.recognizeFromPage(page));

    expect(screenshot).not.toHaveBeenCalled();
  });

  it("rejects screenshot OCR dispatch before local or visual provider helpers", async () => {
    const tesseractImpl = vi.fn();
    const llmImpl = vi.fn();

    await expectDenied(() =>
      screenshotInternal.recognizeDispatch(Buffer.from("private-image"), {
        engine: "auto",
        llmManager: { provider: "volcengine" },
        tesseractImpl,
        llmImpl,
      }),
    );

    expect(tesseractImpl).not.toHaveBeenCalled();
    expect(llmImpl).not.toHaveBeenCalled();
  });

  it("rejects Cowork OCR before image data reaches direct Tesseract helpers", async () => {
    const recorder = new ScreenRecorder();
    const fusion = new ModalityFusion();

    await expectDenied(() => recorder._performOCR(Buffer.from("private-image")));
    await expectDenied(() => fusion._processImage({ data: Buffer.from("private-image") }));
  });

  it("rejects bundled Skill OCR helpers before they load a worker or read files", async () => {
    await expectDenied(() => ocrScanner._internal.recognizeImage("private.png", "eng"));
    await expectDenied(() => ocrScanner._internal.recognizeBatch("/private", "eng"));
    await expectDenied(() => pdfToolkit._internal.ocrFile("private.pdf"));
  });

});
