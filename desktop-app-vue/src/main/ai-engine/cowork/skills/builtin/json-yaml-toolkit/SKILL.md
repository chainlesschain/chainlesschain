---
name: json-yaml-toolkit
display-name: JSON/YAML Toolkit
description: JSON/YAML/TOML数据处理（解析、验证、格式化、转换、查询、比较、Schema生成）
version: 1.0.0
category: utility
user-invocable: true
tags: [json, yaml, toml, format, validate, convert, query, jsonpath, schema]
capabilities:
  [json_format, json_validate, json_convert, json_query, json_diff, json_schema]
tools:
  - json_format
  - json_validate
  - json_convert
  - json_query
  - json_diff
instructions: |
  Use this skill to process JSON, YAML, and TOML data. Supports parsing, validation,
  formatting (prettify/minify), format conversion (JSON↔YAML↔TOML), JSONPath queries,
  document comparison (diff), and JSON Schema generation from data samples.
examples:
  - input: "/json-yaml-toolkit --format data.json"
    output: "Formatted JSON with 2-space indentation"
  - input: "/json-yaml-toolkit --convert config.yaml --to json"
    output: "Converted YAML to JSON (saved as config.json)"
  - input: "/json-yaml-toolkit --validate data.json --schema schema.json"
    output: "Valid: all 5 checks passed"
  - input: '/json-yaml-toolkit --query data.json --path "$.users[*].name"'
    output: 'Query results: ["Alice", "Bob", "Charlie"]'
  - input: "/json-yaml-toolkit --diff a.json b.json"
    output: "3 differences found: 2 changed, 1 added"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.json, .yaml, .yml, .toml]
---

# JSON/YAML Toolkit

JSON/YAML/TOML 数据处理工具。

## 功能

| 操作       | 命令                                     | 说明                    |
| ---------- | ---------------------------------------- | ----------------------- |
| 格式化     | `--format <file>`                        | 格式化（美化）JSON/YAML |
| 压缩       | `--minify <file>`                        | 压缩JSON为单行          |
| 验证       | `--validate <file>`                      | 验证JSON/YAML语法       |
| 验证Schema | `--validate <file> --schema <schema>`    | 验证JSON Schema         |
| 转换       | `--convert <file> --to json\|yaml\|toml` | 格式转换                |
| 查询       | `--query <file> --path "<jsonpath>"`     | JSONPath查询            |
| 比较       | `--diff <file1> <file2>`                 | 比较两个文件差异        |
| Schema     | `--gen-schema <file>`                    | 从数据生成JSON Schema   |
