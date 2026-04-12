# 智能插件生态 2.0

> **Phase 99 | v5.0.1 | 状态: ✅ 生产就绪 | 8 IPC Handlers**

## 概述

智能插件生态 2.0 构建了安全、智能、可持续的插件生态系统，提供 AI 驱动的插件推荐（协同过滤+内容推荐）、自动依赖解析与冲突检测、WASM + iframe 沙盒隔离运行环境、AI 自动代码审计以及开发者收益分成体系。插件在沙盒中运行，通过权限模型严格控制文件系统、网络和 IPC 访问。

ChainlessChain 智能插件生态 2.0 引入 AI 驱动的插件推荐、依赖解析与冲突检测、WASM + iframe 沙盒隔离、AI 自动代码审计和插件收益分成体系，构建安全、智能、可持续的插件生态系统。

## 核心特性

- 🤖 **AI 驱动插件推荐**: 基于用户行为、工作上下文和历史偏好，智能推荐最匹配的插件，支持协同过滤与内容推荐双模型
- 🔗 **依赖解析与冲突检测**: 自动分析插件依赖树，检测版本冲突、循环依赖和 API 不兼容，提供解决建议
- 🔒 **WASM + iframe 沙盒隔离**: 插件运行在 WASM 沙盒或 iframe 隔离环境中，通过权限模型控制文件系统、网络、IPC 访问
- 🔍 **AI 代码审计**: 自动扫描插件源码，检测安全漏洞（XSS/注入/数据泄漏）、性能问题和 API 滥用，生成审计报告
- 💎 **收益分成体系**: 插件开发者按下载量/活跃用户获取收益，支持付费插件、打赏和订阅模式

## 系统架构

```
开发者                          用户
  │                              │
  ▼                              ▼
┌──────────────┐         ┌──────────────┐
│ 插件发布流程  │         │ AI 插件推荐   │
│ (代码审计+   │         │ (协同过滤+    │
│  自动审核)   │         │  内容推荐)    │
└──────┬───────┘         └──────┬───────┘
       │                        │
       ▼                        ▼
┌──────────────────────────────────────┐
│          插件生态市场                  │
│  ┌────────────┐  ┌────────────────┐  │
│  │ 依赖解析器  │  │ 收益分成引擎   │  │
│  │ (版本+冲突) │  │ (下载/活跃/打赏)│  │
│  └────────────┘  └────────────────┘  │
└──────────────────┬───────────────────┘
                   │
        ┌──────────▼──────────┐
        │    沙盒隔离运行时    │
        │  ┌──────┐ ┌──────┐  │
        │  │ WASM │ │iframe│  │
        │  │Sandbox│ │ CSP  │  │
        │  └──────┘ └──────┘  │
        └─────────────────────┘
```

---

## 插件安全模型

```
┌──────────────────────────────────────┐
│           主应用进程                  │
│  ┌────────────────────────────────┐  │
│  │       权限管理器               │  │
│  │  filesystem: read-only         │  │
│  │  network: allowlist            │  │
│  │  ipc: scoped channels          │  │
│  └─────────┬──────────────────────┘  │
│            │                          │
│  ┌─────────▼─────────┐  ┌──────────┐│
│  │   WASM Sandbox    │  │  iframe  ││
│  │  (Compute 密集型) │  │ (UI 插件)││
│  │  无直接 I/O 访问  │  │ CSP 隔离 ││
│  └───────────────────┘  └──────────┘│
└──────────────────────────────────────┘
```

---

## AI 插件推荐

```javascript
// 获取 AI 推荐的插件列表
const recommendations = await window.electron.ipcRenderer.invoke(
  "ecosystem:recommend",
  {
    context: {
      currentTask: "code-review",
      recentSkills: ["git-diff", "code-analysis"],
      userProfile: "developer",
    },
    limit: 10,
    includeReasons: true,
  },
);
// recommendations = [
//   {
//     pluginId: "advanced-code-reviewer",
//     name: "高级代码审查",
//     score: 0.95,
//     reason: "基于你频繁使用 git-diff 和 code-analysis 技能，推荐此插件增强代码审查能力",
//     downloads: 12500,
//     rating: 4.8,
//   },
//   ...
// ]
```

## 安装插件

```javascript
// 安装插件（自动依赖解析）
const install = await window.electron.ipcRenderer.invoke("ecosystem:install", {
  pluginId: "advanced-code-reviewer",
  version: "latest",
  permissions: {
    filesystem: ["read"],
    network: ["api.github.com"],
    ipc: ["git:*", "ai:analyze"],
  },
});
// install = {
//   pluginId: "advanced-code-reviewer",
//   version: "3.2.1",
//   status: "installed",
//   dependencies: [{ name: "diff-parser", version: "1.0.3", status: "installed" }],
//   sandboxType: "wasm",
//   permissions: { filesystem: ["read"], network: ["api.github.com"], ipc: ["git:*", "ai:analyze"] }
// }
```

## 依赖解析

```javascript
// 检查依赖兼容性（安装前预检）
const deps = await window.electron.ipcRenderer.invoke(
  "ecosystem:resolve-deps",
  {
    pluginId: "data-pipeline-pro",
    version: "2.0.0",
  },
);
// deps = {
//   resolved: true,
//   tree: [
//     { name: "data-pipeline-pro", version: "2.0.0", deps: ["csv-parser@1.5.0", "chart-engine@3.0.0"] },
//     { name: "csv-parser", version: "1.5.0", deps: [] },
//     { name: "chart-engine", version: "3.0.0", deps: ["d3-core@7.0.0"] },
//   ],
//   conflicts: [],
//   warnings: [{ type: "version-mismatch", message: "chart-engine 3.0.0 推荐搭配 d3-core >= 7.1.0" }]
// }
```

## 沙盒测试

```javascript
// 在沙盒中测试插件行为
const sandbox = await window.electron.ipcRenderer.invoke(
  "ecosystem:sandbox-test",
  {
    pluginId: "advanced-code-reviewer",
    testSuite: "security", // "security" | "performance" | "compatibility" | "full"
    timeout: 30000,
  },
);
// sandbox = {
//   pluginId: "advanced-code-reviewer",
//   testSuite: "security",
//   passed: true,
//   results: [
//     { test: "no-filesystem-write", passed: true },
//     { test: "no-unauthorized-network", passed: true },
//     { test: "no-ipc-escalation", passed: true },
//     { test: "memory-limit-respected", passed: true, peakMB: 45 },
//   ],
//   duration: 8500
// }
```

## AI 代码审计

```javascript
// 对插件进行 AI 自动代码审计
const review = await window.electron.ipcRenderer.invoke("ecosystem:ai-review", {
  pluginId: "community-plugin-xyz",
  checks: ["security", "performance", "api-usage", "privacy"],
});
// review = {
//   pluginId: "community-plugin-xyz",
//   overallScore: 82,
//   grade: "B+",
//   findings: [
//     { severity: "high", category: "security", message: "检测到未转义的用户输入拼接到 SQL 查询", line: 142, file: "db.js" },
//     { severity: "medium", category: "performance", message: "循环内重复创建正则表达式对象", line: 89, file: "parser.js" },
//     { severity: "low", category: "api-usage", message: "使用已废弃的 v1 API，建议迁移到 v2", line: 23, file: "index.js" },
//   ],
//   recommendations: ["修复 SQL 注入漏洞后方可上架", "性能问题建议优化但不阻塞发布"]
// }
```

## 发布插件

```javascript
// 将插件发布到生态市场
const publish = await window.electron.ipcRenderer.invoke("ecosystem:publish", {
  pluginPath: "/plugins/my-awesome-plugin",
  metadata: {
    name: "My Awesome Plugin",
    description: "智能文档格式转换工具",
    version: "1.0.0",
    category: "productivity",
    pricing: { model: "freemium", premiumPrice: 9.9, currency: "CNY" },
    tags: ["document", "converter", "productivity"],
  },
  autoReview: true,
});
// publish = { pluginId: "my-awesome-plugin", version: "1.0.0", status: "under-review", estimatedReviewTime: "24h" }
```

## 收益查询

```javascript
// 查看插件收益
const revenue = await window.electron.ipcRenderer.invoke(
  "ecosystem:get-revenue",
  {
    developerId: "dev-001",
    period: "2026-03",
  },
);
// revenue = {
//   developerId: "dev-001",
//   period: "2026-03",
//   totalEarnings: 2580.50,
//   currency: "CNY",
//   breakdown: [
//     { pluginId: "my-awesome-plugin", downloads: 350, activeUsers: 180, earnings: 1780.50, model: "freemium" },
//     { pluginId: "quick-translator", downloads: 1200, tips: 45, earnings: 800.00, model: "free+tips" },
//   ],
//   payoutStatus: "scheduled",
//   nextPayoutDate: "2026-04-01"
// }
```

## 生态配置

```javascript
const config = await window.electron.ipcRenderer.invoke("ecosystem:configure", {
  autoUpdate: true,
  sandboxMode: "strict", // "strict" | "permissive" | "disabled"
  aiReviewRequired: true,
  maxPlugins: 50,
  allowedSources: ["official", "verified", "community"],
});
```

---

## IPC 通道

| 通道                     | 参数                                    | 返回值       |
| ------------------------ | --------------------------------------- | ------------ |
| `ecosystem:recommend`    | `{ context?, limit? }`                  | 推荐列表     |
| `ecosystem:install`      | `{ pluginId, version?, permissions? }`  | 安装结果     |
| `ecosystem:resolve-deps` | `{ pluginId, version? }`                | 依赖解析结果 |
| `ecosystem:sandbox-test` | `{ pluginId, testSuite?, timeout? }`    | 沙盒测试结果 |
| `ecosystem:ai-review`    | `{ pluginId, checks? }`                 | 审计报告     |
| `ecosystem:publish`      | `{ pluginPath, metadata, autoReview? }` | 发布结果     |
| `ecosystem:get-revenue`  | `{ developerId, period? }`              | 收益数据     |
| `ecosystem:configure`    | `{ autoUpdate?, sandboxMode?, ... }`    | 配置结果     |

---

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "pluginEcosystem": {
    "enabled": true,
    "version": "2.0",
    "sandbox": {
      "mode": "strict",
      "wasmMemoryLimitMB": 256,
      "iframeCSP": "default-src 'self'; script-src 'wasm-unsafe-eval'",
      "networkAllowlist": []
    },
    "aiReview": {
      "enabled": true,
      "requiredForPublish": true,
      "minScore": 70
    },
    "recommendations": {
      "enabled": true,
      "model": "collaborative-filtering",
      "refreshInterval": 86400000
    },
    "revenue": {
      "enabled": true,
      "platformFee": 0.15,
      "minPayoutCNY": 100,
      "payoutCycle": "monthly"
    },
    "maxInstalledPlugins": 50,
    "autoUpdate": true,
    "allowedSources": ["official", "verified", "community"]
  }
}
```

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/marketplace/plugin-ecosystem-v2.js` | 插件生态核心引擎 |
| `src/main/marketplace/plugin-ecosystem-ipc.js` | IPC 处理器（8 个） |
| `src/main/marketplace/ai-plugin-recommender.js` | AI 插件推荐引擎 |
| `src/main/marketplace/dependency-resolver.js` | 依赖解析与冲突检测 |
| `src/main/marketplace/plugin-sandbox.js` | WASM + iframe 沙盒隔离 |
| `src/main/marketplace/ai-code-auditor.js` | AI 代码审计器 |
| `src/main/marketplace/revenue-engine.js` | 收益分成引擎 |
| `src/renderer/stores/pluginEcosystem.ts` | Pinia 插件生态状态管理 |

## 故障排查

| 问题 | 原因分析 | 解决方案 |
|------|---------|---------|
| 插件安装失败 | 依赖冲突或版本不兼容 | 先使用 `ecosystem:resolve-deps` 预检依赖树，解决 `conflicts` 中列出的版本冲突后重试 |
| 沙盒测试不通过 | 插件尝试访问未授权的系统资源 | 检查 `sandbox-test` 返回的失败项，确认插件 `permissions` 声明覆盖了所有需要的能力 |
| AI 推荐结果不相关 | 用户行为数据不足或推荐模型未更新 | 增加使用频次积累行为数据，等待推荐模型刷新周期（`refreshInterval` 默认 24 小时）后重试 |
| AI 代码审计评分过低 | 插件代码存在安全漏洞或性能问题 | 根据 `ai-review` 返回的 `findings` 逐项修复，优先处理 `severity: "high"` 的安全问题 |
| 插件发布审核未通过 | 代码审计评分低于 `minScore`（默认 70） | 修复审计报告中的所有高严重性问题，确保评分达标后重新提交 |
| 收益未到账 | 未达到最低提现金额或支付周期未到 | 确认累计收益超过 `minPayoutCNY`（默认 100 元），等待月度结算周期（`payoutCycle: monthly`） |
| 依赖解析超时 | 插件依赖树过深或存在循环依赖 | 减少嵌套依赖层级，移除不必要的间接依赖；检查 `warnings` 中的循环依赖提示 |

## 安全考虑

### 沙盒隔离
- **WASM 沙盒**: 计算密集型插件在 WASM 沙盒中运行，无直接 I/O 访问，内存限制为 `wasmMemoryLimitMB`（默认 256MB）
- **iframe CSP**: UI 类插件在 iframe 中运行，通过 Content Security Policy 限制脚本执行和网络请求来源
- **权限模型**: 插件的文件系统、网络、IPC 访问需在安装时显式声明和授权，运行时严格执行权限边界

### 代码审计安全
- **自动审计**: 所有发布到市场的插件必须通过 AI 代码审计（`aiReviewRequired: true`），检测 XSS、SQL 注入、数据泄漏等漏洞
- **最低评分**: 审计评分低于 `minScore`（默认 70 分）的插件禁止上架，高严重性漏洞必须修复
- **持续监控**: 已上架插件定期重新审计，发现新漏洞时自动下架并通知开发者和已安装用户

### 依赖安全
- **依赖树分析**: 安装前自动分析完整依赖树，检测已知漏洞库、循环依赖和版本冲突
- **来源验证**: 仅允许从 `allowedSources`（official/verified/community）安装插件，拒绝未知来源
- **自动更新**: 启用 `autoUpdate` 时优先推送安全补丁，确保已安装插件及时修复已知漏洞

### 收益安全
- **平台费透明**: 平台抽成比例（`platformFee: 15%`）公开透明，开发者可在收益报告中查看完整明细
- **支付安全**: 收益结算通过第三方支付平台完成，敏感支付信息不经过插件生态系统

## 使用示例

### 端到端插件安装流程

```bash
# 1. 获取 AI 推荐（基于当前工作上下文）
# IPC: ecosystem:recommend { context: { currentTask: "code-review" }, limit: 5 }

# 2. 安装前预检依赖
# IPC: ecosystem:resolve-deps { pluginId: "advanced-code-reviewer", version: "latest" }
# → 确认 conflicts 为空、无循环依赖

# 3. 安装插件并声明权限
# IPC: ecosystem:install { pluginId: "advanced-code-reviewer", permissions: { filesystem: ["read"], network: ["api.github.com"] } }

# 4. 沙盒安全测试
# IPC: ecosystem:sandbox-test { pluginId: "advanced-code-reviewer", testSuite: "security" }
# → 确认所有安全测试 passed
```

### AI 推荐与审计最佳实践

- **推荐准确性**: AI 推荐基于使用行为积累，新用户初期推荐可能不够精准；持续使用 1-2 周后推荐质量显著提升
- **审计评分解读**: `overallScore >= 90` 为优质插件，`70-89` 为合格，`< 70` 禁止上架；重点关注 `severity: "high"` 的安全问题
- **沙盒测试覆盖**: 安装第三方插件后建议运行 `testSuite: "full"`（含 security + performance + compatibility 全量测试）

### 开发者发布流程

1. 在 `pluginPath` 目录准备插件代码和 `metadata`（name/version/pricing/tags）
2. 设置 `autoReview: true` 自动触发 AI 代码审计
3. 审计评分达标后进入人工审核队列（约 24 小时）
4. 发布后通过 `ecosystem:get-revenue` 跟踪下载量和收益

## 相关文档

- [统一应用运行时](/chainlesschain/universal-runtime) - 插件运行时环境
- [Skill Marketplace 技能市场](/chainlesschain/skill-marketplace) - 技能交易市场
- [自进化 AI 系统](/chainlesschain/self-evolving-ai) - AI 驱动的生态进化
- [Skills 技能系统](/chainlesschain/skills) - 138 个内置技能
