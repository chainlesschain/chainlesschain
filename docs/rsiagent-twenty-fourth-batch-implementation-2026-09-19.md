# RSIAgent 第二十四次工程实施：工作区恢复集、学习语义与等预算效果合同

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十三次 SQLite 恢复快照耐久保留与迁移绑定](./rsiagent-twenty-third-batch-implementation-2026-09-18.md)<br>
> 状态：本批把 manifest 绑定的 workspace snapshot 与 SQLite snapshot 合并为同一耐久恢复集，并补齐旧学习记录的候选化语义、技能调用的直接环境绑定和 PM 等预算效果报告合同。仓库内协议与回归已经落地；operator deployment、独占 clone 原子替换、真实 Electron PM E2E 和实际 baseline/candidate Pilot 仍是目标环境验收项。

## 1. Manifest 绑定的 workspace snapshot

新增 [Desktop PM workspace snapshot](../desktop-app-vue/src/main/evolution/desktop-pm-workspace-snapshot.js)。签名 deployment 只能通过品牌化 snapshotter 提供以下固定输入：

- execution manifest digest；
- 绝对、真实且不经过符号链接的 workspace root；
- 规范、无重叠且不能逃逸根目录的 include path；
- 单文件、总字节数和文件数上限。

捕获过程拒绝符号链接与特殊文件，对目录和文件稳定排序，在读取文件前后复核大小与修改时间，并进行第二次元数据扫描。输出是确定性的 canonical archive；workspace root、捕获策略、archive 字节、文件数和 manifest 共同进入 seal。Desktop execution wrapper 在每轮执行前后捕获 workspace seal，路径或策略漂移会失败关闭。

该实现使用有界内存 archive，适合当前隔离试点，不是大型工作区的流式备份实现。

## 2. SQLite 与 workspace 的单一恢复集

[PM recovery snapshot store](../packages/cli/src/lib/evolution/pm-exploration-recovery-snapshot-store.js) 新增 v2 request/ack：

- 数据库 seal 与原始 SQLite backup 字节；
- workspace seal 与 canonical archive 字节；
- manifest、迁移类型、恢复角色和 transition evidence digest；
- 单一 recovery-set artifact digest、ref 和 durability receipt。

store 先验证两类 seal、固定域摘要、字节数和文件数，再把数据库与工作区编码为一个有长度前缀的 canonical recovery set。外部 authority 必须完成同步 retain 和逐字节 resolve，才会返回同时绑定两种介质的 v2 ack。

本批同时增加 `resolveTransitionSnapshot` 只读端口。它按已验证 ack 重新从 durability authority 回读 artifact，校验 authority binding 和 artifact digest，严格解析 canonical header 和长度边界，再分别复算数据库与 workspace 的固定域摘要。返回的是用途单一的恢复介质副本，不暴露通用 artifact store 或 writer。

transition recovery 新增 v2 兼容格式，可把对应 recovery snapshot ack 与认证 Ledger 链头一起回读。Desktop 遇到 v2 链头时，必须通过同一品牌化 store 完成 recovery set 的精确 readback，才能重建 tainted restart 状态；缺少 resolve 端口、异步替代端口或 ack/artifact 不一致都会在 Actor 调用前失败关闭。v1 历史链头仍可读取，但不会被推断为拥有恢复介质。

Desktop readiness 新增 `durable-workspace-recovery-snapshot` 门槛；配置了数据库 store 但没有 workspace snapshotter 时仍不能视为候选执行配置。

## 3. 旧自学习记录降级为候选线索

[self-improving-agent handler](../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/self-improving-agent/handler.js) 的学习格式升级为 v3：

- 旧 `verified: true` 不再获得置信度加成，也不再表示独立验证；
- 兼容回读时统一改写为 `verified: false`；
- 调用方反馈只记录为 `caller-check-passed`、`caller-check-failed` 或 `unchecked`；
- instinct 明确标记 `evidenceClass: caller-observation`、`promotionEligible: false`；
- 提取出的 skill 只处于 `candidate-only`，不能绕过既有 Eval/Review/Promotion 权威。

这关闭了旧模块“自己把自己标成 verified”所造成的语义歧义，但它仍不是正式经验的来源追溯、评审或晋级实现。

## 4. 技能调用收据直接绑定环境

[skill invocation receipt](../packages/session-core/lib/skill-invocation-receipt.js) 升级为 v2，把 `environmentDigest` 作为归因字段写入收据摘要。CLI 与 Desktop 的生产者均从已验证执行上下文传入该字段。

兼容规则如下：

- v2 收据必须按新字段集合和 v2 domain 复算；
- v1 历史收据仍可校验和读取；
- v1 因缺少直接环境绑定，在 trace projection 中明确标记 `legacyEnvironmentUnbound: true`；
- 混入 v1 或缺少环境摘要时，v2 projection 的 `complete` 与 `environmentBound` 都不会成为真。

这提供了环境变化后的重新归因基础，不会把历史 v1 回执自动提升为跨环境有效证据。

## 5. PM 等预算效果合同

[PM exploration benchmark](../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 新增 effect plan/report：

- 冻结 baseline/candidate artifact、suite、Eval Gate policy、Actor、模型、工具、权限、环境和 reset protocol digest；
- seed 必须与 Eval Gate policy 完全一致，且只评估冻结 test partition；
- baseline 与 candidate 使用同一个按 arm、按 seed 的 token、tool call、wall-clock 和费用上限；
- 除逐题独立评分成本外，显式计入探索、课程规划、记忆提炼、失败重试和环境重置；
- 每个非零成本阶段必须有 receipt digest；
- 每个 seed 必须完整覆盖同一批 test task，缺项、重复 task/seed 或阶段缺失均拒绝生成报告；
- 报告重算配对 score delta、固定 1000 次 bootstrap 95% 区间、两组完整成本以及安全/权限违规。

只有预算未越界、candidate 无安全或权限违规且置信区间下界达到事前门槛时，报告才写 `threshold-met`。即便如此，报告仍固定为 `requiresIndependentPilotApproval: true`、`qualifiesForPromotion: false`；实际签名 Eval Gate 和 Pilot 权威不能被该离线报告替代。

## 6. 回归证据

本批定向验证结果：

| 检查 | 结果 |
| ---- | ---- |
| Desktop 自学习、收据、部署、readiness、workspace snapshot | 10 files，106 passed |
| CLI PM benchmark、recovery set、transition committer、workbench 与调用链 | 13 files，243 passed |
| session-core 全量（含 v1/v2 receipt 兼容与环境绑定） | 26 files，558 passed |
| 合计 | 49 files，907 passed |
| ESLint（变更生产文件） | 0 errors；保留既有未使用变量 warnings |
| Prettier 与 `git diff --check` | passed |

新增负例覆盖路径逃逸、符号链接、大小预算、捕获期间变化、workspace 字节替换、恢复集回读替换、历史 v1 收据、缺少环境摘要、旧 verified 记录、等预算超限、安全退化、seed/task/阶段缺失和报告篡改。

## 7. 保留边界

- 当前机器仍没有 operator 签发的生产 deployment、durability authority 或断电恢复证据；
- `resolveTransitionSnapshot` 只交付已校验的恢复介质，不关闭数据库连接、不替换在线文件，也不解除 taint；
- 跨平台、崩溃一致的 clone-root 替换需要目标宿主拥有数据库连接与隔离 clone 的独占生命周期；普通 Desktop 主库不满足此前置条件，本批没有冒险写回；
- transition recovery v2 已能随认证链头回读并验证 recovery-set ack，但自动写回仍需要 operator recovery event 和独占 clone controller；历史 v1 链头不具备该绑定；
- G06 的正式来源追溯、G07 的撤销/复评传播仍需与生产 Promotion Controller 和部署策略做目标环境验收；
- G08 只完成冻结合同与可复算报告，尚未产生真实 PM baseline/candidate 对照数据；
- 没有新增 renderer/IPC 写入口，没有启动视觉 Explorer，也没有执行发布。

下一步应由目标宿主提供拥有隔离 clone 独占权的恢复控制器：关闭连接、解析已认证 recovery set、以平台支持的事务性切换替换 clone、重开并复核数据库/workspace 双 seal，最后提交认证恢复事件解除 taint。若宿主不能证明独占权或原子切换语义，应继续失败关闭，而不是操作应用主库。
