---
name: excel-analyzer
display-name: Excel Analyzer
description: Excel deep analysis - formula audit, data validation, pivot summaries
version: 1.0.0
category: document
user-invocable: true
tags: [excel, spreadsheet, analysis, formulas, data]
capabilities: [sheet-analysis, formula-audit, data-validation, pivot-summary]
supported-file-types: [xlsx, xls, csv]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
instructions: |
  Use this skill for deep analysis of Excel files: list sheets, analyze data types,
  audit formulas, validate data consistency, and generate pivot summaries.
examples:
  - input: "/excel-analyzer --analyze sales.xlsx"
    output: "Data analysis with column types, statistics, and quality metrics"
  - input: "/excel-analyzer --formulas budget.xlsx"
    output: "Formula audit: 45 formulas found, 2 errors detected"
author: ChainlessChain
---

# Excel Analyzer

Deep analysis of Excel spreadsheets including formula auditing, data validation, and pivot summaries.

## Usage

```
/excel-analyzer --analyze <file>                    Full data analysis
/excel-analyzer --sheets <file>                     List all sheets
/excel-analyzer --formulas <file>                   Audit all formulas
/excel-analyzer --validate <file>                   Data consistency check
/excel-analyzer --summary <file> [--sheet <name>]   Pivot summary
```

## Features

- **Sheet Overview**: Names, row/column counts, data ranges
- **Data Analysis**: Type distribution, null counts, unique values
- **Formula Audit**: Find all formulas, detect errors (#REF!, #N/A, circular refs)
- **Data Validation**: Type consistency, date format issues, outlier detection
- **Pivot Summary**: Group-by aggregation (sum, average, count)

## Dependencies

- `exceljs` — Excel file reading and analysis
