---
name: repo-map
display-name: Repository Map
description: 代码库结构映射 - AST级符号索引、全局代码感知、依赖可视化
version: 1.0.0
category: development
user-invocable: true
tags: [repo, map, ast, codebase, symbols, tree-sitter, architecture]
capabilities:
  [ast-parsing, symbol-indexing, dependency-visualization, codebase-awareness]
tools:
  - file_reader
  - code_analyzer
supported-file-types:
  [js, ts, py, java, kt, go, rs, c, cpp, vue, jsx, tsx, swift]
instructions: |
  Use this skill when the user needs to understand the overall structure of a codebase,
  find where specific functions/classes are defined, or needs the AI to be aware of the
  full project structure without loading every file. This skill creates a compressed
  map of all symbols (classes, functions, exports, imports) across the repository,
  enabling cross-file reasoning without consuming excessive token budget.
  Inspired by Aider's repository map technique using AST parsing.
examples:
  - input: "/repo-map src/main/"
    output: "Hierarchical symbol map showing all modules, classes, functions, and their relationships"
  - input: "/repo-map src/renderer/stores/ --exports"
    output: "Export map of all Pinia stores with their state, getters, and actions"
  - input: "/repo-map --find handleFileUpload"
    output: "Located handleFileUpload in src/main/p2p/file-transfer.js:142, called by 3 modules"
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# 代码库结构映射技能

## 描述

创建代码库的 AST 级结构映射，提取所有文件的类、函数、导出、导入符号，生成压缩的全局代码感知索引。让 AI 在不加载完整文件内容的情况下了解整个项目结构，实现跨文件推理。

## 使用方法

```
/repo-map [目录路径] [选项]
```

## 选项

- `--depth <n>` - 扫描深度层级 (默认: 全部)
- `--exports` - 仅显示导出符号
- `--imports` - 显示导入依赖关系图
- `--find <symbol>` - 查找特定符号的定义和引用位置
- `--format <type>` - 输出格式: tree, flat, mermaid (默认: tree)
- `--filter <pattern>` - 文件过滤模式 (如 `*.ts`)

## 执行步骤

1. **扫描目录**: 递归遍历指定目录，按语言分类文件
2. **AST 解析**: 解析每个文件的语法树，提取符号（类、函数、变量、导出、导入）
3. **构建索引**: 建立符号 → 文件位置的映射表
4. **依赖分析**: 追踪 import/require 关系，构建模块依赖图
5. **压缩输出**: 生成紧凑的符号摘要，控制 token 开销

## 输出格式

```
src/main/
├── database.js
│   ├── class DatabaseManager
│   │   ├── initialize()
│   │   ├── query(sql, params)
│   │   └── migrate()
│   └── exports: { DatabaseManager }
├── llm/
│   ├── session-manager.js
│   │   ├── class SessionManager
│   │   │   ├── createSession(options)
│   │   │   ├── compressContext(session)
│   │   │   └── exportSession(id)
│   │   └── exports: { SessionManager }
```

## 支持的语言

| 语言        | 文件类型        | 符号提取                             |
| ----------- | --------------- | ------------------------------------ |
| JavaScript  | .js, .jsx, .mjs | 函数、类、const/let 导出、CommonJS   |
| TypeScript  | .ts, .tsx       | 接口、类型别名、枚举、泛型           |
| Python      | .py             | 类、函数、装饰器                     |
| Java/Kotlin | .java, .kt      | 类、接口、方法、注解                 |
| Vue         | .vue            | setup 函数、composables、defineEmits |
| Go          | .go             | 结构体、函数、接口                   |
| Rust        | .rs             | struct、impl、trait、fn              |
| Swift       | .swift          | class、struct、protocol、func        |

## 示例

扫描主进程代码:

```
/repo-map src/main/
```

查找特定函数:

```
/repo-map --find buildOptimizedPrompt
```

生成 Mermaid 依赖图:

```
/repo-map src/main/llm/ --imports --format mermaid
```
