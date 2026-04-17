# CLI — Phase 8: Blockchain & Enterprise

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)
>
> Covers: economy, zkp, bi, compliance, dlp, siem, pqc, nostr, matrix, activitypub,
> scim, terraform, hardening, stress, reputation, sla, tech, dev, collab, marketplace,
> incentive, kg, tenant, governance, recommend, crosschain, privacy, inference, trust,
> social, fusion, infra.

```bash
chainlesschain economy pay / market list / nft mint
chainlesschain zkp compile / prove / verify
chainlesschain bi query / dashboard create / anomaly
chainlesschain compliance evidence / report / classify / scan
chainlesschain compliance frameworks [--json]                                   # 列出 SOC2 / ISO27001 / GDPR 模板
chainlesschain compliance report soc2 --format md|html|json [--output file]     # 详细合规框架报告
chainlesschain compliance report iso27001 --detailed                            # 强制使用模板报告器
chainlesschain compliance report gdpr --format html -o gdpr.html                # 写入文件
chainlesschain compliance threat-intel import feed.json                         # 导入 STIX 2.1 bundle
chainlesschain compliance threat-intel list [-t ipv4|domain|url|file-sha256...] # 列出已存储的 IoCs
chainlesschain compliance threat-intel match 1.2.3.4                            # 匹配观测值; 命中时 exit 2
chainlesschain compliance threat-intel stats [--json]                           # 按类型统计指标数量
chainlesschain compliance threat-intel remove ipv4 1.2.3.4                      # 移除单个指标
chainlesschain dlp scan / incidents / policy create
chainlesschain siem targets / add-target / export
chainlesschain pqc keys / generate / migration-status / migrate / algorithms
chainlesschain pqc algorithms                     # FIPS 203/204/205 + 混合算法目录
chainlesschain pqc algorithms -f slh-dsa --json   # 过滤: 6 种 SLH-DSA 变体 (128/192/256 × s/f)
chainlesschain pqc generate SLH-DSA-128s -p signing
chainlesschain pqc generate HYBRID-ED25519-SLH-DSA -p signing
chainlesschain nostr relays / publish / keygen / map-did / dm / dm-decrypt / delete / react
chainlesschain matrix login / rooms / send / thread send|list|roots / space create|add-child|children|list
chainlesschain activitypub actor create / publish / follow / accept / unfollow / like / announce / outbox / inbox / deliver / followers / following
chainlesschain scim users list / create / sync
chainlesschain terraform workspaces / create / plan
chainlesschain hardening baseline collect / compare / audit run
chainlesschain hardening config-check <path>                                    # 真实配置审计: 必填键、占位符、危险默认值
chainlesschain hardening config-check ./config.json -r db.host,server.port      # 校验必填键
chainlesschain hardening config-check ./config.json -f changeme,your-api-key    # 自定义禁用子串
chainlesschain hardening deploy-check [--json]                                  # 评估 6 项生产部署清单 (未就绪时 exit 2)
chainlesschain stress levels                                                    # 列出内置压力级别
chainlesschain stress run [-l light|medium|heavy|extreme] [-c N] [-r RPS] [-d MS] [--json]
chainlesschain stress list [-l level] [-s running|complete|stopped] [--limit N] [--json]
chainlesschain stress show <test-id> [--json]                                   # 完整指标 + 瓶颈
chainlesschain stress analyze <test-id> [--json]                                # 瓶颈分析
chainlesschain stress plan <test-id> [--json]                                   # 容量规划建议
chainlesschain stress stop <test-id>                                            # 标记运行中的测试为已停止
chainlesschain reputation observe <did> <score> [-k kind] [-w weight] [--json]  # 记录一次观察 (分数范围 [0,1])
chainlesschain reputation score <did> [-d exponential|linear|step|none] [--lambda N] [--alpha N] [--json]
chainlesschain reputation list [-d decay] [--limit N] [--json]                  # 按聚合分数列出 DIDs
chainlesschain reputation anomalies [-m z_score|iqr] [-t threshold] [-d decay] [--json]
chainlesschain reputation optimize [-o accuracy|fairness|resilience|convergence_speed] [-i iterations] [--json]
chainlesschain reputation status <run-id> [--json]                              # 优化运行状态
chainlesschain reputation analytics <run-id> [--json]                           # 分布 + 异常 + 建议
chainlesschain reputation runs [--limit N] [--json]                             # 优化运行历史
chainlesschain reputation apply <run-id>                                        # 标记运行为已应用
chainlesschain reputation objectives [--json]                                   # 列出支持的目标
chainlesschain rep ...                                                          # 短别名
chainlesschain sla tiers [--json]                                               # 列出内置 SLA 等级 (gold/silver/bronze)
chainlesschain sla create <org-id> [-t gold|silver|bronze] [-d duration-ms] [-f fee] [--json]
chainlesschain sla list [-o org] [-t tier] [-s active|expired|terminated] [--limit N] [--json]
chainlesschain sla show <sla-id> [--json]                                       # 显示合约条款 + 状态
chainlesschain sla terminate <sla-id>                                           # 标记合约为已终止
chainlesschain sla record <sla-id> <term> <value>                               # 字段: availability|response_time|throughput|error_rate
chainlesschain sla metrics <sla-id> [--json]                                    # 每条款聚合 mean/p95
chainlesschain sla check <sla-id> [--json]                                      # 检测违约 (response_time 用 p95, 其余用 mean)
chainlesschain sla violations [-s sla-id] [-S minor|moderate|major|critical] [--limit N] [--json]
chainlesschain sla compensate <violation-id> [--json]                           # base × multiplier，上限 2.0
chainlesschain sla report <sla-id> [--start ms] [--end ms] [--json]             # 合规率 % + 严重度分解
chainlesschain tech types [--json]                                              # 列出技术类型 / 等级 / 反模式
chainlesschain tech analyze [path] [--json]                                     # 解析 package.json / requirements.txt / Cargo.toml / go.mod
chainlesschain tech profile [path] [--json]                                     # 显示最近一次分析档案
chainlesschain tech detect <file> [--json]                                      # 启发式反模式扫描
chainlesschain tech practice <type> <name> <pattern> <level> [-d desc] [-s score]
chainlesschain tech practices [-t type] [-n name] [-l level] [--limit N] [--json]
chainlesschain tech recommend [--limit N] [--json]                              # 将实践匹配到已分析栈
chainlesschain dev levels [--json]                                              # 列出自治级别 L0..L4
chainlesschain dev phases [--json]                                              # 列出开发阶段 (requirement_analysis → deployment)
chainlesschain dev refactor-types [--json]                                      # 列出已知的重构类型
chainlesschain dev start "<requirement>" [-l 0..4] [-b author] [--json]         # 启动新开发会话 (默认 L2)
chainlesschain dev list [-s active|paused|completed|failed] [-p phase] [--limit N] [--json]
chainlesschain dev show <session-id> [--json]                                   # 完整会话详情 + 评审反馈
chainlesschain dev phase <session-id> <phase> [--json]                          # 进入新阶段
chainlesschain dev pause <session-id>                                           # ACTIVE → PAUSED
chainlesschain dev resume <session-id>                                          # PAUSED → ACTIVE
chainlesschain dev complete <session-id>                                        # 标记会话为已完成
chainlesschain dev fail <session-id> [-r reason]                                # 标记会话为失败
chainlesschain dev review <file> [-s session-id] [--min-score 0.7] [--json]     # 启发式评审 (复用 tech detectAntiPatterns)
chainlesschain dev adr <session-id> <title> <decision> [-c context] [-q conseq] [-a alt1,alt2] [-s proposed|accepted|deprecated|superseded] [--render] [--json]
chainlesschain dev adrs [-s session-id] [-S status] [--limit N] [--json]        # 列出 ADRs
chainlesschain collab decision-types [--json]                                   # 列出 5 种决策类型
chainlesschain collab strategies [--json]                                       # 列出 4 种冲突解决策略
chainlesschain collab metrics [--json]                                          # 列出 5 种质量指标
chainlesschain collab priorities [--json]                                       # 列出 5 个优先级 (CRITICAL..TRIVIAL)
chainlesschain collab permissions [--json]                                      # 列出 5 个权限层级 (L0..L4)
chainlesschain collab propose <type> "<proposal>" [--json]                      # 创建一个待定的治理决策
chainlesschain collab decisions [-t type] [-s status] [--limit N] [--json]
chainlesschain collab show <decision-id> [--json]                               # 完整详情 + 投票列表 + 统计
chainlesschain collab vote <decision-id> <agent-id> <approve|reject|abstain> [-r reason]
chainlesschain collab tally <decision-id> [-q quorum] [-t threshold] [-n totalVoters] [--json]
chainlesschain collab execute <decision-id>                                     # 标记已通过的决策为已执行
chainlesschain collab set-level <agent-id> <0..4> [-r reason] [--json]          # 设置 agent 自治级别
chainlesschain collab agent <agent-id> [--json]                                 # 显示 agent 自治级别 + 权限
chainlesschain collab agents [-l level] [--limit N] [--json]
chainlesschain collab match <required.json> <agent-skills.json> [--json]        # 技能匹配得分
chainlesschain collab optimize <tasks.json> <agents.json> [--json]              # 优先级排序 + 技能打分的任务分配
chainlesschain marketplace status-types [--json]                                # 列出 4 种服务状态 (draft|published|deprecated|suspended)
chainlesschain marketplace invocation-statuses [--json]                         # 列出 5 种调用状态
chainlesschain marketplace publish <name> [-v version] [-d desc] [-e endpoint] [-o owner-did] [-p pricing-json] [-s status] [--json]
chainlesschain marketplace list [-s status] [-o owner] [-n name-substr] [--limit N] [--json]
chainlesschain marketplace show <service-id> [--json]                           # 完整服务详情
chainlesschain marketplace status <service-id> <new-status>                     # 状态转移 (draft|published|deprecated|suspended)
chainlesschain marketplace record <service-id> [-c caller] [-i input-json] [-o output-json] [-s status] [-d duration-ms] [-e error] [--json]
chainlesschain marketplace invocations [-s service-id] [-c caller] [-S status] [--limit N] [--json]
chainlesschain marketplace stats [-s service-id] [--json]                       # 聚合: total、successRate、avgDurationMs、各状态计数
chainlesschain incentive contribution-types [--json]                            # 列出 7 种贡献类型及基础奖励
chainlesschain incentive tx-types [--json]                                      # 列出 4 种 tx 类型 (transfer|reward|mint|burn)
chainlesschain incentive balance <account-id> [--json]                          # 查询账户余额 + totalEarned/totalSpent
chainlesschain incentive accounts [--limit N] [--json]                          # 列出账户 (按余额降序)
chainlesschain incentive mint <to> <amount> [-r reason] [--json]                # 管理员操作: 向账户铸币
chainlesschain incentive transfer <from> <to> <amount> [-r reason] [--json]     # 账户间转账
chainlesschain incentive history [-a account] [-t type] [--limit N] [--json]    # 交易历史
chainlesschain incentive contribute <user-id> <type> [value] [-m metadata-json] [-a] [-M multiplier] [--json]
chainlesschain incentive reward <contribution-id> [-M multiplier] [--json]      # 奖励一个已记录的贡献
chainlesschain incentive contributions [-u user] [-t type] [--rewarded|--unrewarded] [--limit N] [--json]
chainlesschain incentive leaderboard [--limit N] [--json]                       # 按累计奖励排名的顶级贡献者
chainlesschain kg entity-types [--json]                                         # 列出 7 种标准实体类型 (Person/Organization/Project/Technology/Document/Concept/Event)
chainlesschain kg add <name> <type> [-p props-json] [-g tags-csv] [--json]      # 添加实体
chainlesschain kg list [-t type] [-n name-substr] [-g tag] [--limit N] [--json] # 列出实体
chainlesschain kg show <entity-id> [--json]                                     # 显示实体详情
chainlesschain kg remove <entity-id>                                            # 移除实体 (级联关系)
chainlesschain kg add-relation <source-id> <target-id> <relation-type> [-w weight] [-p props-json] [--json]
chainlesschain kg relations [-s source] [-t target] [-r type] [--limit N] [--json]
chainlesschain kg reason <start-id> [-d max-depth] [--direction out|in|both] [-r rel-type] [--include-start] [--json]
chainlesschain kg stats [--json]                                                # 实体/关系计数 + 类型分布 + 平均度数 + 密度
chainlesschain kg export [output-file]                                          # 导出图为 JSON (无文件则输出到 stdout)
chainlesschain kg import <input-file> [--json]                                  # 从 JSON 文件导入图
chainlesschain tenant plans [--json]                                            # 列出 4 种套餐 (free/starter/pro/enterprise) 及配额
chainlesschain tenant metrics [--json]                                          # 列出 3 种被追踪指标 (api_calls/storage_bytes/ai_requests)
chainlesschain tenant create <name> <slug> [-p plan] [-o owner] [-c config-json] [--json]
chainlesschain tenant configure <tenant-id> [-c config] [-p plan] [-s status] [-n name] [--json]
chainlesschain tenant list [-s status] [-p plan] [-o owner-substr] [--limit N] [--json]
chainlesschain tenant show <tenant-id> [--json]                                 # 租户 + 活跃订阅
chainlesschain tenant delete <tenant-id> [--hard]                               # 默认软删除
chainlesschain tenant record <tenant-id> <metric> <value> [-P period] [--json]
chainlesschain tenant usage <tenant-id> [-P period] [-m metric] [--json]       # 按指标聚合
chainlesschain tenant subscribe <tenant-id> -p <plan> [-a amount] [-d duration-ms] [--json]
chainlesschain tenant subscription <tenant-id> [--json]                         # 活跃订阅
chainlesschain tenant cancel <tenant-id>                                        # 取消活跃订阅
chainlesschain tenant subscriptions [-t tenant-id] [-s status] [-p plan] [--limit N] [--json]
chainlesschain tenant check-quota <tenant-id> <metric> [-P period] [--json]    # 用量 vs 套餐上限
chainlesschain tenant stats [--json]                                            # 租户/订阅/用量计数 + 分布
chainlesschain tenant export <tenant-id> [output-file]                          # JSON 快照 (无文件则输出到 stdout)
chainlesschain tenant import <input-file>                                       # 从 JSON 快照恢复
```

### Phase 97 V2 — Tenant Maturity + Subscription Lifecycle

5-state tenant maturity (`provisioning` / `active` / `suspended` / `archived` / `cancelled`)
+ 5-state subscription lifecycle (`pending` / `active` / `past_due` / `cancelled` / `expired`),
per-plan active-tenant cap, per-tenant open-subscription cap, auto-archive idle tenants,
auto-expire past-due subscriptions past grace. Legacy `tenant` surface above is unchanged.

```bash
chainlesschain tenant maturities-v2 | subscription-lifecycles-v2
chainlesschain tenant default-max-active-tenants-per-plan | max-active-tenants-per-plan |
      set-max-active-tenants-per-plan <n>
chainlesschain tenant default-max-subscriptions-per-tenant | max-subscriptions-per-tenant |
      set-max-subscriptions-per-tenant <n>
chainlesschain tenant default-tenant-idle-ms | tenant-idle-ms | set-tenant-idle-ms <ms>
chainlesschain tenant default-past-due-grace-ms | past-due-grace-ms | set-past-due-grace-ms <ms>
chainlesschain tenant active-tenant-count [-p plan]
chainlesschain tenant open-subscription-count [-t tenant]
chainlesschain tenant register-v2 <tenant-id> -p <plan> [-o owner] [-i initial-status] [-m metadata-json]
chainlesschain tenant tenant-v2 <tenant-id>
chainlesschain tenant set-maturity-v2 <tenant-id> <status> [-r reason] [-m metadata-json]
chainlesschain tenant activate <tenant-id> [-r reason]
chainlesschain tenant suspend <tenant-id> [-r reason]
chainlesschain tenant archive-v2 <tenant-id> [-r reason]
chainlesschain tenant cancel-tenant <tenant-id> [-r reason]
chainlesschain tenant touch-activity <tenant-id>
chainlesschain tenant subscription-register-v2 <sub-id> -t <tenant> -p <plan> [-e expires-at-ms] [-m metadata-json]
chainlesschain tenant subscription-v2 <sub-id>
chainlesschain tenant set-subscription-status-v2 <sub-id> <status> [-r reason] [-m metadata-json]
chainlesschain tenant activate-subscription <sub-id> [-r reason]
chainlesschain tenant mark-past-due <sub-id> [-r reason]
chainlesschain tenant cancel-subscription-v2 <sub-id> [-r reason]
chainlesschain tenant expire-subscription <sub-id> [-r reason]
chainlesschain tenant auto-archive-idle-tenants
chainlesschain tenant auto-expire-past-due-subscriptions
chainlesschain tenant stats-v2 [--json]
```

```bash
chainlesschain governance types [--json]                                        # 列出 4 种提案类型 (parameter_change/feature_request/policy_update/budget_allocation)
chainlesschain governance statuses [--json]                                     # 列出 5 种提案状态
chainlesschain governance impact-levels [--json]                                # 列出 4 种影响级别 (low/medium/high/critical)
chainlesschain governance create <title> [-t type] [-d description] [-p proposer-did] [--json]
chainlesschain governance list [-s status] [-t type] [--limit N] [--json]
chainlesschain governance show <proposal-id> [--json]
chainlesschain governance activate <proposal-id> [-d duration-ms] [--json]     # draft → active
chainlesschain governance close <proposal-id> [-q quorum] [-t threshold] [-n total-voters] [--json]  # active → passed/rejected
chainlesschain governance expire <proposal-id>                                  # draft|active → expired
chainlesschain governance vote <proposal-id> <voter-did> <yes|no|abstain> [-r reason] [-w weight] [--json]
chainlesschain governance votes <proposal-id> [--limit N] [--json]
chainlesschain governance tally <proposal-id> [-q quorum] [-t threshold] [-n total-voters] [--json]
chainlesschain governance analyze <proposal-id> [--json]                        # 启发式影响分析 (风险/收益/组件)
chainlesschain governance predict <proposal-id> [--json]                        # 启发式投票预测
chainlesschain governance stats [--json]                                        # 提案/投票计数 + 分布
chainlesschain recommend content-types [--json]                                 # 列出 4 种内容类型 (note/post/article/document)
chainlesschain recommend statuses [--json]                                      # 列出推荐状态
chainlesschain recommend feedback-values [--json]                               # 列出反馈值 (like/dislike/later)
chainlesschain recommend create-profile <user-id> [-t topics-json] [-w weights-json] [--json]
chainlesschain recommend profile <user-id> [--json]                             # 显示兴趣档案
chainlesschain recommend update-profile <user-id> [-t topics-json] [-w weights-json] [-d decay] [--json]
chainlesschain recommend delete-profile <user-id> [--json]
chainlesschain recommend profiles [--limit N] [--json]                          # 列出所有档案
chainlesschain recommend decay <user-id> [--json]                               # 对主题权重应用时间衰减
chainlesschain recommend generate <user-id> -p <pool-json> [-l limit] [-m min-score] [--json]
chainlesschain recommend list <user-id> [-s status] [-t type] [-m min-score] [--limit N] [--json]
chainlesschain recommend show <rec-id> [--json]                                 # 显示推荐详情
chainlesschain recommend view <rec-id> [--json]                                 # 标记为已查看
chainlesschain recommend feedback <rec-id> <like|dislike|later> [--json]        # 提交反馈
chainlesschain recommend dismiss <rec-id> [--json]                              # 忽略推荐
chainlesschain recommend stats <user-id> [--json]                               # 总数/待定/已查看/反馈率
chainlesschain recommend top-interests <user-id> [--limit N] [--json]           # 权重最高的主题
chainlesschain recommend suggest <user-id> [--json]                             # 基于反馈建议档案调整
chainlesschain crosschain chains [--json]                                       # 列出 5 条支持的链 (ethereum/polygon/bsc/arbitrum/solana)
chainlesschain crosschain bridge-statuses [--json]                              # 列出 6 种桥状态
chainlesschain crosschain swap-statuses [--json]                                # 列出 5 种 swap 状态
chainlesschain crosschain bridge <from> <to> <amount> [-a asset] [-s sender] [-r recipient] [--json]
chainlesschain crosschain bridge-status <bridge-id> <status> [-t tx-hash] [-e error] [--json]
chainlesschain crosschain bridge-show <bridge-id> [--json]
chainlesschain crosschain bridges [-f from-chain] [-t to-chain] [-s status] [--limit N] [--json]
chainlesschain crosschain swap <from> <to> <amount> [-a from-asset] [-b to-asset] [-c counterparty] [-t timeout-ms] [--json]
chainlesschain crosschain swap-claim <swap-id> [-s secret] [-t tx-hash] [--json]
chainlesschain crosschain swap-refund <swap-id> [-t tx-hash] [--json]
chainlesschain crosschain swap-show <swap-id> [--json]
chainlesschain crosschain swap-secret <swap-id> [--json]                        # 揭示 HTLC 秘密 (仅在 claim 之后)
chainlesschain crosschain swaps [-f from-chain] [-s status] [--limit N] [--json]
chainlesschain crosschain send <from> <to> [-p payload] [-c contract] [--json]  # 跨链消息
chainlesschain crosschain msg-status <msg-id> <status> [-t tx-hash] [--json]
chainlesschain crosschain msg-show <msg-id> [--json]
chainlesschain crosschain messages [-f from] [-t to] [-s status] [--limit N] [--json]
chainlesschain crosschain estimate-fee <from> <to> <amount> [--json]            # 启发式费用估算 (USD)
chainlesschain crosschain stats [--json]                                        # 桥/swap/消息计数 + 交易量
chainlesschain privacy protocols [--json]                                       # 列出 MPC 协议 (shamir/beaver/gmw)
chainlesschain privacy dp-mechanisms [--json]                                   # 列出 DP 机制 (laplace/gaussian/exponential)
chainlesschain privacy he-schemes [--json]                                      # 列出 HE 方案 (paillier/bfv/ckks)
chainlesschain privacy fl-statuses [--json]                                     # 列出 FL 状态
chainlesschain privacy create-model <name> [-t type] [-a arch] [-r rounds] [-l lr] [-p N] [--json]
chainlesschain privacy train <model-id> [--json]                                # 执行一轮训练
chainlesschain privacy fail-model <model-id> [-r reason] [--json]
chainlesschain privacy show-model <model-id> [--json]
chainlesschain privacy models [-s status] [--limit N] [--json]
chainlesschain privacy create-computation <type> [-p proto] [-i ids] [-t threshold] [--json]
chainlesschain privacy submit-share <computation-id> [--json]                   # 提交 MPC 份额
chainlesschain privacy show-computation <computation-id> [--json]
chainlesschain privacy computations [-p proto] [-s status] [--limit N] [--json]
chainlesschain privacy dp-publish [-d data] [-e epsilon] [-m mechanism] [--json] # 以 DP 噪声发布
chainlesschain privacy he-query [-d data] [-o operation] [-s scheme] [--json]    # 模拟 HE 查询
chainlesschain privacy report [--json]                                          # 隐私预算 + FL/MPC 统计
chainlesschain inference node-statuses [--json]                                 # 列出节点状态 (online/offline/busy/degraded)
chainlesschain inference task-statuses [--json]                                 # 列出任务状态
chainlesschain inference privacy-modes [--json]                                 # 列出隐私模式 (standard/encrypted/federated)
chainlesschain inference register <node-id> [-e url] [-c caps] [-g gpu-mb] [--json]
chainlesschain inference unregister <id> [--json]                               # 移除推理节点
chainlesschain inference heartbeat <id> [--json]                                # 发送节点心跳
chainlesschain inference node-status <id> <status> [--json]                     # 更新节点状态
chainlesschain inference show-node <id> [--json]
chainlesschain inference nodes [-s status] [-c capability] [--limit N] [--json]
chainlesschain inference submit <model> [-i input] [-p priority] [-m mode] [--json]
chainlesschain inference complete <task-id> [-o output] [-d duration-ms] [--json]
chainlesschain inference fail-task <task-id> [-e error] [--json]
chainlesschain inference show-task <task-id> [--json]
chainlesschain inference tasks [-s status] [-m model] [-p privacy] [--limit N] [--json]
chainlesschain inference stats [--json]                                         # 节点/任务计数 + 平均时延
chainlesschain trust anchors [--json]                                           # 列出信任锚 (tpm/tee/secure_element)
chainlesschain trust hsm-vendors [--json]                                       # 列出 HSM 厂商 (yubikey/ledger/trezor/generic)
chainlesschain trust compliance-levels [--json]                                 # 列出合规级别 (fips_140_2/fips_140_3/cc_eal4)
chainlesschain trust sat-providers [--json]                                     # 列出卫星运营商 (iridium/starlink/beidou)
chainlesschain trust attest <anchor> [-c challenge] [-f fingerprint] [--json]   # 信任证明
chainlesschain trust attest-show <id> [--json]
chainlesschain trust attestations [-a anchor] [-s status] [--limit N] [--json]
chainlesschain trust interop-test <algorithm> [-p peer] [-l latency-ms] [--json] # PQC 互操作测试
chainlesschain trust interop-tests [-a algorithm] [--limit N] [--json]
chainlesschain trust sat-send <payload> [-p provider] [-r priority] [--json]    # 发送卫星消息
chainlesschain trust sat-status <id> <status> [--json]                          # 更新卫星消息状态
chainlesschain trust sat-show <id> [--json]
chainlesschain trust sat-messages [-p provider] [-s status] [--limit N] [--json]
chainlesschain trust hsm-register <vendor> [-m model] [-s serial] [-c compliance] [-f firmware] [--json]
chainlesschain trust hsm-remove <id> [--json]
chainlesschain trust hsm-show <id> [--json]
chainlesschain trust hsm-devices [-v vendor] [--limit N] [--json]
chainlesschain trust hsm-sign <device-id> [-d data] [-a algorithm] [--json]     # 使用 HSM 签名
chainlesschain trust stats [--json]                                             # 证明/互操作/卫星/HSM 计数
chainlesschain social contact / friend / post / chat / stats
chainlesschain social analyze "<text>" [--top-k 3] [--lang zh|ja|en] [--json]
chainlesschain social detect-lang "<text>" [--json]
chainlesschain social graph add-edge <source> <target> [-t follow|friend|like|mention|block] [-w 1.0] [-m '<json>']
chainlesschain social graph remove-edge <source> <target> [-t follow]
chainlesschain social graph neighbors <did> [-d out|in|both] [-t <type>] [--json]
chainlesschain social graph snapshot [-t <type>]
chainlesschain social graph watch [-e edge:added,edge:removed] [--once]   # NDJSON 流
chainlesschain fusion protocols [--json]                                        # 列出 4 种协议 (did/activitypub/nostr/matrix)
chainlesschain fusion quality-levels [--json]                                   # 列出质量级别 (high/medium/low/harmful)
chainlesschain fusion send -s <source> [-t target] [-f sender] -c <content>     # 跨协议消息
chainlesschain fusion msg-show <id> [--json]                                    # 显示消息详情
chainlesschain fusion messages [-p protocol] [--limit N] [--json]               # 列出统一消息
chainlesschain fusion map-identity [-d did] [-a activitypub] [-n nostr] [-m matrix] [--json]
chainlesschain fusion identity <did> [--json]                                   # 按 DID 查询身份映射
chainlesschain fusion identities [--limit N] [--json]                           # 列出身份映射
chainlesschain fusion verify-identity <id> [--json]                             # 验证身份映射
chainlesschain fusion assess <content> [-i content-id] [--json]                 # 评估内容质量
chainlesschain fusion quality-show <id> [--json]                                # 显示质量评分详情
chainlesschain fusion quality-scores [-l level] [--limit N] [--json]            # 列出质量评分
chainlesschain fusion quality-report [--json]                                   # 内容质量报告
chainlesschain fusion translate <text> -t <target-lang> [-s source-lang] [--json]  # 翻译文本 (模拟)
chainlesschain fusion detect-lang <text> [--json]                               # 检测语言
chainlesschain fusion translation-stats [--json]                                # 翻译缓存统计
chainlesschain fusion stats [--json]                                            # 协议融合 & AI 社交统计
chainlesschain infra deal-statuses [--json]                                     # 列出交易状态 (pending/active/expired/failed)
chainlesschain infra route-types [--json]                                       # 列出路由类型 (tor/domain_front/mesh_ble/mesh_wifi/direct)
chainlesschain infra deal-create -c <cid> -s <bytes> [-m miner] [-p price] [-d epochs] [--json]
chainlesschain infra deal-status <id> <status> [--json]                         # 更新交易状态
chainlesschain infra deal-renew <id> [--json]                                   # 续订存储交易
chainlesschain infra deal-show <id> [--json]                                    # 显示交易详情
chainlesschain infra deals [-s status] [--limit N] [--json]                     # 列出存储交易
chainlesschain infra version-add -c <cid> [-p parent] [-d dag] [-n peers] [--json]
chainlesschain infra version-show <id> [--json]                                 # 显示内容版本
chainlesschain infra versions [-c cid] [--limit N] [--json]                     # 列出内容版本
chainlesschain infra version-cache <id> [--json]                                # 标记版本为已缓存
chainlesschain infra route-add -t <type> [-e endpoint] [-l latency] [-r reliability] [--json]
chainlesschain infra route-status <id> <status> [--json]                        # 更新路由状态
chainlesschain infra route-remove <id> [--json]                                 # 移除路由
chainlesschain infra route-show <id> [--json]                                   # 显示路由详情
chainlesschain infra routes [-t type] [-s status] [--limit N] [--json]          # 列出抗审查路由
chainlesschain infra connectivity [--json]                                      # 连通性报告
chainlesschain infra stats [--json]                                             # 基础设施统计
```

### Phase 85 — Agent Economy 2.0 (`economy` extension)

Strictly-additive V2 layer on top of the pre-existing `economy` command. Adds
four frozen canonical enums (4 payment types / 5 channel statuses / 5 resource
types / 4 NFT statuses), payment-type-aware pricing (per_call / per_token /
per_minute / flat_rate), two-sided state-channel lifecycle with conservation-
enforced settlement, NFT mint → list → buy (with royalty split) → burn state
machine, and weighted task-contribution revenue distribution.

```bash
chainlesschain economy payment-types [--json]                   # per_call / per_token / per_minute / flat_rate
chainlesschain economy channel-statuses [--json]                # open / active / settling / closed / disputed
chainlesschain economy resource-types [--json]                  # compute / storage / model / data / skill
chainlesschain economy nft-statuses [--json]                    # minted / listed / sold / burned

# Pricing model (rate is the unit-price for the chosen payment type)
chainlesschain economy price-v2 <service-id> <payment-type> <rate> [-m '{"json"}']
chainlesschain economy price-get <service-id> [--json]

# Unit-aware payment (picks --tokens|--minutes|--calls by pricing model)
chainlesschain economy pay-v2 <from> <to> <service-id> [--tokens N | --minutes N | --calls N]

# State channel lifecycle (deposits are two-sided; settlement preserves total)
chainlesschain economy channel-open-v2 <partyA> <partyB> --deposit-a N --deposit-b N
chainlesschain economy channel-activate <channel-id>
chainlesschain economy channel-settle <channel-id> --final-a N --final-b N   # |a+b-total| < 1e-9
chainlesschain economy channel-close-v2 <channel-id>
chainlesschain economy channel-dispute <channel-id> [-r reason]
chainlesschain economy channels-v2 [--status s] [--party did] [--json]

# Resource listing & NFT lifecycle
chainlesschain economy market-list-v2 <seller-id> --resource-type t --name n --price N [--available N]
chainlesschain economy nft-mint-v2 <owner> --asset-type t [--royalty 0..50] [--metadata '{}']
chainlesschain economy nft-list <nft-id> <price>
chainlesschain economy nft-buy <nft-id> <buyer>                 # royalty split to current owner
chainlesschain economy nft-burn <nft-id>
chainlesschain economy nft-status <nft-id> [--json]

# Weighted task-contribution revenue distribution
chainlesschain economy contribute-task <task-id> <agent-id> <weight>
chainlesschain economy contributions-task <task-id> [--json]
chainlesschain economy distribute-v2 <task-id> <total>          # share = total × weight / totalWeight
chainlesschain economy distributions [-t task-id] [--json]
chainlesschain economy stats-v2 [--json]
```

**Settlement conservation**: `initiateSettlement` enforces
`|finalBalanceA + finalBalanceB − (balanceA + balanceB)| < 1e-9` to prevent
mint/burn via settlement. Violations throw `Settlement must preserve total`.

**Royalty semantics**: V2 does not track original-minter separately; on first
sale both royalty and sale proceeds credit the current `nft.owner`. Multi-
resale royalty routing (original-minter registry) remains future work.

**Scope / 未移植**: On-chain token settlement, zk-rollup batch verification,
real payment-gateway bridges, and market-maker price oracles remain Desktop-
only. The CLI port is the deterministic record-keeping + policy surface:
enum validation, pricing math, channel lifecycle state machine, NFT state
machine, and proportional revenue math.

### Phase 88 — ZKP Engine (Zero-Knowledge Proof extension)

Extends `chainlesschain zkp` with the Phase 88 canonical surface: frozen
`PROOF_SCHEME` (groth16/plonk/bulletproofs) + `CIRCUIT_STATUS`
(draft/compiled/verified/failed) enums, scheme-parametric proof generation
(scheme-specific shapes + scheme-aware structural verification), credential
registry with deterministic merkle-root, and on-demand selective disclosure
that preserves the credential root.

```bash
# Schemes and statuses reference
chainlesschain zkp schemes [--json]                         # groth16 / plonk / bulletproofs + circuit statuses

# Circuit status lifecycle (compile auto-sets COMPILED, explicit override otherwise)
chainlesschain zkp set-status <circuit-id> <status>         # draft|compiled|verified|failed

# Scheme-parametric proof generation (default: groth16)
chainlesschain zkp prove <circuit-id> --scheme plonk --private '{"x":1}' --public '[1]'
chainlesschain zkp prove <circuit-id> --scheme bulletproofs

# Credential registry (deterministic merkle root over sorted field-value-hash leaves)
chainlesschain zkp register-credential --did did:example:alice --claims '{"name":"A","age":30}' [--json]
chainlesschain zkp credentials [--did did:example:alice] [--json]

# Selective disclosure (reveals subset, preserves credential merkle root)
chainlesschain zkp disclose <credential-id> name,age --to did:example:verifier [--json]
```

**Scope / 未移植**: Real Groth16/PLONK/Bulletproofs proving circuits, snarkjs /
circom toolchain integration, on-chain verifier contract generation, and
trusted-setup ceremony coordination remain Desktop-only. The CLI port covers
the deterministic record-keeping surface: circuit lifecycle state, scheme-aware
proof shape validation, credential registry with merkle-root, and selective
disclosure with root preservation — sufficient for policy prototyping,
credential schema design, and verifier-side integration tests.

### Phase 95 — BI Analytics V2 (`bi` extension)

Extends `chainlesschain bi` with the Phase 95 canonical surface: 5 frozen
enums (`CHART_TYPE`, `ANOMALY_METHOD`, `REPORT_FORMAT`, `REPORT_STATUS`,
`DASHBOARD_LAYOUT`), intent-detection NL→SQL, IQR anomaly method alongside
existing z-score, R²-backed trend confidence, chart recommendation from
intent/data shape, layout-validated dashboards, and a report status state
machine.

```bash
# Enum listings
chainlesschain bi chart-types [--json]               # table/bar/line/pie/area/scatter/heatmap/funnel/gauge
chainlesschain bi anomaly-methods [--json]           # z_score / iqr
chainlesschain bi report-formats [--json]            # pdf / excel / csv / json
chainlesschain bi report-statuses [--json]           # draft / generated / scheduled / archived
chainlesschain bi dashboard-layouts [--json]         # grid / flow / tabs

# Intent-detection NL→SQL (heuristic; no LLM call)
chainlesschain bi query-v2 "how many users?"                           # COUNT(*) + bar
chainlesschain bi query-v2 "total revenue" --schema '{"tables":["sales"]}'  # SUM + gauge
chainlesschain bi query-v2 "revenue trend over time"                   # LINE + ORDER BY created_at ASC
chainlesschain bi query-v2 "top 5 users by revenue" --json             # LIMIT 5 + bar

# Anomaly detection with method selection
chainlesschain bi anomaly-v2 --data 1,2,3,4,100 --method iqr [--threshold 1.5] [--json]
chainlesschain bi anomaly-v2 --data 10,12,11,13,50 --method z_score --threshold 2 --json

# Linear trend prediction with R² confidence (high/medium/low)
chainlesschain bi predict-v2 --data 1,2,3,4,5 --periods 3 [--json]     # method=linear (only)

# Chart recommendation from intent keywords + data shape
chainlesschain bi recommend-chart --intent "trend over last year"      # → line
chainlesschain bi recommend-chart --intent "distribution of types"     # → pie
chainlesschain bi recommend-chart --data-shape timeseries              # → line

# Dashboard with layout validation (grid | flow | tabs)
chainlesschain bi dashboard-v2 --name "Sales" --layout grid --widgets '[{"type":"kpi"}]'

# Report status state machine (draft↔generated→scheduled; archived→draft only)
chainlesschain bi set-report-status <report-id> generated
chainlesschain bi set-report-status <report-id> scheduled              # only from generated
chainlesschain bi report-status <report-id> [--json]
chainlesschain bi report-history <report-id> [--json]

# V2 aggregated stats
chainlesschain bi stats-v2 [--json]    # dashboards + reports byStatus/byFormat + scheduled + templates + chartTypes
```

**Scope / 未移植**: Real NL→SQL with schema introspection + LLM grounding,
live dashboard rendering (WebGL/D3 charts), PDF/Excel export engines, and cron
scheduler for scheduled reports remain Desktop-only. The CLI port covers the
deterministic analytics-surface: intent-classified SQL templates, bounded
anomaly detection (z-score + IQR), R²-scored trend prediction, chart-type
advisor, layout-validated dashboard records, and the report lifecycle state
machine — sufficient for agent-driven BI scaffolding, CI regression against
query templates, and policy prototyping.

### Phase 50 — DLP V2 (`dlp` extension)

Extends `chainlesschain dlp` with the Phase 50 canonical surface: 3 frozen
enums (`DLP_ACTION`, `DLP_CHANNEL`, `DLP_SEVERITY`), channel-scoped policies
with descriptions, a UTF-8-byte-length size gate on scans, metadata attachment
on every incident, rich incident filters, 5 built-in policy templates, and an
extended stats breakdown. Strictly additive — pre-existing `scan/incidents/
resolve/stats/policy create|list|delete` commands are preserved.

```bash
# Enum listings
chainlesschain dlp actions          # allow / alert / block / quarantine
chainlesschain dlp channels         # email / chat / file_transfer / clipboard / export
chainlesschain dlp severities       # low / medium / high / critical
chainlesschain dlp default-max-size # Default scan size limit (10 MB)

# V2 policy create — channel filter + description
chainlesschain dlp policy create-v2 "SSN" \
  -d "Detects SSN in outbound email" \
  -c email,chat \
  -p "\\d{3}-\\d{2}-\\d{4}" \
  -a block -s high

chainlesschain dlp policy show-v2 <policy-id>             # policy + description + channels
chainlesschain dlp policy active-for email                # enabled + channel-applicable

# Built-in templates — credit-card / cn-id-number / email-address / api-key / plaintext-password
chainlesschain dlp templates list
chainlesschain dlp templates install                      # install all 5
chainlesschain dlp templates install credit-card api-key  # install selected

# V2 scan — channel filter + UTF-8 byte-size gate + metadata
chainlesschain dlp scan-v2 "content here" -c email -u alice \
  -m '{"source":"smtp","ip":"10.0.0.1"}'
chainlesschain dlp scan-v2 "...payload..." -c chat --max-size 524288  # override 512 KB

# V2 incidents — rich filter (channel/severity/resolved/user/policy/fromDate/toDate/limit)
chainlesschain dlp incidents-v2 -c email -s high -r false -u alice --limit 20
chainlesschain dlp incidents-v2 --from 2026-04-01T00:00:00Z --to 2026-04-17T23:59:59Z
chainlesschain dlp incident-v2 <incident-id>                          # full record + metadata

# V2 stats + highest-severity aggregate
chainlesschain dlp stats-v2            # byAction/bySeverity/byChannel/topPolicies[5]+activePolicies
chainlesschain dlp highest-severity    # {highestSeverity: "critical" | null}
```

**Action priority aggregation**: when multiple policies match a single scan,
the highest action wins: `allow < alert < block < quarantine`. Scans returning
`block` or `quarantine` report `allowed=false`; `alert` is allowed through
but still records an incident.

**Channel filter semantics**: a policy with `channels: []` acts as a wildcard
(applies to every channel). A non-empty `channels[]` restricts the policy to
that set. During `scan-v2`, channel-mismatched policies are temporarily
disabled for the duration of the scan (state restored in `finally`) so
subsequent scans on matching channels still hit them.

**Scope / 未移植**: OS-level file/clipboard/email hooks, outbound TLS MITM
for real-time network DLP, OCR/image-based content matching, encrypted-at-rest
quarantine vault, and SOAR playbook automation remain Desktop-only. The CLI
port covers the deterministic detection surface: regex+keyword policies with
channel targeting, size-gated + metadata-stamped scans, the 4-action priority
aggregation, incident lifecycle + rich queries, and 5 built-in templates
— sufficient for CI regression on policy libraries, scripted scanning in data
pipelines, and agent-driven policy design.

### Phase 51 — SIEM V2 (`siem` extension)

Extends `chainlesschain siem` with the Phase 51 canonical surface: 4 frozen
enums (`SIEM_FORMAT`, `SIEM_TARGET_TYPE`, `SIEM_SEVERITY`, `SIEM_TARGET_STATUS`),
CEF/LEEF/JSON format builders with ArcSight severity mapping (DEBUG=1…FATAL=10),
target state machine (active ↔ paused/disabled/error, disabled→active only via
active), batch-aware exporter (default 100 logs/batch), extended stats
breakdown, and status-filtered listing. Strictly additive — pre-existing
`targets / add-target / export / stats` commands are preserved.

```bash
# Enum listings
chainlesschain siem formats                 # json / cef / leef
chainlesschain siem target-types            # splunk_hec / elasticsearch / azure_sentinel
chainlesschain siem severities              # debug / info / warn / error / critical / fatal
chainlesschain siem statuses                # active / paused / disabled / error
chainlesschain siem default-batch-size      # {"batchSize": 100}

# Severity → CEF integer (0-10)
chainlesschain siem severity-cef warn       # {"severity":"warn","cef":5}
chainlesschain siem severity-cef critical   # {"severity":"critical","cef":9}

# Format a single log record for inspection
chainlesschain siem format-log cef -l '{"eventId":"e1","severity":"error","message":"boom","userId":"alice"}'
chainlesschain siem format-log leef -l '{"eventId":"e2","timestamp":1709100000000,"userId":"bob","action":"export"}'
chainlesschain siem format-log json -l '{"severity":"info","message":"hi","userId":"u1"}'

# V2 target CRUD with canonical options
chainlesschain siem add-target-v2 -t splunk_hec -u https://splunk.example.com/hec -f cef -c '{"token":"abc"}'
chainlesschain siem remove-target <target-id>
chainlesschain siem set-status <target-id> paused      # state machine enforced
chainlesschain siem by-status active                   # filter targets by status

# V2 batch export — skipped when target status != active
chainlesschain siem export-v2 <target-id> -l '[{"id":"1"},{"id":"2"}]'
chainlesschain siem export-v2 <target-id> -l '[...250 logs...]' -b 50    # 5 batches

# V2 extended stats
chainlesschain siem stats-v2   # totalTargets + totalExported + byFormat/byType/byStatus + per-target
```

**Target state machine**: `active` ↔ `paused` ↔ `active`, `active → disabled`,
`disabled → active` (re-enable), `error` is recoverable to any other state.
`disabled → paused` is rejected — disabled targets must transition through
`active` first.

**Batch semantics**: `exportLogsV2` chunks logs into slices of `batchSize`
(default `SIEM_DEFAULT_BATCH_SIZE = 100`). Non-active targets return
`{ skipped: true, reason }` instead of exporting. Empty-log input records
no batches but still touches `lastExportAt` for observability parity.

**Scope / 未移植**: Real HTTP POST to Splunk/Elasticsearch/Sentinel, TLS
client cert auth, retry/backoff on transport failure, live audit-log tailing,
auto-export cron, and SIEM-side ingestion ACK tracking remain Desktop-only.
The CLI port covers deterministic format conversion, target lifecycle,
batch accounting, and stats aggregation — sufficient for CI regression
against CEF/LEEF templates, integration-test fixtures, and SIEM-target
design.

### Phase 42 — EvoMap Advanced Federation & Governance V2 (`evomap` extension)

Strictly-additive V2 surface on top of `evomap federation` / `evomap gov`.
All legacy subcommands continue to work unchanged.

```bash
# Federation — enums & classifiers
cc evomap federation hub-statuses           # [online,offline,syncing,degraded]
cc evomap federation trust-tiers            # [low,medium,high]
cc evomap federation mutation-types         # [mutation,recombination,crossover,drift]
cc evomap federation trust-tier <score>     # classify 0..1 → low|medium|high
cc evomap federation set-hub-status <id> <status>  # V2 state machine
cc evomap federation list-hubs-v2 [--min-trust <n>] [--trust-tier <tier>]
cc evomap federation context                # LLM-friendly aggregate snapshot
cc evomap federation stats-v2               # byStatus/byRegion/byTrustTier/byMutationType

# Governance — enums & V2 proposal lifecycle
cc evomap gov proposal-statuses             # [draft,active,passed,rejected,executed,expired,cancelled]
cc evomap gov proposal-types                # [standard,gene_standard,config_change,dispute,funding]
cc evomap gov vote-directions               # [for,against,abstain]
cc evomap gov propose-v2 -t <title> [--type <t>] [--quorum <n>] [--threshold <r>]
cc evomap gov vote-v2 <proposal-id> <direction> [-w <weight>]
cc evomap gov set-status <proposal-id> <status>   # V2 state machine
cc evomap gov execute <proposal-id>               # passed → executed
cc evomap gov cancel <proposal-id>                # active → cancelled
cc evomap gov expire                              # bulk expire past-deadline active proposals
cc evomap gov list-v2 [--status s] [--type t] [--proposer did]
cc evomap gov contributions <gene-id>
cc evomap gov stats-v2
```

**Hub status state machine**:

- `online` → {offline, syncing, degraded}
- `offline` → {syncing, online}
- `syncing` → {online, degraded, offline}
- `degraded` → {online, offline}

Unknown statuses or illegal transitions throw; the backing DB row is updated
only after the in-memory state machine approves the transition.

**Trust tiers**: `low < 0.3 ≤ medium < 0.7 ≤ high`. `listHubsV2` annotates each
hub with its tier and supports `--min-trust` / `--trust-tier` filters on top
of the legacy region/status filters.

**Proposal state machine**:

- `draft` → {active, cancelled}
- `active` → {passed, rejected, expired, cancelled}
- `passed` → {executed}
- Terminal: rejected, executed, expired, cancelled

**Weighted voting**: `vote-v2` accepts a `--weight` value (default 1).
Passage is computed from the `for` weight ratio over the decisive weight
(for + against), ignoring abstain in the ratio but counting it toward the
quorum. The proposal flips to `passed` when `weightFor / (weightFor +
weightAgainst) >= threshold` *and* total votes (including abstain) ≥ quorum.

**Bulk expiry**: `expire` walks active proposals, flips any whose
`votingDeadline` is in the past to `expired`, and returns
`{ expiredCount, expiredIds }`.

**Federation context**: `buildFederationContext()` returns `{ hubCount,
onlineHubs, totalGenes, avgFitness, avgTrust, avgTrustTier, regions }` —
sized for LLM prompt injection without listing individual hubs.

**Stats V2 shape**:

```json
{
  "totalHubs": 3,
  "totalGenes": 12,
  "byStatus":   { "online": 2, "offline": 1, "syncing": 0, "degraded": 0 },
  "byRegion":   { "us": 2, "eu": 1 },
  "byTrustTier": { "low": 0, "medium": 2, "high": 1 },
  "byMutationType": { "mutation": 8, "recombination": 4 }
}
```

```json
{
  "totalProposals": 5,
  "totalOwnerships": 8,
  "totalVotes": 23,
  "totalWeight": 41,
  "byStatus": { "active": 2, "passed": 2, "rejected": 1, ... },
  "byType":   { "standard": 3, "funding": 2, ... }
}
```

**Scope / 未移植**: Multi-Hub libp2p sync with real gene-payload transfer,
DID+VC originality proofs with cryptographic verification, reputation-weighted
voting stakes, on-chain proposal execution settlement, automatic revenue
distribution to `revenueSplit` DIDs, plagiarism detection via gene-content
similarity, and EvoMap DAO dispute arbitration all remain Desktop-only. The
CLI port covers hub/proposal lifecycle state machines, weighted voting math,
type-scoped quorum/threshold, and aggregate stats — sufficient for CI
regression against Phase 76-77 design invariants and test fixtures.

### Phase 56 — Terraform V2 (`terraform` extension)

Extends `chainlesschain terraform` with the Phase 56 canonical surface:
3 frozen enums, a concurrency limiter, two state machines (workspace +
run lifecycle), and V2 stats — strictly additive on top of the legacy
`workspaces` / `create` / `plan` / `runs` subcommands.

```bash
# Frozen enums
chainlesschain terraform run-statuses           # 9 states
chainlesschain terraform run-types              # 3 types
chainlesschain terraform workspace-statuses     # 3 states

# Concurrency controls
chainlesschain terraform default-max-concurrent # 5
chainlesschain terraform max-concurrent         # current value
chainlesschain terraform active-run-count       # runtime count
chainlesschain terraform set-max-concurrent 10

# Workspace V2 (unique-name + state machine)
chainlesschain terraform create-workspace-v2 prod --providers "aws,gcp"
chainlesschain terraform set-workspace-status <ws-id> locked
chainlesschain terraform archive-workspace <ws-id>

# Run V2 (concurrency-limited + state machine + patch)
chainlesschain terraform plan-run-v2 <ws-id> --run-type apply --triggered-by alice
chainlesschain terraform set-run-status <run-id> planning
chainlesschain terraform set-run-status <run-id> planned --plan-output "+ 3 to add"
chainlesschain terraform set-run-status <run-id> applying
chainlesschain terraform set-run-status <run-id> applied --resources-added 3
chainlesschain terraform cancel-run <run-id>
chainlesschain terraform fail-run <run-id> "provider timeout"

# Stats
chainlesschain terraform stats-v2
```

**Enums**:

```js
RUN_STATUS_V2 = {
  PENDING, PLANNING, PLANNED, APPLYING, APPLIED,
  DESTROYING, DESTROYED, ERRORED, CANCELLED,
}
RUN_TYPE_V2         = { PLAN, APPLY, DESTROY }
WORKSPACE_STATUS_V2 = { ACTIVE, LOCKED, ARCHIVED }
```

**Run state machine**:

```
pending   → { planning, cancelled, errored }
planning  → { planned, errored, cancelled }
planned   → { applying, destroying, cancelled, errored }
applying  → { applied, errored }
destroying → { destroyed, errored }
Terminal: applied, destroyed, errored, cancelled
```

**Workspace state machine**:

```
active   → { locked, archived }
locked   → { active, archived }
archived → { active }   // unarchive only
```

**Concurrency limit**: `TERRAFORM_DEFAULT_MAX_CONCURRENT=5`; runs in
`pending`/`planning`/`applying`/`destroying` count as active. `planRunV2`
rejects with `Max concurrent runs reached: N/LIMIT` when the limit is hit,
and with `Cannot plan run on archived workspace` when the workspace is
archived. Slots free up on any terminal transition.

**State-version bump**: `setRunStatus` bumps the parent `workspace.stateVersion`
and records `lastRunId` / `lastRunAt` only on transitions to `applied` or
`destroyed` — not on `errored` or `cancelled`.

**Patch merging**: `setRunStatus(db, runId, newStatus, patch)` merges
`planOutput` / `applyOutput` / `resourcesAdded` / `resourcesChanged` /
`resourcesDestroyed` / `errorMessage`. Terminal states automatically set
`completedAt = ISO-string`.

**stats-v2 shape**:

```jsonc
{
  "totalWorkspaces": 3,
  "totalRuns": 2,
  "activeRuns": 1,
  "maxConcurrentRuns": 5,
  "workspacesByStatus": { "active": 2, "locked": 0, "archived": 1 },
  "runsByStatus":       { "pending": 1, "planning": 0, ..., "applied": 1, ... },
  "runsByType":         { "plan": 0, "apply": 1, "destroy": 1 },
  "totalResources":     { "added": 4, "changed": 2, "destroyed": 0 }
}
```

**Scope / 未移植**: Real `terraform plan|apply|destroy` subprocess execution,
remote-state backends (S3/Consul/Terraform Cloud), plan-file artifact
storage, policy-as-code enforcement (Sentinel/OPA), drift detection,
VCS-triggered runs, and approval workflows all remain Desktop-only. The
CLI port covers workspace uniqueness, run+workspace lifecycle state
machines, concurrency admission, and aggregate stats — sufficient for CI
regression against Phase 56 design invariants.

### Phase 59 — Stress Test V2 (`stress` extension)

Extends `chainlesschain stress` with an async lifecycle variant (start →
complete/stop/fail instead of the legacy synchronous `run`), a run state
machine, a concurrency limiter, bottleneck kind/severity taxonomy, a
level recommender, and V2 stats — strictly additive on top of the legacy
`run` / `list` / `show` / `analyze` / `plan` / `stop` / `levels` subcommands.

```bash
# Frozen enums
chainlesschain stress run-statuses            # running|complete|stopped|failed
chainlesschain stress level-names             # light|medium|heavy|extreme
chainlesschain stress bottleneck-kinds        # error-rate|tail-latency|response-time|throughput
chainlesschain stress bottleneck-severities   # low|medium|high

# Concurrency controls
chainlesschain stress default-max-concurrent  # 3
chainlesschain stress max-concurrent          # current value
chainlesschain stress active-test-count       # runtime count
chainlesschain stress set-max-concurrent 5

# Async lifecycle
chainlesschain stress start-v2 -l light
chainlesschain stress complete <test-id>
chainlesschain stress stop-v2 <test-id>
chainlesschain stress fail <test-id> "upstream 503"
chainlesschain stress set-status <test-id> stopped

# Planning helpers
chainlesschain stress recommend-level 500     # → heavy
chainlesschain stress stats-v2
```

**Enums**:

```js
RUN_STATUS_V2         = { RUNNING, COMPLETE, STOPPED, FAILED }
LEVEL_NAME_V2         = { LIGHT, MEDIUM, HEAVY, EXTREME }
BOTTLENECK_KIND_V2    = { ERROR_RATE, TAIL_LATENCY, RESPONSE_TIME, THROUGHPUT }
BOTTLENECK_SEVERITY_V2 = { LOW, MEDIUM, HIGH }
```

**Run state machine**:

```
running → { complete, stopped, failed }
Terminal: complete, stopped, failed
```

`startStressTestV2(db, config)` creates a row in `RUNNING` without
computing metrics; the caller drives the transition via
`completeStressTest` / `stopStressTestV2` / `failStressTest`, or the
generic `setRunStatus(db, testId, status, patch)`. The legacy synchronous
`startStressTest` + `stopStressTest` surface is unchanged.

**Concurrency limit**: `STRESS_DEFAULT_MAX_CONCURRENT=3`; only runs in
`RUNNING` count as active. `startStressTestV2` rejects with
`Max concurrent stress tests reached: N/LIMIT` when the limit is hit.
Slots free up on any terminal transition. `setMaxConcurrentTests(n)`
floors non-integer input (e.g. `3.7 → 3`) and rejects ≤0 / NaN /
non-number.

**Level recommender**: `recommendLevelV2(targetRps)` returns the largest
built-in level whose `requestsPerSecond` is still ≤ target:

```
targetRps=5    → light
targetRps=200  → medium
targetRps=500  → heavy
targetRps=5000 → extreme
```

**stats-v2 shape**:

```jsonc
{
  "totalTests": 2,
  "activeTests": 1,
  "maxConcurrentTests": 3,
  "byStatus": { "running": 1, "complete": 1, "stopped": 0, "failed": 0 },
  "byLevel":  { "light": 1, "medium": 1, "heavy": 0, "extreme": 0 },
  "bottlenecks": {
    "total": 2,
    "byKind":     { "error-rate": 0, "tail-latency": 1, "response-time": 1, "throughput": 0 },
    "bySeverity": { "low": 0, "medium": 1, "high": 1 }
  },
  "aggregateMetrics": { "samples": 1, "avgTps": 312.5, "avgP95": 84.3 }
}
```

**Scope / 未移植**: Real multi-process load generators, tail-latency
histograms, distributed federation stressor agents, live traffic shaping,
and remote capacity planner integration all remain Desktop-only. The CLI
port covers lifecycle state-machine invariants, concurrency admission,
bottleneck taxonomy bookkeeping, level recommendation, and aggregate
stats — sufficient for CI regression against Phase 59 design invariants.

### Phase 61 — SLA V2 (`sla` extension)

Extends `chainlesschain sla` with 5 frozen enums, a per-org active-contract
admission cap, contract + violation state machines, bulk auto-expiration,
and V2 stats — strictly additive on top of the legacy
`tiers` / `create` / `list` / `show` / `terminate` / `record` / `metrics` /
`check` / `violations` / `compensate` / `report` subcommands.

```bash
# Frozen enums
chainlesschain sla statuses             # active|expired|terminated
chainlesschain sla tier-names           # gold|silver|bronze
chainlesschain sla term-names           # availability|response_time|throughput|error_rate
chainlesschain sla severities           # minor|moderate|major|critical
chainlesschain sla violation-statuses   # open|acknowledged|resolved|waived

# Per-org admission cap
chainlesschain sla default-max-active   # 1
chainlesschain sla max-active           # current value
chainlesschain sla active-count <org-id>
chainlesschain sla set-max-active 3

# Contract lifecycle
chainlesschain sla create-v2 acme -t gold -d 2592000000
chainlesschain sla set-status <sla-id> expired
chainlesschain sla expire <sla-id>
chainlesschain sla auto-expire          # bulk flip past endDate

# Violation lifecycle
chainlesschain sla set-violation-status <v-id> acknowledged --note "investigating"
chainlesschain sla acknowledge-violation <v-id>
chainlesschain sla resolve-violation <v-id> --note "patched"
chainlesschain sla waive-violation <v-id> --note "scheduled"

chainlesschain sla stats-v2
```

**Enums**:

```js
SLA_STATUS_V2         = { ACTIVE, EXPIRED, TERMINATED }
SLA_TIER_V2           = { GOLD, SILVER, BRONZE }
SLA_TERM_V2           = { AVAILABILITY, RESPONSE_TIME, THROUGHPUT, ERROR_RATE }
VIOLATION_SEVERITY_V2 = { MINOR, MODERATE, MAJOR, CRITICAL }
VIOLATION_STATUS_V2   = { OPEN, ACKNOWLEDGED, RESOLVED, WAIVED }
```

**Contract state machine** (both terminals — no `expired ↔ terminated`):

```
active → { expired, terminated }
Terminal: expired, terminated
```

**Violation state machine**:

```
open         → { acknowledged, resolved, waived }
acknowledged → { resolved, waived }
Terminal: resolved, waived
```

**Per-org admission cap**: `SLA_DEFAULT_MAX_ACTIVE_PER_ORG=1`. `createSLAV2`
rejects with `Max active SLAs per org reached: N/LIMIT` when an org is
already at its cap. Slots free up only when an existing contract
transitions to a terminal state (`expired` via `auto-expire` / `expire` /
`set-status`, or `terminated` via `set-status`). `setMaxActiveSlasPerOrg`
floors non-integer input and rejects ≤0 / NaN / non-number.

**Violation patch merging**: `setViolationStatus(db, id, status, patch)`
merges `note`. Terminal transitions (`resolved` / `waived`) automatically
set `resolvedAt = Date.now()` on both the in-memory record and the DB row.

**stats-v2 shape**:

```jsonc
{
  "totalContracts": 2,
  "activeContracts": 1,
  "activeOrgs": 1,
  "maxActiveSlasPerOrg": 1,
  "byStatus": { "active": 1, "expired": 1, "terminated": 0 },
  "byTier":   { "gold": 1, "silver": 1, "bronze": 0 },
  "violations": {
    "total": 3,
    "byTerm":     { "availability": 2, "response_time": 1, "throughput": 0, "error_rate": 0 },
    "bySeverity": { "minor": 0, "moderate": 2, "major": 1, "critical": 0 },
    "byStatus":   { "open": 1, "acknowledged": 1, "resolved": 1, "waived": 0 },
    "totalCompensation": 42.3
  }
}
```

**Scope / 未移植**: Live federation telemetry collection, scheduled
auto-expire cron, multi-region SLA dashboards, and on-chain compensation
settlement remain Desktop-only. The CLI port covers the admission cap,
both state machines, deviation-severity classification, compensation
computation, and aggregate stats — sufficient for CI regression against
Phase 61 design invariants.

### Phase 60 — Reputation Optimizer V2 (`reputation` extension)

Extends `chainlesschain reputation` with the Phase 60 canonical surface:
five-state run lifecycle, concurrency limiter, frozen enums, patch-merged
`setRunStatus`, and stats-v2. Strictly additive on top of the legacy
`observe` / `score` / `optimize` / `analytics` / `apply` commands.

**Frozen enums**

```bash
cc reputation run-statuses          # running | complete | applied | failed | cancelled
cc reputation v2-objectives         # accuracy | fairness | resilience | convergence_speed
cc reputation decay-models          # exponential | linear | step | none
cc reputation anomaly-methods       # iqr | z_score
```

**Concurrency cap** (`REPUTATION_DEFAULT_MAX_CONCURRENT = 2`)

```bash
cc reputation default-max-concurrent
cc reputation max-concurrent
cc reputation active-optimization-count
cc reputation set-max-concurrent <n>
```

- `setMaxConcurrentOptimizations(n)` floors non-integers (`3.7 → 3`) and
  rejects `n < 1`, `NaN`, or non-number input.
- `getActiveOptimizationCount()` counts only `RUNNING` rows in the V2 run
  map.
- `_resetState()` restores the default cap.

**Run state machine**

```
running  → { complete, failed, cancelled }
complete → { applied }
Terminal (no outgoing): applied, failed, cancelled
```

Enforced by `setRunStatus(db, runId, newStatus, patch = {})`. The patch
may carry `errorMessage` (stored in-memory on the run), and terminal
transitions auto-set `completedAt` if missing.

**Async lifecycle split**

- `start-v2` — creates a `RUNNING` row without computing iterations. Enforces
  the concurrency cap (`activeCount < max` or throws).
- `complete` — runs the iteration loop, computes `bestParams` / `bestScore`,
  writes analytics, and transitions `RUNNING → COMPLETE`.
- `cancel` / `fail` / `apply-v2` — shortcuts over `setRunStatus`.

```bash
cc reputation start-v2 [-o <objective>] [-i <iters>] [--json]
cc reputation complete <run-id> [--json]
cc reputation cancel <run-id>
cc reputation fail <run-id> [--message <msg>]
cc reputation apply-v2 <run-id>
cc reputation set-status <run-id> <status> [--message <msg>] [--json]
```

**Stats-v2**

```bash
cc reputation stats-v2 [--json]
# { totalRuns, activeRuns, maxConcurrentOptimizations,
#   byStatus: { running, complete, applied, failed, cancelled },
#   byObjective: { accuracy, fairness, resilience, convergence_speed },
#   observations: { totalDids, totalObservations },
#   bestScoreEver }
```

**未移植 (Desktop-Only)**

- Live Gaussian-process surrogate with acquisition-function guided sampling
- Real-time telemetry-driven continuous optimization loop
- Reputation-weighted on-chain reward settlement
- Multi-tenant parameter governance with RBAC gates
- Cross-cluster federated optimization (HP sweep across shards)
- Dashboard + heatmap visualization of distribution/anomalies
- Automatic rollout of applied params to live reputation scoring

CLI port covers the concurrency cap, 5-state run lifecycle, objective
enumeration, decay-model/anomaly-method enumeration, synchronous
iteration sampling + analytics, and aggregate stats — sufficient for CI
regression against Phase 60 design invariants.

### Phase 65 — Skill Marketplace V2 (`marketplace` extension)

Extends `chainlesschain marketplace` with the Phase 65 canonical surface:

```bash
cc marketplace service-statuses-v2 [--json]
cc marketplace invocation-statuses-v2 [--json]
cc marketplace pricing-models [--json]
cc marketplace default-max-concurrent
cc marketplace max-concurrent
cc marketplace active-invocation-count [service-id]
cc marketplace set-max-concurrent <n>
cc marketplace begin-v2 <service-id> [--caller <did>] [--input <json>] [--json]
cc marketplace start-invocation <id>
cc marketplace complete-invocation <id> [--output <json>] [--duration <ms>] [--json]
cc marketplace fail-invocation <id> [--message <msg>] [--duration <ms>]
cc marketplace timeout-invocation <id> [--message <msg>] [--duration <ms>]
cc marketplace set-invocation-status <id> <status> [--output <json>] [--error <msg>] [--duration <ms>] [--json]
cc marketplace stats-v2 [--json]
```

**Frozen enums**:

```js
SERVICE_STATUS_V2    = { DRAFT, PUBLISHED, DEPRECATED, SUSPENDED }
INVOCATION_STATUS_V2 = { PENDING, RUNNING, SUCCESS, FAILED, TIMEOUT }
PRICING_MODEL_V2     = { FREE, PAY_PER_CALL, SUBSCRIPTION, TIERED }
MARKETPLACE_DEFAULT_MAX_CONCURRENT_INVOCATIONS = 10
```

**Per-service concurrency cap** — `getActiveInvocationCount(serviceId)` filters
by service; unrelated services don't starve each other. `beginInvocationV2`
rejects when `activeCount >= max` with `Max concurrent invocations reached for
service`. `setMaxConcurrentInvocations(n)` floors non-integer (`3.7 → 3`),
rejects `≤ 0`, `NaN`, and non-number.

**Invocation state machine**:

```
pending  → { running, failed, timeout }
running  → { success, failed, timeout }
Terminal: success, failed, timeout
```

Enforced by `setInvocationStatus(db, id, newStatus, patch = {})`. Patch may
carry `output`, `error`, `durationMs`, `startedAt` (stored in-memory on the
invocation record). Terminal transitions auto-set `completedAt` if missing
and bump `service.invocationCount` exactly once.

**Async lifecycle split** (distinct from the legacy synchronous
`invokeService`):

- `beginInvocationV2(db, config)` — creates PENDING row, enforces per-service
  cap, returns `{ invocationId, status: pending, serviceId, caller, input, ... }`.
- `startInvocation(db, id)` — PENDING → RUNNING, stamps `startedAt`.
- `completeInvocationV2(db, id, { output, durationMs })` — RUNNING → SUCCESS.
- `failInvocationV2(db, id, errorMessage, { durationMs })` — → FAILED.
- `timeoutInvocationV2(db, id, { durationMs })` — → TIMEOUT (defaults
  `error="timeout"`).

**getMarketplaceStatsV2()** returns:

```js
{
  totalServices, totalInvocations, activeInvocations,
  maxConcurrentInvocations,
  servicesByStatus:    { draft, published, deprecated, suspended },
  invocationsByStatus: { pending, running, success, failed, timeout },
  servicesByPricing:   { free, pay_per_call, subscription, tiered },
  avgDurationMs,
  successRate,        // terminal successes / terminal count
}
```

**未移植 (Desktop-Only)**:

- Real P2P/libp2p service invocation transport
- Matrix/ActivityPub cross-instance routing
- Streaming output channels
- Context Engineering skill/prompt injection per invocation
- On-chain marketplace settlement + payout split
- Service catalog federation across instances
- Reputation-weighted discovery ranking

CLI port covers the per-service concurrency cap, 5-state invocation
lifecycle, service status enumeration, async lifecycle split
(begin → start → complete/fail/timeout), patch-merged transitions,
pricing-model aggregation, and marketplace-wide stats — sufficient for
CI regression against Phase 65 design invariants.

### Phase 89 — Cross-Chain Interoperability V2 (`crosschain` extension)

Extends `chainlesschain crosschain` with the Phase 89 canonical surface:

```bash
cc crosschain bridge-statuses-v2 [--json]
cc crosschain swap-statuses-v2 [--json]
cc crosschain message-statuses-v2 [--json]
cc crosschain chain-ids-v2 [--json]
cc crosschain default-max-active-bridges
cc crosschain max-active-bridges
cc crosschain active-bridge-count [address]
cc crosschain set-max-active-bridges <n>
cc crosschain configure-chain <chain-id> [--rpc-url <url>] [--contract <addr>] [--disabled] [--json]
cc crosschain chain-config <chain-id> [--json]
cc crosschain list-chains-v2 [--json]
cc crosschain bridge-v2 <from> <to> <amount> [--asset <s>] [--sender <addr>] [--recipient <addr>] [--json]
cc crosschain set-bridge-status <id> <status> [--lock-tx <h>] [--mint-tx <h>] [--message <m>] [--json]
cc crosschain set-swap-status <id> <status> [--claim-tx <h>] [--refund-tx <h>] [--json]
cc crosschain set-message-status <id> <status> [--source-tx <h>] [--dest-tx <h>] [--json]
cc crosschain auto-expire-swaps [--json]
cc crosschain stats-v2 [--json]
```

**Frozen enums**:

```js
BRIDGE_STATUS_V2  = { PENDING, LOCKED, MINTED, COMPLETED, REFUNDED, FAILED }
SWAP_STATUS_V2    = { INITIATED, HASH_LOCKED, CLAIMED, REFUNDED, EXPIRED }
MESSAGE_STATUS_V2 = { PENDING, SENT, DELIVERED, FAILED }
CHAIN_ID_V2       = { ETHEREUM, POLYGON, BSC, ARBITRUM, SOLANA }
CROSSCHAIN_DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS = 3
```

**Per-address bridge concurrency cap** — `getActiveBridgeCount(address?)`
counts non-terminal bridges (terminals: `completed`, `refunded`, `failed`);
when `address` omitted, counts globally. `bridgeAssetV2` throws `Max active
bridges per address reached (n/max)` when `activeCount >= max` for the
given `senderAddress`. Cap is per-sender so unrelated wallets don't
interact. `setMaxActiveBridgesPerAddress(n)` floors non-integer (`5.7 → 5`),
rejects `≤ 0`, `NaN`, and non-number.

**Bridge state machine**:

```
pending → { locked, failed }
locked  → { minted, refunded, failed }
minted  → { completed, failed }
Terminal: completed, refunded, failed
```

**Swap state machine**:

```
initiated   → { hash_locked, claimed, refunded, expired }
hash_locked → { claimed, refunded, expired }
Terminal: claimed, refunded, expired
```

**Message state machine**:

```
pending → { sent, failed }
sent    → { delivered, failed }
failed  → { pending }              // retry bumps retries counter
Terminal: delivered
```

**Patch-merged setters** — `setBridgeStatusV2` / `setSwapStatusV2` /
`setMessageStatusV2` all validate transition, reject unknown status, reject
unknown id, and merge patch fields (bridge: `lockTxHash`/`mintTxHash`/
`errorMessage`; swap: `claimTxHash`/`refundTxHash`; message: `sourceTxHash`/
`destinationTxHash`). Terminal bridge transitions auto-set `completed_at`;
message `delivered` transitions auto-set `delivered_at`; message `pending`
re-entry increments `retries`.

**Chain config CRUD** (missing from legacy CLI):

- `configureChainV2({ chainId, rpcUrl, contractAddress, enabled })` —
  persists in-memory config for one of the 5 supported chains; rejects
  unsupported chainId.
- `getChainConfigV2(chainId)` — returns `{ chainId, rpcUrl, contractAddress,
  enabled, updatedAt }` or `null`.
- `listChainsV2()` — enriches `SUPPORTED_CHAINS` with `enabled`, `rpcUrl`,
  `contractAddress` from config; chains without config default to
  `enabled=false`.

**Auto-expire** — `autoExpireSwapsV2(db)` bulk-flips all swaps with
`status ∈ { initiated, hash_locked }` and `expires_at < now` to `expired`.
Skips already-terminal swaps. Returns expired swap records (secret stripped).

**getCrossChainStatsV2()** returns all-enum-key zero init:

```js
{
  totalBridges, totalSwaps, totalMessages,
  activeBridges, maxActiveBridgesPerAddress,
  bridgesByStatus:  { pending, locked, minted, completed, refunded, failed },
  swapsByStatus:    { initiated, hash_locked, claimed, refunded, expired },
  messagesByStatus: { pending, sent, delivered, failed },
  chainUsage:       { ethereum, polygon, bsc, arbitrum, solana },
  totalBridgeVolume, totalFees, configuredChains,
}
```

**未移植 (Desktop-Only)**:

- Real RPC chain adapters (Ethereum/Polygon/BSC/Arbitrum/Solana)
- Actual on-chain transactions (lock / mint / claim / refund)
- WebSocket event subscriptions for bridge/swap completion
- HTLC secret reveal via on-chain transaction monitoring
- Balance query via RPC (`getBalances({ address, chains })`)
- CrossChainBridgePage.vue + Pinia store UI
- Cross-chain message payload encryption
- Multi-hop routing + path optimization
- On-chain fee oracle (replaces heuristic `estimateFee`)

CLI port covers the frozen enum surface, per-address bridge concurrency
cap, chain config CRUD, patch-merged state-machine setters for all three
resources (bridge / swap / message), auto-expire of stale swaps, and
all-enum-key stats — sufficient for CI regression against Phase 89
design invariants.

### Phase 67 — Decentralized Inference Network V2 (`inference` extension)

Extends `chainlesschain inference` with the Phase 67 canonical surface:
per-node concurrent task cap, async 4-stage task lifecycle (queued →
dispatched → running → complete), heartbeat-timeout auto-offline, and
capability-filtered eligibility.

```bash
# V2 catalogs
cc inference node-statuses-v2 | task-statuses-v2 | privacy-modes-v2

# Per-node concurrency cap (default: 4)
cc inference default-max-concurrent-tasks
cc inference max-concurrent-tasks
cc inference active-task-count <node-id>
cc inference set-max-concurrent-tasks <n>

# Heartbeat timeout (default: 90000ms)
cc inference heartbeat-timeout
cc inference set-heartbeat-timeout <ms>

# V2 async task lifecycle
cc inference submit-v2 <model> [-i <input>] [-p <priority>] [-m <mode>]
cc inference dispatch-v2 <task-id> [-n <node-id>]
cc inference start-task <task-id>
cc inference complete-v2 <task-id> [-o <output>] [-d <ms>]
cc inference fail-v2 <task-id> [-e <error>]
cc inference set-task-status <task-id> <status> [-o|-d|-e]

# Node health & discovery
cc inference auto-offline
cc inference eligible-nodes [-c <capability>] [-m <mode>]

# V2 stats
cc inference stats-v2
```

Frozen enums:

```js
NODE_STATUS_V2    = { ONLINE, OFFLINE, BUSY, DEGRADED }
TASK_STATUS_V2    = { QUEUED, DISPATCHED, RUNNING, COMPLETE, FAILED }
PRIVACY_MODE_V2   = { STANDARD, ENCRYPTED, FEDERATED }
INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE = 4
INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS          = 90000
```

Task state machine:

```
queued     → { dispatched, failed }
dispatched → { running, failed }
running    → { complete, failed }
Terminal: complete, failed
```

Per-node concurrency cap is enforced by `dispatchTaskV2` — if
`getActiveTasksPerNode(nodeId) >= max`, the call throws
`Max concurrent tasks reached for node {id}`. `findEligibleNodes` filters
out both non-online and over-cap nodes, returning the list sorted by
current load (least first). `autoMarkOfflineNodes` bulk-flips nodes
whose `last_heartbeat < now - heartbeatTimeoutMs` to `OFFLINE`.

Not ported (Desktop-only): real libp2p node discovery, GPU probe,
encrypted/federated inference RPC, streaming token output, on-chain
settlement, priority scheduling, WebSocket task-dispatch push.
Strictly additive — legacy `registerNode`, `heartbeat`, `updateNodeStatus`,
`submitTask`, `completeTask`, `failTask`, `getTask`, `listTasks`,
`getSchedulerStats`, `ensureInferenceTables`, `_resetState` all preserved.

### Phase 91 — Privacy Computing V2 (`privacy` extension)

Extends `chainlesschain privacy` with the Phase 91 canonical surface:

```bash
cc privacy fl-statuses-v2 | mpc-statuses-v2 | dp-mechanisms-v2 | he-schemes-v2 | mpc-protocols-v2
cc privacy default-max-active-mpc | max-active-mpc | active-mpc-count | set-max-active-mpc <n>
cc privacy budget-limit | budget-spent | set-budget-limit <n> | reset-budget
cc privacy create-model-v2 <name> [-t <rounds>] [-l <lr>] [-a <arch>] [-m <type>]
cc privacy train-round-v2 <model-id> | aggregate-round <model-id>
cc privacy fail-model-v2 <model-id> [-e <err>] | set-fl-status <model-id> <status> [-a|-l|-e]
cc privacy create-computation-v2 <type> [-p <proto>] [-i <csv>] [-s <shares>]
cc privacy submit-share-v2 <comp-id> | fail-computation <comp-id> [-e <err>]
cc privacy set-mpc-status <comp-id> <status> [-h <hash>] [-e <err>]
cc privacy dp-publish-v2 -d <n> [-e <eps>] [--delta <n>] [-m <mech>] [-s <sens>]
cc privacy he-query-v2 -o <op> -d <json> [-s <scheme>]
cc privacy stats-v2
```

The V2 surface adds five frozen enums — `FL_STATUS_V2` (mirror of `FL_STATUS`:
initializing/training/aggregating/completed/failed), `MPC_STATUS_V2`
(pending/computing/completed/failed), `DP_MECHANISM_V2`
(laplace/gaussian/exponential), `HE_SCHEME_V2` (paillier/bfv/ckks),
`MPC_PROTOCOL_V2` (shamir/beaver/gmw) — and a per-system active-MPC cap
(`PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS = 20`) that counts only
pending + computing computations.

Two state machines:

```
FL:  initializing → { training, failed }
     training     → { aggregating, failed }
     aggregating  → { training, completed, failed }
     Terminal: completed, failed

MPC: pending    → { computing, failed }
     computing  → { completed, failed }
     Terminal: completed, failed
```

`createComputationV2` throws `Max active MPC computations reached
({active}/{max})` when the cap is hit; the cap is released when
computations transition to a terminal state. `submitShareV2` auto-stamps
`completed_at` + `computation_time_ms` + a deterministic `result_hash`
when `shares_received >= shares_required`. `setMPCStatusV2` is the
state-machine-guarded generic setter with patch keys `errorMessage` and
`resultHash` (auto-stamps `completed_at` + `computation_time_ms` on
terminal). `setFLStatusV2` applies patch keys `errorMessage` /
`accuracy` / `loss`.

`dpPublishV2` throws on invalid mechanism / non-positive epsilon /
exceeded budget (`{spent+eps} > {limit}`); privacy-budget mutators
`setPrivacyBudgetLimit` / `resetPrivacyBudget` are exposed for testing.
`heQueryV2` throws on invalid scheme / invalid operation (sum / product
/ mean / count) / empty data. `getPrivacyStatsV2` returns all-enum-key
zero-initialized `flByStatus` / `mpcByStatus` / `mpcByProtocol` plus
`activeMpcCount` / `maxActiveMpcComputations` / `budget` /
`avgAccuracy` / `avgComputationTimeMs` — stable shape for CI regression.

Not ported (Desktop-only): real Shamir polynomial reconstruction,
Paillier key generation and ciphertext arithmetic, true Laplace/Gaussian
noise calibration against global sensitivity, federated gradient
aggregation (FedAvg on actual model weights), secure multi-party
network transport, PrivacyComputingPage.vue + Pinia store, privacy-
budget alerting. Strictly additive — legacy `createModel`, `trainRound`,
`failModel`, `getModel`, `listModels`, `createComputation`,
`submitShare`, `getComputation`, `listComputations`, `dpPublish`,
`heQuery`, `getPrivacyReport`, `ensurePrivacyTables`, `_resetState` all
preserved.

### Phase 88 — ZKP Engine V2 (`zkp` extension)

Extends `chainlesschain zkp` with the Phase 88 canonical surface:

```bash
cc zkp proof-schemes-v2 | circuit-statuses-v2 | proof-statuses-v2
cc zkp default-max-circuits-per-creator | max-circuits-per-creator
cc zkp set-max-circuits-per-creator <n>
cc zkp circuit-count-by-creator <creator>
cc zkp default-proof-expiry-ms | proof-expiry-ms | set-proof-expiry-ms <ms>
cc zkp compile-v2 <name> [-d|-c]
cc zkp set-circuit-status-v2 <circuit-id> <status> [-e]
cc zkp prove-v2 <circuit-id> [--private|--public|-s]
cc zkp verify-v2 <proof-id>
cc zkp fail-proof <proof-id> [-r]
cc zkp set-proof-status <proof-id> <status> [-e]
cc zkp auto-expire-proofs
cc zkp selective-disclose-v2 <credential-id> [-d|-r|--recipient]
cc zkp stats-v2
```

Frozen V2 enums: `PROOF_SCHEME_V2` (alias — groth16/plonk/bulletproofs),
`CIRCUIT_STATUS_V2` (alias — draft/compiled/verified/failed), `PROOF_STATUS_V2`
(new — pending/verified/invalid/expired).

Per-creator circuit cap (default 10): `compileCircuitV2` rejects with
`Max circuits per creator reached ({count}/{max})` when creator exceeds the
cap. `setMaxCircuitsPerCreator` floors non-integer (3.7→3) and rejects ≤0 /
NaN / non-number.

Proof expiration (default 3_600_000 ms / 1 h): `setProofExpiryMs` accepts
positive ms; `generateProofV2` stamps `expiresAt = Date.now() + expiry`;
`verifyProofV2` auto-flips past-deadline proofs to `EXPIRED` (returns
`{valid:false, reason:"expired"}`); `autoExpireProofs` bulk-expires past-
deadline non-terminal proofs.

Circuit state machine: `draft → {compiled, failed} / compiled → {verified,
failed}`; terminals `verified`, `failed`. `setCircuitStatusV2` is state-
machine guarded with patch-merged `errorMessage`.

Proof state machine: `pending → {verified, invalid, expired}`; terminals
`verified`, `invalid`, `expired`. `setProofStatus` is state-machine
guarded with patch-merged `errorMessage` + auto-writes `zkp_proofs.verified`
column (1 for VERIFIED, 0 otherwise). `failProof` shortcut: any non-terminal
→ INVALID. `verifyProofV2` rejects terminal proofs.

`generateProofV2` requires circuit status ∈ {COMPILED, VERIFIED} — rejects
DRAFT/FAILED circuits with `Circuit not ready (status=..., must be
compiled/verified)`.

`selectiveDiscloseV2` is a throwing wrapper over `selectiveDisclose` —
rejects missing `credentialId`, non-array `disclosedFields`, and enforces
`requiredFields` must all be members of `disclosedFields` AND present in the
credential (`Required field missing from disclosure` /
`Required field not in credential`).

`getZKPStatsV2` returns all-enum-key zero-initialized `circuitsByStatus` /
`proofsByStatus` / `proofsByScheme` + `credentialsByDid` (anonymous as
`_anonymous`) + `totalCircuits` / `totalProofs` / `totalCredentials` /
`verifiedProofs` / `pendingProofs` / `maxCircuitsPerCreator` /
`proofExpiryMs` — stable shape for CI regression.

Not ported (Desktop-only): real Groth16/PLONK proving key ceremony,
circuit compilation via Circom/arkworks, BN254/BLS12-381 elliptic-curve
pairings, Merkle proof construction for selective disclosure receiver,
ZK-SNARK recursive composition, on-chain verifier contract deployment,
ZKPPage.vue + Pinia store. Strictly additive — legacy `compileCircuit`,
`generateProof`, `verifyProof`, `createIdentityProof`, `registerCredential`,
`selectiveDisclose`, `listCircuits`, `listProofs`, `listCredentials`,
`getZKPStats`, `setCircuitStatus`, `ensureZKPTables`, `_resetState` all
preserved.

### Phase 58 — Federation Hardening V2 (`federation` extension)

Extends `chainlesschain federation` with the Phase 58 canonical surface:

```bash
cc federation node-statuses-v2
cc federation default-failure-threshold | failure-threshold | set-failure-threshold <n>
cc federation default-half-open-cooldown-ms | half-open-cooldown-ms | set-half-open-cooldown-ms <ms>
cc federation default-unhealthy-threshold | unhealthy-threshold | set-unhealthy-threshold <n>
cc federation default-max-active-nodes | max-active-nodes | active-node-count | set-max-active-nodes <n>
cc federation register-v2 <node-id> [-m]
cc federation node-status-v2 <node-id>
cc federation set-node-status-v2 <node-id> <status> [-r|-m]
cc federation record-health-v2 <node-id> [-t|-s|-m]
cc federation trip-circuit <node-id>
cc federation auto-isolate-unhealthy
cc federation stats-v2
```

V2 aliases legacy circuit/health enums (`CIRCUIT_STATE_V2`, `HEALTH_STATUS_V2`,
`HEALTH_METRIC_V2`) and adds a new 4-state node lifecycle
`NODE_STATUS_V2` — `registered` / `active` / `isolated` / `decommissioned`.

Node state machine: `registered → {active, decommissioned}` /
`active → {isolated, decommissioned}` / `isolated → {active,
decommissioned}`. Terminal: `decommissioned`.

Four config mutators (all `positive integer`; floor non-integers; reject ≤0
/ NaN / non-number): `setFailureThreshold` (default 5), `setHalfOpenCooldownMs`
(default 60 000), `setUnhealthyThreshold` (default 3), `setMaxActiveNodes`
(default 50). `_resetState()` restores all four.

Per-federation active-node cap: `setNodeStatusV2` rejects transitions to
`ACTIVE` when `activeCount >= maxActiveNodes` with
`Max active nodes reached (N/M)`. Transitions away from `ACTIVE` always
release a cap slot.

`registerNodeV2` throws on missing `nodeId` and on duplicate (`Node already
registered`); tags the node `REGISTERED` and also creates a circuit breaker
seeded with the current `failureThreshold` / `halfOpenCooldownMs`.

`setNodeStatusV2` is state-machine guarded, rejects terminal mutation, and
accepts patch keys `metadata` + `reason`.

`recordHealthCheckV2` is a throwing wrapper over `recordHealthCheck` —
rejects missing `nodeId`, unknown `checkType`, unknown `status`, and NaN
values in `metrics`.

`tripCircuit` is a shortcut that flips a closed/half_open breaker to `open`
(rejects unknown node and already-open circuits).

`autoIsolateUnhealthyNodes` bulk-flips `ACTIVE → ISOLATED` when the last
`unhealthyThreshold` consecutive health checks are all `UNHEALTHY`. It
skips non-ACTIVE nodes, skips nodes with fewer than N checks, and skips
when any of the last N is not `UNHEALTHY`.

`getFederationHardeningStatsV2` returns all-enum-key zero-initialized
`circuitsByState` / `nodesByStatus` / `healthByStatus` / `healthByMetric` +
`totalNodes` / `activeNodes` / `isolatedNodes` / `totalCircuits` /
`totalHealthChecks` + `maxActiveNodes` / `failureThreshold` /
`halfOpenCooldownMs` / `unhealthyThreshold` — stable shape for CI
regression.

Not ported (Desktop-only): real WebRTC/libp2p connections, live heartbeat
monitoring, actual connection pooling, periodic health check cron,
scheduled auto-isolate, on-chain federation governance. Strictly additive
— legacy `registerNode`, `recordFailure`, `recordSuccess`, `tryHalfOpen`,
`resetCircuitBreaker`, `recordHealthCheck`, `initPool`, `acquireConnection`,
`getFederationHardeningStats`, `_resetState` all preserved.

### Phase 29 — Production Hardening V2 (`hardening` extension)

Extends `chainlesschain hardening` with the Phase 29 canonical surface:

```bash
cc hardening audit-statuses-v2 | baseline-statuses-v2 | severities-v2
cc hardening default-max-concurrent-audits | max-concurrent-audits | set-max-concurrent-audits <n>
cc hardening default-baseline-retention-ms | baseline-retention-ms | set-baseline-retention-ms <ms>
cc hardening default-audit-timeout-ms | audit-timeout-ms | set-audit-timeout-ms <ms>
cc hardening running-audit-count
cc hardening register-audit-v2 <audit-id> [-n|-s|-m]
cc hardening start-audit <audit-id>
cc hardening complete-audit <audit-id> [-s|-f|-w]
cc hardening set-audit-status-v2 <audit-id> <status> [-e|-m]
cc hardening audit-status-v2 <audit-id>
cc hardening auto-timeout-audits
cc hardening create-baseline-v2 <baseline-id> [-n|-s|-m]
cc hardening activate-baseline <baseline-id>
cc hardening set-baseline-status-v2 <baseline-id> <status> [-r|-m]
cc hardening baseline-status-v2 <baseline-id>
cc hardening auto-archive-stale-baselines
cc hardening stats-v2
```

V2 introduces three frozen enums: `AUDIT_STATUS_V2` (`pending` / `running` /
`passed` / `failed` / `warning`), `BASELINE_STATUS_V2` (`draft` / `active` /
`superseded` / `archived`), and `SEVERITY_V2` (`critical` / `high` /
`medium` / `low` / `info`).

Audit state machine: `pending → {running, failed}` / `running → {passed,
failed, warning}`. Terminals: `passed` / `failed` / `warning`.

Baseline state machine: `draft → {active, archived}` / `active →
{superseded, archived}` / `superseded → {archived}`. Terminal: `archived`.

Three config mutators (all `positive integer`; floor non-integers; reject
≤0 / NaN / non-number): `setMaxConcurrentAudits` (default 5),
`setBaselineRetentionMs` (default 90 days = 7 776 000 000 ms),
`setAuditTimeoutMs` (default 5 min = 300 000 ms). `_resetState()` restores
all three plus clears `_auditStatesV2` and `_baselineStatesV2`.

Per-system audit concurrency cap: `startAudit` and
`setAuditStatusV2(→RUNNING)` both reject when
`runningCount >= maxConcurrentAudits` with
`Max concurrent audits reached (N/M)`. Transitions away from `RUNNING`
release a slot.

`registerAuditV2` throws on missing `name` and rejects invalid `severity`;
tags the entry `PENDING` with default `severity = MEDIUM`.

`completeAudit` applies warning-threshold logic: all-clean (no
`CRITICAL` / `HIGH` findings, score ≥ 1) → `PASSED`; score ≥
`warningThreshold` (default 0.8) with some findings → `WARNING`;
otherwise → `FAILED`.

`activateBaseline` auto-supersedes any previously-`ACTIVE` baseline (only
one `ACTIVE` at a time).

`autoTimeoutAudits` bulk-flips `RUNNING → FAILED` when
`(now - started_at) > auditTimeoutMs`, setting
`reason = "timeout: exceeded {N}ms"`.

`autoArchiveStaleBaselines` bulk-flips `SUPERSEDED → ARCHIVED` when
`(now - created_at) > baselineRetentionMs`, setting
`reason = "auto-archived: retention exceeded"`.

`getHardeningStatsV2` returns all-enum-key zero-initialized
`auditsByStatus` / `baselinesByStatus` / `auditsBySeverity` +
`totalAudits` / `runningAudits` / `totalBaselines` / `activeBaselines` +
`maxConcurrentAudits` / `baselineRetentionMs` / `auditTimeoutMs` — stable
shape for CI regression.

Not ported (Desktop-only): real TLS handshake checks, real network port
scans, actual file permission inspection, integration with external
security scanners (OpenVAS, Nessus), scheduled cron for periodic audits,
real baseline diff against running system state, GUI for severity heatmap.
Strictly additive — legacy `ensureHardeningTables`, `collectBaseline`,
`compareBaseline`, `runAudit`, `runConfigAudit`, `deployCheck`,
`_resetState` all preserved.

### Phase 19 — Compliance Manager V2 (`compliance` extension)

Extends `chainlesschain compliance` with the Phase 19 canonical surface:

```bash
cc compliance evidence-statuses-v2 | policy-statuses-v2 | report-statuses-v2 | severities-v2 | frameworks-v2 | policy-types-v2
cc compliance default-max-active-policies | max-active-policies | set-max-active-policies <n>
cc compliance default-evidence-retention-ms | evidence-retention-ms | set-evidence-retention-ms <ms>
cc compliance default-report-retention-ms | report-retention-ms | set-report-retention-ms <ms>
cc compliance active-policy-count [-f <fw>]
cc compliance register-evidence-v2 <evidence-id> [-f|-t|-d|-s|-m]
cc compliance evidence-status-v2 <evidence-id>
cc compliance set-evidence-status-v2 <evidence-id> <status> [-r|-m]
cc compliance auto-expire-evidence
cc compliance register-policy-v2 <policy-id> [-n|-t|-f|-s|-r|-m]
cc compliance policy-status-v2 <policy-id>
cc compliance set-policy-status-v2 <policy-id> <status> [-r|-m]
cc compliance activate-policy <policy-id>
cc compliance register-report-v2 <report-id> [-f|-t|-m]
cc compliance report-status-v2 <report-id>
cc compliance set-report-status-v2 <report-id> <status> [-r|-s|-y|-m]
cc compliance publish-report <report-id> [-s|-y]
cc compliance auto-archive-stale-reports
cc compliance stats-v2
```

V2 introduces four frozen enums: `EVIDENCE_STATUS_V2`
(`collected`/`verified`/`rejected`/`expired`), `POLICY_STATUS_V2`
(`draft`/`active`/`suspended`/`deprecated`), `REPORT_STATUS_V2`
(`pending`/`generating`/`published`/`archived`), `SEVERITY_V2`
(`critical`/`high`/`medium`/`low`), plus canonical `FRAMEWORKS_V2` and
`POLICY_TYPES_V2`.

Evidence state machine: `collected → {verified, rejected, expired}` /
`verified → {expired}` / `rejected → {expired}`. Terminal: `expired`.

Policy state machine: `draft → {active, deprecated}` / `active →
{suspended, deprecated}` / `suspended → {active, deprecated}`.
Terminal: `deprecated`.

Report state machine: `pending → {generating, archived}` / `generating
→ {published, archived}` / `published → {archived}`. Terminal:
`archived`.

Three config mutators (all `positive integer`; floor non-integers;
reject ≤0 / NaN / non-number): `setMaxActivePolicies` (default 20),
`setEvidenceRetentionMs` (default 180 days = 15 552 000 000 ms),
`setReportRetentionMs` (default 365 days = 31 536 000 000 ms).
`_resetState()` restores all three plus clears `_evidenceStatesV2` /
`_policyStatesV2` / `_reportStatesV2`.

Per-framework active-policy cap: `setPolicyStatusV2(→ACTIVE)` rejects
when `activeCount >= maxActivePolicies` for the policy's framework.
`getActivePolicyCount(framework)` scopes to a framework when given;
otherwise counts globally.

`registerEvidenceV2` / `registerPolicyV2` / `registerReportV2` throw on
missing required fields, reject invalid enums, reject duplicates, and
tag entries with the initial state (`COLLECTED` / `DRAFT` / `PENDING`).

`publishReport` is a shortcut that transitions `PENDING → GENERATING →
PUBLISHED` in one call and stamps `publishedAt` + `score` + `summary`.

`autoExpireEvidence` bulk-flips non-terminal evidence to `EXPIRED`
when `(now - createdAt) > evidenceRetentionMs`, setting
`reason = "auto-expired: retention exceeded"`.

`autoArchiveStaleReports` bulk-flips `PUBLISHED → ARCHIVED` when
`(now - publishedAt) > reportRetentionMs`, setting
`reason = "auto-archived: retention exceeded"`.

`getComplianceStatsV2` returns all-enum-key zero-initialized
`evidenceByStatus` / `policyByStatus` / `reportByStatus` /
`policyBySeverity` plus `totalEvidence` / `totalPolicies` /
`activePolicies` / `totalReports` / `publishedReports` /
`maxActivePolicies` / `evidenceRetentionMs` / `reportRetentionMs` —
stable shape for CI regression.

Not ported (Desktop-only): real-time evidence collection from running
systems, integration with external scanners (Qualys, Tenable), OCR/PDF
evidence intake, scheduled cron for periodic auto-expire / archive,
encrypted evidence storage at rest, real-time policy violation alerting,
SIEM correlation. Strictly additive — legacy `ensureComplianceTables`,
`collectEvidence`, `generateReport`, `classifyData`, `scanCompliance`,
`listPolicies`, `addPolicy`, `checkAccess`, `_resetState` all preserved.

### Audit Logger V2 (Phase 11) — Hash-Chained Integrity

Layered on top of legacy `audit log/search/stats/export/purge`.

```bash
cc audit log-statuses-v2 | integrity-statuses-v2 | alert-statuses-v2 |
         event-types-v2 | risk-levels-v2
cc audit default-max-alerts-per-actor | max-alerts-per-actor |
         set-max-alerts-per-actor <n>
cc audit default-archive-retention-ms | archive-retention-ms |
         set-archive-retention-ms <ms>
cc audit default-purge-retention-ms | purge-retention-ms |
         set-purge-retention-ms <ms>
cc audit open-alert-count [-a]
cc audit log-event-v2 <log-id> [-t|-o|-a|-x|-d|-r|-i|-u]
cc audit log-status-v2 <log-id>
cc audit set-log-status-v2 <log-id> <status> [-r]
cc audit verify-chain-v2
cc audit auto-archive-logs | auto-purge-logs
cc audit alert-status-v2 <alert-id>
cc audit set-alert-status-v2 <alert-id> <status> [-r|-m]
cc audit acknowledge-alert <alert-id> [-r]
cc audit resolve-alert <alert-id> [-r]
cc audit dismiss-alert <alert-id> [-r]
cc audit stats-v2
```

Frozen enums: `LOG_STATUS_V2 = {active, archived, purged}`,
`INTEGRITY_STATUS_V2 = {unverified, verified, corrupted}`,
`ALERT_STATUS_V2 = {open, acknowledged, resolved, dismissed}`,
`EVENT_TYPES_V2 = [auth, permission, data, system, file, did, crypto, api]`,
`RISK_LEVELS_V2 = [low, medium, high, critical]`.

State machines:

```
Log:    active    → { archived, purged }
        archived  → { purged }
        Terminal: purged

Alert:  open         → { acknowledged, dismissed }
        acknowledged → { resolved, dismissed }
        Terminal:    resolved, dismissed
```

Defaults: `AUDIT_DEFAULT_MAX_ALERTS_PER_ACTOR = 10`,
`AUDIT_DEFAULT_ARCHIVE_RETENTION_MS = 30 days`,
`AUDIT_DEFAULT_PURGE_RETENTION_MS = 365 days`. Three `_positiveInt`
mutators floor non-integer input and reject ≤0 / NaN / non-number.
`_resetStateV2()` restores all three plus clears the two V2 maps and
the rolling `_lastChainHash`.

`logEventV2(db, { logId, eventType, operation, actor, target, details,
riskLevel, ipAddress, userAgent, success, errorMessage })` rejects
missing `logId` / `eventType` / `operation`, invalid event type / risk
level, and duplicate `logId`. Each entry computes a SHA-256 hash over
`{logId, eventType, operation, actor, riskLevel, createdAt, prev}` and
chains it to the rolling `_lastChainHash`. Critical events with an
`actor` auto-create an `OPEN` alert (id `alert-{logId}`) when the
per-actor `OPEN` count is under `maxAlertsPerActor` — cap enforcement
is silent (alert-creation is a side effect, not a throw).

`setLogStatusV2(db, logId, newStatus, patch)` is state-machine guarded
(terminal `purged`); patch key `reason`. `verifyChainV2()` walks the
chain in `createdAt` order, recomputes each hash, and marks each entry
`VERIFIED` or `CORRUPTED` — returns `[{logId, valid, integrityStatus}]`.
`autoArchiveLogs(db, now?)` bulk-flips `ACTIVE → ARCHIVED` past
`archiveRetentionMs`; `autoPurgeLogs(db, now?)` bulk-flips
`ARCHIVED → PURGED` past `purgeRetentionMs` (skips `ACTIVE`).

`setAlertStatusV2(db, alertId, newStatus, patch)` is state-machine
guarded (terminal `resolved` / `dismissed`); patch keys `reason` +
`metadata`. Shortcuts: `acknowledgeAlert` / `resolveAlert` /
`dismissAlert`.

`getAuditStatsV2()` returns all-enum-key zero-initialized snapshot:
`logsByStatus` / `logsByRisk` / `logsByIntegrity` / `logsByEventType` /
`alertsByStatus` plus `totalLogs` / `totalAlerts` / `activeAlerts` /
`maxAlertsPerActor` / `archiveRetentionMs` / `purgeRetentionMs` /
`lastChainHash` — stable shape for CI regression.

Not ported (Desktop-only): durable SQLite-backed V2 storage (in-memory
Maps only), SIEM streaming, real-time alert push notifications,
cryptographic log sealing (WORM), external notarization (blockchain
anchoring), signed export bundles, per-actor alert deduplication
policies. Strictly additive — legacy `ensureAuditTables`, `logEvent`,
`queryLogs`, `getStatistics`, `exportLogs`, `purgeLogs`,
`getRecentEvents`, `assessRisk`, `sanitizeDetails` all preserved.

### Token Incentive V2 (Phase 66) — Account + Claim Lifecycle

Layered on top of legacy `cc incentive contribute/reward/transfer/mint/history`.

```bash
cc incentive account-statuses-v2 | claim-statuses-v2
cc incentive default-max-pending-claims-per-user | max-pending-claims-per-user |
             set-max-pending-claims-per-user <n>
cc incentive default-claim-expiry-ms | claim-expiry-ms |
             set-claim-expiry-ms <ms>
cc incentive default-max-claim-amount | max-claim-amount |
             set-max-claim-amount <n>
cc incentive pending-claim-count [-u]
cc incentive register-account-v2 <account-id> [-m]
cc incentive account-status-v2 <account-id>
cc incentive set-account-status-v2 <account-id> <status> [-r|-m]
cc incentive freeze-account <account-id> [-r]
cc incentive unfreeze-account <account-id> [-r]
cc incentive close-account <account-id> [-r]
cc incentive submit-claim-v2 <claim-id> -u <user> -a <amount> [-c|-m]
cc incentive claim-status-v2 <claim-id>
cc incentive set-claim-status-v2 <claim-id> <status> [-r|-m]
cc incentive approve-claim <claim-id> [-r]
cc incentive reject-claim <claim-id> [-r]
cc incentive pay-claim <claim-id> [-r]
cc incentive auto-expire-unclaimed-claims
cc incentive stats-v2
```

Frozen enums: `ACCOUNT_STATUS_V2 = {active, frozen, closed}`,
`CLAIM_STATUS_V2 = {pending, approved, paid, rejected}`.

State machines:

```
Account: active → { frozen, closed }
         frozen → { active, closed }
         Terminal: closed

Claim:   pending  → { approved, rejected }
         approved → { paid, rejected }
         Terminal: paid, rejected
```

Defaults: `TOKEN_DEFAULT_MAX_PENDING_CLAIMS_PER_USER = 50`,
`TOKEN_DEFAULT_CLAIM_EXPIRY_MS = 7 days`,
`TOKEN_DEFAULT_MAX_CLAIM_AMOUNT = 10000`. `setMaxPendingClaimsPerUser`
and `setClaimExpiryMs` share `_positiveInt` (floor non-integer, reject
≤0 / NaN). `setMaxClaimAmount` accepts positive floats (not floored).
`_resetStateV2()` restores all three + clears two V2 maps.

`registerAccountV2(db, { accountId, metadata })` throws missing
`accountId` / duplicate; tags `ACTIVE`. Accounts registered here
participate in V2 lifecycle enforcement. Accounts not registered in V2
state are treated as always-active for `submitClaimV2` (opt-in V2).

`submitClaimV2(db, { claimId, userId, amount, contributionId,
metadata })` throws missing `claimId` / `userId` / invalid amount
(≤0 / NaN) / amount > `maxClaimAmount` / duplicate `claimId` / account
not-active / per-user pending cap reached. Tags `PENDING`.

`setAccountStatusV2(db, accountId, newStatus, patch)` is state-machine
guarded (terminal `closed`). `setClaimStatusV2(db, claimId, newStatus,
patch)` is state-machine guarded (terminal `paid` / `rejected`);
`→paid` stamps `paidAt`. Both accept patch keys `reason` + `metadata`
(merged). Shortcuts: `freezeAccount` / `unfreezeAccount` /
`closeAccount`, `approveClaim` / `rejectClaim` / `payClaim`.

`autoExpireUnclaimedClaims(db, now?)` bulk-flips `PENDING → REJECTED`
with `reason: "expired"` when `(now - createdAt) > claimExpiryMs`.
Skips non-pending claims.

`getTokenStatsV2()` returns all-enum-key zero-initialized snapshot:
`accountsByStatus` / `claimsByStatus` plus `totalAccounts` /
`totalClaims` / `totalClaimedAmount` / `totalPaidAmount` /
`maxPendingClaimsPerUser` / `claimExpiryMs` / `maxClaimAmount` —
stable shape for CI regression.

Not ported (Desktop-only): on-chain settlement, P2P cross-wallet
transfer, reputation-weighted reward calculation, multi-sig claim
approval flows, claim receipts with cryptographic signatures,
external payment-rail integration (Stripe / crypto bridges),
claim appeal / arbitration workflows, per-tier reward multipliers.
Strictly additive — legacy `ensureTokenTables`, `transfer`, `mint`,
`recordContribution`, `rewardContribution`, `getContributions`,
`getLeaderboard`, `getBalance`, `listAccounts`, `getTransactionHistory`,
`_resetState` all preserved.

### Plugin Ecosystem V2 (Phase 64) — Maturity + Install Lifecycle

```bash
# Enum catalogs
cc ecosystem maturity-statuses-v2              # [active, deprecated, archived, removed]
cc ecosystem install-lifecycle-v2              # [pending, resolving, installed, failed, uninstalled]

# Config (show / mutate)
cc ecosystem default-max-active-plugins-per-developer | max-active-plugins-per-developer | set-max-active-plugins-per-developer <n>
cc ecosystem default-max-pending-installs-per-user | max-pending-installs-per-user | set-max-pending-installs-per-user <n>
cc ecosystem default-auto-deprecate-after-ms | auto-deprecate-after-ms | set-auto-deprecate-after-ms <ms>
cc ecosystem default-auto-archive-after-ms | auto-archive-after-ms | set-auto-archive-after-ms <ms>

# Counts (all / scoped)
cc ecosystem active-plugin-count [-d <developer>]
cc ecosystem pending-install-count [-u <user>]

# Maturity state machine
cc ecosystem register-plugin-v2 <plugin-id> -d <developer> [-m <json>]
cc ecosystem maturity-v2 <plugin-id>
cc ecosystem set-maturity-v2 <plugin-id> <status> [-r <reason>] [-m <json>]
cc ecosystem deprecate-plugin <plugin-id> [-r]
cc ecosystem archive-plugin-v2 <plugin-id> [-r]
cc ecosystem remove-plugin-v2 <plugin-id> [-r]
cc ecosystem touch-plugin-activity <plugin-id>

# Install state machine
cc ecosystem submit-install-v2 <install-id> -u <user> -p <plugin> [-m <json>]
cc ecosystem install-status-v2 <install-id>
cc ecosystem set-install-status-v2 <install-id> <status> [-r] [-m]
cc ecosystem resolve-install <install-id> [-r]
cc ecosystem complete-install <install-id> [-r]
cc ecosystem fail-install <install-id> [-r]
cc ecosystem uninstall-install-v2 <install-id> [-r]
cc ecosystem retry-failed-install <install-id> [-r]

# Bulk auto-flip
cc ecosystem auto-deprecate-stale-plugins      # active → deprecated on lastActivityAt > autoDeprecateAfterMs
cc ecosystem auto-archive-long-deprecated      # deprecated → archived on updatedAt > autoArchiveAfterMs

# Aggregate
cc ecosystem stats-v2
```

Maturity lifecycle: `active → {deprecated, archived}`,
`deprecated → {active, archived, removed}`, `archived → {active, removed}`;
terminal `removed`. Install lifecycle:
`pending → {resolving, failed, uninstalled}`, `resolving → {installed, failed}`,
`installed → uninstalled`, `failed → {pending, uninstalled}` (retry or abandon);
terminal `uninstalled`. Per-developer active-plugin cap (default 20) enforced on
`registerPluginV2`; per-user pending+resolving install cap (default 5) enforced on
`submitInstallV2`. Unregistered plugins bypass the installable check (opt-in V2);
archived/removed plugins reject new installs; deprecated plugins remain
installable (grace period). `autoDeprecateStalePlugins` bulk-flips ACTIVE plugins
whose `lastActivityAt` exceeds `autoDeprecateAfterMs` (default 180 days) to
DEPRECATED with reason `"stale"`; `autoArchiveLongDeprecated` bulk-flips
DEPRECATED plugins whose `updatedAt` exceeds `autoArchiveAfterMs` (default 90 days)
to ARCHIVED with reason `"long-deprecated"`. `stats-v2` returns
`{ totalPluginsV2, totalInstallsV2, maxActivePluginsPerDeveloper,
maxPendingInstallsPerUser, autoDeprecateAfterMs, autoArchiveAfterMs,
maturityByStatus, installsByStatus }` with all enum keys zero-initialized —
stable shape for CI regression.

Not ported (Desktop-only): AI-driven recommendation (collaborative filtering +
embedding match), semver range negotiation in dep resolver, real sandbox
(vm2 / process isolation / resource limits), LLM-backed code review, real
packaging + signing + upload, payment gateway integration for revenue payouts,
reputation-weighted plugin ranking, A/B experimentation for recommendations.
Strictly additive — legacy `ensurePluginEcosystemTables`, `registerPlugin`,
`installPlugin`, `aiReviewCode`, `recordSandboxTest`, `submitForReview`,
`approvePlugin`, `rejectPlugin`, `publishPlugin`, `recordRevenue`,
`getDeveloperRevenue`, `recommend`, `getStats`, `getConfig` all preserved.

### Knowledge Graph V2 (Phase 94) — Entity + Relation Lifecycle

```bash
# V2 enums + config
cc kg entity-statuses-v2                           # list 4 entity states
cc kg relation-statuses-v2                         # list 3 relation states
cc kg default-max-active-entities-per-owner        # show default (1000)
cc kg max-active-entities-per-owner                # show current
cc kg set-max-active-entities-per-owner <n>        # floor + reject ≤0
cc kg default-max-relations-per-entity             # show default (100)
cc kg set-max-relations-per-entity <n>
cc kg default-entity-stale-ms                      # 180 days
cc kg set-entity-stale-ms <ms>
cc kg default-relation-stale-ms                    # 365 days
cc kg set-relation-stale-ms <ms>

# Counts (global or scoped)
cc kg active-entity-count [-o <owner>]
cc kg active-relation-count [-s <source>]

# Entity V2 lifecycle
cc kg register-entity-v2 <entity-id> -o <owner> [-n name] [-t type] [-m json]
cc kg entity-v2 <entity-id>                        # show state
cc kg set-entity-status-v2 <entity-id> <status> [-r|-m]
cc kg deprecate-entity <entity-id> [-r reason]
cc kg archive-entity-v2 <entity-id> [-r reason]
cc kg remove-entity-v2 <entity-id> [-r reason]     # terminal
cc kg revive-entity <entity-id> [-r reason]
cc kg touch-entity-activity <entity-id>            # bump lastActivityAt

# Relation V2 lifecycle
cc kg register-relation-v2 <relation-id> -s <src> -t <tgt> -r <type> [-m json]
cc kg relation-v2 <relation-id>                    # show state
cc kg set-relation-status-v2 <relation-id> <status> [-r|-m]
cc kg deprecate-relation <relation-id> [-r reason]
cc kg remove-relation-v2 <relation-id> [-r reason] # terminal
cc kg revive-relation <relation-id> [-r reason]

# Auto-flip bulk operations
cc kg auto-archive-stale-entities
cc kg auto-remove-stale-relations

# V2 stats
cc kg stats-v2                                     # all-enum-key zero-init
```

Phase 94 adds two parallel lifecycle state machines on top of the legacy
knowledge graph. Entity maturity has 4 states (`active → {deprecated,
archived}`, `deprecated → {active, archived, removed}`, `archived →
{active, removed}`, terminal `removed`). Relation lifecycle has 3 states
(`active → {deprecated, removed}`, `deprecated → {active, removed}`,
terminal `removed`). `registerEntityV2` enforces a per-owner active-entity
cap (default 1000); `registerRelationV2` enforces a per-source-entity
active-relation cap (default 100) and requires both source and target to
be registered in V2 and in active/deprecated state (archived/removed
entities reject new relations; deprecated entities allowed as grace
period). Self-referencing relations rejected. Lifecycle setters accept
`{reason, metadata}` patches with metadata deep-merged.
`touchEntityActivity` bumps `lastActivityAt` to signal the entity is
still relevant (resets auto-archive timer). `autoArchiveStaleEntities`
bulk-flips ACTIVE entities whose `(now - lastActivityAt) > entityStaleMs`
(default 180 days) to ARCHIVED with reason `"stale"`;
`autoRemoveStaleRelations` bulk-flips non-removed relations whose
`(now - updatedAt) > relationStaleMs` (default 365 days) to REMOVED with
reason `"stale"`. `stats-v2` returns `{ totalEntitiesV2,
totalRelationsV2, maxActiveEntitiesPerOwner, maxRelationsPerEntity,
entityStaleMs, relationStaleMs, entitiesByStatus, relationsByStatus }`
with all enum keys zero-initialized — stable shape for CI regression.

Not ported (Desktop-only): GraphRAG fusion (entity embeddings + vector
retrieval + LLM augmentation), force-directed visualization, real-time
collaborative graph editing UI, entity deduplication via semantic
similarity, LLM-powered relation extraction, community detection
(Louvain/Leiden), graph embeddings (node2vec/GNN), temporal graph
reasoning, ontology reasoning (RDFS/OWL). Strictly additive — legacy
`ensureKnowledgeGraphTables`, `addEntity`, `getEntity`, `listEntities`,
`removeEntity`, `addRelation`, `getRelation`, `listRelations`,
`removeRelation`, `reason`, `query`, `getStats`, `exportGraph`,
`importGraph` all preserved.
