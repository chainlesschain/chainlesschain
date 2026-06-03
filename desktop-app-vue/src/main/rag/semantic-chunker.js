/**
 * SemanticChunker - 语义分块器
 *
 * 将长文档分割成语义上有意义的小块，以改进 RAG 检索效果。
 * 支持 Markdown 结构感知分块和重叠窗口。
 *
 * @module semantic-chunker
 * @version 1.0.0
 * @since 2026-02-02
 */

const { logger } = require("../utils/logger.js");

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 目标块大小 (字符数)
  targetChunkSize: 500,
  // 最大块大小
  maxChunkSize: 1000,
  // 最小块大小
  minChunkSize: 100,
  // 重叠大小 (字符数)
  overlapSize: 50,
  // 是否保留 Markdown 结构
  preserveMarkdown: true,
  // 是否包含元数据
  includeMetadata: true,
  // 分隔符优先级 (从高到低)
  separators: [
    "\n## ",     // H2 标题
    "\n### ",    // H3 标题
    "\n#### ",   // H4 标题
    "\n\n",      // 段落分隔
    "\n",        // 换行
    "。",        // 中文句号
    ".",         // 英文句号
    "；",        // 中文分号
    ";",         // 英文分号
    " ",         // 空格
  ],
};

/**
 * SemanticChunker 类
 */
class SemanticChunker {
  /**
   * 创建语义分块器
   * @param {Object} config - 配置选项
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info("[SemanticChunker] 初始化完成", this.config);
  }

  /**
   * 将文档分割成语义块
   * @param {string} text - 原始文本
   * @param {Object} metadata - 文档元数据
   * @returns {Array<Object>} 分块结果
   */
  chunk(text, metadata = {}) {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks = [];
    const documentId = metadata.id || `doc_${Date.now()}`;

    // 如果启用 Markdown 感知，先按结构分割
    if (this.config.preserveMarkdown && this._isMarkdown(text)) {
      const structuredChunks = this._chunkMarkdown(text, metadata);
      return structuredChunks;
    }

    // 普通文本递归分割
    const rawChunks = this._recursiveSplit(text, this.config.separators);

    // 合并过小的块，分割过大的块
    const normalizedChunks = this._normalizeChunks(rawChunks);

    // 添加重叠
    const overlappedChunks = this._addOverlap(normalizedChunks);

    // 构建最终结果
    for (let i = 0; i < overlappedChunks.length; i++) {
      const chunkText = overlappedChunks[i];
      if (chunkText.trim().length < this.config.minChunkSize) {
        continue;
      }

      chunks.push({
        id: `${documentId}_chunk_${i}`,
        content: chunkText,
        metadata: {
          ...metadata,
          chunkIndex: i,
          totalChunks: overlappedChunks.length,
          charCount: chunkText.length,
          wordCount: this._countWords(chunkText),
        },
      });
    }

    logger.info(
      `[SemanticChunker] 文档已分块: ${chunks.length} 块`,
      { documentId, originalLength: text.length }
    );

    return chunks;
  }

  /**
   * 批量分块多个文档
   * @param {Array<Object>} documents - 文档数组 [{id, content, metadata}]
   * @returns {Array<Object>} 所有文档的分块结果
   */
  chunkDocuments(documents) {
    const allChunks = [];

    for (const doc of documents) {
      const chunks = this.chunk(doc.content, {
        ...doc.metadata,
        id: doc.id,
        sourceDocument: doc.id,
      });
      allChunks.push(...chunks);
    }

    return allChunks;
  }

  /**
   * Markdown 结构感知分块
   * @private
   * @param {string} text - Markdown 文本
   * @param {Object} metadata - 元数据
   * @returns {Array<Object>} 分块结果
   */
  _chunkMarkdown(text, metadata) {
    const chunks = [];
    const documentId = metadata.id || `doc_${Date.now()}`;

    // 按标题分割 (## 和 ###)
    const sections = this._splitByHeadings(text);

    let chunkIndex = 0;
    for (const section of sections) {
      // 如果章节过大，进一步分割
      if (section.content.length > this.config.maxChunkSize) {
        const subChunks = this._recursiveSplit(
          section.content,
          this.config.separators.slice(3) // 跳过标题分隔符
        );

        const normalizedSubChunks = this._normalizeChunks(subChunks);

        for (let i = 0; i < normalizedSubChunks.length; i++) {
          const chunkText = normalizedSubChunks[i];
          if (chunkText.trim().length < this.config.minChunkSize) {
            continue;
          }

          chunks.push({
            id: `${documentId}_chunk_${chunkIndex}`,
            content: chunkText,
            metadata: {
              ...metadata,
              chunkIndex: chunkIndex,
              sectionTitle: section.title,
              sectionLevel: section.level,
              subChunkIndex: i,
              charCount: chunkText.length,
              wordCount: this._countWords(chunkText),
            },
          });
          chunkIndex++;
        }
      } else if (section.content.trim().length >= this.config.minChunkSize) {
        // 章节大小合适，直接作为一个块
        chunks.push({
          id: `${documentId}_chunk_${chunkIndex}`,
          content: section.content,
          metadata: {
            ...metadata,
            chunkIndex: chunkIndex,
            sectionTitle: section.title,
            sectionLevel: section.level,
            charCount: section.content.length,
            wordCount: this._countWords(section.content),
          },
        });
        chunkIndex++;
      }
    }

    // 添加总块数
    chunks.forEach((chunk) => {
      chunk.metadata.totalChunks = chunks.length;
    });

    return chunks;
  }

  /**
   * 按标题分割 Markdown
   * @private
   * @param {string} text - Markdown 文本
   * @returns {Array<Object>} 章节数组
   */
  _splitByHeadings(text) {
    const sections = [];
    const headingRegex = /^(#{1,4})\s+(.+)$/gm;
    const matches = [];
    let match;

    // 收集所有标题位置
    while ((match = headingRegex.exec(text)) !== null) {
      matches.push({
        level: match[1].length,
        title: match[2].trim(),
        index: match.index,
        fullMatch: match[0],
      });
    }

    // 如果没有标题，返回整个文档作为一个章节
    if (matches.length === 0) {
      return [{
        level: 0,
        title: "",
        content: text,
      }];
    }

    // 添加第一个标题之前的内容（如果有）
    if (matches[0].index > 0) {
      const preContent = text.substring(0, matches[0].index).trim();
      if (preContent.length > 0) {
        sections.push({
          level: 0,
          title: "前言",
          content: preContent,
        });
      }
    }

    // 按标题分割
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextIndex = i + 1 < matches.length
        ? matches[i + 1].index
        : text.length;

      const sectionContent = text.substring(current.index, nextIndex).trim();

      sections.push({
        level: current.level,
        title: current.title,
        content: sectionContent,
      });
    }

    return sections;
  }

  /**
   * 递归分割文本
   * @private
   * @param {string} text - 文本
   * @param {Array<string>} separators - 分隔符列表
   * @returns {Array<string>} 分割结果
   */
  _recursiveSplit(text, separators) {
    if (!text || text.length <= this.config.targetChunkSize) {
      return [text];
    }

    if (separators.length === 0) {
      // 没有更多分隔符，强制按字符数分割
      return this._forceSplit(text);
    }

    const separator = separators[0];
    const parts = text.split(separator);

    if (parts.length === 1) {
      // 当前分隔符无效，尝试下一个
      return this._recursiveSplit(text, separators.slice(1));
    }

    const chunks = [];
    let currentChunk = "";

    for (const part of parts) {
      const testChunk = currentChunk
        ? currentChunk + separator + part
        : part;

      if (testChunk.length <= this.config.targetChunkSize) {
        currentChunk = testChunk;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }

        // 如果单个部分过大，递归分割
        if (part.length > this.config.targetChunkSize) {
          const subChunks = this._recursiveSplit(part, separators.slice(1));
          chunks.push(...subChunks);
          currentChunk = "";
        } else {
          currentChunk = part;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * 强制按字符数分割
   * @private
   * @param {string} text - 文本
   * @returns {Array<string>} 分割结果
   */
  _forceSplit(text) {
    const chunks = [];
    const size = this.config.targetChunkSize;

    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }

    return chunks;
  }

  /**
   * 规范化分块大小
   * @private
   * @param {Array<string>} chunks - 原始分块
   * @returns {Array<string>} 规范化后的分块
   */
  _normalizeChunks(chunks) {
    const normalized = [];
    let buffer = "";

    for (const chunk of chunks) {
      const trimmedChunk = chunk.trim();
      if (!trimmedChunk) {
        continue;
      }

      const combined = buffer ? buffer + "\n" + trimmedChunk : trimmedChunk;

      if (combined.length < this.config.minChunkSize) {
        // 块太小，缓存起来与下一个合并
        buffer = combined;
      } else if (combined.length <= this.config.maxChunkSize) {
        // 大小合适
        normalized.push(combined);
        buffer = "";
      } else {
        // 合并后太大
        if (buffer) {
          normalized.push(buffer);
        }
        if (trimmedChunk.length > this.config.maxChunkSize) {
          // 单个块太大，强制分割
          const subChunks = this._forceSplit(trimmedChunk);
          normalized.push(...subChunks);
        } else {
          normalized.push(trimmedChunk);
        }
        buffer = "";
      }
    }

    // 处理剩余缓存
    if (buffer) {
      if (normalized.length > 0 && buffer.length < this.config.minChunkSize) {
        // 与最后一个块合并
        normalized[normalized.length - 1] += "\n" + buffer;
      } else {
        normalized.push(buffer);
      }
    }

    return normalized;
  }

  /**
   * 添加重叠
   * @private
   * @param {Array<string>} chunks - 分块
   * @returns {Array<string>} 带重叠的分块
   */
  _addOverlap(chunks) {
    if (this.config.overlapSize === 0 || chunks.length <= 1) {
      return chunks;
    }

    const overlapped = [];

    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];

      // 添加前一个块的结尾作为上下文
      if (i > 0) {
        const prevChunk = chunks[i - 1];
        const overlap = prevChunk.slice(-this.config.overlapSize);
        chunk = overlap + "..." + chunk;
      }

      overlapped.push(chunk);
    }

    return overlapped;
  }

  /**
   * 检测是否为 Markdown
   * @private
   * @param {string} text - 文本
   * @returns {boolean}
   */
  _isMarkdown(text) {
    // 简单检测：包含 Markdown 标题或列表
    return /^#{1,6}\s+/m.test(text) ||
           /^\s*[-*+]\s+/m.test(text) ||
           /^\s*\d+\.\s+/m.test(text);
  }

  /**
   * 统计词数
   * @private
   * @param {string} text - 文本
   * @returns {number} 词数
   */
  _countWords(text) {
    // 中文按字符数，英文按空格分词
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  /**
   * 更新配置
   * @param {Object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("[SemanticChunker] 配置已更新", this.config);
  }
}

module.exports = {
  SemanticChunker,
  DEFAULT_CONFIG,
};
