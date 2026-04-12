# Web 管理界面（ui）

> `chainlesschain ui` 会启动本地 Web 管理面板，并自动连接内置 WebSocket 服务。当前文档已对齐统一 runtime event、session record、后台任务增强、Worktree 合并助手和压缩观测的最新实现。

## 概述

`ui` 命令启动本地浏览器管理界面（HTTP 端口 18810 + WebSocket 端口 18800），将 CLI 已有能力以可视化方式呈现，覆盖 23 个页面（Dashboard、AI 对话、服务管理、技能配置、安全中心、P2P 网络等）。支持项目模式和全局模式，前端通过统一事件模型与 Runtime/WS Gateway 实时通信。

## 这是什么

`chainlesschain ui` 是 ChainlessChain 的本地浏览器管理界面。它的目标不是替代 CLI，而是把 CLI 已有能力以更适合观察、切换和联调的方式呈现出来。

它适合以下场景：

- 用浏览器管理 Agent / Chat 会话
- 查看后台任务、任务历史和完成通知
- 查看压缩策略观测与会话运行状态
- 在项目模式下，把对话绑定到某个项目根目录
- 作为 `chainlesschain serve` 的内置前端使用

## 启动后会发生什么

执行：

```bash
chainlesschain ui
```

会同时启动两类服务：

- HTTP 服务，默认端口 `18810`
- WebSocket 服务，默认端口 `18800`

浏览器页面负责展示界面，真正的会话、任务和运行状态仍然由本地 CLI 侧的 Runtime / WS Gateway 负责。

## 常用命令

```bash
chainlesschain ui
chainlesschain ui --port 9000 --ws-port 9001
chainlesschain ui --token my-secret-token
chainlesschain ui --no-open
chainlesschain ui --web-panel-dir /custom/dist
```

常见用法：

- 本机直接使用：`chainlesschain ui`
- 联调其它前端或保留浏览器手动打开：`chainlesschain ui --no-open`
- 需要认证：`chainlesschain ui --token my-secret-token`
- 使用自定义构建产物：`chainlesschain ui --web-panel-dir /custom/dist`

## 运行模式

### 项目模式

从包含 `.chainlesschain/` 的目录启动时，UI 会自动进入项目模式，并把 `projectRoot` 注入会话上下文。

适合：

- 面向单个项目持续对话
- 让 Agent 工具调用更明确地绑定项目目录
- 区分项目级会话和全局会话

### 全局模式

从普通目录启动时，UI 作为全局管理面板运行。

适合：

- 通用 AI 对话
- 查看全局会话
- 调试 Provider、技能和系统能力

## 页面能力概览

当前 Web Panel 覆盖 23 个页面，分为七大类：

**概览**：Dashboard、AI 对话、服务管理、日志查看

**配置**：技能管理、LLM 配置、MCP 工具

**数据**：笔记管理、记忆文件、定时任务、后台任务

**高级**：安全中心、权限管理、P2P 网络、备份同步、Git 与数据、项目管理

**企业**：钱包管理、组织管理、使用分析、模板中心

**扩展**：RSS 订阅、身份认证

### Dashboard

Dashboard 负责展示全局摘要，而不是完整业务细节。当前已经能看到：

- 会话数量
- 压缩观测摘要
- 时间窗口筛选后的统计
- 按 `provider` / `model` 切片的观测结果

### Chat / Agent 会话

会话区域支持：

- 新建 Agent / Chat 会话
- 切换历史会话
- 恢复会话 history
- 流式 token 输出
- 工具执行过程可视化
- 交互式问题回答

### 后台任务

任务区域已对齐当前任务协议能力，支持：

- 查询任务列表
- 查询任务详情
- 查询任务历史分页
- 接收 `task:notification`
- 查看任务输出摘要

### 压缩观测

压缩观测现在不是只显示一个总数字，而是支持：

- `windowMs` 时间窗口筛选
- `provider` / `model` 维度切片
- 命中率
- 节省 token
- 净节省率
- 策略分布
- 变体分布

## 当前前端事件模型

Web Panel 已开始统一通过 `onRuntimeEvent()` 消费后端事件，而不是每个页面都直接监听原始 WS 消息。

已归一化的消息包括：

| 协议消息 | 统一事件 |
|------|------|
| `task:notification` | `task:notification` |
| `session-created` | `session:start` |
| `session-resumed` | `session:resume` |
| `worktree-diff` | `worktree:diff:ready` |
| `worktree-merged` | `worktree:merge:completed` |
| `compression-stats` | `compression:summary` |

当前已接入统一事件入口的前端模块：

- `ws.js`
- `tasks.js`
- `chat.js`
- `dashboard.js`

这一步的意义是：

- 前端主干页面开始共享一套标准事件流
- 协议字段扩展时，不需要每个页面都重写一遍适配逻辑
- Runtime / WS / Panel 三层开始真正共享同一模型

## 三类消息在前端的分工

当前前端实际同时接触三类消息：

### 1. 协议响应

用于回答某次主动请求的返回值。

典型包括：

- `session-list-result`
- `tasks-list`
- `tasks-detail`
- `tasks-history`
- `worktree-diff`
- `worktree-merged`
- `compression-stats`

### 2. Runtime Event

用于描述“系统状态发生了什么”，由 `ws.js` 归一化后通过 `onRuntimeEvent()` 广播。

典型包括：

- `session:start`
- `session:resume`
- `session:end`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

### 3. Session Stream

用于描述当前会话的流式输出过程，主要由 `chat.js` 直接消费。

典型包括：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

当前口径是：

- `ws.js` 负责协议响应 → runtime event 的归一化
- `chat.js` 继续直接消费 session stream
- 不要求把所有流式 token 消息都迁进 `onRuntimeEvent()`

## Session Record

会话相关数据现在统一附带 `record`，用于让前后端对齐会话摘要结构。

标准字段包括：

- `id`
- `type`
- `provider`
- `model`
- `projectRoot`
- `messageCount`
- `history`
- `status`

当前会返回 `record` 的消息：

- `session-created`
- `session-resumed`
- `session-list-result`

这意味着无论是：

- 被动收到会话创建/恢复响应
- 主动拉取会话列表

前端拿到的都是同一套 session summary 结构。

## 会话流转

一个典型会话流程如下：

1. UI 建立 WebSocket 连接
2. 如果配置了 token，先发送 `auth`
3. 拉取 `session-list`
4. 创建新会话，或恢复已有会话
5. 发送 `session-message`
6. 接收：
   - `response-token`
   - `tool-executing`
   - `tool-result`
   - `question`
   - `response-complete`

当前还有两个重要细节：

- 会话关闭后，前端会本地补发 synthetic `session:end`，保持统一事件流连续。
- 当本地没有缓存消息时，切换会话会自动调用 `session-resume` 拉回 history。

## WebSocket 协议要点

| 事件 | 方向 | 说明 |
|------|------|------|
| `auth` | →服务端 | 发送 token 认证 |
| `auth-result` | ←服务端 | 返回认证结果 |
| `session-list` | →服务端 | 请求会话列表 |
| `session-list-result` | ←服务端 | 返回会话列表，`sessions[]` 每项带 `record` |
| `session-create` | →服务端 | 创建新会话 |
| `session-created` | ←服务端 | 返回 `sessionId`、`sessionType`、`record` |
| `session-resume` | →服务端 | 恢复历史会话 |
| `session-resumed` | ←服务端 | 返回 `history[]` 与 `record` |
| `session-close` | →服务端 | 关闭会话 |
| `tasks-list` | →服务端 | 查询后台任务 |
| `tasks-history` | →服务端 | 查询任务历史分页 |
| `tasks-detail` | →服务端 | 查询任务详情 |
| `compression-stats` | →服务端 | 查询压缩观测摘要 |
| `worktree-diff` | →服务端 | 查询 diff 预览 |
| `worktree-merge` | →服务端 | 执行一键合并 |

## 与 `serve` 的关系

- `ui` 面向浏览器用户，是完整管理界面入口。
- `serve` 面向外部接入，是 WS Gateway 入口。
- 二者不是两套完全独立系统，而是前后配合：
  - `ui` 负责页面
  - `serve` / 内置 WS 服务负责协议与 Runtime 暴露

如果你只是想打开浏览器管理界面，优先使用 `chainlesschain ui`。如果你要把 CLI 接到 IDE、插件或自定义前端，优先使用 `chainlesschain serve`。

## 常见联调点

### 1. 页面有了，但状态不更新

优先检查：

- 是否已经通过 `onRuntimeEvent()` 订阅
- 当前消息是协议响应还是统一事件
- `sendRaw()` 的 pending resolve 之后，事件是否仍然继续广播

### 2. 会话列表和会话详情字段不一致

优先检查：

- `session-list-result.sessions[]` 是否带 `record`
- `session-created` / `session-resumed` 是否带 `record`
- 前端 `listSessions()` 是否做了统一归一化

### 3. 任务页没有收到完成通知

优先检查：

- 是否有 `task:notification`
- 任务页是否在消费 `onRuntimeEvent()`
- 后台任务是否已经完成持久化与恢复初始化

### 4. Dashboard 统计不对

优先检查：

- `compression-stats` 是否带了 `windowMs`
- `provider` / `model` 筛选参数是否透传
- 统计是否来自统一 runtime event，而不是旧的局部手动赋值

### 安全中心

安全中心覆盖三大模块：

- **DID 身份管理**：列表、创建、签名验证
- **文件加解密**：AES-256-GCM 加密/解密
- **审计日志**：事件列表、统计卡片

### P2P 网络

P2P 页面支持：

- 设备列表与在线状态
- 配对新设备
- 发送加密消息
- 同步状态查看与推送/拉取操作

### Git 与数据

Git 页面包含两个 Tab：

- **Git 仓库**：分支显示、变更计数、自动提交（带确认弹窗）
- **导入导出**：Markdown/PDF/Evernote 导入、静态站点导出

### 项目管理

项目页面支持：

- 项目状态卡片（系统状态、LLM、初始化、配置）
- 6 个项目模板初始化
- 环境诊断（`doctor` 命令）

## 当前验证

- Web Panel 单元测试：`523/523`（9 个文件，含批次 1+2 页面解析测试）
- Web Panel 集成测试：`40/40`（web-ui-server + CLI 命令集成）
- Web Panel E2E：`12/12`（WS 协议兼容） + `46` SPA 路由 + 资源文件测试
- Web Panel 构建：通过

## 关联文档

- [WebSocket 服务（serve）](/chainlesschain/cli-serve)
- [Agent 架构优化](/chainlesschain/agent-optimization)
- [设计文档索引](/design/)
- [设计模块：Web 管理界面](/design/modules/73-web-ui)
- [设计模块：Web 管理面板](/design/modules/75-web-panel)
