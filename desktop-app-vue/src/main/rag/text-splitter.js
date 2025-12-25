/**
 * RecursiveCharacterTextSplitter
 * 递归字符文本分块器，用于将长文档切分为小块以提升RAG检索精度
 */

const EventEmitter = require('events');

/**
 * 文本分块器配置
 */
const DEFAULT_SPLITTER_CONFIG = {
  chunkSize: 500,           // 块大小（字符数）
  chunkOverlap: 50,         // 块重叠（字符数）
  separators: ['\n\n', '\n', '. ', '。', '! ', '！', '? ', '？', '; ', '；', ', ', '，', ' '], // 分隔符优先级
  keepSeparator: true,      // 是否保留分隔符
  lengthFunction: null,     // 自定义长度计算函数
};

/**
 * 递归字符文本分块器
 */
class RecursiveCharacterTextSplitter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_SPLITTER_CONFIG, ...config };

    // 默认使用字符长度
    if (!this.config.lengthFunction) {
      this.config.lengthFunction = (text) => text.length;
    }
  }

  /**
   * 分割文本为块
   * @param {string} text - 输入文本
   * @param {Object} metadata - 元数据（可选）
   * @returns {Array<Object>} 文本块数组
   */
  splitText(text, metadata = {}) {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks = this._recursiveSplit(text, this.config.separators);

    // 构建带元数据的块
    const chunksWithMetadata = chunks.map((chunk, index) => ({
      content: chunk,
      metadata: {
        ...metadata,
        chunkIndex: index,
        totalChunks: chunks.length,
        chunkSize: chunk.length,
      },
    }));

    this.emit('split-complete', {
      originalLength: text.length,
      chunkCount: chunks.length,
      avgChunkSize: Math.round(text.length / chunks.length),
    });

    return chunksWithMetadata;
  }

  /**
   * 递归分割文本
   * @private
   */
  _recursiveSplit(text, separators) {
    const finalChunks = [];

    // 当前要使用的分隔符
    let separator = separators.length > 0 ? separators[0] : '';
    let newSeparators = [];

    if (separator) {
      // 如果还有更细粒度的分隔符，准备递归
      if (separators.length > 1) {
        newSeparators = separators.slice(1);
      }
    } else {
      separator = '';
    }

    // 按当前分隔符分割
    const splits = this._splitTextWithSeparator(text, separator);

    // 合并小块
    const mergedSplits = this._mergeSplits(splits, separator);

    // 处理每个分割片段
    for (const split of mergedSplits) {
      const length = this.config.lengthFunction(split);

      if (length <= this.config.chunkSize) {
        // 如果片段足够小，直接添加
        finalChunks.push(split);
      } else {
        // 如果片段太大，继续递归分割
        if (newSeparators.length > 0) {
          const recursiveChunks = this._recursiveSplit(split, newSeparators);
          finalChunks.push(...recursiveChunks);
        } else {
          // 没有更多分隔符了，强制按字符切分
          const forcedChunks = this._forceSplit(split);
          finalChunks.push(...forcedChunks);
        }
      }
    }

    return finalChunks;
  }

  /**
   * 使用分隔符分割文本
   * @private
   */
  _splitTextWithSeparator(text, separator) {
    if (!separator) {
      return [text];
    }

    const splits = [];
    const parts = text.split(separator);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (this.config.keepSeparator && i < parts.length - 1) {
        // 保留分隔符（添加到当前部分末尾）
        splits.push(part + separator);
      } else {
        splits.push(part);
      }
    }

    return splits.filter(s => s.length > 0);
  }

  /**
   * 合并小片段，避免产生太多碎片
   * @private
   */
  _mergeSplits(splits, separator) {
    const merged = [];
    let currentChunk = '';

    for (const split of splits) {
      const testChunk = currentChunk
        ? currentChunk + (separator || '') + split
        : split;

      const testLength = this.config.lengthFunction(testChunk);

      if (testLength <= this.config.chunkSize) {
        currentChunk = testChunk;
      } else {
        if (currentChunk) {
          merged.push(currentChunk);
        }
        currentChunk = split;
      }
    }

    if (currentChunk) {
      merged.push(currentChunk);
    }

    return merged;
  }

  /**
   * 强制分割（当没有更多分隔符时）
   * @private
   */
  _forceSplit(text) {
    const chunks = [];
    const chunkSize = this.config.chunkSize;
    const overlap = this.config.chunkOverlap;

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.substring(start, end));

      if (end === text.length) {
        break;
      }

      start = end - overlap;
    }

    return chunks;
  }

  /**
   * 分割文档列表
   * @param {Array<Object>} documents - 文档列表 [{content, metadata}, ...]
   * @returns {Array<Object>} 分块后的文档列表
   */
  splitDocuments(documents) {
    const allChunks = [];

    for (const doc of documents) {
      const chunks = this.splitText(doc.content, doc.metadata);
      allChunks.push(...chunks);
    }

    return allChunks;
  }

  /**
   * 创建带重叠的文本块
   * @param {string} text - 输入文本
   * @param {Object} metadata - 元数据
   * @returns {Array<Object>} 文本块数组
   */
  createChunksWithOverlap(text, metadata = {}) {
    const chunks = [];
    const chunkSize = this.config.chunkSize;
    const overlap = this.config.chunkOverlap;

    // 首先尝试智能分割
    const smartChunks = this.splitText(text, metadata);

    // 如果智能分割产生的块太少，使用重叠滑窗
    if (smartChunks.length < 3 && text.length > chunkSize * 2) {
      let start = 0;
      let index = 0;

      while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        const chunk = text.substring(start, end);

        chunks.push({
          content: chunk,
          metadata: {
            ...metadata,
            chunkIndex: index,
            chunkSize: chunk.length,
            startOffset: start,
            endOffset: end,
          },
        });

        if (end === text.length) {
          break;
        }

        start = end - overlap;
        index++;
      }

      return chunks;
    }

    return smartChunks;
  }

  /**
   * 获取分块统计信息
   * @param {string} text - 输入文本
   * @returns {Object} 统计信息
   */
  getChunkStats(text) {
    const chunks = this.splitText(text);

    const sizes = chunks.map(c => c.content.length);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length || 0;
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);

    return {
      totalChunks: chunks.length,
      originalLength: text.length,
      avgChunkSize: Math.round(avgSize),
      minChunkSize: minSize,
      maxChunkSize: maxSize,
      compressionRatio: (text.length / chunks.length).toFixed(2),
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[TextSplitter] 配置已更新:', this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }
}

/**
 * Markdown专用分块器
 */
class MarkdownTextSplitter extends RecursiveCharacterTextSplitter {
  constructor(config = {}) {
    // Markdown特定的分隔符优先级
    const markdownSeparators = [
      '\n## ',    // H2标题
      '\n### ',   // H3标题
      '\n#### ',  // H4标题
      '\n\n',     // 段落
      '\n',       // 行
      '. ',       // 句子
      ' ',        // 词
    ];

    super({
      ...config,
      separators: config.separators || markdownSeparators,
    });
  }
}

/**
 * 代码专用分块器
 */
class CodeTextSplitter extends RecursiveCharacterTextSplitter {
  constructor(language = 'javascript', config = {}) {
    const codeSeparators = CodeTextSplitter.getSeparatorsForLanguage(language);

    super({
      ...config,
      separators: config.separators || codeSeparators,
      chunkSize: config.chunkSize || 800, // 代码块通常需要更大
      chunkOverlap: config.chunkOverlap || 100,
    });

    this.language = language;
  }

  /**
   * 获取语言特定的分隔符
   */
  static getSeparatorsForLanguage(language) {
    const separatorMap = {
      javascript: ['\nfunction ', '\nconst ', '\nlet ', '\nvar ', '\nclass ', '\n\n', '\n', ' '],
      python: ['\ndef ', '\nclass ', '\n\n', '\n', ' '],
      java: ['\npublic ', '\nprivate ', '\nprotected ', '\nclass ', '\n\n', '\n', ' '],
      cpp: ['\nvoid ', '\nint ', '\nclass ', '\n\n', '\n', ' '],
      default: ['\n\n', '\n', ' '],
    };

    return separatorMap[language] || separatorMap.default;
  }
}

module.exports = {
  RecursiveCharacterTextSplitter,
  MarkdownTextSplitter,
  CodeTextSplitter,
  DEFAULT_SPLITTER_CONFIG,
};
