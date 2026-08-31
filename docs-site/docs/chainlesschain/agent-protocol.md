# Agent Protocol：单一 Schema 与多语言生成绑定

> **更新：2026-08-31｜公开基线：`@chainlesschain/agent-protocol@0.1.7`｜Wire Protocol：v1｜Node.js：≥ 22.12.0**
>
> Agent Protocol 是 CLI、SDK、IDE、桌面端和移动端之间的语言中立契约。`0.1.7` 已公开 canonical Agent stream event 的 payload-level discriminated union、typed envelope、严格 validator，以及 Context/Memory、App Server pilot、Graph history/retirement、可恢复 HumanTask 与 single-winner approval 所需的有界跨端契约；公开状态以 npm、不可变标签、CI 和安装回读为准。

## 概述

不同宿主如果分别手写 Thread、Turn、Item、审批、工具调用和 Graph 事件类型，很容易出现字段名、必填性、枚举值与生命周期语义漂移。Agent Protocol 用一份版本化 JSON Schema 定义 wire contract，再确定性生成 TypeScript、Python、Kotlin 和 Swift 绑定，并为运行时提供同源 validator。

它与 Agent SDK 的职责不同：

| 组件                        | 负责内容                                                       | 不负责内容                         |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| Agent Protocol              | Schema、wire 类型、validator、兼容性基线、多语言生成结果       | 启动 CLI、管理子进程、实现传输重试 |
| TypeScript/Python Agent SDK | `AgentSession`、`AppServerClient`、NDJSON/stdio 传输和宿主 API | 单独定义另一套协议语义             |
| CLI / App Server            | 执行状态机、权限、工具、Graph authority                        | 允许客户端绕过 Schema 扩权         |

当前 canonical Schema 已覆盖 App Server 的 Client/Server request/response/notification、Thread/Turn/Item、结构化审批、工具与 Graph 核心类型，并冻结 37 个现有 Agent stdout event discriminator 及其 payload。TypeScript/Python SDK、CLI、Desktop、VS Code、JetBrains、Android 与 iOS 的主要生产消费已纳入同源生成或 causal conformance；低流量 legacy/custom 展示 adapter 仍可能保留兼容投影，因此“单一 Schema”不表示所有历史 UI 类型已经清零。

## 核心特性

- **单一真相源**：`cc-agent-protocol.schema.json` 是 canonical 定义的唯一维护点。
- **确定性代码生成**：同一 Schema 生成 TypeScript、Python、Kotlin、Swift 与 CLI 内嵌 Schema；生成文件禁止手改。
- **同源运行时校验**：`validateProtocolMessage`、`validateProtocolDefinition` 和 `validateApprovalDecision` 直接由 Schema 语义驱动。
- **canonical payload union**：`CC_AGENT_STREAM_EVENT_TYPES`、`AgentStreamEventPayload`、`CanonicalAgentStreamEvent` 与严格 validator 从同一 Schema 生成；已知 discriminator 缺必填 payload 会被拒绝，transport 继续无损保留未知未来事件。
- **跨端因果一致性**：共享 fixture 固定两种合法并行工具交错、approval binding、terminal projection 与并发等价类，协议、SDK、CLI、Desktop 和双 IDE 必须给出一致结果。
- **兼容性基线**：冻结 `schema/baselines/v1.json`，区分 additive change 与 breaking change。
- **协议身份**：同时暴露 wire version、minimum compatible version 和 SHA-256 Schema digest。
- **安全审批**：`ApprovalDecision` 使用严格判别联合；非法值、未知授权类型或 binding 不匹配必须失败闭合。
- **多平台消费**：TypeScript/Python 使用 SDK 生成绑定，Kotlin/Swift 可消费协议包导出的生成源码。
- **独立发布**：CLI、Agent SDK、Agent Protocol 的包版本彼此独立，不能只凭其中一个版本推断另外两个。

## 系统架构

```text
packages/agent-protocol/schema/cc-agent-protocol.schema.json
                         │
                         ├── compatibility baseline: schema/baselines/v1.json
                         │
                         └── scripts/generate.mjs
                              ├── TypeScript → agent-sdk/src/generated/
                              ├── Python     → agent-sdk-python/.../generated_*.py
                              ├── Kotlin     → agent-protocol/generated/kotlin/
                              ├── Swift      → agent-protocol/generated/swift/
                              └── CLI Schema → cli/src/generated/
                                         │
              ┌──────────────────────────┼─────────────────────────┐
              ▼                          ▼                         ▼
       CLI / App Server           SDK / automation          IDE / native hosts
       authoritative state        typed transport           validate at boundary
```

数据流遵循三个边界：

1. Schema 定义可传输的结构和协议身份。
2. 生成器把结构投影到各语言，不重新发明业务语义。
3. CLI/Graph/宿主状态机负责权限和生命周期；类型通过不等于操作已获授权。

## 配置参考

### 安装公开稳定版

```bash
npm install @chainlesschain/agent-protocol@0.1.6
```

需要传输客户端时，安装对应 SDK：

```bash
npm install @chainlesschain/agent-sdk@0.2.5
pip install chainlesschain-agent-sdk==0.2.6
```

### 版本与身份字段

| 字段                              | 含义                             | 使用方式                             |
| --------------------------------- | -------------------------------- | ------------------------------------ |
| `CC_AGENT_PROTOCOL_VERSION`       | wire protocol 主版本             | 能力协商和兼容判断                   |
| `CC_AGENT_PROTOCOL_MIN_VERSION`   | 当前实现接受的最低 wire 版本     | 拒绝无法安全解释的对端               |
| `CC_AGENT_PROTOCOL_SCHEMA_DIGEST` | canonical Schema 的 SHA-256 摘要 | 诊断生成物/运行时是否来自同一 Schema |
| npm package version               | 协议包的发布版本                 | 依赖锁定、供应链追踪和升级           |

package version 与 wire version 不是同一概念：`0.1.x` 包可以继续承载 wire v1 的兼容增量；只有破坏 wire v1 语义的修改才需要新的协议主版本和独立迁移方案。

### 仓库开发命令

```bash
npm run generate --workspace=packages/agent-protocol
npm run check --workspace=packages/agent-protocol
npm test --workspace=packages/agent-protocol
npm pack --dry-run --workspace=packages/agent-protocol
```

- `generate`：从 Schema 重建全部受管生成物。
- `check`：只比较结果，发现 stale artifact 时失败，不修改文件。
- `baseline:freeze`：仅在已批准的协议版本治理流程中冻结新基线，不能用来掩盖 breaking change。

## 使用示例

### 校验收到的协议消息

```js
import {
  CC_AGENT_PROTOCOL_SCHEMA_DIGEST,
  CC_AGENT_PROTOCOL_VERSION,
  validateProtocolMessage,
} from "@chainlesschain/agent-protocol";

const result = validateProtocolMessage(incomingMessage);
if (!result.ok) {
  console.error(result.errors);
  throw new TypeError("Invalid Agent Protocol message");
}

console.log({
  wireVersion: CC_AGENT_PROTOCOL_VERSION,
  schemaDigest: CC_AGENT_PROTOCOL_SCHEMA_DIGEST,
});
```

### 对审批决定失败闭合

```js
import { assertApprovalDecision } from "@chainlesschain/agent-protocol";

try {
  assertApprovalDecision(hostDecision);
  // 结构合法后仍需由宿主核对 capability、scope、binding 和当前会话。
  applyHostPolicy(hostDecision);
} catch (error) {
  denyPendingOperation(error);
}
```

### 在升级前检查 Schema 兼容性

```js
import {
  CC_AGENT_PROTOCOL_SCHEMA,
  assertProtocolCompatible,
} from "@chainlesschain/agent-protocol";
import previousSchema from "./pinned-protocol-v1.json" with { type: "json" };

assertProtocolCompatible(previousSchema, CC_AGENT_PROTOCOL_SCHEMA);
```

兼容检查通过只说明结构变化未触发已知 breaking rule；真实宿主仍应重放共享 fixtures，并完成 CLI/SDK/IDE 的端到端 conformance。

## 性能指标

| 指标             | 当前约束或目标                                                          |
| ---------------- | ----------------------------------------------------------------------- |
| 协议包运行时依赖 | 0 个第三方运行时依赖                                                    |
| 代码生成         | 相同 Schema 和生成器输入必须字节确定；`check` 不允许漂移                |
| Schema 校验      | 同步、无网络、无文件写入；具体延迟由消息大小和宿主硬件决定              |
| 生成物体积       | 随 `$defs` 和目标语言线性增长；发布前由 `npm pack --dry-run` 检查包内容 |
| 兼容检查         | 对冻结 v1 baseline 执行；任何已识别 breaking change 立即失败            |

项目没有为所有设备公布统一的 validator 延迟 SLA。移动端或高吞吐宿主应使用自己的真实消息分布建立基准，不应把开发机微基准写成跨平台保证。

## 测试覆盖

Agent Protocol CI 在 Ubuntu、Windows 和 macOS 上执行：

1. 生成物 freshness 与 v1 baseline 兼容检查。
2. 协议包 validator、兼容性和 package export 测试。
3. TypeScript、Python、Kotlin、Swift 关键字段与语言关键字映射验证。
4. 共享 `ApprovalDecision` fixture 的跨语言 conformance。
5. macOS 上真实编译并重放 Swift 审批 fixture。
6. npm tarball 内容检查。

协议改动还应在消费端补齐定向测试。只通过协议包单测，不代表 CLI、Desktop、IDE 或移动端已经完成生产迁移。

## 安全考虑

- 在每个不可信输入边界执行 validator，不要只依赖 TypeScript 类型。
- `ApprovalDecision` 结构合法不等于获权；宿主必须再次核对请求绑定、最小权限、会话和策略摘要。
- 对未知审批枚举、缺失必填字段、非法 ID、越界数组和不匹配 digest 失败闭合。
- Schema digest 用于身份和漂移诊断，不是数字签名，也不能替代 npm provenance、代码签名或传输认证。
- additive 字段应允许旧客户端安全忽略，但未知事件不能自动映射成已授权动作。
- 生成目录属于构建产物；禁止手工修补某一种语言后绕过 Schema 与生成器。
- App Server 的 stdio 边界不等于公网认证层；如果增加网络传输，必须另行定义认证、TLS、来源和限流。

## 故障排查

| 现象                                   | 常见原因                                       | 处理方式                                                                      |
| -------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `Generated protocol artifact is stale` | 修改了 Schema 或生成器但未重建                 | 运行 `npm run generate --workspace=packages/agent-protocol`，检查全部生成文件 |
| `CC_PROTOCOL_BREAKING_CHANGE`          | 删除字段、收紧约束、增加必填字段或改变枚举语义 | 撤销破坏性修改，或启动新 wire version 的设计与迁移评审                        |
| 本地类型存在、运行时校验失败           | SDK 生成物、协议包或 CLI 内嵌 Schema 不同源    | 比较 package version 和 `CC_AGENT_PROTOCOL_SCHEMA_DIGEST`，重新锁定依赖       |
| Kotlin/Swift 字段名异常                | 语言关键字或 wire name 投影错误                | 不手改生成物；修改生成器并增加跨语言测试                                      |
| 新 CLI 事件让旧宿主中断                | 宿主没有保留未知事件或新增字段                 | 保留 raw payload 并采用 capability negotiation；不能把未知事件当成功          |
| npm 显示版本低于仓库清单               | 源码候选尚未正式发布                           | 以不可变 tag、CI、registry readback 为准，不从 `main` 推断公开版本            |

## 关键文件

| 文件                                                                               | 作用                            |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| `packages/agent-protocol/schema/cc-agent-protocol.schema.json`                     | canonical JSON Schema           |
| `packages/agent-protocol/schema/baselines/v1.json`                                 | wire v1 兼容基线                |
| `packages/agent-protocol/scripts/generate.mjs`                                     | 多语言确定性生成器              |
| `packages/agent-protocol/src/validation.mjs`                                       | Schema 驱动的运行时校验         |
| `packages/agent-protocol/src/compatibility.mjs`                                    | additive/breaking change 分类   |
| `packages/agent-protocol/generated/kotlin/CcAgentProtocol.kt`                      | Kotlin 生成绑定                 |
| `packages/agent-protocol/generated/swift/CcAgentProtocol.swift`                    | Swift 生成绑定                  |
| `packages/agent-sdk/src/generated/app-protocol.ts`                                 | TypeScript 生成绑定与 validator |
| `packages/agent-sdk-python/src/chainlesschain_agent_sdk/generated_app_protocol.py` | Python 生成绑定与 validator     |
| `packages/cli/src/generated/cc-agent-protocol.schema.json`                         | CLI 内嵌 Schema 镜像            |
| `.github/workflows/agent-protocol-ci.yml`                                          | 三平台协议门禁                  |

## 相关文档

- [Agent SDK：TypeScript + Python](./agent-sdk.md)
- [CLI Runtime 当前实现](./cli-runtime-current.md)
- [CC App Server 使用指南](./cli-app-server.md)
- [Agent Kernel 使用与运维](./cli-agent-kernel.md)
- [GraphRun 观测与评估](./cli-team-graph.md)
- [IDE Bridge](./ide-bridge.md)
- [107 单一协议 Schema 与自动代码生成设计](/design/modules/107-agent-protocol-codegen)
- [npm：@chainlesschain/agent-protocol](https://www.npmjs.com/package/@chainlesschain/agent-protocol)
