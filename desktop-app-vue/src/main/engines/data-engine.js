/**
 * 数据处理引擎
 * 负责Excel/CSV数据读写、数据分析和可视化
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");

// 尝试加载Excel库（可选依赖）
let ExcelJS = null;
try {
  ExcelJS = require("exceljs");
} catch (e) {
  logger.warn(
    "[Data Engine] exceljs库未安装，Excel功能将不可用。安装命令: npm install exceljs",
  );
}

class DataEngine {
  constructor() {
    // 图表类型定义
    this.chartTypes = {
      line: "折线图",
      bar: "柱状图",
      pie: "饼图",
      scatter: "散点图",
      area: "面积图",
    };

    // 检查Excel支持
    this.excelSupported = ExcelJS !== null;
  }

  /**
   * 读取CSV数据
   * @param {string} filePath - CSV文件路径
   * @returns {Promise<Object>} 数据对象
   */
  async readCSV(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      if (lines.length === 0) {
        throw new Error("CSV文件为空");
      }

      // 解析表头
      const headers = this.parseCSVLine(lines[0]);

      // 解析数据行
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        const row = {};

        headers.forEach((header, index) => {
          row[header] = values[index] || "";
        });

        rows.push(row);
      }

      return {
        success: true,
        headers,
        rows,
        rowCount: rows.length,
      };
    } catch (error) {
      throw new Error(`读取CSV失败: ${error.message}`);
    }
  }

  /**
   * 读取Excel数据
   * @param {string} filePath - Excel文件路径
   * @returns {Promise<Object>} 数据对象
   */
  async readExcel(filePath) {
    if (!this.excelSupported) {
      throw new Error("Excel功能不可用，请安装exceljs库: npm install exceljs");
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      // 默认读取第一个工作表
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new Error("Excel文件为空");
      }
      const sheetName = worksheet.name;

      // 转换为JSON（行数组格式）
      const jsonData = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        jsonData.push(row.values.slice(1)); // row.values[0] is undefined (1-indexed)
      });

      if (jsonData.length === 0) {
        throw new Error("Excel文件为空");
      }

      // 解析表头和数据
      const headers = jsonData[0].map((h) => String(h || ""));
      const rows = [];

      for (let i = 1; i < jsonData.length; i++) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] =
            jsonData[i][index] !== undefined ? String(jsonData[i][index]) : "";
        });
        rows.push(row);
      }

      return {
        success: true,
        headers,
        rows,
        rowCount: rows.length,
        sheetName,
      };
    } catch (error) {
      throw new Error(`读取Excel失败: ${error.message}`);
    }
  }

  /**
   * 写入CSV数据
   * @param {string} filePath - CSV文件路径
   * @param {Object} data - 数据对象
   * @returns {Promise<Object>} 写入结果
   */
  async writeCSV(filePath, data) {
    try {
      const { headers, rows } = data;

      let csvContent = "";

      // 写入表头
      csvContent += headers.join(",") + "\n";

      // 写入数据行
      for (const row of rows) {
        const values = headers.map((header) => {
          const value = row[header] || "";
          // 如果值包含逗号或引号，需要用引号包裹
          if (
            value.toString().includes(",") ||
            value.toString().includes('"')
          ) {
            return `"${value.toString().replace(/"/g, '""')}"`;
          }
          return value;
        });

        csvContent += values.join(",") + "\n";
      }

      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await fs.writeFile(filePath, csvContent, "utf-8");

      return {
        success: true,
        filePath,
        rowCount: rows.length,
      };
    } catch (error) {
      throw new Error(`写入CSV失败: ${error.message}`);
    }
  }

  /**
   * 写入Excel数据
   * @param {string} filePath - Excel文件路径
   * @param {Object} data - 数据对象
   * @returns {Promise<Object>} 写入结果
   */
  async writeExcel(filePath, data) {
    if (!this.excelSupported) {
      throw new Error("Excel功能不可用，请安装exceljs库: npm install exceljs");
    }

    try {
      const { headers, rows } = data;

      // 创建工作簿和工作表
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Sheet1");

      // 写入表头
      worksheet.addRow(headers);

      // 写入数据行
      for (const row of rows) {
        const rowData = headers.map((header) => row[header] || "");
        worksheet.addRow(rowData);
      }

      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await workbook.xlsx.writeFile(filePath);

      return {
        success: true,
        filePath,
        rowCount: rows.length,
      };
    } catch (error) {
      throw new Error(`写入Excel失败: ${error.message}`);
    }
  }

  /**
   * 数据分析
   * @param {Object} data - 数据对象
   * @param {Object} options - 分析选项
   * @returns {Object} 分析结果
   */
  analyzeData(data, options = {}) {
    const { rows } = data;
    const { columns = [] } = options;

    const results = {};

    // 如果没有指定列，分析所有数值列
    const analyzedColumns =
      columns.length > 0 ? columns : this.findNumericColumns(rows);

    for (const column of analyzedColumns) {
      const values = rows
        .map((row) => parseFloat(row[column]))
        .filter((v) => !isNaN(v));

      if (values.length === 0) {
        continue;
      }

      results[column] = {
        count: values.length,
        sum: this.sum(values),
        mean: this.mean(values),
        median: this.median(values),
        min: Math.min(...values),
        max: Math.max(...values),
        stdDev: this.standardDeviation(values),
      };
    }

    return {
      success: true,
      analysis: results,
      columns: analyzedColumns,
    };
  }

  /**
   * 生成数据可视化图表
   * @param {Object} data - 数据对象
   * @param {Object} options - 图表选项
   * @returns {Promise<Object>} 图表HTML
   */
  async generateChart(data, options = {}) {
    const {
      chartType = "bar",
      title = "数据图表",
      xColumn,
      yColumn,
      outputPath,
    } = options;

    const { rows } = data;

    if (!xColumn || !yColumn) {
      throw new Error("必须指定X轴和Y轴列");
    }

    // 提取图表数据
    const labels = rows.map((row) => row[xColumn]);
    const values = rows.map((row) => parseFloat(row[yColumn]));

    // 生成图表HTML
    const chartHTML = this.generateChartHTML(chartType, {
      title,
      labels,
      values,
    });

    if (outputPath) {
      // 确保目录存在
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });

      // 写入HTML文件
      await fs.writeFile(outputPath, chartHTML, "utf-8");

      return {
        success: true,
        chartType,
        filePath: outputPath,
      };
    }

    return {
      success: true,
      chartType,
      html: chartHTML,
    };
  }

  /**
   * 生成分析报告
   * @param {Object} analysisResults - 分析结果
   * @param {string} outputPath - 输出路径
   * @returns {Promise<Object>} 报告结果
   */
  async generateReport(analysisResults, outputPath) {
    const reportMarkdown = this.generateReportMarkdown(analysisResults);

    // 确保目录存在
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    // 写入Markdown文件
    await fs.writeFile(outputPath, reportMarkdown, "utf-8");

    return {
      success: true,
      filePath: outputPath,
    };
  }

  // ========== 私有辅助方法 ==========

  /**
   * 解析CSV行（支持双引号转义）
   * @private
   */
  parseCSVLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        // 处理双引号转义 ("" 表示一个引号)
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // 跳过下一个引号
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
  }

  /**
   * 找到数值列
   * @private
   */
  findNumericColumns(rows) {
    if (rows.length === 0) {
      return [];
    }

    const firstRow = rows[0];
    const numericColumns = [];

    for (const column in firstRow) {
      const value = parseFloat(firstRow[column]);
      if (!isNaN(value)) {
        numericColumns.push(column);
      }
    }

    return numericColumns;
  }

  /**
   * 求和
   * @private
   */
  sum(values) {
    return values.reduce((acc, val) => acc + val, 0);
  }

  /**
   * 平均值
   * @private
   */
  mean(values) {
    return this.sum(values) / values.length;
  }

  /**
   * 中位数
   * @private
   */
  median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  /**
   * 标准差（样本标准差）
   * @private
   */
  standardDeviation(values) {
    if (values.length <= 1) {
      return 0;
    }

    const avg = this.mean(values);
    const squareDiffs = values.map((value) => Math.pow(value - avg, 2));
    // 使用 n-1 计算样本标准差
    const variance =
      squareDiffs.reduce((sum, val) => sum + val, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * 生成图表HTML
   * @private
   */
  generateChartHTML(chartType, data) {
    const { title, labels, values } = data;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: #f5f7fa;
    }
    .chart-container {
      background: white;
      border-radius: 10px;
      padding: 2rem;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }
    h1 {
      text-align: center;
      color: #2c3e50;
      margin-bottom: 2rem;
    }
  </style>
</head>
<body>
  <div class="chart-container">
    <h1>${title}</h1>
    <canvas id="myChart"></canvas>
  </div>

  <script>
    const ctx = document.getElementById('myChart');

    new Chart(ctx, {
      type: '${chartType}',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: '数据',
          data: ${JSON.stringify(values)},
          backgroundColor: [
            'rgba(102, 126, 234, 0.5)',
            'rgba(118, 75, 162, 0.5)',
            'rgba(237, 100, 166, 0.5)',
            'rgba(255, 154, 158, 0.5)',
            'rgba(250, 208, 196, 0.5)',
            'rgba(255, 230, 109, 0.5)',
          ],
          borderColor: [
            'rgba(102, 126, 234, 1)',
            'rgba(118, 75, 162, 1)',
            'rgba(237, 100, 166, 1)',
            'rgba(255, 154, 158, 1)',
            'rgba(250, 208, 196, 1)',
            'rgba(255, 230, 109, 1)',
          ],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: false
          }
        },
        scales: ${
          chartType !== "pie"
            ? `{
          y: {
            beginAtZero: true
          }
        }`
            : "{}"
        }
      }
    });
  </script>
</body>
</html>`;
  }

  /**
   * 生成报告Markdown
   * @private
   */
  generateReportMarkdown(analysisResults) {
    const { analysis, columns } = analysisResults;

    let markdown = `# 数据分析报告\n\n`;
    markdown += `**生成时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;
    markdown += `**分析工具**: ChainlessChain Data Engine\n\n`;
    markdown += `---\n\n`;
    markdown += `## 概述\n\n`;
    markdown += `本报告对 ${columns.length} 个数值列进行了统计分析。\n\n`;

    for (const column of columns) {
      const stats = analysis[column];

      markdown += `## ${column}\n\n`;
      markdown += `| 统计指标 | 值 |\n`;
      markdown += `|---------|-----|\n`;
      markdown += `| 数据量 | ${stats.count} |\n`;
      markdown += `| 总和 | ${stats.sum.toFixed(2)} |\n`;
      markdown += `| 平均值 | ${stats.mean.toFixed(2)} |\n`;
      markdown += `| 中位数 | ${stats.median.toFixed(2)} |\n`;
      markdown += `| 最小值 | ${stats.min.toFixed(2)} |\n`;
      markdown += `| 最大值 | ${stats.max.toFixed(2)} |\n`;
      markdown += `| 标准差 | ${stats.stdDev.toFixed(2)} |\n\n`;
    }

    markdown += `## 总结\n\n`;
    markdown += `数据分析已完成。您可以基于以上统计结果进行进一步的决策分析。\n`;

    return markdown;
  }

  /**
   * 生成营养分析报告Markdown
   * @private
   */
  generateNutritionReportMarkdown(analysisResults, options = {}) {
    const { analysis, columns } = analysisResults || {};
    const { sourceFile, description, rowCount } = options;

    let markdown = `# 营养分析报告\n\n`;

    if (sourceFile) {
      markdown += `**来源文件**: ${sourceFile}\n\n`;
    }

    if (description) {
      markdown += `**需求描述**: ${description}\n\n`;
    }

    if (typeof rowCount === "number") {
      markdown += `**数据行数**: ${rowCount}\n\n`;
    }

    if (!Array.isArray(columns) || columns.length === 0) {
      markdown += `未检测到可用于营养分析的数值列。\n`;
      return markdown;
    }

    markdown += `## 汇总\n\n`;
    markdown += `| 指标 | 数量 | 总和 | 平均值 | 最小值 | 最大值 | 标准差 |\n`;
    markdown += `|---|---|---|---|---|---|---|\n`;

    for (const column of columns) {
      const stats = analysis ? analysis[column] : null;
      if (!stats) {
        continue;
      }
      markdown += `| ${column} | ${stats.count} | ${stats.sum.toFixed(2)} | ${stats.mean.toFixed(2)} | ${stats.min.toFixed(2)} | ${stats.max.toFixed(2)} | ${stats.stdDev.toFixed(2)} |\n`;
    }

    return markdown;
  }

  /**
   * 查找营养相关列
   * @private
   */
  findNutritionColumns(headers) {
    if (!Array.isArray(headers)) {
      return [];
    }

    const keywords = [
      "calorie",
      "calories",
      "kcal",
      "energy",
      "protein",
      "fat",
      "lipid",
      "carb",
      "carbohydrate",
      "fiber",
      "sugar",
      "sodium",
      "cholesterol",
      "热量",
      "能量",
      "蛋白",
      "蛋白质",
      "脂肪",
      "碳水",
      "碳水化合物",
      "膳食纤维",
      "纤维",
      "糖",
      "钠",
      "胆固醇",
    ];

    return headers.filter((header) => {
      const normalized = String(header).toLowerCase();
      return keywords.some((keyword) => normalized.includes(keyword));
    });
  }

  /**
   * 使用LLM生成营养分析报告
   * @private
   */
  async generateNutritionReportWithLLM(description, llmManager) {
    const prompt = `根据以下需求生成营养分析报告（Markdown格式）。如果缺少分量，请给出合理假设并明确说明。包含表格（项目、热量、蛋白质、脂肪、碳水）以及总计行。只返回Markdown。\n\n${description}`;

    try {
      let responseText;

      if (typeof llmManager.query === "function") {
        const response = await llmManager.query(prompt, {
          temperature: 0.4,
          maxTokens: 1500,
        });
        responseText = response.text || response;
      } else if (typeof llmManager.chat === "function") {
        const response = await llmManager.chat(
          [{ role: "user", content: prompt }],
          {
            temperature: 0.4,
            max_tokens: 1500,
          },
        );
        responseText = response.text || response.content || response;
      } else {
        throw new Error("LLM Manager 没有可用的查询方法");
      }

      return String(responseText || "").trim();
    } catch (error) {
      logger.warn(
        "[Data Engine] LLM生成营养报告失败，使用兜底报告:",
        error.message,
      );
      return this.generateNutritionFallbackMarkdown(description);
    }
  }

  /**
   * 生成营养分析兜底报告
   * @private
   */
  generateNutritionFallbackMarkdown(description) {
    let markdown = `# 营养分析报告\n\n`;

    if (description) {
      markdown += `**需求描述**: ${description}\n\n`;
    }

    markdown += `未提供可读取的数据文件，无法计算营养信息。\n`;
    return markdown;
  }

  /**
   * 处理项目任务
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 处理结果
   */
  async handleProjectTask(params) {
    const {
      action,
      description,
      outputFiles = [],
      projectPath,
      llmManager,
    } = params;

    logger.info("[Data Engine] 处理数据任务:", action);
    logger.info("[Data Engine] 项目路径:", projectPath);

    try {
      switch (action) {
        case "read_excel": {
          // 读取Excel文件
          const fileName =
            outputFiles[0] || this.extractFileNameFromDescription(description);
          const filePath = path.join(projectPath, fileName);

          logger.info("[Data Engine] 读取Excel文件:", filePath);

          // 根据文件扩展名选择读取方法
          const ext = path.extname(filePath).toLowerCase();
          let data;

          if (ext === ".csv") {
            data = await this.readCSV(filePath);
          } else if (ext === ".xlsx" || ext === ".xls") {
            data = await this.readExcel(filePath);
          } else {
            throw new Error(`不支持的文件格式: ${ext}`);
          }

          return {
            type: "data",
            action: "read",
            filePath,
            success: true,
            data,
          };
        }

        case "read_csv": {
          // 读取CSV文件
          const fileName =
            outputFiles[0] || this.extractFileNameFromDescription(description);
          const filePath = path.join(projectPath, fileName);

          logger.info("[Data Engine] 读取CSV文件:", filePath);

          const data = await this.readCSV(filePath);

          return {
            type: "data",
            action: "read",
            filePath,
            success: true,
            data,
          };
        }

        case "analyze_data": {
          // 分析数据
          // 首先需要读取数据文件
          const fileName = this.extractFileNameFromDescription(description);
          const filePath = path.join(projectPath, fileName);

          logger.info("[Data Engine] 分析文件:", filePath);

          const data = await this.readCSV(filePath);
          const analysis = this.analyzeData(data);

          // 生成分析报告
          const reportFileName = "analysis_report.md";
          const reportPath = path.join(projectPath, reportFileName);
          await this.generateReport(analysis, reportPath);

          return {
            type: "data",
            action: "analyze",
            filePath,
            reportPath,
            success: true,
            analysis,
          };
        }

        case "calculate_nutrition": {
          const reportFileName = outputFiles[0] || "nutrition_report.md";
          const reportPath = path.join(projectPath, reportFileName);

          const safeDescription = description || "";
          const fileMatch = safeDescription.match(/[\w\-_]+\.(csv|xlsx|xls)/i);
          const fileName =
            fileMatch && this.isPathSafe(fileMatch[0]) ? fileMatch[0] : null;

          let data = null;
          let sourcePath = null;

          if (fileName) {
            sourcePath = path.join(projectPath, fileName);
            const ext = path.extname(sourcePath).toLowerCase();
            try {
              if (ext === ".csv") {
                data = await this.readCSV(sourcePath);
              } else if (ext === ".xlsx" || ext === ".xls") {
                data = await this.readExcel(sourcePath);
              }
            } catch (error) {
              logger.warn(
                "[Data Engine] 读取营养数据文件失败，尝试降级处理:",
                error.message,
              );
            }
          }

          let reportMarkdown;
          let analysis = null;

          if (data) {
            const nutritionColumns = this.findNutritionColumns(data.headers);
            analysis = this.analyzeData(data, { columns: nutritionColumns });
            reportMarkdown = this.generateNutritionReportMarkdown(analysis, {
              sourceFile: fileName,
              description: safeDescription,
              rowCount: data.rowCount || data.rows.length,
            });
          } else if (llmManager) {
            reportMarkdown = await this.generateNutritionReportWithLLM(
              safeDescription,
              llmManager,
            );
          } else {
            reportMarkdown =
              this.generateNutritionFallbackMarkdown(safeDescription);
          }

          await fs.mkdir(path.dirname(reportPath), { recursive: true });
          await fs.writeFile(reportPath, reportMarkdown, "utf-8");

          return {
            type: "data",
            action: "calculate_nutrition",
            filePath: sourcePath,
            reportPath,
            success: true,
            analysis,
          };
        }

        case "create_chart": {
          // 创建图表
          const fileName = this.extractFileNameFromDescription(description);
          const filePath = path.join(projectPath, fileName);

          logger.info("[Data Engine] 从文件创建图表:", filePath);

          const data = await this.readCSV(filePath);

          // 自动检测X轴和Y轴列（使用前两列）
          const xColumn = data.headers[0];
          const yColumn = data.headers[1];

          const chartFileName = "chart.html";
          const chartPath = path.join(projectPath, chartFileName);

          const chartResult = await this.generateChart(data, {
            chartType: "bar",
            title: "数据图表",
            xColumn,
            yColumn,
            outputPath: chartPath,
          });

          return {
            type: "data",
            action: "chart",
            filePath,
            chartPath,
            success: true,
            ...chartResult,
          };
        }

        case "export_csv": {
          // 导出CSV文件
          const fileName = outputFiles[0] || "data.csv";
          const filePath = path.join(projectPath, fileName);

          logger.info("[Data Engine] 导出CSV:", filePath);

          // 使用LLM生成示例数据
          let sampleData;
          if (llmManager) {
            sampleData = await this.generateSampleDataWithLLM(
              description,
              llmManager,
            );
          } else {
            // 默认示例数据
            sampleData = {
              headers: ["名称", "数值"],
              rows: [
                { 名称: "项目A", 数值: "100" },
                { 名称: "项目B", 数值: "200" },
                { 名称: "项目C", 数值: "150" },
              ],
            };
          }

          await this.writeCSV(filePath, sampleData);

          return {
            type: "data",
            action: "export",
            filePath,
            success: true,
            rowCount: sampleData.rows.length,
          };
        }

        case "export_excel": {
          // 导出Excel文件
          const fileName = outputFiles[0] || "data.xlsx";
          const filePath = path.join(projectPath, fileName);

          logger.info("[Data Engine] 导出Excel:", filePath);

          // 使用LLM生成示例数据
          let sampleData;
          if (llmManager) {
            sampleData = await this.generateSampleDataWithLLM(
              description,
              llmManager,
            );
          } else {
            // 默认示例数据
            sampleData = {
              headers: ["名称", "数值"],
              rows: [
                { 名称: "项目A", 数值: "100" },
                { 名称: "项目B", 数值: "200" },
                { 名称: "项目C", 数值: "150" },
              ],
            };
          }

          await this.writeExcel(filePath, sampleData);

          return {
            type: "data",
            action: "export",
            filePath,
            success: true,
            rowCount: sampleData.rows.length,
          };
        }

        default:
          throw new Error(`不支持的数据操作: ${action}`);
      }
    } catch (error) {
      logger.error("[Data Engine] 任务执行失败:", error);
      throw error;
    }
  }

  /**
   * 从描述中提取文件名（带路径安全验证）
   * @private
   */
  extractFileNameFromDescription(description) {
    // 尝试从描述中提取文件名（如: "读取sales_data.csv文件"）
    const filePattern = /[\w\-_]+\.(csv|xlsx|xls)/gi;
    const matches = description.match(filePattern);

    if (matches && matches.length > 0) {
      const fileName = matches[0];
      // 验证路径安全：不允许路径遍历
      if (this.isPathSafe(fileName)) {
        return fileName;
      }
    }

    // 默认文件名
    return "data.csv";
  }

  /**
   * 验证路径安全性（防止路径遍历攻击）
   * @private
   */
  isPathSafe(filePath) {
    // 检查是否包含路径遍历字符
    const dangerousPatterns = [
      /\.\./, // 父目录引用
      /^[/\\]/, // 绝对路径
      /[/\\]{2,}/, // 多个斜杠
      /[<>:"|?*]/, // Windows不允许的字符
    ];
    const hasControlChars = [...filePath].some(
      (char) => char.charCodeAt(0) <= 31,
    );

    return (
      !hasControlChars &&
      !dangerousPatterns.some((pattern) => pattern.test(filePath))
    );
  }

  /**
   * 使用LLM生成示例数据
   * @private
   */
  async generateSampleDataWithLLM(description, llmManager) {
    const prompt = `根据以下需求，生成CSV格式的示例数据（JSON格式返回）：

${description}

请返回JSON格式：
{
  "headers": ["列1", "列2", ...],
  "rows": [
    {"列1": "值1", "列2": "值2", ...},
    ...
  ]
}

只返回JSON，不要其他说明文字。`;

    try {
      // 尝试使用不同的LLM方法（兼容多种接口）
      let responseText;

      if (typeof llmManager.query === "function") {
        // 使用 query 方法
        const response = await llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 2000,
        });
        responseText = response.text || response;
      } else if (typeof llmManager.chat === "function") {
        // 使用 chat 方法
        const response = await llmManager.chat(
          [{ role: "user", content: prompt }],
          {
            temperature: 0.7,
            max_tokens: 2000,
          },
        );
        responseText = response.text || response.content || response;
      } else {
        throw new Error("LLM Manager 没有可用的查询方法");
      }

      // 提取JSON
      const jsonMatch = String(responseText).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.warn(
        "[Data Engine] LLM生成数据失败，使用默认数据:",
        error.message,
      );
    }

    // 默认数据
    return {
      headers: ["名称", "数值"],
      rows: [
        { 名称: "项目A", 数值: "100" },
        { 名称: "项目B", 数值: "200" },
        { 名称: "项目C", 数值: "150" },
      ],
    };
  }
}

module.exports = DataEngine;
