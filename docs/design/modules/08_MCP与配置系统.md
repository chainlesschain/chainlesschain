# MCP与配置系统

> 本文档是 [系统设计主文档](../系统设计_主文档.md) 的子文档，详细描述MCP集成、统一配置管理和预算跟踪系统的设计。

---

### 2.9 MCP集成系统 ✅生产就绪 (v0.18.0) ⭐新增

> **✅ 完成状态**: v0.18.0版本生产就绪,HTTP+SSE传输完成
>
> **完成时间**: 2026-01-17 (HTTP+SSE), 2026-01-16 (POC)
> **实施文件**: `desktop-app-vue/src/main/mcp/`
> **测试覆盖**: 手动测试通过,自动化测试待实现
> **协议版本**: Model Context Protocol 2025-11-25
> **SDK版本**: @modelcontextprotocol/sdk ^0.x.x

#### 2.9.1 系统概述 ✅已实现

MCP (Model Context Protocol) 集成系统为 ChainlessChain 提供了标准化的外部工具和数据源接入能力。通过实现 MCP 协议,AI 助手可以安全地访问文件系统、数据库、Git 仓库等外部资源,极大扩展了系统的能力边界。

**核心价值**:

- **标准化接入**: 使用统一的 MCP 协议,兼容所有 MCP 服务器
- **安全隔离**: 服务器运行在独立进程,严格的权限控制
- **易于扩展**: 通过配置文件即可添加新的 MCP 服务器
- **性能监控**: 实时追踪连接、调用延迟和错误率

#### 2.9.2 支持的 MCP 服务器

**官方服务器** (stdio传输):

| 服务器名称     | 用途           | 安全级别 | 传输方式 | 配置文件          |
| -------------- | -------------- | -------- | -------- | ----------------- |
| **Filesystem** | 文件读写操作   | Medium   | stdio    | `filesystem.json` |
| **PostgreSQL** | 数据库查询     | High     | stdio    | `postgres.json`   |
| **SQLite**     | 本地数据库访问 | Medium   | stdio    | `sqlite.json`     |
| **Git**        | 仓库操作       | Medium   | stdio    | `git.json`        |
| **Fetch**      | HTTP 请求      | Medium   | stdio    | `fetch.json`      |
| **Slack**      | 工作区消息     | Medium   | stdio    | `slack.json`      |
| **GitHub**     | 仓库/Issue管理 | Medium   | stdio    | `github.json`     |
| **Puppeteer**  | 网页自动化     | Medium   | stdio    | `puppeteer.json`  |

**远程服务器** (HTTP+SSE传输) ⭐v0.18.0新增:

| 服务器名称 | 用途       | 安全级别 | 传输方式 | 配置文件              |
| ---------- | ---------- | -------- | -------- | --------------------- |
| **Weather** | 天气查询   | Low      | HTTP+SSE | `http-sse-example.json` |
| 自定义服务器 | 任意功能   | 可配置   | HTTP+SSE | 用户自定义配置         |

#### 2.9.3 架构设计

**目录结构**:

```
desktop-app-vue/src/main/mcp/
├── mcp-client-manager.js          # 核心客户端管理器(双传输支持)
├── mcp-tool-adapter.js            # 工具适配器(桥接到ToolManager)
├── mcp-security-policy.js         # 安全策略执行
├── mcp-config-loader.js           # 配置加载器
├── mcp-performance-monitor.js     # 性能监控
├── mcp-ipc.js                     # IPC 处理器
├── transports/
│   ├── stdio-transport.js         # Stdio 通信层(本地服务器)
│   └── http-sse-transport.js      # HTTP+SSE 通信层(远程服务器) ⭐v0.18.0新增
└── servers/
    ├── server-registry.json       # 可信服务器白名单
    └── server-configs/            # 服务器配置模板
        ├── filesystem.json
        ├── postgres.json
        ├── sqlite.json
        ├── git.json
        ├── fetch.json
        └── http-sse-example.json  # HTTP+SSE服务器配置模板 ⭐新增
```

**核心组件**:

1. **MCPClientManager** (`mcp-client-manager.js`)
   - 管理所有 MCP 服务器连接(stdio + HTTP+SSE)
   - 支持动态连接/断开服务器
   - 双传输类型支持: `STDIO` | `HTTP_SSE`
   - 统一错误处理和重试机制
   - 性能指标收集

2. **MCPToolAdapter** (`mcp-tool-adapter.js`)
   - 将 MCP 工具适配为 ToolManager 标准格式
   - 自动生成工具 Schema
   - 处理参数验证和转换

3. **MCPSecurityPolicy** (`mcp-security-policy.js`)
   - 执行安全策略(路径限制、权限检查)
   - 用户同意管理(高风险操作需确认)
   - 审计日志记录

4. **MCPPerformanceMonitor** (`mcp-performance-monitor.js`)
   - 追踪连接时间、调用延迟
   - 错误率统计
   - 内存使用监控

5. **HTTPSSETransport** (`transports/http-sse-transport.js`) ⭐v0.18.0新增
   - 932行生产级代码
   - HTTP POST 请求 + Server-Sent Events 响应
   - 自动重连和断路器模式
   - 心跳监控(30秒间隔)和健康检查(60秒间隔)
   - Bearer Token认证 + 自动刷新
   - 统计追踪(连接次数、请求数、字节数、延迟)

#### 2.9.4 安全机制

**多层安全防护**:

1. **服务器白名单** (`server-registry.json`)
   - 只有可信服务器才能被加载
   - 每个服务器需要明确声明能力和风险等级

2. **路径限制** (Filesystem 服务器)
   - `allowedPaths`: 只能访问指定目录
   - `forbiddenPaths`: 永久禁止访问的路径

   ```json
   {
     "allowedPaths": ["notes/", "imports/", "exports/"],
     "forbiddenPaths": [
       "chainlesschain.db",
       "ukey/",
       "did/private-keys/",
       "p2p/keys/"
     ]
   }
   ```

3. **用户同意机制**
   - 高风险操作(写文件、执行数据库写操作)需用户确认
   - 可选择"记住此选择"避免重复询问

4. **审计日志**
   - 所有 MCP 操作记录到 `.chainlesschain/logs/mcp-*.log`
   - 包含时间戳、服务器名、工具名、参数、结果

#### 2.9.5 配置管理

**配置优先级**:

1. `.chainlesschain/config.json` - 用户配置(最高优先级)
2. `servers/server-configs/*.json` - 默认配置模板

**示例配置 - Stdio本地服务器** (`.chainlesschain/config.json`):

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\data"],
        "autoConnect": false,
        "permissions": {
          "allowedPaths": ["notes/", "imports/"],
          "forbiddenPaths": ["chainlesschain.db", "ukey/"],
          "readOnly": false
        }
      }
    },
    "security": {
      "auditLog": true,
      "requireConsent": true,
      "trustRegistry": true
    }
  }
}
```

**示例配置 - HTTP+SSE远程服务器** ⭐v0.18.0新增:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "remote-api": {
        "enabled": true,
        "transport": "http-sse",
        "baseURL": "https://mcp.example.com",
        "apiKey": "sk-your-api-key",
        "headers": {
          "X-Custom-Header": "value",
          "X-Client-Version": "1.0.0"
        },
        "timeout": 30000,
        "maxRetries": 3,
        "retryDelay": 1000,
        "autoConnect": false,
        "heartbeat": {
          "enabled": true,
          "interval": 30000
        },
        "healthCheck": {
          "enabled": true,
          "interval": 60000
        },
        "circuitBreaker": {
          "threshold": 5,
          "timeout": 30000
        },
        "permissions": {
          "allowedTools": ["read_file", "search", "query"],
          "blockedTools": [],
          "requireConsent": true
        }
      }
    }
  }
}
```

**连接远程服务器示例**:

```javascript
const { MCPClientManager } = require('./mcp-client-manager');

const manager = new MCPClientManager();

// 方法1: 通过配置文件连接
await manager.connectServer('remote-api');

// 方法2: 动态配置连接
await manager.connectRemoteServer('custom-api', {
  baseURL: 'https://api.example.com/mcp',
  apiKey: 'your-api-key',
  timeout: 30000,
  heartbeat: { enabled: true, interval: 30000 }
});
```

#### 2.9.6 性能指标

**目标性能**:

- **连接时间**: 目标 < 500ms, 可接受 < 1s
- **工具调用延迟**: 目标 < 100ms, 可接受 < 200ms
- **错误率**: 目标 < 1%, 可接受 < 5%
- **内存使用**: 目标 < 50MB/服务器

**实时监控**: 在 **设置 → MCP 服务器 → 性能** 查看实时指标

#### 2.9.7 IPC 接口

**已实现的 IPC 通道** (`mcp-ipc.js`):

- `mcp:connect-server` - 连接 MCP 服务器
- `mcp:disconnect-server` - 断开服务器
- `mcp:list-servers` - 列出所有服务器
- `mcp:list-tools` - 列出服务器提供的工具
- `mcp:call-tool` - 调用 MCP 工具
- `mcp:get-performance-metrics` - 获取性能指标

#### 2.9.8 UI 集成

**MCPSettings 组件** (`src/renderer/components/MCPSettings.vue`):

- 启用/禁用 MCP 系统
- 查看已连接的服务器列表
- 连接/断开服务器
- 查看性能指标
- 配置服务器参数

#### 2.9.9 HTTP+SSE传输架构 ⭐v0.18.0新增

**连接状态机**:

```
DISCONNECTED → CONNECTING → CONNECTED
                    ↓            ↓
                  ERROR ← RECONNECTING
                    ↓
              CIRCUIT_OPEN (断路器打开)
```

**状态说明**:

| 状态 | 描述 | 触发条件 |
|------|------|----------|
| DISCONNECTED | 未连接 | 初始状态或主动断开 |
| CONNECTING | 连接中 | 调用connect()方法 |
| CONNECTED | 已连接 | 连接建立成功 |
| RECONNECTING | 重连中 | 连接断开,自动重连 |
| ERROR | 错误状态 | 连接/请求失败 |
| CIRCUIT_OPEN | 断路器打开 | 连续5次失败 |

**断路器模式**:

```javascript
// 断路器配置
circuitBreaker: {
  threshold: 5,          // 连续5次失败触发断路器
  timeout: 30000,        // 30秒后尝试恢复(半开状态)
  halfOpenMaxRetries: 3  // 半开状态最多3次重试
}

// 断路器状态
CLOSED (正常) → OPEN (熔断) → HALF_OPEN (测试恢复) → CLOSED
```

**心跳与健康检查**:

```javascript
// 心跳监控 (30秒间隔)
heartbeat: {
  enabled: true,
  interval: 30000,
  timeout: 5000,
  maxFailures: 3  // 3次心跳失败触发重连
}

// 健康检查 (60秒间隔)
healthCheck: {
  enabled: true,
  interval: 60000,
  historySize: 10  // 保留最近10次检查结果
}
```

**统计指标**:

```javascript
stats: {
  connectionAttempts: 0,
  successfulConnections: 0,
  failedConnections: 0,
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalBytesSent: 0,
  totalBytesReceived: 0,
  averageLatency: 0,
  circuitBreakerTrips: 0,
  reconnectAttempts: 0
}
```

#### 2.9.10 已知限制

- ✅ **HTTP+SSE传输已实现** (v0.18.0生产就绪)
- ✅ **错误恢复机制完善** (断路器模式 + 指数退避重试)
- ❌ 配置只能通过文件修改(UI 配置编辑器未实现)
- ❌ 跨平台路径处理需改进(当前偏向 Windows)

#### 2.9.11 路线图

**Phase 1 (v0.16.0 - POC)**: ✅ 完成 (2026-01-16)

- [x] 核心 MCP 集成
- [x] 5 个常用 MCP 服务器(stdio)
- [x] UI 管理界面
- [x] 安全策略

**Phase 2 (v0.18.0)**: ✅ 完成 (2026-01-17)

- [x] **HTTP+SSE 传输支持** ⭐核心亮点
- [x] 断路器模式和自动重连
- [x] 心跳监控和健康检查
- [x] Bearer Token认证
- [x] 远程服务器配置模板
- [x] 8个官方stdio服务器 + 自定义HTTP+SSE服务器

**Phase 3 (Q1 2026)**: 🚧 计划中

- [ ] UI 配置编辑器(图形化配置)
- [ ] 更多官方HTTP+SSE服务器
- [ ] 插件市场集成
- [ ] 性能监控可视化

**Phase 4 (Q2 2026)**: 📋 规划中

- [x] 自定义 MCP 服务器开发 SDK ✅ 2026-04-16 (`packages/cli/src/lib/mcp-scaffold.js` + `cc mcp scaffold <name>` — pure template generator, stdio/http transports, 27 tests)
- [x] 社区服务器仓库 ✅ 2026-04-16 (`packages/cli/src/lib/mcp-registry.js` + `cc mcp registry list|search|show|install|categories` — bundled 8-server catalog mirroring desktop community-registry, 31 tests — read-only; install delegates to `MCPServerConfig.add`)
- [ ] 高级权限管理(RBAC)
- [ ] 多用户支持

### 2.10 统一配置管理系统 ✅完成 (v0.16.0) ⭐新增

> **✅ 完成状态**: v0.16.0版本完成,生产可用
>
> **完成时间**: 2026-01-16
> **实施文件**: `desktop-app-vue/src/main/config/unified-config-manager.js`
> **灵感来源**: OpenClaude 最佳实践

#### 2.10.1 系统概述 ✅已实现

统一配置管理系统通过 `.chainlesschain/` 目录集中管理所有配置、日志、缓存和会话数据,提供了清晰的配置优先级和自动初始化机制。

**核心特性**:

- **集中化管理**: 所有配置和运行时数据统一存放
- **Git 友好**: 运行时数据被忽略,模板和规则受版本控制
- **自动初始化**: 首次运行自动创建目录结构
- **配置优先级**: 环境变量 > config.json > 默认配置

#### 2.10.2 目录结构

```
.chainlesschain/
├── config.json              # 核心配置(模型、成本、性能、日志)
├── config.json.example      # 配置模板(版本控制)
├── rules.md                 # 项目编码规则和约束
├── memory/                  # 会话和学习数据
│   ├── sessions/            # 对话历史
│   ├── preferences/         # 用户偏好
│   └── learned-patterns/    # 使用模式学习
├── logs/                    # 操作日志
│   ├── error.log            # 错误日志
│   ├── performance.log      # 性能日志
│   ├── llm-usage.log        # LLM 令牌使用日志
│   └── mcp-*.log            # MCP 审计日志
├── cache/                   # 缓存数据
│   ├── embeddings/          # 向量嵌入缓存
│   ├── query-results/       # 查询结果缓存
│   └── model-outputs/       # 模型输出缓存
└── checkpoints/             # 检查点和备份
    └── auto-backup/         # 自动备份
```

#### 2.10.3 配置优先级

1. **环境变量** (`.env`, 系统环境) - 最高优先级
2. **`.chainlesschain/config.json`** - 用户特定设置
3. **默认配置** - 代码中定义

#### 2.10.4 使用示例

```javascript
// 在主进程中
const { getUnifiedConfigManager } = require("./config/unified-config-manager");

const configManager = getUnifiedConfigManager();

// 获取配置
const modelConfig = configManager.getConfig("model");
console.log("默认 LLM 提供商:", modelConfig.defaultProvider);

// 获取路径
const logsDir = configManager.getLogsDir();
const cacheDir = configManager.getCacheDir();

// 更新配置
configManager.updateConfig({
  cost: {
    monthlyBudget: 100,
  },
});

// 清除缓存
configManager.clearCache("embeddings");
```

#### 2.10.5 迁移说明

- ✅ 现有 `app-config.js` 保持向后兼容
- ✅ 新代码应使用 `UnifiedConfigManager`
- ✅ 日志将逐步从 `userData/logs` 迁移到 `.chainlesschain/logs/`

### 2.11 预算跟踪系统 ✅完成 (v0.16.0) ⭐新增

> **✅ 完成状态**: v0.16.0版本完成,生产可用
>
> **完成时间**: 2026-01-16
> **实施文件**: `desktop-app-vue/src/renderer/components/BudgetAlertListener.vue`

#### 2.11.1 系统概述 ✅已实现

预算跟踪系统实时监控 LLM 令牌使用量和成本,当预算接近或超出限制时自动弹窗提醒用户。

**核心功能**:

- **实时监控**: 令牌使用量、成本计算、预算百分比
- **三级预警**: 50%(提醒)、80%(警告)、100%(超限)
- **自动弹窗**: BudgetAlertListener 监听预算事件并显示提醒
- **持久化**: 令牌使用记录存储到 `.chainlesschain/logs/llm-usage.log`

#### 2.11.2 预警机制

| 预算使用率 | 级别    | 操作                          |
| ---------- | ------- | ----------------------------- |
| 50%        | 🟡 提醒 | 弹窗通知,可继续使用           |
| 80%        | 🟠 警告 | 弹窗警告,建议控制使用         |
| 100%       | 🔴 超限 | 弹窗提示超限,可选择继续或停止 |

#### 2.11.3 UI 组件

**BudgetAlertListener** (`BudgetAlertListener.vue`):

- 全局监听 `cost:budget-alert` 事件
- 使用 Ant Design Modal 显示预警
- 提供"查看详情"链接跳转到设置页面
- 自动记录用户响应(继续/停止)

#### 2.11.4 集成方式

```javascript
// 在 App.vue 中引入
import BudgetAlertListener from "./components/BudgetAlertListener.vue";

// 自动监听预算事件,无需手动调用
```


#### 2.11.6 技术选型与实现 (v0.20.0)

**MCP集成**:
- **@modelcontextprotocol/sdk 1.25.2** - Model Context Protocol SDK
- **状态**: POC v0.1.0 (生产就绪)

**支持的MCP服务器** (5种):
- Filesystem - 文件系统操作
- PostgreSQL - 数据库查询
- SQLite - 本地数据库
- Git - 版本控制
- HTTP/Fetch - 网络请求

**实现文件** (16个文件):
- `mcp-client-manager.js` (24KB) - MCP客户端编排
- `mcp-security-policy.js` (20KB) - 深度防御安全策略
- `mcp-tool-adapter.js` (12KB) - 工具集成层
- `mcp-config-loader.js` (7KB) - 配置管理
- `mcp-ipc.js` (15KB) - IPC通信
- `mcp-performance-monitor.js` (12KB) - 性能追踪

**安全特性**:
- 工具屏蔽和权限控制
- 性能监控
- 配置UI管理
- IPC序列化处理
- MCP禁用时的降级处理

**完成状态**: POC v0.1.0 ✅ (多服务器支持,安全策略,性能监控)

