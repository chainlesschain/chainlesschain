# 安全沙箱 v2 (sandbox)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔒 **细粒度权限**: 文件系统（读/写/拒绝路径）、网络（允许/拒绝主机）、系统调用三维权限控制
- 📦 **资源配额**: CPU 时间、内存用量、存储空间、网络带宽四项资源限制
- 📝 **审计日志**: 沙箱内所有操作自动记录，支持事后审查
- 🔍 **行为监控**: 实时行为模式检测与风险评分
- 🛡️ **隔离执行**: 每个 Agent 独立沙箱环境，防止横向越权
- ⚠️ **异常告警**: 检测到高风险行为模式时自动告警

## 概述

ChainlessChain CLI 安全沙箱 v2 为智能体提供隔离执行环境。每个沙箱通过声明式权限配置控制 Agent 对文件系统、网络和系统调用的访问范围。资源配额机制防止单个 Agent 占用过多计算资源。

沙箱内置行为监控引擎，实时分析 Agent 的操作模式，通过模式匹配算法检测潜在恶意行为（如大量文件删除、异常网络访问、权限提升尝试等），为每个行为生成风险评分。所有操作记录到审计日志表，支持事后合规审查和安全分析。

## 命令参考

### sandbox create — 创建沙箱

```bash
chainlesschain sandbox create <agent-id>
chainlesschain sandbox create agent-001 --allow-read "/data,/config" --allow-write "/tmp"
chainlesschain sandbox create agent-002 --allowed-hosts "api.example.com,cdn.example.com"
chainlesschain sandbox create agent-003 --json
```

为指定 Agent 创建隔离沙箱。通过 `--allow-read`/`--allow-write` 控制文件系统访问路径，`--allowed-hosts` 控制网络访问白名单。默认拒绝 `/etc`、`/usr`、`/sys` 等系统目录。

### sandbox exec — 在沙箱中执行代码

```bash
chainlesschain sandbox exec <sandbox-id> --code "console.log('hello')"
chainlesschain sandbox exec <id> --file script.js --json
```

在指定沙箱环境中执行代码，所有操作受沙箱权限和配额约束。

### sandbox destroy — 销毁沙箱

```bash
chainlesschain sandbox destroy <sandbox-id>
```

销毁指定沙箱，释放所有资源并清理临时文件。

### sandbox list — 列出所有沙箱

```bash
chainlesschain sandbox list
chainlesschain sandbox list --active                      # 仅活跃沙箱
chainlesschain sandbox list --json
```

显示所有沙箱实例及其状态、权限配置、资源使用情况。

### sandbox audit — 查看审计日志

```bash
chainlesschain sandbox audit <sandbox-id>
chainlesschain sandbox audit <id> --limit 50 --json
```

查看指定沙箱的操作审计日志，包括文件访问、网络请求、系统调用等全部操作记录。

### sandbox quota — 设置资源配额

```bash
chainlesschain sandbox quota <sandbox-id> --cpu <ms> --memory <mb> --storage <mb> --network <kb>
chainlesschain sandbox quota sbx-001 --cpu 5000 --memory 256 --storage 100
```

为指定沙箱设置资源使用上限。`--cpu` 为 CPU 时间（毫秒），`--memory` 为内存（MB），`--storage` 为磁盘空间（MB），`--network` 为网络带宽（KB/s）。

### sandbox monitor — 行为监控

```bash
chainlesschain sandbox monitor <sandbox-id>
chainlesschain sandbox monitor <id> --json
```

获取指定沙箱的行为分析报告，包括检测到的行为模式、风险评分和异常事件列表。

## 权限模型

| 维度 | 配置项 | 说明 |
|------|--------|------|
| 文件系统 | `read` / `write` / `denied` | 读路径白名单、写路径白名单、拒绝路径黑名单 |
| 网络 | `allowed` / `denied` | 允许访问的主机列表、拒绝访问的主机列表 |
| 系统调用 | `allowed` / `blocked` | 允许的系统调用类型、阻止的系统调用类型 |

## 数据库表

| 表名 | 说明 |
|------|------|
| `sandbox_instances` | 沙箱实例（Agent ID、权限配置、配额、状态） |
| `sandbox_audit` | 审计日志（操作类型、目标、结果、时间戳） |
| `sandbox_behavior` | 行为记录（模式分类、风险评分、检测详情） |

## 系统架构

```
用户命令 → sandbox.js (Commander) → sandbox-v2.js
                                         │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
             权限检查引擎         资源配额管理器        行为监控引擎
          (文件/网络/系统)      (CPU/Mem/Disk/Net)    (模式检测+评分)
                    │                   │                   │
                    ▼                   ▼                   ▼
           sandbox_instances     sandbox_audit        sandbox_behavior
```

## 配置参考

```bash
# CLI 标志
--allow-read <paths>      # 逗号分隔的读路径白名单
--allow-write <paths>     # 逗号分隔的写路径白名单
--allowed-hosts <hosts>   # 逗号分隔的网络访问白名单
--cpu <ms>                # CPU 时间配额（毫秒）
--memory <mb>             # 内存配额（MB）
--storage <mb>            # 存储配额（MB）
--network <kb>            # 网络带宽配额（KB/s）
--limit <n>               # 审计日志返回条数
--json                    # JSON 格式输出

# 配置路径
~/.chainlesschain/chainlesschain.db         # sandbox_instances / sandbox_audit / sandbox_behavior 表
$APPDATA/chainlesschain-desktop-vue/.chainlesschain/config.json  # 沙箱默认配额
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| sandbox create | < 100ms | ~60ms | ✅ |
| sandbox exec (权限检查) | < 5ms | ~2ms | ✅ |
| sandbox audit (读取 100 条) | < 50ms | ~30ms | ✅ |
| sandbox monitor (行为评分) | < 80ms | ~50ms | ✅ |
| sandbox destroy (资源清理) | < 150ms | ~90ms | ✅ |

## 测试覆盖率

```
✅ sandbox.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/sandbox.js` — 命令实现
- `packages/cli/src/lib/sandbox-v2.js` — 沙箱管理库

## 使用示例

### 场景 1：创建受限沙箱执行代码

```bash
# 创建一个只读文件系统的沙箱
chainlesschain sandbox create --name "readonly-sandbox" \
  --permissions '{
    "fileSystem": {"read":["/tmp","/data"],"write":[],"denied":["/etc"]},
    "network": {"allowed":["api.example.com"],"denied":["*"]},
    "systemCalls": {"allowed":["read","stat"],"denied":["exec","fork"]}
  }'

# 在沙箱中执行命令
chainlesschain sandbox exec <sandbox-id> "cat /tmp/data.json"

# 查看沙箱审计日志
chainlesschain sandbox audit <sandbox-id>
```

### 场景 2：资源配额管理

```bash
# 创建带资源限制的沙箱
chainlesschain sandbox create --name "limited-sandbox" \
  --quota '{"cpu":50,"memory":134217728,"storage":52428800,"network":500}'

# 查看当前资源使用情况
chainlesschain sandbox quota <sandbox-id>

# 查看所有活跃沙箱
chainlesschain sandbox list --status active
```

### 场景 3：行为监控

```bash
# 监控沙箱的行为模式
chainlesschain sandbox monitor <sandbox-id>

# 销毁异常沙箱
chainlesschain sandbox destroy <sandbox-id>
```

## 故障排查

### 沙箱执行问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Permission denied: file write" | 文件路径不在 write 白名单中 | 修改 permissions 的 `fileSystem.write` 数组 |
| "Network blocked: host not allowed" | 访问的域名不在 allowed 列表 | 将域名添加到 `network.allowed` 白名单 |
| "Quota exceeded: memory" | 内存使用超过 quota 限制 | 增大 `memory` 配额或优化执行的代码 |
| "System call denied: exec" | 尝试执行被禁止的系统调用 | 将需要的系统调用加入 `systemCalls.allowed` |
| 沙箱无法创建 | 数据库未初始化 | 运行 `chainlesschain db init` |

### 常见错误

```bash
# 错误: "Sandbox not found"
# 原因: sandbox-id 不存在或已被销毁
# 修复:
chainlesschain sandbox list

# 错误: "Sandbox already destroyed"
# 原因: 尝试操作已销毁的沙箱
# 修复: 创建新沙箱
chainlesschain sandbox create --name "new-sandbox"

# 错误: "Risk score exceeded threshold"
# 原因: 行为监控检测到异常模式
# 修复: 查看审计日志分析异常原因
chainlesschain sandbox audit <sandbox-id> --json
```

## 安全考虑

- **最小权限原则**: 默认权限仅允许 `/tmp` 读写，网络仅允许 `localhost`，系统调用仅允许基本 I/O
- **路径遍历防护**: 文件系统访问检查使用绝对路径匹配，防止 `../` 路径遍历攻击
- **资源耗尽保护**: 默认配额限制 CPU 100%/内存 256MB/存储 100MB/网络 1000 请求，防止 DoS
- **行为分析**: 行为监控模块自动检测异常模式（高频系统调用、异常网络请求、文件系统扫描），计算风险评分
- **审计日志**: 所有沙箱操作（创建、执行、销毁）及权限检查结果都记录到 `sandbox_audit` 表，不可篡改
- **沙箱销毁**: `destroy` 操作清理所有运行时资源，确保沙箱无法被再次访问

## 相关文档

- [A2A 协议](./cli-a2a) — 智能体间通信
- [RBAC 权限](./cli-auth) — 基于角色的访问控制
- [审计日志](./cli-audit) — 系统级审计
- [Hook 管理](./cli-hook) — 沙箱事件钩子
