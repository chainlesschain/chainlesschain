/**
 * 知识图谱关系提取器
 * 从笔记内容中提取各种类型的关系
 */

class GraphExtractor {
  constructor(dbManager) {
    this.db = dbManager;
  }

  /**
   * 从笔记内容中提取所有关系
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容（Markdown格式）
   * @param {Array} tags - 笔记标签ID列表
   * @returns {Array} 关系列表
   */
  extractRelations(noteId, content, tags = []) {
    const relations = [];

    // 1. 提取 Wiki 链接 [[笔记标题]]
    const wikiLinks = this.extractWikiLinks(content);
    wikiLinks.forEach(targetTitle => {
      const targetNote = this.db.getKnowledgeItemByTitle(targetTitle);
      if (targetNote && targetNote.id !== noteId) {
        relations.push({
          sourceId: noteId,
          targetId: targetNote.id,
          type: 'link',
          weight: 2.0, // Wiki链接权重较高
          metadata: { link_type: 'wiki', title: targetTitle }
        });
      }
    });

    // 2. 提取 Markdown 链接 [text](url)
    const markdownLinks = this.extractMarkdownLinks(content);
    markdownLinks.forEach(({ text, url }) => {
      // 检查是否是内部链接（引用其他笔记）
      if (url.startsWith('#') || url.startsWith('./') || url.startsWith('../')) {
        const targetNote = this.db.getKnowledgeItemByTitle(text);
        if (targetNote && targetNote.id !== noteId) {
          relations.push({
            sourceId: noteId,
            targetId: targetNote.id,
            type: 'link',
            weight: 1.5,
            metadata: { link_type: 'markdown', url }
          });
        }
      }
    });

    // 3. 提取标签关系（由调用方传入）
    if (tags && tags.length > 0) {
      // 标签关系由 buildTagRelations() 统一生成，这里不处理
    }

    // 4. 提取 @mentions（如果有的话）
    const mentions = this.extractMentions(content);
    mentions.forEach(mentionedTitle => {
      const targetNote = this.db.getKnowledgeItemByTitle(mentionedTitle);
      if (targetNote && targetNote.id !== noteId) {
        relations.push({
          sourceId: noteId,
          targetId: targetNote.id,
          type: 'link',
          weight: 1.8,
          metadata: { link_type: 'mention', title: mentionedTitle }
        });
      }
    });

    return relations;
  }

  /**
   * 提取 Wiki 风格链接 [[笔记标题]]
   * @param {string} content - Markdown内容
   * @returns {Array<string>} 标题列表
   */
  extractWikiLinks(content) {
    const regex = /\[\[([^\]]+)\]\]/g;
    const matches = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const title = match[1].trim();
      if (title) {
        matches.push(title);
      }
    }

    return [...new Set(matches)]; // 去重
  }

  /**
   * 提取 Markdown 链接 [text](url)
   * @param {string} content - Markdown内容
   * @returns {Array<{text: string, url: string}>} 链接列表
   */
  extractMarkdownLinks(content) {
    // 匹配标准Markdown链接，排除图片 ![...]
    const regex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
    const matches = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const text = match[1].trim();
      const url = match[2].trim();
      if (text && url) {
        matches.push({ text, url });
      }
    }

    return matches;
  }

  /**
   * 提取 @mentions
   * @param {string} content - Markdown内容
   * @returns {Array<string>} 提及的标题列表
   */
  extractMentions(content) {
    // 匹配 @[标题] 或 @标题（空格或标点符号结尾）
    const regex1 = /@\[([^\]]+)\]/g;
    const regex2 = /@([\u4e00-\u9fa5a-zA-Z0-9_-]+)(?=\s|[，。！？,.!?]|$)/g;

    const matches = [];
    let match;

    // 提取 @[标题] 格式
    while ((match = regex1.exec(content)) !== null) {
      const title = match[1].trim();
      if (title) {
        matches.push(title);
      }
    }

    // 提取 @标题 格式
    while ((match = regex2.exec(content)) !== null) {
      const title = match[1].trim();
      if (title) {
        matches.push(title);
      }
    }

    return [...new Set(matches)]; // 去重
  }

  /**
   * 提取代码块中的引用
   * @param {string} content - Markdown内容
   * @returns {Array<string>} 代码引用列表
   */
  extractCodeReferences(content) {
    // 提取代码块中的 import/require 语句（可选功能）
    const codeBlockRegex = /```[\s\S]*?```/g;
    const matches = content.match(codeBlockRegex) || [];

    const references = [];
    matches.forEach(block => {
      // 简单提取 import 和 require
      const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
      let match;
      while ((match = importRegex.exec(block)) !== null) {
        references.push(match[1]);
      }
    });

    return [...new Set(references)];
  }

  /**
   * 处理笔记并生成所有关系
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容
   * @param {Array} tags - 标签ID列表
   * @returns {number} 创建的关系数量
   */
  processNote(noteId, content, tags = []) {
    try {
      // 1. 删除该笔记的旧链接关系
      this.db.deleteRelations(noteId, ['link']);

      // 2. 提取新关系
      const relations = this.extractRelations(noteId, content, tags);

      // 3. 批量插入关系
      if (relations.length > 0) {
        return this.db.addRelations(relations);
      }

      return 0;
    } catch (error) {
      console.error(`[GraphExtractor] 处理笔记 ${noteId} 失败:`, error);
      return 0;
    }
  }

  /**
   * 批量处理所有笔记
   * @param {Array<string>} noteIds - 笔记ID列表（可选，默认处理所有）
   * @returns {object} { processed: number, relations: number }
   */
  processAllNotes(noteIds = null) {
    let notes;
    if (noteIds && noteIds.length > 0) {
      notes = noteIds.map(id => this.db.getKnowledgeItem(id)).filter(n => n);
    } else {
      notes = this.db.getAllKnowledgeItems();
    }

    let processed = 0;
    let totalRelations = 0;

    notes.forEach(note => {
      const content = note.content || '';
      const tags = this.db.getKnowledgeTags(note.id).map(t => t.id);
      const count = this.processNote(note.id, content, tags);

      processed++;
      totalRelations += count;
    });

    // 重新构建标签关系和时间关系
    const tagRelations = this.db.buildTagRelations();
    const temporalRelations = this.db.buildTemporalRelations(7); // 7天窗口

    console.log(`[GraphExtractor] 处理完成: ${processed} 个笔记, ${totalRelations} 个链接关系, ${tagRelations} 个标签关系, ${temporalRelations} 个时间关系`);

    return {
      processed,
      linkRelations: totalRelations,
      tagRelations,
      temporalRelations
    };
  }

  /**
   * 查找笔记中所有未链接的潜在引用
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容
   * @returns {Array<{title: string, noteId: string, confidence: number}>} 潜在链接建议
   */
  findPotentialLinks(noteId, content) {
    const suggestions = [];
    const allNotes = this.db.getAllKnowledgeItems();

    // 移除现有链接语法，避免重复建议
    const cleanContent = content
      .replace(/\[\[([^\]]+)\]\]/g, '') // 移除 wiki 链接
      .replace(/\[([^\]]+)\]\([^)]+\)/g, ''); // 移除 markdown 链接

    allNotes.forEach(note => {
      if (note.id === noteId) return;

      const title = note.title;
      // 检查标题是否在内容中出现（至少3个字符）
      if (title.length >= 3 && cleanContent.includes(title)) {
        // 计算置信度（基于标题长度和出现次数）
        const occurrences = (cleanContent.match(new RegExp(this.escapeRegex(title), 'g')) || []).length;
        const confidence = Math.min(0.5 + (title.length / 20) + (occurrences * 0.2), 1.0);

        suggestions.push({
          title,
          noteId: note.id,
          confidence,
          occurrences
        });
      }
    });

    // 按置信度排序
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 转义正则表达式特殊字符
   * @param {string} str - 字符串
   * @returns {string} 转义后的字符串
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 使用LLM提取语义关系（高级功能）
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容
   * @param {object} llmManager - LLM管理器实例
   * @returns {Promise<Array>} 语义关系列表
   */
  async extractSemanticRelations(noteId, content, llmManager) {
    try {
      const allNotes = this.db.getAllKnowledgeItems();
      const noteTitles = allNotes
        .filter(n => n.id !== noteId)
        .map(n => n.title)
        .slice(0, 50); // 限制数量避免prompt过长

      const prompt = `分析以下笔记内容，找出与列表中笔记标题的语义关联：

笔记内容：
${content.slice(0, 1000)}

可能相关的笔记标题：
${noteTitles.join(', ')}

请返回JSON格式的关联列表，每个关联包含：
- title: 相关笔记标题
- reason: 关联原因（简短）
- confidence: 置信度（0-1）

只返回置信度>=0.6的关联。`;

      const response = await llmManager.chat([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3,
        max_tokens: 500
      });

      // 解析LLM响应
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const relations = JSON.parse(jsonMatch[0]);
        return relations
          .filter(rel => rel.confidence >= 0.6)
          .map(rel => {
            const targetNote = this.db.getKnowledgeItemByTitle(rel.title);
            if (targetNote) {
              return {
                sourceId: noteId,
                targetId: targetNote.id,
                type: 'semantic',
                weight: rel.confidence,
                metadata: { reason: rel.reason }
              };
            }
            return null;
          })
          .filter(rel => rel !== null);
      }

      return [];
    } catch (error) {
      console.error('[GraphExtractor] 语义关系提取失败:', error);
      return [];
    }
  }
}

module.exports = GraphExtractor;
