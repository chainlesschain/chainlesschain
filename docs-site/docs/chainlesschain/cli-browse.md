# browse 命令

> 无头浏览器自动化与网页抓取工具

## 概述

browse 命令是 ChainlessChain CLI 的网页抓取与自动化工具，支持网页内容获取、CSS 选择器精确提取和网页截图三种操作模式。基础抓取使用轻量 HTTP 请求无需浏览器引擎，支持纯文本、HTML、链接列表和 JSON 多种输出格式。

## 核心特性

- 🔹 **网页抓取**: 获取网页内容，提取文本、标题、元信息和链接
- 🔹 **CSS 选择器**: 使用 CSS 选择器精确抓取页面元素
- 🔹 **截图功能**: 对网页进行截图（需要 Playwright）
- 🔹 **多种输出格式**: 支持纯文本、原始 HTML、链接列表和 JSON 输出
- 🔹 **轻量无头**: 基础抓取使用 HTTP 请求，无需浏览器引擎

## 系统架构

```
chainlesschain browse
    │
    ├── fetch ──▶ fetchPage() ──▶ extractText/Title/Meta/Links
    │                              │
    │                              ├── --html   → 原始 HTML
    │                              ├── --links  → 链接列表
    │                              └── 默认      → 纯文本（截断 5000 字符）
    │
    ├── scrape ─▶ fetchPage() ──▶ querySelectorAll(selector)
    │                              │
    │                              └── 返回匹配元素文本（默认上限 20 条）
    │
    └── screenshot ──▶ takeScreenshot()
                        │
                        └── Playwright 截图 → PNG 文件
```

## 子命令

### browse fetch

获取网页并显示内容。

```bash
chainlesschain browse fetch <url> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--html` | 显示原始 HTML | — |
| `--links` | 仅提取链接（最多显示 50 条） | — |
| `--json` | JSON 格式输出 | — |

### browse scrape

使用 CSS 选择器抓取页面元素。

```bash
chainlesschain browse scrape <url> -s <selector> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-s, --selector <css>` | CSS 选择器（必填） | — |
| `-n, --limit <n>` | 最大结果数 | `20` |
| `--json` | JSON 格式输出 | — |

### browse screenshot

对网页进行截图（需安装 Playwright）。

```bash
chainlesschain browse screenshot <url> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-o, --output <path>` | 输出文件路径 | `screenshot.png` |
| `--width <n>` | 视口宽度 | `1280` |
| `--height <n>` | 视口高度 | `720` |
| `--full-page` | 捕获完整页面 | — |
| `--json` | JSON 格式输出 | — |

## 关键文件

- `packages/cli/src/commands/browse.js` — 命令注册与子命令定义
- `packages/cli/src/lib/browser-automation.js` — 核心实现：fetchPage、extractText、extractTitle、extractMeta、querySelectorAll、extractLinks、takeScreenshot

## 安全考虑

- 抓取内容时注意目标网站的 robots.txt 和服务条款
- 截图功能需要 Playwright，它会下载浏览器引擎（约 100MB+）
- 抓取的 HTML 内容可能包含恶意脚本，不要直接执行
- 获取的链接和文本会自动截断以防止内存溢出

## 使用示例

### 场景 1：获取网页文本内容

```bash
chainlesschain browse fetch https://example.com
```

### 场景 2：提取网页所有链接

```bash
chainlesschain browse fetch https://example.com --links
```

### 场景 3：使用 CSS 选择器抓取标题

```bash
chainlesschain browse scrape https://news.example.com -s "h2.title"
```

### 场景 4：抓取并以 JSON 输出

```bash
chainlesschain browse scrape https://example.com -s ".article" --json -n 10
```

### 场景 5：网页截图

```bash
chainlesschain browse screenshot https://example.com -o page.png --full-page
```

### 场景 6：获取原始 HTML

```bash
chainlesschain browse fetch https://example.com --html > page.html
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Fetch failed: fetch is not defined` | Node.js 版本需 >= 18（内置 fetch API） |
| `Screenshot failed` | 安装 Playwright：`npm install -g playwright` |
| `No elements matching "..."` | 检查 CSS 选择器是否正确，页面可能使用动态渲染 |
| 文本内容被截断 | 默认显示前 5000 字符，使用 `--json` 获取完整内容 |
| 中文乱码 | 确保终端编码为 UTF-8（Windows 运行 `chcp 65001`） |

## 相关文档

- [mcp 命令](./cli-mcp) — MCP 服务器管理（包含更多外部集成工具）
- [import 命令](./cli-import) — 将抓取的内容导入知识库
