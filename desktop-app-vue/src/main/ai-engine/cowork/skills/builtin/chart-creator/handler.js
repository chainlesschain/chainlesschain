/**
 * Chart Creator Skill Handler
 *
 * Generates ECharts configuration JSON for data visualization.
 * Supports line, bar, pie, scatter, radar, and funnel charts.
 * Accepts inline key:value data or reads from CSV/JSON/TSV files.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Chart type definitions ──────────────────────────────────────────

const CHART_TYPES = {
  line: { name: "折线图", description: "适合展示趋势变化" },
  bar: { name: "柱状图", description: "适合比较数据大小" },
  pie: { name: "饼图", description: "适合展示占比" },
  scatter: { name: "散点图", description: "适合展示分布关系" },
  radar: { name: "雷达图", description: "适合多维度对比" },
  funnel: { name: "漏斗图", description: "适合展示流程转化" },
};

// ── Color themes ────────────────────────────────────────────────────

const COLOR_THEMES = {
  default: ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272"],
  dark: ["#dd6b66", "#759aa0", "#e69d87", "#8dc1a9", "#ea7e53", "#eedd78"],
  vintage: ["#d87c7c", "#919e8b", "#d7ab82", "#6e7074", "#61a0a8", "#efa18d"],
  macarons: ["#2ec7c9", "#b6a2de", "#5ab1ef", "#ffb980", "#d87a80", "#8d98b3"],
};

// ── CSV parser ──────────────────────────────────────────────────────

function parseCSV(content, delimiter = ",") {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line
      .split(delimiter)
      .map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

function detectDelimiter(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsv") {
    return "\t";
  }
  return ",";
}

// ── Inline data parser ──────────────────────────────────────────────

function parseInlineData(dataStr) {
  const pairs = dataStr
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const result = [];
  for (const pair of pairs) {
    const sepIndex = pair.lastIndexOf(":");
    if (sepIndex <= 0) {
      continue;
    }
    const key = pair.substring(0, sepIndex).trim();
    const val = Number(pair.substring(sepIndex + 1).trim());
    if (key && !isNaN(val)) {
      result.push({ name: key, value: val });
    }
  }
  return result;
}

// ── ECharts option generators ───────────────────────────────────────

function buildBaseOption(title, theme) {
  const colors = COLOR_THEMES[theme] || COLOR_THEMES.default;
  const option = {
    color: colors,
    tooltip: { trigger: "axis" },
  };
  if (title) {
    option.title = { text: title, left: "center" };
  }
  return option;
}

function generateLineOrBar(type, categories, values, title, theme) {
  const option = buildBaseOption(title, theme);
  option.xAxis = { type: "category", data: categories };
  option.yAxis = { type: "value" };
  option.grid = { left: "10%", right: "10%", bottom: "15%" };
  option.legend = { show: false };
  option.series = [
    {
      type,
      data: values,
      smooth: type === "line",
    },
  ];
  return option;
}

function generatePie(data, title, theme) {
  const option = buildBaseOption(title, theme);
  option.tooltip = { trigger: "item", formatter: "{b}: {c} ({d}%)" };
  option.legend = {
    orient: "vertical",
    left: "left",
    data: data.map((d) => d.name),
  };
  option.series = [
    {
      type: "pie",
      radius: "55%",
      center: ["50%", "55%"],
      data,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: "rgba(0,0,0,0.5)",
        },
      },
    },
  ];
  return option;
}

function generateScatter(data, title, theme) {
  const option = buildBaseOption(title, theme);
  option.xAxis = { type: "value" };
  option.yAxis = { type: "value" };
  option.grid = { left: "10%", right: "10%", bottom: "15%" };
  option.series = [
    {
      type: "scatter",
      data: data.map((d) => [d.name, d.value]),
      symbolSize: 10,
    },
  ];
  return option;
}

function generateRadar(data, title, theme) {
  const maxVal = Math.max(...data.map((d) => d.value));
  const ceilMax = Math.ceil(maxVal * 1.2);
  const option = buildBaseOption(title, theme);
  option.tooltip = {};
  option.radar = {
    indicator: data.map((d) => ({ name: d.name, max: ceilMax })),
  };
  option.series = [
    {
      type: "radar",
      data: [
        {
          value: data.map((d) => d.value),
          name: title || "Data",
        },
      ],
    },
  ];
  return option;
}

function generateFunnel(data, title, theme) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const option = buildBaseOption(title, theme);
  option.tooltip = { trigger: "item", formatter: "{b}: {c}" };
  option.legend = {
    data: sorted.map((d) => d.name),
    left: "left",
  };
  option.series = [
    {
      type: "funnel",
      left: "15%",
      width: "70%",
      sort: "descending",
      gap: 2,
      data: sorted,
    },
  ];
  return option;
}

function generateChart(type, data, title, theme) {
  const categories = data.map((d) => d.name);
  const values = data.map((d) => d.value);

  switch (type) {
    case "line":
      return generateLineOrBar("line", categories, values, title, theme);
    case "bar":
      return generateLineOrBar("bar", categories, values, title, theme);
    case "pie":
      return generatePie(data, title, theme);
    case "scatter":
      return generateScatter(data, title, theme);
    case "radar":
      return generateRadar(data, title, theme);
    case "funnel":
      return generateFunnel(data, title, theme);
    default:
      return generateLineOrBar("bar", categories, values, title, theme);
  }
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[chart-creator] handler initialized for "${skill?.name || "chart-creator"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    // ── --types: list available chart types ──────────────────────────
    if (/--types\b/.test(input)) {
      const typeList = Object.entries(CHART_TYPES)
        .map(([key, info]) => `  ${key} - ${info.name}: ${info.description}`)
        .join("\n");
      return {
        success: true,
        result: { chartTypes: CHART_TYPES },
        message: "Available chart types:\n" + typeList,
      };
    }

    // ── --themes: list available color themes ───────────────────────
    if (/--themes\b/.test(input)) {
      const themeList = Object.entries(COLOR_THEMES)
        .map(([name, colors]) => `  ${name}: ${colors.join(", ")}`)
        .join("\n");
      return {
        success: true,
        result: { themes: COLOR_THEMES },
        message: "Available color themes:\n" + themeList,
      };
    }

    // ── Parse common options ────────────────────────────────────────
    const typeMatch = input.match(/--type\s+(\S+)/i);
    const titleMatch =
      input.match(/--title\s+"([^"]+)"/i) || input.match(/--title\s+(\S+)/i);
    const themeMatch = input.match(/--theme\s+(\S+)/i);
    const dataMatch =
      input.match(/--data\s+"([^"]+)"/i) || input.match(/--data\s+(\S+)/i);
    const csvMatch = input.match(/--from-csv\s+(\S+)/i);
    const xColMatch = input.match(/--x\s+(\S+)/i);
    const yColMatch = input.match(/--y\s+(\S+)/i);

    const chartType = typeMatch ? typeMatch[1].toLowerCase() : "bar";
    const title = titleMatch ? titleMatch[1] : "";
    const theme = themeMatch ? themeMatch[1].toLowerCase() : "default";

    if (!CHART_TYPES[chartType]) {
      return {
        success: false,
        error: "Unknown chart type: " + chartType,
        message:
          "Unknown chart type: " +
          chartType +
          ". Available: " +
          Object.keys(CHART_TYPES).join(", "),
      };
    }

    if (!COLOR_THEMES[theme]) {
      return {
        success: false,
        error: "Unknown theme: " + theme,
        message:
          "Unknown theme: " +
          theme +
          ". Available: " +
          Object.keys(COLOR_THEMES).join(", "),
      };
    }

    try {
      let data = [];

      // ── --from-csv: read data from CSV file ─────────────────────
      if (csvMatch) {
        let filePath = csvMatch[1];
        if (!path.isAbsolute(filePath)) {
          filePath = path.resolve(projectRoot, filePath);
        }
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: "CSV file not found: " + filePath,
          };
        }

        const content = fs.readFileSync(filePath, "utf-8");
        const ext = path.extname(filePath).toLowerCase();
        let parsed;
        if (ext === ".json") {
          const json = JSON.parse(content);
          const arr = Array.isArray(json) ? json : [json];
          parsed = {
            headers: arr.length > 0 ? Object.keys(arr[0]) : [],
            rows: arr,
          };
        } else {
          const delimiter = detectDelimiter(filePath);
          parsed = parseCSV(content, delimiter);
        }

        const { headers, rows } = parsed;
        if (rows.length === 0) {
          return {
            success: false,
            error: "Empty data",
            message: "No data rows found in: " + path.basename(filePath),
          };
        }

        const xCol = xColMatch ? xColMatch[1] : headers[0];
        const yCol = yColMatch ? yColMatch[1] : headers[1];

        if (!headers.includes(xCol)) {
          return {
            success: false,
            error: "Column not found: " + xCol,
            message:
              "Column '" +
              xCol +
              "' not found. Available: " +
              headers.join(", "),
          };
        }
        if (!headers.includes(yCol)) {
          return {
            success: false,
            error: "Column not found: " + yCol,
            message:
              "Column '" +
              yCol +
              "' not found. Available: " +
              headers.join(", "),
          };
        }

        data = rows
          .map((row) => ({
            name: String(row[xCol] || ""),
            value: Number(row[yCol]) || 0,
          }))
          .filter((d) => d.name);

        if (data.length === 0) {
          return {
            success: false,
            error: "No valid data points",
            message:
              "Could not extract valid data from columns: " +
              xCol +
              ", " +
              yCol,
          };
        }
      }
      // ── --data: inline key:value pairs ──────────────────────────
      else if (dataMatch) {
        data = parseInlineData(dataMatch[1]);
        if (data.length === 0) {
          return {
            success: false,
            error: "Invalid data format",
            message:
              'Could not parse inline data. Expected format: "key1:val1,key2:val2,..."',
          };
        }
      }
      // ── No data provided: show usage ──────────────────────────
      else {
        return {
          success: true,
          result: {
            chartTypes: CHART_TYPES,
            themes: Object.keys(COLOR_THEMES),
          },
          message: [
            "## Chart Creator Usage",
            "",
            "**Create from inline data:**",
            '`/chart-creator --type bar --data "Q1:100,Q2:150,Q3:200" --title "Sales"`',
            "",
            "**Create from CSV file:**",
            "`/chart-creator --from-csv data.csv --type line --x date --y revenue`",
            "",
            "**List types:** `/chart-creator --types`",
            "**List themes:** `/chart-creator --themes`",
            "",
            "**Options:** `--type`, `--data`, `--from-csv`, `--x`, `--y`, `--title`, `--theme`",
          ].join("\n"),
        };
      }

      // ── Generate ECharts option ─────────────────────────────────
      const echartsOption = generateChart(chartType, data, title, theme);

      const typeInfo = CHART_TYPES[chartType];
      const message = [
        "## Chart Created: " + typeInfo.name + " (" + chartType + ")",
        "",
        "- **Data points:** " + data.length,
        "- **Theme:** " + theme,
        title ? "- **Title:** " + title : "",
        "",
        "```json",
        JSON.stringify(echartsOption, null, 2),
        "```",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        success: true,
        result: {
          chartType,
          theme,
          dataPoints: data.length,
          data,
          echartsOption,
        },
        message,
      };
    } catch (err) {
      logger.error("[chart-creator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Chart creation failed: " + err.message,
      };
    }
  },
};
