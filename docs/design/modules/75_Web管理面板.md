# 模块 75: Web 管理面板 (chainlesschain ui – Web Panel)

> **版本**: v5.0.2.6
> **状态**: ✅ 完成
> **测试**: 147 个测试（66 单元 + 51 集成 + 30 E2E）
> **新增文件**:
>   - `packages/web-panel/` (Vue3 管理面板，17 个源文件)
>   - `packages/web-panel/package.json`
>   - `packages/web-panel/vite.config.js`
>   - `packages/web-panel/index.html`
>   - `packages/web-panel/src/main.js`
>   - `packages/web-panel/src/App.vue`
>   - `packages/web-panel/src/router/index.js`
>   - `packages/web-panel/src/stores/ws.js`
>   - `packages/web-panel/src/stores/dashboard.js`
>   - `packages/web-panel/src/stores/chat.js`
>   - `packages/web-panel/src/stores/skills.js`
>   - `packages/web-panel/src/stores/providers.js`
>   - `packages/web-panel/src/views/Dashboard.vue`
>   - `packages/web-panel/src/views/Chat.vue`
>   - `packages/web-panel/src/views/Skills.vue`
>   - `packages/web-panel/src/views/Providers.vue`
>   - `packages/web-panel/src/components/AppLayout.vue`
>   - `packages/web-panel/src/components/MarkdownRenderer.vue`
> **修改文件** (v5.0.2.5):
>   - `packages/cli/src/lib/web-ui-server.js` — 新增静态文件服务逻辑
>   - `packages/cli/src/commands/ui.js` — 新增 `--web-panel-dir` 选项
>   - `package.json` (根目录) — 新增 `build:web-panel`、`dev:web-panel` 脚本
> **修改文件** (v5.0.2.6 – npm 打包 + Bug 修复):
>   - `packages/cli/src/lib/web-ui-server.js` — `findWebPanelDist()` 三路查找 + `$` 字符 Bug 修复
>   - `packages/cli/package.json` — 新增 `build:web-panel`、`prepublishOnly` 脚本
>   - `package.json` (根目录) — 更新 `build:web-panel`（构建 + 复制到 CLI 包）
>   - `.gitignore` — 忽略 `packages/cli/src/assets/web-panel/`、`packages/web-panel/dist/`
> **测试文件**:
>   - `packages/cli/__tests__/unit/web-ui-server.test.js` (v5.0.2.5: 46 → v5.0.2.6: 66)
>   - `packages/cli/__tests__/integration/ui-server-integration.test.js` (29 → 51)
>   - `packages/cli/__tests__/e2e/ui-command.test.js` (24 → 30)

---

## 一、背景与目标

### 1.1 问题陈述

ChainlessChain v5.0.2.2 引入了 `chainlesschain ui` Web UI，但功能局限于 AI 对话，缺少：

1. 可视化仪表板：无服务状态概览、统计数据
2. 技能管理界面：138+ 个技能只能通过命令行查看和运行
3. LLM Provider 管理：10 个 Provider 切换仅支持命令行
4. 项目级 vs 全局模式的视觉差异：两种模式下界面无明显区分

参考 [ClawPanel](https://github.com/qingchencloud/clawpanel)（OpenClaw AI Agent 可视化管理面板）的设计理念，构建一个专业的可视化管理面板。

### 1.2 设计目标

- **可视化管理**：仪表板、技能管理、LLM 配置的图形化界面
- **项目/全局双模式**：项目级面板限定在项目范围，全局面板管理系统全局
- **零后端启动**：复用现有 WebSocket 协议，无需新增 WS 消息类型
- **渐进增强**：若 `dist/` 构建产物不存在，自动回退到内嵌经典 HTML
- **独立前端项目**：`packages/web-panel/` 作为独立 Vue3 项目，与 CLI 解耦

### 1.3 设计原则

- **技术栈一致性**：与 `desktop-app-vue` 相同（Vue3 + Ant Design Vue + Pinia）
- **零 WebSocket 协议扩展**：完全复用现有 `execute`、`session-*` 消息类型
- **安全优先**：路径遍历防护、XSS 防护（Unicode 转义）、Method 限制
- **可测性**：所有 HTTP 逻辑通过真实 HTTP 请求测试，无 mock

---

## 二、系统架构

### 2.1 整体架构

```
┌────────────────────────────────────────────────────────┐
│                   浏览器                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │          Vue3 Web Panel (SPA)                    │  │
│  │  ┌──────────┬──────────┬──────────┬──────────┐  │  │
│  │  │Dashboard │  Chat    │ Skills   │Providers │  │  │
│  │  └──────────┴──────────┴──────────┴──────────┘  │  │
│  │        ↕ Pinia Stores (ws.js 核心)               │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
         ↕ HTTP GET /assets/** (静态文件)
         ↕ WebSocket ws://host:18800
┌────────────────────────────────────────────────────────┐
│                  CLI 进程                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │  web-ui-server.js (HTTP 18810)                   │  │
│  │  • 检测 dist/ 目录                               │  │
│  │  • 注入 __CC_CONFIG__ 到 index.html              │  │
│  │  • 提供 /assets/** 静态文件服务                   │  │
│  │  • SPA 路由回退 (所有路径 → index.html)           │  │
│  │  • 无 dist/ 时回退到内嵌经典 HTML                 │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  ws-server.js (WebSocket 18800)                  │  │
│  │  • execute: 执行 CLI 命令获取数据                 │  │
│  │  • session-*: 管理 AI 对话会话                    │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

#### 2.2.1 config 注入机制

```
Vite 构建时 index.html 含占位符:
  window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;

web-ui-server.js 运行时替换 (v5.0.2.6 修复: 使用函数形式避免 $ 特殊模式):
  html = html.replace("__CC_CONFIG_PLACEHOLDER__", () => configJson)
  // ⚠️ 必须用函数形式! String.replace(str, replacement) 中 replacement 含 $& 等
  //    会被解释为特殊模式 ($& = 匹配的字符串)，导致 projectRoot="/path/$HOME" 被损坏

configJson = JSON.stringify({wsPort, wsToken, wsHost, projectRoot, projectName, mode})
  .replace(/</g, "\\u003c")   // XSS 防护
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
```

#### 2.2.2 项目级 vs 全局模式

| 特性 | 项目模式 (`mode: "project"`) | 全局模式 (`mode: "global"`) |
|------|------------------------------|------------------------------|
| 侧边栏横幅 | 蓝色，显示项目名称和路径 | 紫色，显示"全局模式" |
| 仪表板顶部 | 项目信息卡片（含路径） | 提示如何切换到项目级 |
| Chat 作用域 | 会话绑定 `projectRoot` | 会话无项目绑定 |
| Header 标签 | 蓝色文件夹图标 + 项目名 | 紫色地球图标 + "全局模式" |
| Dashboard 标题 | "项目`xxx`的系统概览" | "全局系统概览" |

#### 2.2.3 WebSocket 数据获取策略

面板不新增 WS 消息类型，而是通过现有 `execute` 命令调用 CLI 并解析输出：

```js
// 技能列表
const { output } = await ws.execute('skill list', 20000)

// LLM Providers
const { output } = await ws.execute('llm providers', 15000)

// 会话统计
const sessions = await ws.listSessions()
```

---

## 三、前端模块详解

### 3.1 WebSocket Store (`stores/ws.js`)

核心功能：
- 自动连接与指数退避重连（1s → 2s → 4s... 最大 30s）
- `sendRaw(payload, timeoutMs)` → Promise，通过 id 匹配响应
- `execute(command)` → `{ output, exitCode }`
- `executeJson(command)` → 解析 JSON 输出
- `createSession(type)` → 创建 chat/agent 会话，返回 sessionId
- `onSession(sessionId, handler)` → 注册流式消息回调
- 认证：启动时若有 `wsToken` 自动发送 `auth` 消息

### 3.2 四个视图模块

#### 仪表板 (Dashboard.vue)

- 4 个状态卡片：WebSocket 连接、活跃 LLM、技能数量、会话数
- 项目/全局模式差异化展示
- 快速操作按钮（新建对话、Agent 模式、浏览技能、LLM 配置）
- 运行信息表格（端口、认证状态、版本）

#### AI 对话 (Chat.vue)

- 左侧会话列表，顶部显示当前作用域（项目名/全局）
- 支持 Chat 和 Agent 两种会话类型
- 流式响应渲染（逐 token 显示 + 打字光标动画）
- 工具调用可视化（`tool-executing` → 折叠展示 → `tool-result`）
- 交互式 Q&A（`question` 消息 → 选项按钮或输入框）
- Markdown 渲染（marked.js + highlight.js 代码高亮）

#### 技能管理 (Skills.vue)

- 通过 `execute("skill list")` 获取技能列表，解析文本输出
- 搜索框实时过滤
- 分类 Tab（CLI、Agent、LLM、混合、内置）
- 技能卡片 Grid 布局，每个卡片有执行模式标签
- "运行"按钮 → 在 Chat 创建 Agent 会话并执行 `/skill run {name}`

#### LLM 配置 (Providers.vue)

- 显示 10 个已知 Provider（Anthropic、OpenAI、Ollama、Gemini 等）
- 活跃 Provider 绿色高亮边框
- "切换"按钮 → `execute("llm switch {name}")`
- "测试"按钮 → `execute("llm test")`，显示连接状态
- Ollama 本地模型列表

---

## 四、HTTP 服务器扩展

### 4.1 静态文件服务逻辑

```js
export function createWebUIServer(opts) {
  const distDir = findWebPanelDist(opts.staticDir)  // 自动检测 dist/

  if (distDir) {
    // ── 服务 Vue3 面板 ──
    return http.createServer((req, res) => {
      // 1. 拒绝非 GET 方法 (405)
      // 2. 静态资源：/assets/** → 文件内容 + 正确 MIME + 缓存
      // 3. SPA 路由：其他路径 → index.html + 注入 config
    })
  }

  // ── 回退到经典内嵌 HTML ──
  const html = buildHtml(opts)
  return http.createServer(...)
}
```

### 4.2 MIME 类型映射

| 扩展名 | MIME 类型 | 缓存策略 |
|--------|-----------|----------|
| `.html` | `text/html; charset=utf-8` | `no-store` |
| `.js`, `.mjs` | `application/javascript; charset=utf-8` | `immutable` (assets) |
| `.css` | `text/css; charset=utf-8` | `immutable` (assets) |
| `.svg` | `image/svg+xml` | `immutable` (assets) |
| `.woff`, `.woff2` | `font/woff`, `font/woff2` | `immutable` (assets) |
| `.json` | `application/json` | `immutable` (assets) |

### 4.3 安全措施

- **路径遍历防护**：`path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "")`
- **XSS 防护**：config JSON 中 `<`、`>`、`&` 转为 Unicode 转义
- **Method 限制**：非 GET 请求返回 405

---

## 五、构建与部署

### 5.1 构建命令

```bash
# 从项目根目录
npm run build:web-panel

# 或直接在 packages/web-panel/
cd packages/web-panel
npm install --legacy-peer-deps   # 注意：需 --legacy-peer-deps (Vite 7 + plugin-vue v5)
npm run build
```

### 5.2 构建产物

```
packages/web-panel/dist/
├── index.html              # 含 __CC_CONFIG_PLACEHOLDER__ 占位符
└── assets/
    ├── vendor-*.js         # Vue3 + Pinia + Vue Router (约 105KB)
    ├── antd-*.js           # Ant Design Vue (约 1.4MB)
    ├── markdown-*.js       # marked + highlight.js (约 1MB)
    ├── AppLayout-*.js/css  # 布局组件
    ├── Dashboard-*.js
    ├── Chat-*.js/css
    ├── Skills-*.js/css
    └── Providers-*.js/css
```

### 5.3 自动检测（三路查找）

`findWebPanelDist()` 在启动时按优先级查找 dist 目录（v5.0.2.6 新增第三路）：

1. **显式指定**：`--web-panel-dir <dir>` 选项 → 直接使用该目录
2. **源码树**：`packages/web-panel/dist/` → 开发者本地构建
3. **npm 包内置**：`packages/cli/src/assets/web-panel/` → npm 安装用户无需构建

若三路均未找到 → 回退到内嵌经典 HTML，兼容旧行为。

### 5.4 npm 用户无需手动构建（v5.0.2.6）

`packages/cli/package.json` 新增 `prepublishOnly` 钩子，在 `npm publish` 前自动执行：

```bash
# 执行顺序（自动）：
1. cd packages/web-panel && npm install --legacy-peer-deps && npm run build
2. 将 dist/ 复制到 packages/cli/src/assets/web-panel/
3. npm publish (包含 src/assets/web-panel/ 内置产物)
```

npm 用户安装后无需执行任何构建命令，`chainlesschain ui` 直接提供 Vue3 面板。

---

## 六、使用方式

```bash
# npm 安装用户（无需构建，开箱即用）
npm install -g chainlesschain
chainlesschain ui  # 直接使用内置 Vue3 面板

# 源码用户（首次使用或代码更新后需要执行）
npm run build:web-panel

# 启动项目级面板（在含 .chainlesschain/ 的项目目录下运行）
cd /your/project && chainlesschain ui
# → 面板绑定到该项目，AI 对话、技能运行均在项目上下文

# 启动全局面板（任意目录）
chainlesschain ui
# → 全局管理，不绑定特定项目

# 自定义端口
chainlesschain ui --port 8080 --ws-port 8081

# 指定 dist 目录（CI/CD 或自定义构建路径）
chainlesschain ui --web-panel-dir /path/to/dist

# 启用认证
chainlesschain ui --token my-secret-token

# 开发模式（热更新）
npm run dev:web-panel
# 前端 Vite dev server 在 localhost:5173
# 需要另起 chainlesschain ui 提供 WebSocket
```

---

## 七、测试覆盖

### 7.1 测试统计

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `__tests__/unit/web-ui-server.test.js` | 单元 | 66 |
| `__tests__/integration/ui-server-integration.test.js` | 集成 | 51 |
| `__tests__/e2e/ui-command.test.js` | E2E | 30 |
| **合计** | | **147** |

### 7.2 测试覆盖维度

**单元测试** (`web-ui-server.test.js`, 66 个测试)：
- 回退模式：config 注入、全局/项目模式差异、CDN 脚本标签
- Vue3 SPA 模式：staticDir 服务、MIME 类型、缓存头、SPA 回退路由
- 路径遍历防护：`/../secret.txt` 等路径不暴露 dist/ 外文件
- `$` 特殊字符修复：`$&`、`$'`、`$$` 在 projectRoot/wsToken 中不损坏 config
- 回退降级：nonexistent staticDir 自动使用内嵌 HTML
- 隔离机制：`FORCE_FALLBACK` sentinel 确保回退模式测试不依赖本地 dist/

**集成测试** (`ui-server-integration.test.js`, 51 个测试)：
- 生命周期：服务器启动/停止/并发
- Config 注入：6 个字段全部正确，回退和 SPA 两种模式
- 全局/项目模式差异
- 资产服务管道（JS/CSS/SVG/JSON）
- SPA 路由（/ + 4 个 Vue Router 路由）
- HTTP Method 限制（POST/DELETE/PUT → 405）
- 无 dist/ 回退模式

**E2E 测试** (`ui-command.test.js`, 30 个测试)：
- `--help`：7 个选项/默认值断言
- 无效参数：端口越界退出非零
- 全局模式服务器：启动、HTTP 200、HTML 有效、config 注入
- 项目模式服务器：mode='project'、projectRoot 正确、项目名
- `--token` 认证：wsToken 出现在 config
- `--web-panel-dir` (Vue3 SPA 模式)：6 个测试验证完整 SPA 管道

---

## 八、已知限制

1. **构建体积**：Ant Design Vue 约 1.4MB，highlight.js 约 1MB，首次加载较慢（已拆分 chunk）
2. **Skills 解析**：依赖 `skill list` 命令的文本输出格式，若 CLI 输出格式变化需同步更新解析逻辑
3. **实时更新**：仪表板数据非实时推送，需手动点击刷新
4. **移动端**：未针对手机浏览器优化，主要面向桌面浏览器
