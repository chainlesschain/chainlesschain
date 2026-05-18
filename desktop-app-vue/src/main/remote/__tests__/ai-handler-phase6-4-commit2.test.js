/**
 * AICommandHandler — Phase 6.4 commit 2 测试
 *
 * 覆盖新加 8 method:
 *   Multimodal 4: generateImage / ocrImage / transcribeAudio / textToSpeech
 *   Code helpers 4: generateCode / explainCode / refactorCode / fixCode
 *
 * 所有 method 都 delegate to aiEngine (4 multimodal 子方法 + chat 用于 code 4 个)。
 * 测试用 stub aiEngine 验 envelope 透传 + 错误路径。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const AICommandHandler = require("../handlers/ai-handler");

describe("AICommandHandler — Phase 6.4 commit 2 (Multimodal + Code helpers)", () => {
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  // ===== Multimodal: generateImage =====

  describe("generateImage", () => {
    it("calls aiEngine.generateImage with defaults", async () => {
      const fake = {
        generateImage: vi.fn(async (_p, opts) => ({
          model: opts.model || "dall-e-3",
          images: [{ url: "https://example.com/img1.png" }],
        })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("generateImage", { prompt: "a cat" }, ctx);
      expect(r.success).toBe(true);
      expect(r.images.length).toBe(1);
      expect(fake.generateImage).toHaveBeenCalledWith(
        "a cat",
        expect.objectContaining({
          size: "1024x1024",
          n: 1,
        }),
      );
    });

    it("clamps n to [1, 10]", async () => {
      const fake = { generateImage: vi.fn(async () => ({ images: [] })) };
      const handler = new AICommandHandler(fake, null, db, {});
      await handler.handle("generateImage", { prompt: "x", n: 99 }, ctx);
      expect(fake.generateImage.mock.calls[0][1].n).toBe(10);
      await handler.handle("generateImage", { prompt: "x", n: 0 }, ctx);
      expect(fake.generateImage.mock.calls[1][1].n).toBe(1);
    });

    it("throws on missing prompt", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(handler.handle("generateImage", {}, ctx)).rejects.toThrow(
        "prompt is required",
      );
    });

    it("throws when aiEngine.generateImage absent", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(
        handler.handle("generateImage", { prompt: "x" }, ctx),
      ).rejects.toThrow("aiEngine.generateImage not implemented");
    });

    it("throws when aiEngine absent", async () => {
      const handler = new AICommandHandler(null, null, db, {});
      await expect(
        handler.handle("generateImage", { prompt: "x" }, ctx),
      ).rejects.toThrow("AI engine not available");
    });
  });

  // ===== Multimodal: ocrImage =====

  describe("ocrImage", () => {
    it("delegates to aiEngine.ocrImage with imageData", async () => {
      const fake = {
        ocrImage: vi.fn(async (_d, _o) => ({
          text: "Hello world",
          confidence: 0.95,
          language: "en",
        })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "ocrImage",
        { imageData: "base64data" },
        ctx,
      );
      expect(r.text).toBe("Hello world");
      expect(r.confidence).toBe(0.95);
      expect(fake.ocrImage.mock.calls[0][0]).toBe("base64data");
      expect(fake.ocrImage.mock.calls[0][1].isPath).toBe(false);
    });

    it("accepts imagePath alternative", async () => {
      const fake = {
        ocrImage: vi.fn(async () => ({ text: "x" })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      await handler.handle(
        "ocrImage",
        { imagePath: "/tmp/img.png", language: "zh" },
        ctx,
      );
      expect(fake.ocrImage.mock.calls[0][0]).toBe("/tmp/img.png");
      expect(fake.ocrImage.mock.calls[0][1].isPath).toBe(true);
      expect(fake.ocrImage.mock.calls[0][1].language).toBe("zh");
    });

    it("throws when neither imageData nor imagePath given", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(handler.handle("ocrImage", {}, ctx)).rejects.toThrow(
        "imageData or imagePath is required",
      );
    });
  });

  // ===== Multimodal: transcribeAudio =====

  describe("transcribeAudio", () => {
    it("delegates with audioData", async () => {
      const fake = {
        transcribeAudio: vi.fn(async () => ({
          text: "transcribed text",
          language: "en",
          duration: 12.3,
        })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "transcribeAudio",
        { audioData: "base64", language: "en", model: "whisper" },
        ctx,
      );
      expect(r.text).toBe("transcribed text");
      expect(r.duration).toBe(12.3);
      expect(fake.transcribeAudio.mock.calls[0][1].model).toBe("whisper");
    });

    it("throws on missing audio", async () => {
      const handler = new AICommandHandler(
        { transcribeAudio: vi.fn() },
        null,
        db,
        {},
      );
      await expect(handler.handle("transcribeAudio", {}, ctx)).rejects.toThrow(
        "audioData or audioPath is required",
      );
    });
  });

  // ===== Multimodal: textToSpeech =====

  describe("textToSpeech", () => {
    it("delegates and forwards voice/speed/format", async () => {
      const fake = {
        textToSpeech: vi.fn(async () => ({
          audioData: "base64audio",
          duration: 5,
        })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "textToSpeech",
        { text: "hello", voice: "alloy", speed: 1.2, format: "wav" },
        ctx,
      );
      expect(r.audioData).toBe("base64audio");
      expect(r.voice).toBe("alloy");
      expect(r.format).toBe("wav");
      expect(fake.textToSpeech.mock.calls[0][1].speed).toBe(1.2);
    });

    it("throws on missing text", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(handler.handle("textToSpeech", {}, ctx)).rejects.toThrow(
        "text is required",
      );
    });
  });

  // ===== Code helpers =====

  describe("generateCode", () => {
    it("uses chat with system+user prompt and low temperature", async () => {
      const fake = {
        chat: vi.fn(async (_msgs, _opts) => ({
          content: "function add(a, b) { return a + b; }",
        })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "generateCode",
        { prompt: "add function", language: "JavaScript", framework: "Node" },
        ctx,
      );
      expect(r.code).toContain("function add");
      expect(r.language).toBe("JavaScript");
      expect(r.framework).toBe("Node");
      const [messages, opts] = fake.chat.mock.calls[0];
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("JavaScript");
      expect(messages[0].content).toContain("Node");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("add function");
      expect(opts.temperature).toBe(0.2);
    });

    it("throws on missing prompt", async () => {
      const handler = new AICommandHandler({ chat: vi.fn() }, null, db, {});
      await expect(handler.handle("generateCode", {}, ctx)).rejects.toThrow(
        "prompt is required",
      );
    });

    it("throws when aiEngine.chat absent", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(
        handler.handle("generateCode", { prompt: "x" }, ctx),
      ).rejects.toThrow("AI engine chat not available");
    });
  });

  describe("explainCode", () => {
    it("composes review system prompt", async () => {
      const fake = {
        chat: vi.fn(async () => ({ content: "This function does X." })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "explainCode",
        { code: "function f() {}", language: "JavaScript" },
        ctx,
      );
      expect(r.explanation).toContain("This function");
      const [messages] = fake.chat.mock.calls[0];
      expect(messages[0].content).toContain("code reviewer");
      expect(messages[0].content).toContain("(JavaScript)");
      expect(messages[1].content).toBe("function f() {}");
    });

    it("throws on missing code", async () => {
      const handler = new AICommandHandler({ chat: vi.fn() }, null, db, {});
      await expect(handler.handle("explainCode", {}, ctx)).rejects.toThrow(
        "code is required",
      );
    });
  });

  describe("refactorCode", () => {
    it("includes instructions in user message", async () => {
      const fake = {
        chat: vi.fn(async () => ({ content: "// refactored" })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "refactorCode",
        {
          code: "var x = 1",
          language: "JavaScript",
          instructions: "Use const",
        },
        ctx,
      );
      expect(r.refactoredCode).toContain("// refactored");
      expect(r.instructions).toBe("Use const");
      const [messages] = fake.chat.mock.calls[0];
      expect(messages[1].content).toContain("Instruction: Use const");
      expect(messages[1].content).toContain("var x = 1");
    });

    it("uses default instructions if absent", async () => {
      const fake = { chat: vi.fn(async () => ({ content: "x" })) };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("refactorCode", { code: "x" }, ctx);
      expect(r.instructions).toContain("readability");
    });

    it("throws on missing code", async () => {
      const handler = new AICommandHandler({ chat: vi.fn() }, null, db, {});
      await expect(handler.handle("refactorCode", {}, ctx)).rejects.toThrow(
        "code is required",
      );
    });
  });

  describe("fixCode", () => {
    it("composes debugger prompt with error + code", async () => {
      const fake = {
        chat: vi.fn(async () => ({ content: "// fixed code" })),
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "fixCode",
        {
          code: "x.foo()",
          error: "TypeError: x is undefined",
          language: "JavaScript",
        },
        ctx,
      );
      expect(r.fixedCode).toContain("// fixed");
      expect(r.error).toContain("TypeError");
      const [messages] = fake.chat.mock.calls[0];
      expect(messages[0].content).toContain("debugger");
      expect(messages[1].content).toContain("Error: TypeError");
      expect(messages[1].content).toContain("x.foo()");
    });

    it("throws on missing error", async () => {
      const handler = new AICommandHandler({ chat: vi.fn() }, null, db, {});
      await expect(
        handler.handle("fixCode", { code: "x" }, ctx),
      ).rejects.toThrow("error is required");
    });

    it("throws on missing code", async () => {
      const handler = new AICommandHandler({ chat: vi.fn() }, null, db, {});
      await expect(
        handler.handle("fixCode", { error: "x" }, ctx),
      ).rejects.toThrow("code is required");
    });
  });
});
