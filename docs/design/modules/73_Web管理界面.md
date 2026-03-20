# 模块 73: Web 管理界面 (chainlesschain ui)

> **版本**: v5.0.2.3
> **状态**: ✅ 完成（协议修复）
> **测试**: 103 个测试（47 单元 + 32 集成 + 24 E2E）
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

- **零构建步��**：Web UI 作为单页 HTML 内嵌在 HTTP 响应中，无需 webpack/vite 构建
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

### 2.2 前端与后端通信协议（v2 — 修正版）

Web UI 前端通过 WebSocket 与后端通信，完整协议如下：

```
前端                                         后端 (WSServer)
 │                                                │
 │──{ id, type:"auth", token }─────────────────►│
 │◄─{ id, type:"auth-result", success:true }────│  ← 注意：auth-result，含 success 字段
 │                                                │
 │──{ id, type:"session-list" }────────────────►│
 │◄─{ id, type:"session-list-result",            │  ← 注意：session-list-result
 │    sessions:[...] }──────────────────────────│
 │                                                │
 │──{ id, type:"session-create",                  │
 │    sessionType:"agent"|"chat",                 │
 │    projectRoot }──────────────────────────────►│
 │◄─{ id, type:"session-created",                 │  ← 注意：只有 sessionId/sessionType
 │    sessionId, sessionType }──────────────────│
 │                                                │
 │──{ id, type:"session-message",                 │
 │    sessionId, content }────────────────────────►│
 │                                                │
 │  ── Chat 模式（逐 token 流式）─────────────── │
 │◄─{ type:"response-token",                      │  ← 注意：非 stream-data
 │    sessionId, token }(×N)────────────────────│
 │◄─{ type:"response-complete",                   │  ← 注意：非 stream-end
 │    sessionId, content }──────────────────────│
 │                                                │
 │  ── Agent 模式（非流式，工具调用可见）─────── │
 │◄─{ type:"tool-executing",                      │
 │    sessionId, tool, display }────────────────│
 │◄─{ type:"tool-result",                         │
 │    sessionId, tool, result }─────────────────│
 │◄─{ type:"model-switch",                        │
 │    sessionId, from, to, reason }─────────────│
 │◄─{ type:"response-complete",                   │
 │    sessionId, content }──────────────────────│
 │                                                │
 │  ── 交互式问答（slot-filling）──────────────  │
 │◄─{ type:"question",                            │
 │    sessionId, requestId, question, choices }──│
 │──{ id, type:"session-answer",                  │
 │    sessionId, requestId, answer }─────────────►│
```

> **关键差异（v1 → v2）**：
>
> | 事项 | v1（错误） | v2（正确） |
> |------|-----------|-----------|
> | 认证响应 | `auth-ok` | `auth-result` + `{ success }` |
> | 会话列表响应 | `session-list` | `session-list-result` |
> | 创建会话响应 | `{ session: { id, ... } }` | `{ sessionId, sessionType }` |
> | 流式 token | `stream-data` | `response-token` |
> | 流式结束 | `stream-end` | `response-complete` |
> | 消息 id | 不发送 | 每条消息自动注入 `id: "ui-N"` |

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

**消息 id 自动注入**（v2 新增）：
```javascript
let _msgId = 0;
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // 每条发出的消息自动追加唯一 id（服务端要求）
    if (!obj.id) { obj = Object.assign({ id: 'ui-' + (++_msgId) }, obj); }
    ws.send(JSON.stringify(obj));
  }
}
```

**前端功能**：
- Markdown 渲染（marked.js CDN + highlight.js CDN）
- WebSocket 流式接收（`response-token` × N → `response-complete`）
- Agent 工具事件展示（`tool-executing` 显示为系统消息）
- 会话管理（新建/切换/历史，Agent/Chat 模式）
- 交互式问答弹窗（slot-filling 支持）
- 自动重连（断线后 3s 重试）

---

## 四、文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/cli/src/commands/ui.js` | 新增 | 命令注册与服务器控制器 |
| `packages/cli/src/lib/web-ui-server.js` | 修改 | HTTP 服务器 + 单页 HTML（v2 协议修复） |
| `packages/cli/src/index.js` | 修改 | 注册 `registerUiCommand` |
| `CLAUDE.md` | 修改 | 更新命令文档 |
| `__tests__/unit/web-ui-server.test.js` | 修改 | 单元测试（47 个，+21 协议验证测试） |
| `__tests__/unit/commands-ui.test.js` | 新增 | 单元测试（18 个） |
| `__tests__/integration/ui-server-integration.test.js` | 修改 | 集成测试（32 个，+3 修复 +3 新增） |
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
- **集成测试**：真实 HTTP 服务器，loopback 请求，验证完整 HTML 输出；"embedded WebSocket client" 套件验证前端 JS 包含正确的 v2 协议事件名
- **E2E 测试**：通过 `spawn()` 启动真实 CLI 二进制，等待 URL 出现后发起 HTTP 请求，`beforeAll/afterAll` 管理进程生命周期，`SIGTERM + SIGKILL` 兜底清理

### 6.1 协议回归测试（防止再次引入协议不匹配）

`__tests__/unit/web-ui-server.test.js` 中 `"createWebUIServer – WS client protocol correctness"` 套件（21 个测试）：

```
✓ send() 自动注入 id 字段（_msgId 计数器）
✓ 处理 auth-result 事件（不是 auth-ok）
✓ 不包含废弃的 auth-ok case
✓ 不包含废弃的 auth-error case
✓ session-created 读取 msg.sessionId（不是 msg.session.id）
✓ session-created 不访问 msg.session.id/type/createdAt
✓ 处理 session-list-result 事件
✓ 处理 response-token 事件（聊天流式）
✓ 处理 response-complete 事件（最终响应）
✓ 不包含废弃的 stream-start case
✓ 不包含废弃的 stream-data case（作为接收事件）
✓ 不包含废弃的 stream-end case
✓ 处理 tool-executing 事件（Agent 工具展示）
✓ 处理 model-switch 事件
✓ 处理 command-response 事件
✓ 发送 session-create（新建会话）
✓ 发送 session-message（用户消息）
✓ 发送 session-answer（问答回复）
```

---

## 七、已知 Bug 与修复记录

### v5.0.2.2 → v5.0.2.3：WS 协议修复

**问题**：Web UI 前端与 `ChainlessChainWSServer` 之间存在 5 处协议不匹配，导致对话无法进行、会话无法切换。

| # | 根因 | 前端错误行为 | 修复 |
|---|------|------------|------|
| 1 | 所有消息缺少 `id` 字段 | 所有消息被服务端以 `MISSING_ID` 拒绝 | `send()` 自动注入 `id: 'ui-N'` |
| 2 | 认证响应类型错误 | `auth-ok` → 永远不触发，WebSocket 卡在"未认证"状态 | 改为处理 `auth-result`，检查 `msg.success` |
| 3 | 会话创建响应格式错误 | 访问 `msg.session.id`（undefined），会话 ID 丢失 | 改用 `msg.sessionId` / `msg.sessionType` |
| 4 | 会话列表响应类型错误 | `session-list` case → 永远不触发，侧栏始终为空 | 改为处理 `session-list-result` |
| 5 | 流式响应事件名错误 | `stream-data`/`stream-end` case → 永远不触发，AI 回复无法显示 | 改为处理 `response-token`/`response-complete` |
