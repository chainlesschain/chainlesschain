---
name: doc-generator
display-name: Doc Generator
description: 文档生成技能 - JSDoc/API文档/序列图/Changelog自动生成
version: 1.0.0
category: documentation
user-invocable: true
tags: [documentation, jsdoc, api-reference, mermaid, changelog, diagram]
capabilities:
  [
    jsdoc-generation,
    api-reference,
    sequence-diagram,
    changelog-generation,
    readme-generation,
  ]
tools:
  - file_reader
  - file_writer
  - code_analyzer
supported-file-types: [js, ts, py, java, kt, vue, jsx, tsx]
instructions: |
  Use this skill when the user needs to generate documentation from source code.
  This includes JSDoc/TSDoc comments, API reference docs, Mermaid sequence diagrams,
  changelog entries from git history, and README sections for modules. Analyze code
  structure, function signatures, and usage patterns to produce accurate documentation.
  For IPC handlers, scan ipcMain.handle() registrations to build a complete API reference.
examples:
  - input: "/doc-generator src/main/audit/"
    output: "Generated API documentation for enterprise-audit-logger.js, compliance-manager.js, data-subject-handler.js with JSDoc comments and module overview"
  - input: "/doc-generator --ipc-reference src/main/"
    output: "Complete IPC Handler Reference: 200+ handlers across 20 modules with parameters, return types, and usage"
  - input: "/doc-generator --changelog v0.35.0..HEAD"
    output: "Changelog for v0.36.0 with categorized entries (feat, fix, refactor) from 45 commits"
os: [win32, darwin, linux]
author: ChainlessChain
---

# 文档生成技能

## 描述

从源代码自动生成文档，包括 JSDoc/TSDoc 注释、IPC 处理器 API 参考、Mermaid 序列图、Git Changelog、模块 README 等。

## 使用方法

```
/doc-generator [目标路径] [选项]
```

## 文档类型

### JSDoc/TSDoc 注释生成

```
/doc-generator src/main/llm/session-manager.js --jsdoc
```

分析函数签名和实现逻辑，生成 JSDoc 注释:
- 参数类型和描述
- 返回值类型和描述
- @throws 异常说明
- @example 使用示例

### IPC 处理器参考文档

```
/doc-generator --ipc-reference src/main/
```

扫描所有 `ipcMain.handle()` 和 `ipcMain.on()` 注册，生成:
- 完整的 IPC 通道列表
- 每个处理器的参数和返回值
- 按模块分组的索引
- 调用示例

### 序列图生成

```
/doc-generator src/main/browser/computer-use-agent.js --sequence-diagram
```

从代码流程分析生成 Mermaid 序列图:
- 模块间调用关系
- 异步消息流
- 条件分支和循环

### Changelog 生成

```
/doc-generator --changelog v0.35.0..HEAD
```

从 Git 提交历史生成 Changelog:
- 解析 Conventional Commits (feat/fix/docs/refactor)
- 按类别分组
- 包含 PR 链接和作者
- Breaking Changes 高亮

### 模块 README

```
/doc-generator src/main/audit/ --readme
```

为目录生成 README.md:
- 模块概述和目的
- 文件清单和职责说明
- 公共 API 摘要
- 依赖关系
- 使用示例

## 输出格式

- `--format markdown` (默认) - Markdown 格式
- `--format html` - HTML 页面
- `--format jsdoc` - 内联 JSDoc 注释（直接插入源码）

## 示例

生成 JSDoc 注释:

```
/doc-generator src/main/utils/ --jsdoc
```

生成完整 IPC 参考:

```
/doc-generator --ipc-reference src/main/ --format markdown
```

生成序列图:

```
/doc-generator src/main/llm/ --sequence-diagram --format mermaid
```
