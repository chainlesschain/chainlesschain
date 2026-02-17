---
name: data-exporter
display-name: Data Exporter
description: Multi-format data export and conversion between JSON, CSV, Markdown, HTML, TSV, and TXT
version: 1.0.0
category: data
user-invocable: true
tags: [export, convert, json, csv, markdown, html, data, format]
capabilities:
  [
    format-detection,
    json-csv-conversion,
    markdown-table,
    html-table,
    batch-convert,
  ]
tools:
  - file_reader
  - data_processor
instructions: |
  Use this skill to convert data between formats. Supports JSON, CSV, TSV,
  Markdown table, HTML table, and plain text. Detects source format automatically
  and converts to the target format. Handles JSON arrays to CSV with auto header
  detection, CSV to JSON, JSON to Markdown table, and JSON to styled HTML table.
  Batch mode converts all supported files in a directory.
examples:
  - input: "/data-exporter --export data/users.json --to csv"
    output: "Exported users.json to CSV (50 records, 6 columns) -> users.csv"
  - input: "/data-exporter --json-to-md data/products.json --output products.md"
    output: "Converted JSON array (120 items) to Markdown table with 8 columns"
  - input: "/data-exporter --csv-to-json sales.csv"
    output: "Converted CSV (1000 rows) to JSON array -> sales.json"
  - input: "/data-exporter --detect data/report.csv"
    output: "Format: CSV, Rows: 500, Columns: 12, Types: {name: string, age: numeric, ...}"
  - input: "/data-exporter --batch data/ --to md"
    output: "Batch converted 5 files to Markdown: users.md, orders.md, ..."
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.json, .csv, .md, .html, .txt, .tsv]
---

# Data Exporter

Multi-format data export and conversion skill.

## Features

| Action        | Command                                              | Description                         |
| ------------- | ---------------------------------------------------- | ----------------------------------- |
| Export        | `--export <file> --to json\|csv\|md\|html\|tsv\|txt` | Convert data between formats        |
| JSON to CSV   | `--json-to-csv <file> [--output <file>]`             | JSON array to CSV with auto headers |
| CSV to JSON   | `--csv-to-json <file> [--output <file>]`             | CSV to JSON array                   |
| JSON to MD    | `--json-to-md <file> [--output <file>]`              | JSON array to Markdown table        |
| JSON to HTML  | `--json-to-html <file> [--output <file>]`            | JSON array to HTML table with CSS   |
| Detect        | `--detect <file>`                                    | Detect data format and structure    |
| Batch Convert | `--batch <dir> --to <format> [--output <dir>]`       | Batch convert all supported files   |

## Usage

```
/data-exporter --export data/users.json --to csv
/data-exporter --json-to-csv data/records.json --output records.csv
/data-exporter --csv-to-json data/sales.csv
/data-exporter --json-to-md data/products.json
/data-exporter --json-to-html data/report.json --output report.html
/data-exporter --detect data/unknown-file.csv
/data-exporter --batch data/ --to md --output output/
```

## Supported Formats

| Format   | Extension | Read | Write |
| -------- | --------- | ---- | ----- |
| JSON     | .json     | Yes  | Yes   |
| CSV      | .csv      | Yes  | Yes   |
| TSV      | .tsv      | Yes  | Yes   |
| Markdown | .md       | No   | Yes   |
| HTML     | .html     | No   | Yes   |
| Text     | .txt      | No   | Yes   |
