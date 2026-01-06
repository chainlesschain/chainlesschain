/**
 * Syntax Highlighting Web Worker
 * 在后台线程中处理语法高亮，避免阻塞主线程
 */

// 简化的语法高亮规则
const SYNTAX_RULES = {
  javascript: {
    keywords: /\b(const|let|var|function|return|if|else|for|while|class|import|export|async|await|try|catch|throw|new|this|super|extends|static|get|set)\b/g,
    strings: /(["'`])(?:(?=(\\?))\2.)*?\1/g,
    comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
    numbers: /\b\d+\.?\d*\b/g,
    functions: /\b([a-zA-Z_$][\w$]*)\s*\(/g,
  },
  typescript: {
    keywords: /\b(const|let|var|function|return|if|else|for|while|class|import|export|async|await|try|catch|throw|new|this|super|extends|static|get|set|interface|type|enum|namespace|declare|public|private|protected|readonly)\b/g,
    strings: /(["'`])(?:(?=(\\?))\2.)*?\1/g,
    comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
    numbers: /\b\d+\.?\d*\b/g,
    functions: /\b([a-zA-Z_$][\w$]*)\s*\(/g,
    types: /:\s*([A-Z][a-zA-Z0-9_]*)/g,
  },
  python: {
    keywords: /\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|with|lambda|yield|async|await|pass|break|continue|global|nonlocal)\b/g,
    strings: /(["'])(?:(?=(\\?))\2.)*?\1/g,
    comments: /#.*$/gm,
    numbers: /\b\d+\.?\d*\b/g,
    functions: /\bdef\s+([a-zA-Z_]\w*)\s*\(/g,
  },
  html: {
    tags: /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g,
    attributes: /\s([a-zA-Z-]+)=/g,
    strings: /(["'])(?:(?=(\\?))\2.)*?\1/g,
    comments: /<!--[\s\S]*?-->/g,
  },
  css: {
    selectors: /([.#]?[a-zA-Z][a-zA-Z0-9_-]*)\s*\{/g,
    properties: /([a-zA-Z-]+)\s*:/g,
    values: /:\s*([^;]+);/g,
    comments: /\/\*[\s\S]*?\*\//g,
  },
  json: {
    keys: /"([^"]+)":/g,
    strings: /"([^"]*)"/g,
    numbers: /\b\d+\.?\d*\b/g,
    booleans: /\b(true|false|null)\b/g,
  },
  markdown: {
    headings: /^(#{1,6})\s+(.+)$/gm,
    bold: /\*\*([^*]+)\*\*/g,
    italic: /\*([^*]+)\*/g,
    code: /`([^`]+)`/g,
    links: /\[([^\]]+)\]\(([^)]+)\)/g,
    codeBlocks: /```(\w+)?\n([\s\S]*?)```/g,
  },
};

// 应用语法高亮
const applySyntaxHighlighting = (code, language, options = {}) => {
  const rules = SYNTAX_RULES[language] || SYNTAX_RULES.javascript;
  const tokens = [];

  // 记录已处理的位置
  const processed = new Set();

  // 处理每种类型的token
  Object.entries(rules).forEach(([type, regex]) => {
    let match;
    const localRegex = new RegExp(regex.source, regex.flags);

    while ((match = localRegex.exec(code)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // 检查是否已被处理
      let isProcessed = false;
      for (let i = start; i < end; i++) {
        if (processed.has(i)) {
          isProcessed = true;
          break;
        }
      }

      if (!isProcessed) {
        tokens.push({
          type,
          text: match[0],
          start,
          end,
          line: code.substring(0, start).split('\n').length,
        });

        // 标记为已处理
        for (let i = start; i < end; i++) {
          processed.add(i);
        }
      }
    }
  });

  // 按位置排序
  tokens.sort((a, b) => a.start - b.start);

  return {
    success: true,
    tokens,
    language,
    lineCount: code.split('\n').length,
  };
};

// 生成HTML高亮代码
const generateHighlightedHTML = (code, language, options = {}) => {
  const result = applySyntaxHighlighting(code, language, options);

  if (!result.success) {
    return result;
  }

  const lines = code.split('\n');
  const highlightedLines = [];

  lines.forEach((line, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const lineTokens = result.tokens.filter(t => t.line === lineNumber);

    let highlightedLine = line;
    let offset = 0;

    lineTokens.forEach(token => {
      const relativeStart = token.start - code.substring(0, code.indexOf(line)).length + offset;
      const relativeEnd = relativeStart + token.text.length;

      const before = highlightedLine.substring(0, relativeStart);
      const tokenText = highlightedLine.substring(relativeStart, relativeEnd);
      const after = highlightedLine.substring(relativeEnd);

      const wrapped = `<span class="token-${token.type}">${escapeHTML(tokenText)}</span>`;
      highlightedLine = before + wrapped + after;

      offset += wrapped.length - tokenText.length;
    });

    highlightedLines.push({
      number: lineNumber,
      html: highlightedLine,
    });
  });

  return {
    success: true,
    html: highlightedLines,
    language,
    lineCount: lines.length,
  };
};

// HTML转义
const escapeHTML = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
};

// 提取代码结构
const extractCodeStructure = (code, language) => {
  const structure = {
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    variables: [],
  };

  if (language === 'javascript' || language === 'typescript') {
    // 提取import
    const importRegex = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(code)) !== null) {
      structure.imports.push({
        items: match[1] ? match[1].split(',').map(s => s.trim()) : [match[2]],
        from: match[3],
      });
    }

    // 提取export
    const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+(\w+)/g;

    while ((match = exportRegex.exec(code)) !== null) {
      structure.exports.push(match[1]);
    }

    // 提取函数
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;

    while ((match = funcRegex.exec(code)) !== null) {
      structure.functions.push({
        name: match[1],
        params: match[2].split(',').map(p => p.trim()).filter(Boolean),
      });
    }

    // 提取箭头函数
    const arrowRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;

    while ((match = arrowRegex.exec(code)) !== null) {
      structure.functions.push({
        name: match[1],
        params: match[2].split(',').map(p => p.trim()).filter(Boolean),
        arrow: true,
      });
    }

    // 提取类
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g;

    while ((match = classRegex.exec(code)) !== null) {
      structure.classes.push({
        name: match[1],
        extends: match[2] || null,
      });
    }

    // 提取变量
    const varRegex = /(?:const|let|var)\s+(\w+)\s*=/g;

    while ((match = varRegex.exec(code)) !== null) {
      structure.variables.push(match[1]);
    }
  }

  return {
    success: true,
    structure,
    language,
  };
};

// 监听主线程消息
self.addEventListener('message', (event) => {
  const { id, type, payload } = event.data;

  try {
    let result;

    switch (type) {
      case 'highlight':
        result = applySyntaxHighlighting(payload.code, payload.language, payload.options);
        break;

      case 'highlight-html':
        result = generateHighlightedHTML(payload.code, payload.language, payload.options);
        break;

      case 'extract-structure':
        result = extractCodeStructure(payload.code, payload.language);
        break;

      case 'tokenize':
        // 简单分词
        const tokens = payload.code.split(/\s+/).filter(Boolean);
        result = {
          success: true,
          tokens,
          count: tokens.length,
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
