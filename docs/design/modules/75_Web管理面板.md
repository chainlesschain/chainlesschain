# 75. Web 管理面板

**版本**: v5.0.2.11  
**创建日期**: 2026-03-20  
**最近更新**: 2026-04-09  
**状态**: 已实现，15 页面完整覆盖，v1.0 Envelope 协议兼容已修复

---

## 1. 背景

模块 73 解决了“如何打开浏览器界面”的问题，模块 75 解决的是“浏览器里到底呈现什么、如何组织状态、如何和 CLI Runtime 协同”。

Web Panel 的目标，不只是给 `chainlesschain ui` 换一个更好看的外壳，而是提供一套可观察、可切换、可验证的前端管理界面，用来承接：

- 会话管理
- Dashboard 观测
- 后台任务
- Worktree 结果查看
- Provider 与技能管理
- 压缩策略观测

随着 CLI Agent Runtime 重构推进，Web Panel 当前已经不再是“硬编码消费一堆 WS 消息”的状态，而开始围绕统一 runtime event 进行收口。

---

## 2. 设计目标

### 2.1 可视化承接 CLI 能力

把原本只能通过命令行查看和操作的能力，以浏览器方式呈现出来。

### 2.2 保持与 CLI Runtime 同步演进

面板不是独立后端产品，它必须和：

- runtime contracts
- WS 协议
- harness 能力

保持同一节奏，否则很快会发生“文档写一套、代码实现一套、前端展示又是一套”的问题。

### 2.3 从零散消息迁移到统一事件流

当前前端设计的关键目标，是从“每个页面各自监听原始 WS 消息”迁移到“统一通过 `onRuntimeEvent()` 消费”。

### 2.4 允许渐进式前端演进

即使后端协议继续演进，也应尽量通过：

- 统一 `record`
- 统一 runtime event
- store 归一化

来降低页面层的修改成本。

---

## 3. 当前代码结构

关键目录：

- `packages/web-panel/src/components/`
- `packages/web-panel/src/router/`
- `packages/web-panel/src/stores/`
- `packages/web-panel/src/views/`
- `packages/web-panel/src/utils/`

关键 store：

- `ws.js`
- `chat.js`
- `tasks.js`
- `dashboard.js`
- `skills.js`
- `providers.js`
- `theme.js`

关键页面（15 个）：

- `Dashboard.vue` — 仪表板（会话统计、压缩观测、系统摘要）
- `Chat.vue` — AI 对话（Agent/Chat 双模式、流式输出、工具执行）
- `Tasks.vue` — 后台任务（列表、详情、历史分页、通知）
- `Skills.vue` — 技能管理（四层技能列表、搜索）
- `Providers.vue` — LLM 配置（Provider 切换、模型/API Key/温度/maxTokens 设置）
- `Services.vue` — 服务管理（Docker 服务状态）
- `Logs.vue` — 日志查看（实时日志流）
- `Notes.vue` — 笔记管理（CRUD、搜索、标签）
- `McpTools.vue` — MCP 工具（服务器列表、工具发现）
- `Memory.vue` — 记忆文件（持久记忆管理）
- `Cron.vue` — 定时任务（定时任务列表与管理）
- `Security.vue` — 安全中心（DID 身份管理、文件加解密、审计日志）
- `P2P.vue` — P2P 网络（设备列表、配对、消息发送、同步状态）
- `Git.vue` — Git 与数据（仓库状态、自动提交、导入导出）
- `Projects.vue` — 项目管理（项目初始化、模板选择、环境诊断）

---

## 4. 系统架构

整体结构可以理解为：

```text
浏览器
  |
  v
Vue3 + Pinia Web Panel
  |
  +--> ws.js 负责连接、请求与事件归一化
  +--> chat/tasks/dashboard 等 store 负责状态建模
  |
  v
chainlesschain 内置 WS 服务
  |
  v
CLI Runtime / Gateway / Harness
```

这里最重要的变化是：

- `ws.js` 不再只是“发消息 + 收消息”的薄封装
- 它开始承担统一 runtime event 入口和 session summary 归一化职责

---

## 5. 页面能力

### 5.1 Dashboard

Dashboard 提供全局摘要视图，当前重点展示：

- 会话数量
- 压缩观测摘要
- 策略命中率
- 节省 token
- 净节省率
- 按 `provider` / `model` 切片的统计

### 5.2 Chat / Agent

对话页承担最核心的交互能力，支持：

- Agent / Chat 两种模式
- 流式 token 输出
- 工具执行过程展示
- 会话新建 / 恢复 / 切换 / 关闭
- 交互式问题回答

### 5.3 Tasks

任务页当前已经对齐后台任务增强能力，支持：

- 任务列表
- 任务详情
- 任务历史分页
- 实时 `task:notification`
- 输出摘要

### 5.4 其它管理页

还包括：

- Skills — 技能管理
- Providers — LLM 配置（增强：支持 provider/model/apiKey/baseUrl/temperature/maxTokens 设置）
- Services — 服务管理
- Logs — 日志查看
- Notes — 笔记管理
- MCP Tools — MCP 工具
- Memory — 记忆文件
- Cron — 定时任务

### 5.5 新增高级管理页（v5.0.2.11）

v5.0.2.11 新增 4 个从 Desktop 迁移的高价值页面：

- **Security（安全中心）**
  - DID 身份管理：列表、创建、默认标记、签名验证
  - 文件加解密：AES-256-GCM 加密/解密
  - 审计日志：事件列表、统计卡片
  - 命令：`did list/create/sign`、`encrypt/decrypt file`、`audit log/stats`

- **P2P（P2P 网络）**
  - 设备列表：Peer ID、名称、连接状态
  - 配对设备：设备名称输入、确认
  - 消息发送：选择 Peer、输入消息
  - 同步状态：在线/离线、待同步数、推送/拉取
  - 命令：`p2p peers/pair/send`、`sync status/push/pull`

- **Git（Git 与数据）**
  - Git 仓库：分支显示、变更计数、自动提交（带确认弹窗）
  - 导入导出：Markdown/PDF/Evernote 导入、静态站点导出
  - 命令：`git status/auto-commit`、`import/export`

- **Projects（项目管理）**
  - 项目状态卡片：系统状态、LLM 提供商、初始化状态、配置加载
  - 6 个项目模板初始化：code-project、medical-triage、agriculture-expert、general-assistant、ai-media-creator、ai-doc-creator
  - 环境诊断：`doctor` 命令输出
  - 命令：`status`、`config list`、`init --template`、`doctor`

---

## 6. 当前事件模型

Web Panel 已开始统一通过 `onRuntimeEvent()` 消费后端事件，而不是每个页面都直接监听原始 WS 消息。

当前已归一化的典型消息包括：

- `task:notification` → `task:notification`
- `session-created` → `session:start`
- `session-resumed` → `session:resume`
- `worktree-diff` → `worktree:diff:ready`
- `worktree-merged` → `worktree:merge:completed`
- `compression-stats` → `compression:summary`

当前已经接入统一入口的 store：

- `ws.js`
- `chat.js`
- `tasks.js`
- `dashboard.js`

这一步的价值在于：

- 页面层不必继续维护多套旧字段
- 后端协议扩展时，前端主要在 `ws.js` 做一次归一化即可
- Runtime / WS / Panel 三层的数据模型开始对齐

### 6.1 三类消息在前端的分工

当前前端侧实际存在三类消息，不应混为一谈：

#### 1. 协议响应

由 `sendRaw()` 或其它主动请求拿回来的结果，典型包括：

- `session-list-result`
- `tasks-list`
- `tasks-detail`
- `tasks-history`
- `worktree-diff`
- `worktree-merged`
- `compression-stats`

这类消息回答的是“这次请求拿到了什么数据”。

#### 2. Runtime Event

由 `ws.js` 归一化后，通过 `onRuntimeEvent()` 广播给 store，典型包括：

- `session:start`
- `session:resume`
- `session:end`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

这类消息回答的是“系统状态发生了什么变化”。

#### 3. Session Stream

由会话专用 channel 直接消费，当前主要留在 `chat.js` 中处理，典型包括：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

这类消息回答的是“当前对话流正在输出什么”。

当前策略是：

- `ws.js` 负责协议响应 → runtime event 的归一化
- `chat.js` 继续直接消费 session stream
- 不要求所有流式消息都迁入 `onRuntimeEvent()`

---

## 7. Session Contract 对齐

Session 相关链路当前已经开始通过标准 `record` 对齐。

统一字段包括：

- `id`
- `type`
- `provider`
- `model`
- `projectRoot`
- `messageCount`
- `history`
- `status`

当前会带 `record` 的消息：

- `session-created`
- `session-resumed`
- `session-list-result`

这意味着：

- 主动拉取会话列表
- 被动收到创建或恢复响应

前端最终拿到的是同一套 session summary 结构。

---

## 8. 当前关键实现点

### 8.1 `ws.js`

承担：

- 建立 WS 连接
- token 认证
- 请求发送
- pending promise 管理
- runtime event 归一化
- session summary 归一化

这是当前 Web Panel 的“协议核心层”。

### 8.2 `chat.js`

承担：

- 会话列表与当前会话管理
- 历史消息恢复
- 流式消息拼接
- tool / question / answer 交互状态

### 8.3 `tasks.js`

承担：

- 任务列表、详情、历史
- 任务通知消费
- 任务停止与刷新

### 8.4 `dashboard.js`

承担：

- Dashboard 汇总状态
- 压缩统计查询
- runtime event 驱动下的会话数与压缩摘要更新

---

## 9. 当前演进状态

Web Panel 已从早期“页面直接调用零散协议消息”的形态，演进到当前的两个关键方向：

1. session record 标准化
2. runtime event 统一消费

目前可以认为主干已经收口了一半：

- 主干 store 已进入统一事件流
- 但其它页面仍需要继续清查是否还有旧的原始消息依赖

这也是 Phase 4 尚未完全结束的原因。

---

## 10. 当前风险点

### 10.1 主干收口完成，边缘页面仍旧分散

风险不在主链，而在：

- 某些页面仍直接依赖老消息类型
- 某些主动查询路径仍可能绕开统一归一化

### 10.2 协议响应与事件广播双轨

一个请求既可能有响应数据，又可能需要广播成统一事件。如果处理不当，就会出现：

- promise 已 resolve
- 但事件没有继续广播

这类问题在 `sendRaw()` 和 pending 管理上尤为关键。

### 10.3 文档和真实前端状态偏移

Web Panel 迭代快，如果不持续同步设计文档和 docs-site，用户会很快看到过期说明。

---

## 11. 测试与验证

当前相关测试包括：

- `packages/web-panel/__tests__/unit/ws-store.test.js`
- `packages/web-panel/__tests__/unit/chat-store.test.js`
- `packages/web-panel/__tests__/unit/tasks-store.test.js`
- `packages/web-panel/__tests__/unit/dashboard-store.test.js`
- `packages/web-panel/__tests__/e2e/panel.test.js`

当前已确认：

- Web Panel 单元测试：`218/218`（7 个文件）
  - `ws-store.test.js` — WS 协议核心（v1.0 envelope、requestId 关联、flattenEnvelope）
  - `chat-store.test.js` — 会话管理（dot-case 类型映射、流式消息）
  - `tasks-store.test.js` — 后台任务
  - `dashboard-store.test.js` — Dashboard 统计
  - `parsers.test.js` — 解析器函数
  - `theme.test.js` — 主题系统
  - `new-pages.test.js` — 新页面解析逻辑（75 tests：路由、DID、审计、Git、P2P、Projects、Providers config）
- Web Panel 集成测试：`12/12`（CLI 命令集成）
- Web Panel E2E：`12/12`（WS 协议兼容） + `panel.test.js`（15 SPA 路由 + 资源文件）
- Web Panel 构建：通过

本轮重点验证覆盖：

- v1.0 Coding Agent Envelope 协议兼容（requestId 关联、payload flatten、dot-case 类型）
- session record 归一化
- runtime event 归一化
- Dashboard 统计更新
- 会话恢复与关闭链路
- 新页面解析逻辑（DID/审计/Git/P2P/Projects/Providers config）

---

## 12. 与模块 73 / 69 / 78 的关系

- 模块 73
  - 关注 `ui` 命令如何启动页面与服务
- 模块 69
  - 关注 WS 协议如何暴露能力
- 模块 78
  - 关注 Runtime / Gateway / Harness / Contract 的整体重构计划
- 模块 75
  - 关注前端页面、store 与事件模型如何承接前面三者

因此模块 75 的位置，是“前端消费层的设计说明”，不是独立后端或独立产品说明。

---

## 13. 结论

模块 75 的核心价值，在于把 Web Panel 从“能用的浏览器界面”推进到“与 CLI Runtime 同步演进的前端状态层”。

当前已经完成的关键变化包括：

- 主干 store 已进入统一 runtime event 流
- session summary 已进入标准 `record` 模型
- Dashboard / Chat / Tasks 三条主链开始共享统一状态入口

接下来这一模块的重点，不是继续无限加页面，而是先把：

- 主干页面收口
- 协议到事件的映射稳定
- 文档和测试同步

这三件事做扎实。
