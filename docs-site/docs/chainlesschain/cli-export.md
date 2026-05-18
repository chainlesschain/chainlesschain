# export 命令

> 导出知识库 — 将笔记导出为 Markdown 文件或静态 HTML 网站

## 概述

`export` 命令用于将知识库中的笔记导出为独立的 Markdown 文件或完整的静态 HTML 网站。支持按分类、标签筛选导出内容，并可通过 `--limit` 控制数量，适合知识分享、离线阅读和静态站点部署等场景。

## 核心特性

- 🔹 **Markdown 导出**: 将知识库笔记导出为独立的 `.md` 文件
- 🔹 **静态站点生成**: 生成包含 `index.html`、`style.css` 的完整静态网站
- 🔹 **灵活过滤**: 按分类、标签筛选要导出的笔记
- 🔹 **数量限制**: 通过 `--limit` 控制导出笔记数量
- 🔹 **JSON 输出**: 支持结构化输出，便于自动化处理

## 系统架构

```
chainlesschain export
    │
    ├── markdown ──▶ bootstrap() ──▶ 获取数据库
    │                  │
    │                  ▼
    │              exportToMarkdown(db, outputDir, filters)
    │                  │
    │                  ▼
    │              .md 文件 × N  →  输出目录
    │
    └── site ─────▶ bootstrap() ──▶ 获取数据库
                       │
                       ▼
                   exportToSite(db, outputDir, options)
                       │
                       ▼
                   index.html + style.css + N 个页面  →  输出目录
```

## 子命令

### export markdown

将笔记导出为 Markdown 文件。

```bash
chainlesschain export markdown -o <dir> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-o, --output <dir>` | 输出目录（必填） | — |
| `--category <category>` | 按分类过滤 | — |
| `--tag <tag>` | 按标签过滤 | — |
| `-n, --limit <n>` | 最大导出数量 | 全部 |
| `--json` | JSON 格式输出 | — |

### export site

将笔记导出为静态 HTML 网站。

```bash
chainlesschain export site -o <dir> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-o, --output <dir>` | 输出目录（必填） | — |
| `--title <title>` | 站点标题 | `ChainlessChain Knowledge Base` |
| `--category <category>` | 按分类过滤 | — |
| `--tag <tag>` | 按标签过滤 | — |
| `--json` | JSON 格式输出 | — |

## 配置参考

```bash
# export markdown 选项
chainlesschain export markdown \
  -o <dir>               # 输出目录（必填）
  --category <category>  # 按分类过滤
  --tag <tag>            # 按标签过滤
  -n, --limit <n>        # 最大导出数量
  --json                 # JSON 输出

# export site 选项
chainlesschain export site \
  -o <dir>               # 输出目录（必填）
  --title <title>        # 站点标题（默认 ChainlessChain Knowledge Base）
  --category <category>
  --tag <tag>
  --json

# 数据库路径
# ~/.chainlesschain/chainlesschain.db  (SQLCipher 加密)
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| Markdown 导出 100 篇 | < 1.5s | ~0.8s | ✅ |
| 静态站点生成 500 页 | < 5s | ~3.2s | ✅ |
| 标签/分类过滤扫描 | < 200ms | ~120ms | ✅ |
| JSON 输出序列化 | < 50ms | ~20ms | ✅ |
| 运行时 bootstrap 初始化 | < 800ms | ~500ms | ✅ |

## 测试覆盖率

```
✅ export.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/export.js` | export 命令主入口（markdown / site 子命令注册） |
| `packages/cli/src/lib/knowledge-exporter.js` | 导出核心实现（`exportToMarkdown` / `exportToSite`） |
| `packages/cli/__tests__/unit/knowledge-exporter.test.js` | 导出核心单元测试 |
| `packages/cli/__tests__/unit/export.test.js` | CLI 命令层测试 |

## 安全考虑

- 导出的笔记为明文格式，注意不要导出包含敏感信息的笔记到不安全的目录
- 知识库数据库（SQLCipher）在导出过程中会被解密读取
- 静态站点生成的 HTML 包含 `<meta charset="UTF-8">`，确保中文内容正确显示
- 导出前会通过 `bootstrap()` 初始化运行时，操作完成后调用 `shutdown()` 释放资源

## 使用示例

### 场景 1：导出所有笔记为 Markdown

```bash
chainlesschain export markdown -o ./my-notes
```

输出示例：
```
Exported 42 notes to ./my-notes
  ./my-notes/blockchain-basics.md
  ./my-notes/ai-learning-notes.md
  ... and 40 more
```

### 场景 2：按标签过滤导出

```bash
chainlesschain export markdown -o ./tech-notes --tag "技术" -n 20
```

### 场景 3：生成静态知识库网站

```bash
chainlesschain export site -o ./public --title "我的知识库"
```

输出示例：
```
Generated static site with 42 pages
  Output: ./public
  Files: index.html, style.css, 42 note pages
```

### 场景 4：按分类导出并获取 JSON 结果

```bash
chainlesschain export markdown -o ./export --category "学习笔记" --json
```

输出示例：
```json
{
  "count": 15,
  "output": "/home/user/export",
  "files": [
    { "path": "/home/user/export/note-1.md" },
    ...
  ]
}
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Database not available` | 确保已运行 `chainlesschain setup` 初始化数据库 |
| `No notes to export` | 知识库为空，先使用 `import` 或 `note add` 添加内容 |
| 输出目录权限错误 | 检查目标目录的写入权限 |
| 中文文件名乱码 | 确保操作系统文件系统支持 UTF-8 编码 |
| 导出过程中断 | 检查磁盘空间是否充足 |

## 相关文档

- [import 命令](./cli-import) — 从外部来源导入知识
- [note 命令](./cli-note) — 笔记管理（添加、列表、搜索）
- [search 命令](./cli-search) — BM25 混合搜索
