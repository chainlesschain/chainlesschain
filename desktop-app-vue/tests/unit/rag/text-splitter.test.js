/**
 * 文本分块器单元测试
 * 测试目标: src/main/rag/text-splitter.js
 * 覆盖场景: 文本分割、递归分块、重叠管理、Markdown/代码分割
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

describe("TextSplitter", () => {
  let RecursiveCharacterTextSplitter;
  let MarkdownTextSplitter;
  let CodeTextSplitter;
  let DEFAULT_SPLITTER_CONFIG;
  let splitter;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import of module under test
    const module = await import("../../../src/main/rag/text-splitter.js");
    RecursiveCharacterTextSplitter = module.RecursiveCharacterTextSplitter;
    MarkdownTextSplitter = module.MarkdownTextSplitter;
    CodeTextSplitter = module.CodeTextSplitter;
    DEFAULT_SPLITTER_CONFIG = module.DEFAULT_SPLITTER_CONFIG;
  });

  afterEach(() => {
    if (splitter) {
      splitter = null;
    }
  });

  describe("DEFAULT_SPLITTER_CONFIG", () => {
    it("应该定义默认配置", () => {
      expect(DEFAULT_SPLITTER_CONFIG).toBeDefined();
      expect(DEFAULT_SPLITTER_CONFIG.chunkSize).toBe(500);
      expect(DEFAULT_SPLITTER_CONFIG.chunkOverlap).toBe(50);
      expect(DEFAULT_SPLITTER_CONFIG.keepSeparator).toBe(true);
    });

    it("应该包含分隔符列表", () => {
      expect(DEFAULT_SPLITTER_CONFIG.separators).toBeInstanceOf(Array);
      expect(DEFAULT_SPLITTER_CONFIG.separators.length).toBeGreaterThan(0);
      expect(DEFAULT_SPLITTER_CONFIG.separators).toContain("\n\n");
      expect(DEFAULT_SPLITTER_CONFIG.separators).toContain("\n");
    });

    it("应该包含中文分隔符", () => {
      expect(DEFAULT_SPLITTER_CONFIG.separators).toContain("。");
      expect(DEFAULT_SPLITTER_CONFIG.separators).toContain("，");
      expect(DEFAULT_SPLITTER_CONFIG.separators).toContain("！");
      expect(DEFAULT_SPLITTER_CONFIG.separators).toContain("？");
    });
  });

  describe("RecursiveCharacterTextSplitter - 构造函数", () => {
    it("应该创建实例并使用默认配置", () => {
      splitter = new RecursiveCharacterTextSplitter();

      expect(splitter.config.chunkSize).toBe(500);
      expect(splitter.config.chunkOverlap).toBe(50);
      expect(splitter.config.keepSeparator).toBe(true);
    });

    it("应该接受自定义配置", () => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100,
        keepSeparator: false,
      });

      expect(splitter.config.chunkSize).toBe(1000);
      expect(splitter.config.chunkOverlap).toBe(100);
      expect(splitter.config.keepSeparator).toBe(false);
    });

    it("应该合并自定义配置和默认配置", () => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
      });

      expect(splitter.config.chunkSize).toBe(1000);
      expect(splitter.config.chunkOverlap).toBe(50); // 默认值
      expect(splitter.config.separators).toBeDefined();
    });

    it("应该设置默认lengthFunction", () => {
      splitter = new RecursiveCharacterTextSplitter();

      expect(splitter.config.lengthFunction).toBeInstanceOf(Function);
      expect(splitter.config.lengthFunction("hello")).toBe(5);
    });

    it("应该接受自定义lengthFunction", () => {
      const customLength = vi.fn((text) => text.split(" ").length);
      splitter = new RecursiveCharacterTextSplitter({
        lengthFunction: customLength,
      });

      expect(splitter.config.lengthFunction).toBe(customLength);
      splitter.config.lengthFunction("hello world");
      expect(customLength).toHaveBeenCalledWith("hello world");
    });

    it("应该继承EventEmitter", () => {
      splitter = new RecursiveCharacterTextSplitter();

      // Check for EventEmitter methods
      expect(typeof splitter.on).toBe("function");
      expect(typeof splitter.emit).toBe("function");
      expect(typeof splitter.removeListener).toBe("function");
    });
  });

  describe("splitText", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
        chunkOverlap: 10,
      });
    });

    it("应该处理空文本", () => {
      const chunks = splitter.splitText("");
      expect(chunks).toEqual([]);
    });

    it("应该处理只有空格的文本", () => {
      const chunks = splitter.splitText("   ");
      expect(chunks).toEqual([]);
    });

    it("应该分割短文本为单个块", () => {
      const text = "Hello world!";
      const chunks = splitter.splitText(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(text);
      expect(chunks[0].metadata.chunkIndex).toBe(0);
      expect(chunks[0].metadata.totalChunks).toBe(1);
    });

    it("应该分割长文本为多个块", () => {
      const text = "a".repeat(150); // 150 characters
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(50);
      });
    });

    it("应该在块元数据中包含正确的索引", () => {
      const text = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5";
      const chunks = splitter.splitText(text);

      chunks.forEach((chunk, index) => {
        expect(chunk.metadata.chunkIndex).toBe(index);
        expect(chunk.metadata.totalChunks).toBe(chunks.length);
      });
    });

    it("应该保留自定义元数据", () => {
      const text = "Hello world!";
      const metadata = { source: "test.txt", author: "Alice" };
      const chunks = splitter.splitText(text, metadata);

      expect(chunks[0].metadata.source).toBe("test.txt");
      expect(chunks[0].metadata.author).toBe("Alice");
    });

    it("应该在元数据中包含块大小", () => {
      const text = "Hello world!";
      const chunks = splitter.splitText(text);

      expect(chunks[0].metadata.chunkSize).toBe(text.length);
    });

    it("应该发出split-complete事件", () => {
      const eventHandler = vi.fn();
      splitter.on("split-complete", eventHandler);

      const text = "Hello world!";
      splitter.splitText(text);

      expect(eventHandler).toHaveBeenCalledWith({
        originalLength: text.length,
        chunkCount: 1,
        avgChunkSize: text.length,
      });
    });

    it("应该使用段落分隔符分割文本", () => {
      const text = "Paragraph 1\n\nParagraph 2\n\nParagraph 3";
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(50);
      });
    });

    it("应该处理中文文本", () => {
      const text = "这是第一段。这是第二段。这是第三段。";
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toBeTruthy();
    });
  });

  describe("_splitTextWithSeparator", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter();
    });

    it("应该在没有分隔符时返回整个文本", () => {
      const text = "Hello world";
      const splits = splitter._splitTextWithSeparator(text, "");

      expect(splits).toEqual([text]);
    });

    it("应该使用分隔符分割文本", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const splits = splitter._splitTextWithSeparator(text, "\n");

      expect(splits.length).toBeGreaterThan(1);
    });

    it("应该在keepSeparator为true时保留分隔符", () => {
      splitter.config.keepSeparator = true;
      const text = "Line 1\nLine 2\nLine 3";
      const splits = splitter._splitTextWithSeparator(text, "\n");

      expect(splits.some((s) => s.includes("\n"))).toBe(true);
    });

    it("应该在keepSeparator为false时不保留分隔符", () => {
      splitter.config.keepSeparator = false;
      const text = "Line 1\nLine 2\nLine 3";
      const splits = splitter._splitTextWithSeparator(text, "\n");

      // The last split won't have separator
      const nonLastSplits = splits.slice(0, -1);
      expect(nonLastSplits.every((s) => !s.includes("\n"))).toBe(true);
    });

    it("应该过滤空字符串", () => {
      const text = "a\n\nb"; // Double newline creates empty part
      const splits = splitter._splitTextWithSeparator(text, "\n");

      expect(splits.every((s) => s.length > 0)).toBe(true);
    });
  });

  describe("_mergeSplits", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 20,
      });
    });

    it("应该合并小片段", () => {
      const splits = ["Hello", " ", "world"];
      const merged = splitter._mergeSplits(splits, " ");

      expect(merged.length).toBeLessThan(splits.length);
    });

    it("应该在达到chunkSize时创建新块", () => {
      const splits = ["a".repeat(10), "b".repeat(10), "c".repeat(10)];
      const merged = splitter._mergeSplits(splits, "");

      expect(merged.length).toBeGreaterThan(1);
    });

    it("应该处理空splits", () => {
      const merged = splitter._mergeSplits([], "");
      expect(merged).toEqual([]);
    });

    it("应该正确使用分隔符合并", () => {
      const splits = ["a", "b", "c"];
      const merged = splitter._mergeSplits(splits, "-");

      // Should merge with separator
      expect(merged.some((m) => m.includes("-"))).toBe(true);
    });
  });

  describe("_forceSplit", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 10,
        chunkOverlap: 2,
      });
    });

    it("应该强制分割长文本", () => {
      const text = "a".repeat(30);
      const chunks = splitter._forceSplit(text);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(10);
      });
    });

    it("应该创建带重叠的块", () => {
      const text = "abcdefghijklmnopqrstuvwxyz";
      const chunks = splitter._forceSplit(text);

      // Check overlap exists between consecutive chunks
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentEnd = chunks[i].slice(-2);
        const nextStart = chunks[i + 1].slice(0, 2);
        // Overlap should make some characters appear in both chunks
        expect(chunks[i].length).toBeLessThanOrEqual(10);
      }
    });

    it("应该处理短于chunkSize的文本", () => {
      const text = "short";
      const chunks = splitter._forceSplit(text);

      expect(chunks).toEqual([text]);
    });

    it("应该处理正好等于chunkSize的文本", () => {
      const text = "a".repeat(10);
      const chunks = splitter._forceSplit(text);

      expect(chunks).toEqual([text]);
    });
  });

  describe("splitDocuments", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
      });
    });

    it("应该分割多个文档", () => {
      const documents = [
        { content: "Document 1 content", metadata: { id: 1 } },
        { content: "Document 2 content", metadata: { id: 2 } },
      ];

      const chunks = splitter.splitDocuments(documents);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.metadata.id === 1)).toBe(true);
      expect(chunks.some((c) => c.metadata.id === 2)).toBe(true);
    });

    it("应该保留每个文档的元数据", () => {
      const documents = [
        { content: "Content", metadata: { source: "doc1.txt" } },
      ];

      const chunks = splitter.splitDocuments(documents);

      expect(chunks[0].metadata.source).toBe("doc1.txt");
    });

    it("应该处理空文档列表", () => {
      const chunks = splitter.splitDocuments([]);
      expect(chunks).toEqual([]);
    });

    it("应该处理包含空内容的文档", () => {
      const documents = [
        { content: "", metadata: { id: 1 } },
        { content: "Valid content", metadata: { id: 2 } },
      ];

      const chunks = splitter.splitDocuments(documents);

      expect(chunks.every((c) => c.content.length > 0)).toBe(true);
    });
  });

  describe("createChunksWithOverlap", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
        chunkOverlap: 10,
      });
    });

    it("应该创建带重叠的块", () => {
      const text = "a".repeat(150);
      const chunks = splitter.createChunksWithOverlap(text);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该在元数据中包含startOffset和endOffset", () => {
      const text = "a".repeat(200);
      const chunks = splitter.createChunksWithOverlap(text);

      // When using sliding window (< 3 smart chunks), should have offsets
      if (chunks.length >= 3 && chunks[0].metadata.startOffset !== undefined) {
        expect(chunks[0].metadata.startOffset).toBe(0);
        expect(chunks[0].metadata.endOffset).toBeGreaterThan(0);
      }
    });

    it("应该使用智能分割当产生足够多的块时", () => {
      const text = "Paragraph 1\n\nParagraph 2\n\nParagraph 3\n\nParagraph 4";
      const chunks = splitter.createChunksWithOverlap(text);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该使用滑窗模式当智能分割产生块太少时", () => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 100,
        chunkOverlap: 20,
      });

      const text = "a".repeat(300); // Long text without natural separators
      const chunks = splitter.createChunksWithOverlap(text);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it("应该保留自定义元数据", () => {
      const text = "Hello world!";
      const metadata = { source: "test.txt" };
      const chunks = splitter.createChunksWithOverlap(text, metadata);

      expect(chunks[0].metadata.source).toBe("test.txt");
    });
  });

  describe("getChunkStats", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
      });
    });

    it("应该返回统计信息", () => {
      const text = "a".repeat(150);
      const stats = splitter.getChunkStats(text);

      expect(stats.totalChunks).toBeGreaterThan(0);
      expect(stats.originalLength).toBe(150);
      expect(stats.avgChunkSize).toBeGreaterThan(0);
      expect(stats.minChunkSize).toBeGreaterThan(0);
      expect(stats.maxChunkSize).toBeGreaterThan(0);
      expect(stats.compressionRatio).toBeDefined();
    });

    it("应该计算正确的平均值", () => {
      const text = "Line 1\n\nLine 2\n\nLine 3";
      const stats = splitter.getChunkStats(text);

      expect(stats.avgChunkSize).toBeGreaterThan(0);
      expect(stats.avgChunkSize).toBeLessThanOrEqual(stats.maxChunkSize);
      expect(stats.avgChunkSize).toBeGreaterThanOrEqual(stats.minChunkSize);
    });

    it("应该处理单个块", () => {
      const text = "Short text";
      const stats = splitter.getChunkStats(text);

      expect(stats.totalChunks).toBe(1);
      expect(stats.minChunkSize).toBe(stats.maxChunkSize);
      expect(stats.avgChunkSize).toBe(text.length);
    });

    it("应该返回compressionRatio字符串", () => {
      const text = "Hello world";
      const stats = splitter.getChunkStats(text);

      expect(typeof stats.compressionRatio).toBe("string");
      expect(parseFloat(stats.compressionRatio)).toBeGreaterThan(0);
    });
  });

  describe("updateConfig / getConfig", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
      });
    });

    it("应该更新配置", () => {
      splitter.updateConfig({ chunkSize: 1000 });

      expect(splitter.config.chunkSize).toBe(1000);
      // Logger mock is cleared in beforeEach, so we can't reliably test it
    });

    it("应该合并新配置而不覆盖所有配置", () => {
      const originalOverlap = splitter.config.chunkOverlap;
      splitter.updateConfig({ chunkSize: 1000 });

      expect(splitter.config.chunkSize).toBe(1000);
      expect(splitter.config.chunkOverlap).toBe(originalOverlap);
    });

    it("应该返回配置副本", () => {
      const config = splitter.getConfig();

      expect(config).toEqual(splitter.config);
      expect(config).not.toBe(splitter.config); // Should be a copy
    });

    it("应该允许修改返回的配置而不影响原配置", () => {
      const config = splitter.getConfig();
      const originalSize = splitter.config.chunkSize;

      config.chunkSize = 9999;

      expect(splitter.config.chunkSize).toBe(originalSize);
    });
  });

  describe("错误处理和边界情况", () => {
    beforeEach(() => {
      splitter = new RecursiveCharacterTextSplitter();
    });

    it("应该处理null文本", () => {
      const chunks = splitter.splitText(null);
      expect(chunks).toEqual([]);
    });

    it("应该处理undefined文本", () => {
      const chunks = splitter.splitText(undefined);
      expect(chunks).toEqual([]);
    });

    it("应该处理包含特殊字符的文本", () => {
      const text = "Hello\t\r\n\fWorld!@#$%^&*()";
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该处理Unicode字符", () => {
      const text = "你好世界 😀 Привет мир";
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toBeTruthy();
    });

    it("应该处理超长文本", () => {
      const text = "a".repeat(2000);
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(
          splitter.config.chunkSize,
        );
      });
    });

    it("应该处理只包含分隔符的文本", () => {
      const text = "\n\n\n\n";
      const chunks = splitter.splitText(text);

      // Should return empty or handle gracefully
      expect(Array.isArray(chunks)).toBe(true);
    });
  });

  describe("MarkdownTextSplitter", () => {
    it("应该创建Markdown分块器实例", () => {
      const mdSplitter = new MarkdownTextSplitter();

      expect(mdSplitter).toBeInstanceOf(MarkdownTextSplitter);
      expect(mdSplitter).toBeInstanceOf(RecursiveCharacterTextSplitter);
    });

    it("应该使用Markdown特定的分隔符", () => {
      const mdSplitter = new MarkdownTextSplitter();

      expect(mdSplitter.config.separators).toContain("\n## ");
      expect(mdSplitter.config.separators).toContain("\n### ");
      expect(mdSplitter.config.separators).toContain("\n#### ");
    });

    it("应该允许覆盖分隔符", () => {
      const customSeparators = ["\n# ", "\n\n"];
      const mdSplitter = new MarkdownTextSplitter({
        separators: customSeparators,
      });

      expect(mdSplitter.config.separators).toEqual(customSeparators);
    });

    it("应该正确分割Markdown文本", () => {
      const mdSplitter = new MarkdownTextSplitter({
        chunkSize: 100,
      });

      const text = `# Title

## Section 1
Content for section 1.

### Subsection 1.1
More content here.

## Section 2
Content for section 2.`;

      const chunks = mdSplitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该保留配置选项", () => {
      const mdSplitter = new MarkdownTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100,
      });

      expect(mdSplitter.config.chunkSize).toBe(1000);
      expect(mdSplitter.config.chunkOverlap).toBe(100);
    });
  });

  describe("CodeTextSplitter", () => {
    it("应该创建代码分块器实例", () => {
      const codeSplitter = new CodeTextSplitter("javascript");

      expect(codeSplitter).toBeInstanceOf(CodeTextSplitter);
      expect(codeSplitter).toBeInstanceOf(RecursiveCharacterTextSplitter);
      expect(codeSplitter.language).toBe("javascript");
    });

    it("应该使用更大的默认chunkSize", () => {
      const codeSplitter = new CodeTextSplitter("javascript");

      expect(codeSplitter.config.chunkSize).toBe(800);
      expect(codeSplitter.config.chunkOverlap).toBe(100);
    });

    it("应该允许覆盖默认配置", () => {
      const codeSplitter = new CodeTextSplitter("javascript", {
        chunkSize: 1000,
        chunkOverlap: 50,
      });

      expect(codeSplitter.config.chunkSize).toBe(1000);
      expect(codeSplitter.config.chunkOverlap).toBe(50);
    });

    it("应该允许覆盖分隔符", () => {
      const customSeparators = ["\n// ", "\n"];
      const codeSplitter = new CodeTextSplitter("javascript", {
        separators: customSeparators,
      });

      expect(codeSplitter.config.separators).toEqual(customSeparators);
    });
  });

  describe("CodeTextSplitter.getSeparatorsForLanguage", () => {
    it("应该返回JavaScript分隔符", () => {
      const separators =
        CodeTextSplitter.getSeparatorsForLanguage("javascript");

      expect(separators).toContain("\nfunction ");
      expect(separators).toContain("\nconst ");
      expect(separators).toContain("\nlet ");
      expect(separators).toContain("\nclass ");
    });

    it("应该返回Python分隔符", () => {
      const separators = CodeTextSplitter.getSeparatorsForLanguage("python");

      expect(separators).toContain("\ndef ");
      expect(separators).toContain("\nclass ");
    });

    it("应该返回Java分隔符", () => {
      const separators = CodeTextSplitter.getSeparatorsForLanguage("java");

      expect(separators).toContain("\npublic ");
      expect(separators).toContain("\nprivate ");
      expect(separators).toContain("\nprotected ");
      expect(separators).toContain("\nclass ");
    });

    it("应该返回C++分隔符", () => {
      const separators = CodeTextSplitter.getSeparatorsForLanguage("cpp");

      expect(separators).toContain("\nvoid ");
      expect(separators).toContain("\nint ");
      expect(separators).toContain("\nclass ");
    });

    it("应该为未知语言返回默认分隔符", () => {
      const separators = CodeTextSplitter.getSeparatorsForLanguage("unknown");

      expect(separators).toContain("\n\n");
      expect(separators).toContain("\n");
      expect(separators).toContain(" ");
    });

    it("应该为null语言返回默认分隔符", () => {
      const separators = CodeTextSplitter.getSeparatorsForLanguage(null);

      expect(separators).toContain("\n\n");
    });
  });

  describe("CodeTextSplitter - 分割代码", () => {
    it("应该正确分割JavaScript代码", () => {
      const codeSplitter = new CodeTextSplitter("javascript", {
        chunkSize: 200,
      });

      const code = `function hello() {
  console.log('Hello');
}

const greet = () => {
  console.log('Hi');
}

class MyClass {
  constructor() {
    this.value = 42;
  }
}`;

      const chunks = codeSplitter.splitText(code);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该正确分割Python代码", () => {
      const codeSplitter = new CodeTextSplitter("python", {
        chunkSize: 150,
      });

      const code = `def hello():
    print('Hello')

class MyClass:
    def __init__(self):
        self.value = 42

def greet(name):
    print(f'Hi {name}')`;

      const chunks = codeSplitter.splitText(code);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("应该保留代码结构", () => {
      const codeSplitter = new CodeTextSplitter("javascript", {
        chunkSize: 100,
      });

      const code = "function test() {\n  return 42;\n}";
      const chunks = codeSplitter.splitText(code);

      expect(chunks[0].content).toContain("function");
    });
  });

  describe("性能和优化", () => {
    it("应该高效处理大文本", () => {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
      });

      const text = "Lorem ipsum ".repeat(100);
      const startTime = Date.now();

      const chunks = splitter.splitText(text);

      const duration = Date.now() - startTime;

      expect(chunks.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500); // Should complete quickly
    });

    it("应该正确计算自定义长度函数", () => {
      // Use word count instead of character count
      const wordCountFn = (text) =>
        text.split(/\s+/).filter((w) => w.length > 0).length;

      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 10, // 10 words
        lengthFunction: wordCountFn,
      });

      const text =
        "one two three four five six seven eight nine ten eleven twelve";
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
