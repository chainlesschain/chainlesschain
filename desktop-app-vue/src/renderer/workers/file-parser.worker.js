/**
 * File Parser Web Worker
 * 在后台线程中处理文件解析、内容提取等耗时操作
 */

// 文件解析函数
const parseFile = (content, fileType, options = {}) => {
  try {
    switch (fileType) {
      case 'json':
        return parseJSON(content, options);
      case 'csv':
        return parseCSV(content, options);
      case 'xml':
        return parseXML(content, options);
      case 'markdown':
        return parseMarkdown(content, options);
      case 'code':
        return parseCode(content, options);
      default:
        return { success: true, data: content };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
};

// JSON解析
const parseJSON = (content, options) => {
  try {
    const data = JSON.parse(content);
    return {
      success: true,
      data,
      metadata: {
        type: 'json',
        size: content.length,
        keys: Object.keys(data).length,
      },
    };
  } catch (error) {
    throw new Error(`JSON解析失败: ${error.message}`);
  }
};

// CSV解析
const parseCSV = (content, options) => {
  const delimiter = options.delimiter || ',';
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { success: true, data: [], metadata: { rows: 0, columns: 0 } };
  }

  const headers = lines[0].split(delimiter).map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return {
    success: true,
    data: rows,
    metadata: {
      type: 'csv',
      rows: rows.length,
      columns: headers.length,
      headers,
    },
  };
};

// XML解析（简化版）
const parseXML = (content, options) => {
  // 简单的XML标签提取
  const tagRegex = /<([a-zA-Z0-9_-]+)[^>]*>/g;
  const tags = [];
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    tags.push(match[1]);
  }

  const uniqueTags = [...new Set(tags)];

  return {
    success: true,
    data: content,
    metadata: {
      type: 'xml',
      size: content.length,
      tags: uniqueTags,
      tagCount: tags.length,
    },
  };
};

// Markdown解析
const parseMarkdown = (content, options) => {
  // 提取标题
  const headings = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2],
    });
  }

  // 提取链接
  const links = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
    });
  }

  // 提取代码块
  const codeBlocks = [];
  const codeRegex = /```(\w+)?\n([\s\S]*?)```/g;

  while ((match = codeRegex.exec(content)) !== null) {
    codeBlocks.push({
      language: match[1] || 'text',
      code: match[2],
    });
  }

  return {
    success: true,
    data: content,
    metadata: {
      type: 'markdown',
      size: content.length,
      headings,
      links,
      codeBlocks,
      wordCount: content.split(/\s+/).length,
    },
  };
};

// 代码解析
const parseCode = (content, options) => {
  const language = options.language || 'javascript';

  // 统计代码行数
  const lines = content.split('\n');
  const codeLines = lines.filter(line => line.trim() && !line.trim().startsWith('//')).length;
  const commentLines = lines.filter(line => line.trim().startsWith('//')).length;
  const blankLines = lines.filter(line => !line.trim()).length;

  // 提取函数定义（简化版，仅支持JavaScript）
  const functions = [];
  if (language === 'javascript' || language === 'typescript') {
    const funcRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      functions.push(match[1] || match[2]);
    }
  }

  return {
    success: true,
    data: content,
    metadata: {
      type: 'code',
      language,
      totalLines: lines.length,
      codeLines,
      commentLines,
      blankLines,
      functions,
      size: content.length,
    },
  };
};

// 监听主线程消息
self.addEventListener('message', (event) => {
  const { id, type, payload } = event.data;

  try {
    let result;

    switch (type) {
      case 'parse':
        result = parseFile(payload.content, payload.fileType, payload.options);
        break;

      case 'extract-metadata':
        // 快速提取元数据，不解析完整内容
        result = {
          success: true,
          metadata: {
            size: payload.content.length,
            lines: payload.content.split('\n').length,
            words: payload.content.split(/\s+/).length,
          },
        };
        break;

      case 'search':
        // 在文件内容中搜索
        const searchRegex = new RegExp(payload.pattern, payload.flags || 'gi');
        const matches = [];
        let searchMatch;

        while ((searchMatch = searchRegex.exec(payload.content)) !== null) {
          matches.push({
            index: searchMatch.index,
            text: searchMatch[0],
            line: payload.content.substring(0, searchMatch.index).split('\n').length,
          });
        }

        result = {
          success: true,
          matches,
          count: matches.length,
        };
        break;

      default:
        result = {
          success: false,
          error: `Unknown operation: ${type}`,
        };
    }

    // 发送结果回主线程
    self.postMessage({
      id,
      type,
      result,
    });
  } catch (error) {
    // 发送错误回主线程
    self.postMessage({
      id,
      type,
      result: {
        success: false,
        error: error.message,
        stack: error.stack,
      },
    });
  }
});

// Worker就绪通知
self.postMessage({ type: 'ready' });
