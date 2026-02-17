---
name: regex-playground
display-name: Regex Playground
description: 正则表达式工具（测试、匹配、替换、解释、常用模式库、从自然语言生成）
version: 1.0.0
category: utility
user-invocable: true
tags: [regex, regexp, pattern, match, replace, test, validate]
capabilities:
  [regex_test, regex_replace, regex_explain, regex_library, regex_generate]
tools:
  - regex_test
  - regex_replace
  - regex_explain
  - regex_library
instructions: |
  Use this skill to work with regular expressions. Test patterns against text,
  perform find-and-replace, get explanations of complex regex, access a library
  of common patterns (email, URL, phone, IP, date, etc.), and extract matches from files.
examples:
  - input: "/regex-playground --test \"\\d{4}-\\d{2}-\\d{2}\" --text \"Today is 2026-02-17\""
    output: "1 match found: 2026-02-17 (position 9-19)"
  - input: '/regex-playground --replace "foo" --with "bar" --text "foo and foo"'
    output: "Result: bar and bar (2 replacements)"
  - input: "/regex-playground --library email"
    output: "Email pattern: ^[\\w.+-]+@[\\w-]+\\.[\\w.]+$"
  - input: "/regex-playground --explain \"^(?=.*[A-Z])(?=.*\\d).{8,}$\""
    output: "Password validation: at least 8 chars, 1 uppercase, 1 digit"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Regex Playground

正则表达式测试工具。

## 功能

| 操作     | 命令                                                           | 说明                  |
| -------- | -------------------------------------------------------------- | --------------------- |
| 测试     | `--test "<pattern>" --text "<text>"`                           | 测试正则匹配          |
| 测试文件 | `--test "<pattern>" --file <path>`                             | 在文件中搜索匹配      |
| 替换     | `--replace "<pattern>" --with "<replacement>" --text "<text>"` | 正则替换              |
| 解释     | `--explain "<pattern>"`                                        | 解释正则表达式        |
| 常用模式 | `--library [name]`                                             | 列出/搜索常用正则模式 |
| 提取     | `--extract "<pattern>" --file <path>`                          | 从文件提取所有匹配    |
