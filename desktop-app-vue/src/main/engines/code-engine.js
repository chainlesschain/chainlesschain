/**
 * 代码开发引擎
 * 提供AI驱动的代码生成、测试生成、代码审查和重构功能
 */

class CodeEngine {
  constructor() {
    this.llmManager = null;
    this.initialized = false;

    // 代码生成温度配置
    this.temperatures = {
      code: 0.2,        // 代码生成 - 低温度确保准确性
      test: 0.3,        // 测试生成 - 略高温度增加测试覆盖
      review: 0.4,      // 代码审查 - 中等温度提供多样建议
      creative: 0.7     // 创意代码 - 高温度鼓励创新
    };

    // 支持的编程语言
    this.supportedLanguages = {
      javascript: { ext: 'js', testFramework: 'Jest' },
      typescript: { ext: 'ts', testFramework: 'Jest' },
      python: { ext: 'py', testFramework: 'pytest' },
      java: { ext: 'java', testFramework: 'JUnit' },
      cpp: { ext: 'cpp', testFramework: 'Google Test' },
      go: { ext: 'go', testFramework: 'testing' },
      rust: { ext: 'rs', testFramework: 'cargo test' },
      csharp: { ext: 'cs', testFramework: 'NUnit' }
    };
  }

  /**
   * 初始化代码引擎
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const { getLLMManager } = require('../llm/llm-manager');
      this.llmManager = getLLMManager();

      if (!this.llmManager.isInitialized) {
        await this.llmManager.initialize();
      }

      this.initialized = true;
      console.log('[CodeEngine] 初始化完成');
    } catch (error) {
      console.error('[CodeEngine] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保已初始化
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('CodeEngine 未初始化，请先调用 initialize()');
    }
  }

  /**
   * 生成代码
   * @param {string} description - 功能描述
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 生成结果
   */
  async generateCode(description, options = {}) {
    this.ensureInitialized();

    const {
      language = 'javascript',
      framework = null,
      includeTests = false,
      includeComments = true,
      style = 'modern'
    } = options;

    console.log(`[CodeEngine] 生成代码: ${language}`, description);

    try {
      // 构建提示词
      const prompt = this.buildCodePrompt(description, language, framework, includeComments, style);

      // 调用LLM
      const response = await this.llmManager.query(prompt, {
        temperature: this.temperatures.code,
        maxTokens: 2000
      });

      // 提取代码块
      const code = this.extractCodeBlock(response, language);

      // 生成单元测试
      let tests = null;
      if (includeTests) {
        tests = await this.generateTests(code, language);
      }

      return {
        success: true,
        code: code,
        tests: tests,
        language: language,
        framework: framework,
        rawResponse: response
      };

    } catch (error) {
      console.error('[CodeEngine] 代码生成失败:', error);
      throw error;
    }
  }

  /**
   * 构建代码生成提示词
   */
  buildCodePrompt(description, language, framework, includeComments, style) {
    const langInfo = this.supportedLanguages[language] || {};

    let prompt = `你是一位专业的${language}开发工程师。`;

    if (framework) {
      prompt += `\n使用${framework}框架`;
    }

    prompt += `\n\n请实现以下功能:\n\n${description}\n\n`;

    prompt += '要求:\n';
    prompt += `1. 代码要清晰、简洁、可维护\n`;
    prompt += `2. 遵循${language}的最佳实践和编码规范\n`;
    prompt += `3. 处理可能的错误情况\n`;
    prompt += `4. 使用${style}语法特性\n`;

    if (includeComments) {
      prompt += `5. 添加详细的注释说明\n`;
    }

    prompt += `\n请只输出代码,用\`\`\`${language}代码块包裹。`;

    return prompt;
  }

  /**
   * 提取代码块
   * @param {string} text - 包含代码的文本
   * @param {string} language - 编程语言
   * @returns {string} 提取的代码
   */
  extractCodeBlock(text, language = '') {
    // 尝试匹配指定语言的代码块
    const langRegex = new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\`\`\``, 'g');
    let matches = [...text.matchAll(langRegex)];

    if (matches.length > 0) {
      return matches[0][1].trim();
    }

    // 尝试匹配任意代码块
    const anyCodeRegex = /```(?:\w+)?\s*\n([\s\S]*?)```/g;
    matches = [...text.matchAll(anyCodeRegex)];

    if (matches.length > 0) {
      return matches[0][1].trim();
    }

    // 如果没有代码块标记，返回原文本
    return text.trim();
  }

  /**
   * 生成单元测试
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<string>} 测试代码
   */
  async generateTests(code, language) {
    this.ensureInitialized();

    const langInfo = this.supportedLanguages[language] || { testFramework: 'standard' };
    const framework = langInfo.testFramework;

    console.log(`[CodeEngine] 生成单元测试: ${language} (${framework})`);

    const prompt = `
你是一位专业的测试工程师。

请为以下${language}代码编写完整的单元测试,使用${framework}框架:

\`\`\`${language}
${code}
\`\`\`

测试要求:
1. 覆盖主要功能和分支逻辑
2. 包含边界情况测试
3. 测试错误处理路径
4. 使用清晰的测试名称
5. 添加必要的注释

请只输出测试代码,用\`\`\`${language}代码块包裹。
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: this.temperatures.test,
        maxTokens: 1500
      });

      return this.extractCodeBlock(response, language);

    } catch (error) {
      console.error('[CodeEngine] 测试生成失败:', error);
      throw error;
    }
  }

  /**
   * 代码审查
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 审查结果
   */
  async reviewCode(code, language) {
    this.ensureInitialized();

    console.log(`[CodeEngine] 代码审查: ${language}`);

    const prompt = `
你是一位资深的代码审查专家。

请审查以下${language}代码,提供改进建议:

\`\`\`${language}
${code}
\`\`\`

请从以下方面评估:
1. **代码质量**: 可读性、可维护性、命名规范
2. **性能问题**: 算法复杂度、资源使用
3. **安全隐患**: 潜在的安全漏洞
4. **潜在bug**: 逻辑错误、边界情况
5. **最佳实践**: 是否遵循语言和框架的最佳实践

请按以下格式输出:

## 总体评分
[给出1-10分的评分]

## 优点
1. ...
2. ...

## 需要改进的地方
1. [问题描述]
   - 建议: [具体改进建议]
   - 优先级: 高/中/低

## 改进后的代码
\`\`\`${language}
[改进后的代码]
\`\`\`
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: this.temperatures.review,
        maxTokens: 2000
      });

      // 解析审查结果
      const suggestions = this.parseReviewSuggestions(response);
      const improvedCode = this.extractCodeBlock(response, language);
      const score = this.extractScore(response);

      return {
        success: true,
        originalCode: code,
        review: response,
        score: score,
        suggestions: suggestions,
        improvedCode: improvedCode
      };

    } catch (error) {
      console.error('[CodeEngine] 代码审查失败:', error);
      throw error;
    }
  }

  /**
   * 解析审查建议
   */
  parseReviewSuggestions(review) {
    const suggestions = [];

    // 提取"需要改进的地方"部分
    const sectionMatch = review.match(/##\s*需要改进的地方([\s\S]*?)(?=##|$)/);

    if (sectionMatch) {
      const section = sectionMatch[1];
      const lines = section.split('\n');

      let currentSuggestion = null;

      for (const line of lines) {
        const trimmed = line.trim();

        // 匹配编号列表项
        const numberMatch = trimmed.match(/^\d+\.\s*(.+)/);
        if (numberMatch) {
          if (currentSuggestion) {
            suggestions.push(currentSuggestion);
          }
          currentSuggestion = {
            issue: numberMatch[1],
            advice: '',
            priority: 'medium'
          };
        }
        // 匹配建议
        else if (trimmed.startsWith('- 建议:') || trimmed.startsWith('-建议:')) {
          if (currentSuggestion) {
            currentSuggestion.advice = trimmed.replace(/^-\s*建议:\s*/i, '');
          }
        }
        // 匹配优先级
        else if (trimmed.startsWith('- 优先级:') || trimmed.startsWith('-优先级:')) {
          if (currentSuggestion) {
            const priority = trimmed.replace(/^-\s*优先级:\s*/i, '').toLowerCase();
            if (priority.includes('高')) currentSuggestion.priority = 'high';
            else if (priority.includes('低')) currentSuggestion.priority = 'low';
            else currentSuggestion.priority = 'medium';
          }
        }
      }

      if (currentSuggestion) {
        suggestions.push(currentSuggestion);
      }
    }

    return suggestions;
  }

  /**
   * 提取评分
   */
  extractScore(review) {
    const scoreMatch = review.match(/总体评分[^\d]*(\d+)/i);
    if (scoreMatch) {
      return parseInt(scoreMatch[1], 10);
    }
    return null;
  }

  /**
   * 代码重构
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {string} refactoringType - 重构类型
   * @returns {Promise<Object>} 重构结果
   */
  async refactorCode(code, language, refactoringType) {
    this.ensureInitialized();

    const refactoringDescriptions = {
      'extract_function': '提取重复代码为独立函数',
      'rename_variables': '改进变量和函数命名',
      'simplify': '简化复杂逻辑，提高可读性',
      'optimize': '优化性能和资源使用',
      'modernize': '使用现代语法特性重写代码',
      'add_types': '添加类型注解（TypeScript/Python）'
    };

    const description = refactoringDescriptions[refactoringType] || '改进代码质量';

    console.log(`[CodeEngine] 代码重构: ${refactoringType}`);

    const prompt = `
你是一位代码重构专家。

请对以下${language}代码进行重构: ${description}

原始代码:
\`\`\`${language}
${code}
\`\`\`

重构要求:
1. 保持功能完全一致
2. 提高代码质量和可维护性
3. 添加必要的注释说明
4. 确保代码更易理解

请按以下格式输出:

## 重构说明
[说明为什么要这样重构，有哪些改进]

## 重构后的代码
\`\`\`${language}
[重构后的代码]
\`\`\`

## 主要改进点
1. ...
2. ...
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: this.temperatures.code,
        maxTokens: 2000
      });

      const refactoredCode = this.extractCodeBlock(response, language);

      return {
        success: true,
        originalCode: code,
        refactoredCode: refactoredCode,
        refactoringType: refactoringType,
        explanation: response
      };

    } catch (error) {
      console.error('[CodeEngine] 代码重构失败:', error);
      throw error;
    }
  }

  /**
   * 解释代码
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 解释结果
   */
  async explainCode(code, language) {
    this.ensureInitialized();

    console.log(`[CodeEngine] 解释代码: ${language}`);

    const prompt = `
请详细解释以下${language}代码的功能和实现原理:

\`\`\`${language}
${code}
\`\`\`

请包括:
1. **整体功能**: 这段代码做什么
2. **实现细节**: 关键代码行的作用
3. **算法复杂度**: 时间和空间复杂度（如适用）
4. **使用示例**: 如何调用这段代码

请用通俗易懂的语言解释，适合初学者理解。
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.5,
        maxTokens: 1500
      });

      return {
        success: true,
        code: code,
        explanation: response
      };

    } catch (error) {
      console.error('[CodeEngine] 代码解释失败:', error);
      throw error;
    }
  }

  /**
   * 修复代码bug
   * @param {string} code - 有bug的代码
   * @param {string} language - 编程语言
   * @param {string} errorMessage - 错误信息（可选）
   * @returns {Promise<Object>} 修复结果
   */
  async fixBug(code, language, errorMessage = null) {
    this.ensureInitialized();

    console.log(`[CodeEngine] 修复bug: ${language}`);

    let prompt = `
你是一位专业的调试专家。

请分析并修复以下${language}代码中的bug:

\`\`\`${language}
${code}
\`\`\`
`;

    if (errorMessage) {
      prompt += `\n错误信息:\n\`\`\`\n${errorMessage}\n\`\`\`\n`;
    }

    prompt += `
请按以下格式输出:

## 问题分析
[说明bug的根本原因]

## 修复后的代码
\`\`\`${language}
[修复后的代码]
\`\`\`

## 修复说明
[解释如何修复的]
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: this.temperatures.code,
        maxTokens: 2000
      });

      const fixedCode = this.extractCodeBlock(response, language);

      return {
        success: true,
        originalCode: code,
        fixedCode: fixedCode,
        analysis: response
      };

    } catch (error) {
      console.error('[CodeEngine] bug修复失败:', error);
      throw error;
    }
  }

  /**
   * 生成项目脚手架
   * @param {string} projectType - 项目类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 脚手架文件
   */
  async generateScaffold(projectType, options = {}) {
    this.ensureInitialized();

    const { projectName = 'my-project', features = [] } = options;

    console.log(`[CodeEngine] 生成项目脚手架: ${projectType}`);

    // 预定义模板
    const templates = {
      'express_api': this.getExpressTemplate(projectName),
      'react_app': this.getReactTemplate(projectName),
      'vue_app': this.getVueTemplate(projectName)
    };

    return templates[projectType] || { files: [] };
  }

  /**
   * Express API 模板
   */
  getExpressTemplate(projectName) {
    return {
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: projectName,
            version: '1.0.0',
            description: 'Express API Server',
            main: 'app.js',
            scripts: {
              start: 'node app.js',
              dev: 'nodemon app.js'
            },
            dependencies: {
              express: '^4.18.0',
              cors: '^2.8.5',
              dotenv: '^16.0.0'
            },
            devDependencies: {
              nodemon: '^2.0.20'
            }
          }, null, 2)
        },
        {
          path: 'app.js',
          content: `const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to ${projectName} API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Start server
app.listen(port, () => {
  console.log(\`Server running on port \${port}\`);
});

module.exports = app;
`
        },
        {
          path: '.env',
          content: `PORT=3000
NODE_ENV=development
`
        },
        {
          path: '.gitignore',
          content: `node_modules/
.env
.DS_Store
*.log
`
        }
      ]
    };
  }

  /**
   * React App 模板
   */
  getReactTemplate(projectName) {
    // TODO: 实现React模板
    return { files: [] };
  }

  /**
   * Vue App 模板
   */
  getVueTemplate(projectName) {
    // TODO: 实现Vue模板
    return { files: [] };
  }
}

// 单例模式
let codeEngine = null;

/**
 * 获取代码引擎实例
 * @returns {CodeEngine}
 */
function getCodeEngine() {
  if (!codeEngine) {
    codeEngine = new CodeEngine();
  }
  return codeEngine;
}

module.exports = {
  CodeEngine,
  getCodeEngine
};
