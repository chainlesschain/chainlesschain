/**
 * 代码格式化插件
 * 提供代码格式化、语言检测和语法验证功能
 */

// 语言特征模式
const LANGUAGE_PATTERNS = {
  javascript: {
    keywords: ['function', 'const', 'let', 'var', 'class', 'import', 'export', '=>'],
    patterns: [/function\s+\w+/, /const\s+\w+\s*=/, /=>\s*{/, /import\s+.*from/]
  },
  typescript: {
    keywords: ['interface', 'type', 'enum', 'namespace', 'declare'],
    patterns: [/:\s*\w+/, /interface\s+\w+/, /type\s+\w+\s*=/]
  },
  python: {
    keywords: ['def', 'class', 'import', 'from', 'if', '__name__', '__main__'],
    patterns: [/def\s+\w+\(/, /class\s+\w+:/, /import\s+\w+/, /from\s+\w+\s+import/]
  },
  java: {
    keywords: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements'],
    patterns: [/public\s+class/, /private\s+\w+/, /void\s+\w+\(/]
  },
  cpp: {
    keywords: ['#include', 'namespace', 'using', 'std::', 'cout', 'cin'],
    patterns: [/#include\s*</, /namespace\s+\w+/, /std::\w+/]
  },
  go: {
    keywords: ['package', 'func', 'import', 'type', 'struct', 'interface'],
    patterns: [/package\s+\w+/, /func\s+\w+\(/, /type\s+\w+\s+struct/]
  },
  rust: {
    keywords: ['fn', 'let', 'mut', 'impl', 'trait', 'use'],
    patterns: [/fn\s+\w+\(/, /let\s+mut/, /impl\s+\w+/]
  },
  html: {
    keywords: ['<!DOCTYPE', '<html', '<head', '<body', '<div', '<span'],
    patterns: [/<\w+[^>]*>/, /<\/\w+>/, /<!DOCTYPE/]
  },
  css: {
    keywords: ['{', '}', ':', ';', '@media', '@import'],
    patterns: [/\w+\s*{/, /[\w-]+:\s*[^;]+;/, /@media/]
  },
  json: {
    keywords: ['{', '}', '[', ']', ':', ','],
    patterns: [/"[\w-]+":\s*/, /{\s*"/, /\[\s*{/]
  }
};

/**
 * 检测代码语言
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function detectLanguage(params) {
  const { code } = params;

  console.log(`[CodeFormatterPlugin] 检测代码语言...`);

  try {
    if (!code || code.trim().length === 0) {
      return {
        success: false,
        error: '代码不能为空'
      };
    }

    let bestMatch = { language: 'text', score: 0 };

    // 遍历所有语言模式
    for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      let score = 0;

      // 检查关键字
      for (const keyword of patterns.keywords) {
        if (code.includes(keyword)) {
          score += 1;
        }
      }

      // 检查正则模式
      for (const pattern of patterns.patterns) {
        if (pattern.test(code)) {
          score += 2;
        }
      }

      if (score > bestMatch.score) {
        bestMatch = { language: lang, score };
      }
    }

    const confidence = Math.min((bestMatch.score / 10) * 100, 100);

    return {
      success: true,
      language: bestMatch.language,
      confidence: parseFloat(confidence.toFixed(2))
    };
  } catch (error) {
    console.error('[CodeFormatterPlugin] 语言检测失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 格式化代码
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function formatCode(params) {
  const { code, language, options = {} } = params;

  console.log(`[CodeFormatterPlugin] 格式化代码: ${language}`);

  try {
    if (!code || code.trim().length === 0) {
      return {
        success: false,
        error: '代码不能为空'
      };
    }

    const {
      indentSize = 2,
      useTabs = false,
      semicolons = true,
      singleQuote = true
    } = options;

    const indent = useTabs ? '\t' : ' '.repeat(indentSize);
    let formattedCode = code;
    let changes = 0;

    // 简单的格式化逻辑（实际应使用专业的格式化库）
    switch (language) {
      case 'javascript':
      case 'typescript':
        // 添加分号
        if (semicolons) {
          const lines = formattedCode.split('\n');
          formattedCode = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('{') &&
                !trimmed.endsWith('}') && !trimmed.startsWith('//')) {
              changes++;
              return line + ';';
            }
            return line;
          }).join('\n');
        }

        // 统一引号
        if (singleQuote) {
          const doubleQuoteCount = (formattedCode.match(/"/g) || []).length;
          formattedCode = formattedCode.replace(/"/g, "'");
          changes += doubleQuoteCount / 2;
        }
        break;

      case 'python':
        // Python 使用4空格缩进
        const pythonIndent = ' '.repeat(4);
        formattedCode = formattedCode.split('\n').map(line => {
          const leadingSpaces = line.match(/^\s*/)[0].length;
          if (leadingSpaces > 0 && leadingSpaces % 4 !== 0) {
            changes++;
            const indentLevel = Math.round(leadingSpaces / 4);
            return pythonIndent.repeat(indentLevel) + line.trim();
          }
          return line;
        }).join('\n');
        break;

      case 'json':
        // JSON 格式化
        try {
          const parsed = JSON.parse(formattedCode);
          formattedCode = JSON.stringify(parsed, null, indentSize);
          changes++;
        } catch (e) {
          return {
            success: false,
            error: 'JSON 格式错误: ' + e.message
          };
        }
        break;

      default:
        // 基本的缩进处理
        formattedCode = formattedCode.split('\n').map(line => {
          return line.replace(/^\s+/, match => {
            const spaces = match.length;
            const indentLevel = Math.floor(spaces / (useTabs ? 1 : indentSize));
            return indent.repeat(indentLevel);
          });
        }).join('\n');
    }

    return {
      success: true,
      formattedCode: formattedCode,
      language: language,
      changes: changes
    };
  } catch (error) {
    console.error('[CodeFormatterPlugin] 格式化失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 验证语法
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function validateSyntax(params) {
  const { code, language } = params;

  console.log(`[CodeFormatterPlugin] 验证语法: ${language}`);

  try {
    if (!code || code.trim().length === 0) {
      return {
        success: false,
        error: '代码不能为空'
      };
    }

    const errors = [];

    // 简单的语法检查（实际应使用专业的语法分析器）
    switch (language) {
      case 'javascript':
      case 'typescript':
        // 检查括号匹配
        const brackets = { '(': ')', '[': ']', '{': '}' };
        const stack = [];
        const lines = code.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          for (let col = 0; col < line.length; col++) {
            const char = line[col];
            if (brackets[char]) {
              stack.push({ char, line: lineNum + 1, col: col + 1 });
            } else if (Object.values(brackets).includes(char)) {
              const last = stack.pop();
              if (!last || brackets[last.char] !== char) {
                errors.push({
                  line: lineNum + 1,
                  column: col + 1,
                  message: `括号不匹配: 期望 '${last ? brackets[last.char] : '无'}', 实际 '${char}'`
                });
              }
            }
          }
        }

        if (stack.length > 0) {
          const unclosed = stack[stack.length - 1];
          errors.push({
            line: unclosed.line,
            column: unclosed.col,
            message: `未闭合的括号: '${unclosed.char}'`
          });
        }
        break;

      case 'json':
        try {
          JSON.parse(code);
        } catch (e) {
          errors.push({
            line: 1,
            column: 1,
            message: e.message
          });
        }
        break;

      case 'python':
        // 检查缩进一致性
        const pythonLines = code.split('\n');
        let expectedIndent = 0;
        for (let i = 0; i < pythonLines.length; i++) {
          const line = pythonLines[i];
          if (line.trim().length === 0) continue;

          const indent = line.match(/^\s*/)[0].length;
          if (indent % 4 !== 0) {
            errors.push({
              line: i + 1,
              column: 1,
              message: 'Python 缩进应为4的倍数'
            });
          }
        }
        break;
    }

    return {
      success: true,
      valid: errors.length === 0,
      errors: errors
    };
  } catch (error) {
    console.error('[CodeFormatterPlugin] 语法验证失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 插件激活钩子
 */
async function activate(context) {
  console.log('[CodeFormatterPlugin] 插件已激活');

  // 注册工具处理函数
  context.registerTool('format_code', formatCode);
  context.registerTool('detect_language', detectLanguage);
  context.registerTool('validate_syntax', validateSyntax);

  const config = context.getConfig();
  console.log('[CodeFormatterPlugin] 配置:', config);
}

/**
 * 插件停用钩子
 */
async function deactivate(context) {
  console.log('[CodeFormatterPlugin] 插件已停用');
}

module.exports = {
  activate,
  deactivate
};
