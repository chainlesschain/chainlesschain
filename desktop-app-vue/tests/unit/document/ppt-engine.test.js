/**
 * PPT引擎测试
 * 测试 PowerPoint 演示文稿生成、主题配置和LLM增强功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Mock dependencies using vi.hoisted to ensure mocks survive vi.resetModules()
// IMPORTANT: Source uses `const pptxgen = require('pptxgenjs')` then `new pptxgen()`
// So we must return the constructor function as the default export
const mockPptxGenConstructor = vi.hoisted(() => {
  const createMockInstance = () => ({
    author: "",
    title: "",
    company: "",
    slides: [],
    addSlide: vi.fn(() => ({
      background: null,
      addText: vi.fn(),
      addChart: vi.fn(),
      addImage: vi.fn(),
    })),
    writeFile: vi.fn().mockResolvedValue(undefined),
  });

  const constructor = vi.fn(function () {
    return createMockInstance();
  });

  return constructor;
});

vi.mock("pptxgenjs", () => {
  // For CommonJS require(), Vitest will use `default` export
  return {
    default: mockPptxGenConstructor,
  };
});

vi.mock("fs", () => ({
  default: {
    promises: {
      writeFile: vi.fn(),
      unlink: vi.fn(),
    },
  },
  promises: {
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Create hoisted mock for http
const mockHttp = vi.hoisted(() => ({
  default: {
    request: vi.fn(),
  },
  request: vi.fn(),
}));

vi.mock("http", () => mockHttp);

// Import PPTEngine once at module level (after mocks are set up)
let PPTEngineModule;

describe("PPT引擎测试", () => {
  let PPTEngine;
  let pptEngine;
  let mockPptxgen;
  let tmpDir;
  let testPptxPath;

  beforeAll(async () => {
    // Import the module once - mocks are already set up by vi.mock
    PPTEngineModule = await import("../../../src/main/engines/ppt-engine.js");
  });

  beforeEach(async () => {
    // Clear mock call history but don't reset modules
    vi.clearAllMocks();

    // Create temporary directory for test files
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-test-"));
    testPptxPath = path.join(tmpDir, "test.pptx");

    // Use the module-level mock constructor
    mockPptxgen = mockPptxGenConstructor;

    // Get PPTEngine from the cached module
    PPTEngine = PPTEngineModule.default;
    pptEngine = new PPTEngine();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    // Clean up temporary directory
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to clean up temp directory:", error);
      }
    }
  });

  describe("基础功能", () => {
    it("should create PPTEngine instance", () => {
      expect(pptEngine).toBeDefined();
      expect(pptEngine.themes).toBeDefined();
    });

    it("should have all theme configurations", () => {
      expect(pptEngine.themes.business).toBeDefined();
      expect(pptEngine.themes.academic).toBeDefined();
      expect(pptEngine.themes.creative).toBeDefined();
      expect(pptEngine.themes.dark).toBeDefined();
    });

    it("should have all required methods", () => {
      expect(typeof pptEngine.generateFromOutline).toBe("function");
      expect(typeof pptEngine.generateFromMarkdown).toBe("function");
      expect(typeof pptEngine.parseMarkdownToOutline).toBe("function");
      expect(typeof pptEngine.createTitleSlide).toBe("function");
      expect(typeof pptEngine.createSectionSlide).toBe("function");
      expect(typeof pptEngine.createContentSlide).toBe("function");
      expect(typeof pptEngine.createEndSlide).toBe("function");
      expect(typeof pptEngine.addChart).toBe("function");
      expect(typeof pptEngine.addImage).toBe("function");
    });

    it("should have correct theme properties", () => {
      const theme = pptEngine.themes.business;
      expect(theme.name).toBe("商务主题");
      expect(theme.primaryColor).toBe("1E40AF");
      expect(theme.secondaryColor).toBe("3B82F6");
      expect(theme.backgroundColor).toBe("FFFFFF");
      expect(theme.textColor).toBe("1F2937");
    });
  });

  describe("generateFromOutline", () => {
    it("should generate PPT from outline", async () => {
      const outline = {
        title: "Test Presentation",
        subtitle: "Subtitle",
        sections: [
          {
            title: "Section 1",
            subsections: [
              {
                title: "Subsection 1",
                points: ["Point 1", "Point 2"],
              },
            ],
          },
        ],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe(testPptxPath);
      expect(result.fileName).toBe("Test Presentation.pptx");
      expect(mockPptxgen).toHaveBeenCalled();
    });

    it("should use custom theme", async () => {
      const outline = {
        title: "Test",
        sections: [],
      };

      await pptEngine.generateFromOutline(outline, {
        theme: "academic",
        outputPath: testPptxPath,
      });

      expect(mockPptxgen).toHaveBeenCalled();
    });

    it("should use custom author", async () => {
      const outline = {
        title: "Test",
        sections: [],
      };

      await pptEngine.generateFromOutline(outline, {
        author: "John Doe",
        outputPath: testPptxPath,
      });

      const pptInstance = mockPptxgen.mock.results[0].value;
      expect(pptInstance.author).toBe("John Doe");
    });

    it("should create title slide", async () => {
      const outline = {
        title: "My Presentation",
        subtitle: "My Subtitle",
        sections: [],
      };

      await pptEngine.generateFromOutline(outline, {
        author: "Author",
        outputPath: testPptxPath,
      });

      const pptInstance = mockPptxgen.mock.results[0].value;
      expect(pptInstance.addSlide).toHaveBeenCalled();
    });

    it("should create section slides", async () => {
      const outline = {
        title: "Test",
        sections: [
          { title: "Section 1", subsections: [] },
          { title: "Section 2", subsections: [] },
        ],
      };

      await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      const pptInstance = mockPptxgen.mock.results[0].value;
      // Title + 2 sections + end slide
      expect(pptInstance.addSlide).toHaveBeenCalled();
    });

    it("should create content slides for subsections", async () => {
      const outline = {
        title: "Test",
        sections: [
          {
            title: "Section 1",
            subsections: [
              { title: "Sub 1", points: ["Point 1"] },
              { title: "Sub 2", points: ["Point 2"] },
            ],
          },
        ],
      };

      await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      const pptInstance = mockPptxgen.mock.results[0].value;
      expect(pptInstance.addSlide).toHaveBeenCalled();
    });

    it("should create end slide", async () => {
      const outline = {
        title: "Test",
        sections: [],
      };

      await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      const pptInstance = mockPptxgen.mock.results[0].value;
      expect(pptInstance.addSlide).toHaveBeenCalled();
    });

    it("should handle generation errors", async () => {
      mockPptxgen.mockImplementationOnce(() => {
        throw new Error("Generation failed");
      });

      const outline = { title: "Test", sections: [] };

      await expect(
        pptEngine.generateFromOutline(outline, { outputPath: testPptxPath }),
      ).rejects.toThrow("生成PPT失败");
    });

    it("should use default output path if not provided", async () => {
      const outline = {
        title: "My Presentation",
        sections: [],
      };

      const result = await pptEngine.generateFromOutline(outline);

      expect(result.success).toBe(true);
      expect(result.fileName).toContain("My Presentation.pptx");
    });

    it("should return slide count", async () => {
      const outline = {
        title: "Test",
        sections: [
          {
            title: "Section 1",
            subsections: [{ title: "Sub 1", points: [] }],
          },
        ],
      };

      const pptInstance = {
        author: "",
        title: "",
        company: "",
        slides: [1, 2, 3, 4], // Mock slides array
        addSlide: vi.fn(() => ({
          background: null,
          addText: vi.fn(),
        })),
        writeFile: vi.fn().mockResolvedValue(undefined),
      };

      mockPptxgen.mockReturnValueOnce(pptInstance);

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.slideCount).toBe(4);
    });
  });

  describe("parseMarkdownToOutline", () => {
    it("should parse simple markdown", () => {
      const markdown = `# Main Title
## Section 1
### Subsection 1
- Point 1
- Point 2`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      expect(outline.title).toBe("Main Title");
      expect(outline.sections).toHaveLength(1);
      expect(outline.sections[0].title).toBe("Section 1");
      expect(outline.sections[0].subsections).toHaveLength(1);
      expect(outline.sections[0].subsections[0].points).toHaveLength(2);
    });

    it("should handle H1 as title", () => {
      const markdown = "# My Presentation\n## Section";

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      expect(outline.title).toBe("My Presentation");
    });

    it("should handle H2 as sections", () => {
      const markdown = `## Section 1
## Section 2`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      expect(outline.sections).toHaveLength(2);
      expect(outline.sections[0].title).toBe("Section 1");
      expect(outline.sections[1].title).toBe("Section 2");
    });

    it("should handle H3 as subsections", () => {
      const markdown = `## Section
### Sub 1
### Sub 2`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      expect(outline.sections[0].subsections).toHaveLength(2);
    });

    it("should parse bullet points", () => {
      const markdown = `## Section
### Subsection
- Point 1
- Point 2
- Point 3`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      const points = outline.sections[0].subsections[0].points;
      expect(points).toHaveLength(3);
      expect(points[0]).toBe("Point 1");
    });

    it("should parse numbered lists", () => {
      const markdown = `## Section
### Subsection
1. First
2. Second
3. Third`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      const points = outline.sections[0].subsections[0].points;
      expect(points).toHaveLength(3);
      expect(points[0]).toBe("First");
    });

    it("should handle mixed list types", () => {
      const markdown = `## Section
### Subsection
- Bullet
* Another bullet
+ Plus bullet
1. Numbered`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      const points = outline.sections[0].subsections[0].points;
      expect(points).toHaveLength(4);
    });

    it("should truncate long lines", () => {
      const longLine = "a".repeat(150);
      const markdown = `## Section
### Subsection
${longLine}`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      const point = outline.sections[0].subsections[0].points[0];
      expect(point.length).toBe(103); // 100 + '...'
      expect(point.endsWith("...")).toBe(true);
    });

    it("should skip short lines", () => {
      const markdown = `## Section
### Subsection
Short
This is a longer line that should be included`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      const points = outline.sections[0].subsections[0].points;
      // "Short" is only 5 chars, should be skipped (< 10)
      expect(points).toHaveLength(1);
      expect(points[0]).toContain("longer line");
    });

    it("should skip separator lines", () => {
      const markdown = `## Section
### Subsection
---
Valid point
===`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      const points = outline.sections[0].subsections[0].points;
      expect(points).toHaveLength(1);
      expect(points[0]).toBe("Valid point");
    });

    it("should use first section as title if no H1", () => {
      const markdown = `## First Section
## Second Section`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      expect(outline.title).toBe("First Section");
      expect(outline.sections).toHaveLength(1);
      expect(outline.sections[0].title).toBe("Second Section");
    });

    it("should set default subtitle", () => {
      const markdown = "# Title";

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      // Check that subtitle contains current year
      const currentYear = new Date().getFullYear().toString();
      expect(outline.subtitle).toContain(currentYear);
    });

    it("should handle empty markdown", () => {
      const outline = pptEngine.parseMarkdownToOutline("");

      expect(outline.title).toBe("");
      expect(outline.sections).toHaveLength(0);
    });

    it("should handle points without subsection", () => {
      const markdown = `## Section
- Point 1
- Point 2`;

      const outline = pptEngine.parseMarkdownToOutline(markdown);

      expect(outline.sections[0].subsections).toHaveLength(1);
      expect(outline.sections[0].subsections[0].title).toBe("Section");
      expect(outline.sections[0].subsections[0].points).toHaveLength(2);
    });
  });

  describe("generateFromMarkdown", () => {
    it("should generate PPT from markdown", async () => {
      const markdown = `# Test Presentation
## Section 1
### Subsection
- Point 1`;

      const result = await pptEngine.generateFromMarkdown(markdown, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
      expect(mockPptxgen).toHaveBeenCalled();
    });

    it("should use LLM enhancement if parsing fails", async () => {
      const markdown = "Some unstructured text without headings";

      // Mock LLM manager
      const mockLLMManager = {
        query: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            title: "Generated Title",
            sections: [{ title: "Section", subsections: [] }],
          }),
        }),
      };

      const result = await pptEngine.generateFromMarkdown(markdown, {
        llmManager: mockLLMManager,
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
    });

    it("should pass theme to generateFromOutline", async () => {
      const markdown = "# Test\n## Section";

      const result = await pptEngine.generateFromMarkdown(markdown, {
        theme: "creative",
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
      expect(result.theme).toBe("creative");
    });

    it("should handle markdown conversion errors", async () => {
      // Force an error by mocking pptxgen to throw
      mockPptxgen.mockImplementationOnce(() => {
        throw new Error("PPT creation failed");
      });

      await expect(
        pptEngine.generateFromMarkdown("# Test", { outputPath: testPptxPath }),
      ).rejects.toThrow("从Markdown生成PPT失败");
    });
  });

  describe("generateOutlineFromDescription", () => {
    it("should generate outline using LLM", async () => {
      const mockLLMManager = {
        isInitialized: true,
        query: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            title: "AI Generated Title",
            subtitle: "Subtitle",
            sections: [
              {
                title: "Section 1",
                subsections: [
                  { title: "Sub 1", points: ["Point 1", "Point 2"] },
                ],
              },
            ],
          }),
        }),
      };

      const outline = await pptEngine.generateOutlineFromDescription(
        "Create a presentation about AI",
        mockLLMManager,
      );

      expect(outline.title).toBe("AI Generated Title");
      expect(outline.sections).toHaveLength(1);
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it("should extract JSON from LLM response", async () => {
      const mockLLMManager = {
        isInitialized: true,
        query: vi.fn().mockResolvedValue({
          text: 'Here is the outline: {"title": "Test", "sections": []}',
        }),
      };

      const outline = await pptEngine.generateOutlineFromDescription(
        "Test",
        mockLLMManager,
      );

      expect(outline.title).toBe("Test");
    });

    it("should use default outline if LLM fails", async () => {
      const mockLLMManager = {
        isInitialized: true,
        query: vi.fn().mockRejectedValue(new Error("LLM failed")),
      };

      const outline = await pptEngine.generateOutlineFromDescription(
        "Test description",
        mockLLMManager,
      );

      expect(outline.title).toContain("Test description");
      expect(outline.sections).toHaveLength(3); // Default outline has 3 sections
    });

    it("should use default outline if JSON parsing fails", async () => {
      const mockLLMManager = {
        isInitialized: true,
        query: vi.fn().mockResolvedValue({
          text: "Invalid JSON response",
        }),
      };

      const outline = await pptEngine.generateOutlineFromDescription(
        "Test",
        mockLLMManager,
      );

      expect(outline.sections).toBeDefined();
    });

    it("should fall back to backend AI if LLM not initialized", async () => {
      const mockLLMManager = {
        isInitialized: false,
      };

      // Mock HTTP request
      const mockReq = {
        on: vi.fn((event, handler) => {
          if (event === "error") {
            return mockReq;
          }
          if (event === "timeout") {
            return mockReq;
          }
          return mockReq;
        }),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };

      const mockRes = {
        on: vi.fn((event, handler) => {
          if (event === "data") {
            // Simulate SSE response
            handler(
              'data: {"type":"content","content":"{\\"title\\":\\"Test\\""}\n',
            );
            handler('data: {"type":"content","content":","sections\\":[]}"}\n');
            handler('data: {"type":"done"}\n');
          }
          if (event === "end") {
            setTimeout(handler, 0);
          }
          return mockRes;
        }),
      };

      mockHttp.default.request.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const outline = await pptEngine.generateOutlineFromDescription(
        "Test",
        mockLLMManager,
      );

      expect(outline).toBeDefined();
    });
  });

  describe("createTitleSlide", () => {
    it("should create title slide with all elements", () => {
      const mockSlide = {
        background: null,
        addText: vi.fn(),
      };

      const mockPpt = {
        addSlide: vi.fn(() => mockSlide),
      };

      const theme = pptEngine.themes.business;

      pptEngine.createTitleSlide(
        mockPpt,
        "My Title",
        "My Subtitle",
        "Author",
        theme,
      );

      expect(mockSlide.addText).toHaveBeenCalledTimes(3); // Title, subtitle, author+date
    });

    it("should handle missing subtitle", () => {
      const mockSlide = {
        background: null,
        addText: vi.fn(),
      };

      const mockPpt = {
        addSlide: vi.fn(() => mockSlide),
      };

      pptEngine.createTitleSlide(
        mockPpt,
        "Title",
        null,
        "Author",
        pptEngine.themes.business,
      );

      expect(mockSlide.addText).toHaveBeenCalledTimes(2); // Title and author+date only
    });
  });

  describe("createSectionSlide", () => {
    it("should create section slide", () => {
      const mockSlide = {
        background: null,
        addText: vi.fn(),
      };

      const mockPpt = {
        addSlide: vi.fn(() => mockSlide),
      };

      pptEngine.createSectionSlide(
        mockPpt,
        "Section Title",
        pptEngine.themes.academic,
      );

      expect(mockSlide.addText).toHaveBeenCalledWith(
        "Section Title",
        expect.objectContaining({
          fontSize: 40,
          bold: true,
        }),
      );
    });
  });

  describe("createContentSlide", () => {
    it("should create content slide with bullet points", () => {
      const mockSlide = {
        background: null,
        addText: vi.fn(),
      };

      const mockPpt = {
        addSlide: vi.fn(() => mockSlide),
      };

      const slideData = {
        title: "Content Title",
        bulletPoints: ["Point 1", "Point 2", "Point 3"],
        layout: "content",
      };

      pptEngine.createContentSlide(
        mockPpt,
        slideData,
        pptEngine.themes.creative,
      );

      expect(mockSlide.addText).toHaveBeenCalledTimes(2); // Title + bullet points
    });

    it("should handle slide without bullet points", () => {
      const mockSlide = {
        background: null,
        addText: vi.fn(),
      };

      const mockPpt = {
        addSlide: vi.fn(() => mockSlide),
      };

      const slideData = {
        title: "Title Only",
        bulletPoints: [],
      };

      pptEngine.createContentSlide(mockPpt, slideData, pptEngine.themes.dark);

      expect(mockSlide.addText).toHaveBeenCalledTimes(1); // Title only
    });
  });

  describe("createEndSlide", () => {
    it("should create end slide", () => {
      const mockSlide = {
        background: null,
        addText: vi.fn(),
      };

      const mockPpt = {
        addSlide: vi.fn(() => mockSlide),
      };

      pptEngine.createEndSlide(mockPpt, "谢谢观看", pptEngine.themes.business);

      expect(mockSlide.addText).toHaveBeenCalledWith(
        "谢谢观看",
        expect.objectContaining({
          fontSize: 48,
          bold: true,
        }),
      );
    });
  });

  describe("addChart", () => {
    it("should add chart to slide", () => {
      const mockSlide = {
        addText: vi.fn(),
        addChart: vi.fn(),
      };

      const chartData = {
        type: "bar",
        title: "Sales Data",
        data: [
          { name: "Q1", values: [100] },
          { name: "Q2", values: [150] },
        ],
      };

      pptEngine.addChart(mockSlide, chartData, pptEngine.themes.business);

      expect(mockSlide.addText).toHaveBeenCalledWith(
        "Sales Data",
        expect.anything(),
      );
      expect(mockSlide.addChart).toHaveBeenCalled();
    });

    it("should use custom position", () => {
      const mockSlide = {
        addText: vi.fn(),
        addChart: vi.fn(),
      };

      const chartData = {
        type: "line",
        title: "Chart",
        data: [],
        position: { x: 2, y: 3, w: 6, h: 3 },
      };

      pptEngine.addChart(mockSlide, chartData, pptEngine.themes.academic);

      expect(mockSlide.addChart).toHaveBeenCalledWith(
        "line",
        [],
        expect.objectContaining({
          x: 2,
          y: 3,
          w: 6,
          h: 3,
        }),
      );
    });

    it("should handle chart errors gracefully", () => {
      const mockSlide = {
        addText: vi.fn(),
        addChart: vi.fn(() => {
          throw new Error("Chart error");
        }),
      };

      const chartData = {
        type: "bar",
        title: "Chart",
        data: [],
      };

      // Should not throw
      expect(() => {
        pptEngine.addChart(mockSlide, chartData, pptEngine.themes.creative);
      }).not.toThrow();
    });
  });

  describe("addImage", () => {
    it("should add image from path", () => {
      const mockSlide = {
        addImage: vi.fn(),
      };

      const imageData = {
        path: "/path/to/image.jpg",
        position: { x: 2, y: 2, w: 6, h: 4 },
      };

      pptEngine.addImage(mockSlide, imageData);

      expect(mockSlide.addImage).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/path/to/image.jpg",
          x: 2,
          y: 2,
          w: 6,
          h: 4,
        }),
      );
    });

    it("should add image from data URL", () => {
      const mockSlide = {
        addImage: vi.fn(),
      };

      const imageData = {
        data: "data:image/png;base64,iVBORw0KGgo...",
      };

      pptEngine.addImage(mockSlide, imageData);

      expect(mockSlide.addImage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: "data:image/png;base64,iVBORw0KGgo...",
        }),
      );
    });

    it("should use default position if not provided", () => {
      const mockSlide = {
        addImage: vi.fn(),
      };

      const imageData = {
        path: "/image.jpg",
      };

      pptEngine.addImage(mockSlide, imageData);

      expect(mockSlide.addImage).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 2,
          y: 2,
          w: 6,
          h: 4,
        }),
      );
    });

    it("should handle image errors gracefully", () => {
      const mockSlide = {
        addImage: vi.fn(() => {
          throw new Error("Image error");
        }),
      };

      const imageData = {
        path: "/image.jpg",
      };

      // Should not throw
      expect(() => {
        pptEngine.addImage(mockSlide, imageData);
      }).not.toThrow();
    });
  });

  describe("边界条件和错误处理", () => {
    it("should handle outline without title", async () => {
      const outline = {
        sections: [],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
    });

    it("should handle outline without sections", async () => {
      const outline = {
        title: "Test",
        sections: [],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
    });

    it("should handle empty subsections", async () => {
      const outline = {
        title: "Test",
        sections: [
          {
            title: "Section",
            subsections: [],
          },
        ],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
    });

    it("should handle Unicode in content", async () => {
      const outline = {
        title: "你好世界 🌍",
        sections: [
          {
            title: "مرحبا",
            subsections: [
              {
                title: "こんにちは",
                points: ["안녕하세요"],
              },
            ],
          },
        ],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
    });

    it("should handle very long titles", async () => {
      const longTitle = "A".repeat(200);
      const outline = {
        title: longTitle,
        sections: [],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        outputPath: testPptxPath,
      });

      expect(result.success).toBe(true);
    });

    it("should handle unknown theme gracefully", async () => {
      const outline = {
        title: "Test",
        sections: [],
      };

      const result = await pptEngine.generateFromOutline(outline, {
        theme: "unknown",
        outputPath: testPptxPath,
      });

      // Should fall back to business theme
      expect(result.success).toBe(true);
    });
  });
});
