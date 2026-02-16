---
name: data-analysis
display-name: Data Analysis
description: 数据分析技能 - CSV/JSON处理、统计分析、图表生成建议
version: 1.0.0
category: data
user-invocable: true
tags: [data, analysis, csv, json, statistics, visualization, echarts]
capabilities:
  [data-loading, data-cleaning, statistical-analysis, chart-recommendation]
tools:
  - file_reader
  - code_analyzer
  - data_processor
supported-file-types: [csv, json, tsv, xlsx]
instructions: |
  Use this skill when the user needs to analyze data files. Load and parse
  CSV/JSON/TSV files, compute descriptive statistics, detect anomalies,
  and recommend ECharts visualizations. Support column selection and grouping.
examples:
  - input: "/data-analysis data/sales.csv"
    output: "Data overview with row/column counts, descriptive stats, and chart recommendations"
  - input: "/data-analysis data/users.json --columns age,income --output detailed"
    output: "Detailed statistical analysis of specified columns with correlations"
  - input: "/data-analysis data/orders.csv --group-by category"
    output: "Grouped statistics by category with comparison charts"
os: [win32, darwin, linux]
author: ChainlessChain
---

# 数据分析技能

## 描述

提供数据分析能力，包括CSV和JSON文件处理、统计分析、数据清洗和可视化建议。适用于快速数据探索和报告生成。

## 使用方法

```
/data-analysis [文件路径] [选项]
```

## 选项

- `--format <type>` - 输入格式: csv, json, tsv (默认: 自动检测)
- `--output <type>` - 输出格式: summary, detailed, chart (默认: summary)
- `--columns <cols>` - 指定分析的列（逗号分隔）
- `--group-by <col>` - 按指定列分组统计

## 执行步骤

1. **数据加载**: 读取并解析数据文件，自动检测格式和编码
2. **数据清洗**: 识别并处理缺失值、异常值、重复记录和数据类型不一致
3. **统计分析**: 计算描述性统计量（均值、中位数、标准差、分位数、相关性）
4. **可视化建议**: 根据数据特征推荐合适的图表类型和ECharts配置

## 统计指标

| 指标        | 说明              |
| ----------- | ----------------- |
| count       | 非空记录数        |
| mean        | 算术平均值        |
| std         | 标准差            |
| min/max     | 最小值/最大值     |
| quartiles   | 25%/50%/75%分位数 |
| correlation | 列间相关系数      |

## 输出格式

- 数据概览: 行数、列数、数据类型分布
- 统计摘要: 数值列的描述性统计
- 数据质量: 缺失值比例、异常值检测结果
- 可视化建议: 推荐图表类型和对应的ECharts配置代码

## 示例

分析CSV文件:

```
/data-analysis data/sales.csv
```

指定列的详细分析:

```
/data-analysis data/users.json --columns age,income --output detailed
```

按分类分组统计:

```
/data-analysis data/orders.csv --group-by category
```
