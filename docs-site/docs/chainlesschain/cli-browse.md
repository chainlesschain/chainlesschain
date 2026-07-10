# browse 命令

> 无头浏览器自动化、网页抓取与 Chrome Connector（连接你真实登录态的 Chrome）

## 概述

browse 命令是 ChainlessChain CLI 的网页抓取与自动化工具，支持网页内容获取、CSS 选择器精确提取和网页截图三种基础操作模式。基础抓取使用轻量 HTTP 请求无需浏览器引擎，支持纯文本、HTML、链接列表和 JSON 多种输出格式。

`cc browse chrome`（cli ≥ 0.162.157）新增 **Chrome Connector**：经 CDP（Chrome DevTools Protocol）连接**你自己真实的 Chrome**，带着你的登录态抓取页面状态（DOM / console / network / 截图）——需要登录才能看到的页面（后台、仪表板、SPA 报错现场）不再是盲区。IDE 插件里的 **Chrome Connector** 面板就是它的图形化前端。

## 核心特性

- 🔹 **网页抓取**: 获取网页内容，提取文本、标题、元信息和链接
- 🔹 **CSS 选择器**: 使用 CSS 选择器精确抓取页面元素
- 🔹 **截图功能**: 对网页进行截图（需要 Playwright）
- 🔹 **多种输出格式**: 支持纯文本、原始 HTML、链接列表和 JSON 输出
- 🔹 **轻量无头**: 基础抓取使用 HTTP 请求，无需浏览器引擎
- 🌐 **Chrome Connector**: 附着你已登录的真实 Chrome（CDP），捕获 DOM / console / network / 截图；默认使用**专用 profile**（登录一次持久保留），`--default-profile` 可复用真实 profile

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
    ├── screenshot ──▶ takeScreenshot()
    │                   │
    │                   └── Playwright 截图 → PNG 文件
    │
    └── chrome ──▶ chrome-connector.js（CDP，无需 Playwright）
                    ├── status  → discoverCdp()   探测 9222 端口
                    ├── launch  → launchChrome()  起可调试 Chrome（专用 profile）
                    └── state   → captureState()  附着 tab：DOM+console+network+截图
```

## 子命令

### browse fetch

获取网页并显示内容。

```bash
chainlesschain browse fetch <url> [options]
```

| 选项      | 说明                         | 默认值 |
| --------- | ---------------------------- | ------ |
| `--html`  | 显示原始 HTML                | —      |
| `--links` | 仅提取链接（最多显示 50 条） | —      |
| `--json`  | JSON 格式输出                | —      |

### browse scrape

使用 CSS 选择器抓取页面元素。

```bash
chainlesschain browse scrape <url> -s <selector> [options]
```

| 选项                   | 说明               | 默认值 |
| ---------------------- | ------------------ | ------ |
| `-s, --selector <css>` | CSS 选择器（必填） | —      |
| `-n, --limit <n>`      | 最大结果数         | `20`   |
| `--json`               | JSON 格式输出      | —      |

### browse screenshot

对网页进行截图（需安装 Playwright）。

```bash
chainlesschain browse screenshot <url> [options]
```

| 选项                  | 说明          | 默认值           |
| --------------------- | ------------- | ---------------- |
| `-o, --output <path>` | 输出文件路径  | `screenshot.png` |
| `--width <n>`         | 视口宽度      | `1280`           |
| `--height <n>`        | 视口高度      | `720`            |
| `--full-page`         | 捕获完整页面  | —                |
| `--json`              | JSON 格式输出 | —                |

### browse chrome（Chrome Connector，cli ≥ 0.162.157）

连接你真实登录态的 Chrome，捕获页面状态。三个子命令：

**`browse chrome status`** — 探测 CDP 端口上是否有可调试 Chrome：

| 选项                | 说明          | 默认值 |
| ------------------- | ------------- | ------ |
| `-p, --port <port>` | CDP 端口      | `9222` |
| `--json`            | JSON 格式输出 | —      |

**`browse chrome launch`** — 启动一个可调试 Chrome：

| 选项                | 说明                                                          | 默认值 |
| ------------------- | ------------------------------------------------------------- | ------ |
| `-p, --port <port>` | CDP 端口                                                      | `9222` |
| `-u, --url <url>`   | 启动后打开的 URL                                              | —      |
| `--default-profile` | 复用你**真实的** Chrome profile（要求先关闭所有 Chrome 窗口） | —      |
| `--profile <dir>`   | 自定义 profile 目录                                           | —      |
| `--json`            | JSON 格式输出                                                 | —      |

默认使用**专用 connector profile**：在里面登录一次目标站点，登录态持久保留，之后每次 `state` 都带登录态；不碰你日常的 Chrome。端口上已有可调试 Chrome 时直接复用不重复启动。

**`browse chrome state`** — 附着到已连接的 Chrome，捕获某个 tab 的状态：

| 选项                  | 说明                                            | 默认值   |
| --------------------- | ----------------------------------------------- | -------- |
| `-p, --port <port>`   | CDP 端口                                        | `9222`   |
| `-t, --tab <n>`       | tab 序号（输出里有 tabs 列表）                  | `0`      |
| `--watch-ms <ms>`     | 附着后观察 console/network 的时长               | `3000`   |
| `--reload`            | 先刷新页面，以捕获加载期的 console/network      | —        |
| `--no-dom`            | 跳过 DOM 快照                                   | —        |
| `--dom-cap <chars>`   | DOM 快照截断上限                                | `150000` |
| `--screenshot <file>` | 顺带写一张截图                                  | —        |
| `--json`              | JSON 格式输出（含完整 DOM / console / network） | —        |

## 配置参考

```bash
chainlesschain browse <subcommand> [options]

子命令:
  fetch <url>          获取网页内容（文本/HTML/链接）
  scrape <url>         使用 CSS 选择器抓取元素
  screenshot <url>     网页截图（需 Playwright）

fetch 选项:
  --html               返回原始 HTML
  --links              仅返回链接列表（上限 50）
  --json               JSON 输出

scrape 选项:
  -s, --selector <css> CSS 选择器（必填）
  -n, --limit <n>      最大结果数（默认 20）
  --json               JSON 输出

screenshot 选项:
  -o, --output <path>  输出文件路径（默认 screenshot.png）
  --width <n>          视口宽度（默认 1280）
  --height <n>         视口高度（默认 720）
  --full-page          捕获完整页面
  --json               JSON 输出
```

前置依赖: Node.js ≥ 18（内置 fetch）。`screenshot` 需要 `npm install -g playwright`；`chrome` 子命令只需本机装有 Chrome（走 CDP，不需要 Playwright）。

## 性能指标

| 操作                      | 目标    | 实际   | 状态 |
| ------------------------- | ------- | ------ | ---- |
| fetch 小型页面（< 100KB） | < 1s    | ~400ms | ✅   |
| fetch 大型页面（1MB）     | < 3s    | ~1.2s  | ✅   |
| scrape CSS 选择器匹配     | < 500ms | ~180ms | ✅   |
| 链接提取（含去重）        | < 200ms | ~60ms  | ✅   |
| screenshot 视口截图       | < 3s    | ~1.5s  | ✅   |
| screenshot 全页截图       | < 5s    | ~2.8s  | ✅   |

## 测试覆盖率

```
✅ browse.test.js  - 覆盖 browse CLI 的主要路径
  ├── 参数解析 / 选项验证（selector / limit / output / width / height）
  ├── 正常路径（fetch 文本/HTML/links、scrape、screenshot）
  ├── 错误处理 / 边界情况（无效 URL、选择器无匹配、Playwright 缺失）
  └── JSON 输出格式
```

## 关键文件

- `packages/cli/src/commands/browse.js` — 命令注册与子命令定义（含 chrome 子命令组）
- `packages/cli/src/lib/browser-automation.js` — 核心实现：fetchPage、extractText、extractTitle、extractMeta、querySelectorAll、extractLinks、takeScreenshot
- `packages/cli/src/lib/chrome-connector.js` — Chrome Connector：discoverCdp、launchChrome（跨平台 Chrome 探测）、captureState（CDP 附着 + DOM/console/network/截图）

## 安全考虑

- 抓取内容时注意目标网站的 robots.txt 和服务条款
- 截图功能需要 Playwright，它会下载浏览器引擎（约 100MB+）
- 抓取的 HTML 内容可能包含恶意脚本，不要直接执行
- 获取的链接和文本会自动截断以防止内存溢出
- **CDP 端口是无鉴权的本地控制通道**：任何本机进程都能控制挂在 9222 上的 Chrome。用完就关掉该 Chrome；`--default-profile` 模式下该端口控制的是你**真实登录态**的浏览器，风险更高，优先用默认的专用 profile
- Chrome Connector 抓到的 DOM / 截图可能含敏感登录内容，注意输出文件的保存位置

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

### 场景 7：抓取需要登录的后台页面（Chrome Connector）

```bash
cc browse chrome launch -u https://admin.example.com   # 起专用 Chrome，在里面登录一次
cc browse chrome status                                # 确认 9222 端口就绪
cc browse chrome state --reload --watch-ms 5000 \
  --screenshot admin.png --json > state.json           # 刷新并捕获 DOM+console+network+截图
```

### 场景 8：调试 SPA 报错现场

```bash
# 在已连接的 Chrome 里复现问题，然后：
cc browse chrome state -t 1 --no-dom     # 只看第 2 个 tab 的 console 报错与失败请求
```

## 故障排查

| 问题                                 | 解决方案                                                                |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `Fetch failed: fetch is not defined` | Node.js 版本需 >= 18（内置 fetch API）                                  |
| `Screenshot failed`                  | 安装 Playwright：`npm install -g playwright`                            |
| `No elements matching "..."`         | 检查 CSS 选择器是否正确，页面可能使用动态渲染                           |
| 文本内容被截断                       | 默认显示前 5000 字符，使用 `--json` 获取完整内容                        |
| 中文乱码                             | 确保终端编码为 UTF-8（Windows 运行 `chcp 65001`）                       |
| `No debuggable Chrome on port 9222`  | 先 `cc browse chrome launch`；或确认端口号一致                          |
| `--default-profile` 没拿到调试端口   | 必须**先关闭所有** Chrome 窗口再 launch（已在跑的 Chrome 会吞掉新窗口） |
| chrome state 抓不到加载期日志        | 加 `--reload`（console/network 从附着时刻开始收集）                     |

## 相关文档

- [mcp 命令](./cli-mcp) — MCP 服务器管理（包含更多外部集成工具）
- [import 命令](./cli-import) — 将抓取的内容导入知识库
- [IDE 插件使用指南](./ide-plugin) — Chrome Connector 的 IDE 图形化前端
- [浏览器自动化](./browser-automation) — 桌面端 Playwright 全功能自动化
