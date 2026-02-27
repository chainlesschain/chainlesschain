# ChainlessChain - 基于U盾和SIMKey的个人移动AI管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-v1.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-100%25-brightgreen.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.2.7-blue.svg)
![Tests](https://img.shields.io/badge/tests-2500%2B-brightgreen.svg)

**去中心化 · 隐私优先 · AI原生**

一个完全去中心化的个人AI助手平台,整合知识库管理、社交网络和交易辅助三大核心功能。

[English](./README_EN.md) | [设计文档](./docs/design/系统设计_主文档.md) | [详细功能](./docs/FEATURES.md)

</div>

---

## ⭐ 当前版本: v1.1.0-alpha Enterprise Edition (2026-02-27)

### 最新更新 - Q2 2026 全面升级 (Phase 41-45)

**Phase 41-45 完整实现** - EvoMap全球知识共享 + Social AI + 企业合规 + SCIM 2.0 + 统一密钥系统,共计71个新IPC处理器，13张新数据库表，4个新前端路由

#### Phase 42-45 - Q2 2026 企业级功能扩展 (2026-02-27)

**Phase 42 — Social AI + ActivityPub** (18个IPC处理器):

- ✅ **Topic Analyzer** (`social/topic-analyzer.js`) - NLP主题提取，TF-IDF关键词，情感倾向分析，9个预定义分类，相似度匹配
- ✅ **Social Graph** (`social/social-graph.js`) - 社交关系图谱，中心性分析(度/接近/中介/特征向量)，社区发现(Louvain)，影响力评分，路径查找
- ✅ **ActivityPub Bridge** (`social/activitypub-bridge.js`) - W3C ActivityPub S2S协议，Actor管理，Activity发布/接收，Inbox/Outbox，Follow/Like/Announce
- ✅ **AP Content Sync** (`social/ap-content-sync.js`) - 内容双向同步，DID→Actor映射，Markdown→HTML转换，媒体附件处理，本地内容发布到Fediverse
- ✅ **AP WebFinger** (`social/ap-webfinger.js`) - RFC 7033 WebFinger协议，用户发现，acct:URI解析，Actor资源定位
- ✅ **AI Social Assistant** (`social/ai-social-assistant.js`) - 3种回复风格(简洁/详细/幽默)，智能回复生成，内容总结，话题推荐
- ✅ **Extended Social IPC** (`social/social-ipc.js`) - 60→78个IPC处理器(+18新增)，完整社交AI集成
- ✅ **Pinia Store** (`stores/socialAI.ts`) - 社交AI状态管理，主题分析，图谱查询，ActivityPub操作
- ✅ **前端UI** - SocialInsightsPage社交洞察页 + ActivityPubBridgePage联邦宇宙桥接页

**Phase 43 — Compliance + Data Classification** (12个IPC处理器):

- ✅ **SOC2 Compliance** (`audit/soc2-compliance.js`) - SOC2合规框架，5大信任服务原则(TSC)，控制点检查，证据收集，合规报告生成
- ✅ **Data Classifier** (`audit/data-classifier.js`) - 数据分类引擎，4级分类(PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED)，ML分类器，规则引擎，敏感数据扫描
- ✅ **Classification Policy** (`audit/classification-policy.js`) - 分类策略管理，字段级分类规则，自动标记，加密策略映射，访问控制集成
- ✅ **Data Subject Handler** (`audit/data-subject-handler.js`) - GDPR数据主体请求(DSR)处理，导出/删除/修正，请求工作流，审计日志
- ✅ **Compliance Manager** (`audit/compliance-manager.js`) - 统一合规管理器，多框架支持(GDPR/SOC2/ISO27001/HIPAA)，合规检查调度，风险评分
- ✅ **Compliance IPC** (`audit/compliance-ipc.js`) - 12个IPC处理器(SOC2检查/证据/分类/策略/DSR/合规检查/报告)
- ✅ **Pinia Store** (`stores/compliance.ts`) - 合规状态管理，检查执行，报告生成，证据管理
- ✅ **前端UI** - ComplianceDashboardPage合规仪表板(证据收集/分类管理/DSR处理/报告导出)

**Phase 44 — SCIM 2.0 Enterprise Provisioning** (8个IPC处理器):

- ✅ **SCIM Server** (`enterprise/scim-server.js`) - RFC 7644 SCIM 2.0协议服务器，User/Group资源管理，RESTful API(GET/POST/PUT/PATCH/DELETE)，过滤/排序/分页，批量操作
- ✅ **SCIM Sync** (`enterprise/scim-sync.js`) - IdP双向同步引擎，增量同步，冲突解决(IdP优先/本地优先/最新优先)，变更追踪，同步日志
- ✅ **SCIM IPC** (`enterprise/scim-ipc.js`) - 8个IPC处理器(启动/停止服务器，同步User/Group，冲突解决，日志查询)
- ✅ **Extended Org Manager** - 企业组织管理器扩展，SCIM资源映射，属性转换，Schema管理
- ✅ **Pinia Store** - SCIM状态管理，服务器控制，同步操作，日志监控
- ✅ **前端UI** - SCIMIntegrationPage集成页面(IdP配置/资源管理/同步控制/日志查看)

**Phase 45 — Unified Key + FIDO2 + Cross-Platform USB** (8个IPC处理器):

- ✅ **Unified Key Manager** (`ukey/unified-key-manager.js`) - BIP-32分层确定性密钥，单主密钥派生无限子密钥，用途隔离(签名/加密/认证)，导出/导入，密钥轮换
- ✅ **FIDO2 Authenticator** (`ukey/fido2-authenticator.js`) - W3C WebAuthn标准，CTAP2协议，Passkey无密码认证，挑战-响应，Resident Keys，UV/UP验证
- ✅ **USB Transport** (`ukey/usb-transport.js`) - 跨平台USB通信，Windows(node-usb)/macOS(IOKit via Koffi)/Linux(libusb)，设备枚举，批量传输，APDU封装
- ✅ **WebUSB Fallback** (`ukey/webusb-fallback.js`) - 浏览器WebUSB API回退，设备请求，权限管理，vendorId/productId过滤
- ✅ **Extended UKey IPC** (`ukey/ukey-ipc.js`) - 9→17个IPC处理器(+8新增)，统一密钥操作，FIDO2认证，USB设备管理
- ✅ **Extended Driver Registry** - 驱动注册表扩展，5个新驱动类型(FIDO2/BIP32/TPM2/TEE/Satellite)
- ✅ **Pinia Store** - 统一密钥状态管理，FIDO2认证流程，USB设备监控

**数据库新增** (10张新表):

- ✅ `topic_analyses` - 主题分析缓存 (content_hash, topics JSON, keywords JSON, sentiment, category)
- ✅ `social_graph_edges` - 社交图谱边 (source_did, target_did, edge_type, weight, metadata JSON)
- ✅ `activitypub_actors` - ActivityPub Actor (actor_uri, did, inbox, outbox, public_key, follower_count)
- ✅ `activitypub_activities` - Activity对象 (activity_id, type, actor, object, published, raw JSON)
- ✅ `soc2_evidence` - SOC2证据 (control_id, evidence_type, file_path, collected_at, metadata JSON)
- ✅ `data_classifications` - 数据分类 (table_name, column_name, classification_level, policy_id, classified_at)
- ✅ `scim_resources` - SCIM资源映射 (scim_id, resource_type, local_id, attributes JSON, meta JSON)
- ✅ `scim_sync_log` - SCIM同步日志 (sync_type, direction, status, records_synced, conflicts, details JSON)
- ✅ `unified_keys` - 统一密钥 (key_id, purpose, derivation_path, public_key, encrypted_private_key, created_at)
- ✅ `fido2_credentials` - FIDO2凭证 (credential_id, rp_id, user_handle, public_key, sign_count, aaguid, created_at)

**配置新增** (5个新配置段):

- ✅ `socialAI` - 主题分析/图谱/ActivityPub配置
- ✅ `activitypub` - 实例名称/域名/管理员/描述
- ✅ `compliance` - 合规框架/检查间隔/证据路径
- ✅ `scim` - SCIM服务器端口/认证/同步策略
- ✅ `unifiedKey` - 密钥派生/FIDO2 RP/USB配置

**Context Engineering集成**:

- ✅ step 4.9: 社交图谱上下文注入(`setSocialGraph()`)
- ✅ step 4.10: 合规策略上下文注入(`setComplianceManager()`)

**前端集成**:

- ✅ 4个新路由: `/social-insights`, `/activitypub-bridge`, `/compliance-dashboard`, `/scim-integration`
- ✅ 3个新Pinia Store: `socialAI.ts`, `compliance.ts`, UKey store扩展
- ✅ IPC注册: Phase 42(18) + Phase 43(12) + Phase 44(8) + Phase 45(8) = 46个新IPC处理器

#### Phase 41 - EvoMap全球Agent知识共享网络 (2026-02-26)

**EvoMap GEP-A2A协议集成 (v1.0.0)** (5大核心模块, 25 IPC处理器, 3张新表):

- ✅ **EvoMap Client** (`evomap-client.js`) - GEP-A2A v1.0.0协议客户端，HTTP通信，协议信封封装，重试机制，Asset ID计算(SHA-256)
- ✅ **Node Manager** (`evomap-node-manager.js`) - 节点身份管理，自动心跳(15分钟)，信用积累，DID身份映射，节点注册/发现
- ✅ **Gene Synthesizer** (`evomap-gene-synthesizer.js`) - 本地知识→Gene+Capsule转换，隐私过滤(秘密检测/路径匿名/邮箱替换)，类别映射
- ✅ **Asset Bridge** (`evomap-asset-bridge.js`) - 双向同步引擎，发布/获取/导入流程，用户审核门控，上下文构建，资产缓存
- ✅ **EvoMap IPC** (`evomap-ipc.js`) - 25个IPC处理器 (节点5+发布5+发现5+导入3+任务4+配置3)
- ✅ **Pinia Store** (`evomap.ts`) - 完整状态管理，5 Getters，20+ Actions，TypeScript类型安全
- ✅ **前端UI** - EvoMapDashboard仪表板 + EvoMapBrowser资产浏览器，2个新路由

**核心特性**:

- 🧬 **知识合成**: Instinct→Gene+Capsule，Decision→Gene+Capsule，工作流→Recipe
- 🌐 **双向同步**: 发布本地知识到Hub，获取社区验证策略到本地
- 🔒 **隐私优先**: opt-in设计，内容匿名化，秘密检测，用户审核门控
- 💡 **上下文注入**: 获取的社区知识自动注入LLM提示词（Context Engineering step 4.8）
- 💰 **信用经济**: 节点注册，信用积累，心跳维持在线状态
- 🎯 **任务悬赏**: 浏览和认领社区任务，提交结果获取信用
- 📦 **资产导入**: Gene→Skill (SKILL.md)，Capsule→Instinct (instincts表)

**数据库新增** (3张新表):

- ✅ `evomap_node` - 节点身份存储 (node_id, DID映射, credits, reputation, claim_code)
- ✅ `evomap_assets` - 资产缓存 (asset_id, type, status, direction, content JSON, gdi_score)
- ✅ `evomap_sync_log` - 同步日志 (action, asset_id, status, details JSON)

**前端集成**:

- ✅ 2个新路由: `/evomap` (仪表板) + `/evomap/browser` (资产浏览器)
- ✅ Pinia Store: `stores/evomap.ts` (~450行, 完整TypeScript类型)
- ✅ 配置集成: `unified-config-manager.js` 新增 `evomap` 配置段
- ✅ IPC注册: Phase 41 区块注册到 `ipc-registry.js`
- ✅ Context Engineering: step 4.8自动注入社区知识到LLM提示词

**安全与隐私**:

- 🔐 默认opt-in，用户必须主动启用
- 🔐 发布前自动隐私过滤：路径/邮箱/秘密检测
- 🔐 用户审核门控：requireReview: true
- 🔐 导入Instinct置信度上限0.7，避免盲目信任

#### v1.1.0 - Cowork去中心化Agent网络 + 自治运维 + 流水线编排 + 多模态协作 + NL编程 (2026-02-25)

**去中心化Agent网络(v4.0)** + **自治运维系统(v3.3)** + **开发流水线编排(v3.0)** + **多模态协作(v3.2)** + **自然语言编程(v3.1)** - 72个新IPC处理器，7张新数据库表，5大新Cowork子系统

#### v1.1.0 - Cowork Agent去中心化网络 + 自治运维 + 流水线编排 + 多模态协作 + NL编程 (2026-02-25)

**去中心化Agent网络 (v4.0)** (6大核心模块, 20个IPC处理器):

- ✅ **Agent DID身份** (`agent-did.js`) - W3C标准去中心化标识符(did:chainless:{uuid})，Ed25519密钥对，能力访问控制，状态生命周期管理(active/suspended/revoked)
- ✅ **Agent认证系统** (`agent-authenticator.js`) - 挑战-响应协议，Ed25519签名验证，三种认证方式(did-challenge/credential-proof/mutual-tls)，会话管理(1小时TTL)
- ✅ **Agent凭证管理** (`agent-credential-manager.js`) - W3C可验证凭证(VC)规范，凭证签发/验证/吊销，3种凭证类型(capability/delegation/membership)，自动过期检查，凭证链验证
- ✅ **Agent信誉系统** (`agent-reputation.js`) - 加权平均评分(成功率40%+响应时间20%+质量30%+时效10%)，4级信誉等级(TRUSTED/RELIABLE/NEUTRAL/UNTRUSTED)，闲置衰减
- ✅ **联邦Agent注册表** (`federated-agent-registry.js`) - Kademlia DHT路由启发式设计，K桶路由表，能力索引快速查找，3种发现模式(local/federated/broadcast)，网络健康监控
- ✅ **跨组织任务路由** (`cross-org-task-router.js`) - 4种路由策略(NEAREST/BEST_REPUTATION/ROUND_ROBIN/CAPABILITY_MATCH)，50并发任务上限，5分钟超时，凭证验证集成
- ✅ **去中心化网络IPC** (`decentralized-network-ipc.js`) - 20个IPC处理器 (Agent DID管理4个 + 联邦注册表4个 + 凭证3个 + 跨组织任务4个 + 信誉4个 + 配置1个)

**自治运维系统 (v3.3)** (6大组件, 15个IPC处理器):

- ✅ **异常检测与事件管理** (`autonomous-ops-ipc.js`) - 15个IPC处理器，事件等级分类，基线管理，Playbook剧本执行，Postmortem自动生成
- ✅ **自动修复器** (`auto-remediator.js`) - 智能告警触发自动修复，修复策略选择，执行记录
- ✅ **回滚管理器** (`rollback-manager.js`) - 版本快照管理，一键回滚，回滚历史追踪
- ✅ **告警管理器** (`alert-manager.js`) - 多渠道告警通知，告警规则配置，聚合去重
- ✅ **部署后监控** (`post-deploy-monitor.js`) - 部署后健康检查，性能基线对比，异常自动上报
- ✅ **事后分析生成器** (`postmortem-generator.js`) - AI自动生成事后分析报告，根因分析，改进建议

**开发流水线编排 (v3.0)** (3大组件, 15个IPC处理器):

- ✅ **流水线管理** (`pipeline-ipc.js`) - 15个IPC处理器，流水线创建/暂停/恢复/取消，审批门控(approve/reject)，制品管理，指标统计，预置模板
- ✅ **部署代理** (`deploy-agent.js`) - 6种部署策略(GIT_PR/DOCKER/NPM_PUBLISH/LOCAL/STAGING)，自动创建分支(前缀: pipeline/)，烟雾测试(30s超时)，部署超时(120s)，RollbackManager集成
- ✅ **规范翻译器** (`spec-translator.js`) - 技术规范文档格式转换，结构化需求提取

**多模态协作 (v3.2)** (5大组件, 12个IPC处理器):

- ✅ **多模态输入融合** (`modality-fusion.js`) - 文本/图像/音频/视频多模态统一融合，模态权重自适应
- ✅ **文档解析器** (`document-parser.js`) - PDF/Word/Excel/图片等多格式文档解析，结构化内容提取
- ✅ **多模态上下文** (`multimodal-context.js`) - 跨模态会话上下文维护，上下文序列化存储
- ✅ **多模态输出生成** (`multimodal-output.js`) - 多格式内容生成，制品管理(DB持久化)
- ✅ **屏幕录制** (`screen-recorder.js`) - 屏幕截图序列录制，支持暂停/恢复
- ✅ **多模态协作IPC** (`multimodal-collab-ipc.js`) - 12个IPC处理器 (输入融合/文档解析/上下文构建/会话管理/制品/截图/转写/输出生成)

**自然语言编程 (v3.1)** (3大组件, 10个IPC处理器):

- ✅ **NL编程IPC** (`nl-programming-ipc.js`) - 10个IPC处理器，NL→代码转换，代码验证，项目约定获取，风格分析，历史管理
- ✅ **需求解析器** (`requirement-parser.js`) - 自然语言需求→结构化规范，实体提取，优先级标注
- ✅ **项目风格分析器** (`project-style-analyzer.js`) - 代码风格自动检测，约束规则提取，风格一致性保障

**数据库新增** (7张新表):

- ✅ `agent_dids` - Agent DID身份存储 (Ed25519密钥对, 组织归属, 能力列表)
- ✅ `agent_reputation` - Agent信誉评分 (加权评分, 任务统计, 时效衰减)
- ✅ `ops_incidents` - 运维事件记录 (严重级别, 状态追踪, 解决时间)
- ✅ `ops_remediation_playbooks` - 修复剧本库 (触发条件, 执行步骤, 成功率)
- ✅ `multimodal_sessions` - 多模态会话 (模态列表, 上下文存储, 状态)
- ✅ `multimodal_artifacts` - 多模态制品 (类型, 路径, 元数据, 会话关联)
- ✅ `federated_task_log` - 联邦任务日志 (跨组织任务路由记录)

#### v1.0.0 企业版 - 去中心化社交平台全面升级 (2026-02-23)

**P2P社交新功能** (7大核心功能):

- ✅ **P2P语音/视频通话** (`call-manager` + `call-signaling`) - WebRTC + DTLS-SRTP端到端加密，SFU中继支持2-8人会议，音频降噪，屏幕共享，通话录制 (单元测试 + 集成测试全覆盖)
- ✅ **共享加密相册** (`shared-album-manager`) - 端到端加密相册，EXIF隐私擦除，P2P分发，访问控制，版本管理
- ✅ **社区与频道** (`community-manager` + `channel-manager`) - Gossip协议消息分发，频道角色权限，治理投票引擎，社区经济模型
- ✅ **时光机** (`time-machine`) - AI生成记忆摘要，情感分析 (`sentiment-analyzer`)，历史回放，重要时刻提取，节日祝福生成
- ✅ **去中心化直播** - IPFS视频流，弹幕系统，打赏机制，P2P CDN加速
- ✅ **社交代币** (`social-token`) - ERC-20社交积分，创作者经济，代币发行与流通，治理投票
- ✅ **匿名模式** - ZKP零知识证明身份验证，临时DID，可撤销匿名

**企业级基础设施** (5大新模块):

- ✅ **IPFS去中心化存储** (`ipfs-manager`) - Helia/Kubo双引擎，内容寻址，P2P CDN，自动固定策略
- ✅ **实时协作系统** (`yjs-collab-manager` + `realtime-collab-manager`) - Yjs CRDT冲突解决，P2P实时同步，光标共享，文档锁，协作历史
- ✅ **分析仪表板** (`analytics-aggregator`) - 实时数据聚合，多维指标，可视化报表，趋势分析
- ✅ **自治Agent Runner** (`autonomous-agent-runner`) - ReAct循环，目标分解，多步推理，自主任务执行，检查点恢复
- ✅ **企业组织管理** (`enterprise-org-manager`) - 组织层级，审批工作流，多租户，权限继承

**系统增强** (4大改进):

- ✅ **模型量化系统** (`quantization-manager` + `gguf-quantizer` + `gptq-quantizer`) - GGUF 14种量化级别(Q2_K~F32)，AutoGPTQ Python桥接，进度追踪，Ollama导入集成
- ✅ **i18n国际化** (`i18n/index.js`) - 4种语言(中文/English/日本語/한국어)，运行时切换，AI提示词本地化
- ✅ **性能自动调优** (`auto-tuner` + `performance-monitor`) - 实时性能监控，自动参数调整，内存预警，负载预测
- ✅ **TypeScript Stores扩展** - 46个TypeScript Stores（较v0.39.0新增13个），完整类型覆盖

**测试体系完善** (新增测试文件):

- ✅ `p2p/__tests__/call-manager.test.js` + `call-signaling.test.js` - P2P通话完整单元测试
- ✅ `social/__tests__/` (7个文件) - community/channel/governance/sentiment/album/token/time-machine
- ✅ `tests/integration/community-channels.test.js` + `social-calls.test.js` + `social-tokens.test.js` - 集成测试

#### v0.39.0 Cowork自进化系统 + everything-claude-code模式 (2026-02-22)

**Cowork v2.1.0 自进化与知识图谱** (7核心模块, 35个IPC处理器):

- ✅ **代码知识图谱** (`code-knowledge-graph`) - 工作区代码扫描，8种实体类型，7种关系类型，中心性分析，循环依赖检测，热点发现 (14个IPC)
- ✅ **决策知识库** (`decision-knowledge-base`) - 历史决策记录，相似性搜索，最佳实践提取，9个问题类别，Hook自动捕获 (6个IPC)
- ✅ **Prompt优化器** (`prompt-optimizer`) - 技能提示词自优化，A/B变体测试，SHA-256去重，成功率追踪 (5个IPC)
- ✅ **技能发现器** (`skill-discoverer`) - 任务失败分析，关键词提取，Marketplace技能搜索推荐 (4个IPC)
- ✅ **辩论式代码审查** (`debate-review`) - 3视角多Agent审查(性能/安全/可维护性)，共识投票裁决 (3个IPC)
- ✅ **A/B方案对比** (`ab-comparator`) - 5种Agent风格方案生成，3维基准评测，自动评分排名 (3个IPC)
- ✅ **统一Evolution IPC** - 6个模块35个处理器统一注册

**Cowork v2.0.0 跨设备协作** (7模块, 41个IPC处理器):

- ✅ **P2P Agent网络** - WebRTC DataChannel跨设备Agent通信，15种消息协议 (12个IPC)
- ✅ **设备发现** - 网络设备自动发现，4级能力分层，健康监控 (6个IPC)
- ✅ **混合执行器** - 6种执行策略(本地优先/远程优先/最佳适配/负载均衡) (5个IPC)
- ✅ **Computer Use桥接** - 12个AI工具映射为Cowork技能 (6个IPC)
- ✅ **Cowork API服务器** - RESTful API 20+端点，Bearer/API-Key认证，SSE流 (5个IPC)
- ✅ **Webhook管理器** - 17种事件类型，HMAC签名验证，指数退避重试 (7个IPC)

**Cowork支撑模块** (4模块, 32个IPC处理器):

- ✅ **CI/CD优化器** - 智能测试选择，依赖图分析，Flakiness评分，增量构建编排 (10个IPC)
- ✅ **负载均衡器** - 实时Agent指标追踪，复合负载评分，任务自动迁移 (8个IPC)
- ✅ **ML任务调度器** - 加权线性回归复杂度预测，资源估算，在线学习 (8个IPC)
- ✅ **IPC API文档生成器** - 递归扫描`*-ipc.js`，OpenAPI 3.0生成，Markdown文档自动生成 (6个IPC)

**everything-claude-code模式集成**:

- ✅ **Verification Loop Skill** - 6阶段自动验证流水线(Build→TypeCheck→Lint→Test→Security→DiffReview)
- ✅ **Orchestrate Workflow Skill** - 4种预定义多代理工作流模板(feature/bugfix/refactor/security-audit)
- ✅ **Instinct Learning System** - 自动从用户会话提取可复用模式("本能")，8类别+置信度评分+上下文注入
- ✅ **11个IPC处理器** - 完整CRUD、强化/衰减、进化、导出/导入、统计
- ✅ **2个数据库表** - instincts(模式存储) + instinct_observations(事件缓冲)

#### v0.38.0 SIMKey 六大安全增强 (2026-02-21)

- ✅ **iOS eSIM支持** - Apple eSIM API + Secure Enclave集成，iOS用户可使用eSIM作为SIMKey安全载体
- ✅ **5G SIM卡优化** - 签名速度提升3-5倍，支持国密SM2/SM3/SM4/SM9，批量签名流水线
- ✅ **NFC离线签名** - 近场通信离线身份验证、交易签名、文件签名，无需网络
- ✅ **多SIM卡自动切换** - 双卡双待智能管理，网络故障自动切换，工作/个人分离
- ✅ **SIM卡健康监控** - 实时健康评分仪表盘，智能告警，自动维护，报告导出
- ✅ **量子抗性算法升级** - NIST PQC标准(ML-KEM/ML-DSA/SLH-DSA)，混合加密模式，密钥迁移工具

#### v0.38.0 文档站全面扩展 (10个页面, 4,400+行新增)

- ✅ **AI模型文档** - 16+云LLM提供商总览，多模态视觉模型，智能模型路由，Context Engineering详解
- ✅ **SIMKey/U盾文档** - v0.38.0六大功能详细文档，API示例，配置指南，安全机制
- ✅ **社交系统路线图** - 分版本未来功能详细规划
- ✅ **交易系统路线图** - 拍卖系统、团购/拼单、分期付款、闪电网络支付等未来规划
- ✅ **Git同步路线图** - 跨设备同步增强、协作编辑、版本可视化等未来规划
- ✅ **加密系统扩展** - 后量子密码学、TEE集成、零知识证明详解
- ✅ **Cowork协作扩展** - 多智能体工作流编排、Agent通信协议详解
- ✅ **系统概述扩展** - Phase 5路线图、竞品对比、应用场景详解

#### v0.37.4~v0.37.6 新增 30 个桌面技能 (总计 90 个)

- ✅ **Office 文档处理(5)** - pdf-toolkit, doc-converter, excel-analyzer, pptx-creator, doc-comparator
- ✅ **音视频处理(5)** - audio-transcriber, video-toolkit, subtitle-generator, tts-synthesizer, media-metadata
- ✅ **图像处理(3)** - image-editor, ocr-scanner, image-generator
- ✅ **数据处理(2)** - chart-creator, csv-processor
- ✅ **开发工具(3)** - word-generator, template-renderer, code-runner
- ✅ **自动化(2)** - voice-commander, file-compressor
- ✅ **系统运维(5)** - log-analyzer, system-monitor, env-file-manager, backup-manager, performance-profiler
- ✅ **知识管理(3)** - knowledge-graph, query-enhancer, memory-insights
- ✅ **安全+数据+网络(4)** - crypto-toolkit, password-generator, data-exporter, network-diagnostics
- ✅ **设计+工具(3)** - color-picker, text-transformer, clipboard-manager

#### v0.37.2 Android 移动生产力 + PC 远程委托 (28 技能)

- ✅ **5 LOCAL 生产力技能** - quick-note, email-draft, meeting-notes, daily-planner, text-improver
- ✅ **8 REMOTE PC 委托技能** - pc-screenshot→computer-use, pc-file-search→smart-search, pc-run-command→remote-control 等
- ✅ **remoteSkillName 映射** - Android 技能→桌面技能名称自动路由

#### v0.37.0~v0.37.1 AI 会话 + 开发效率 (20 技能)

- ✅ **AI 会话增强(4)** - prompt-enhancer, codebase-qa, auto-context, multi-model-router
- ✅ **开发效率(6)** - code-translator, dead-code-eliminator, changelog-generator, mock-data-generator, git-history-analyzer, i18n-manager
- ✅ **高级开发(10)** - architect-mode, commit-splitter, screenshot-to-code, diff-previewer, task-decomposer, bugbot, fault-localizer, impact-analyzer, rules-engine, research-agent

#### v0.36.0 功能 - AI Skills System 智能技能系统 + 统一工具注册表

- ✅ **Unified Tool Registry** - 统一工具注册表，聚合3大工具系统(FunctionCaller 60+工具 + MCP 8服务器 + Skills 92技能)
- ✅ **AI Call Chain Integration** - ManusOptimizations.bindUnifiedRegistry() 打通完整调用链
- ✅ **Agent Skills Open Standard** - 13个扩展字段(tools/instructions/examples等)
- ✅ **Demo Templates** - 10个演示项目模板，覆盖自动化/AI工作流/知识管理/远程控制4大类
- ✅ **Tools Explorer UI** - 工具浏览器页面(路由: `#/tools/explorer`)

#### v0.34.0 功能回顾 - Enterprise Features 企业级功能 + 社区生态

**Enterprise Audit & Compliance + Plugin Marketplace + Multi-Agent + SSO + MCP SDK** - 企业级审计合规、插件市场、专业化多代理、SSO认证、MCP SDK，76+ IPC handlers，26,000+行新代码

#### v0.34.0 新增核心功能 (2026-02-15)

- ✅ **Enterprise Audit System** - 统一审计日志、GDPR/SOC2合规检查、数据主体请求(DSR)、保留策略(18 IPC)
- ✅ **Compliance Manager** - 合规策略引擎、框架检查、合规报告生成
- ✅ **Plugin Marketplace** - 插件浏览/搜索/安装/卸载/评分/发布，完整生命周期管理(22 IPC)
- ✅ **Plugin Installer** - 下载/哈希校验/解压/SkillLoader注册，自动更新检测
- ✅ **Specialized Multi-Agent** - 8种专业代理模板(安全/DevOps/数据分析/文档/测试/架构/性能/合规)(16 IPC)
- ✅ **Agent Coordinator** - 多代理任务分解、分配、结果聚合、编排引擎
- ✅ **SSO Authentication** - SAML 2.0 + OAuth 2.0 + OIDC，PKCE支持，加密会话管理(20 IPC)
- ✅ **Identity Bridge** - DID ↔ SSO身份关联，双向查找，验证流程
- ✅ **MCP SDK** - Fluent API Server Builder，HTTP+SSE服务器，Stdio服务器
- ✅ **Community Registry** - 8+社区MCP服务器发现/安装/管理
- ✅ **5 Built-in Skills** - security-audit、devops-automation、data-analysis、test-generator、performance-optimizer
- ✅ **4-Layer Skill System** - bundled → marketplace → managed → workspace 四层技能加载

#### v0.33.0 功能回顾 - Remote Control 远程控制系统 + Browser Extension 浏览器扩展

**P2P Remote Control System** - 基于P2P网络的远程命令系统，支持Android设备远程控制PC，24+命令处理器，45,000+行代码

#### v0.33.0 新增核心功能 (2026-02-13)

- ✅ **Remote Control Gateway** - P2P远程网关，命令路由、权限验证(1,876行)、日志统计
- ✅ **24+ Command Handlers** - AI/系统/文件传输/浏览器/电源/进程/媒体/网络/存储/显示/输入/应用管理/安全/知识库/设备管理/命令历史/剪贴板/通知/工作流 全面控制
- ✅ **Chrome Browser Extension** - Chrome扩展集成，WebSocket服务器(3,326行)，Service Worker(15,077行)，Content Script
- ✅ **Browser Extension APIs (Phase 11-25)** - 剪贴板/文件/通知/会话管理/控制台/调试/网络模拟/设备仿真/Web APIs/WebRTC/高级存储/Chrome特性/硬件/媒体/Reader模式/截图/标注
- ✅ **Remote Workflow Engine** - 远程工作流引擎(812行)，支持条件分支和自动化任务编排
- ✅ **Android Remote UIs** - 电源/进程/媒体/网络/存储/输入/应用管理/安全信息 8个远程控制界面
- ✅ **Streaming Command Client** - 流式命令客户端，实时数据传输
- ✅ **Event Subscription** - 事件订阅系统，实时状态推送
- ✅ **Logging System** - 命令日志(614行)/批量日志(457行)/统计收集(681行)/性能配置

#### v0.33.0 功能回顾 - Remote Control + Computer Use

- ✅ **Computer Use Agent** - 统一代理整合所有电脑操作能力，68+ IPC handlers
- ✅ **CoordinateAction** - 像素级坐标点击、拖拽、手势操作
- ✅ **VisionAction** - Vision AI 集成，视觉元素定位，支持 Claude/GPT-4V/LLaVA
- ✅ **NetworkInterceptor** - 网络请求拦截、模拟、条件控制
- ✅ **DesktopAction** - 桌面级截图、鼠标键盘控制、窗口管理
- ✅ **AuditLogger** - 操作审计日志，风险评估(LOW/MEDIUM/HIGH/CRITICAL)，敏感信息脱敏
- ✅ **ScreenRecorder** - 屏幕录制为截图序列，支持暂停/恢复/导出
- ✅ **ActionReplay** - 操作回放引擎，支持变速、单步、断点调试
- ✅ **SafeMode** - 安全模式，权限控制、区域限制、速率限制、确认提示
- ✅ **WorkflowEngine** - 工作流引擎，支持条件分支、循环、并行执行、子工作流
- ✅ **ElementHighlighter** - 元素高亮显示，调试和演示可视化
- ✅ **TemplateActions** - 预定义操作模板，快速执行常用自动化任务
- ✅ **12 AI Tools** - browser_click, visual_click, browser_type, browser_key, browser_scroll, browser_screenshot 等

#### v0.32.0 功能回顾 (2026-02-10)

- ✅ **iOS 工作流系统** - WorkflowModels + WorkflowManager 完整工作流自动化
- ✅ **iOS 语音交互** - RealtimeVoiceInput 实时语音输入、VoiceManager 语音功能管理
- ✅ **Android MCP/Hooks/协作** - MCP 集成、Hooks 系统、Collaboration 模块、Performance 优化
- ✅ **Android 知识图谱** - KnowledgeGraphManager + Presentation Layer、知识图谱可视化

#### v0.31.0 功能回顾 (2026-02-09)

- ✅ **安全认证增强** - dev/prod 模式切换、API 端点 JWT 认证、设备密钥数据库集成
- ✅ **增量RAG索引系统** - MD5 content hash 变化检测、多文件联合检索、统一检索(向量+关键词+图谱)
- ✅ **项目上下文感知重排** - 上下文感知结果重排、6 个新 IPC handlers
- ✅ **SIMKey NFC检测** - 移动端 NFC 读取和 SIM 安全元件检测、开发模式模拟器支持
- ✅ **文件版本控制** - FileVersion 实体、版本历史、SHA-256 内容哈希、版本恢复
- ✅ **LLM Function Calling** - OpenAI 和 DashScope chat_with_tools 支持、自动能力检测
- ✅ **Deep Link 增强** - notes/clip 链接处理、通用导航、focusMainWindow
- ✅ **浏览器扩展增强** - 通过 chainlesschain:// 协议启动桌面应用
- ✅ **测试基础设施优化** - 89 个 Ant Design Vue 组件 stubs、dayjs mock 修复、权限系统测试优化

#### v0.29.0-v0.31.0 功能回顾

- ✅ **测试体系依赖注入重构** - 102 个数据库测试通过 DI 解除跳过、Browser IPC 可测性提升
- ✅ **社交通知 UI** - 社交通知功能实现、项目文件操作增强
- ✅ **TaskMonitor ECharts 仪表盘** - ECharts 集成、Tree-shaking 优化、防抖、2 个新图表
- ✅ **AbortController AI 对话取消** - 支持取消进行中的 AI 对话请求
- ✅ **对话收藏/重命名** - 对话列表收藏和重命名功能持久化
- ✅ **Firebase 集成** - Firebase 启用、WebRTC 增强
- ✅ **xlsx → exceljs 迁移** - 文件处理和项目页面依赖现代化
- ✅ **主进程 TypeScript 类型声明** - 完整的主进程类型定义
- ✅ **Android 多页面增强** - 文件浏览器统计 UI、P2P 聊天会话列表、设置/关于/帮助/收藏页面
- ✅ **Android P0 生产修复** - API 配置、Ed25519 签名、同步持久化、文件索引
- ✅ **社区论坛 TODO** - 跨社区论坛、Android、前端多项 TODO 实现

#### v0.29.0 功能回顾

- ✅ **TypeScript 迁移** - Stores 和 Composables 全面迁移到 TypeScript（类型安全、IDE 支持增强）
- ✅ **浏览器控制系统** - BrowserEngine + SnapshotEngine（18 IPC 通道、智能快照、元素定位）
- ✅ **Claude Code 风格系统** - 10 个子系统、127 IPC 通道完整实现
  - Hooks System (11) | Plan Mode (14) | Skills (17) | Context Engineering (17)
  - Prompt Compressor (10) | Response Cache (11) | Token Tracker (12)
  - Stream Controller (12) | Resource Monitor (13) | Message Aggregator (10)
- ✅ **Permission Engine** - 企业级 RBAC 权限引擎（资源级权限、继承、委托、团队权限）
- ✅ **Context Engineering** - KV-Cache 优化（17 IPC 通道、Token 预估、可恢复压缩）
- ✅ **Plan Mode** - Claude Code 风格计划模式（安全分析、审批流程、14 IPC 通道）

#### v0.28.0 功能回顾

- ✅ **永久记忆系统** - Daily Notes 自动记录 + MEMORY.md 长期知识萃取
- ✅ **混合搜索引擎** - Vector (语义) + BM25 (关键词) 双路并行搜索
- ✅ **Hooks 系统** - 21 种钩子事件、4 种钩子类型、优先级系统
- ✅ **MCP 集成测试** - 32 单元测试 + 31 端到端测试全部通过

#### 性能提升总结

| 指标         | 优化前 | 优化后 | 提升           |
| ------------ | ------ | ------ | -------------- |
| 任务成功率   | 40%    | 70%    | **+75%**       |
| KV-Cache命中 | -      | 60-85% | **极高**       |
| 混合搜索延迟 | -      | <20ms  | **极速**       |
| 测试覆盖率   | ~30%   | ~80%   | **+167%**      |
| LLM规划成本  | 基准   | -70%   | **月省$2,550** |

详见: [Phase 2 测试总结](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md) | [永久记忆文档](./docs/features/PERMANENT_MEMORY_INTEGRATION.md) | [Hooks 系统设计](./docs/design/HOOKS_SYSTEM_DESIGN.md) | [完整版本历史](./docs/CHANGELOG.md)

### 项目状态 (整体完成度: 100%)

- 🟢 **PC端桌面应用**: 100% 完成 - **生产就绪 (v1.1.0 Enterprise Edition)**
- 🟢 **知识库管理**: 100% 完成 - **8算法+5可视化+智能提取+6导出**
- 🟢 **AI引擎系统**: 100% 完成 - **17项优化+16个专用引擎+智能决策系统**
- 🟢 **Cowork多代理系统**: 100% 完成 - **95内置技能+智能编排+代理池+自进化+P2P Agent网络**
- 🟢 **去中心化社交平台**: 100% 完成 - **P2P语音/视频通话+共享相册+社区频道+时光机+直播+社交代币**
- 🟢 **企业版组织管理**: 100% 完成 - **组织层级+审批工作流+多租户+企业仪表板**
- 🟢 **实时协作系统**: 100% 完成 - **Yjs CRDT+P2P同步+光标共享+文档锁+协作历史**
- 🟢 **IPFS去中心化存储**: 100% 完成 - **Helia/Kubo双引擎+内容寻址+P2P CDN+自动固定**
- 🟢 **自治Agent Runner**: 100% 完成 - **ReAct循环+目标分解+自主执行+检查点恢复**
- 🟢 **模型量化系统**: 100% 完成 - **GGUF 14级量化+AutoGPTQ+进度追踪+Ollama集成**
- 🟢 **分析仪表板**: 100% 完成 - **实时聚合+多维指标+可视化报表**
- 🟢 **i18n国际化**: 100% 完成 - **4语言(中/英/日/韩)+运行时切换**
- 🟢 **性能自动调优**: 100% 完成 - **实时监控+参数自动调整+负载预测**
- 🟢 **区块链集成**: 100% 完成 - **15链支持+RPC管理+完整UI**
- 🟢 **远程控制系统**: 100% 完成 - **P2P远程网关+24+命令处理器+Chrome扩展**
- 🟢 **企业审计与合规**: 100% 完成 - **统一审计日志+GDPR合规+DSR处理+18 IPC**
- 🟢 **插件市场与SSO**: 100% 完成 - **插件市场22 IPC+SSO认证20 IPC+MCP SDK+多代理16 IPC**
- 🟢 **AI技能系统**: 100% 完成 - **95内置技能(100% Handler覆盖)+统一工具注册表+10演示模板+Agent Skills标准+本能学习**
- 🟢 **SIMKey安全增强**: 100% 完成 - **iOS eSIM+5G优化+NFC离线签名+多SIM卡切换+健康监控+量子抗性**
- 🟢 **去中心化Agent网络**: 100% 完成 - **W3C DID身份+挑战-响应认证+W3C VC凭证+信誉评分+联邦注册表+跨组织任务路由 (20 IPC)**
- 🟢 **自治运维系统**: 100% 完成 - **异常检测+事件管理+自动修复+告警+回滚+部署后监控+事后分析 (15 IPC)**
- 🟢 **开发流水线编排**: 100% 完成 - **流水线管理+6种部署策略+烟雾测试+审批门控+规范翻译 (15 IPC)**
- 🟢 **多模态协作**: 100% 完成 - **多模态输入融合+文档解析+上下文管理+多模态输出+屏幕录制 (12 IPC)**
- 🟢 **自然语言编程**: 100% 完成 - **NL→代码管道+需求解析+项目风格分析 (10 IPC)**
- 🟢 **EvoMap全球知识共享**: 100% 完成 - **GEP-A2A协议+知识合成+双向同步+隐私过滤+上下文注入+信用经济 (25 IPC)**
- 🟢 **移动端应用**: 100% 完成 - **完整功能+桌面同步+Android P2P UI+远程控制UI**

## 核心特性

- 🔐 **军事级安全**: SQLCipher AES-256加密 + U盾硬件密钥 + Signal协议E2E加密 + 后量子密码学(ML-KEM/ML-DSA)
- 📱 **SIMKey v0.38.0**: iOS eSIM + 5G优化(3-5x) + NFC离线签名 + 多SIM卡切换 + 健康监控 + 量子抗性
- 📡 **Remote Control**: P2P远程控制 + 24+命令处理器 + Chrome扩展
- 🖥️ **Computer Use**: Claude风格电脑操作 + 视觉AI定位 + 工作流引擎 + 68+ IPC通道
- 📞 **P2P语音/视频通话**: WebRTC + DTLS-SRTP端到端加密 + SFU中继 + 2-8人会议室 + 屏幕共享
- 🏘️ **社区与频道**: Gossip协议分发 + 角色权限 + 治理投票引擎 + 社区经济模型
- ⏰ **时光机**: AI生成记忆摘要 + 情感分析 + 历史回放 + 重要时刻提取
- 📺 **去中心化直播**: IPFS视频流 + 弹幕系统 + 打赏机制 + P2P CDN
- 🪙 **社交代币**: ERC-20社交积分 + 创作者经济 + 治理投票
- 🗄️ **IPFS去中心化存储**: Helia/Kubo双引擎 + 内容寻址 + P2P CDN + 自动固定策略
- 🤖 **自治Agent Runner**: ReAct循环 + 目标分解 + 自主任务执行 + 检查点恢复
- ⚖️ **模型量化系统**: GGUF 14种量化级别(Q2_K~F32) + AutoGPTQ Python桥接 + Ollama导入
- 🌍 **i18n国际化**: 4语言(中文/English/日本語/한국어) + 运行时切换 + AI提示词本地化
- 🚀 **性能自动调优**: 实时监控 + 参数自动调整 + 内存预警 + 负载预测
- 🔄 **实时协作(CRDT/Yjs)**: Yjs冲突解决 + P2P实时同步 + 光标共享 + 文档锁
- 📊 **分析仪表板**: 实时数据聚合 + 多维指标 + 可视化报表 + 趋势分析
- 🧬 **EvoMap全球知识共享**: GEP-A2A协议 + Gene/Capsule合成 + 双向同步 + 隐私过滤 + 上下文注入 + 信用经济
- 🧠 **永久记忆系统**: Daily Notes自动记录 + MEMORY.md长期萃取 + 混合搜索(Vector+BM25)
- 🎯 **Context Engineering**: KV-Cache优化 + Token预估 + 可恢复压缩 + 任务上下文管理
- 📋 **Plan Mode**: Claude Code风格计划模式 + 安全分析 + 审批工作流
- 🛡️ **企业级权限**: RBAC权限引擎 + 资源级控制 + 权限继承 + 委托机制
- 🌐 **完全去中心化**: P2P网络(libp2p 3.1.2) + DHT + IPFS + 本地数据存储
- 🌐 **去中心化Agent网络**: W3C DID身份 + Ed25519认证 + VC凭证 + 信誉评分 + 联邦DHT注册表 + 跨组织任务路由
- 🛠️ **自治运维系统**: 异常检测 + 事件管理 + Playbook剧本 + 自动修复 + 回滚 + 部署后监控 + AI事后分析
- 🔧 **开发流水线编排**: 流水线编排 + 6种部署策略 + 审批门控 + 制品管理 + 烟雾测试 + 自动回滚
- 🎭 **多模态协作**: 文本/图像/音频/视频融合 + 文档解析 + 跨模态上下文 + 多格式输出 + 屏幕录制
- 💬 **自然语言编程**: NL→代码管道 + 需求解析 + 项目风格分析 + 代码约定提取
- 🧬 **EvoMap全球知识共享**: GEP-A2A协议 + Gene/Capsule合成 + 双向同步 + 隐私过滤 + 上下文注入 + 信用经济
- 🤖 **Cowork多代理协作**: AI智能编排 + 代理池复用 + 263个IPC接口 + 文件沙箱 + 自进化
- ⚡ **智能工作流优化**: 17项优化(语义缓存+智能决策+关键路径+实时质量+自动化)
- 🔌 **MCP集成**: Model Context Protocol支持,8个服务器 + 安全沙箱 + 社区注册中心
- 🏛️ **企业审计合规**: 统一审计日志 + GDPR/SOC2合规 + 数据主体请求 + 保留策略
- 🛒 **插件市场**: 插件浏览/安装/评分/发布 + 自动更新 + 哈希校验安全
- 🔑 **SSO企业认证**: SAML 2.0 + OAuth 2.0/OIDC + PKCE + DID身份关联
- 🪝 **Hooks系统**: 21种钩子事件 + 4种钩子类型 + 优先级系统 + 脚本钩子
- 🎨 **Skills系统**: 95个内置技能(100% Handler覆盖) + Agent Skills开放标准 + 统一工具注册表 + /skill命令
- 🗂️ **统一工具注册表**: FunctionCaller 60+工具 + MCP 8服务器 + Skills 95技能统一管理
- 🧬 **本能学习**: 自动提取用户模式 + 置信度评分 + 上下文注入 + Hooks观察流水线
- 📦 **演示模板系统**: 10个演示模板 + 4大类别 + 可视化浏览 + 一键运行
- ⛓️ **区块链集成**: 6个智能合约 + HD钱包系统 + LayerZero跨链桥
- 🏢 **企业版**: 多租户组织层级 + RBAC权限 + 知识库协作 + DID邀请链接
- 📱 **跨设备协作**: Git同步 + 桌面-移动端双向同步 + 多设备P2P通信
- 🧪 **全面测试体系**: 2500+测试用例 + 417测试文件 + OWASP安全验证 + DI测试重构
- 🌐 **浏览器自动化**: BrowserEngine + SnapshotEngine + 智能元素定位 + 18个IPC通道
- 📝 **TypeScript支持**: 46个TypeScript Stores + 类型安全 + IDE增强
- 🔓 **开源自主**: 310,000+行代码,370个Vue组件,完全透明可审计

更多特性详见 [功能详解](./docs/FEATURES.md)

## 三大核心功能

### 1️⃣ 知识库管理 (100% 完成) ✅

- ✅ SQLCipher AES-256加密数据库(50+张表)
- ✅ 知识图谱可视化(8算法+5可视化+智能提取)
- ✅ AI增强检索(混合搜索+3种重排序)
- ✅ 多格式导入(Markdown/PDF/Word/TXT/图片)
- ✅ 版本控制(Git集成+冲突解决)

### 2️⃣ 去中心化社交 (100% 完成) ✅

- ✅ DID身份系统(W3C标准+组织DID)
- ✅ P2P网络(libp2p + Signal E2E加密)
- ✅ 社交功能(好友+动态+群聊+文件传输)
- ✅ P2P语音/视频通话(WebRTC + DTLS-SRTP + SFU中继，2-8人)
- ✅ 共享加密相册(E2E加密+EXIF擦除+访问控制)
- ✅ 社区与频道(Gossip协议+角色权限+治理投票)
- ✅ 时光机(AI记忆摘要+情感分析+历史回放)
- ✅ 去中心化直播(IPFS视频流+弹幕+打赏+P2P CDN)
- ✅ 社交代币(ERC-20积分+创作者经济+治理)
- ✅ 匿名模式(ZKP零知识证明+临时DID)

### 3️⃣ 去中心化交易 (100% 完成) ✅

- ✅ 数字资产管理(Token/NFT/知识产品)
- ✅ 智能合约引擎(5种合约类型)
- ✅ 托管服务(4种托管类型)
- ✅ 区块链集成(15链支持+跨链桥)
- ✅ 信用评分系统(6维度评分+5级等级)

### 4️⃣ Cowork多代理协作 + 工作流优化 (100% 完成) ✅

#### Cowork v4.0 去中心化Agent网络 (v1.1.0新增)

- ✅ **去中心化Agent网络** - W3C DID身份 + Ed25519挑战-响应认证 + W3C VC凭证 + 信誉评分(0.0-1.0) + Kademlia DHT联邦注册表 + 4策略跨组织任务路由
- ✅ **自治运维系统** - 异常检测 + 事件分级管理 + Playbook剧本自动执行 + 自动修复 + 一键回滚 + 部署后健康监控 + AI事后分析报告
- ✅ **开发流水线编排** - 流水线完整生命周期 + 6种部署策略 + 审批门控 + 烟雾测试 + 制品管理 + RollbackManager集成
- ✅ **多模态协作** - 文本/图像/音频/视频多模态融合 + 多格式文档解析 + 跨模态上下文 + 多格式输出生成 + 屏幕录制
- ✅ **自然语言编程** - NL→代码转换管道 + 需求结构化解析 + 项目风格自动检测 + 代码约定一致性保障

#### 多代理协作核心

- ✅ 智能编排系统(AI决策+单/多代理任务分配)
- ✅ 代理池复用(10x获取加速+85%开销减少)
- ✅ 文件沙箱(18+敏感文件检测+路径遍历防护)
- ✅ 长时任务管理(智能检查点+恢复机制)
- ✅ 技能系统(4个Office技能+智能匹配)
- ✅ 完整集成(RAG+LLM+错误监控+会话管理)
- ✅ 数据可视化(10+图表类型+实时监控)
- ✅ 企业级安全(5层防护+零信任+全审计)

#### 工作流智能优化 (Phase 1-4, 17项全部完成)

**Phase 1-2 核心优化 (8项)**

- ✅ RAG并行化 - 耗时减少60% (3s→1s)
- ✅ 消息聚合 - 前端性能提升50%
- ✅ 工具缓存 - 重复调用减少15%
- ✅ 文件树懒加载 - 大项目加载快80%
- ✅ LLM降级策略 - 成功率提升50% (60%→90%)
- ✅ 动态并发控制 - CPU利用率提升40%
- ✅ 智能重试策略 - 重试成功率提升183%
- ✅ 质量门禁并行 - 早期错误拦截

**Phase 3-4 智能优化 (9项)**

- ✅ 智能计划缓存 - LLM成本减少70%，命中率60-85%
- ✅ LLM辅助决策 - 多代理利用率提升20%，准确率92%
- ✅ 代理池复用 - 获取速度10x，开销减少85%
- ✅ 关键路径优化 - 执行时间减少15-36% (CPM算法)
- ✅ 实时质量检查 - 问题发现快1800x，返工减少50%
- ✅ 自动阶段转换 - 消除人为错误100%
- ✅ 智能检查点 - IO开销减少30%

**总体提升**: 任务成功率 40%→70% (+75%) | LLM成本 -70% | 执行速度 +25%

详细功能说明见 [功能文档](./docs/FEATURES.md) | [Cowork快速开始](./docs/features/COWORK_QUICK_START.md) | [Phase 3/4总结](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md)

### 5️⃣ 永久记忆系统 (100% 完成) ✅

- ✅ Daily Notes自动记录(memory/daily/YYYY-MM-DD.md)
- ✅ MEMORY.md长期知识萃取(分类存储+自动更新)
- ✅ 混合搜索引擎(Vector语义+BM25关键词双路搜索)
- ✅ RRF融合算法(Reciprocal Rank Fusion智能排序)
- ✅ Embedding缓存(减少重复计算+文件Hash跟踪)
- ✅ 过期自动清理(可配置保留天数)
- ✅ 元数据统计(知识分类、标签、引用跟踪)

详细功能说明见 [永久记忆集成文档](./docs/features/PERMANENT_MEMORY_INTEGRATION.md)

### 6️⃣ 全面测试体系 (100% 完成) ✅

- ✅ **2000+测试用例** - 覆盖所有核心模块（含DI重构后102个数据库测试）
- ✅ **417个测试文件 + 50个脚本测试** - 单元/集成/E2E/性能/安全
- ✅ **依赖注入测试重构** - Browser IPC、数据库模块通过DI提升可测性
- ✅ **OWASP Top 10覆盖80%** - XSS/SQL注入/路径遍历防护验证
- ✅ **性能基准建立** - 142K ops/s项目操作，271K ops/s文件操作
- ✅ **测试覆盖率~80%** - 测试驱动的持续质量提升

详细功能说明见 [Phase 2 测试总结](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md)

### 7️⃣ 企业级权限系统 (100% 完成) ✅

- ✅ **Permission Engine** - 资源级权限评估、条件访问、缓存优化
- ✅ **权限继承** - 父子资源权限自动继承
- ✅ **权限委托** - 临时权限委托、时间范围控制
- ✅ **Team Manager** - 子团队创建、层级结构、成员管理
- ✅ **审批工作流** - 多级审批、自动审批规则
- ✅ **完整审计** - 权限变更全程审计日志

### 8️⃣ Context Engineering (100% 完成) ✅

- ✅ **KV-Cache优化** - 静态/动态内容分离、60-85%命中率
- ✅ **Token预估** - 中英文自动检测、精准Token计算
- ✅ **任务上下文** - 任务目标重述、步骤追踪、进度管理
- ✅ **错误历史** - 错误记录供模型学习、解决方案关联
- ✅ **可恢复压缩** - 保留URL/路径引用、按需恢复内容
- ✅ **17个IPC通道** - 完整前端访问接口

详细功能说明见 [Context Engineering 文档](./docs/MANUS_OPTIMIZATION_GUIDE.md)

### 9️⃣ Plan Mode + Skills 系统 (100% 完成) ✅

- ✅ **Plan Mode** - 安全分析模式、只允许Read/Search/Analyze
- ✅ **计划生成** - 自动记录被阻止操作到计划
- ✅ **审批流程** - 全部/部分审批、拒绝操作
- ✅ **Skills系统** - Markdown技能定义、四层加载机制(bundled→marketplace→managed→workspace)
- ✅ **/skill命令** - 用户命令解析、自动执行
- ✅ **门控检查** - 平台、依赖、环境变量检测
- ✅ **95个内置技能** - 全部配备可执行handler (100%覆盖率)，覆盖18+大类别(含verification-loop、orchestrate、debate-review、ab-compare、stream-processor)
- ✅ **Agent Skills开放标准** - 13个扩展字段(tools/instructions/examples/dependencies等)

详细功能说明见 [Hooks系统设计](./docs/design/HOOKS_SYSTEM_DESIGN.md) | [AI技能系统设计](./docs/design/modules/16_AI技能系统.md)

### 🔟 统一工具注册表 + 演示模板 (100% 完成) ✅

- ✅ **UnifiedToolRegistry** - 聚合FunctionCaller(60+)、MCP(8服务器)、Skills(95技能)三大工具系统
- ✅ **ToolSkillMapper** - 自动将未覆盖工具分组到10个默认技能类别
- ✅ **MCPSkillGenerator** - MCP服务器连接时自动生成技能清单
- ✅ **Name Normalization** - SKILL.md命名(kebab-case) → FunctionCaller命名(snake_case)自动桥接
- ✅ **Tools Explorer** - 按技能分组浏览所有工具，支持搜索/筛选/预览
- ✅ **10个演示模板** - 展示技能组合能力(自动化/AI工作流/知识管理/远程控制)
- ✅ **DemoTemplateLoader** - 自动发现JSON模板，4个IPC处理器
- ✅ **6个统一工具IPC** - tools:get-all-with-skills/get-skill-manifest/get-by-skill/search-unified/get-tool-context/refresh-unified

详细功能说明见 [AI技能系统设计](./docs/design/modules/16_AI技能系统.md)

### 1️⃣1️⃣ 本能学习系统 (100% 完成) ✅

- ✅ **InstinctManager** - 单例管理器，置信度评分模式存储(0.1-0.95范围)
- ✅ **8种类别** - CODING_PATTERN/TOOL_PREFERENCE/WORKFLOW/ERROR_FIX/STYLE/ARCHITECTURE/TESTING/GENERAL
- ✅ **观察流水线** - PostToolUse/PreCompact hooks → 观察缓冲(50条/60秒) → 模式提取
- ✅ **置信度动态** - 成功使用时强化(+5%递减)，失败/闲置时衰减(×0.9)
- ✅ **上下文注入** - 相关本能自动注入LLM提示词(Context Engineering集成)
- ✅ **模式进化** - evolve()聚类高置信度本能，检测工具频率/序列模式
- ✅ **数据可移植** - JSON导出/导入，支持本能共享
- ✅ **11个IPC处理器** - 完整CRUD、强化/衰减、进化、导出/导入、统计

## 🚀 快速开始

### 环境要求

- **Node.js**: 22.12.0+ (推荐使用最新LTS版本)
- **npm**: 10.0.0+
- **Docker**: 20.10+ (可选,用于后端服务)
- **移动端**: Android Studio 2024+ / Xcode 15+ (可选)

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

#### 2. 启动PC端桌面应用

```bash
cd desktop-app-vue
npm install
npm run dev
```

#### 3. 启动后端服务 (可选)

```bash
# 启动Docker服务
docker-compose up -d

# 下载LLM模型
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

更多详细说明见 [开发指南](./docs/DEVELOPMENT.md)

## 📥 下载安装

### 下载地址

- **GitHub Releases**: [最新版本](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (国内加速): [Gitee发布页](https://gitee.com/chainlesschaincn/chainlesschain/releases)

### 支持平台

- **Windows**: Windows 10/11 (64位) - 便携版,无需安装
- **macOS**: Intel芯片 (x64) - 拖拽安装到应用程序文件夹
- **Linux**: Ubuntu/Debian/Fedora/Arch - ZIP便携版 + DEB安装包

详细安装说明见 [安装指南](./docs/INSTALLATION.md)

## 📁 项目结构

```
chainlesschain/
├── desktop-app-vue/          # PC端桌面应用 (Electron 39.2.7 + Vue3.4)
│   ├── src/
│   │   ├── main/             # 主进程
│   │   │   ├── api/          # IPC API处理器
│   │   │   ├── config/       # 配置管理
│   │   │   ├── database/     # 数据库操作
│   │   │   ├── llm/          # LLM集成 (16个AI引擎)
│   │   │   │   ├── permanent-memory-manager.js  # 永久记忆管理器
│   │   │   │   ├── permanent-memory-ipc.js      # 永久记忆IPC通道
│   │   │   │   ├── context-engineering.js       # KV-Cache优化核心 + 本能注入
│   │   │   │   ├── context-engineering-ipc.js   # Context Engineering IPC (17通道)
│   │   │   │   ├── instinct-manager.js          # 本能学习系统 (v0.39.0)
│   │   │   │   └── instinct-ipc.js              # 本能IPC (11通道)
│   │   │   ├── rag/          # RAG检索系统
│   │   │   │   ├── bm25-search.js         # BM25全文搜索引擎
│   │   │   │   └── hybrid-search-engine.js # 混合搜索引擎
│   │   │   ├── permission/   # 企业级权限系统 (新)
│   │   │   │   ├── permission-engine.js        # RBAC权限引擎
│   │   │   │   ├── team-manager.js             # 团队管理
│   │   │   │   ├── delegation-manager.js       # 权限委托
│   │   │   │   └── approval-workflow-manager.js # 审批工作流
│   │   │   ├── task/         # 任务管理 (新)
│   │   │   │   └── team-report-manager.js      # 团队日报/周报
│   │   │   ├── hooks/        # Hooks系统 (Claude Code风格)
│   │   │   │   ├── index.js               # 主入口
│   │   │   │   ├── hook-registry.js       # 钩子注册表
│   │   │   │   └── hook-executor.js       # 钩子执行器
│   │   │   ├── did/          # DID身份系统
│   │   │   ├── p2p/          # P2P网络 (libp2p + WebRTC语音/视频通话)
│   │   │   │   └── __tests__/ # P2P通话单元测试 (call-manager + call-signaling)
│   │   │   ├── social/       # 社交功能 (社区/频道/时光机/相册/代币/直播)
│   │   │   │   └── __tests__/ # 社交功能单元测试 (7个测试文件)
│   │   │   ├── ipfs/         # IPFS去中心化存储 (Helia/Kubo)
│   │   │   ├── collaboration/ # 实时协作 (Yjs CRDT/P2P同步)
│   │   │   ├── analytics/    # 分析仪表板 (实时聚合/多维指标)
│   │   │   ├── i18n/         # 国际化 (4语言/运行时切换)
│   │   │   ├── performance/  # 性能监控+自动调优
│   │   │   ├── quantization/ # 模型量化 (GGUF+GPTQ)
│   │   │   │   ├── quantization-manager.js # 量化任务管理器
│   │   │   │   ├── gguf-quantizer.js       # GGUF量化 (14级)
│   │   │   │   └── gptq-quantizer.js       # AutoGPTQ量化
│   │   │   ├── enterprise/   # 企业组织管理 (多租户/审批工作流)
│   │   │   ├── mcp/          # MCP集成
│   │   │   ├── remote/       # 远程控制系统 (新, 41文件, ~45,000行)
│   │   │   │   ├── remote-gateway.js         # 远程网关 (核心)
│   │   │   │   ├── p2p-command-adapter.js    # P2P命令适配器
│   │   │   │   ├── permission-gate.js        # 权限验证器
│   │   │   │   ├── command-router.js         # 命令路由器
│   │   │   │   ├── handlers/                 # 24+命令处理器
│   │   │   │   ├── browser-extension/        # Chrome浏览器扩展
│   │   │   │   ├── workflow/                 # 工作流引擎
│   │   │   │   └── logging/                  # 日志系统
│   │   │   ├── browser/      # 浏览器自动化控制
│   │   │   │   ├── browser-engine.js         # 浏览器引擎 (Playwright)
│   │   │   │   ├── browser-ipc.js            # 浏览器 IPC (12通道)
│   │   │   │   ├── snapshot-engine.js        # 智能快照引擎
│   │   │   │   ├── snapshot-ipc.js           # 快照 IPC (6通道)
│   │   │   │   └── element-locator.js        # 元素定位器
│   │   │   ├── ai-engine/    # AI引擎 + 工作流优化
│   │   │   │   ├── unified-tool-registry.js     # 统一工具注册表 (3大系统)
│   │   │   │   ├── tool-skill-mapper.js         # 工具-技能自动映射
│   │   │   │   ├── unified-tools-ipc.js         # 统一工具 IPC (6通道)
│   │   │   │   ├── autonomous/                  # 自治Agent Runner (ReAct循环)
│   │   │   │   │   └── autonomous-agent-runner.js
│   │   │   │   ├── cowork/   # Cowork多代理协作系统 (v2.1.0, 166个IPC处理器)
│   │   │   │   │   └── skills/               # Skills系统
│   │   │   │   │       ├── index.js          # 技能加载器 (4层)
│   │   │   │   │       ├── skills-ipc.js     # Skills IPC (17通道)
│   │   │   │   │       ├── skill-md-parser.js # Agent Skills标准解析器
│   │   │   │   │       ├── markdown-skill.js  # Markdown技能实现
│   │   │   │   │       └── builtin/          # 95个内置技能 (100% Handler)
│   │   │   │   ├── plan-mode/                # Plan Mode系统 (Claude Code风格)
│   │   │   │   │   ├── index.js              # PlanModeManager
│   │   │   │   │   └── plan-mode-ipc.js      # Plan Mode IPC (14通道)
│   │   │   │   ├── smart-plan-cache.js           # 智能计划缓存
│   │   │   │   ├── llm-decision-engine.js        # LLM决策引擎
│   │   │   │   ├── critical-path-optimizer.js    # 关键路径优化
│   │   │   │   ├── real-time-quality-gate.js     # 实时质量检查
│   │   │   │   ├── task-executor.js              # 任务执行器
│   │   │   │   └── task-planner-enhanced.js      # 增强型任务规划器
│   │   │   ├── templates/    # 演示模板系统 (v0.35.0)
│   │   │   │   ├── demo-template-loader.js      # 模板发现和加载
│   │   │   │   ├── automation/                  # 自动化模板 (3个)
│   │   │   │   ├── ai-workflow/                 # AI工作流模板 (3个)
│   │   │   │   ├── knowledge/                   # 知识管理模板 (2个)
│   │   │   │   └── remote/                      # 远程控制模板 (2个)
│   │   │   └── monitoring/   # 监控和日志
│   │   └── renderer/         # 渲染进程 (Vue3 + TypeScript, 46 Pinia Stores)
│   ├── contracts/            # 智能合约 (Hardhat + Solidity)
│   └── tests/                # 测试套件 (2500+测试用例, 417+测试文件)
│       ├── unit/             # 单元测试 (IPC处理器、数据库、Git、浏览器、AI引擎)
│       ├── integration/      # 集成测试 (后端集成、用户旅程)
│       ├── performance/      # 性能测试 (负载、内存泄漏)
│       └── security/         # 安全测试 (OWASP Top 10)
├── backend/
│   ├── project-service/      # Spring Boot 3.1.11 (Java 17)
│   └── ai-service/           # FastAPI + Ollama + Qdrant
├── community-forum/          # 社区论坛 (Spring Boot + Vue3)
├── mobile-app-uniapp/        # 移动端应用 (100%完成)
└── docs/                     # 完整文档系统
    ├── features/             # 功能文档
    ├── flows/                # 工作流程文档 (新增)
    ├── implementation-reports/  # 实现报告 (新增)
    ├── status-reports/       # 状态报告 (新增)
    ├── test-reports/         # 测试报告 (新增)
    └── ...                   # 20+个文档分类
```

详细结构说明见 [架构文档](./docs/ARCHITECTURE.md)

## 🛠️ 技术栈

### PC端

- Electron 39.2.7 + Vue 3.4 + TypeScript 5.9 + Ant Design Vue 4.1
- SQLite/SQLCipher (AES-256) + libp2p 3.1.2 + IPFS (Helia/Kubo)
- 16个专用AI引擎 + 17项智能优化 + 95个内置技能 + 300个工具 + 后量子密码学
- 永久记忆: Daily Notes + MEMORY.md + 混合搜索(Vector+BM25)
- Context Engineering: KV-Cache优化 + Token预估 + 可恢复压缩
- 企业权限: RBAC引擎 + 团队管理 + 审批工作流 + 权限委托 + 企业组织管理
- 远程控制: P2P网关 + 24+命令处理器 + Chrome扩展 + 工作流引擎
- 浏览器控制: BrowserEngine + SnapshotEngine + DI可测性 + 18 IPC通道
- Claude Code风格: 10子系统 + 238 IPC通道 (Hooks/Plan Mode/Skills/Evolution/去中心化Agent网络/自治运维等)
- AI技能系统: 95内置技能(100% Handler) + 28 Android技能 + 统一工具注册表 + 10演示模板 + 本能学习
- 实时协作: Yjs CRDT + P2P同步 + 光标共享 + 文档锁
- 去中心化社交: P2P通话(WebRTC+DTLS-SRTP) + 社区频道(Gossip) + 时光机 + 直播 + 社交代币
- 模型量化: GGUF 14级量化 + AutoGPTQ Python桥接 + Ollama集成
- i18n国际化: 4语言支持 + 运行时切换
- 性能自动调优: 实时监控 + 参数自动调整 + 负载预测
- 自治Agent Runner: ReAct循环 + 目标分解 + 自主任务执行
- 分析仪表板: 实时聚合 + 多维指标 + 可视化报表
- 测试框架: Vitest + 2500+测试用例 + 417+测试文件 + DI重构

### 后端

- Spring Boot 3.1.11 + Java 17 + MyBatis Plus 3.5.9
- FastAPI + Python 3.9+ + Ollama + Qdrant

### 区块链

- Solidity 0.8+ + Hardhat 2.28 + Ethers.js v6.13
- 支持15条区块链(以太坊/Polygon/BSC/Arbitrum等)

详细技术栈见 [技术文档](./docs/ARCHITECTURE.md#技术栈)

## 🗓️ 开发路线图

### 已完成 ✅

- [x] Phase 1: 知识库管理 (100%)
- [x] Phase 2: 去中心化社交 (100%)
- [x] Phase 3: 去中心化交易 (100%)
- [x] Phase 4: 区块链集成 (100%)
- [x] Phase 5: 生态完善 (100%)

- [x] Phase 6: 生产优化 (100%)
  - [x] 完整区块链适配器
  - [x] 生产级跨链桥 (LayerZero)
  - [x] 全面测试覆盖 (2000+用例, 417测试文件)
  - [x] 性能优化和监控
  - [x] 安全审计
  - [x] 文档完善

### 已完成的优化 ✅

- [x] **EvoMap全球Agent知识共享网络 (Phase 41)**: GEP-A2A协议 + Gene/Capsule合成 + 双向同步 + 隐私过滤 + 上下文注入 ✅ v1.1.0-alpha
- [x] **Social AI + ActivityPub (Phase 42)**: 主题分析 + 社交图谱 + ActivityPub S2S + WebFinger + AI助手 + 18 IPC ✅ v1.1.0-alpha
- [x] **Compliance + Data Classification (Phase 43)**: SOC2合规 + 数据分类 + DSR处理 + 合规管理 + 12 IPC ✅ v1.1.0-alpha
- [x] **SCIM 2.0 Enterprise Provisioning (Phase 44)**: SCIM服务器 + IdP同步 + 冲突解决 + 8 IPC ✅ v1.1.0-alpha
- [x] **Unified Key + FIDO2 + USB (Phase 45)**: BIP-32密钥 + WebAuthn + 跨平台USB + 8 IPC ✅ v1.1.0-alpha
- [x] **Cowork去中心化Agent网络**: W3C DID身份 + Ed25519认证 + VC凭证 + 信誉评分 + 联邦DHT注册表 + 跨组织路由 ✅ v1.1.0
- [x] **自治运维系统**: 异常检测 + 事件管理 + Playbook + 自动修复 + 回滚 + 部署后监控 + AI事后分析 ✅ v1.1.0
- [x] **开发流水线编排**: 流水线管理 + 6种部署策略 + 审批门控 + 烟雾测试 + 规范翻译 ✅ v1.1.0
- [x] **多模态协作**: 多模态融合 + 文档解析 + 跨模态上下文 + 多格式输出 + 屏幕录制 ✅ v1.1.0
- [x] **自然语言编程**: NL→代码管道 + 需求解析 + 项目风格分析 ✅ v1.1.0
- [x] **去中心化社交平台全面升级**: P2P语音/视频通话 + 共享相册 + 社区频道 + 时光机 + 直播 + 社交代币 ✅ v1.0.0
- [x] **企业级基础设施**: IPFS存储 + 实时协作(CRDT/Yjs) + 分析仪表板 + 自治Agent Runner + 企业组织管理 ✅ v1.0.0
- [x] **模型量化系统**: GGUF 14级量化 + AutoGPTQ + Ollama集成 ✅ v1.0.0
- [x] **i18n国际化**: 4语言支持(中/英/日/韩) + 运行时切换 ✅ v1.0.0
- [x] **性能自动调优**: 实时监控 + 参数自动调整 + 负载预测 ✅ v1.0.0
- [x] **TypeScript Stores扩展**: 46个Stores完整覆盖 ✅ v1.0.0
- [x] **SIMKey六大安全增强**: iOS eSIM + 5G优化 + NFC离线签名 + 多SIM卡切换 + 健康监控 + 量子抗性算法 ✅ v0.38.0
- [x] **everything-claude-code模式**: Verification Loop + Orchestrate Workflow + Instinct Learning System ✅ v0.39.0
- [x] **AI技能系统**: 95内置技能(100% Handler) + 28 Android技能 + 统一工具注册表 + Agent Skills标准 ✅ v1.0.0
- [x] **扩展MCP服务器支持**: MCP SDK (Server Builder + HTTP+SSE + Stdio) + 社区注册中心 ✅ v0.34.0
- [x] **增强多代理协作**: 8种专业化代理模板 + 任务编排引擎 + 5个内置技能 ✅ v0.34.0
- [x] **社区生态**: 插件市场(22 IPC) + 社区MCP服务器发现/安装 ✅ v0.34.0
- [x] **企业高级功能**: SSO(SAML/OAuth/OIDC) + 审计日志(18 IPC) + 合规管理 ✅ v0.34.0

详细路线图见 [开发计划](./docs/DEVELOPMENT.md#开发路线图)

## 🤝 贡献指南

我们欢迎所有形式的贡献!

1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

详见 [贡献指南](./docs/DEVELOPMENT.md#贡献指南)

## 📜 许可证

本项目采用 **MIT License** 开源许可证 - 详见 [LICENSE](./LICENSE)

## 📞 联系我们

- **Email**: zhanglongfa@chainlesschain.com
- **安全报告**: security@chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

## 🙏 致谢

感谢以下开源项目: Electron, Vue.js, Spring Boot, Ollama, Qdrant, libp2p, Signal Protocol

---

**更多文档**:

- [📖 文档中心](./docs/README.md) - 完整文档导航和索引
- [✨ 功能详解](./docs/FEATURES.md) - 详细功能列表和说明
- [📥 安装指南](./docs/INSTALLATION.md) - 各平台详细安装步骤
- [🏗️ 架构文档](./docs/ARCHITECTURE.md) - 技术架构和项目结构
- [💻 开发指南](./docs/DEVELOPMENT.md) - 开发环境搭建和贡献规范
- [📝 版本历史](./docs/CHANGELOG.md) - 完整版本更新记录
- [⛓️ 区块链文档](./docs/BLOCKCHAIN.md) - 区块链集成和跨链桥
- [🔧 API参考](./docs/API_REFERENCE.md) - API接口文档
- [📚 用户手册](./docs/USER_MANUAL_COMPLETE.md) - 完整用户使用手册

**永久记忆与测试文档**:

- [🧠 永久记忆集成](./docs/features/PERMANENT_MEMORY_INTEGRATION.md) - Daily Notes + MEMORY.md + 混合搜索
- [🧪 Phase 2 测试总结](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md) - 233测试用例，99.6%通过率
- [🔒 安全测试报告](./docs/reports/phase2/PHASE2_TASK13_SECURITY_TESTS.md) - OWASP Top 10覆盖80%
- [📊 IPC处理器测试](./docs/reports/phase2/PHASE2_TASK7_IPC_HANDLERS_TESTS.md) - 66个IPC处理器测试
- [💾 数据库边界测试](./docs/reports/phase2/PHASE2_TASK8_DATABASE_TESTS.md) - 14个边界条件测试

**工作流优化文档**:

- [🚀 Phase 3/4 完成总结](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md) - 17项优化总览
- [💡 智能计划缓存](./docs/features/PHASE3_OPTIMIZATION3_SMART_PLAN_CACHE.md) - 语义相似度缓存
- [🧠 LLM辅助决策](./docs/features/PHASE3_OPTIMIZATION4_LLM_DECISION.md) - 智能多代理决策
- [⚡ 关键路径优化](./docs/features/PHASE3_OPTIMIZATION8_CRITICAL_PATH.md) - CPM算法调度
- [🔍 实时质量检查](./docs/features/PHASE3_OPTIMIZATION11_REALTIME_QUALITY.md) - 文件监控系统

**企业级功能文档**:

- [🛡️ Permission Engine](./desktop-app-vue/src/main/permission/) - RBAC权限引擎源码
- [👥 Team Manager](./desktop-app-vue/src/main/permission/team-manager.js) - 团队管理
- [📋 Team Reports](./desktop-app-vue/src/main/task/team-report-manager.js) - 日报周报系统
- [🎯 Context Engineering](./desktop-app-vue/src/main/llm/context-engineering-ipc.js) - KV-Cache优化IPC
- [🪝 Hooks系统](./docs/design/HOOKS_SYSTEM_DESIGN.md) - Claude Code风格钩子系统
- [📋 Plan Mode](./desktop-app-vue/src/main/ai-engine/plan-mode/) - 计划模式系统
- [📡 远程控制系统](./desktop-app-vue/src/main/remote/) - P2P远程网关 + 24+命令处理器 + Chrome扩展
- [🌐 浏览器控制](./desktop-app-vue/src/main/browser/) - BrowserEngine + SnapshotEngine

**AI技能与工具文档**:

- [🎨 AI技能系统设计](./docs/design/modules/16_AI技能系统.md) - 92内置技能(100% Handler) + 统一工具注册表 + 演示模板
- [🧬 本能学习系统](./desktop-app-vue/src/main/llm/instinct-manager.js) - 自动模式提取 + 置信度评分 + 上下文注入
- [🗂️ 统一工具注册表](./desktop-app-vue/src/main/ai-engine/unified-tool-registry.js) - 3大工具系统聚合
- [📦 演示模板系统](./desktop-app-vue/src/main/templates/demo-template-loader.js) - 10个演示模板加载器
- [🔧 工具浏览器](./desktop-app-vue/src/renderer/pages/ToolsExplorerPage.vue) - 按技能分组浏览工具
