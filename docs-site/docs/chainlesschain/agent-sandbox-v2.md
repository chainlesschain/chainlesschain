# Agent 安全沙箱 2.0

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 6 IPC Handlers | Phase 87**

ChainlessChain Agent 安全沙箱 2.0（Agent Sandbox v2）提供基于 WebAssembly 的隔离执行环境，配合细粒度权限白名单、资源配额管控、完整审计日志和 AI 行为监控，确保 Agent 在安全可控的环境中运行。

## 核心特性

- 🔒 **WASM 隔离**: WebAssembly 沙箱隔离执行，内存安全，防止逃逸
- 📋 **细粒度权限白名单**: 文件系统/网络/系统调用级别的精确权限控制
- 📊 **资源配额**: CPU/内存/存储/网络带宽的硬性配额限制和软性告警
- 📝 **审计日志**: 完整的操作审计日志，支持回溯和合规检查
- 🤖 **AI 行为监控**: 基于 AI 的实时行为分析，异常风险评分和自动拦截

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              Agent 安全沙箱 2.0                    │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │          Sandbox Manager (6 IPC)         │     │
│  └──────────────────┬──────────────────────┘     │
│                     │                             │
│  ┌──────────┐  ┌────▼─────┐  ┌───────────────┐  │
│  │ WASM     │  │ Permission│  │ Resource     │  │
│  │ Runtime  │  │ Whitelist │  │ Quota        │  │
│  │ (隔离)   │  │ (权限)    │  │ (配额)       │  │
│  └────┬─────┘  └──────────┘  └──────┬────────┘  │
│       │                              │            │
│  ┌────▼──────────────────────────────▼────────┐  │
│  │         AI Behavior Monitor                │  │
│  │         (行为分析 + 风险评分 + 自动拦截)     │  │
│  └─────────────────┬─────────────────────────┘  │
│                    │                              │
│  ┌─────────────────▼─────────────────────────┐  │
│  │         Audit Log (审计日志)               │  │
│  └───────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## IPC 接口

### 沙箱操作（6 个）

| 通道                       | 功能         | 说明                             |
| -------------------------- | ------------ | -------------------------------- |
| `sandbox:create`           | 创建沙箱     | 创建隔离执行环境，指定权限和配额 |
| `sandbox:execute`          | 执行代码     | 在沙箱中执行代码或命令           |
| `sandbox:set-permissions`  | 设置权限     | 更新沙箱的权限白名单             |
| `sandbox:get-audit-log`    | 获取审计日志 | 查询沙箱操作的完整审计记录       |
| `sandbox:set-quota`        | 设置配额     | 配置 CPU/内存/存储/网络资源限制  |
| `sandbox:monitor-behavior` | 行为监控     | 获取 AI 行为分析报告和风险评分   |

## 使用示例

### 创建安全沙箱

```javascript
const sandbox = await window.electron.ipcRenderer.invoke("sandbox:create", {
  name: "agent-task-001",
  runtime: "wasm", // wasm | node-isolated | docker
  permissions: {
    filesystem: {
      read: ["/data/input/**"],
      write: ["/data/output/**"],
      deny: ["/etc/**", "/root/**"],
    },
    network: {
      allowedHosts: ["api.example.com"],
      allowedPorts: [443],
      maxBandwidth: "10MB/s",
    },
    syscalls: {
      allowed: ["read", "write", "open", "close", "stat"],
      denied: ["exec", "fork", "socket"],
    },
  },
  quota: {
    cpu: "50%",
    memory: "512MB",
    storage: "1GB",
    networkBandwidth: "10MB/s",
    timeout: 300000,
  },
});
// sandbox = { success: true, sandboxId: "sb_abc123", status: "ready", runtime: "wasm" }
```

### 在沙箱中执行代码

```javascript
const result = await window.electron.ipcRenderer.invoke("sandbox:execute", {
  sandboxId: "sb_abc123",
  code: "import json; data = json.loads(open('/data/input/data.json').read()); print(len(data))",
  language: "python",
  timeout: 30000,
});
// result = { success: true, output: "1024", exitCode: 0, resourceUsage: { cpu: "12%", memory: "128MB", duration: 1500 } }
```

### 设置权限白名单

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "sandbox:set-permissions",
  {
    sandboxId: "sb_abc123",
    permissions: {
      filesystem: {
        read: ["/data/input/**", "/data/models/**"],
        write: ["/data/output/**"],
      },
      network: {
        allowedHosts: ["api.example.com", "cdn.example.com"],
        allowedPorts: [443, 8443],
      },
    },
  },
);
// result = { success: true, updatedAt: 1709123456789 }
```

### 查询审计日志

```javascript
const logs = await window.electron.ipcRenderer.invoke("sandbox:get-audit-log", {
  sandboxId: "sb_abc123",
  since: Date.now() - 3600000,
  severity: "all", // all | info | warning | critical
  limit: 100,
});
// logs = { success: true, entries: [{ timestamp: 1709123456789, action: "file:read", target: "/data/input/data.json", result: "allowed", severity: "info" }, ...] }
```

### AI 行为监控

```javascript
const report = await window.electron.ipcRenderer.invoke(
  "sandbox:monitor-behavior",
  {
    sandboxId: "sb_abc123",
    analysisDepth: "full", // quick | full | forensic
  },
);
// report = { success: true, riskScore: 15, maxRisk: 100, anomalies: [], behaviorProfile: { fileAccess: "normal", networkPatterns: "normal", resourceUsage: "low" }, recommendation: "safe" }
```

## 权限模型

### 文件系统权限

| 权限级别 | 说明                         | 示例                  |
| -------- | ---------------------------- | --------------------- |
| `read`   | 允许读取的路径模式           | `/data/input/**`      |
| `write`  | 允许写入的路径模式           | `/data/output/**`     |
| `deny`   | 明确禁止的路径（优先级最高） | `/etc/**`, `/root/**` |

### 网络权限

| 权限级别       | 说明               | 示例                  |
| -------------- | ------------------ | --------------------- |
| `allowedHosts` | 允许访问的域名列表 | `["api.example.com"]` |
| `allowedPorts` | 允许的端口列表     | `[443, 8443]`         |
| `maxBandwidth` | 最大带宽限制       | `"10MB/s"`            |

### 风险评分等级

| 分数范围 | 风险等级 | 自动操作             |
| -------- | -------- | -------------------- |
| 0-25     | 低       | 正常运行             |
| 26-50    | 中       | 记录告警             |
| 51-75    | 高       | 限制权限，通知管理员 |
| 76-100   | 极高     | 自动暂停沙箱         |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "agentSandbox": {
    "enabled": true,
    "defaultRuntime": "wasm",
    "defaultQuota": {
      "cpu": "50%",
      "memory": "512MB",
      "storage": "1GB",
      "networkBandwidth": "10MB/s",
      "timeout": 300000
    },
    "audit": {
      "enabled": true,
      "retentionDays": 90,
      "logLevel": "info"
    },
    "behaviorMonitoring": {
      "enabled": true,
      "analysisInterval": 30000,
      "riskThreshold": 75,
      "autoSuspend": true
    }
  }
}
```

## 故障排除

| 问题         | 解决方案                                   |
| ------------ | ------------------------------------------ |
| 沙箱创建失败 | 检查系统 WASM 运行时是否安装，确认资源可用 |
| 执行权限被拒 | 检查权限白名单配置，确认路径模式匹配       |
| 资源配额超限 | 调整 quota 配置或优化 Agent 代码资源使用   |
| 行为误报     | 调整风险阈值，添加白名单行为模式           |
| 审计日志过大 | 减少 retentionDays，调高 logLevel          |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/security/sandbox-v2.js` | 沙箱核心引擎 |
| `desktop-app-vue/src/main/security/wasm-runtime.js` | WASM 隔离执行环境 |
| `desktop-app-vue/src/main/security/permission-whitelist.js` | 细粒度权限白名单 |
| `desktop-app-vue/src/main/security/behavior-monitor.js` | AI 行为监控与风险评分 |
| `desktop-app-vue/src/main/security/sandbox-ipc.js` | 沙箱 IPC 处理器 |

## 相关文档

- [审计系统](/chainlesschain/audit)
- [合规管理](/chainlesschain/compliance)
- [Agent 联邦网络](/chainlesschain/agent-federation)
