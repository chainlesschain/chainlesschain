# 智能插件生态 2.0

> **Phase 99 | v5.0.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers**

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

## 相关文档

- [统一应用运行时](/chainlesschain/universal-runtime) - 插件运行时环境
- [Skill Marketplace 技能市场](/chainlesschain/skill-marketplace) - 技能交易市场
- [自进化 AI 系统](/chainlesschain/self-evolving-ai) - AI 驱动的生态进化
- [Skills 技能系统](/chainlesschain/skills) - 138 个内置技能
