/**
 * 代码生成 Agent
 *
 * 专门负责代码生成、重构和审查任务。
 */

const { SpecializedAgent } = require("../specialized-agent");

class CodeGenerationAgent extends SpecializedAgent {
  constructor(options = {}) {
    super("code-generation", {
      capabilities: [
        "generate_code",
        "refactor",
        "review",
        "fix_bug",
        "add_feature",
        "optimize_code",
        "write_tests",
      ],
      description: "专门处理代码生成、重构、审查和优化任务",
      priority: 10,
      ...options,
    });

    // 支持的编程语言
    this.supportedLanguages = options.supportedLanguages || [
      "javascript",
      "typescript",
      "python",
      "java",
      "go",
      "rust",
      "c",
      "cpp",
      "csharp",
      "php",
      "ruby",
      "swift",
      "kotlin",
      "vue",
      "react",
      "html",
      "css",
      "sql",
    ];
  }

  /**
   * 执行代码相关任务
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 执行结果
   */
  async execute(task) {
    const { type, input, context = {} } = task;

    switch (type) {
      case "generate_code":
        return await this.generateCode(input, context);
      case "refactor":
        return await this.refactorCode(input, context);
      case "review":
        return await this.reviewCode(input, context);
      case "fix_bug":
        return await this.fixBug(input, context);
      case "add_feature":
        return await this.addFeature(input, context);
      case "optimize_code":
        return await this.optimizeCode(input, context);
      case "write_tests":
        return await this.writeTests(input, context);
      default:
        throw new Error(`不支持的任务类型: ${type}`);
    }
  }

  /**
   * 生成代码
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async generateCode(input, context) {
    const {
      description,
      language = "javascript",
      framework = null,
      style = "modern",
    } = input;

    const systemPrompt = `你是一个专业的代码生成助手。请根据用户的描述生成高质量的 ${language} 代码。

要求：
1. 代码应该清晰、简洁、可维护
2. 遵循 ${language} 的最佳实践
3. 添加必要的注释
4. 考虑边界情况和错误处理
${framework ? `5. 使用 ${framework} 框架` : ""}

请直接输出代码，使用合适的代码块格式。`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: description }],
    });

    // 解析代码块
    const codeBlocks = this._extractCodeBlocks(response);

    return {
      success: true,
      code: codeBlocks.length > 0 ? codeBlocks[0].code : response,
      language: codeBlocks.length > 0 ? codeBlocks[0].language : language,
      fullResponse: response,
    };
  }

  /**
   * 重构代码
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async refactorCode(input, context) {
    const {
      code,
      refactorType = "general",
      targetPattern = null,
    } = input;

    const systemPrompt = `你是一个代码重构专家。请对提供的代码进行重构优化。

重构类型: ${refactorType}
${targetPattern ? `目标模式: ${targetPattern}` : ""}

重构原则：
1. 保持功能不变
2. 提高代码可读性
3. 减少代码重复
4. 遵循 SOLID 原则
5. 添加必要的注释说明变更

请输出重构后的代码和变更说明。`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请重构以下代码：\n\n${code}` }],
    });

    const codeBlocks = this._extractCodeBlocks(response);

    return {
      success: true,
      originalCode: code,
      refactoredCode: codeBlocks.length > 0 ? codeBlocks[0].code : null,
      explanation: response,
    };
  }

  /**
   * 代码审查
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async reviewCode(input, context) {
    const {
      code,
      focusAreas = ["security", "performance", "readability", "best_practices"],
    } = input;

    const systemPrompt = `你是一个代码审查专家。请对提供的代码进行全面审查。

审查重点：
${focusAreas.map((area, i) => `${i + 1}. ${area}`).join("\n")}

请提供：
1. 问题列表（按严重程度排序）
2. 改进建议
3. 代码质量评分（1-10）
4. 亮点（如果有）`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请审查以下代码：\n\n${code}` }],
    });

    // 尝试解析结构化评审结果
    const review = this._parseReview(response);

    return {
      success: true,
      review,
      fullResponse: response,
    };
  }

  /**
   * 修复 Bug
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async fixBug(input, context) {
    const {
      code,
      bugDescription,
      errorMessage = null,
      stackTrace = null,
    } = input;

    let userMessage = `请修复以下代码中的 bug：\n\n${code}\n\n问题描述：${bugDescription}`;

    if (errorMessage) {
      userMessage += `\n\n错误信息：${errorMessage}`;
    }

    if (stackTrace) {
      userMessage += `\n\n堆栈跟踪：${stackTrace}`;
    }

    const systemPrompt = `你是一个 Bug 修复专家。请分析并修复代码中的问题。

请提供：
1. 问题根因分析
2. 修复后的代码
3. 测试建议`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const codeBlocks = this._extractCodeBlocks(response);

    return {
      success: true,
      fixedCode: codeBlocks.length > 0 ? codeBlocks[0].code : null,
      analysis: response,
    };
  }

  /**
   * 添加功能
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async addFeature(input, context) {
    const {
      code,
      featureDescription,
      requirements = [],
    } = input;

    const systemPrompt = `你是一个功能开发专家。请在现有代码基础上添加新功能。

要求：
1. 保持现有功能不变
2. 遵循现有代码风格
3. 添加必要的注释
4. 考虑边界情况
${requirements.length > 0 ? `\n特殊要求：\n${requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : ""}`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `现有代码：\n\n${code}\n\n需要添加的功能：${featureDescription}`,
        },
      ],
    });

    const codeBlocks = this._extractCodeBlocks(response);

    return {
      success: true,
      updatedCode: codeBlocks.length > 0 ? codeBlocks[0].code : null,
      explanation: response,
    };
  }

  /**
   * 优化代码
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async optimizeCode(input, context) {
    const {
      code,
      optimizationGoals = ["performance", "memory"],
    } = input;

    const systemPrompt = `你是一个代码优化专家。请对代码进行优化。

优化目标：
${optimizationGoals.map((goal, i) => `${i + 1}. ${goal}`).join("\n")}

请提供：
1. 优化后的代码
2. 优化说明
3. 预期改进`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请优化以下代码：\n\n${code}` }],
    });

    const codeBlocks = this._extractCodeBlocks(response);

    return {
      success: true,
      optimizedCode: codeBlocks.length > 0 ? codeBlocks[0].code : null,
      explanation: response,
    };
  }

  /**
   * 编写测试
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async writeTests(input, context) {
    const {
      code,
      testFramework = "jest",
      testTypes = ["unit"],
    } = input;

    const systemPrompt = `你是一个测试专家。请为提供的代码编写测试。

测试框架：${testFramework}
测试类型：${testTypes.join(", ")}

要求：
1. 覆盖主要功能
2. 包含边界情况
3. 测试异常处理
4. 清晰的测试描述`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请为以下代码编写测试：\n\n${code}` }],
    });

    const codeBlocks = this._extractCodeBlocks(response);

    return {
      success: true,
      testCode: codeBlocks.length > 0 ? codeBlocks[0].code : null,
      explanation: response,
    };
  }

  /**
   * 提取代码块
   * @private
   */
  _extractCodeBlocks(text) {
    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        language: match[1] || "text",
        code: match[2].trim(),
      });
    }

    return blocks;
  }

  /**
   * 解析审查结果
   * @private
   */
  _parseReview(text) {
    // 简单解析，实际可以更复杂
    return {
      issues: [],
      suggestions: [],
      score: null,
      highlights: [],
      rawText: text,
    };
  }
}

module.exports = { CodeGenerationAgent };
