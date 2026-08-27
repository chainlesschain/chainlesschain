# 107. 单一协议 Schema 与自动代码生成

> 状态：**canonical 核心、37-event payload union 与主要生产消费已闭环**｜公开基线：Agent Protocol `0.1.5`、Agent SDK `0.2.4`、CLI `0.166.5`｜Wire Protocol：v1｜更新：2026-08-27
>
> 协调发布最终候选为 `2f5b0f263a`：Protocol `0.1.5`、TypeScript/Python SDK `0.2.4`、CLI `0.166.5` 与 Open VSX `0.37.70` 已完成不可变标签、CI、provenance 与 registry/marketplace readback。包版本与 wire v1 必须分开陈述；CLI `0.166.6@7f18511fbc` 已进入 npm，但其精确提交门禁未闭环，不属于上述完整发布证据。

## 1. 设计结论

Agent Protocol 必须作为独立基础模块治理，不能继续只作为 Agent SDK、IDE Bridge 或 App Server 的附属小节。它横跨 CLI、TypeScript/Python SDK、VS Code、JetBrains、Desktop、Web、Android/Wear 和 iOS，拥有独立的：

- canonical JSON Schema；
- compatibility baseline；
- 多语言确定性生成器；
- runtime validator；
- fixtures 与 conformance tests；
- 三平台 CI 与 npm 发布生命周期。

本模块定义协议所有权和演进规则。模块 103 继续描述 Agent Platform 总体边界，模块 104/105/106 分别描述 App Server、Graph Kernel 和 Agent Kernel，不再各自复制协议定义。

## 2. 问题与目标

### 2.1 需要消除的漂移

历史接入由不同语言分别维护事件 union 和字段映射，容易产生：

1. TypeScript 已新增字段，Python/Kotlin/Swift 遗漏；
2. `snake_case` wire name 被宿主改成语言字段名后无法回放；
3. 某客户端把可选字段当必填，或把未知事件当致命错误；
4. 审批类型在一端是 boolean、另一端是宽松字符串，造成越权或误拒绝；
5. 包版本升级被误认为 wire protocol 已 breaking bump；
6. 手改生成文件后 CI 无法证明所有消费者来自同一 Schema。

### 2.2 目标

- canonical 定义只维护一次，并能投影到四种语言和 CLI 内嵌 Schema。
- 生成结果确定、可复现、可在 CI 中执行 freshness 检查。
- additive change 默认保持 wire v1；breaking change 必须被 baseline gate 拦截。
- 安全敏感 union 采用严格生成模型和跨语言共享 fixture。
- 协议身份可由 wire version、minimum compatible version 与 Schema digest 共同诊断。
- 发布证据绑定精确提交，源码候选不得冒充 registry 稳定版。

### 2.3 非目标

- Schema 不实现 Agent Kernel、Graph Kernel 或 App Server 状态机。
- 类型校验不授予权限，也不替代宿主 policy/binding 检查。
- codegen 不负责传输、重试、队列、持久化或进程生命周期。
- 本模块不等同于用户功能 `cc codegen`；后者是代码生成 Agent，二者必须在命名和导航上区分。

## 3. 术语与版本身份

| 身份 | 当前值 | 作用 |
| --- | --- | --- |
| Wire Protocol | `1` | 对端能力协商与兼容主线 |
| Minimum compatible wire version | `1` | 当前实现可安全解释的最低 wire 版本 |
| 公开 npm 包 | `@chainlesschain/agent-protocol@0.1.5` | 已验证的公开安装基线 |
| 仓库包清单 | `0.1.5` | 与公开包一致；后续源码仍须独立验证 |
| Schema digest | `sha256:` 加 64 位十六进制摘要 | 判断 Schema/生成物是否同源 |
| CLI / SDK 版本 | CLI `0.166.5`、SDK `0.2.4` | 消费者发布身份，与协议包独立 |

包版本允许在 wire v1 内发布兼容增强、validator 修复和生成器改进。若修改会让既有合法消息失效、改变必填性或枚举语义，则必须进入新的 wire version 设计，不能只提升 npm patch/minor。

## 4. 单一真相源架构

```text
                         ┌─────────────────────────────┐
                         │ cc-agent-protocol.schema.json│
                         │ JSON Schema draft 2020-12   │
                         └──────────────┬──────────────┘
                                        │
                ┌───────────────────────┼───────────────────────┐
                │                       │                       │
                ▼                       ▼                       ▼
       baselines/v1.json       scripts/generate.mjs     runtime validators
       compatibility gate      deterministic codegen    JS/TS/Python
                │                       │                       │
                │          ┌────────────┼────────────┐          │
                │          ▼            ▼            ▼          │
                │     TypeScript     Python      Kotlin/Swift    │
                │          └────────────┼────────────┘          │
                └───────────────────────┼───────────────────────┘
                                        ▼
                       CLI / SDK / IDE / Desktop / Mobile
```

所有权规则：

1. Schema 是其已纳管定义的唯一源；生成文件只读。
2. 生成器负责语言投影，不得写入某客户端私有权限语义。
3. 消费端可增加 UI model 或 domain adapter，但必须保留 canonical wire value。
4. 尚未迁移的 legacy union 必须标记为兼容层，不能反向成为第二真相源。
5. 协议变更、生成物、fixtures 和消费端定向测试应在同一提交中闭环。

## 5. Schema 组织

根 Schema 使用 JSON Schema draft 2020-12，并通过 `$id` 固定 wire v1 身份。顶层 `oneOf` 接受四类 JSON-RPC envelope：

- `ClientRequest`
- `ClientResponse`
- `ServerRequest`
- `ServerNotification`

`$defs` 按职责承载：

| 类别 | 代表定义 | 设计要求 |
| --- | --- | --- |
| 基础值 | `Identifier`、`Digest`、`Timestamp`、`JsonValue` | 限长、格式与 wire name 稳定 |
| 生命周期 | Thread、Turn、Item | 状态枚举和 revision 语义不可静默改变 |
| 工具与审批 | tool request/result、`ApprovalDecision`、permission grant | 严格、失败闭合、绑定最小权限 |
| Agent/Graph | Agent Tree、GraphDefinition/Run、Message、Handoff、Effect、HumanTask | 因果关系、fence、receipt 与内容策略保持显式 |
| Transport | initialize、capability、request/response/notification | 有界、可协商、未知通知安全透传 |

对开放内容使用 `JsonValue` 或受控 `additionalProperties`；对权限、状态和身份对象优先 `additionalProperties: false`。不能为了“前向兼容”把安全敏感结构改成任意对象。

## 6. 确定性多语言代码生成

### 6.1 输出矩阵

| 目标 | 生成文件 | 主要消费者 |
| --- | --- | --- |
| TypeScript | `packages/agent-sdk/src/generated/app-protocol.ts` | Agent SDK、VS Code、Web/Node 宿主 |
| Python | `packages/agent-sdk-python/src/chainlesschain_agent_sdk/generated_app_protocol.py` | Python 自动化、CI 和服务集成 |
| Kotlin | `packages/agent-protocol/generated/kotlin/CcAgentProtocol.kt` | Android、Wear、JetBrains |
| Swift | `packages/agent-protocol/generated/swift/CcAgentProtocol.swift` | iOS/macOS 宿主 |
| JSON Schema 镜像 | `packages/cli/src/generated/cc-agent-protocol.schema.json` | CLI runtime validation |

### 6.2 生成器不变量

- 相同 Schema、生成器和 Node 版本必须生成字节一致的输出。
- 输出顺序由 Schema 顺序决定，不依赖文件系统枚举或 locale。
- wire field name 原样保留；遇到 Kotlin/Swift/Python 关键字时只改变语言标识符。
- string enum 必须保留精确 wire value，不能依赖大小写猜测。
- optional、nullable 与 missing 是不同语义，生成器不能合并。
- 生成文件首部标记 `AUTO-GENERATED`，评审不得接受单独手改生成物。
- `--check` 只比较，不写文件，适合作为 CI freshness gate。

### 6.3 开发命令

```bash
npm run generate --workspace=packages/agent-protocol
npm run check --workspace=packages/agent-protocol
npm test --workspace=packages/agent-protocol
npm pack --dry-run --workspace=packages/agent-protocol
```

`baseline:freeze` 是协议治理动作，不是普通格式化命令。只有在协议版本决策、迁移文档和兼容验证已完成后才能更新 baseline。

## 7. 兼容性模型

### 7.1 wire v1 内允许的变化

- 新增可选字段；
- 放宽既有 required；
- 新增独立 `$defs`；
- 在消费者能够保留未知值的边界新增非安全枚举或 variant；
- 新增 capability，并通过协商后使用。

### 7.2 默认判定为 breaking 的变化

- 删除定义、属性、variant 或枚举值；
- 改变 `type`、`const`、pattern 或既有 wire name；
- 增加 required 字段或把可选字段改成必填；
- 收紧 min/max、长度、数组大小或 `additionalProperties`；
- 改变审批、工具、Thread/Turn/Item 生命周期语义；
- 复用旧枚举值表达新的权限含义。

### 7.3 未知事件策略

展示、日志和诊断类事件允许旧客户端保留 raw payload 后继续；审批、工具执行、身份和权限类事件遇到未知值必须拒绝或进入显式 unsupported 状态。前向兼容不能以默认批准为代价。

兼容检查器是机械门禁，不取代语义评审。即使 Schema diff 被判为 additive，也要重放跨语言 fixtures，并验证旧宿主不会把新增字段错误映射为权限。

## 8. Validator 与信任边界

运行时 validator 提供两个层次：

1. `validateProtocolMessage` 校验顶层 JSON-RPC envelope。
2. `validateProtocolDefinition(name, value)` 校验指定 `$defs`。

安全敏感类型额外提供具名校验与 assert API，例如 `validateApprovalDecision` / `assertApprovalDecision`。设计要求：

- 在 stdin、WebSocket、IPC、插件消息和移动端桥接等不可信边界校验；
- 校验通过后仍由宿主重新核对 capability、scope、binding、policy digest 与 session identity；
- validator 异常、超时、未知决定或字段不匹配一律失败闭合；
- Schema digest 只用于同源诊断，不充当签名或认证；
- 日志记录错误路径和协议身份，不默认记录 prompt、message 或 secret 正文。

## 9. Fixtures、Conformance 与 CI

### 9.1 共享 fixtures

fixtures 是跨语言语义证据，不只是单元测试输入。每个安全敏感 union 至少覆盖：

- 全部合法 variant；
- 缺失必填字段；
- 多余安全字段；
- 类型错误和边界值；
- 语言关键字字段；
- 旧客户端兼容路径；
- 明确的非法/未知授权决定。

同一 fixture 必须被协议包、TS/Python SDK 以及具备生产消费路径的 Kotlin/Swift 宿主重放。复制 fixture 后各自修改会重新制造漂移。

### 9.2 CI 门禁

`.github/workflows/agent-protocol-ci.yml` 在 Ubuntu、Windows、macOS 上验证：

1. exact checkout identity；
2. codegen freshness 与 v1 baseline compatibility；
3. 协议 package tests；
4. macOS Swift 编译和 `ApprovalDecision` fixture replay；
5. public package tarball 内容。

正式发布还要绑定精确提交、不可变 tag、OIDC/provenance 和 registry readback。本地绿灯或部分 OS matrix 不能授权发布。

## 10. 发布流程

```text
Schema/生成器变更
      │
      ├─→ 生成全部语言绑定与 CLI Schema
      ├─→ 更新共享 fixtures / compatibility tests
      ├─→ 更新用户指南、107 设计章和 migration note
      └─→ PR exact-SHA 三平台 Agent Protocol CI
                         │
                         ▼
              版本决策与不可变 tag
                         │
                         ▼
              npm OIDC + provenance 发布
                         │
                         ▼
              全新环境 registry readback
```

发布记录必须分别写明：协议包版本、wire version、Schema digest、release tag/SHA、生成器版本来源、CI run 和消费端最低兼容版本。不能只写“协议已升级”。

## 11. 消费端迁移策略

| 消费端 | 目标状态 | 当前边界 |
| --- | --- | --- |
| TypeScript SDK | 生成类型 + validator + transport client | `KnownAgentStreamEvent` 直接别名生成的 canonical union，无第二份 wire union |
| Python SDK | 与 TS 同源生成模型和 fixture | 严格 payload union 已生成；开放 dataclass 层只保留 ergonomic dispatch |
| VS Code / Web | 通过 SDK 或同步生成物消费 | VS Code 生产 mapper 消费生成 inventory；Webview 不获得协议扩权 |
| JetBrains / Android / Wear | Kotlin 生成绑定 + adapter | JetBrains 与 Android 主要生产入口消费生成 enum/payload；未知事件保持兼容 |
| iOS/macOS | Swift 生成绑定 + host policy | RemoteSession 消费生成 envelope，原始未知 JSON 继续保留 |
| Desktop / CLI | boundary validator + canonical state mapping | 共用 causal fixture，Desktop 有界关联 trace，CLI 提供语义投影 |

迁移顺序优先安全敏感类型，再迁移生命周期与诊断事件：

1. ApprovalDecision / permission grant；
2. tool request/result 与 binding；
3. Thread/Turn/Item；
4. Graph message/handoff/effect/human task；
5. 其余 stream events 和展示投影。

旧字段只有在所有生产消费者、fixture 和回滚窗口都闭环后才能删除。

## 12. 性能与可靠性

- validator 必须同步、确定、无网络和无文件写入；传输层负责消息大小与队列上限。
- codegen 只在开发/发布阶段执行，不进入用户请求热路径。
- digest 在 Schema 加载时计算或从生成物常量读取，避免每条消息重复序列化整份 Schema。
- 大型 Graph payload 仍应通过引用、分页和有界集合传输；Schema 合法不代表 payload 适合无界加载。
- Kotlin/Swift 生成物必须真实编译，不能只用文本快照判断有效。
- consumer rollout 使用 capability negotiation、shadow validation 和可回滚版本锁定，不进行全客户端同时硬切。

项目暂不声明统一的跨设备 validator 延迟 SLA。各宿主应使用真实消息分布建立基准，并分别报告吞吐、p95/p99、分配量和拒绝率。

## 13. 当前状态与待完成项

### 已完成

- canonical JSON Schema、wire v1 metadata 和 Schema digest；
- v1 frozen baseline 与 breaking-change checker；
- TS/Python/Kotlin/Swift 确定性 codegen；
- CLI 内嵌 Schema 镜像；
- runtime validator 与严格 `ApprovalDecision`；
- 37 个现有 Agent stream discriminator 的 canonical `AgentStreamEventType`、payload-level discriminated union、typed envelope 与严格 validator；
- 跨语言关键字、生成物 freshness、package exports 与审批 fixtures；
- 协议、TS/Python SDK、CLI、Desktop、VS Code 与 JetBrains 共用的合法/非法及 causal interleaving fixtures；
- JetBrains/Android/iOS 主要生产消费迁移，未知未来事件保持 transport 可见；
- 三平台 Agent Protocol CI、Swift 编译重放、Android/iOS/Desktop/IDE consumer 门与 package tarball 检查；
- Agent Protocol `0.1.5`、TypeScript/Python Agent SDK `0.2.4`、CLI `0.166.5` 与 Open VSX `0.37.70` 的公开发布证据。

### 尚未完成

- 低流量 legacy/custom adapter 的剩余手写展示投影清零；
- 更长时间、高吞吐、崩溃恢复与恶意 payload fuzz 的全产品统一矩阵；
- wire v2 的正式演进/RFC 模板与双栈迁移演练；
- Android/iOS 可安装签名应用版本与 native 商店发行仍按各产品单独取证。

JetBrains Marketplace `0.4.100` 已公开并让 chat mapper、raw stdout fallback 与 lifecycle checks 走生成事件枚举；主线 `0.4.101` 已上传待审。Open VSX `0.37.70` 已公开。市场状态与 Desktop/mobile/native 应用发行身份仍需分别陈述。

## 14. 关键文件

| 路径 | 责任 |
| --- | --- |
| `packages/agent-protocol/schema/cc-agent-protocol.schema.json` | canonical Schema |
| `packages/agent-protocol/schema/baselines/v1.json` | wire v1 frozen baseline |
| `packages/agent-protocol/scripts/generate.mjs` | 多语言确定性生成器 |
| `packages/agent-protocol/src/validation.mjs` | runtime Schema validator |
| `packages/agent-protocol/src/compatibility.mjs` | 兼容性分类与 breaking gate |
| `packages/agent-protocol/test/fixtures/` | 跨语言共享 fixtures |
| `packages/agent-sdk/src/generated/app-protocol.ts` | TypeScript 生成物 |
| `packages/agent-sdk-python/src/chainlesschain_agent_sdk/generated_app_protocol.py` | Python 生成物 |
| `packages/agent-protocol/generated/kotlin/CcAgentProtocol.kt` | Kotlin 生成物 |
| `packages/agent-protocol/generated/swift/CcAgentProtocol.swift` | Swift 生成物 |
| `packages/cli/src/generated/cc-agent-protocol.schema.json` | CLI Schema 镜像 |
| `.github/workflows/agent-protocol-ci.yml` | 三平台协议 CI |

## 15. 相关文档

- [Agent Protocol 用户指南](https://docs.chainlesschain.com/chainlesschain/agent-protocol)
- [103 Agent SDK 平台化方案](./103_Agent_SDK平台化方案.md)
- [104 CC App Server 设计](./104_CC_App_Server设计.md)
- [105 Graph Kernel 设计](./105_Graph_Kernel设计.md)
- [106 Agent Kernel 设计](./106_Agent_Kernel设计.md)
- [98 IDE Bridge 对标方案](./98_IDE桥接对标方案.md)
- [CLI Runtime 当前实现](../cli-runtime-current.md)
- [Agent Protocol 包说明](https://github.com/chainlesschain/chainlesschain/tree/main/packages/agent-protocol)
