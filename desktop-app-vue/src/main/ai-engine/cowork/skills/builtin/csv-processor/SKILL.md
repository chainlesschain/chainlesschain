---
name: csv-processor
display-name: CSV Processor
description: CSV数据处理（读取、分析、转换、过滤、排序、统计、合并、导出）
version: 1.0.0
category: data
user-invocable: true
tags: [csv, data, analysis, filter, sort, statistics, convert, merge]
capabilities:
  [csv_read, csv_analyze, csv_filter, csv_sort, csv_convert, csv_merge]
tools:
  - csv_read
  - csv_analyze
  - csv_filter
  - csv_sort
  - csv_convert
instructions: |
  Use this skill to process and analyze CSV data files. Supports reading,
  statistical analysis, filtering, sorting, column selection, merging,
  and format conversion (CSV↔JSON↔TSV). Handles large files efficiently.
examples:
  - input: "/csv-processor --analyze sales.csv"
    output: "Rows: 1000, Columns: 8, numeric columns stats..."
  - input: '/csv-processor --filter data.csv --where "age>30" --output filtered.csv'
    output: "Filtered: 450 of 1000 rows match criteria"
  - input: "/csv-processor --sort users.csv --by name --order asc"
    output: "Sorted 500 rows by name ascending"
  - input: "/csv-processor --convert data.csv --to json"
    output: "Converted CSV to JSON (1000 records)"
  - input: "/csv-processor --head data.csv --rows 10"
    output: "First 10 rows of data.csv"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.csv, .tsv, .json]
---

# CSV Processor

CSV 数据处理技能。

## 功能

| 操作 | 命令                                      | 说明                                     |
| ---- | ----------------------------------------- | ---------------------------------------- | -------- | -------- |
| 读取 | `--read <file>`                           | 读取并显示CSV摘要                        |
| 预览 | `--head <file> --rows N`                  | 预览前N行                                |
| 分析 | `--analyze <file>`                        | 统计分析（行列数、类型、空值、数值统计） |
| 过滤 | `--filter <file> --where "col>val"`       | 按条件过滤行                             |
| 排序 | `--sort <file> --by <col> --order asc     | desc`                                    | 按列排序 |
| 转换 | `--convert <file> --to json               | tsv                                      | csv`     | 格式转换 |
| 合并 | `--merge <file1> <file2> --output <file>` | 合并两个CSV                              |
