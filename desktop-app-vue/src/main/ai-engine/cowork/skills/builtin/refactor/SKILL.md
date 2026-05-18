---
name: refactor
display-name: Code Refactor
description: 代码重构技能 - 多文件重构、代码异味检测、设计模式应用
version: 1.0.0
category: development
user-invocable: true
tags: [refactor, rename, extract, move, code-smell, design-pattern]
capabilities:
  [
    code-smell-detection,
    multi-file-refactoring,
    rename-symbol,
    extract-function,
    design-pattern-application,
  ]
tools:
  - file_reader
  - file_writer
  - file_editor
  - code_analyzer
supported-file-types: [js, ts, py, java, kt, go, vue, jsx, tsx]
handler: ./handler.js
instructions: |
  Use this skill when the user wants to refactor code - rename symbols across files,
  extract functions/classes, move modules, eliminate duplication, or apply design patterns.
  Unlike code-review (which is read-only analysis), this skill actively modifies code
  across multiple files while maintaining correctness. Always show a diff preview before
  applying changes and ensure all references are updated consistently.
examples:
  - input: "/refactor src/main/index.js --detect-smells"
    output: "Detected 3 code smells: Long Method (line 45-120), Feature Envy (line 200), Duplicate Code (line 300,450)"
  - input: "/refactor --rename sessionData sessionState src/renderer/stores/"
    output: "Renamed sessionData → sessionState across 8 files (12 references updated)"
  - input: "/refactor src/main/llm/ --extract-duplicates"
    output: "Extracted 3 duplicate code blocks into shared utility functions"
os: [win32, darwin, linux]
author: ChainlessChain
---

# 代码重构技能

## 描述

执行跨文件的代码重构操作，包括符号重命名、函数提取、代码移动、重复消除和设计模式应用。与 code-review（只读分析）不同，此技能主动修改代码并确保所有引用一致更新。

## 使用方法

```
/refactor [目标路径] [操作] [选项]
```

## 操作类型

### 代码异味检测

```
/refactor src/ --detect-smells
```

检测以下代码异味:

- **Long Method**: 函数超过 50 行
- **God Class**: 类超过 500 行或 20 个方法
- **Feature Envy**: 方法过度使用其他类的数据
- **Shotgun Surgery**: 一个变更需要修改多个类
- **Duplicate Code**: 重复代码块（相似度 > 80%）
- **Dead Code**: 未被引用的函数/变量

### 重命名符号

```
/refactor --rename <oldName> <newName> [scope]
```

跨文件重命名变量、函数、类名，自动更新所有引用。

### 提取函数/类

```
/refactor <file>:<startLine>-<endLine> --extract-function <name>
/refactor <file> --extract-class <name> --methods <m1,m2,m3>
```

### 移动模块

```
/refactor --move <source> <destination>
```

移动文件/模块并更新所有 import/require 路径。

### 消除重复

```
/refactor <scope> --extract-duplicates
```

查找重复代码块，提取为共享函数。

### 应用设计模式

```
/refactor <file> --apply-pattern <pattern>
```

支持的模式: strategy, observer, factory, builder, singleton

## 执行步骤

1. **分析代码**: 解析目标文件和所有引用文件
2. **生成变更计划**: 列出需要修改的文件和具体变更
3. **展示 Diff 预览**: 在应用前展示所有变更的 diff
4. **用户确认**: 等待用户确认后执行
5. **应用变更**: 按序修改所有文件
6. **验证一致性**: 确认所有引用已更新

## 输出格式

- 变更计划摘要（影响的文件数、修改行数）
- 每个文件的 diff 预览
- 代码复杂度变化对比（前后对比）
- 潜在风险警告

## 示例

检测代码异味:

```
/refactor src/main/ai-engine/ --detect-smells
```

跨文件重命名:

```
/refactor --rename handleMessage processMessage src/main/p2p/
```

提取重复代码:

```
/refactor src/main/llm/ --extract-duplicates
```
