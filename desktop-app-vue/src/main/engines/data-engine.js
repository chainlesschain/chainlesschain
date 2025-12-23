/**
 * 数据处理引擎
 * 负责Excel/CSV数据读写、数据分析和可视化
 */

const fs = require('fs').promises;
const path = require('path');

class DataEngine {
  constructor() {
    // 图表类型定义
    this.chartTypes = {
      line: '折线图',
      bar: '柱状图',
      pie: '饼图',
      scatter: '散点图',
      area: '面积图',
    };
  }

  /**
   * 读取CSV数据
   * @param {string} filePath - CSV文件路径
   * @returns {Promise<Object>} 数据对象
   */
  async readCSV(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      if (lines.length === 0) {
        throw new Error('CSV文件为空');
      }

      // 解析表头
      const headers = this.parseCSVLine(lines[0]);

      // 解析数据行
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        const row = {};

        headers.forEach((header, index) => {
          row[header] = values[index] || '';
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
   * 写入CSV数据
   * @param {string} filePath - CSV文件路径
   * @param {Object} data - 数据对象
   * @returns {Promise<Object>} 写入结果
   */
  async writeCSV(filePath, data) {
    try {
      const { headers, rows } = data;

      let csvContent = '';

      // 写入表头
      csvContent += headers.join(',') + '\n';

      // 写入数据行
      for (const row of rows) {
        const values = headers.map(header => {
          const value = row[header] || '';
          // 如果值包含逗号或引号，需要用引号包裹
          if (value.toString().includes(',') || value.toString().includes('"')) {
            return `"${value.toString().replace(/"/g, '""')}"`;
          }
          return value;
        });

        csvContent += values.join(',') + '\n';
      }

      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await fs.writeFile(filePath, csvContent, 'utf-8');

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
    const analyzedColumns = columns.length > 0 ? columns : this.findNumericColumns(rows);

    for (const column of analyzedColumns) {
      const values = rows.map(row => parseFloat(row[column])).filter(v => !isNaN(v));

      if (values.length === 0) continue;

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
      chartType = 'bar',
      title = '数据图表',
      xColumn,
      yColumn,
      outputPath,
    } = options;

    const { rows } = data;

    if (!xColumn || !yColumn) {
      throw new Error('必须指定X轴和Y轴列');
    }

    // 提取图表数据
    const labels = rows.map(row => row[xColumn]);
    const values = rows.map(row => parseFloat(row[yColumn]));

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
      await fs.writeFile(outputPath, chartHTML, 'utf-8');

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
    await fs.writeFile(outputPath, reportMarkdown, 'utf-8');

    return {
      success: true,
      filePath: outputPath,
    };
  }

  // ========== 私有辅助方法 ==========

  /**
   * 解析CSV行
   * @private
   */
  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
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
    if (rows.length === 0) return [];

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
   * 标准差
   * @private
   */
  standardDeviation(values) {
    const avg = this.mean(values);
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = this.mean(squareDiffs);
    return Math.sqrt(avgSquareDiff);
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
        scales: ${chartType !== 'pie' ? `{
          y: {
            beginAtZero: true
          }
        }` : '{}'}
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
    markdown += `**生成时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;
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
}

module.exports = DataEngine;
