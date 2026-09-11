import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listSourceFiles(filePath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [filePath] : [];
  });
}

// Every entry here carries user-controlled content to an inference endpoint.
// New built-in egress must be added here with an explicit ingress boundary or
// a deliberately fail-closed guard; this makes the P0-4 audit enforceable.
const MODEL_EGRESS = [
  ["llm/openai-client.js", "prepareDesktopModelRequest"],
  ["llm/ollama-client.js", "runDesktopOllamaRequest"],
  ["llm/anthropic-client.js", "prepareDesktopModelRequest"],
  ["llm/gemini-client.js", "prepareDesktopModelRequest"],
  ["llm/volcengine-tools.js", "prepareDesktopModelRequest"],
  ["llm/volcengine-ipc.js", "getToolsClient"],
  ["llm/llava-client.js", "assertGovernedMultimodalIngress"],
  ["ai-engine/task-planner-enhanced.js", "assertGovernedTaskPlannerIngress"],
  ["ai-engine/vision-manager.js", "assertGovernedMultimodalIngress"],
  [
    "ai-engine/cowork/skills/builtin/audio-transcriber/handler.js",
    "assertGovernedMultimodalIngress",
  ],
  [
    "ai-engine/cowork/skills/builtin/image-generator/handler.js",
    "assertGovernedMultimodalIngress",
  ],
  ["api/backend-client.js", "assertGovernedRagIngress"],
  ["browser/actions/vision-action.js", "assertGovernedMultimodalIngress"],
  ["image-gen/sd-client.js", "assertGovernedMultimodalIngress"],
  ["image-gen/dalle-client.js", "assertGovernedMultimodalIngress"],
  ["image-gen/image-gen-manager.js", "assertGovernedMultimodalIngress"],
  ["speech/whisper-client.js", "assertGovernedMultimodalIngress"],
  ["speech/speech-recognizer.js", "assertGovernedMultimodalIngress"],
  ["speech/local-tts-client.js", "assertGovernedTtsIngress"],
  ["speech/edge-tts-client.js", "assertGovernedTtsIngress"],
  ["video/video-generator.js", "assertGovernedMultimodalIngress"],
  ["video/providers/volcengine-video.js", "assertGovernedMultimodalIngress"],
  ["rag/reranker.js", "assertGovernedRerankerIngress"],
  ["rag/bge-reranker-client.js", "assertGovernedBgeRerankerIngress"],
  ["fine-tuning/fine-tuning-manager.js", "assertGovernedFineTuningIngress"],
  ["ai-engine/extended-tools-datascience.js", "assertGovernedModelTrainingIngress"],
  ["project/http-client.js", "assertGovernedProjectAiIngress"],
  ["project/project-ai-ipc-chat.js", "assertGovernedProjectAiIngress"],
  ["plugins/plugin-api.js", "assertNoDirectPluginModelEgress"],
  ["ai-engine/extended-tools.js", "assertNoDirectModelEgress"],
  ["ai-engine/extended-tools-3.js", "assertNoDirectModelEgress"],
  ["ai-engine/extended-tools-4.js", "assertNoDirectModelEgress"],
  ["engines/word-engine.js", "assertGovernedDocumentIngress"],
  ["engines/ppt-engine.js", "assertGovernedDocumentIngress"],
  ["engines/pdf-engine.js", "assertGovernedDocumentIngress"],
  ["engines/excel-engine.js", "assertGovernedDocumentIngress"],
  ["engines/document-engine.js", "assertGovernedDocumentIngress"],
  ["engines/image-engine.js", "assertGovernedMultimodalIngress"],
  ["image/ocr-service.js", "assertGovernedOcrIngress"],
  ["image/ocr-worker-pool.js", "assertGovernedOcrIngress"],
  ["browser/diagnostics/ocr-engine.js", "assertGovernedOcrIngress"],
  ["screenshot/screenshot-ipc.js", "assertGovernedScreenshotOcrIngress"],
  ["ai-engine/cowork/screen-recorder.js", "assertGovernedOcrIngress"],
  ["ai-engine/cowork/modality-fusion.js", "assertGovernedOcrIngress"],
  [
    "ai-engine/cowork/skills/builtin/ocr-scanner/handler.js",
    "assertGovernedOcrIngress",
  ],
  [
    "ai-engine/cowork/skills/builtin/pdf-toolkit/handler.js",
    "assertGovernedOcrIngress",
  ],
];

const TESSERACT_EGRESS = new Set([
  "ai-engine/cowork/modality-fusion.js",
  "ai-engine/cowork/screen-recorder.js",
  "ai-engine/cowork/skills/builtin/ocr-scanner/handler.js",
  "ai-engine/cowork/skills/builtin/pdf-toolkit/handler.js",
  "browser/diagnostics/ocr-engine.js",
  "image/ocr-service.js",
  "image/ocr-worker-pool.js",
  "screenshot/screenshot-ipc.js",
]);

describe("Desktop model egress inventory", () => {
  it("keeps every registered content-bearing egress behind an explicit boundary", () => {
    for (const [relativePath, boundary] of MODEL_EGRESS) {
      const source = readFileSync(join(mainRoot, relativePath), "utf8");
      expect(source, relativePath).toContain(boundary);
      expect(source, relativePath).toContain(
        "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      );
    }
  });

  it("registers every actual Desktop Tesseract inference call", () => {
    const actual = listSourceFiles(mainRoot)
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return (
          source.includes("tesseract.js") &&
          /(?:Tesseract|worker|this\.worker)\.(?:recognize|createWorker)/.test(
            source,
          )
        );
      })
      .map((filePath) => filePath.slice(mainRoot.length + 1).replaceAll("\\", "/"))
      .sort();

    expect(actual).toEqual([...TESSERACT_EGRESS].sort());
  });
});
