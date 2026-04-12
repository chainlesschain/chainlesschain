# 工作流自动化引擎

> **Phase 96 | v4.5.0 | 状态: ✅ 生产就绪 | 10 IPC Handlers | 3 数据库表**

ChainlessChain 工作流自动化引擎提供类 Zapier/n8n 的可视化工作流编排能力，内置 12 种主流 SaaS 连接器，支持 Webhook/定时/事件/条件四种触发模式，以及数据转换、过滤、聚合的完整 Pipeline 处理链。通过工作流市场实现模板共享与复用。

## 概述

工作流自动化引擎是 ChainlessChain 的 SaaS 集成与任务编排平台，类似 Zapier/n8n 的可视化工作流编排。内置 Gmail、Slack、GitHub、Jira 等 12 种连接器，支持 Webhook 实时触发、Cron 定时调度、事件驱动和条件触发四种模式，通过 Transform/Filter/Aggregate Pipeline 处理链实现数据流转，并提供工作流市场支持模板共享与一键部署。

## 核心特性

- 🔌 **12 种内置连接器**: Gmail / Slack / GitHub / Jira / Notion / Confluence / Trello / Asana / Linear / Discord / Telegram / Webhook，覆盖主流办公与开发场景
- ⚡ **四种触发模式**: Webhook 实时触发、Cron 定时调度、事件驱动（IPC/系统事件）、条件触发（指标阈值）
- 🔄 **Pipeline 处理链**: Transform（数据映射/格式转换）→ Filter（条件过滤）→ Aggregate（分组聚合），支持自定义 JavaScript 表达式
- 🏪 **工作流市场**: 模板导入/导出、社区共享、一键部署，降低工作流创建门槛
- 📊 **执行日志与统计**: 完整的执行历史、错误追踪、性能统计，支持调试与优化
- 🧪 **沙盒测试**: 工作流上线前可进行沙盒测试，验证连接器配置与数据流转

## 系统架构

```
┌──────────────────────────────────────────────┐
│          工作流自动化引擎                       │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  触发器层                             │    │
│  │  Webhook | Cron | Event | Condition  │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  Pipeline 处理链                      │    │
│  │  Transform → Filter → Aggregate      │    │
│  └──────────────────┬───────────────────┘    │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Gmail    │ │ Slack    │ │ GitHub   │     │
│  │ Jira     │ │ Notion   │ │ Discord  │     │
│  │ ...12种  │ │ 连接器   │ │          │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│                     │                        │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  automation_flows / executions /     │    │
│  │  templates (SQLite 3 张表)           │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/enterprise/automation/workflow-engine.js` | 工作流执行引擎 |
| `desktop-app-vue/src/main/enterprise/automation/connector-registry.js` | 12 种 SaaS 连接器注册 |
| `desktop-app-vue/src/main/enterprise/automation/trigger-manager.js` | 触发器管理 (4 种模式) |
| `desktop-app-vue/src/main/enterprise/automation/pipeline-processor.js` | Pipeline 处理链 |
| `desktop-app-vue/src/main/enterprise/automation/automation-ipc.js` | IPC 处理器 (10 个) |

## 相关文档

- [智能插件生态 2.0](/chainlesschain/plugin-ecosystem-v2)
- [统一应用运行时](/chainlesschain/universal-runtime)
- [自主工作流编排器](/chainlesschain/workflow-engine)
- [自进化 AI 系统](/chainlesschain/self-evolving-ai)

---

## 工作流生命周期

```
DRAFT → TESTING → ACTIVE → PAUSED → ARCHIVED
                    │
                    └── ERROR (自动重试 / 告警)
```

| 状态         | 说明                 |
| ------------ | -------------------- |
| **DRAFT**    | 草稿，编辑中         |
| **TESTING**  | 沙盒测试中           |
| **ACTIVE**   | 运行中，触发器已激活 |
| **PAUSED**   | 已暂停，触发器停止   |
| **ERROR**    | 执行出错，等待干预   |
| **ARCHIVED** | 已归档               |

---

## 创建工作流

```javascript
// 创建一个 GitHub PR → Slack 通知工作流
const flow = await window.electron.ipcRenderer.invoke(
  "automation:create-flow",
  {
    name: "GitHub PR 通知",
    description: "当 GitHub 仓库收到 PR 时自动发送 Slack 通知",
    trigger: {
      type: "webhook",
      connector: "github",
      event: "pull_request.opened",
      config: {
        repo: "myorg/myrepo",
        secret: "webhook-secret-token",
      },
    },
    steps: [
      {
        id: "transform-1",
        type: "transform",
        expression:
          "{ title: data.pull_request.title, author: data.pull_request.user.login, url: data.pull_request.html_url }",
      },
      {
        id: "filter-1",
        type: "filter",
        condition: "data.author !== 'dependabot[bot]'",
      },
      {
        id: "action-1",
        type: "connector",
        connector: "slack",
        action: "send-message",
        config: {
          channel: "#dev-notifications",
          template: "🔔 新 PR: {{title}} by {{author}}\n{{url}}",
        },
      },
    ],
  },
);
// flow = { id: "flow-001", name: "GitHub PR 通知", status: "DRAFT", ... }
```

## 执行工作流

```javascript
// 手动触发执行（用于测试或一次性任务）
const execution = await window.electron.ipcRenderer.invoke(
  "automation:execute",
  {
    flowId: "flow-001",
    input: {
      pull_request: {
        title: "feat: add workflow engine",
        user: { login: "developer" },
        html_url: "https://github.com/myorg/myrepo/pull/42",
      },
    },
  },
);
// execution = { executionId: "exec-001", status: "completed", duration: 1230, steps: [...] }
```

## 查看连接器列表

```javascript
const connectors = await window.electron.ipcRenderer.invoke(
  "automation:list-connectors",
);
// connectors = [
//   { id: "gmail", name: "Gmail", category: "email", actions: ["send", "read", "search"], triggers: ["new-email"] },
//   { id: "slack", name: "Slack", category: "messaging", actions: ["send-message", "create-channel"], triggers: ["message", "reaction"] },
//   { id: "github", name: "GitHub", category: "devops", actions: ["create-issue", "comment"], triggers: ["push", "pull_request", "issue"] },
//   ...
// ]
```

## 添加触发器

```javascript
// 添加定时触发器：每天 9:00 AM 执行
const trigger = await window.electron.ipcRenderer.invoke(
  "automation:add-trigger",
  {
    flowId: "flow-001",
    trigger: {
      type: "schedule",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
    },
  },
);
```

## 沙盒测试

```javascript
// 在沙盒中测试工作流，不影响外部系统
const testResult = await window.electron.ipcRenderer.invoke(
  "automation:test-flow",
  {
    flowId: "flow-001",
    mockData: {
      pull_request: {
        title: "test PR",
        user: { login: "tester" },
        html_url: "https://example.com",
      },
    },
  },
);
// testResult = { success: true, steps: [{ id: "transform-1", output: {...}, duration: 5 }, ...], warnings: [] }
```

## 执行日志

```javascript
const logs = await window.electron.ipcRenderer.invoke("automation:get-logs", {
  flowId: "flow-001",
  limit: 50,
  status: "failed",
});
// logs = [{ executionId: "exec-003", status: "failed", error: "Slack API rate limit", startedAt: 1710000000, duration: 320 }, ...]
```

## 模板导入

```javascript
// 从工作流市场导入模板
const imported = await window.electron.ipcRenderer.invoke(
  "automation:import-template",
  {
    templateId: "tmpl-daily-standup",
    customize: {
      slackChannel: "#my-team",
      schedule: "0 9 * * 1-5",
    },
  },
);
```

## 共享工作流

```javascript
// 将工作流发布到市场
const shared = await window.electron.ipcRenderer.invoke("automation:share", {
  flowId: "flow-001",
  visibility: "public",
  tags: ["github", "slack", "notification"],
  description: "GitHub PR 创建时自动通知 Slack 频道",
});
```

## 定时调度

```javascript
// 为工作流配置定时调度
const schedule = await window.electron.ipcRenderer.invoke(
  "automation:schedule",
  {
    flowId: "flow-001",
    schedules: [
      { cron: "0 9 * * 1-5", timezone: "Asia/Shanghai", label: "工作日早报" },
      { cron: "0 18 * * 5", timezone: "Asia/Shanghai", label: "周五总结" },
    ],
  },
);
```

## 统计概览

```javascript
const stats = await window.electron.ipcRenderer.invoke("automation:get-stats");
// stats = {
//   flows: { total: 15, active: 8, paused: 3, error: 1, draft: 3 },
//   executions: { total: 1280, success: 1205, failed: 75, avgDuration: 2340 },
//   connectors: { mostUsed: "slack", totalCalls: 5600 },
//   triggers: { webhook: 5, schedule: 6, event: 3, condition: 1 }
// }
```

---

## IPC 通道

| 通道                         | 参数                                          | 返回值       |
| ---------------------------- | --------------------------------------------- | ------------ |
| `automation:create-flow`     | `{ name, description, trigger, steps }`       | 工作流对象   |
| `automation:execute`         | `{ flowId, input? }`                          | 执行结果     |
| `automation:list-connectors` | 无                                            | 连接器列表   |
| `automation:add-trigger`     | `{ flowId, trigger }`                         | 触发器对象   |
| `automation:test-flow`       | `{ flowId, mockData? }`                       | 测试结果     |
| `automation:get-logs`        | `{ flowId?, limit?, status? }`                | 执行日志列表 |
| `automation:import-template` | `{ templateId, customize? }`                  | 导入的工作流 |
| `automation:share`           | `{ flowId, visibility, tags?, description? }` | 共享结果     |
| `automation:schedule`        | `{ flowId, schedules }`                       | 调度配置     |
| `automation:get-stats`       | 无                                            | 统计数据     |

---

## 数据库表

### automation_flows

| 字段        | 类型    | 说明                                       |
| ----------- | ------- | ------------------------------------------ |
| id          | TEXT PK | 工作流 ID                                  |
| name        | TEXT    | 工作流名称                                 |
| description | TEXT    | 工作流描述                                 |
| status      | TEXT    | DRAFT/TESTING/ACTIVE/PAUSED/ERROR/ARCHIVED |
| trigger     | JSON    | 触发器配置                                 |
| steps       | JSON    | 步骤定义数组                               |
| schedule    | JSON    | 定时调度配置                               |
| shared      | INTEGER | 是否已共享（0/1）                          |
| created_at  | INTEGER | 创建时间戳                                 |
| updated_at  | INTEGER | 更新时间戳                                 |

### automation_executions

| 字段         | 类型    | 说明                             |
| ------------ | ------- | -------------------------------- |
| id           | TEXT PK | 执行 ID                          |
| flow_id      | TEXT FK | 关联工作流 ID                    |
| status       | TEXT    | pending/running/completed/failed |
| input        | JSON    | 输入数据                         |
| output       | JSON    | 输出数据                         |
| error        | TEXT    | 错误信息                         |
| duration     | INTEGER | 执行时长（ms）                   |
| step_results | JSON    | 各步骤执行结果                   |
| started_at   | INTEGER | 开始时间戳                       |
| completed_at | INTEGER | 完成时间戳                       |

### automation_templates

| 字段        | 类型    | 说明           |
| ----------- | ------- | -------------- |
| id          | TEXT PK | 模板 ID        |
| name        | TEXT    | 模板名称       |
| description | TEXT    | 模板描述       |
| flow_config | JSON    | 工作流配置模板 |
| tags        | JSON    | 标签数组       |
| author      | TEXT    | 作者           |
| downloads   | INTEGER | 下载次数       |
| rating      | REAL    | 评分           |
| created_at  | INTEGER | 创建时间戳     |

---

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "workflowAutomation": {
    "enabled": true,
    "maxConcurrentExecutions": 10,
    "executionTimeout": 300000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMs": 1000,
      "backoffMultiplier": 2
    },
    "connectors": {
      "gmail": { "enabled": true },
      "slack": { "enabled": true, "defaultWorkspace": "my-team" },
      "github": { "enabled": true, "token": "${GITHUB_TOKEN}" },
      "jira": { "enabled": false },
      "notion": { "enabled": true },
      "confluence": { "enabled": false },
      "trello": { "enabled": false },
      "asana": { "enabled": false },
      "linear": { "enabled": true },
      "discord": { "enabled": true },
      "telegram": { "enabled": false },
      "webhook": { "enabled": true, "maxEndpoints": 50 }
    },
    "marketplace": {
      "enabled": true,
      "autoUpdate": false
    }
  }
}
```

---

## 故障排查

| 问题 | 原因分析 | 解决方案 |
|------|---------|---------|
| 工作流触发后未执行 | 触发器配置错误或工作流状态非 ACTIVE | 检查触发器类型和参数，确认工作流状态为 `ACTIVE`；使用 `automation:test-flow` 沙盒测试验证 |
| 连接器认证失败 | OAuth Token 过期或 API Key 无效 | 重新授权连接器，检查 Token 有效期；GitHub/Slack 等需在对应平台重新生成凭证 |
| Pipeline 步骤报错 | Transform/Filter 中的 JavaScript 表达式语法错误 | 检查 `expression` 和 `condition` 字段的 JS 语法，确保引用的字段名与上游数据结构一致 |
| 定时调度未触发 | Cron 表达式或时区配置错误 | 使用 crontab 校验工具验证表达式，确认 `timezone` 与系统时区一致（如 `Asia/Shanghai`） |
| Webhook 无法接收 | 本地防火墙或端口未开放 | 确认 Webhook 端口可从外网访问，或使用 ngrok 等工具进行端口转发；检查 `secret` 签名验证是否匹配 |
| 执行超时 | 单步骤或总流程耗时超出配置限制 | 增大 `executionTimeout`（默认 300 秒），或优化连接器调用（减少数据量、启用分页） |
| 模板导入失败 | 模板依赖的连接器未配置或版本不兼容 | 导入前检查模板所需连接器是否已启用，升级连接器到兼容版本 |

## 安全考虑

### 连接器凭证安全
- **凭证加密存储**: 所有连接器的 API Key、OAuth Token 等凭证通过 SQLCipher 加密存储，切勿在工作流定义的 `config` 中硬编码明文密码
- **最小权限原则**: 为每个连接器配置最小必要权限（如 GitHub 仅授予 `repo:read` 而非全部权限），降低凭证泄露的影响范围
- **Token 自动轮换**: OAuth Token 过期后系统自动使用 Refresh Token 刷新，无需人工干预

### 执行安全
- **沙盒测试**: 工作流上线前务必使用 `automation:test-flow` 在沙盒环境中测试，沙盒模式下连接器调用不会影响外部系统
- **表达式沙箱**: Transform/Filter 步骤中的 JavaScript 表达式在受限沙箱中执行，禁止访问文件系统、网络和 Node.js 原生模块
- **重试限制**: 失败步骤的自动重试受 `maxRetries`（默认 3 次）和指数退避策略控制，防止无限重试导致外部 API 过载

### Webhook 安全
- **签名验证**: 接收 Webhook 时验证请求签名（如 GitHub 的 `X-Hub-Signature-256`），拒绝未签名或签名不匹配的请求
- **IP 白名单**: 建议配置 Webhook 来源 IP 白名单，仅接受可信来源的请求
- **速率限制**: Webhook 端点设有速率限制（默认 `maxEndpoints: 50`），防止被恶意大量请求攻击

### 工作流共享安全
- **凭证脱敏**: 共享工作流到市场时自动移除所有连接器凭证和敏感配置，导入方需重新配置凭证
- **审核机制**: 公开共享的工作流模板需通过自动化安全检查，检测是否包含可疑的外部 URL 或恶意表达式

## 使用示例

### 创建自动化工作流

```bash
# 完整流程：创建 → 沙盒测试 → 激活
# 1. 创建工作流（GitHub PR → Slack 通知）
# IPC: automation:create-flow { name: "PR通知", trigger: { type: "webhook", connector: "github", event: "pull_request.opened" }, steps: [...] }
# → status: "DRAFT"

# 2. 沙盒测试（不影响外部系统）
# IPC: automation:test-flow { flowId: "flow-001", mockData: { pull_request: { title: "test", ... } } }
# → success: true, 所有步骤通过

# 3. 添加触发器并激活
# IPC: automation:add-trigger { flowId: "flow-001", trigger: { type: "webhook", ... } }
```

### 连接器配置要点

- **OAuth 连接器**（Gmail/Slack/GitHub）: 需在对应平台创建 OAuth App，将 Token 配置到 `.chainlesschain/config.json`，Token 过期后系统自动刷新
- **Webhook 连接器**: 配置 `secret` 用于签名验证，确认接收端口从外网可达（或使用 ngrok 转发）
- **数据库连接器**: 使用只读账号连接，避免工作流误操作修改源数据

### 触发器设置

| 触发类型 | 配置示例 | 适用场景 |
|---------|---------|---------|
| **Webhook** | `{ type: "webhook", connector: "github", event: "push" }` | GitHub/GitLab 事件实时响应 |
| **定时(Cron)** | `{ type: "schedule", cron: "0 9 * * 1-5", timezone: "Asia/Shanghai" }` | 工作日早报、定期汇总 |
| **事件驱动** | `{ type: "event", source: "ipc", channel: "note:created" }` | 笔记创建时自动归档 |
| **条件触发** | `{ type: "condition", metric: "cpu_usage", operator: ">", threshold: 90 }` | 系统指标告警 |

## 相关链接

- [智能插件生态 2.0](/chainlesschain/plugin-ecosystem-v2)
- [统一应用运行时](/chainlesschain/universal-runtime)
- [自进化 AI 系统](/chainlesschain/self-evolving-ai)
