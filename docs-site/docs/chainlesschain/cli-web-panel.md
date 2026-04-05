# Vue3 Web 管理面板 (ui – v5.0.2.8)

> **版本**: v5.0.2.8 | 参考 [ClawPanel](https://github.com/qingchencloud/clawpanel) 设计，构建为独立 Vue3 前端应用。

> **v5.0.2.6 起**：通过 `npm install -g chainlesschain` 安装的用户**无需手动构建**，面板已内置于包中，直接运行 `chainlesschain ui` 即可。

`chainlesschain ui` 现已升级为完整的 Vue3 管理面板，包含 **10 个功能模块**，支持 **4 种颜色主题**，并清晰区分项目级和全局两种工作模式。

## 快速开始

```bash
# npm 安装用户：直接启动，无需构建
chainlesschain ui

# 项目级面板（在含 .chainlesschain/ 的目录下运行）
cd /your/project
chainlesschain ui

# 全局面板（任意目录）
chainlesschain ui

# 高级选项
chainlesschain ui --port 9000 --ws-port 9001
chainlesschain ui --token mysecret
chainlesschain ui --web-panel-dir /custom/dist   # 指定 dist 目录
```

启动后访问：`http://127.0.0.1:18810`

## 十个功能模块

侧边栏分三组：**概览**（仪表板）、**配置**（对话/技能/LLM 配置/服务/日志）、**数据**（笔记/MCP 工具/记忆/定时任务）。

### 🏠 仪表板 (Dashboard)

- **4 个状态卡片**：WebSocket 连接、活跃 LLM、技能数量、AI 会话数
- **项目/全局差异化展示**：项目模式显示蓝色项目信息卡片，全局模式显示紫色引导提示
- 快速操作按钮（新建对话、浏览技能、LLM 配置）
- 运行信息表格（端口、认证状态、版本）

### 💬 AI 对话 (Chat)

- **Chat / Agent 双模式**切换
- **流式响应渲染**：逐 token 显示 + 打字光标动画
- **工具调用可视化**：折叠卡片展示 input/output
- **交互式 Q&A**：选项按钮或自由输入框
- **Markdown + 代码高亮**（marked.js + highlight.js）
- 左侧会话列表，支持历史切换

### 🧩 技能管理 (Skills)

- 138+ 技能分类浏览（CLI / Agent / LLM / 混合 / 内置）
- 搜索框实时过滤
- 执行模式标签一目了然
- "运行"按钮 → 跳转 Chat 视图并执行 `/skill run <name>`

### 🔌 LLM 配置 (Providers)

- **10 个 Provider 可视化**（Anthropic、OpenAI、Ollama、DeepSeek、Gemini、火山引擎、通义千问、Kimi、MiniMax、Mistral）
- 活跃 Provider 绿色高亮边框 + "活跃"标签
- 一键切换活跃 Provider
- 连接测试
- Ollama 本地模型列表

### 🐳 服务状态 (Services)

- Docker 服务启停操作
- 端口状态一览（Vite、Signaling、WS Server 等）
- 服务健康状态实时显示

### 📋 运行日志 (Logs)

- 多颜色行分类（错误红、成功绿、警告黄、缩进灰）
- 实时刷新
- 关键字过滤

### 📝 笔记管理 (Notes)

- 笔记列表浏览（标题、标签、预览）
- 搜索与过滤
- 新建、查看、删除笔记

### 🔧 MCP 工具 (MCP Tools)

- MCP 服务器列表（名称、命令、描述）
- 每台服务器的工具列表
- 工具搜索

### 🧠 记忆系统 (Memory)

- 三层记忆统计（短期 / 长期 / 核心）
- 记忆条目列表浏览
- 记忆层切换

### ⏰ 定时任务 (Cron)

- 定时任务列表（名称、Cron 表达式、启用状态）
- 启用/禁用切换
- 手动执行

## 颜色主题

面板支持 4 种颜色主题，可在顶部导航栏右上角切换：

| 主题 | 图标 | 特点 |
|------|------|------|
| 深色 (Dark) | 🌑 | 默认主题，深灰背景 |
| 浅色 (Light) | ☀️ | 白色背景，适合日间使用 |
| 海蓝 (Blue) | 🌊 | 深蓝背景，科技感强 |
| 绿野 (Green) | 🌿 | 深绿背景，护眼模式 |

主题偏好自动持久化到 `localStorage`（key: `cc_theme`），重新打开面板时恢复上次选择。所有颜色通过 CSS 自定义属性（`--bg-base`、`--bg-card`、`--text-primary` 等）驱动，Ant Design 组件使用对应的深色/浅色算法。

## 项目级 vs 全局模式

| 特性 | 项目模式 🔵 | 全局模式 🟣 |
|------|-----------|-----------|
| 侧边栏横幅 | 蓝色 + 文件夹图标 + 项目名 | 紫色 + 地球图标 + "全局模式" |
| 仪表板顶部 | 蓝色项目信息卡片（含路径） | 紫色提示：如何切换到项目级 |
| Chat 作用域 | 会话绑定 `projectRoot` | 无项目绑定 |
| Header 范围标签 | 蓝色 🗂 项目名 | 紫色 🌐 全局会话 |

在含 `.chainlesschain/` 目录的项目下运行 → **项目级面板**；在其他目录运行 → **全局面板**。

## 命令选项

```
Usage: chainlesschain ui [options]

Options:
  -p, --port <port>           HTTP 服务器端口 (默认: 18810)
  --ws-port <port>            WebSocket 服务器端口 (默认: 18800)
  -H, --host <host>           绑定地址 (默认: 127.0.0.1)
  --no-open                   不自动打开浏览器
  --token <token>             WebSocket 认证 token
  --web-panel-dir <dir>       指定 dist/ 目录（默认自动检测）
  -h, --help                  显示帮助信息
```

## 构建说明

**npm 安装用户**（`npm install -g chainlesschain`）：**无需任何构建**，面板已在发布时通过 `prepublishOnly` 自动内置到包中。

**源码用户**（从 GitHub 克隆仓库）：需手动构建一次：

```bash
# 从项目根目录构建（推荐）
npm run build:web-panel

# 或在 packages/web-panel/ 内手动构建
cd packages/web-panel
npm install --legacy-peer-deps
npm run build
```

> **注意**：安装时需加 `--legacy-peer-deps`，因为 `@vitejs/plugin-vue@5.x` 与 Vite 7 存在 peer dep 声明不匹配问题。

## 技术架构

```
packages/web-panel/           Vue3 + Vite + Ant Design Vue
├── src/stores/ws.js          WebSocket 连接管理（指数退避重连 + waitConnected）
├── src/stores/theme.js       主题状态管理（4 主题 + localStorage 持久化）
├── src/stores/chat.js        会话与消息状态
├── src/stores/skills.js      技能列表与过滤
├── src/stores/providers.js   LLM Provider 管理
├── src/utils/parsers.js      纯函数解析层（技能/状态/笔记/MCP/记忆/Cron）
├── src/style.css             全局 CSS 变量驱动主题系统
└── src/components/
    ├── AppLayout.vue         分组侧边栏 + 主题切换器
    └── MarkdownRenderer.vue  Markdown 渲染（主题感知）
```

**运行时配置注入**：

```html
<!-- index.html 构建时含占位符 -->
<script>window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;</script>
```

服务器启动时将 `__CC_CONFIG_PLACEHOLDER__` 替换为：

```json
{
  "wsPort": 18800,
  "wsToken": null,
  "wsHost": "127.0.0.1",
  "projectRoot": "/path/to/project",
  "projectName": "my-project",
  "mode": "project"
}
```

配置值经过 Unicode 转义（`<` → `\u003c`），防止 XSS 攻击。

## 自动检测与降级

`chainlesschain ui` 启动时按以下优先级自动查找面板（三路检测）：

```
1. --web-panel-dir <dir>          显式指定目录
2. packages/web-panel/dist/       源码用户本地构建产物
3. <npm包>/src/assets/web-panel/  npm 安装内置产物（v5.0.2.6+）
↓ 三路均未找到
经典 HTML（AI 对话基础功能，自动回退）
```

## 关键 Bug 修复（v5.0.2.8）

### 技能列表始终显示 0

**根因**：WebSocket 服务端发送 `{ stdout, stderr, exitCode }` 字段，但客户端的 `execute()` 方法读取 `result.output`（始终为 `undefined`），导致所有 CLI 命令输出为空。

**修复**（`ws.js`）：

```js
const output = result.output ?? result.stdout ?? ''   // 兼容新旧服务端
const stderr = result.stderr ?? ''
return { output: output || stderr, exitCode: result.exitCode ?? 0 }
```

### Provider 列表不含国产模型

**根因**：旧版使用 `qianwen`、`moonshot`、`baidu` 等非 CLI 键名，活跃/配置状态永远无法匹配。

**修复**：按 CLI `llm-providers.js` 实际键名重写为 `volcengine`、`dashscope`、`kimi`、`minimax`、`mistral` 等 10 个 Provider。

## 与旧版对比

| 特性 | v5.0.2.6 | v5.0.2.8 |
|------|-----------|-----------|
| 功能模块数 | 4 | **10**（新增服务/日志/笔记/MCP/记忆/Cron）|
| 颜色主题 | 仅深色 | **4 种**（深色/浅色/海蓝/绿野）|
| Provider 列表 | 不含国产模型 | **10 个**含火山引擎/通义千问/Kimi/MiniMax |
| 技能数量显示 | ❌ 始终为 0 | ✅ 正确显示 138+ |
| 浅色主题适配 | ❌ 部分组件仍显黑色 | ✅ 全量 CSS 变量适配 |
| 中文乱码 | 5 处 U+FFFD | ✅ 已全部修复 |

## 测试覆盖

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `parsers.test.js` | 单元 | 85 |
| `theme.test.js` | 单元 | 17 |
| `ws-store.test.js` | 单元 | 12 |
| `web-ui-server.test.js`（集成） | 集成 | 23 |
| `panel.test.js` | E2E | 20 |
| **Web Panel 合计** | | **157** |

## 相关文档

- [设计文档 — 模块 75](../design/modules/75-web-panel) — 完整技术架构文档
- [WebSocket 服务器 (serve)](./cli-serve) — 程序化 API 接口
- [技能系统 (skill)](./cli-skill) — 技能管理详情
