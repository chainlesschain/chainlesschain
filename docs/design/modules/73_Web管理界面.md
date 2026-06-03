# 73. Web 管理界面

**版本**: v5.0.2.10  
**创建日期**: 2026-03-18  
**最近更新**: 2026-04-06  
**状态**: 已实现，并已进入 Runtime / Gateway / Web Panel 协同阶段

---

## 1. 背景

`chainlesschain ui` 的目标，是把原本只能在终端里完成的 Agent / Chat 操作，迁移到本地浏览器中完成，同时继续复用 CLI 的会话、任务、压缩和协议能力。

这个模块最初解决的是“如何快速打开一个本地浏览器对话界面”的问题。随着 Web Panel 和 Runtime 重构推进，它的职责已经扩大为：

- 提供 HTTP 入口
- 自动启动内置 WebSocket 服务
- 识别项目模式与全局模式
- 为前端注入运行时配置
- 作为 Web Panel 的启动容器

因此，模块 73 讨论的不只是一个命令，而是 `ui` 作为浏览器入口时的整体启动链路。

---

## 2. 设计目标

### 2.1 一条命令启动完整本地界面

用户只需要执行：

```bash
chainlesschain ui
```

即可获得：

- HTTP 页面服务
- WebSocket 会话服务
- 浏览器自动打开

### 2.2 项目感知

从包含 `.chainlesschain/` 的目录启动时，UI 应自动进入项目模式，把 `projectRoot` 注入会话上下文，而不是要求用户自己额外配置。

### 2.3 与 CLI Runtime 对齐

`ui` 不应再是独立分支逻辑，而应通过 runtime factory 启动，和 `agent / chat / serve` 共用统一边界。

### 2.4 渐进增强

若 Vue3 Web Panel 构建产物存在，优先使用新面板；若构建产物缺失，则允许回退到内嵌 HTML，避免 `ui` 完全不可用。

---

## 3. 整体架构

启动链路如下：

```text
用户执行 chainlesschain ui
        |
        v
commands/ui.js
        |
        v
runtime-factory.createUiRuntime()
        |
        v
agent-runtime.startUiServer()
        |
        +--> 启动 WebSocket 服务
        |
        +--> 启动 HTTP 服务
        |
        +--> 注入运行时配置
        |
        +--> 打开浏览器（可选）
```

当前这条链路已经从“命令里直接做全部事情”，演进到“命令调用 runtime，再由 runtime 负责启动 UI”。

---

## 4. 当前代码落点

关键文件：

- `packages/cli/src/commands/ui.js`
- `packages/cli/src/runtime/agent-runtime.js`
- `packages/cli/src/runtime/runtime-factory.js`
- `packages/cli/src/runtime/policies/agent-policy.js`
- `packages/cli/src/gateways/ui/web-ui-server.js`
- `packages/cli/src/gateways/ws/ws-server.js`
- `packages/web-panel/`

角色划分：

- `commands/ui.js`
  - 负责命令注册与参数入口
- `runtime-factory.js`
  - 创建 UI runtime
- `agent-runtime.js`
  - 统一启动 UI 服务
- `web-ui-server.js`
  - 承担 HTTP 入口与静态资源分发
- `ws-server.js`
  - 提供 WS 协议能力

---

## 5. 运行模式

### 5.1 项目模式

当当前工作目录或其父级目录中存在 `.chainlesschain/` 时，UI 自动识别为项目模式。

项目模式下：

- 会话会绑定 `projectRoot`
- 页面会显式展示项目上下文
- Agent 工具调用更容易保持在项目范围内

### 5.2 全局模式

当未检测到项目根目录时，UI 进入全局模式。

全局模式下：

- 会话不绑定 конкретe project
- 更适合通用对话、Provider 配置、技能浏览和系统观测

---

## 6. HTTP 服务设计

HTTP 层的核心目标不是做复杂业务，而是安全、稳定地把 Web Panel 提供给浏览器。

### 6.1 当前职责

- 提供根页面
- 分发静态资源
- 注入运行时配置
- 处理 SPA 路由回退
- 在缺少构建产物时回退到内嵌页面

### 6.2 配置注入

页面启动时会拿到必要的本地运行配置，例如：

- HTTP 端口
- WS 端口
- token
- 当前模式
- `projectRoot`

这里必须做安全转义，避免把 JSON 直接注入到 HTML 时引入 XSS 风险。

### 6.3 构建产物查找

当前支持：

1. 自定义 `--web-panel-dir`
2. 源码树中的 `packages/web-panel/dist`
3. npm 发布包内置资源

这保证了：

- 源码开发时可以直接调试最新前端
- npm 安装用户无需自己构建 Web Panel

---

## 7. WebSocket 协作关系

`ui` 页面本身不实现会话协议，它复用内置 WS 服务来完成：

- 认证
- 会话创建 / 恢复 / 关闭
- 消息发送
- 后台任务查询
- Worktree diff / merge
- 压缩观测查询

因此，模块 73 和模块 69 的关系是：

- 模块 73 负责“如何启动与接入”
- 模块 69 负责“WS 协议本身长什么样”

---

## 8. 与 Web Panel 的关系

从架构上看：

- `ui` 是启动容器
- `web-panel` 是页面实现

两者的关系类似：

- `ui`
  - 负责服务启动、配置注入、浏览器打开
- `web-panel`
  - 负责界面、状态管理、事件消费

这意味着：

- 设计 UI 启动链路时，不能把页面逻辑写回命令层
- 页面状态问题应优先在 `packages/web-panel` 侧修

---

## 9. 当前行为要点

### 9.1 启动方式

```bash
chainlesschain ui
chainlesschain ui --port 9000 --ws-port 9001
chainlesschain ui --token my-secret-token
chainlesschain ui --no-open
chainlesschain ui --web-panel-dir /custom/dist
```

### 9.2 当前默认行为

- 默认启动 HTTP 与 WS 两个本地服务
- 默认自动打开浏览器
- 支持 token 鉴权
- 支持项目模式 / 全局模式自动切换

### 9.3 当前运行时边界

`ui` 命令当前已通过 runtime factory 收口，这一点很关键，因为它意味着 UI 入口不再绕开 Runtime 主干。

---

## 10. 演进状态

早期 `ui` 更像“单页 HTML 对话页”，当前已经进入“Web Panel + Runtime 协同”的阶段。

主要变化包括：

- UI 命令已纳入 runtime 体系
- Web Panel 成为主要前端实现
- 内置 WS 服务不再只是简单命令转发，而开始提供标准 `record` 与统一 runtime event
- Dashboard、Chat、Tasks 等页面逐步通过统一事件入口消费状态

---

## 11. 当前风险点

### 11.1 容器层与页面层职责混淆

若把页面逻辑继续塞回 `ui` 命令或 `web-ui-server`，会重新把边界打散。

### 11.2 构建产物与源码双路径

需要持续保证：

- 源码开发路径可用
- npm 安装路径可用
- 缺失构建产物时可回退

### 11.3 文档与现实不同步

`ui` 涉及命令、HTTP、WS、前端四层，一旦文档只更新其中一层，就会很快失真。

---

## 12. 测试与验证

相关验证包括：

- `packages/cli/__tests__/unit/runtime-factory.test.js`
- `packages/cli/__tests__/unit/commands-ui.test.js`
- `packages/web-panel/__tests__/unit/ws-store.test.js`
- `packages/web-panel/__tests__/unit/chat-store.test.js`
- `packages/web-panel/__tests__/unit/dashboard-store.test.js`

当前已确认：

- `runtime-factory` 与 `ui` 命令相关回归通过
- Web Panel 定向单测：`23/23`
- Web Panel E2E：`29/29`
- Web Panel 构建：通过

---

## 13. 结论

模块 73 的核心价值，在于把 `chainlesschain ui` 从“一个独立命令”提升为“CLI Runtime 的浏览器入口”。

它当前已经完成三件关键事：

- 把 UI 启动链路纳入 Runtime
- 把浏览器入口和 WS 协议稳定连接起来
- 为 Web Panel 提供稳定的本地宿主环境

后续这部分不应再朝“命令里堆逻辑”的方向发展，而应继续沿着：

- Runtime 统一
- Gateway 清晰
- Web Panel 独立演进

这条路线推进。
