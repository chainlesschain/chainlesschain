---
name: markdown-enhancer
display-name: Markdown Enhancer
description: Markdown处理（目录生成、链接检查、表格格式化、统计、Lint、转HTML）
version: 1.0.0
category: documentation
user-invocable: true
tags: [markdown, toc, lint, format, table, link-check, html, documentation]
capabilities: [md_toc, md_lint, md_format, md_stats, md_links, md_to_html]
tools:
  - md_toc
  - md_lint
  - md_format
  - md_stats
  - md_links
instructions: |
  Use this skill to enhance and process Markdown files. Generate table of contents,
  check for broken links, format/lint Markdown, generate statistics (word count,
  headings, code blocks), format tables, and convert to HTML.
examples:
  - input: "/markdown-enhancer --toc README.md"
    output: "Generated TOC with 12 headings (3 H2, 5 H3, 4 H4)"
  - input: "/markdown-enhancer --stats document.md"
    output: "Words: 2,340, Headings: 8, Code blocks: 5, Links: 12"
  - input: "/markdown-enhancer --links README.md"
    output: "12 links found: 10 valid, 2 broken"
  - input: "/markdown-enhancer --lint document.md"
    output: "3 issues: missing alt text (2), trailing spaces (1)"
  - input: "/markdown-enhancer --to-html README.md"
    output: "Converted to HTML (saved as README.html)"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.md, .markdown, .mdx]
---

# Markdown Enhancer

Markdown 处理增强技能。

## 功能

| 操作     | 命令                     | 说明                          |
| -------- | ------------------------ | ----------------------------- |
| 目录     | `--toc <file>`           | 生成目录（Table of Contents） |
| 统计     | `--stats <file>`         | 文档统计信息                  |
| 链接检查 | `--links <file>`         | 检查链接有效性                |
| Lint     | `--lint <file>`          | Markdown语法检查              |
| 格式化   | `--format-tables <file>` | 格式化表格对齐                |
| 转HTML   | `--to-html <file>`       | 转换为HTML                    |
