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
    if (this.initialized) {return;}

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
      style = 'modern',
      streaming = false,
      onProgress = null
    } = options;

    console.log(`[CodeEngine] 生成代码: ${language}`, description);

    try {
      // 构建提示词
      const prompt = this.buildCodePrompt(description, language, framework, includeComments, style);

      // 调用LLM（支持流式输出）
      let response;
      if (streaming && onProgress) {
        response = await this.streamQuery(prompt, {
          temperature: this.temperatures.code,
          maxTokens: 2000,
          onProgress
        });
      } else {
        response = await this.llmManager.query(prompt, {
          temperature: this.temperatures.code,
          maxTokens: 2000
        });
      }

      // 提取代码块
      const code = this.extractCodeBlock(response, language);

      // 生成单元测试
      let tests = null;
      if (includeTests) {
        if (onProgress) {onProgress({ stage: 'generating_tests', progress: 50 });}
        tests = await this.generateTests(code, language, { onProgress });
      }

      if (onProgress) {onProgress({ stage: 'complete', progress: 100 });}

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
   * 流式查询LLM
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   * @returns {Promise<string>} 响应内容
   */
  async streamQuery(prompt, options = {}) {
    const { temperature, maxTokens, onProgress } = options;

    let fullResponse = '';
    let tokenCount = 0;

    // 使用流式API
    if (this.llmManager.queryStream) {
      await this.llmManager.queryStream(prompt, {
        temperature,
        maxTokens,
        onChunk: (chunk) => {
          fullResponse += chunk;
          tokenCount += chunk.length / 4; // 粗略估计token数

          if (onProgress) {
            onProgress({
              stage: 'generating',
              progress: Math.min(95, (tokenCount / maxTokens) * 100),
              content: fullResponse
            });
          }
        }
      });

      return fullResponse;
    } else {
      // 降级到普通查询
      const response = await this.llmManager.query(prompt, { temperature, maxTokens });
      if (onProgress) {
        onProgress({ stage: 'generating', progress: 95, content: response });
      }
      return response;
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
   * @param {Object} options - 选项
   * @returns {Promise<string>} 测试代码
   */
  async generateTests(code, language, options = {}) {
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
   * 代码审查（增强版，整合复杂度和安全分析）
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 审查结果
   */
  async reviewCode(code, language, options = {}) {
    this.ensureInitialized();

    const {
      includeComplexity = true,
      includeSecurity = true,
      detailed = true
    } = options;

    console.log(`[CodeEngine] 代码审查: ${language} (增强版)`);

    try {
      // 并行执行基础审查、复杂度分析和安全扫描
      const tasks = [];

      // 基础代码审查
      const basicReviewPromise = this.performBasicReview(code, language);
      tasks.push(basicReviewPromise);

      // 复杂度分析
      let complexityPromise = null;
      if (includeComplexity) {
        complexityPromise = this.analyzeComplexity(code, language);
        tasks.push(complexityPromise);
      }

      // 安全扫描
      let securityPromise = null;
      if (includeSecurity) {
        securityPromise = this.scanSecurity(code, language);
        tasks.push(securityPromise);
      }

      // 等待所有任务完成
      const results = await Promise.all(tasks);
      const basicReview = results[0];
      const complexity = includeComplexity ? results[1] : null;
      const security = includeSecurity ? results[includeComplexity ? 2 : 1] : null;

      // 综合评分（基础 40% + 复杂度 30% + 安全 30%）
      let finalScore = basicReview.score || 5;
      if (complexity && complexity.metrics.score) {
        finalScore = finalScore * 0.4 + complexity.metrics.score * 0.3;
      } else {
        finalScore = finalScore * 0.7;
      }
      if (security && security.score) {
        finalScore += security.score * 0.3;
      } else if (!includeComplexity) {
        finalScore = finalScore * 0.7 + finalScore * 0.3;
      }
      finalScore = Math.round(finalScore * 10) / 10;

      // 整合建议
      const allSuggestions = [
        ...(basicReview.suggestions || []),
        ...(complexity ? this.complexityToSuggestions(complexity) : []),
        ...(security ? this.securityToSuggestions(security) : [])
      ];

      return {
        success: true,
        originalCode: code,
        language: language,
        finalScore: finalScore,
        basicReview: basicReview,
        complexity: complexity,
        security: security,
        suggestions: allSuggestions,
        improvedCode: security?.fixedCode || basicReview.improvedCode
      };

    } catch (error) {
      console.error('[CodeEngine] 代码审查失败:', error);
      throw error;
    }
  }

  /**
   * 执行基础代码审查
   * @private
   */
  async performBasicReview(code, language) {
    const prompt = `
你是一位资深的代码审查专家。

请审查以下${language}代码,提供改进建议:

\`\`\`${language}
${code}
\`\`\`

请从以下方面评估:
1. **代码质量**: 可读性、可维护性、命名规范
2. **性能问题**: 算法复杂度、资源使用
3. **潜在bug**: 逻辑错误、边界情况
4. **最佳实践**: 是否遵循语言和框架的最佳实践

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

    const response = await this.llmManager.query(prompt, {
      temperature: this.temperatures.review,
      maxTokens: 2000
    });

    const suggestions = this.parseReviewSuggestions(response);
    const improvedCode = this.extractCodeBlock(response, language);
    const score = this.extractScore(response);

    return {
      review: response,
      score: score,
      suggestions: suggestions,
      improvedCode: improvedCode
    };
  }

  /**
   * 将复杂度分析转换为建议
   * @private
   */
  complexityToSuggestions(complexity) {
    const suggestions = [];

    if (complexity.metrics.cyclomaticComplexity > 7) {
      suggestions.push({
        issue: '圈复杂度较高',
        advice: '建议将复杂函数拆分为更小的函数，提高可维护性',
        priority: 'high'
      });
    }

    if (complexity.metrics.cognitiveComplexity > 7) {
      suggestions.push({
        issue: '认知复杂度较高',
        advice: '建议简化逻辑结构，减少嵌套层数',
        priority: 'high'
      });
    }

    return suggestions;
  }

  /**
   * 将安全扫描结果转换为建议
   * @private
   */
  securityToSuggestions(security) {
    return security.vulnerabilities.map(vuln => ({
      issue: `安全漏洞: ${vuln.type}`,
      advice: vuln.recommendation,
      priority: vuln.severity === '高' ? 'high' : vuln.severity === '中' ? 'medium' : 'low'
    }));
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
            if (priority.includes('高')) {currentSuggestion.priority = 'high';}
            else if (priority.includes('低')) {currentSuggestion.priority = 'low';}
            else {currentSuggestion.priority = 'medium';}
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
      'vue_app': this.getVueTemplate(projectName),
      'nextjs_app': this.getNextJsTemplate(projectName),
      'fastapi_app': this.getFastAPITemplate(projectName)
    };

    const template = templates[projectType];

    if (!template) {
      throw new Error(`不支持的项目类型: ${projectType}。支持的类型: ${Object.keys(templates).join(', ')}`);
    }

    return template;
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
    return {
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: projectName,
            version: '0.1.0',
            private: true,
            dependencies: {
              'react': '^18.2.0',
              'react-dom': '^18.2.0',
              'react-router-dom': '^6.11.0'
            },
            devDependencies: {
              '@vitejs/plugin-react': '^4.0.0',
              'vite': '^4.3.9',
              'eslint': '^8.42.0'
            },
            scripts: {
              'dev': 'vite',
              'build': 'vite build',
              'preview': 'vite preview',
              'lint': 'eslint src --ext js,jsx'
            }
          }, null, 2)
        },
        {
          path: 'vite.config.js',
          content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  }
})
`
        },
        {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`
        },
        {
          path: 'src/main.jsx',
          content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`
        },
        {
          path: 'src/App.jsx',
          content: `import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="App">
      <h1>${projectName}</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
      </div>
    </div>
  )
}

export default App
`
        },
        {
          path: 'src/index.css',
          content: `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`
        },
        {
          path: 'src/App.css',
          content: `.App {
  text-align: center;
  padding: 2rem;
}

.card {
  padding: 2em;
}

button {
  font-size: 1em;
  padding: 0.6em 1.2em;
  cursor: pointer;
}
`
        },
        {
          path: '.gitignore',
          content: `node_modules
dist
.DS_Store
*.log
`
        }
      ]
    };
  }

  /**
   * Vue App 模板
   */
  getVueTemplate(projectName) {
    return {
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: projectName,
            version: '0.1.0',
            private: true,
            scripts: {
              'dev': 'vite',
              'build': 'vite build',
              'preview': 'vite preview'
            },
            dependencies: {
              'vue': '^3.3.4',
              'vue-router': '^4.2.2'
            },
            devDependencies: {
              '@vitejs/plugin-vue': '^4.2.3',
              'vite': '^4.3.9'
            }
          }, null, 2)
        },
        {
          path: 'vite.config.js',
          content: `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000
  }
})
`
        },
        {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <link rel="icon" href="/favicon.ico">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`
        },
        {
          path: 'src/main.js',
          content: `import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')
`
        },
        {
          path: 'src/App.vue',
          content: `<template>
  <div id="app">
    <h1>{{ title }}</h1>
    <div class="card">
      <button @click="count++">Count is {{ count }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const title = '${projectName}'
const count = ref(0)
</script>

<style scoped>
#app {
  text-align: center;
  padding: 2rem;
}

.card {
  padding: 2em;
}

button {
  font-size: 1em;
  padding: 0.6em 1.2em;
  cursor: pointer;
}
</style>
`
        },
        {
          path: 'src/style.css',
          content: `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`
        },
        {
          path: '.gitignore',
          content: `node_modules
dist
.DS_Store
*.log
`
        }
      ]
    };
  }

  /**
   * Next.js App 模板
   */
  getNextJsTemplate(projectName) {
    return {
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: projectName,
            version: '0.1.0',
            private: true,
            scripts: {
              'dev': 'next dev',
              'build': 'next build',
              'start': 'next start',
              'lint': 'next lint'
            },
            dependencies: {
              'next': '^13.4.5',
              'react': '^18.2.0',
              'react-dom': '^18.2.0'
            },
            devDependencies: {
              'eslint': '^8.42.0',
              'eslint-config-next': '^13.4.5'
            }
          }, null, 2)
        },
        {
          path: 'app/page.js',
          content: `'use client'

import { useState } from 'react'
import styles from './page.module.css'

export default function Home() {
  const [count, setCount] = useState(0)

  return (
    <main className={styles.main}>
      <h1>${projectName}</h1>
      <div className={styles.card}>
        <button onClick={() => setCount(count + 1)}>
          Count is {count}
        </button>
      </div>
    </main>
  )
}
`
        },
        {
          path: 'app/layout.js',
          content: `export const metadata = {
  title: '${projectName}',
  description: 'Generated by ChainlessChain Code Engine',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`
        },
        {
          path: 'app/page.module.css',
          content: `.main {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6rem;
  min-height: 100vh;
}

.card {
  padding: 2rem;
}
`
        },
        {
          path: '.gitignore',
          content: `node_modules
.next
out
.DS_Store
*.log
`
        }
      ]
    };
  }

  /**
   * FastAPI 模板
   */
  getFastAPITemplate(projectName) {
    return {
      files: [
        {
          path: 'requirements.txt',
          content: `fastapi==0.100.0
uvicorn[standard]==0.22.0
pydantic==2.0.0
python-dotenv==1.0.0
`
        },
        {
          path: 'main.py',
          content: `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="${projectName}")

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Item(BaseModel):
    name: str
    description: str = None
    price: float

@app.get("/")
async def root():
    return {"message": "Welcome to ${projectName} API"}

@app.get("/health")
async def health_check():
    return {"status": "OK"}

@app.get("/items/{item_id}")
async def read_item(item_id: int):
    return {"item_id": item_id, "name": "Sample Item"}

@app.post("/items/")
async def create_item(item: Item):
    return {"item": item, "message": "Item created successfully"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
`
        },
        {
          path: '.env',
          content: `APP_NAME=${projectName}
ENV=development
DEBUG=True
`
        },
        {
          path: '.gitignore',
          content: `__pycache__/
*.py[cod]
*$py.class
.env
venv/
.venv/
*.log
`
        },
        {
          path: 'README.md',
          content: `# ${projectName}

FastAPI application generated by ChainlessChain Code Engine.

## Installation

\`\`\`bash
pip install -r requirements.txt
\`\`\`

## Run

\`\`\`bash
uvicorn main:app --reload
\`\`\`

## API Documentation

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
`
        }
      ]
    };
  }

  /**
   * 代码格式化和美化
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 格式化选项
   * @returns {Promise<Object>} 格式化结果
   */
  async formatCode(code, language, options = {}) {
    this.ensureInitialized();

    const {
      style = 'standard', // standard, prettier, airbnb, google
      indentSize = 2,
      useTabs = false,
      semicolons = true,
      singleQuotes = true
    } = options;

    console.log(`[CodeEngine] 格式化代码: ${language} (${style})`);

    const prompt = `
你是一位代码格式化专家。

请将以下${language}代码按照${style}规范进行格式化和美化:

\`\`\`${language}
${code}
\`\`\`

格式化要求:
1. 缩进: ${indentSize}个${useTabs ? '制表符' : '空格'}
2. 分号: ${semicolons ? '使用' : '不使用'}
3. 引号: ${singleQuotes ? '单引号' : '双引号'}
4. 保持代码功能完全一致
5. 统一代码风格
6. 移除不必要的空行和空格
7. 保持良好的代码可读性

只输出格式化后的代码,用\`\`\`${language}代码块包裹。
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.1, // 低温度确保准确性
        maxTokens: 2000
      });

      const formattedCode = this.extractCodeBlock(response, language);

      return {
        success: true,
        originalCode: code,
        formattedCode: formattedCode,
        style: style,
        language: language
      };

    } catch (error) {
      console.error('[CodeEngine] 代码格式化失败:', error);
      throw error;
    }
  }

  /**
   * 代码复杂度分析
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeComplexity(code, language) {
    this.ensureInitialized();

    console.log(`[CodeEngine] 分析代码复杂度: ${language}`);

    const prompt = `
你是一位代码复杂度分析专家。

请分析以下${language}代码的复杂度:

\`\`\`${language}
${code}
\`\`\`

请按以下格式详细分析:

## 整体复杂度评估
- **圈复杂度**: [1-10之间的数字]
- **认知复杂度**: [1-10之间的数字]
- **代码行数**: [总行数 / 有效代码行数]
- **函数数量**: [函数个数]

## 详细指标
1. **时间复杂度**: O(?)
2. **空间复杂度**: O(?)
3. **嵌套深度**: [最大嵌套层数]
4. **参数数量**: [平均参数个数]

## 复杂函数列表
列出复杂度较高的函数（如果有）:
1. 函数名: [名称], 复杂度: [数字], 建议: [优化建议]

## 优化建议
1. [具体建议1]
2. [具体建议2]
3. [具体建议3]

## 评分
综合评分: [1-10]/10 ([优秀/良好/一般/需改进])
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.3,
        maxTokens: 1500
      });

      // 解析复杂度指标
      const metrics = this.parseComplexityMetrics(response);

      return {
        success: true,
        code: code,
        language: language,
        metrics: metrics,
        analysis: response
      };

    } catch (error) {
      console.error('[CodeEngine] 复杂度分析失败:', error);
      throw error;
    }
  }

  /**
   * 解析复杂度指标
   * @private
   */
  parseComplexityMetrics(analysis) {
    const metrics = {
      cyclomaticComplexity: null,
      cognitiveComplexity: null,
      linesOfCode: null,
      functionCount: null,
      timeComplexity: null,
      spaceComplexity: null,
      score: null
    };

    // 圈复杂度
    const cyclomaticMatch = analysis.match(/圈复杂度[^\d]*(\d+)/);
    if (cyclomaticMatch) {metrics.cyclomaticComplexity = parseInt(cyclomaticMatch[1]);}

    // 认知复杂度
    const cognitiveMatch = analysis.match(/认知复杂度[^\d]*(\d+)/);
    if (cognitiveMatch) {metrics.cognitiveComplexity = parseInt(cognitiveMatch[1]);}

    // 代码行数
    const locMatch = analysis.match(/代码行数[^\d]*(\d+)/);
    if (locMatch) {metrics.linesOfCode = parseInt(locMatch[1]);}

    // 函数数量
    const funcMatch = analysis.match(/函数数量[^\d]*(\d+)/);
    if (funcMatch) {metrics.functionCount = parseInt(funcMatch[1]);}

    // 时间复杂度
    const timeMatch = analysis.match(/时间复杂度[^\n]*O\(([^)]+)\)/);
    if (timeMatch) {metrics.timeComplexity = `O(${timeMatch[1]})`;}

    // 空间复杂度
    const spaceMatch = analysis.match(/空间复杂度[^\n]*O\(([^)]+)\)/);
    if (spaceMatch) {metrics.spaceComplexity = `O(${spaceMatch[1]})`;}

    // 评分
    const scoreMatch = analysis.match(/综合评分[^\d]*(\d+)/);
    if (scoreMatch) {metrics.score = parseInt(scoreMatch[1]);}

    return metrics;
  }

  /**
   * 安全漏洞扫描
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 扫描结果
   */
  async scanSecurity(code, language) {
    this.ensureInitialized();

    console.log(`[CodeEngine] 安全漏洞扫描: ${language}`);

    const prompt = `
你是一位网络安全专家和代码安全审计师。

请对以下${language}代码进行全面的安全漏洞扫描:

\`\`\`${language}
${code}
\`\`\`

请检查以下安全问题:
1. **SQL注入**: 是否存在SQL注入风险
2. **XSS攻击**: 跨站脚本攻击风险
3. **CSRF**: 跨站请求伪造风险
4. **命令注入**: 系统命令注入风险
5. **路径遍历**: 文件路径遍历风险
6. **敏感信息泄露**: 硬编码密码、密钥等
7. **不安全的反序列化**: 反序列化漏洞
8. **弱加密算法**: 使用过时的加密方法
9. **认证授权问题**: 认证和授权缺陷
10. **资源耗尽**: DoS攻击风险

请按以下格式输出:

## 安全等级
[高危/中危/低危/安全]

## 发现的漏洞

### 1. [漏洞类型]
- **严重程度**: [高/中/低]
- **位置**: [代码位置]
- **描述**: [详细描述]
- **风险**: [可能造成的影响]
- **修复建议**: [具体修复方案]

## 安全评分
综合评分: [1-10]/10

## 修复后的代码
\`\`\`${language}
[修复安全问题后的代码]
\`\`\`
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.2,
        maxTokens: 2500
      });

      // 解析安全漏洞
      const vulnerabilities = this.parseSecurityVulnerabilities(response);
      const fixedCode = this.extractCodeBlock(response, language);
      const securityLevel = this.extractSecurityLevel(response);
      const score = this.extractScore(response);

      return {
        success: true,
        code: code,
        language: language,
        securityLevel: securityLevel,
        score: score,
        vulnerabilities: vulnerabilities,
        fixedCode: fixedCode,
        report: response
      };

    } catch (error) {
      console.error('[CodeEngine] 安全扫描失败:', error);
      throw error;
    }
  }

  /**
   * 解析安全漏洞
   * @private
   */
  parseSecurityVulnerabilities(report) {
    const vulnerabilities = [];

    // 提取"发现的漏洞"部分
    const sectionMatch = report.match(/##\s*发现的漏洞([\s\S]*?)(?=##|$)/);

    if (sectionMatch) {
      const section = sectionMatch[1];

      // 匹配每个漏洞
      const vulnRegex = /###\s*\d+\.\s*(.+?)[\s\S]*?严重程度[^\n]*[：:]\s*([^\n]+)[\s\S]*?位置[^\n]*[：:]\s*([^\n]+)[\s\S]*?描述[^\n]*[：:]\s*([^\n]+)[\s\S]*?风险[^\n]*[：:]\s*([^\n]+)[\s\S]*?修复建议[^\n]*[：:]\s*([^\n]+)/g;

      let match;
      while ((match = vulnRegex.exec(section)) !== null) {
        vulnerabilities.push({
          type: match[1].trim(),
          severity: match[2].trim(),
          location: match[3].trim(),
          description: match[4].trim(),
          risk: match[5].trim(),
          recommendation: match[6].trim()
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * 提取安全等级
   * @private
   */
  extractSecurityLevel(report) {
    const match = report.match(/安全等级[^\n]*[：:]\s*([^\n]+)/i);
    if (match) {
      const level = match[1].trim();
      if (level.includes('高危')) {return 'critical';}
      if (level.includes('中危')) {return 'medium';}
      if (level.includes('低危')) {return 'low';}
      if (level.includes('安全')) {return 'safe';}
    }
    return 'unknown';
  }

  /**
   * 代码转换/迁移
   * @param {string} code - 源代码
   * @param {string} fromLanguage - 源语言
   * @param {string} toLanguage - 目标语言
   * @param {Object} options - 转换选项
   * @returns {Promise<Object>} 转换结果
   */
  async convertCode(code, fromLanguage, toLanguage, options = {}) {
    this.ensureInitialized();

    const { preserveComments = true, modernize = true } = options;

    console.log(`[CodeEngine] 代码转换: ${fromLanguage} -> ${toLanguage}`);

    const conversionTypes = {
      'javascript-typescript': 'JavaScript转TypeScript（添加类型注解）',
      'python2-python3': 'Python 2转Python 3（更新语法）',
      'class-hooks': 'React类组件转函数组件（Hooks）',
      'commonjs-esm': 'CommonJS转ES Module',
      'callback-promise': '回调函数转Promise',
      'promise-async': 'Promise转async/await'
    };

    const conversionKey = `${fromLanguage}-${toLanguage}`;
    const conversionDesc = conversionTypes[conversionKey] || `${fromLanguage}转${toLanguage}`;

    const prompt = `
你是一位代码迁移和转换专家。

请将以下${fromLanguage}代码转换为${toLanguage}:

\`\`\`${fromLanguage}
${code}
\`\`\`

转换要求:
1. 保持功能完全一致
2. ${preserveComments ? '保留原有注释' : '可以省略注释'}
3. ${modernize ? '使用现代语法特性' : '使用兼容性较好的语法'}
4. 遵循${toLanguage}的最佳实践
5. 确保类型安全（如适用）
6. 优化代码结构

请按以下格式输出:

## 转换说明
[说明转换的关键点和注意事项]

## 转换后的代码
\`\`\`${toLanguage}
[转换后的代码]
\`\`\`

## 主要变化
1. [变化1]
2. [变化2]
3. [变化3]

## 兼容性说明
[如果有兼容性问题，请说明]
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.2,
        maxTokens: 2500
      });

      const convertedCode = this.extractCodeBlock(response, toLanguage);

      return {
        success: true,
        originalCode: code,
        convertedCode: convertedCode,
        fromLanguage: fromLanguage,
        toLanguage: toLanguage,
        explanation: response
      };

    } catch (error) {
      console.error('[CodeEngine] 代码转换失败:', error);
      throw error;
    }
  }

  /**
   * 生成集成测试
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 测试代码
   */
  async generateIntegrationTests(code, language, options = {}) {
    this.ensureInitialized();

    const { testScenarios = [], framework = null } = options;
    const langInfo = this.supportedLanguages[language] || { testFramework: 'standard' };
    const testFramework = framework || langInfo.testFramework;

    console.log(`[CodeEngine] 生成集成测试: ${language} (${testFramework})`);

    let scenariosText = '';
    if (testScenarios.length > 0) {
      scenariosText = '\n测试场景:\n' + testScenarios.map((s, i) => `${i + 1}. ${s}`).join('\n');
    }

    const prompt = `
你是一位专业的测试工程师,专注于集成测试。

请为以下${language}代码编写完整的集成测试,使用${testFramework}框架:

\`\`\`${language}
${code}
\`\`\`
${scenariosText}

集成测试要求:
1. 测试多个模块之间的交互
2. 测试API端点的完整流程
3. 测试数据库操作（如适用）
4. 测试外部服务集成（使用mock）
5. 测试错误处理和边界情况
6. 设置和清理测试环境

请只输出测试代码,用\`\`\`${language}代码块包裹。
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.3,
        maxTokens: 2000
      });

      const tests = this.extractCodeBlock(response, language);

      return {
        success: true,
        tests: tests,
        testType: 'integration',
        framework: testFramework
      };

    } catch (error) {
      console.error('[CodeEngine] 集成测试生成失败:', error);
      throw error;
    }
  }

  /**
   * 生成E2E测试
   * @param {string} description - 功能描述
   * @param {string} framework - 测试框架（Cypress, Playwright, Selenium）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 测试代码
   */
  async generateE2ETests(description, framework = 'cypress', options = {}) {
    this.ensureInitialized();

    const { userFlows = [], baseUrl = 'http://localhost:3000' } = options;

    console.log(`[CodeEngine] 生成E2E测试: ${framework}`);

    let flowsText = '';
    if (userFlows.length > 0) {
      flowsText = '\n用户流程:\n' + userFlows.map((f, i) => `${i + 1}. ${f}`).join('\n');
    }

    const prompt = `
你是一位E2E测试专家。

请为以下功能编写端到端测试,使用${framework}框架:

功能描述: ${description}
${flowsText}

基础URL: ${baseUrl}

E2E测试要求:
1. 模拟真实用户操作流程
2. 测试完整的用户旅程
3. 包含页面导航和交互
4. 验证UI元素和内容
5. 测试表单提交和验证
6. 处理异步操作和等待
7. 截图和视频记录（失败时）

请只输出测试代码,用\`\`\`javascript代码块包裹。
`;

    try {
      const response = await this.llmManager.query(prompt, {
        temperature: 0.3,
        maxTokens: 2000
      });

      const tests = this.extractCodeBlock(response, 'javascript');

      return {
        success: true,
        tests: tests,
        testType: 'e2e',
        framework: framework
      };

    } catch (error) {
      console.error('[CodeEngine] E2E测试生成失败:', error);
      throw error;
    }
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
