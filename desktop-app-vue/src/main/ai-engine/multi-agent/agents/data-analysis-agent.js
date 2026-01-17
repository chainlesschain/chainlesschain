/**
 * 数据分析 Agent
 *
 * 专门负责数据分析、可视化和转换任务。
 */

const { SpecializedAgent } = require("../specialized-agent");

class DataAnalysisAgent extends SpecializedAgent {
  constructor(options = {}) {
    super("data-analysis", {
      capabilities: [
        "analyze_data",
        "visualize",
        "transform",
        "aggregate",
        "statistics",
        "predict",
        "clean_data",
        "export_data",
      ],
      description: "专门处理数据分析、可视化和转换任务",
      priority: 8,
      ...options,
    });
  }

  /**
   * 执行数据分析任务
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 执行结果
   */
  async execute(task) {
    const { type, input, context = {} } = task;

    switch (type) {
      case "analyze_data":
        return await this.analyzeData(input, context);
      case "visualize":
        return await this.visualizeData(input, context);
      case "transform":
        return await this.transformData(input, context);
      case "aggregate":
        return await this.aggregateData(input, context);
      case "statistics":
        return await this.calculateStatistics(input, context);
      case "predict":
        return await this.predictTrend(input, context);
      case "clean_data":
        return await this.cleanData(input, context);
      case "export_data":
        return await this.exportData(input, context);
      default:
        throw new Error(`不支持的任务类型: ${type}`);
    }
  }

  /**
   * 数据分析
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async analyzeData(input, context) {
    const {
      data,
      analysisType = "general",
      questions = [],
    } = input;

    const dataPreview = this._getDataPreview(data);

    const systemPrompt = `你是一个数据分析专家。请对提供的数据进行分析。

分析类型: ${analysisType}
${questions.length > 0 ? `需要回答的问题:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : ""}

请提供：
1. 数据概览
2. 关键发现
3. 趋势分析
4. 建议和洞察`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请分析以下数据：\n\n${dataPreview}`,
        },
      ],
    });

    return {
      success: true,
      analysis: response,
      dataInfo: {
        type: Array.isArray(data) ? "array" : typeof data,
        size: Array.isArray(data) ? data.length : Object.keys(data || {}).length,
      },
    };
  }

  /**
   * 数据可视化建议
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async visualizeData(input, context) {
    const {
      data,
      chartType = null,
      purpose = "展示数据趋势",
    } = input;

    const dataPreview = this._getDataPreview(data);

    const systemPrompt = `你是一个数据可视化专家。请为数据推荐最佳可视化方案。

目的: ${purpose}
${chartType ? `指定图表类型: ${chartType}` : ""}

请提供：
1. 推荐的图表类型及原因
2. 数据映射建议（X轴、Y轴、颜色等）
3. ECharts 配置代码
4. 可视化最佳实践建议`;

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请为以下数据创建可视化方案：\n\n${dataPreview}`,
        },
      ],
    });

    // 提取 ECharts 配置
    const configMatch = response.match(/```(?:json|javascript)?\n([\s\S]*?)```/);

    return {
      success: true,
      recommendation: response,
      echartsConfig: configMatch ? this._tryParseJSON(configMatch[1]) : null,
    };
  }

  /**
   * 数据转换
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async transformData(input, context) {
    const {
      data,
      transformations,
      targetFormat = null,
    } = input;

    const systemPrompt = `你是一个数据转换专家。请根据要求转换数据。

转换要求：
${transformations.map((t, i) => `${i + 1}. ${t}`).join("\n")}
${targetFormat ? `\n目标格式: ${targetFormat}` : ""}

请提供转换后的数据和转换代码（JavaScript）。`;

    const dataPreview = this._getDataPreview(data);

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请转换以下数据：\n\n${dataPreview}`,
        },
      ],
    });

    // 尝试执行转换（如果返回了代码）
    const transformedData = this._tryExecuteTransform(data, response);

    return {
      success: true,
      explanation: response,
      transformedData,
    };
  }

  /**
   * 数据聚合
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async aggregateData(input, context) {
    const {
      data,
      groupBy,
      aggregations = ["sum", "count", "average"],
    } = input;

    if (!Array.isArray(data)) {
      throw new Error("数据必须是数组格式");
    }

    const systemPrompt = `你是一个数据聚合专家。请根据要求聚合数据。

分组字段: ${groupBy}
聚合操作: ${aggregations.join(", ")}

请提供：
1. 聚合后的结果
2. 聚合代码（JavaScript）`;

    const dataPreview = this._getDataPreview(data.slice(0, 10));

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `数据样本（共 ${data.length} 条）：\n\n${dataPreview}`,
        },
      ],
    });

    return {
      success: true,
      explanation: response,
      aggregatedData: null, // 需要实际执行聚合
    };
  }

  /**
   * 统计计算
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async calculateStatistics(input, context) {
    const {
      data,
      metrics = ["mean", "median", "std", "min", "max"],
      fields = null,
    } = input;

    // 简单统计计算（针对数值数组）
    if (Array.isArray(data) && data.every((d) => typeof d === "number")) {
      const stats = this._calculateBasicStats(data);
      return {
        success: true,
        statistics: stats,
      };
    }

    // 复杂数据使用 LLM 分析
    const systemPrompt = `你是一个统计分析专家。请计算数据的统计指标。

需要计算的指标: ${metrics.join(", ")}
${fields ? `关注字段: ${fields.join(", ")}` : ""}

请提供：
1. 各指标的计算结果
2. 统计洞察`;

    const dataPreview = this._getDataPreview(data);

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请分析以下数据的统计指标：\n\n${dataPreview}`,
        },
      ],
    });

    return {
      success: true,
      analysis: response,
    };
  }

  /**
   * 趋势预测
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async predictTrend(input, context) {
    const {
      data,
      targetField,
      periods = 5,
    } = input;

    const systemPrompt = `你是一个数据预测专家。请根据历史数据预测未来趋势。

预测目标: ${targetField || "主要指标"}
预测期数: ${periods}

请提供：
1. 趋势分析
2. 预测值
3. 置信区间
4. 预测依据`;

    const dataPreview = this._getDataPreview(data);

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请基于以下历史数据进行预测：\n\n${dataPreview}`,
        },
      ],
    });

    return {
      success: true,
      prediction: response,
    };
  }

  /**
   * 数据清洗
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async cleanData(input, context) {
    const {
      data,
      rules = ["remove_nulls", "remove_duplicates", "fix_types"],
    } = input;

    const systemPrompt = `你是一个数据清洗专家。请根据规则清洗数据。

清洗规则:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

请提供：
1. 发现的数据质量问题
2. 清洗后的数据
3. 清洗代码（JavaScript）`;

    const dataPreview = this._getDataPreview(data);

    const response = await this.callLLM({
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `请清洗以下数据：\n\n${dataPreview}`,
        },
      ],
    });

    return {
      success: true,
      explanation: response,
      cleanedData: this._basicClean(data, rules),
    };
  }

  /**
   * 数据导出
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文
   */
  async exportData(input, context) {
    const {
      data,
      format = "csv",
      options = {},
    } = input;

    let exportedData;

    switch (format.toLowerCase()) {
      case "csv":
        exportedData = this._toCSV(data, options);
        break;
      case "json":
        exportedData = JSON.stringify(data, null, 2);
        break;
      case "markdown":
        exportedData = this._toMarkdownTable(data);
        break;
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }

    return {
      success: true,
      format,
      data: exportedData,
    };
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 获取数据预览
   * @private
   */
  _getDataPreview(data, maxLength = 2000) {
    try {
      const str = JSON.stringify(data, null, 2);
      if (str.length > maxLength) {
        return str.slice(0, maxLength) + "\n...(数据已截断)";
      }
      return str;
    } catch {
      return String(data).slice(0, maxLength);
    }
  }

  /**
   * 计算基本统计
   * @private
   */
  _calculateBasicStats(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const n = sorted.length;

    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    const median =
      n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];

    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    const std = Math.sqrt(variance);

    return {
      count: n,
      sum,
      mean,
      median,
      min: sorted[0],
      max: sorted[n - 1],
      std,
      variance,
    };
  }

  /**
   * 基本数据清洗
   * @private
   */
  _basicClean(data, rules) {
    if (!Array.isArray(data)) return data;

    let cleaned = [...data];

    for (const rule of rules) {
      switch (rule) {
        case "remove_nulls":
          cleaned = cleaned.filter(
            (item) => item !== null && item !== undefined
          );
          break;
        case "remove_duplicates":
          cleaned = [...new Set(cleaned.map((i) => JSON.stringify(i)))].map(
            (s) => JSON.parse(s)
          );
          break;
        case "trim_strings":
          cleaned = cleaned.map((item) =>
            typeof item === "string" ? item.trim() : item
          );
          break;
      }
    }

    return cleaned;
  }

  /**
   * 转换为 CSV
   * @private
   */
  _toCSV(data, options = {}) {
    if (!Array.isArray(data) || data.length === 0) {
      return "";
    }

    const delimiter = options.delimiter || ",";
    const headers = Object.keys(data[0]);

    const csvRows = [
      headers.join(delimiter),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            if (typeof value === "string" && value.includes(delimiter)) {
              return `"${value}"`;
            }
            return value ?? "";
          })
          .join(delimiter)
      ),
    ];

    return csvRows.join("\n");
  }

  /**
   * 转换为 Markdown 表格
   * @private
   */
  _toMarkdownTable(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return "";
    }

    const headers = Object.keys(data[0]);

    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
    const dataRows = data.map(
      (row) => `| ${headers.map((h) => row[h] ?? "").join(" | ")} |`
    );

    return [headerRow, separatorRow, ...dataRows].join("\n");
  }

  /**
   * 尝试解析 JSON
   * @private
   */
  _tryParseJSON(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * 尝试执行转换
   * @private
   */
  _tryExecuteTransform(data, response) {
    // 安全起见，这里不实际执行代码
    // 在生产环境中可以使用 vm 模块安全执行
    return null;
  }
}

module.exports = { DataAnalysisAgent };
