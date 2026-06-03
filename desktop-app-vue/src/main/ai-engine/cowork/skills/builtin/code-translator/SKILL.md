---
name: code-translator
display-name: Code Translator
description: 跨语言代码转换 - 支持JS↔TS、Python↔JS等主流语言间的智能代码翻译
version: 1.0.0
category: development
user-invocable: true
tags: [translate, convert, language, migration, typescript]
capabilities: [language-detection, syntax-mapping, framework-mapping]
tools:
  - file_reader
  - file_writer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to translate code between programming languages. For --translate mode,
  read the source file, detect its language, apply syntax mapping rules, and output the
  translated code. For --detect mode, identify the language and framework of a file.
  For --preview mode, show the translation plan without writing. Supported translations:
  JS→TS (add types), TS→JS (strip types), Python→JS, JS→Python, Vue→React (basic).
examples:
  - input: "/code-translator --translate src/utils/helpers.js --to typescript"
    output: "Translated helpers.js → helpers.ts: added 12 type annotations, 3 interfaces, 2 enum types. Output: src/utils/helpers.ts"
  - input: "/code-translator --detect src/main/database.js"
    output: "Language: JavaScript (CommonJS). Framework: Node.js + better-sqlite3. Features: async/await, destructuring, template literals."
  - input: "/code-translator --preview src/api.py --to javascript"
    output: "Translation plan: 15 functions, 3 classes. Mappings: def→function, dict→object, list→array, f-string→template literal. Untranslatable: 2 (numpy operations)."
input-schema:
  type: object
  properties:
    file:
      type: string
      description: Source file path
    targetLang:
      type: string
      enum: [typescript, javascript, python]
      description: Target language
output-schema:
  type: object
  properties:
    sourceLanguage: { type: string }
    targetLanguage: { type: string }
    translatedCode: { type: string }
    mappings: { type: array }
    untranslatable: { type: array }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Code Translator 技能

## 描述

跨语言代码转换工具，支持 JavaScript、TypeScript、Python 之间的智能翻译。自动检测源语言，应用语法映射规则，处理框架差异。

## 使用方法

```
/code-translator [选项]
```

## 支持的转换

| 源语言 | 目标语言 | 映射规则                  |
| ------ | -------- | ------------------------- |
| JS     | TS       | 添加类型注解、接口定义    |
| TS     | JS       | 移除类型、转换枚举        |
| Python | JS       | 缩进→花括号、def→function |
| JS     | Python   | 花括号→缩进、function→def |

## 示例

### JS → TypeScript

```javascript
// 输入
function add(a, b) { return a + b; }
// 输出
function add(a: number, b: number): number { return a + b; }
```
