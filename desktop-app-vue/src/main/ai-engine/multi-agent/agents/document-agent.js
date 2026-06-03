/**
 * 文档处理 Agent
 *
 * 专门负责文档生成、编辑和格式转换任务。
 */

const { SpecializedAgent } = require("../specialized-agent");

class DocumentAgent extends SpecializedAgent {
  constructor(options = {}) {
    super("document", {
      capabilities: [
        "write_document",
        "edit_document",
        "summarize",
        "translate",
        "format_convert",
        "generate_outline",
        "proofread",
        "extract_info",
      ],
      description: "专门处理文档编写、编辑、翻译和格式转换任务",
      priority: 7,
      ...options,
    });
  }

  /**
   * 执行文档任务
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 执行结果
   */
  async execute(task) {
    const { type, input, context = {} } = task;

    switch (type) {
      case "write_document":
        return await this.writeDocument(input, context);
      case "edit_document":
        return await this.editDocument(input, context);
      case "summarize":
        return await this.summarize(input, context);
      case "translate":
        return await this.translate(input, context);
      case "format_convert":
        return await this.formatConvert(input, context);
      case "generate_outline":
        return await this.generateOutline(input, context);
      case "proofread":
        return await this.proofread(input, context);
      case "extract_info":
        return await this.extractInfo(input, context);
      default:
        throw new Error(`不支持的任务类型: ${type}`);
    }
  }

  /**
   * 撰写文档
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async writeDocument(input, context) {
    const {
      topic,
      documentType = "article",
      style = "professional",
      length = "medium",
      outline = null,
    } = input;

    const lengthGuide = {
      short: "500-1000字",
      medium: "1500-2500字",
      long: "3000-5000字",
    };

    const systemPrompt = `你是一个专业的文档撰写专家。请根据要求撰写文档。

文档类型: ${documentType}
写作风格: ${style}
目标长度: ${lengthGuide[length] || length}
${outline ? `\n大纲:\n${outline}` : ""}

要求：
1. 结构清晰，逻辑连贯
2. 内容准确，有说服力
3. 语言流畅，符合${style}风格
4. 适当使用标题、列表等格式`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请撰写关于"${topic}"的${documentType}` }],
    });

    return {
      success: true,
      document: response,
      metadata: {
        topic,
        documentType,
        style,
        wordCount: this._countWords(response),
      },
    };
  }

  /**
   * 编辑文档
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async editDocument(input, context) {
    const {
      content,
      editInstructions,
      preserveStyle = true,
    } = input;

    const systemPrompt = `你是一个专业的文档编辑。请根据指示编辑文档。

编辑要求：
${editInstructions}

${preserveStyle ? "请保持原有的写作风格。" : "可以调整写作风格。"}

请输出编辑后的完整文档。`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `原文档：\n\n${content}` }],
    });

    return {
      success: true,
      editedDocument: response,
      changes: this._getChangesSummary(content, response),
    };
  }

  /**
   * 内容摘要
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async summarize(input, context) {
    const {
      content,
      summaryType = "general",
      length = "medium",
      focus = null,
    } = input;

    const lengthGuide = {
      short: "50-100字",
      medium: "150-300字",
      long: "400-600字",
    };

    const systemPrompt = `你是一个内容摘要专家。请为以下内容生成摘要。

摘要类型: ${summaryType}
目标长度: ${lengthGuide[length] || length}
${focus ? `重点关注: ${focus}` : ""}

请提供清晰、简洁的摘要，保留关键信息。`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请摘要以下内容：\n\n${content}` }],
    });

    return {
      success: true,
      summary: response,
      originalLength: this._countWords(content),
      summaryLength: this._countWords(response),
      compressionRatio: (this._countWords(response) / this._countWords(content)).toFixed(2),
    };
  }

  /**
   * 翻译
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async translate(input, context) {
    const {
      content,
      targetLanguage,
      sourceLanguage = "auto",
      style = "natural",
    } = input;

    const systemPrompt = `你是一个专业翻译。请将文本翻译成${targetLanguage}。

翻译风格: ${style}
${sourceLanguage !== "auto" ? `源语言: ${sourceLanguage}` : ""}

要求：
1. 翻译准确，保留原意
2. 语言自然流畅
3. 保持原文格式结构`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: content }],
    });

    return {
      success: true,
      translation: response,
      sourceLanguage,
      targetLanguage,
    };
  }

  /**
   * 格式转换
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async formatConvert(input, context) {
    const {
      content,
      sourceFormat,
      targetFormat,
    } = input;

    const systemPrompt = `你是一个格式转换专家。请将文档从 ${sourceFormat} 格式转换为 ${targetFormat} 格式。

要求：
1. 保留所有内容
2. 正确转换格式元素（标题、列表、表格等）
3. 输出格式正确可用`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请将以下 ${sourceFormat} 内容转换为 ${targetFormat}：\n\n${content}`,
        },
      ],
    });

    return {
      success: true,
      convertedContent: response,
      sourceFormat,
      targetFormat,
    };
  }

  /**
   * 生成大纲
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async generateOutline(input, context) {
    const {
      topic,
      documentType = "article",
      depth = 2,
      requirements = [],
    } = input;

    const systemPrompt = `你是一个文档规划专家。请为以下主题生成详细大纲。

文档类型: ${documentType}
大纲深度: ${depth}级
${requirements.length > 0 ? `特殊要求:\n${requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : ""}

请生成结构化的大纲，包括主要章节和子章节。`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请为"${topic}"生成大纲` }],
    });

    return {
      success: true,
      outline: response,
      topic,
      documentType,
    };
  }

  /**
   * 校对
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async proofread(input, context) {
    const {
      content,
      checkAreas = ["grammar", "spelling", "style", "consistency"],
    } = input;

    const systemPrompt = `你是一个专业校对员。请检查文档中的问题。

检查项目:
${checkAreas.map((area, i) => `${i + 1}. ${area}`).join("\n")}

请提供：
1. 发现的问题列表（包括位置和建议修改）
2. 修改后的文档
3. 整体质量评估`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请校对以下内容：\n\n${content}` }],
    });

    return {
      success: true,
      proofreadResult: response,
    };
  }

  /**
   * 信息提取
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async extractInfo(input, context) {
    const {
      content,
      extractTypes = ["entities", "keywords", "facts"],
      format = "structured",
    } = input;

    const systemPrompt = `你是一个信息提取专家。请从文档中提取关键信息。

提取类型:
${extractTypes.map((t, i) => `${i + 1}. ${t}`).join("\n")}

输出格式: ${format}

请以结构化方式输出提取的信息。`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [{ role: "user", content: `请从以下内容提取信息：\n\n${content}` }],
    });

    return {
      success: true,
      extractedInfo: response,
      extractTypes,
    };
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 统计字数
   * @private
   */
  _countWords(text) {
    if (!text) {return 0;}
    // 中文按字符计算，英文按空格分词
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = text.replace(/[\u4e00-\u9fa5]/g, "").trim().split(/\s+/).filter(Boolean).length;
    return chineseChars + englishWords;
  }

  /**
   * 获取变更摘要
   * @private
   */
  _getChangesSummary(original, edited) {
    const originalWords = this._countWords(original);
    const editedWords = this._countWords(edited);

    return {
      originalLength: originalWords,
      editedLength: editedWords,
      difference: editedWords - originalWords,
    };
  }
}

module.exports = { DocumentAgent };
