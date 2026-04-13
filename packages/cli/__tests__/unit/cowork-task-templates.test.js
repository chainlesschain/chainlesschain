import { describe, it, expect } from "vitest";
import {
  TASK_TEMPLATES,
  getTemplate,
  listTemplateIds,
} from "../../src/lib/cowork-task-templates.js";

describe("cowork-task-templates", () => {
  // ─── TASK_TEMPLATES object ────────────────────────────────

  describe("TASK_TEMPLATES", () => {
    it("has exactly 10 templates", () => {
      expect(Object.keys(TASK_TEMPLATES)).toHaveLength(10);
    });

    it("contains all expected template IDs", () => {
      const expectedIds = [
        "doc-convert",
        "media-process",
        "data-analysis",
        "web-research",
        "image-process",
        "code-helper",
        "system-admin",
        "file-organize",
        "network-tools",
        "learning-assist",
      ];
      expect(Object.keys(TASK_TEMPLATES).sort()).toEqual(expectedIds.sort());
    });

    it("each template has required fields", () => {
      for (const [id, tpl] of Object.entries(TASK_TEMPLATES)) {
        expect(tpl.id).toBe(id);
        expect(typeof tpl.name).toBe("string");
        expect(tpl.name.length).toBeGreaterThan(0);
        expect(typeof tpl.category).toBe("string");
        expect(typeof tpl.acceptsFiles).toBe("boolean");
        expect(Array.isArray(tpl.fileTypes)).toBe(true);
        expect(typeof tpl.systemPromptExtension).toBe("string");
        expect(tpl.systemPromptExtension.length).toBeGreaterThan(100);
      }
    });

    it("all templates include open-source-first prompt", () => {
      for (const tpl of Object.values(TASK_TEMPLATES)) {
        expect(tpl.systemPromptExtension).toContain("开源工具优先");
        expect(tpl.systemPromptExtension).toContain("cli-anything");
        expect(tpl.systemPromptExtension).toContain("winget");
      }
    });

    it("all templates include error recovery prompt", () => {
      for (const tpl of Object.values(TASK_TEMPLATES)) {
        expect(tpl.systemPromptExtension).toContain("错误恢复策略");
      }
    });

    it("file-accepting templates have file types defined", () => {
      const fileTemplates = Object.values(TASK_TEMPLATES).filter(
        (t) => t.acceptsFiles,
      );
      expect(fileTemplates.length).toBeGreaterThan(0);
      for (const tpl of fileTemplates) {
        expect(tpl.fileTypes.length).toBeGreaterThan(0);
        for (const ext of tpl.fileTypes) {
          expect(ext).toMatch(/^\./);
        }
      }
    });

    it("non-file templates have empty fileTypes", () => {
      const nonFileTemplates = Object.values(TASK_TEMPLATES).filter(
        (t) => !t.acceptsFiles,
      );
      expect(nonFileTemplates.length).toBeGreaterThan(0);
      for (const tpl of nonFileTemplates) {
        expect(tpl.fileTypes).toEqual([]);
      }
    });
  });

  // ─── Specific template content ────────────────────────────

  describe("doc-convert template", () => {
    it("mentions pandoc and LibreOffice", () => {
      const tpl = TASK_TEMPLATES["doc-convert"];
      expect(tpl.systemPromptExtension).toContain("pandoc");
      expect(tpl.systemPromptExtension).toContain("LibreOffice");
    });

    it("has document category", () => {
      expect(TASK_TEMPLATES["doc-convert"].category).toBe("document");
    });
  });

  describe("media-process template", () => {
    it("mentions ffmpeg", () => {
      const tpl = TASK_TEMPLATES["media-process"];
      expect(tpl.systemPromptExtension).toContain("ffmpeg");
    });

    it("accepts common media file types", () => {
      const tpl = TASK_TEMPLATES["media-process"];
      expect(tpl.fileTypes).toContain(".mp4");
      expect(tpl.fileTypes).toContain(".mp3");
    });
  });

  describe("data-analysis template", () => {
    it("mentions pandas and matplotlib", () => {
      const tpl = TASK_TEMPLATES["data-analysis"];
      expect(tpl.systemPromptExtension).toContain("pandas");
      expect(tpl.systemPromptExtension).toContain("matplotlib");
    });
  });

  describe("image-process template", () => {
    it("mentions ImageMagick and Tesseract", () => {
      const tpl = TASK_TEMPLATES["image-process"];
      expect(tpl.systemPromptExtension).toContain("ImageMagick");
      expect(tpl.systemPromptExtension).toContain("Tesseract");
    });
  });

  describe("system-admin template", () => {
    it("does not accept files", () => {
      expect(TASK_TEMPLATES["system-admin"].acceptsFiles).toBe(false);
    });

    it("has system category", () => {
      expect(TASK_TEMPLATES["system-admin"].category).toBe("system");
    });
  });

  // ─── getTemplate() ────────────────────────────────────────

  describe("getTemplate()", () => {
    it("returns template by ID", () => {
      const tpl = getTemplate("doc-convert");
      expect(tpl.id).toBe("doc-convert");
      expect(tpl.name).toBe("文档格式转换");
    });

    it("returns free-mode template for null", () => {
      const tpl = getTemplate(null);
      expect(tpl.id).toBe("free");
      expect(tpl.name).toBe("自由模式");
      expect(tpl.systemPromptExtension).toContain("开源工具优先");
    });

    it("returns free-mode template for undefined", () => {
      const tpl = getTemplate(undefined);
      expect(tpl.id).toBe("free");
    });

    it("returns free-mode template for unknown ID", () => {
      const tpl = getTemplate("nonexistent-template");
      expect(tpl.id).toBe("free");
    });

    it("free-mode template accepts files", () => {
      const tpl = getTemplate(null);
      expect(tpl.acceptsFiles).toBe(true);
    });
  });

  // ─── listTemplateIds() ────────────────────────────────────

  describe("listTemplateIds()", () => {
    it("returns array of 10 IDs", () => {
      const ids = listTemplateIds();
      expect(ids).toHaveLength(10);
      expect(ids).toContain("doc-convert");
      expect(ids).toContain("media-process");
      expect(ids).toContain("learning-assist");
    });

    it("matches TASK_TEMPLATES keys", () => {
      expect(listTemplateIds()).toEqual(Object.keys(TASK_TEMPLATES));
    });
  });

  // ─── winget ID table ──────────────────────────────────────

  describe("winget ID table", () => {
    it("all templates reference at least one winget ID in shared prompt", () => {
      const sharedPrompt = TASK_TEMPLATES["doc-convert"].systemPromptExtension;
      expect(sharedPrompt).toContain("Gyan.FFmpeg");
      expect(sharedPrompt).toContain("JohnMacFarlane.Pandoc");
      expect(sharedPrompt).toContain("ImageMagick.ImageMagick");
      expect(sharedPrompt).toContain("UB-Mannheim.TesseractOCR");
    });
  });
});
