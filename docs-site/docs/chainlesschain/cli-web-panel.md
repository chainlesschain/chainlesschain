# Vue3 Web 管理面板 (ui – v5.0.2.5)

> **版本**: v5.0.2.5 | 参考 [ClawPanel](https://github.com/qingchencloud/clawpanel) 设计，构建为独立 Vue3 前端应用。

`chainlesschain ui` 现已升级为完整的 Vue3 管理面板，包含 **仪表板、AI 对话、技能管理、LLM 配置** 四个功能模块，并清晰区分项目级和全局两种工作模式。

## 快速开始

```bash
# 首次使用前构建前端
npm run build:web-panel

# 项目级面板（在含 .chainlesschain/ 的目录下运行）
cd /your/project
chainlesschain ui

# 全局面板（任意目录）
chainlesschain ui

# 高级选项
chainlesschain ui --port 9000 --ws-port 9001
chainlesschain ui --token mysecret
chainlesschain ui --web-panel-dir /custom/dist   # 指定 dist 目录

# 热更新开发模式
npm run dev:web-panel
```

启动后访问：`http://127.0.0.1:18810`

## 四个功能模���

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

- 10 个 Provider 可视化（Anthropic、OpenAI、Ollama、Gemini 等）
- 活跃 Provider 绿色高亮边框 + "活跃"标签
- ��键切换活跃 Provider
- 连接测试
- Ollama 本地模型列表

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

Vue3 面板是一个独立前端项目（`packages/web-panel/`），需要单独构建：

```bash
# 从项目根目录构建（推荐）
npm run build:web-panel

# 或在 packages/web-panel/ 内手动构建
cd packages/web-panel
npm install --legacy-peer-deps
npm run build
```

> **注意**：安装时需加 `--legacy-peer-deps`，因为 `@vitejs/plugin-vue@5.x` 与 Vite 7 存在 peer dep 声明不匹配问题。

构建产物在 `packages/web-panel/dist/`，`web-ui-server.js` 启动时自动检测此目录：
- **存在** → 服务 Vue3 面板
- **不存在** → 自动回退到内嵌经典 HTML（兼容旧行为）

## 技术架构

```
packages/web-panel/           Vue3 + Vite + Ant Design Vue
├── src/stores/ws.js          WebSocket 连接管理（指数退避重连）
├── src/stores/chat.js        会话与消息状态
├── src/stores/skills.js      技能列表与过滤
├── src/stores/providers.js   LLM Provider 管理
└── src/components/
    └── AppLayout.vue         侧边栏布局（含项目/全局模式标识）
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

## 自动降级

当 `packages/web-panel/dist/` 不存在时，服务器自动回退到经典内嵌 HTML 模式：

```
dist/ 存在 → Vue3 管理面板（完整 Dashboard/Chat/Skills/Providers）
dist/ 不存在 → 经典 HTML（AI 对话基础功能）
```

## 与旧版对比

| 特性 | v5.0.2.3 经典 HTML | v5.0.2.5 Vue3 面板 |
|------|-------------------|-------------------|
| 构建 | 无需构建，内嵌 | 需 `npm run build:web-panel` |
| 功能 | 仅 AI 对话 | 4 个模块（仪表板/对话/技能/LLM）|
| 技能管理 | ❌ | ✅ 138+ 技能可视化浏览与运行 |
| LLM 配置 | ❌ | ✅ 10 个 Provider 切换 |
| 仪表板 | ❌ | ✅ 服务状态卡片 |
| 项目/全局区分 | ✅ | ✅ 更清晰的视觉区分 |
| 工具调用可视化 | ✅ | ✅ 折叠卡片 |

## 测试覆盖

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `web-panel-server.test.js` | 单元 | 37 |
| `commands-ui.test.js`（新增） | 单元 | +4 |
| `web-panel-server-integration.test.js` | 集成 | 31 |
| `web-panel-e2e.test.js` | E2E | 24 |
| **合计新增** | | **96** |

## 相关文档

- [Web 管理界面 v5.0.2.3](./cli-ui) — 经典 HTML 版本说明
- [设计文档 — 模块 75](../design/modules/75-web-panel) — 完整技术架构文档
- [WebSocket 服务器 (serve)](./cli-serve) — 程序化 API 接口
- [技能系统 (skill)](./cli-skill) — 技能管理详情
