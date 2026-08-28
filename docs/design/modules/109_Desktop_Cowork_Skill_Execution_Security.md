# 109. Desktop Cowork Skill 执行安全与能力代理设计

> 状态：2026-08-28 已进入 Desktop 源码主线｜文档证据：`a404dad52c`、`39880afa06`、`c29953ecfd`、`c8a23a92e4`、`83f0c74c39`、`fe1303d927`、`e7c082d535`、`39b393684f`、`2286267dea`｜不属于 `chainlesschain@0.166.7` npm 制品

## 1. 目标与边界

Desktop Cowork Skill 同时包含包内置 Handler 与用户/市场提供的外部 Handler。二者不能共享一条“读取路径后直接 `require()`”的执行链：内置代码属于应用制品，外部代码属于需要重新验证的执行输入。

本模块建立四条不可绕过的边界：

1. 只有应用包内、通过目录包含关系与能力目录核对的内置 Handler 可以在 Electron 主进程内加载；
2. 外部 Handler 必须携带可信 Ed25519 签名、完整内容摘要和显式 `execution-capabilities`；
3. 外部 Handler 只在一次性隔离 Worker 中运行，宿主只注入经批准的窄能力端口；
4. 内置 Handler 的网络、进程、本地服务与环境值访问也必须经过带 authority、白名单、配额和审计的 Broker，能力声明本身不等于授权。

这不是通用插件信任声明，也不表示所有历史 Skill 都拥有相同能力。执行权始终由“当前字节身份 × 当前宿主策略 × 当前调用 authority”共同决定。

## 2. 信任分层

| 类型              | 代码身份                                     | 执行位置           | 准入条件                                                           | 失败策略                                       |
| ----------------- | -------------------------------------------- | ------------------ | ------------------------------------------------------------------ | ---------------------------------------------- |
| Bundled Skill     | 应用包内固定路径与 Handler SHA-256           | Electron 主进程    | 路径包含关系、`SKILL.md` 能力集、生成目录中的 Handler 摘要三者一致 | 能力目录漂移即拒绝执行并使 CI 失败             |
| External Skill    | workspace / managed / marketplace 等外部路径 | 一次性隔离 Worker  | Ed25519 签名可信、`.skill-lock.json` 与重读字节一致、能力清单合法  | 缺签名、未知签名者、摘要漂移或缺能力均失败闭合 |
| Prompt-only Skill | 无可执行 Handler                             | Agent 提示词上下文 | 正常 Markdown 解析与来源规则                                       | 不获得 Node.js 或宿主能力                      |

发现阶段只建立候选元数据。真正执行前必须重新读取 `SKILL.md`、Handler 和 lock，检查稳定文件身份、大小上限、真实路径、摘要与签名。发现后被替换的字节触发 `CC_SKILL_DIGEST_DRIFT`，不得沿用旧 authority。

## 3. 能力模型

能力名使用带命名空间的稳定标识，例如：

```yaml
execution-capabilities:
  - filesystem:read
  - network:https
  - process:exec
  - runtime:time
  - host:logger
```

能力清单只描述 Handler 可能请求的宿主表面，实际调用仍需满足：

```text
声明能力
  ∩ 当前 Skill 的生成能力目录
  ∩ 当前会话/任务 authority
  ∩ Broker 的目标、操作与预算策略
  = 本次可调用端口
```

因此，`network:https` 不等于可访问任意 URL；`process:exec` 不等于获得 shell；`filesystem:read` 也不等于可读取任意绝对路径。

## 4. 内置 Skill 能力目录

`scripts/sync-bundled-skill-capabilities.mjs` 使用 AST 审计内置 Handler 的宿主表面，生成 `bundled-skill-capability-catalog.js`。每条目录记录绑定：

- Skill id；
- Handler 源码 SHA-256；
- 排序后的能力集合。

运行时以已签入目录作为 authority；CI 重新生成并比较 Handler、`SKILL.md` 与目录。直接修改 Handler、少报能力、声明未使用能力或目录未同步都会使门禁失败。

目录审计解决“能力声明漂移”，不替代运行时 Broker。带副作用的 Handler 还必须从原生模块迁出，不能因为目录写了 `network:https` 就继续直接调用 `fetch`、`https`、`dns`、`net` 或 `child_process`。

## 5. 外部 Skill 隔离执行

外部 Handler 的执行链如下：

```text
Skill discovery
  → 执行前稳定重读
  → manifest / Ed25519 / trusted-key / digest 校验
  → 捕获已验证 Handler 源码快照
  → ProcessExecutionBroker 启动一次性 Worker
  → JSONL 有界协议
  → Capability Broker 转发获批请求
  → 有界结果 / 超时 / 中止 / 子进程回收
```

隔离 Worker 不接收可变 Handler 路径，而接收已经过摘要核对的源码快照。Worker 使用最小环境、`shell:false`、固定脚本入口与受控 cwd；所有 stdin/stdout/stderr frame、结果大小、能力请求数和执行时长都有硬上限。协议版本、execution id 或 frame 类型不匹配时立即终止。

外部 Handler 不直接持有 Electron、数据库、MCP client、Process Broker、网络模块或任意 Node.js require。它只能发送 `capability-request`，宿主再核对该能力是否声明、是否存在 approved port、是否超过请求上限，并记录开始、完成或拒绝审计事件。

## 6. 网络、本地服务与环境 Broker

2026-08-28 的源码批次已将以下内置 Handler 从原始网络模块迁到宿主 Broker：

- 固定域名外联：GitHub、Google Workspace、Notion、Tavily、天气、新闻与 YouTube 摘要等；
- 运行时域名外联：API Gateway、HTTP Client、Summarizer；
- 媒体与模型：图像生成、音频转写、免费模型管理，以及显式允许的 loopback 模型服务；
- 网络诊断：DNS、端口检查、ping 与 traceroute。
- 环境访问：API Gateway、GitHub、Google Workspace、Notion、Obsidian、Tavily、代码/媒体处理和自动化等 Handler 不再直接读取 `process.env`，只按生成策略取回当前 Skill 获准的逻辑键。

关键不变量：

- 域名策略不接受通配符或 IP 字面量；运行时域名必须绑定显式 declassification decision；
- DNS 解析后拒绝私网、loopback、link-local、multicast 和混合公网/私网结果，连接钉住已验证地址；
- 只允许 HTTPS，重定向重新执行同一目标校验；请求、响应、重定向、超时和字节数均有界；
- loopback 本地模型服务使用单独 Broker，不复用公网外联授权；
- ping/traceroute 使用固定可执行文件与字面 argv，经 ProcessExecutionBroker、`shell:false`、最小环境执行；
- 环境 Broker 绑定 Skill id 与 authority id，仅返回审查过的逻辑键；单值、快照总量和审计字段均有上限，审计事件不记录秘密值；
- shell 进程 Broker 绑定 Skill id、authority、允许根目录与可选 entrypoint，只接受审查过的 executable/subcommand/字面 argv；`cwd` 逃逸、shell 字符串、危险 Git/Kubernetes 操作、超限 timeout/buffer 或未批准 Node 入口均失败闭合，审计不记录 argv 与 adapter 输出；
- 所有允许或拒绝结果都携带 Skill id、authority/declassification id、操作与目标的有界审计字段。

## 7. Graph 与 Skill 边界

GraphRun 负责运行身份、权限、预算、revision 与耐久结算；Skill 执行安全负责某个节点内 Handler 的代码身份和宿主能力。两者必须串联但不能互相代替：

- Graph 节点获准执行，不代表其 Skill 获得未声明网络/进程能力；
- Skill Handler 成功返回，不代表 Graph 节点已经完成权威结算；
- Broker receipt 可以成为 Graph Effect/Artifact 证据，但 Renderer 的 Trace 投影不能反向授权下一次调用；
- replay 只重建事件投影，不盲目重放外部 Handler 副作用。

## 8. 打包、门禁与运维

Electron Builder 与 Forge 必须把可信 Worker 作为应用资源打包，同时保持外部 Handler 与 Worker 的代码边界。发布门至少验证：

1. 生成能力目录与全部内置 Handler、`SKILL.md` byte-identical；
2. 外部 Handler 从未进入主进程 `require()`；
3. 缺签名、未知 key、摘要漂移、超限 frame、超时和 abort 均失败闭合；
4. 已迁移 Handler 不再直接导入 raw HTTP/DNS/socket/process 模块；
5. 固定域名、动态域名、本地服务、网络诊断与环境 Broker 分别覆盖 SSRF、重定向、私网地址、shell 注入、未声明秘密读取和资源上限；
6. 打包产物中 Worker 路径可解析，且强制隔离不可用时拒绝启动。

## 9. 已知边界

- 本设计记录 Desktop Cowork 源码能力，不改变已发布 npm CLI `0.166.7` 的制品内容；
- Ed25519 签名证明“由可信 key 签署且字节未变”，不证明代码无漏洞；
- 能力 Broker 只约束迁移后的宿主表面，未迁移或 native 扩展必须单独审计；
- 网络 declassification 是显式授权证据，不是数据内容自动安全分类；
- 一次性 Worker 与有界协议降低驻留和逃逸面，但不能替代 OS 沙箱、最小权限账户和签名发布链。

## 10. 代码索引

- `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-execution-security.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/external-skill-executor.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/runtime/external-skill-worker.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-capability-catalog.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-egress-broker.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-local-service-broker.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-network-diagnostics-broker.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-environment-broker.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js`
- `desktop-app-vue/scripts/sync-bundled-skill-capabilities.mjs`
