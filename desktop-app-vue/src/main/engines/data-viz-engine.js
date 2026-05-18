/**
 * 数据可视化引擎
 * 负责将数据转换为可视化图表
 * 使用ECharts库实现
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");

class DataVizEngine {
  constructor() {
    // 图表类型配置
    this.chartTypes = {
      line: {
        name: "折线图",
        description: "适合展示趋势变化",
        requiresXAxis: true,
        requiresYAxis: true,
      },
      bar: {
        name: "柱状图",
        description: "适合比较数据大小",
        requiresXAxis: true,
        requiresYAxis: true,
      },
      pie: {
        name: "饼图",
        description: "适合展示占比",
        requiresXAxis: false,
        requiresYAxis: false,
      },
      scatter: {
        name: "散点图",
        description: "适合展示分布关系",
        requiresXAxis: true,
        requiresYAxis: true,
      },
      radar: {
        name: "雷达图",
        description: "适合多维度对比",
        requiresXAxis: false,
        requiresYAxis: false,
      },
      funnel: {
        name: "漏斗图",
        description: "适合展示流程转化",
        requiresXAxis: false,
        requiresYAxis: false,
      },
    };

    // 颜色主题
    this.colorThemes = {
      default: [
        "#5470c6",
        "#91cc75",
        "#fac858",
        "#ee6666",
        "#73c0de",
        "#3ba272",
        "#fc8452",
        "#9a60b4",
      ],
      business: ["#1E40AF", "#3B82F6", "#60A5FA", "#93C5FD", "#DBEAFE"],
      warm: ["#DC2626", "#F59E0B", "#FBBF24", "#FCD34D", "#FDE68A"],
      cool: ["#0EA5E9", "#06B6D4", "#10B981", "#34D399", "#6EE7B7"],
      purple: ["#7C3AED", "#A78BFA", "#C4B5FD", "#DDD6FE", "#EDE9FE"],
    };
  }

  /**
   * 生成图表配置
   * @param {Object} data - 数据
   * @param {Object} chartConfig - 图表配置
   * @returns {Promise<Object>} ECharts配置
   */
  async generateChartConfig(data, chartConfig = {}) {
    const {
      chartType = "bar",
      title = "数据图表",
      xAxisLabel = "X轴",
      yAxisLabel = "Y轴",
      theme = "default",
      showLegend = true,
      showGrid = true,
    } = chartConfig;

    logger.info("[Data Viz Engine] 生成图表配置:", chartType);

    try {
      // 处理数据
      const processedData = this.processData(data, chartConfig);

      // 获取颜色主题
      const colors = this.colorThemes[theme] || this.colorThemes.default;

      // 基础配置
      const option = {
        title: {
          text: title,
          left: "center",
          textStyle: {
            fontSize: 18,
            fontWeight: "bold",
          },
        },
        color: colors,
        tooltip: {
          trigger: chartType === "pie" ? "item" : "axis",
          axisPointer: {
            type: chartType === "line" ? "cross" : "shadow",
          },
        },
        legend: showLegend
          ? {
              top: "bottom",
              data: processedData.seriesNames || [],
            }
          : undefined,
        grid:
          showGrid && (chartType === "line" || chartType === "bar")
            ? {
                left: "3%",
                right: "4%",
                bottom: "3%",
                containLabel: true,
              }
            : undefined,
      };

      // 根据图表类型添加特定配置
      switch (chartType) {
        case "line":
        case "bar":
          option.xAxis = {
            type: "category",
            data: processedData.categories,
            name: xAxisLabel,
            axisLabel: {
              interval: 0,
              rotate: processedData.categories.length > 10 ? 45 : 0,
            },
          };
          option.yAxis = {
            type: "value",
            name: yAxisLabel,
          };
          option.series = processedData.series.map((s, index) => ({
            name: s.name,
            type: chartType,
            data: s.data,
            smooth: chartType === "line",
            label: {
              show: true,
              position: chartType === "bar" ? "top" : "top",
            },
          }));
          break;

        case "pie":
          option.series = [
            {
              name: title,
              type: "pie",
              radius: "60%",
              data: processedData.pieData,
              emphasis: {
                itemStyle: {
                  shadowBlur: 10,
                  shadowOffsetX: 0,
                  shadowColor: "rgba(0, 0, 0, 0.5)",
                },
              },
              label: {
                formatter: "{b}: {c} ({d}%)",
              },
            },
          ];
          break;

        case "scatter":
          option.xAxis = {
            type: "value",
            name: xAxisLabel,
          };
          option.yAxis = {
            type: "value",
            name: yAxisLabel,
          };
          option.series = [
            {
              type: "scatter",
              data: processedData.scatterData,
              symbolSize: 10,
            },
          ];
          break;

        case "radar":
          option.radar = {
            indicator: processedData.radarIndicator,
          };
          option.series = [
            {
              type: "radar",
              data: processedData.radarData,
            },
          ];
          break;

        case "funnel":
          option.series = [
            {
              type: "funnel",
              data: processedData.funnelData,
              label: {
                show: true,
                position: "inside",
              },
            },
          ];
          break;
      }

      return option;
    } catch (error) {
      logger.error("[Data Viz Engine] 生成图表配置失败:", error);
      throw error;
    }
  }

  /**
   * 处理数据
   * @param {Array|Object} data - 原始数据
   * @param {Object} config - 配置
   * @returns {Object} 处理后的数据
   */
  processData(data, config) {
    const { chartType, dataMapping = {} } = config;

    // 如果数据是数组
    if (Array.isArray(data)) {
      switch (chartType) {
        case "line":
        case "bar":
          return this.processSeriesData(data, dataMapping);

        case "pie":
          return this.processPieData(data, dataMapping);

        case "scatter":
          return this.processScatterData(data, dataMapping);

        case "radar":
          return this.processRadarData(data, dataMapping);

        case "funnel":
          return this.processFunnelData(data, dataMapping);

        default:
          return this.processSeriesData(data, dataMapping);
      }
    }

    // 如果数据是对象
    if (typeof data === "object") {
      return {
        categories: Object.keys(data),
        series: [
          {
            name: "数据",
            data: Object.values(data),
          },
        ],
        seriesNames: ["数据"],
      };
    }

    throw new Error("不支持的数据格式");
  }

  /**
   * 处理系列数据（折线图、柱状图）
   */
  processSeriesData(data, dataMapping) {
    const { xField = "name", yField = "value", seriesField } = dataMapping;

    const categories = [];
    const seriesMap = {};

    for (const item of data) {
      const category = item[xField];
      const value = item[yField];

      if (!categories.includes(category)) {
        categories.push(category);
      }

      if (seriesField && item[seriesField]) {
        const seriesName = item[seriesField];
        if (!seriesMap[seriesName]) {
          seriesMap[seriesName] = [];
        }
        seriesMap[seriesName].push(value);
      } else {
        if (!seriesMap["数据"]) {
          seriesMap["数据"] = [];
        }
        seriesMap["数据"].push(value);
      }
    }

    const series = Object.keys(seriesMap).map((name) => ({
      name,
      data: seriesMap[name],
    }));

    return {
      categories,
      series,
      seriesNames: Object.keys(seriesMap),
    };
  }

  /**
   * 处理饼图数据
   */
  processPieData(data, dataMapping) {
    const { nameField = "name", valueField = "value" } = dataMapping;

    const pieData = data.map((item) => ({
      name: item[nameField],
      value: item[valueField],
    }));

    return { pieData };
  }

  /**
   * 处理散点图数据
   */
  processScatterData(data, dataMapping) {
    const { xField = "x", yField = "y" } = dataMapping;

    const scatterData = data.map((item) => [item[xField], item[yField]]);

    return { scatterData };
  }

  /**
   * 处理雷达图数据
   */
  processRadarData(data, dataMapping) {
    const {
      nameField = "name",
      valueField = "value",
      indicatorField = "indicator",
    } = dataMapping;

    // 提取指标
    const indicators = Array.from(
      new Set(data.map((item) => item[indicatorField])),
    );
    const radarIndicator = indicators.map((ind) => ({ name: ind, max: 100 }));

    // 按名称分组
    const radarMap = {};
    for (const item of data) {
      const name = item[nameField];
      if (!radarMap[name]) {
        radarMap[name] = {};
      }
      radarMap[name][item[indicatorField]] = item[valueField];
    }

    // 转换为雷达图数据格式
    const radarData = Object.keys(radarMap).map((name) => ({
      name,
      value: indicators.map((ind) => radarMap[name][ind] || 0),
    }));

    return { radarIndicator, radarData };
  }

  /**
   * 处理漏斗图数据
   */
  processFunnelData(data, dataMapping) {
    const { nameField = "name", valueField = "value" } = dataMapping;

    const funnelData = data.map((item) => ({
      name: item[nameField],
      value: item[valueField],
    }));

    // 按值降序排序
    funnelData.sort((a, b) => b.value - a.value);

    return { funnelData };
  }

  /**
   * 生成图表HTML文件
   * @param {Object} chartOption - ECharts配置
   * @param {string} outputPath - 输出路径
   * @returns {Promise<Object>} 生成结果
   */
  async generateChartHTML(chartOption, outputPath) {
    logger.info("[Data Viz Engine] 生成图表HTML:", outputPath);

    try {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${chartOption.title?.text || "数据图表"}</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
    }
    #chart {
      width: 100%;
      height: 600px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      color: #333;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="chart"></div>
  </div>
  <script>
    const chartDom = document.getElementById('chart');
    const myChart = echarts.init(chartDom);
    const option = ${JSON.stringify(chartOption, null, 2)};
    myChart.setOption(option);

    // 响应式调整
    window.addEventListener('resize', () => {
      myChart.resize();
    });
  </script>
</body>
</html>`;

      await fs.writeFile(outputPath, html, "utf-8");

      return {
        success: true,
        path: outputPath,
      };
    } catch (error) {
      logger.error("[Data Viz Engine] 生成图表HTML失败:", error);
      throw error;
    }
  }

  /**
   * 从CSV数据生成图表
   * @param {string} csvPath - CSV文件路径
   * @param {Object} chartConfig - 图表配置
   * @returns {Promise<Object>} 生成结果
   */
  async generateChartFromCSV(csvPath, chartConfig) {
    logger.info("[Data Viz Engine] 从CSV生成图表:", csvPath);

    try {
      // 读取CSV文件
      const csvContent = await fs.readFile(csvPath, "utf-8");

      // 解析CSV
      const data = this.parseCSV(csvContent);

      // 生成图表配置
      const chartOption = await this.generateChartConfig(data, chartConfig);

      // 生成HTML文件
      const outputPath = csvPath.replace(/\.csv$/, "_chart.html");
      await this.generateChartHTML(chartOption, outputPath);

      return {
        success: true,
        path: outputPath,
        chartOption,
      };
    } catch (error) {
      logger.error("[Data Viz Engine] 从CSV生成图表失败:", error);
      throw error;
    }
  }

  /**
   * 解析CSV
   * @param {string} csvContent - CSV内容
   * @returns {Array} 数据数组
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const row = {};

      headers.forEach((header, index) => {
        // 尝试转换为数字
        const value = values[index];
        row[header] = isNaN(value) ? value : parseFloat(value);
      });

      data.push(row);
    }

    return data;
  }

  /**
   * 获取图表类型列表
   */
  getChartTypes() {
    return this.chartTypes;
  }

  /**
   * 获取颜色主题列表
   */
  getColorThemes() {
    return this.colorThemes;
  }
}

module.exports = DataVizEngine;
