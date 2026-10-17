# CLI 0.166.104 与 IDE 会话恢复设计增量（2026-10-17）

## 发行与源码边界

截至主线 `ef26f20b28`，公开 npm CLI 为 **0.166.104**，Open VSX 为 **0.37.149**，JetBrains Marketplace 为 **0.4.166**；两个 IDE 均推荐 CLI 0.166.104。CLI 与 VS Code 的发行源码为 `93792f6520`，JetBrains 标签源码为 `4c3e5cfd56`。Agent SDK **0.2.15** 已先于 CLI 发布；Session Core **0.3.19**、Context/Memory Kernel **0.1.10**、Personal Data Hub **0.4.65** 沿用各自的独立版本。桌面、Android 和 iOS 安装包仍是独立的 **v5.0.3.140** 发行，不能从 CLI 或 IDE 的公开状态推断原生安装包已更新。

本轮 [CLI OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/39012587904/attempts/2)、[Open VSX 公开回读](https://github.com/chainlesschain/chainlesschain/actions/runs/39014016230/attempts/2)和 [JetBrains 宿主及市场工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/39020301946)均成功。JetBrains 公开 API 为 `ready`、`approve:true`、`listed:true`、`hidden:false`，公开 ZIP 已下载并校验完整性。Microsoft Marketplace 尚未发行。准确提交及制品证据见[发布准入记录](../research/cli/evidence/implementation-plan-2026-10-15/formal-paid-release-gate/README.md)。

## 会话预算与恢复

CLI 为 Jev 模型调用预留用量边界，并在观察结果或持久化状态未结清时隔离后续模型请求。取消中的调用不能被当作零费用；预算状态未知时拒绝继续。单次 headless、`stream-json` 和 REPL 恢复从已核验的 JSONL 会话确定预算根，保留原有上限，拒绝把新输入伪装成全新预算。

预算检查发生在模型发送前。项目预算锁的存储故障直接阻止 dispatch；已完成调用的结算与观察持久化故障也阻止后续决策。此行为收紧本地运行时边界，并不提供账户级账单证明。

## IDE 桥接与后台协议

Agent SDK 0.2.15 校验后台会话握手和状态 ID，拒绝畸形帧；后台及批处理子进程输出保留 UTF-8。CLI 的 MCP 客户端遇到断线会重新发现工具清单，不重放结果未知的工具调用。JetBrains 后台 NDJSON 输入有行长上界，真实宿主测试已覆盖迟到的主题引导窗口和未初始化的引导窗口。

恢复时的安全顺序是核对会话与预算根、检查未决用量、重连工具目录，然后继续下一次模型或工具操作。不能将重新连接理解为对结果未知的工具调用自动重试。

## 仍需完成的准入

正式付费评测保持 **NOT_PAID_READY / NOT_RUN**：36 项任务 **0/36**，9 次首次安装 **0/9**；完整 native review **NOT_ADMITTED**，自动晋升 **HOLD**。共享历史 **$99** 预算不得重置。缺少账户级价格与历史费用对账、生产独立单调检查点、可信宿主物理出口隔离及各冻结宿主的真实安装证据。CI、OIDC、市场上架与上述评测是不同证据。

用户安装和排障见[10 月 17 日升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-17.html)。[10 月 16 日设计](release-runtime-update-2026-10-16.md)保留当日的模型服务层级、引用快照与草稿容量设计。
