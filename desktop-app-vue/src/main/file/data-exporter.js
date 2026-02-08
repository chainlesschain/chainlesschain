/**
 * 数据导出导入工具
 * 支持多种格式的数据导出和导入
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");

class DataExporter {
  constructor() {
    this.supportedFormats = ["json", "csv", "markdown", "html"];
  }

  /**
   * 导出数据为JSON
   */
  exportToJSON(data, filePath) {
    try {
      const json = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, json, "utf8");
      return { success: true, path: filePath, size: json.length };
    } catch (error) {
      logger.error("[DataExporter] Export to JSON error:", error);
      throw error;
    }
  }

  /**
   * 导出数据为CSV
   */
  exportToCSV(data, filePath, options = {}) {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Data must be a non-empty array");
      }

      const headers = options.headers || Object.keys(data[0]);
      const delimiter = options.delimiter || ",";
      const lineBreak = options.lineBreak || "\n";

      // 构建CSV内容
      let csv = headers.join(delimiter) + lineBreak;

      for (const row of data) {
        const values = headers.map((header) => {
          let value = row[header] || "";

          // 处理包含分隔符或换行符的值
          if (
            typeof value === "string" &&
            (value.includes(delimiter) || value.includes(lineBreak))
          ) {
            value = `"${value.replace(/"/g, '""')}"`;
          }

          return value;
        });

        csv += values.join(delimiter) + lineBreak;
      }

      fs.writeFileSync(filePath, csv, "utf8");
      return { success: true, path: filePath, size: csv.length };
    } catch (error) {
      logger.error("[DataExporter] Export to CSV error:", error);
      throw error;
    }
  }

  /**
   * 导出数据为Markdown
   */
  exportToMarkdown(data, filePath, options = {}) {
    try {
      let markdown = "";

      if (options.title) {
        markdown += `# ${options.title}\n\n`;
      }

      if (options.description) {
        markdown += `${options.description}\n\n`;
      }

      if (Array.isArray(data)) {
        // 表格格式
        if (data.length > 0) {
          const headers = options.headers || Object.keys(data[0]);

          // 表头
          markdown += "| " + headers.join(" | ") + " |\n";
          markdown += "| " + headers.map(() => "---").join(" | ") + " |\n";

          // 数据行
          for (const row of data) {
            const values = headers.map((header) => row[header] || "");
            markdown += "| " + values.join(" | ") + " |\n";
          }
        }
      } else if (typeof data === "object") {
        // 键值对格式
        for (const [key, value] of Object.entries(data)) {
          markdown += `## ${key}\n\n`;
          markdown += `${value}\n\n`;
        }
      }

      fs.writeFileSync(filePath, markdown, "utf8");
      return { success: true, path: filePath, size: markdown.length };
    } catch (error) {
      logger.error("[DataExporter] Export to Markdown error:", error);
      throw error;
    }
  }

  /**
   * 导出数据为HTML
   */
  exportToHTML(data, filePath, options = {}) {
    try {
      let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title || "Data Export"}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
  </style>
</head>
<body>
`;

      if (options.title) {
        html += `  <h1>${options.title}</h1>\n`;
      }

      if (options.description) {
        html += `  <p>${options.description}</p>\n`;
      }

      if (Array.isArray(data) && data.length > 0) {
        const headers = options.headers || Object.keys(data[0]);

        html += "  <table>\n";
        html += "    <thead>\n      <tr>\n";

        for (const header of headers) {
          html += `        <th>${header}</th>\n`;
        }

        html += "      </tr>\n    </thead>\n";
        html += "    <tbody>\n";

        for (const row of data) {
          html += "      <tr>\n";
          for (const header of headers) {
            html += `        <td>${row[header] || ""}</td>\n`;
          }
          html += "      </tr>\n";
        }

        html += "    </tbody>\n";
        html += "  </table>\n";
      }

      html += "</body>\n</html>";

      fs.writeFileSync(filePath, html, "utf8");
      return { success: true, path: filePath, size: html.length };
    } catch (error) {
      logger.error("[DataExporter] Export to HTML error:", error);
      throw error;
    }
  }

  /**
   * 导入JSON数据
   */
  importFromJSON(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(content);
      return { success: true, data };
    } catch (error) {
      logger.error("[DataExporter] Import from JSON error:", error);
      throw error;
    }
  }

  /**
   * 导入CSV数据
   */
  importFromCSV(filePath, options = {}) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const delimiter = options.delimiter || ",";
      const lines = content.split("\n").filter((line) => line.trim());

      if (lines.length === 0) {
        return { success: true, data: [] };
      }

      // 解析表头
      const headers = lines[0].split(delimiter).map((h) => h.trim());

      // 解析数据行
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(delimiter).map((v) => v.trim());
        const row = {};

        for (let j = 0; j < headers.length; j++) {
          row[headers[j]] = values[j] || "";
        }

        data.push(row);
      }

      return { success: true, data };
    } catch (error) {
      logger.error("[DataExporter] Import from CSV error:", error);
      throw error;
    }
  }

  /**
   * 批量导出
   */
  async batchExport(items, format, outputDir, options = {}) {
    try {
      const results = [];

      for (const item of items) {
        const fileName = `${item.name || Date.now()}.${format}`;
        const filePath = path.join(outputDir, fileName);

        let result;
        switch (format) {
          case "json":
            result = this.exportToJSON(item.data, filePath);
            break;
          case "csv":
            result = this.exportToCSV(item.data, filePath, options);
            break;
          case "markdown":
            result = this.exportToMarkdown(item.data, filePath, options);
            break;
          case "html":
            result = this.exportToHTML(item.data, filePath, options);
            break;
          default:
            throw new Error(`Unsupported format: ${format}`);
        }

        results.push(result);
      }

      return { success: true, results };
    } catch (error) {
      logger.error("[DataExporter] Batch export error:", error);
      throw error;
    }
  }
}

// 创建单例
let dataExporter = null;

function getDataExporter() {
  if (!dataExporter) {
    dataExporter = new DataExporter();
  }
  return dataExporter;
}

module.exports = { DataExporter, getDataExporter };
