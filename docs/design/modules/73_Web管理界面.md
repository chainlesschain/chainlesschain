# 模块 73: Web 管理界面 (chainlesschain ui)

> **版本**: v5.0.2.2
> **状态**: ✅ 完成
> **测试**: 99 个测试（46 单元 + 29 集成 + 24 E2E）
> **新增文件**: `packages/cli/src/commands/ui.js`, `packages/cli/src/lib/web-ui-server.js`
> **新增测试**: `__tests__/unit/web-ui-server.test.js`, `__tests__/unit/commands-ui.test.js`, `__tests__/integration/ui-server-integration.test.js`, `__tests__/e2e/ui-command.test.js`

---

## 一、背景与目标

### 1.1 问题陈述

ChainlessChain CLI 此前只提供终端交互（`chainlesschain chat`、`chainlesschain agent`）和 WebSocket 接口（`chainlesschain serve`）。用户需要一种**浏览器端可视化方式**来：

1. 在项目目录中直接与项目 AI Agent 进行对话（携带项目上下文）
2. 在任意目录快速打开全局管理面板进行通用 AI 对话
3. 无需安装额外软件，一条命令即可启动完整 Web 交互界面
4. 支持 Markdown 渲染、代码高亮、流式输出、交互式问答等富交互功能

### 1.2 设计原则

- **零构建步骤**：Web UI 作为单页 HTML 内嵌在 HTTP 响应中，无需 webpack/vite 构建
- **复用现有基础设施**：直接复用 `ChainlessChainWSServer` + `WSSessionManager`
- **项目感知**：自动检测 `.chainlesschain/config.json`，无需手动配置
- **安全优先**：JSON 配置注入使用 Unicode 转义防止 XSS

---

## 二、架构设计

### 2.1 整体流程

```
用户执行 chainlesschain ui
         │
         ▼
  findProjectRoot(cwd)
         │
    ┌────┴────┐
    │有项目根 │  无项目根
    ▼         ▼
  项目模式  全局模式
    │         │
    └────┬────┘
         ▼
  bootstrap() → 初始化 DB（可选）
         │
         ▼
  WSSessionManager + ChainlessChainWSServer.start()
  (WebSocket 服务器，默认端口 18800)
         │
         ▼
  createWebUIServer() → HTTP 服务器
  (HTTP 服务器，默认端口 18810)
         │
         ▼
  openBrowser(http://127.0.0.1:18810)
         │
         ▼
  浏览器连接 → WebSocket 握手 → 开始对话
```

### 2.2 前端与后端通信协议

Web UI 前端通过 WebSocket 与后端通信，复用现有 `ChainlessChainWSServer` 协议：

```
前端                                    后端 (WSServer)
 │                                           │
 │──{ type:"auth", token }──────────────────►│
 │◄─{ type:"auth-ok" }──────────────────────│
 │                                           │
 │──{ type:"session-create",                 │
 │    sessionType:"agent",                   │
 │    projectRoot }──────────────────────────►│
 │◄─{ type:"session-created", session }──────│
 │                                           │
 │──{ type:"session-message",                │
 │    sessionId, content }───────────────────►│
 │◄─{ type:"stream-start" }─────────────────│
 │◄─{ type:"stream-data", data }(×N)────────│
 │◄─{ type:"stream-end" }───────────────────│
 │                                           │
 │◄─{ type:"question",                       │
 │    message, choices, requestId }──────────│ (slot-filling)
 │──{ type:"session-answer",                 │
 │    answer, requestId }────────────────────►│
```

---

## 三、实现细节

### 3.1 `src/commands/ui.js`

**核心职责**：命令注册、项目检测、服务器启停、浏览器打开

关键设计点：
1. **`listen` 回调修复**：`server.listen(port, host, callback)` 中回调不接收错误参数，错误通过 `error` 事件传递。使用 `try/catch + Promise` 正确处理。
2. **优雅关闭**：`Promise.all([httpClose, wsStop])` 并行等待两个服务器关闭，再执行 `process.exit(0)`。
3. **跨平台浏览器打开**：`start`（Windows）/ `open`（macOS）/ `xdg-open`（Linux）。

### 3.2 `src/lib/web-ui-server.js`

**核心职责**：HTTP 服务器工厂 + 完整单页 HTML 生成

**安全处理**：
```javascript
// XSS 防护：JSON 内嵌到 <script> 时转义 HTML 特殊字符
const cfg = JSON.stringify(data)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026");

// URL 路径处理：正确剥离 query string 后再比较
const urlPath = req.url.split("?")[0];
if (req.method !== "GET" || (urlPath !== "/" && urlPath !== "/index.html")) {
  res.writeHead(404, ...);
}
```

**前端功能**：
- Markdown 渲染（marked.js CDN + highlight.js CDN）
- WebSocket 流式接收（`stream-start` → `stream-data` → `stream-end`）
- 会话管理（新建/切换/历史）
- 交互式问答弹窗（slot-filling 支持）
- 自动重连（断线后 3s 重试）
- Agent/Chat 模式切换

---

## 四、文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/cli/src/commands/ui.js` | 新增 | 命令注册与服务器控制器 |
| `packages/cli/src/lib/web-ui-server.js` | 新增 | HTTP 服务器 + 单页 HTML |
| `packages/cli/src/index.js` | 修改 | 注册 `registerUiCommand` |
| `CLAUDE.md` | 修改 | 更新命令文档 |
| `__tests__/unit/web-ui-server.test.js` | 新增 | 单元测试（28 个） |
| `__tests__/unit/commands-ui.test.js` | 新增 | 单元测试（18 个） |
| `__tests__/integration/ui-server-integration.test.js` | 新增 | 集成测试（29 个） |
| `__tests__/e2e/ui-command.test.js` | 新增 | E2E 测试（24 个） |

---

## 五、使用示例

```bash
# 基本用法（自动检测模式）
cd /your/project && chainlesschain ui   # 项目模式
chainlesschain ui                        # 全局模式（非项目目录）

# 自定义端口
chainlesschain ui --port 9000 --ws-port 9001

# 后台服务器（不打开浏览器）
chainlesschain ui --no-open

# 安全认证
chainlesschain ui --token mysecret
```

启动后访问：`http://127.0.0.1:18810`

---

## 六、测试说明

测试遵循项目标准测试模式：

- **单元测试**：直接 import 模块，使用随机端口（`port: 0`）进行 HTTP 请求，`beforeEach/afterEach` 管理生命周期
- **集成测试**：真实 HTTP 服务器，loopback 请求，验证完整 HTML 输出
- **E2E 测试**：通过 `spawn()` 启动真实 CLI 二进制，等待 URL 出现后发起 HTTP 请求，`beforeAll/afterAll` 管理进程生命周期，`SIGTERM + SIGKILL` 兜底清理
