/**
 * Multimodal Output Generator — Multi-Format Output (v3.2)
 *
 * Generates rich output in multiple formats:
 * - Markdown documents
 * - HTML rich text
 * - ECharts chart configurations
 * - Reveal.js slide decks
 * - Configurable output templates
 *
 * @module ai-engine/cowork/multimodal-output
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const OUTPUT_FORMAT = {
  MARKDOWN: "markdown",
  HTML: "html",
  CHART: "chart",
  SLIDES: "slides",
  JSON: "json",
  CSV: "csv",
};

const DEFAULT_CONFIG = {
  defaultFormat: OUTPUT_FORMAT.MARKDOWN,
  enableCharts: true,
  enableSlides: true,
  templateDir: null,
  cssTheme: "default",
  maxOutputSizeKB: 5120,
};

const BUILTIN_TEMPLATES = {
  "technical-report": {
    name: "技术报告",
    format: OUTPUT_FORMAT.HTML,
    sections: ["title", "summary", "details", "code", "conclusion"],
  },
  "api-docs": {
    name: "API 文档",
    format: OUTPUT_FORMAT.MARKDOWN,
    sections: ["title", "endpoints", "parameters", "responses", "examples"],
  },
  "analysis-slides": {
    name: "分析演示",
    format: OUTPUT_FORMAT.SLIDES,
    sections: ["title", "overview", "data", "charts", "conclusion"],
  },
  "data-dashboard": {
    name: "数据面板",
    format: OUTPUT_FORMAT.CHART,
    sections: ["title", "kpis", "charts", "tables"],
  },
};

// ============================================================
// MultimodalOutput Class
// ============================================================

class MultimodalOutput extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };
    this.templates = new Map(Object.entries(BUILTIN_TEMPLATES));
    this.stats = {
      totalGenerated: 0,
      formatDistribution: {},
      averageGenerationTimeMs: 0,
    };
    this._genTimes = [];
  }

  /**
   * Initialize
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    logger.info("[MultimodalOutput] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Generate output in the specified format
   * @param {Object} options
   * @param {string} [options.format] - Output format
   * @param {string} [options.template] - Template name
   * @param {Object} options.content - Content to render
   * @param {string} [options.title] - Document title
   * @returns {Object} Generated output
   */
  async generateOutput(options = {}) {
    if (!this.initialized) {
      throw new Error("MultimodalOutput not initialized");
    }

    const startTime = Date.now();
    const format = options.format || this.config.defaultFormat;
    const template = options.template
      ? this.templates.get(options.template)
      : null;

    this.stats.totalGenerated++;
    this.stats.formatDistribution[format] =
      (this.stats.formatDistribution[format] || 0) + 1;

    try {
      let result;

      switch (format) {
        case OUTPUT_FORMAT.MARKDOWN:
          result = this._generateMarkdown(
            options.content,
            options.title,
            template,
          );
          break;
        case OUTPUT_FORMAT.HTML:
          result = this._generateHTML(options.content, options.title, template);
          break;
        case OUTPUT_FORMAT.CHART:
          result = this._generateChart(options.content, options.title);
          break;
        case OUTPUT_FORMAT.SLIDES:
          result = this._generateSlides(
            options.content,
            options.title,
            template,
          );
          break;
        case OUTPUT_FORMAT.JSON:
          result = this._generateJSON(options.content);
          break;
        case OUTPUT_FORMAT.CSV:
          result = this._generateCSV(options.content);
          break;
        default:
          result = this._generateMarkdown(
            options.content,
            options.title,
            template,
          );
      }

      const elapsed = Date.now() - startTime;
      this._genTimes.push(elapsed);
      if (this._genTimes.length > 100) {
        this._genTimes.shift();
      }
      this.stats.averageGenerationTimeMs = Math.round(
        this._genTimes.reduce((a, b) => a + b, 0) / this._genTimes.length,
      );

      this.emit("output:generated", { format, elapsed });

      return {
        format,
        content: result.content,
        metadata: result.metadata || {},
        template: options.template || null,
        generatedAt: new Date().toISOString(),
        duration: elapsed,
      };
    } catch (error) {
      logger.error(`[MultimodalOutput] Generation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available templates
   */
  getTemplates() {
    return Object.fromEntries(this.templates);
  }

  /**
   * Register a custom template
   */
  registerTemplate(name, template) {
    this.templates.set(name, template);
  }

  /**
   * Get supported formats
   */
  getSupportedFormats() {
    return Object.values(OUTPUT_FORMAT);
  }

  getStats() {
    return { ...this.stats };
  }

  getConfig() {
    return { ...this.config };
  }

  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Format Generators
  // ============================================================

  _generateMarkdown(content, title, template) {
    const lines = [];

    if (title) {
      lines.push(`# ${title}`);
      lines.push("");
    }

    if (typeof content === "string") {
      lines.push(content);
    } else if (typeof content === "object") {
      // Render object as structured markdown
      if (content.sections) {
        for (const section of content.sections) {
          lines.push(`## ${section.title || section.heading || ""}`);
          lines.push("");
          if (section.text) {
            lines.push(section.text);
          }
          if (section.code) {
            lines.push(`\`\`\`${section.language || ""}`);
            lines.push(section.code);
            lines.push("```");
          }
          if (section.table) {
            lines.push(this._renderTable(section.table));
          }
          if (section.list) {
            for (const item of section.list) {
              lines.push(`- ${item}`);
            }
          }
          lines.push("");
        }
      } else {
        lines.push(JSON.stringify(content, null, 2));
      }
    }

    return { content: lines.join("\n"), metadata: { format: "markdown" } };
  }

  _generateHTML(content, title, template) {
    const sections = [];

    sections.push("<!DOCTYPE html>");
    sections.push('<html lang="zh-CN">');
    sections.push("<head>");
    sections.push('  <meta charset="UTF-8">');
    sections.push(`  <title>${title || "Report"}</title>`);
    sections.push("  <style>");
    sections.push(
      "    body { font-family: -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; }",
    );
    sections.push("    table { border-collapse: collapse; width: 100%; }");
    sections.push(
      "    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }",
    );
    sections.push("    th { background: #f5f5f5; }");
    sections.push(
      "    pre { background: #f8f8f8; padding: 16px; border-radius: 4px; overflow-x: auto; }",
    );
    sections.push("    code { font-family: 'Fira Code', monospace; }");
    sections.push("  </style>");
    sections.push("</head>");
    sections.push("<body>");

    if (title) {
      sections.push(`<h1>${this._escapeHtml(title)}</h1>`);
    }

    if (typeof content === "string") {
      sections.push(`<div>${this._escapeHtml(content)}</div>`);
    } else if (content?.sections) {
      for (const section of content.sections) {
        sections.push(`<h2>${this._escapeHtml(section.title || "")}</h2>`);
        if (section.text) {
          sections.push(`<p>${this._escapeHtml(section.text)}</p>`);
        }
        if (section.code) {
          sections.push(
            `<pre><code>${this._escapeHtml(section.code)}</code></pre>`,
          );
        }
        if (section.table) {
          sections.push(this._renderHTMLTable(section.table));
        }
      }
    }

    sections.push("</body>");
    sections.push("</html>");

    return { content: sections.join("\n"), metadata: { format: "html" } };
  }

  _generateChart(content, title) {
    // Generate ECharts configuration
    const chartConfig = {
      title: { text: title || "" },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    };

    if (content?.data) {
      if (Array.isArray(content.data)) {
        chartConfig.xAxis.data = content.data.map((_, i) => `Item ${i + 1}`);
        chartConfig.series.push({
          type: content.chartType || "bar",
          data: content.data,
        });
      } else if (content.data.labels && content.data.values) {
        chartConfig.xAxis.data = content.data.labels;
        chartConfig.series.push({
          type: content.chartType || "bar",
          data: content.data.values,
        });
      }
    }

    if (content?.series) {
      chartConfig.series = content.series;
    }

    return {
      content: JSON.stringify(chartConfig, null, 2),
      metadata: { format: "echarts-config", renderWith: "echarts" },
    };
  }

  _generateSlides(content, title, template) {
    const slides = [];

    // Title slide
    slides.push(
      `<section><h1>${this._escapeHtml(title || "Presentation")}</h1></section>`,
    );

    if (content?.sections) {
      for (const section of content.sections) {
        const slideLines = ["<section>"];
        slideLines.push(`<h2>${this._escapeHtml(section.title || "")}</h2>`);
        if (section.text) {
          slideLines.push(`<p>${this._escapeHtml(section.text)}</p>`);
        }
        if (section.bullets) {
          slideLines.push("<ul>");
          for (const bullet of section.bullets) {
            slideLines.push(`<li>${this._escapeHtml(bullet)}</li>`);
          }
          slideLines.push("</ul>");
        }
        slideLines.push("</section>");
        slides.push(slideLines.join("\n"));
      }
    }

    const revealHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title || "Slides"}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/theme/white.css">
</head>
<body>
  <div class="reveal"><div class="slides">
    ${slides.join("\n")}
  </div></div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.js"></script>
  <script>Reveal.initialize();</script>
</body>
</html>`;

    return {
      content: revealHtml,
      metadata: { format: "reveal-slides", slideCount: slides.length },
    };
  }

  _generateJSON(content) {
    return {
      content: JSON.stringify(content, null, 2),
      metadata: { format: "json" },
    };
  }

  _generateCSV(content) {
    if (!content?.rows) {
      return { content: "", metadata: { format: "csv", rows: 0 } };
    }

    const lines = [];
    if (content.headers) {
      lines.push(content.headers.map((h) => this._escapeCSV(h)).join(","));
    }
    for (const row of content.rows) {
      const cells = Array.isArray(row) ? row : Object.values(row);
      lines.push(cells.map((c) => this._escapeCSV(String(c))).join(","));
    }

    return {
      content: lines.join("\n"),
      metadata: { format: "csv", rows: content.rows.length },
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  _renderTable(table) {
    if (!table?.headers) {
      return "";
    }
    const lines = [];
    lines.push("| " + table.headers.join(" | ") + " |");
    lines.push("| " + table.headers.map(() => "---").join(" | ") + " |");
    for (const row of table.rows || []) {
      const cells = Array.isArray(row) ? row : Object.values(row);
      lines.push("| " + cells.join(" | ") + " |");
    }
    return lines.join("\n");
  }

  _renderHTMLTable(table) {
    if (!table?.headers) {
      return "";
    }
    const lines = ["<table>", "<thead><tr>"];
    for (const h of table.headers) {
      lines.push(`<th>${this._escapeHtml(String(h))}</th>`);
    }
    lines.push("</tr></thead><tbody>");
    for (const row of table.rows || []) {
      const cells = Array.isArray(row) ? row : Object.values(row);
      lines.push("<tr>");
      for (const c of cells) {
        lines.push(`<td>${this._escapeHtml(String(c))}</td>`);
      }
      lines.push("</tr>");
    }
    lines.push("</tbody></table>");
    return lines.join("\n");
  }

  _escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _escapeCSV(str) {
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getMultimodalOutput() {
  if (!instance) {
    instance = new MultimodalOutput();
  }
  return instance;
}

module.exports = {
  MultimodalOutput,
  getMultimodalOutput,
  OUTPUT_FORMAT,
};
