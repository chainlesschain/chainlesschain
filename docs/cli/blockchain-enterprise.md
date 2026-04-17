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
