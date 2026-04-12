# import 命令

> 从外部来源导入知识 — 支持 Markdown、Evernote、Notion 和 PDF 格式

## 概述

`import` 命令用于从多种外部来源批量导入知识到本地知识库，支持 Markdown 目录、Evernote ENEX 导出文件、Notion 导出目录和 PDF 文档四种格式。导入的内容存入加密的 SQLite 数据库，保留标签等元信息，便于后续搜索和管理。

## 核心特性

- 🔹 **Markdown 导入**: 批量导入目录中的 `.md` 文件
- 🔹 **Evernote 导入**: 解析 `.enex` 导出文件，保留标签信息
- 🔹 **Notion 导入**: 导入 Notion 导出目录中的页面
- 🔹 **PDF 导入**: 提取 PDF 文本内容并存入知识库
- 🔹 **JSON 输出**: 所有子命令均支持 `--json` 格式化输出

## 系统架构

```
chainlesschain import
    │
    ├── markdown <dir> ──▶ bootstrap() ──▶ importMarkdownDir(db, dir)
    │                       扫描目录中所有 .md 文件 → 插入数据库
    │
    ├── evernote <file> ─▶ bootstrap() ──▶ importEnexFile(db, file)
    │                       解析 ENEX XML → 提取笔记+标签 → 插入数据库
    │
    ├── notion <dir> ────▶ bootstrap() ──▶ importNotionDir(db, dir)
    │                       扫描 Notion 导出目录 → 解析页面 → 插入数据库
    │
    └── pdf <file> ──────▶ bootstrap() ──▶ parsePdfText(file)
                            提取 PDF 文本 → insertNote(db, note)
                            （pdf-parser 延迟加载，保持可选依赖）
```

## 子命令

### import markdown

从目录中批量导入 Markdown 文件。

```bash
chainlesschain import markdown <dir> [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `<dir>` | 包含 `.md` 文件的目录（必填） | — |
| `--json` | JSON 格式输出 | — |

### import evernote

从 Evernote ENEX 导出文件导入。

```bash
chainlesschain import evernote <file> [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `<file>` | `.enex` 文件路径（必填） | — |
| `--json` | JSON 格式输出 | — |

### import notion

从 Notion 导出目录导入。

```bash
chainlesschain import notion <dir> [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `<dir>` | Notion 导出目录（必填） | — |
| `--json` | JSON 格式输出 | — |

### import pdf

从 PDF 文件提取文本并导入。

```bash
chainlesschain import pdf <file> [options]
```

| 参数/选项 | 说明 | 默认值 |
|-----------|------|--------|
| `<file>` | `.pdf` 文件路径（必填） | — |
| `--json` | JSON 格式输出 | — |

## 关键文件

- `packages/cli/src/commands/import.js` — 命令注册与子命令定义
- `packages/cli/src/lib/knowledge-importer.js` — 导入核心：`importMarkdownDir()`、`importEnexFile()`、`importNotionDir()`、`insertNote()`、`ensureNotesTable()`
- `packages/cli/src/lib/pdf-parser.js` — PDF 文本提取（延迟加载，可选依赖）
- `packages/cli/src/runtime/bootstrap.js` — 运行时初始化，提供数据库连接

## 安全考虑

- 导入的内容会存入加密数据库（SQLCipher AES-256），数据安全有保障
- PDF 解析器为延迟加载的可选依赖，减少安装体积
- 导入前会验证文件/目录是否存在，防止路径遍历攻击
- 大文件导入可能消耗较多内存，建议分批处理

## 使用示例

### 场景 1：导入 Markdown 笔记目录

```bash
chainlesschain import markdown ./my-notes
```

输出示例：
```
Imported 25 markdown notes
  a1b2c3d4  Getting Started
  e5f6g7h8  Architecture Overview
  ... and 23 more
```

### 场景 2：从 Evernote 迁移

```bash
chainlesschain import evernote ~/Downloads/My_Notes.enex
```

输出示例：
```
Imported 156 Evernote notes
  a1b2c3d4  Meeting Notes  [work, meeting]
  e5f6g7h8  Recipe Collection  [food, personal]
  ... and 154 more
```

### 场景 3：从 Notion 迁移

```bash
chainlesschain import notion ~/Downloads/Notion-Export/
```

### 场景 4：导入 PDF 文档

```bash
chainlesschain import pdf ~/Documents/whitepaper.pdf
```

输出示例：
```
Imported PDF as note: whitepaper
  ID: a1b2c3d4
  Length: 15432 chars
  Pages: 12
```

### 场景 5：JSON 输出用于脚本处理

```bash
chainlesschain import markdown ./docs --json | jq '.count'
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Database not available` | 运行 `chainlesschain setup` 初始化环境 |
| `Directory not found` | 检查路径是否正确，使用绝对路径 |
| `File not found` | 确认文件存在且路径拼写正确 |
| `No .md files found` | 目录中没有 `.md` 文件，检查文件扩展名 |
| `No text could be extracted from the PDF` | PDF 可能是扫描件（图片），需要 OCR 支持 |
| PDF 导入失败 | 确认 pdf-parser 依赖已安装 |
| Evernote 导入标签丢失 | 确认导出时选择了包含标签的 ENEX 格式 |

## 相关文档

- [export 命令](./cli-export) — 导出知识库为 Markdown 或静态站点
- [note 命令](./cli-note) — 笔记管理（添加、列表、搜索）
- [search 命令](./cli-search) — BM25 混合搜索知识库
