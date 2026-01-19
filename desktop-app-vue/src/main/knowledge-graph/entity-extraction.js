/**
 * 增强的实体提取模块
 * 使用 NLP 技术从笔记中提取实体和关系
 */

/**
 * 中文分词和实体识别（简化版）
 * 在生产环境中，建议使用专业的 NLP 库如 nodejieba 或调用 LLM API
 */

/**
 * 常见实体类型
 */
const ENTITY_TYPES = {
  PERSON: 'person',           // 人名
  ORGANIZATION: 'organization', // 组织机构
  LOCATION: 'location',       // 地点
  DATE: 'date',               // 日期
  TIME: 'time',               // 时间
  CONCEPT: 'concept',         // 概念
  TECHNOLOGY: 'technology',   // 技术
  PRODUCT: 'product',         // 产品
  EVENT: 'event',             // 事件
};

/**
 * 关系类型
 */
const RELATION_TYPES = {
  MENTIONS: 'mentions',       // 提及
  RELATED_TO: 'related_to',   // 相关
  PART_OF: 'part_of',         // 部分
  CAUSED_BY: 'caused_by',     // 因果
  LOCATED_IN: 'located_in',   // 位于
  WORKS_FOR: 'works_for',     // 工作于
  CREATED_BY: 'created_by',   // 创建者
  USES: 'uses',               // 使用
};

/**
 * 提取实体（基于规则和模式）
 */
function extractEntities(text) {
  const entities = [];

  // 1. 提取日期
  const datePatterns = [
    /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
    /(\d{4})-(\d{1,2})-(\d{1,2})/g,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/g,
  ];

  datePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      entities.push({
        type: ENTITY_TYPES.DATE,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  });

  // 2. 提取时间
  const timePattern = /(\d{1,2}):(\d{2})(:\d{2})?/g;
  let match;
  while ((match = timePattern.exec(text)) !== null) {
    entities.push({
      type: ENTITY_TYPES.TIME,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 3. 提取 URL（作为引用）
  const urlPattern = /https?:\/\/[^\s]+/g;
  while ((match = urlPattern.exec(text)) !== null) {
    entities.push({
      type: 'url',
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 4. 提取 Markdown 链接中的标题（作为概念）
  const mdLinkPattern = /\[([^\]]+)\]\([^\)]+\)/g;
  while ((match = mdLinkPattern.exec(text)) !== null) {
    entities.push({
      type: ENTITY_TYPES.CONCEPT,
      value: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 5. 提取标签（#标签）
  const hashtagPattern = /#([^\s#]+)/g;
  while ((match = hashtagPattern.exec(text)) !== null) {
    entities.push({
      type: 'tag',
      value: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 6. 提取代码块中的技术名称
  const codeBlockPattern = /```(\w+)\n/g;
  while ((match = codeBlockPattern.exec(text)) !== null) {
    entities.push({
      type: ENTITY_TYPES.TECHNOLOGY,
      value: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 7. 提取常见技术术语
  const techKeywords = [
    'JavaScript', 'Python', 'Java', 'C\\+\\+', 'TypeScript', 'React', 'Vue', 'Angular',
    'Node\\.js', 'Express', 'Django', 'Flask', 'Spring', 'Docker', 'Kubernetes',
    'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch',
    'AWS', 'Azure', 'GCP', 'Git', 'GitHub', 'GitLab',
    'AI', 'ML', 'Deep Learning', 'NLP', 'Computer Vision',
    'Blockchain', 'Ethereum', 'Bitcoin', 'Smart Contract',
  ];

  techKeywords.forEach(keyword => {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'gi');
    while ((match = pattern.exec(text)) !== null) {
      entities.push({
        type: ENTITY_TYPES.TECHNOLOGY,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  });

  // 去重（按位置）
  const uniqueEntities = [];
  const positions = new Set();

  entities.forEach(entity => {
    const key = `${entity.start}-${entity.end}`;
    if (!positions.has(key)) {
      positions.add(key);
      uniqueEntities.push(entity);
    }
  });

  return uniqueEntities.sort((a, b) => a.start - b.start);
}

/**
 * 使用 LLM 提取实体和关系（高级版）
 */
async function extractEntitiesWithLLM(text, llmManager) {
  if (!llmManager) {
    console.warn('[Entity Extraction] LLM Manager 未初始化，使用基础提取');
    return extractEntities(text);
  }

  try {
    const prompt = `请从以下文本中提取关键实体和它们之间的关系。

文本：
${text}

请以 JSON 格式返回结果，包含：
1. entities: 实体列表，每个实体包含 type（类型）、value（值）
2. relations: 关系列表，每个关系包含 source（源实体）、target（目标实体）、type（关系类型）

实体类型包括：person（人名）、organization（组织）、location（地点）、date（日期）、concept（概念）、technology（技术）、product（产品）、event（事件）

关系类型包括：mentions（提及）、related_to（相关）、part_of（部分）、caused_by（因果）、located_in（位于）、works_for（工作于）、created_by（创建者）、uses（使用）

示例输出：
{
  "entities": [
    {"type": "person", "value": "张三"},
    {"type": "technology", "value": "React"},
    {"type": "concept", "value": "前端开发"}
  ],
  "relations": [
    {"source": "张三", "target": "React", "type": "uses"},
    {"source": "React", "target": "前端开发", "type": "part_of"}
  ]
}`;

    const response = await llmManager.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.3,
      max_tokens: 2000,
    });

    // 解析 LLM 响应
    const content = response.content || response.message?.content || '';

    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result;
    }

    // 如果 LLM 返回格式不正确，回退到基础提取
    console.warn('[Entity Extraction] LLM 返回格式不正确，使用基础提取');
    return { entities: extractEntities(text), relations: [] };

  } catch (error) {
    console.error('[Entity Extraction] LLM 提取失败:', error);
    return { entities: extractEntities(text), relations: [] };
  }
}

/**
 * 提取关键词（TF-IDF 简化版）
 */
function extractKeywords(text, topN = 10) {
  // 移除标点符号和特殊字符
  const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ');

  // 简单分词（按空格和中文字符）
  const words = cleanText.split(/\s+/).filter(w => w.length > 1);

  // 统计词频
  const wordFreq = new Map();
  words.forEach(word => {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  });

  // 排序并返回 top N
  const sortedWords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return sortedWords.map(([word, freq]) => ({
    word,
    frequency: freq,
    score: freq / words.length, // 简化的 TF 分数
  }));
}

/**
 * 查找文本中的引用（双向链接）
 */
function extractWikiLinks(text) {
  const links = [];

  // [[标题]] 格式
  const wikiLinkPattern = /\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = wikiLinkPattern.exec(text)) !== null) {
    links.push({
      title: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return links;
}

/**
 * 提取文本摘要（简单版）
 */
function extractSummary(text, maxLength = 200) {
  // 移除 Markdown 格式
  const cleanText = text
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/`[^`]+`/g, '')        // 移除行内代码
    .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // 保留链接文本
    .replace(/#{1,6}\s+/g, '')      // 移除标题标记
    .replace(/[*_~]/g, '')          // 移除强调标记
    .trim();

  // 提取第一段或前 N 个字符
  const firstParagraph = cleanText.split('\n\n')[0];

  if (firstParagraph.length <= maxLength) {
    return firstParagraph;
  }

  return firstParagraph.substring(0, maxLength) + '...';
}

/**
 * 计算文本相似度（余弦相似度）
 */
function calculateTextSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  // Jaccard 相似度
  return intersection.size / union.size;
}

/**
 * 批量处理笔记，提取实体和关系
 */
async function processNotesForEntities(notes, llmManager = null) {
  const results = [];

  for (const note of notes) {
    try {
      const entities = llmManager
        ? await extractEntitiesWithLLM(note.content, llmManager)
        : { entities: extractEntities(note.content), relations: [] };

      const keywords = extractKeywords(note.content);
      const wikiLinks = extractWikiLinks(note.content);
      const summary = extractSummary(note.content);

      results.push({
        noteId: note.id,
        title: note.title,
        entities: entities.entities || [],
        relations: entities.relations || [],
        keywords,
        wikiLinks,
        summary,
      });
    } catch (error) {
      console.error(`[Entity Extraction] 处理笔记 ${note.id} 失败:`, error);
      results.push({
        noteId: note.id,
        title: note.title,
        entities: [],
        relations: [],
        keywords: [],
        wikiLinks: [],
        summary: '',
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * 构建实体关系图
 */
function buildEntityGraph(processedNotes) {
  const entityNodes = new Map();
  const entityEdges = [];

  processedNotes.forEach(note => {
    // 添加笔记节点
    if (!entityNodes.has(note.noteId)) {
      entityNodes.set(note.noteId, {
        id: note.noteId,
        title: note.title,
        type: 'note',
        summary: note.summary,
      });
    }

    // 添加实体节点
    note.entities.forEach(entity => {
      const entityId = `entity_${entity.type}_${entity.value}`;

      if (!entityNodes.has(entityId)) {
        entityNodes.set(entityId, {
          id: entityId,
          title: entity.value,
          type: entity.type,
        });
      }

      // 添加笔记到实体的边
      entityEdges.push({
        source_id: note.noteId,
        target_id: entityId,
        relation_type: 'contains',
        weight: 1.0,
      });
    });

    // 添加实体间关系
    note.relations.forEach(relation => {
      const sourceId = `entity_${relation.source}`;
      const targetId = `entity_${relation.target}`;

      entityEdges.push({
        source_id: sourceId,
        target_id: targetId,
        relation_type: relation.type,
        weight: 1.0,
      });
    });

    // 添加 Wiki 链接关系
    note.wikiLinks.forEach(link => {
      // 假设链接指向另一个笔记
      entityEdges.push({
        source_id: note.noteId,
        target_id: link.title, // 需要解析为实际的笔记 ID
        relation_type: 'references',
        weight: 1.0,
      });
    });
  });

  return {
    nodes: Array.from(entityNodes.values()),
    edges: entityEdges,
  };
}

module.exports = {
  ENTITY_TYPES,
  RELATION_TYPES,
  extractEntities,
  extractEntitiesWithLLM,
  extractKeywords,
  extractWikiLinks,
  extractSummary,
  calculateTextSimilarity,
  processNotesForEntities,
  buildEntityGraph,
};
