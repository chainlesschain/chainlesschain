# Agent 安全沙箱 2.0

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 6 IPC Handlers | Phase 87**

ChainlessChain Agent 安全沙箱 2.0（Agent Sandbox v2）提供基于 WebAssembly 的隔离执行环境，配合细粒度权限白名单、资源配额管控、完整审计日志和 AI 行为监控，确保 Agent 在安全可控的环境中运行。

## 概述

Agent 安全沙箱 2.0 是 ChainlessChain 的 Agent 隔离执行环境，基于 WebAssembly 实现内存安全的沙箱隔离。系统提供文件/网络/系统调用级别的细粒度权限白名单、CPU/内存/存储/带宽的资源配额管控、完整操作审计日志，以及基于 AI 的实时行为分析与异常自动拦截能力。

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

### 权限拒绝详细排查

**现象**: 沙箱内代码访问文件或网络时返回 `Permission Denied`。

**排查步骤**:
1. 确认目标路径匹配 `filesystem.read` 或 `filesystem.write` 中的 glob 模式
2. 检查 `deny` 列表是否包含了该路径（deny 优先级最高，始终覆盖 allow）
3. 对于网络请求，检查 `network.allowedHosts` 和 `allowedPorts` 是否包含目标地址
4. 使用 `sandbox:get-audit-log` 查看拒绝事件的详细信息和触发规则

### 资源配额超限详细排查

**现象**: 沙箱进程被自动终止，返回配额超限错误。

**排查步骤**:
1. 通过 `sandbox:monitor-behavior` 查看 `resourceUsage` 中哪项资源（CPU/内存/存储）超限
2. 调整 `sandbox:set-quota` 增大相应配额，或优化代码减少资源消耗
3. 检查 `timeout` 是否设置过短导致长任务被中断（默认 300000ms）
4. 若为批量处理任务，考虑拆分为多个小任务分次在沙箱中执行

### 沙箱创建失败详细排查

**现象**: 调用 `sandbox:create` 返回失败，沙箱实例未创建。

**排查步骤**:
1. 确认系统是否支持指定的 `runtime` 类型（wasm 需要 WebAssembly 运行时）
2. 检查系统可用内存和磁盘空间是否满足 `defaultQuota` 的最低要求
3. 查看日志中是否有 WASM 模块加载或编译错误
4. 若使用 `docker` 运行时，确认 Docker 服务已启动且有足够权限

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 权限拒绝无法执行操作 | 沙箱策略限制或 ACL 配置错误 | 检查 `sandbox-policy.json`，确认操作在白名单中 |
| 配额超限导致任务中断 | CPU/内存/磁盘配额设置过低 | 调整 `quotas` 配置，增大对应资源限额 |
| WASM 隔离环境启动失败 | WASM 运行时未安装或版本不兼容 | 确认 `wasmtime` 已安装，版本 >= 14.0 |
| 沙箱内网络请求被拦截 | 网络策略默认拒绝出站请求 | 在 `networkPolicy` 中添加允许的域名白名单 |
| 文件系统写入被拒绝 | 挂载目录为只读或路径越界 | 检查 `mountPoints` 配置，确认 `writable: true` |

### 常见错误修复

**错误: `PERMISSION_DENIED` 操作被沙箱拦截**

```bash
# 查看当前沙箱策略
chainlesschain sandbox policy-show

# 临时放宽权限（仅开发环境）
chainlesschain sandbox policy-set --allow-fs-write --scope /tmp
```

**错误: `QUOTA_EXCEEDED` 资源配额超限**

```bash
# 查看当前资源使用情况
chainlesschain sandbox stats

# 调整内存配额
chainlesschain sandbox quota-set --memory 512MB --cpu 2
```

**错误: `WASM_INIT_FAILED` 隔离环境启动异常**

```bash
# 检查 WASM 运行时状态
chainlesschain sandbox wasm-check

# 重新初始化沙箱环境
chainlesschain sandbox reset --confirm
```

## 安全考虑

- **WASM 内存隔离**: 沙箱进程运行在 WebAssembly 线性内存中，无法访问宿主内存
- **deny 优先**: 文件系统权限中 `deny` 规则优先级最高，始终覆盖 `read`/`write` 规则
- **最小权限原则**: 默认拒绝所有系统调用，仅白名单中的调用可执行
- **资源硬性限制**: CPU/内存/存储配额为硬性上限，超限自动终止沙箱进程
- **行为基线学习**: AI 行为监控持续学习正常行为模式，偏离基线自动触发告警
- **审计不可篡改**: 沙箱内所有操作记录到独立审计日志，Agent 无权修改日志

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
