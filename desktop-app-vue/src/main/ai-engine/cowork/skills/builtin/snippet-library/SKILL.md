---
name: snippet-library
display-name: Snippet Library
description: 代码片段库（保存、搜索、分类、标签、语言检测、导入导出）
version: 1.0.0
category: development
user-invocable: true
tags: [snippet, code, library, save, search, reuse, template]
capabilities:
  [snippet_save, snippet_search, snippet_list, snippet_delete, snippet_export]
tools:
  - snippet_save
  - snippet_search
  - snippet_list
  - snippet_delete
instructions: |
  Use this skill to manage a personal code snippet library. Save, search, organize,
  and reuse code snippets with automatic language detection, tagging, and categorization.
  Snippets are stored as JSON in the project's .chainlesschain/ directory.
examples:
  - input: '/snippet-library --save --name "fetch-json" --lang js --tags api,http --code "const res = await fetch(url); return res.json();"'
    output: "Saved snippet 'fetch-json' (JavaScript, tags: api, http)"
  - input: "/snippet-library --search fetch"
    output: "2 snippets found: fetch-json (JS), fetch-data (Python)"
  - input: "/snippet-library --list --lang js"
    output: "5 JavaScript snippets"
  - input: "/snippet-library --get fetch-json"
    output: "const res = await fetch(url); return res.json();"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Snippet Library

代码片段管理技能。

## 功能

| 操作 | 命令                                                            | 说明         |
| ---- | --------------------------------------------------------------- | ------------ |
| 保存 | `--save --name "name" --code "code" --lang <lang> --tags t1,t2` | 保存代码片段 |
| 获取 | `--get <name>`                                                  | 获取指定片段 |
| 搜索 | `--search <query>`                                              | 搜索片段     |
| 列表 | `--list [--lang <lang>] [--tag <tag>]`                          | 列出片段     |
| 删除 | `--delete <name>`                                               | 删除片段     |
| 导出 | `--export --output <file>`                                      | 导出所有片段 |
| 导入 | `--import <file>`                                               | 导入片段     |
| 统计 | `--stats`                                                       | 片段统计     |
