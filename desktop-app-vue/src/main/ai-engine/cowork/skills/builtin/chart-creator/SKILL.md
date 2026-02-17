---
name: chart-creator
display-name: Chart Creator
description: 数据可视化图表生成（折线图、柱状图、饼图、散点图、雷达图、漏斗图）
version: 1.0.0
category: data
user-invocable: true
tags: [chart, visualization, echarts, data-viz, graph, plot]
capabilities: [chart_create, chart_from_csv, chart_types, chart_themes]
tools:
  - chart_create
  - chart_from_data
  - chart_list_types
instructions: |
  Use this skill to create data visualization charts. Generates ECharts configuration
  JSON that can be rendered in the frontend. Supports line, bar, pie, scatter, radar,
  and funnel charts. Can read data from CSV files or accept inline data.
examples:
  - input: '/chart-creator --type bar --data "Q1:100,Q2:150,Q3:200,Q4:180" --title "Quarterly Sales"'
    output: "Generated bar chart configuration with 4 data points"
  - input: "/chart-creator --from-csv sales.csv --type line --x date --y revenue"
    output: "Generated line chart from CSV with 365 data points"
  - input: "/chart-creator --types"
    output: "Available: line, bar, pie, scatter, radar, funnel"
  - input: '/chart-creator --type pie --data "Chrome:63,Firefox:19,Safari:13,Other:5" --theme dark'
    output: "Generated pie chart with dark theme"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.csv, .json, .tsv]
---

# Chart Creator

数据可视化图表生成技能，基于 ECharts。

## 图表类型

| 类型    | 名称   | 适用场景 |
| ------- | ------ | -------- |
| line    | 折线图 | 趋势变化 |
| bar     | 柱状图 | 数据对比 |
| pie     | 饼图   | 占比分析 |
| scatter | 散点图 | 分布关系 |
| radar   | 雷达图 | 多维对比 |
| funnel  | 漏斗图 | 流程转化 |

## 主题

支持 `default`, `dark`, `vintage`, `macarons` 四种配色主题。
