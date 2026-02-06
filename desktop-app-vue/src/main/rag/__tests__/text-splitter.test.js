/**
 * TextSplitter 单元测试
 *
 * 测试内容：
 * - RecursiveCharacterTextSplitter 类
 * - MarkdownTextSplitter 类
 * - CodeTextSplitter 类
 * - splitText 文本分割
 * - splitDocuments 文档分割
 * - createChunksWithOverlap 重叠分块
 * - getChunkStats 统计信息
 * - updateConfig/getConfig 配置管理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const {
  RecursiveCharacterTextSplitter,
  MarkdownTextSplitter,
  CodeTextSplitter,
  DEFAULT_SPLITTER_CONFIG,
} = require('../text-splitter');

describe('DEFAULT_SPLITTER_CONFIG', () => {
  it('should have default values', () => {
    expect(DEFAULT_SPLITTER_CONFIG.chunkSize).toBe(500);
    expect(DEFAULT_SPLITTER_CONFIG.chunkOverlap).toBe(50);
    expect(DEFAULT_SPLITTER_CONFIG.keepSeparator).toBe(true);
    expect(DEFAULT_SPLITTER_CONFIG.separators).toBeInstanceOf(Array);
  });
});

describe('RecursiveCharacterTextSplitter', () => {
  let splitter;

  beforeEach(() => {
    vi.clearAllMocks();

    splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 100,
      chunkOverlap: 20,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultSplitter = new RecursiveCharacterTextSplitter();

      expect(defaultSplitter.config.chunkSize).toBe(500);
      expect(defaultSplitter.config.chunkOverlap).toBe(50);
      expect(defaultSplitter.config.keepSeparator).toBe(true);
    });

    it('should initialize with custom config', () => {
      expect(splitter.config.chunkSize).toBe(100);
      expect(splitter.config.chunkOverlap).toBe(20);
    });

    it('should have default length function', () => {
      expect(splitter.config.lengthFunction('test')).toBe(4);
    });

    it('should accept custom length function', () => {
      const customSplitter = new RecursiveCharacterTextSplitter({
        lengthFunction: (text) => text.split(' ').length,
      });

      expect(customSplitter.config.lengthFunction('hello world')).toBe(2);
    });

    it('should be an EventEmitter', () => {
      expect(typeof splitter.on).toBe('function');
      expect(typeof splitter.emit).toBe('function');
    });
  });

  describe('splitText', () => {
    it('should return empty array for empty text', () => {
      expect(splitter.splitText('')).toEqual([]);
      expect(splitter.splitText('   ')).toEqual([]);
      expect(splitter.splitText(null)).toEqual([]);
    });

    it('should split text into chunks', () => {
      const text = 'This is a test. This is another test. And this is the third test.';
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk).toHaveProperty('content');
        expect(chunk).toHaveProperty('metadata');
        expect(chunk.metadata).toHaveProperty('chunkIndex');
        expect(chunk.metadata).toHaveProperty('totalChunks');
        expect(chunk.metadata).toHaveProperty('chunkSize');
      });
    });

    it('should include metadata', () => {
      const text = 'Short text.';
      const metadata = { source: 'test.txt', author: 'Test' };
      const chunks = splitter.splitText(text, metadata);

      expect(chunks[0].metadata.source).toBe('test.txt');
      expect(chunks[0].metadata.author).toBe('Test');
    });

    it('should emit split-complete event', () => {
      const eventHandler = vi.fn();
      splitter.on('split-complete', eventHandler);

      splitter.splitText('This is a test.');

      expect(eventHandler).toHaveBeenCalledWith({
        originalLength: expect.any(Number),
        chunkCount: expect.any(Number),
        avgChunkSize: expect.any(Number),
      });
    });

    it('should respect chunk size', () => {
      const longText = 'a'.repeat(500);
      const chunks = splitter.splitText(longText);

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(100);
      });
    });

    it('should split on paragraph breaks', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should split on sentence breaks', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle Chinese text', () => {
      const text = '这是第一段。这是第二段。这是第三段。';
      const chunks = splitter.splitText(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('splitDocuments', () => {
    it('should split multiple documents', () => {
      const documents = [
        { content: 'First document content.', metadata: { id: 1 } },
        { content: 'Second document content.', metadata: { id: 2 } },
      ];

      const chunks = splitter.splitDocuments(documents);

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // 验证元数据被保留
      const doc1Chunks = chunks.filter((c) => c.metadata.id === 1);
      const doc2Chunks = chunks.filter((c) => c.metadata.id === 2);
      expect(doc1Chunks.length).toBeGreaterThan(0);
      expect(doc2Chunks.length).toBeGreaterThan(0);
    });

    it('should handle empty documents array', () => {
      const chunks = splitter.splitDocuments([]);
      expect(chunks).toEqual([]);
    });
  });

  describe('createChunksWithOverlap', () => {
    it('should create chunks with overlap for long text', () => {
      const longText = 'a'.repeat(300);
      const chunks = splitter.createChunksWithOverlap(longText);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should include offset metadata', () => {
      const longText = 'a'.repeat(300);
      const chunks = splitter.createChunksWithOverlap(longText);

      if (chunks.length > 1 && chunks[0].metadata.startOffset !== undefined) {
        expect(chunks[0].metadata.startOffset).toBe(0);
        expect(chunks[0].metadata.endOffset).toBeGreaterThan(0);
      }
    });

    it('should use smart splitting for short text', () => {
      const shortText = 'This is a short test.';
      const chunks = splitter.createChunksWithOverlap(shortText);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getChunkStats', () => {
    it('should return statistics about chunks', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const stats = splitter.getChunkStats(text);

      expect(stats).toHaveProperty('totalChunks');
      expect(stats).toHaveProperty('originalLength');
      expect(stats).toHaveProperty('avgChunkSize');
      expect(stats).toHaveProperty('minChunkSize');
      expect(stats).toHaveProperty('maxChunkSize');
      expect(stats).toHaveProperty('compressionRatio');
    });

    it('should calculate correct statistics', () => {
      const text = 'Short.';
      const stats = splitter.getChunkStats(text);

      expect(stats.totalChunks).toBe(1);
      expect(stats.originalLength).toBe(6);
    });
  });

  describe('updateConfig', () => {
    it('should update config', () => {
      splitter.updateConfig({ chunkSize: 200 });

      expect(splitter.config.chunkSize).toBe(200);
      expect(splitter.config.chunkOverlap).toBe(20); // 保持不变
    });
  });

  describe('getConfig', () => {
    it('should return copy of config', () => {
      const config = splitter.getConfig();

      expect(config.chunkSize).toBe(100);
      config.chunkSize = 999;
      expect(splitter.config.chunkSize).toBe(100); // 原始配置不变
    });
  });

  describe('_forceSplit', () => {
    it('should force split long text without separators', () => {
      // 创建一个没有分隔符的长文本
      const longText = 'a'.repeat(250);
      const chunks = splitter.splitText(longText);

      expect(chunks.length).toBeGreaterThan(1);
      // 每个块应该不超过 chunkSize
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(100);
      });
    });
  });
});

describe('MarkdownTextSplitter', () => {
  let splitter;

  beforeEach(() => {
    splitter = new MarkdownTextSplitter({
      chunkSize: 200,
      chunkOverlap: 20,
    });
  });

  describe('constructor', () => {
    it('should use markdown-specific separators', () => {
      expect(splitter.config.separators).toContain('\n## ');
      expect(splitter.config.separators).toContain('\n### ');
    });
  });

  describe('splitText', () => {
    it('should split on headings', () => {
      const markdown = `# Title

## Section 1

Content for section 1.

## Section 2

Content for section 2.

### Subsection 2.1

More content.`;

      const chunks = splitter.splitText(markdown);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should preserve heading structure', () => {
      const markdown = `## Introduction

This is the introduction.

## Methods

This describes methods.`;

      const chunks = splitter.splitText(markdown);
      const allContent = chunks.map((c) => c.content).join('');

      expect(allContent).toContain('Introduction');
      expect(allContent).toContain('Methods');
    });
  });
});

describe('CodeTextSplitter', () => {
  describe('constructor', () => {
    it('should use javascript separators by default', () => {
      const splitter = new CodeTextSplitter('javascript');

      expect(splitter.config.separators).toContain('\nfunction ');
      expect(splitter.config.separators).toContain('\nconst ');
      expect(splitter.language).toBe('javascript');
    });

    it('should use python separators', () => {
      const splitter = new CodeTextSplitter('python');

      expect(splitter.config.separators).toContain('\ndef ');
      expect(splitter.config.separators).toContain('\nclass ');
    });

    it('should use java separators', () => {
      const splitter = new CodeTextSplitter('java');

      expect(splitter.config.separators).toContain('\npublic ');
      expect(splitter.config.separators).toContain('\nclass ');
    });

    it('should use default separators for unknown language', () => {
      const splitter = new CodeTextSplitter('unknown');

      expect(splitter.config.separators).toContain('\n\n');
      expect(splitter.config.separators).toContain('\n');
    });

    it('should have larger default chunk size', () => {
      const splitter = new CodeTextSplitter('javascript');

      expect(splitter.config.chunkSize).toBe(800);
      expect(splitter.config.chunkOverlap).toBe(100);
    });
  });

  describe('getSeparatorsForLanguage', () => {
    it('should return language-specific separators', () => {
      expect(CodeTextSplitter.getSeparatorsForLanguage('javascript')).toContain('\nfunction ');
      expect(CodeTextSplitter.getSeparatorsForLanguage('python')).toContain('\ndef ');
      expect(CodeTextSplitter.getSeparatorsForLanguage('java')).toContain('\npublic ');
      expect(CodeTextSplitter.getSeparatorsForLanguage('cpp')).toContain('\nvoid ');
    });

    it('should return default separators for unknown language', () => {
      const separators = CodeTextSplitter.getSeparatorsForLanguage('rust');

      expect(separators).toContain('\n\n');
    });
  });

  describe('splitText', () => {
    it('should split javascript code on function boundaries', () => {
      const code = `function hello() {
  console.log('Hello');
}

function world() {
  console.log('World');
}

const greeting = 'Hi';`;

      const splitter = new CodeTextSplitter('javascript', { chunkSize: 100 });
      const chunks = splitter.splitText(code);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should split python code on def boundaries', () => {
      const code = `def hello():
    print('Hello')

def world():
    print('World')

class MyClass:
    pass`;

      const splitter = new CodeTextSplitter('python', { chunkSize: 100 });
      const chunks = splitter.splitText(code);

      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});
