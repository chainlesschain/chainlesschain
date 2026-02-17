---
name: i18n-manager
display-name: i18n Manager
description: 国际化管理 - 字符串提取、翻译缺失检测、Locale文件生成和覆盖率统计
version: 1.0.0
category: development
user-invocable: true
tags: [i18n, internationalization, locale, translation, l10n]
capabilities: [string-extraction, translation-check, locale-generation]
tools:
  - file_reader
  - file_writer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to manage internationalization. For --extract mode, scan Vue/JS/TS files
  for hardcoded Chinese and English strings that should be internationalized. For --check mode,
  compare locale files to find missing translation keys. For --add-locale mode, generate a
  new locale file from an existing one. For --stats mode, show translation coverage statistics.
  Support Vue i18n ($t, t()) and i18next patterns.
examples:
  - input: "/i18n-manager --extract"
    output: "Found 42 hardcoded strings in 15 files: 28 Chinese, 14 English. Top files: LoginPage.vue (8), DashboardPage.vue (6)."
  - input: "/i18n-manager --check"
    output: "Locale coverage: en=100%, zh-CN=92%, ja=0%. Missing in zh-CN: 8 keys (settings.theme, settings.language, ...)."
  - input: "/i18n-manager --add-locale ja"
    output: "Generated ja.json with 120 keys. All values marked as [TODO:translate] for manual translation."
  - input: "/i18n-manager --stats"
    output: "Total keys: 120. Locales: en (120/120, 100%), zh-CN (110/120, 92%). Untranslated: 10 keys."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [extract, check, add-locale, stats]
      description: i18n mode
    locale:
      type: string
      description: Locale code for add-locale mode
output-schema:
  type: object
  properties:
    strings: { type: array }
    coverage: { type: object }
    missingKeys: { type: array }
model-hints:
  preferred: [claude-sonnet-4-5-20250929]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# i18n Manager 技能

## 描述

国际化管理工具，帮助扫描硬编码字符串、检测翻译缺失、生成 Locale 文件和统计覆盖率。支持 Vue i18n 和 i18next 模式。

## 使用方法

```
/i18n-manager [选项]
```

## 功能

### 字符串提取 (--extract)

扫描 Vue/JS/TS 文件中的硬编码中文和英文字符串

### 翻译检查 (--check)

对比 locale 文件，找出缺失的翻译 key

### 新增 Locale (--add-locale)

从现有 locale 文件生成新语言的模板

### 统计 (--stats)

显示翻译覆盖率统计
