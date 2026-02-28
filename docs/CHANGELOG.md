# ChainlessChain 版本历史

本文档记录 ChainlessChain 的所有版本更新和变更。

## 版本说明

- **主版本号**: 重大架构变更或不兼容更新
- **次版本号**: 新功能添加
- **修订版本号**: Bug修复和小改进

---

## 最新版本

### v1.1.0-alpha (2026-02-28) ⭐ 当前版本

**企业版 Phase 2-3 (Q3-Q4 2026) - Phases 46-56** - 门限签名、BLE、内容推荐、Nostr、DLP、SIEM、PQC、固件OTA、AI治理、Matrix、Terraform

#### Phase 46 - 门限签名 + 生物识别 (Threshold Signatures + Biometric)

**核心功能**:

- Shamir 秘密分享（2-of-3, 3-of-5, 5-of-7 阈值方案）
- 密钥分片生成、分发、重组
- TEE 生物识别模板哈希绑定（SHA-256）
- 用户验证（UV）和用户在场（UP）标志

**实现文件**:

- `ukey/threshold-signature-manager.js` - 门限签名管理器
- `ukey/biometric-binding.js` - 生物识别绑定
- Extended `ukey-ipc.js` (17→25 handlers)
- `stores/thresholdSecurity.ts` - Pinia状态管理
- `pages/security/ThresholdSecurityPage.vue` - 门限安全控制台

**数据库**:

- `threshold_key_shares` - 密钥分片存储
- `biometric_bindings` - 生物识别绑定记录

#### Phase 47 - BLE U-Key (蓝牙U盾)

**核心功能**:

- BLE GATT 设备发现和连接
- 自动重连机制
- 跨平台蓝牙传输（Windows/macOS/Linux）
- U-Key 多传输选择（USB/BLE）

**实现文件**:

- Extended `ukey/ble-driver.js` - BLE传输驱动
- Extended `ukey/driver-registry.js` - 传输状态管理
- `stores/bleUkey.ts` - Pinia状态管理
- `pages/security/BLEDevicesPage.vue` - BLE设备管理

#### Phase 48 - 内容推荐系统 (Content Recommendation)

**核心功能**:

- 本地智能推荐引擎（TF-IDF + 协同过滤）
- 用户兴趣画像构建和衰减
- 多维度推荐：基于内容、社交关系、热度
- 推荐反馈循环优化

**实现文件**:

- `social/local-recommender.js` - 本地推荐引擎
- `social/interest-profiler.js` - 兴趣画像管理
- `social/recommendation-ipc.js` - 6个IPC处理器
- `stores/recommendation.ts` - Pinia状态管理
- `pages/social/RecommendationsPage.vue` - 推荐页面

**数据库**:

- `user_interest_profiles` - 用户兴趣画像
- `content_recommendations` - 推荐记录

#### Phase 49 - Nostr 协议桥接 (Nostr Bridge)

**核心功能**:

- Nostr NIP-01 事件发布和订阅
- 多中继管理（连接/断开/状态监控）
- ChainlessChain DID ↔ Nostr npub 映射
- 签名验证（Schnorr secp256k1）

**实现文件**:

- `social/nostr-bridge.js` - Nostr桥接器
- `social/nostr-identity.js` - Nostr身份管理
- `social/nostr-bridge-ipc.js` - 6个IPC处理器
- `stores/nostrBridge.ts` - Pinia状态管理
- `pages/social/NostrBridgePage.vue` - Nostr控制台

**数据库**:

- `nostr_relays` - 中继服务器配置
- `nostr_events` - Nostr事件存储

#### Phase 50 - 数据防泄漏 (DLP)

**核心功能**:

- 策略驱动的数据扫描（正则 + 关键词 + 文件类型）
- 多通道防护（邮件/聊天/文件传输/剪贴板/导出）
- 4种响应动作：允许/告警/阻止/隔离
- 事件记录和统计分析

**实现文件**:

- `audit/dlp-engine.js` - DLP扫描引擎
- `audit/dlp-policy.js` - 策略管理器
- `audit/dlp-ipc.js` - 8个IPC处理器
- `stores/dlp.ts` - Pinia状态管理
- `pages/enterprise/DLPPoliciesPage.vue` - DLP策略管理

**数据库**:

- `dlp_policies` - DLP策略配置
- `dlp_incidents` - 安全事件记录

#### Phase 51 - SIEM 集成 (SIEM Integration)

**核心功能**:

- 多格式日志导出：CEF、LEEF、JSON
- 多目标支持：Splunk、Elasticsearch、Azure Sentinel
- 批量导出和定时调度
- 导出历史和统计

**实现文件**:

- `audit/siem-exporter.js` - SIEM导出器
- `audit/siem-ipc.js` - 4个IPC处理器
- `stores/siem.ts` - Pinia状态管理
- `pages/enterprise/SIEMIntegrationPage.vue` - SIEM集成控制台

**数据库**:

- `siem_exports` - 导出记录

#### Phase 52 - 量子后加密迁移 (PQC Migration) — Phase 3 开始

**核心功能**:

- ML-KEM (Module-Lattice-Based Key Encapsulation Mechanism) 密钥生成
- ML-DSA (Module-Lattice-Based Digital Signature Algorithm) 签名
- 混合模式：传统算法 + 后量子算法
- 自动化迁移执行和进度追踪

**实现文件**:

- `ukey/pqc-migration-manager.js` - PQC密钥生成、迁移管理
- `ukey/pqc-ipc.js` - 4个IPC处理器
- `stores/pqcMigration.ts` - Pinia状态管理
- `pages/security/PQCMigrationPage.vue` - 迁移控制台

**数据库**:

- `pqc_keys` - PQC密钥存储
- `pqc_migration_status` - 迁移状态跟踪

#### Phase 53 - 固件OTA更新 (Firmware OTA)

**核心功能**:

- U-Key固件版本检查和更新
- 安全下载、验证（签名校验）、安装
- 自动回滚机制
- 版本历史和更新日志

**实现文件**:

- `ukey/firmware-ota-manager.js` - OTA更新管理器
- `ukey/firmware-ota-ipc.js` - 4个IPC处理器
- `stores/firmwareOta.ts` - Pinia状态管理
- `pages/security/FirmwareOTAPage.vue` - OTA管理界面

**数据库**:

- `firmware_versions` - 固件版本信息
- `firmware_update_log` - 更新历史记录

#### Phase 54 - AI社区治理 (AI Community Governance)

**核心功能**:

- 提案创建、编辑、删除（CRUD）
- AI影响分析（技术、经济、社会维度）
- 投票预测（基于历史投票模式）
- 治理流程自动化

**实现文件**:

- `social/governance-ai.js` - AI治理引擎
- `social/governance-ipc.js` - 4个IPC处理器
- `stores/governance.ts` - Pinia状态管理
- `pages/social/GovernancePage.vue` - 治理控制台

**数据库**:

- `governance_proposals` - 提案存储
- `governance_votes` - 投票记录

#### Phase 55 - Matrix协议集成 (Matrix Integration)

**核心功能**:

- Matrix Client-Server API 登录和会话管理
- 房间创建、加入、消息收发
- E2EE加密消息（Olm/Megolm）
- DID与Matrix ID映射

**实现文件**:

- `social/matrix-bridge.js` - Matrix桥接器
- `social/matrix-ipc.js` - 5个IPC处理器
- `stores/matrixBridge.ts` - Pinia状态管理
- `pages/social/MatrixBridgePage.vue` - Matrix控制台

**数据库**:

- `matrix_rooms` - 房间信息
- `matrix_events` - 消息事件存储

#### Phase 56 - Terraform提供商 (Terraform Provider)

**核心功能**:

- Terraform工作区（Workspace）创建和管理
- Plan/Apply/Destroy运行执行
- 状态（State）文件管理和锁定
- 基础设施即代码（IaC）集成

**实现文件**:

- `enterprise/terraform-manager.js` - Terraform管理器
- `enterprise/terraform-ipc.js` - 4个IPC处理器
- `stores/terraform.ts` - Pinia状态管理
- `pages/enterprise/TerraformProviderPage.vue` - Terraform控制台

**数据库**:

- `terraform_workspaces` - 工作区配置
- `terraform_runs` - 运行历史

#### 配置更新

新增/扩展配置节（Phase 46-56）：

- `thresholdSecurity` - 门限签名参数
- `unifiedKey` (扩展 BLE) - 蓝牙传输配置
- `socialAI` (扩展 recommendation) - 推荐引擎参数
- `nostr` - Nostr中继配置
- `compliance` (扩展 DLP+SIEM) - 合规扩展
- `pqc` - 量子后加密设置
- `firmwareOta` - 固件OTA配置
- `governance` - 治理AI参数
- `matrix` - Matrix服务器配置
- `terraform` - Terraform集成配置

#### Context Engineering

新增Setter方法：

- `setThresholdManager()` - 注入门限签名管理器
- `setDLPEngine()` - 注入DLP引擎
- `setPQCManager()` - 注入PQC迁移管理器
- `setGovernanceAI()` - 注入治理AI引擎

#### IPC注册

- Phase 46: 8个门限签名+生物识别处理器（via ukey-ipc.js）
- Phase 47: 4个BLE处理器（via ukey-ipc.js）
- Phase 48: 6个内容推荐处理器
- Phase 49: 6个Nostr桥接处理器
- Phase 50: 8个DLP处理器
- Phase 51: 4个SIEM处理器
- Phase 52: 4个PQC IPC处理器
- Phase 53: 4个固件OTA IPC处理器
- Phase 54: 4个治理AI IPC处理器
- Phase 55: 5个Matrix IPC处理器
- Phase 56: 4个Terraform IPC处理器

**总计**: 57个新IPC处理器（Phase 46-56）

#### 路由更新

新增路由（Phase 46-56）：

- `/threshold-security` - 门限签名安全
- `/ble-devices` - BLE设备管理
- `/recommendations` - 内容推荐
- `/nostr-bridge` - Nostr桥接
- `/dlp-policies` - DLP策略
- `/siem-integration` - SIEM集成
- `/pqc-migration` - 量子后加密迁移
- `/firmware-ota` - 固件OTA更新
- `/governance` - AI社区治理
- `/matrix-bridge` - Matrix集成
- `/terraform-provider` - Terraform提供商

#### 数据库更新

新增19张表（Phase 46-56），详见 [架构文档](./ARCHITECTURE.md#数据库设计)

---

### v0.37.6 (2026-02-17)

**系统+安全+设计+分析技能** - 桌面端新增 10 个日常技能，总计 90 个内置技能（100% Handler 覆盖）

#### 新增 10 个桌面技能 v0.37.6 (总计 90 个，Handler 覆盖 90/90)

##### 系统管理 (2 个)

- ✅ **backup-manager** (~340行) - 数据备份：ZIP创建(archiver)/恢复(adm-zip)/列表/信息/清理/定时备份建议
- ✅ **performance-profiler** (~280行) - 性能分析：进程快照/命令基准测试/内存增长分析/启动时间/V8堆统计/报告

##### 知识管理 (2 个)

- ✅ **query-enhancer** (~260行) - RAG查询优化：多查询展开/HyDE假设文档/查询分解/同义词扩展/意图分析
- ✅ **memory-insights** (~240行) - 知识库分析：文件统计/健康评分(0-100)/关键词提取/活动趋势/知识空白检测

##### 安全工具 (2 个)

- ✅ **crypto-toolkit** (~540行) - 加密工具：SHA256/MD5哈希/HMAC/AES-256-GCM加解密/Base64+URL+Hex编解码/UUID/随机数
- ✅ **password-generator** (~620行) - 密码生成：随机密码/记忆口令(280词库)/PIN码/API Token/UUID/强度检测/批量生成

##### 数据+网络 (2 个)

- ✅ **data-exporter** (~540行) - 数据导出：JSON↔CSV↔TSV↔Markdown↔HTML转换/格式检测/批量转换
- ✅ **network-diagnostics** (~235行) - 网络诊断：Ping/DNS查询(A/MX/TXT等)/TCP端口检测/端口扫描/Traceroute/HTTP检查

##### 设计+工具 (2 个)

- ✅ **color-picker** (~790行) - 颜色工具：HEX↔RGB↔HSL转换/调色板生成(互补/类似/三色)/WCAG对比度/明暗调节/混色/148 CSS命名色
- ✅ **text-transformer** (~225行) - 文本转换：Base64/URL/HTML编解码/哈希/大小写转换/camelCase/snake_case/kebab-case/Slug

#### 测试更新

- ✅ **skill-handlers.test.js**: 新增 ~34 个测试用例，SkillLoader 验证 80→90，总计 250 测试全部通过

---

### v0.37.5 (2026-02-17)

**开发效率+系统工具技能** - 桌面端新增 10 个日常技能，总计 80 个内置技能（100% Handler 覆盖）

#### 新增 10 个桌面技能 v0.37.5 (总计 80 个，Handler 覆盖 80/80)

##### 开发效率 (5 个)

- ✅ **json-yaml-toolkit** (~300行) - JSON/YAML处理：格式化/压缩/验证/JSON↔YAML转换/JSONPath查询/Diff对比/Schema生成
- ✅ **regex-playground** (~270行) - 正则表达式工具：测试匹配/替换/模式解释/12+常用模式库/文件内容提取
- ✅ **http-client** (~280行) - HTTP客户端：GET/POST/PUT/DELETE/PATCH/HEAD/自定义请求头/Bearer+Basic+API Key认证
- ✅ **snippet-library** (~250行) - 代码片段库：保存/搜索/列表/删除/导出导入/标签分类/.chainlesschain/snippets.json
- ✅ **markdown-enhancer** (~280行) - Markdown增强：TOC生成/字数统计/链接检查/Lint/表格格式化/HTML转换(marked)

##### 系统运维 (3 个)

- ✅ **log-analyzer** (~290行) - 日志分析：多格式解析/按级别时间过滤/错误提取/统计报告/模式搜索/尾部追踪
- ✅ **system-monitor** (~260行) - 系统监控：Node.js os模块/CPU使用率/内存/磁盘/进程列表/网络接口/健康评分
- ✅ **env-file-manager** (~250行) - 环境变量管理：.env解析/多环境对比/缺失检测/模板生成/.example生成/安全检查

##### 知识+工具 (2 个)

- ✅ **knowledge-graph** (~300行) - 知识图谱：NLP实体提取/关系发现/中心性分析/PageRank/DOT+JSON导出/统计
- ✅ **clipboard-manager** (~240行) - 剪贴板管理：读写/历史追踪(100条)/搜索/置顶/敏感内容自动过滤/统计

#### 测试更新

- ✅ **skill-handlers.test.js**: 新增 ~28 个测试用例，SkillLoader 验证 70→90，总计 216 测试全部通过

#### 技术亮点

- **零新增依赖**: 全部使用 Node.js 内置模块 (os, fs, path, child_process, http/https) + 已有 npm 包 (js-yaml, marked)
- **Agent Skills 开放标准兼容**: 所有技能含完整 YAML frontmatter (tools, instructions, examples, input-schema)
- **GitHub/OpenClaw 研究驱动**: 参考 VoltAgent/awesome-agent-skills (380+)、OpenClaw/ClawHub (5,700+)、Composio (850+) 选定实用技能

---

### v0.37.4 (2026-02-17)

**图像+数据+工具技能** - 桌面端新增 10 个日常技能，总计 70 个内置技能（100% Handler 覆盖）

#### 新增 10 个桌面技能 v0.37.4 (总计 70 个，Handler 覆盖 70/70)

##### 图像处理 (3 个)

- ✅ **image-editor** (~280行) - 图片编辑：缩放/压缩/格式转换(Sharp)/缩略图/旋转/裁剪/信息提取
- ✅ **ocr-scanner** (~240行) - OCR文字识别：Tesseract.js多语言(中英日韩法德)/批量识别/置信度评分
- ✅ **image-generator** (~260行) - AI图像生成：Stable Diffusion/DALL-E/图片增强(锐化/降噪/放大)/预设尺寸

##### 数据处理 (2 个)

- ✅ **chart-creator** (~280行) - 数据可视化：ECharts配置生成(折线/柱状/饼图/散点/雷达/漏斗)/CSV数据源/4种主题
- ✅ **csv-processor** (~300行) - CSV数据处理：读取/统计分析/条件过滤/排序/格式转换(CSV↔JSON↔TSV)/合并

##### 开发工具 (3 个)

- ✅ **word-generator** (~260行) - Word文档生成：Markdown→DOCX(docx库)/模板创建/mammoth读取/格式化
- ✅ **template-renderer** (~240行) - 模板渲染：Handlebars变量替换/条件循环/自定义Helper/变量提取/批量生成
- ✅ **code-runner** (~250行) - 安全代码执行：Python/JavaScript/Bash/30s超时/输出捕获/退出码

##### 自动化+工具 (2 个)

- ✅ **voice-commander** (~230行) - 语音命令管理：32+命令注册/宏定义(命令序列)/命令测试/历史/5类别
- ✅ **file-compressor** (~260行) - 文件压缩解压：ZIP创建(adm-zip)/解压/文件列表/压缩率分析/目录压缩

#### 测试更新

- ✅ **skill-handlers.test.js**: 新增 ~31 个测试用例，SkillLoader 验证 60→70，总计 188 测试全部通过

#### 技术亮点

- **零新增依赖**: 全部复用已有 npm 包 (sharp, tesseract.js, adm-zip, handlebars, docx, mammoth, axios)
- **深度复用引擎**: 直接封装 image-processor.js, ocr-service.js, data-viz-engine.js, template-engine.js 等 16 个已有引擎
- **Agent Skills 标准**: 所有技能遵循开放标准（YAML frontmatter + Markdown body），方便 AI 调用

---

### v0.37.3 (2026-02-17)

**Office文档 + 音视频处理** - 桌面端新增 10 个日常技能，总计 60 个内置技能（100% Handler 覆盖）

#### 新增 10 个桌面技能 v0.37.3 (总计 60 个，Handler 覆盖 60/60)

##### Office 文档处理 (5 个)

- ✅ **pdf-toolkit** (~280行) - PDF处理：提取文本/合并分析/拆分/OCR(Tesseract.js)/信息/水印
- ✅ **doc-converter** (~260行) - 万能格式转换：DOCX↔Markdown(mammoth)、MD→HTML(marked)、PDF→TXT(pdf-parse)、批量转换
- ✅ **excel-analyzer** (~280行) - Excel深度分析：Sheet列表→数据类型分布→公式审计(错误检测)→数据验证(混合类型)→透视摘要
- ✅ **pptx-creator** (~260行) - 演示文稿生成：Markdown大纲解析→幻灯片生成(PptxGenJS)→4种主题(professional/dark/minimal/colorful)
- ✅ **doc-comparator** (~250行) - 文档对比：多格式提取→LCS diff算法→行级增删改→相似度计算→text/json/html输出

##### 音视频处理 (5 个)

- ✅ **audio-transcriber** (~250行) - 语音转文字：Whisper API/本地引擎→音频预处理(ffmpeg)→SRT/VTT/JSON输出→多语言
- ✅ **video-toolkit** (~280行) - 视频操作：ffprobe信息→缩略图→提取音频→4级压缩(1080p/720p/480p/360p)→裁剪→格式转换
- ✅ **subtitle-generator** (~240行) - 字幕生成：SRT/VTT解析→格式互转→时间轴偏移→字幕翻译准备→媒体转录集成
- ✅ **tts-synthesizer** (~220行) - 文本转语音：TTSManager集成→10+预设语音→文件朗读(Markdown剥离)→多引擎支持
- ✅ **media-metadata** (~240行) - 媒体元数据：Sharp图片(EXIF/尺寸/色彩空间)→ffprobe音频/视频→批量目录提取→JSON/表格输出

#### 测试更新

- ✅ **skill-handlers.test.js**: 新增 ~28 个测试用例，SkillLoader 验证 50→60，总计 157 测试全部通过

#### 技术亮点

- **零新增依赖**: 全部复用已有 npm 包 (pdf-parse, mammoth, exceljs, pptxgenjs, fluent-ffmpeg, sharp, tesseract.js, marked)
- **优雅降级**: 音视频技能在缺少 ffmpeg/Whisper 时返回有用信息而非报错
- **统一 Handler 契约**: 所有 handler 遵循 init/execute 模式，支持 --flag 解析

---

### v0.37.2 (2026-02-17)

**Android 移动生产力 + PC 远程委托** - Android 端新增 13 个技能 (5 LOCAL + 8 REMOTE)，支持 remoteSkillName 映射

#### Android 移动生产力技能 (5 LOCAL)

- ✅ **quick-note** - 智能笔记：AI 自动分类、标签、摘要
- ✅ **email-draft** - 邮件起草：支持 formal/casual/friendly 语气
- ✅ **meeting-notes** - 会议纪要：自动提取与会者、议程、决策、行动项
- ✅ **daily-planner** - 每日计划：优先级排序 + 时间块建议
- ✅ **text-improver** - 文本润色：语法/清晰度/风格优化，支持 formal/casual/concise/academic

#### Android PC 远程委托技能 (8 REMOTE)

- ✅ **pc-screenshot** → 桌面端 `computer-use` - 远程截屏
- ✅ **pc-file-search** → 桌面端 `smart-search` - 远程文件搜索
- ✅ **pc-run-command** → 桌面端 `remote-control` - 远程终端命令
- ✅ **pc-open-url** → 桌面端 `browser-automation` - 远程打开 URL
- ✅ **pc-clipboard** → 桌面端 `remote-control` - 跨设备剪贴板同步
- ✅ **pc-system-info** → 桌面端 `remote-control` - PC 系统信息
- ✅ **pc-git-status** → 桌面端 `remote-control` - 远程 Git 状态
- ✅ **pc-processes** → 桌面端 `remote-control` - 远程进程管理

#### 架构增强

- ✅ **remoteSkillName** - SkillMetadata 新增字段，支持 Android 技能→桌面技能名称映射
- ✅ **SkillMdParser** - 支持 `remote-skill-name` / `remoteSkillName` YAML 解析
- ✅ **SkillExecutor** - REMOTE/HYBRID 路由使用 `remoteSkillName` 指定桌面目标技能
- ✅ **SkillCategory** - 新增 `PRODUCTIVITY` 和 `REMOTE` 分类

#### 测试更新

- ✅ **ProductivityHandlersTest** - 16 个测试用例覆盖 5 个生产力 Handler
- ✅ **SkillMdParserTest** - 3 个新测试验证 `remoteSkillName` 解析
- ✅ **SkillExecutorTest** - 2 个新测试验证 `remoteSkillName` 路由

#### 数据统计

- Android 技能总数：15 → **28** (5 LOCAL + 8 REMOTE)
- Android Handler 总数：7 → **12** (5 新生产力 Handler)
- 新增测试：**21** 个

---

### v0.37.1 (2026-02-17)

**AI 会话增强 + 开发效率** - 新增 10 个技能，总计 50 个内置技能（100% Handler 覆盖）

#### 新增 10 个技能 v0.36.2 (总计 50 个，Handler 覆盖 50/50)

##### AI 会话增强 (4 个)

- ✅ **prompt-enhancer** (~200行) - 提示词增强：意图分析（6类别分类）→上下文注入（package.json技术栈）→提示词重写
- ✅ **codebase-qa** (~250行) - 代码库语义问答：文件索引→符号提取→关键词匹配→TF-IDF排名→上下文组装
- ✅ **auto-context** (~200行) - 智能上下文检测：24组关键词映射→文件相关度评分→Token预算管理→推荐文件列表
- ✅ **multi-model-router** (~180行) - 多模型路由：任务复杂度评分→6模型能力矩阵→路由决策→成本优化

##### 开发效率 (6 个)

- ✅ **code-translator** (~250行) - 跨语言转换：语言检测→语法映射规则（JS↔TS, Python↔JS）→框架映射
- ✅ **dead-code-eliminator** (~250行) - 死代码检测：导出分析→未引用文件→未使用变量→安全删除建议
- ✅ **changelog-generator** (~200行) - Changelog生成：Git commits→Conventional Commits解析→分类→Markdown格式化
- ✅ **mock-data-generator** (~200行) - 模拟数据生成：Schema/TypeScript类型→智能数据生成（30+字段模式）→JSON输出
- ✅ **git-history-analyzer** (~250行) - Git历史分析：变更热点→贡献者分析→代码流失率→耦合检测
- ✅ **i18n-manager** (~220行) - 国际化管理：硬编码字符串提取→翻译完整性检查→新Locale生成→覆盖率统计

#### 测试更新

- ✅ **skill-handlers.test.js**: 新增 ~20 个测试用例，SkillLoader 验证 40→50，总计 ~120 测试

---

### v0.37.0 (2026-02-17)

**Android Agent Skills System** - Android 端 Agent Skills 系统完整实现，与桌面端 SKILL.md 格式兼容

#### Android Skills System (21 Kotlin + 15 SKILL.md + 7 Tests)

- ✅ **数据模型** - `Skill`, `SkillMetadata`, `SkillParameter`, `SkillCategory` (Agent Skills Open Standard 兼容)
- ✅ **SkillMdParser** (~285行) - YAML frontmatter 解析器 (SnakeYAML + fallback)，支持 kebab-case 和 camelCase 字段
- ✅ **SkillRegistry** (~158行) - 线程安全注册表 (`ConcurrentHashMap`)，支持按名称/分类/文件类型/标签 O(1) 查找
- ✅ **SkillLoader** (~210行) - 三层加载：bundled (APK assets) → managed (marketplace) → workspace (用户目录)
- ✅ **SkillGating** (~80行) - 平台/SDK版本/Android权限 门控检查
- ✅ **SkillExecutor** (~162行) - 执行引擎：Kotlin Handler 优先，LLM Prompt 回退，超时支持
- ✅ **SkillCommandParser** (~143行) - `/skill-name` 命令解析，支持位置参数、命名参数、自动补全
- ✅ **7 个 Kotlin Handler** - CodeReview, ExplainCode, Summarize, Translate, Refactor, UnitTest, Debug
- ✅ **15 个 Bundled Skills** - 7 个带 Handler + 8 个文档型 (git-commit, code-complete, api-docs, regex-helper, sql-helper, json-formatter, markdown-helper, chat-template)
- ✅ **SkillModule** (Hilt DI) - 完整依赖注入，确保 SkillLoader 在 Executor 之前初始化
- ✅ **P2PSkillBridge** - 桌面端技能委托占位符（未来 P2P 集成）
- ✅ **ConversationViewModel 集成** - `/skill` 命令检测与执行，自动补全建议
- ✅ **LLM Function Calling** - `toFunctionDefinitions()` 生成 OpenAI 函数调用格式
- ✅ **7 个测试文件** - SkillMdParserTest, SkillRegistryTest, SkillCommandParserTest, SkillModelTest, SkillExecutorTest, SkillGatingTest, SkillLoaderTest

#### Bug 修复

- 🔧 **RAGRetrieverTest**: 修复 `updateFromCorpus` mock 返回类型错误 (`returns 0` → `returns Unit`)

---

### v0.36.1 (2026-02-17)

**Advanced Skills & Quality Fixes** - 10 个高级技能 + SSO 修复 + 技能系统 100% 覆盖

#### 新增 10 个高级技能 (总计 40 个，Handler 覆盖 40/40)

- ✅ **architect-mode** (~530行) - 双阶段架构模式：先规划后编辑，多文件变更计划审核与执行
- ✅ **bugbot** (~460行) - 主动Bug检测：16种模式（SQL注入/XSS/空指针/竞态等），--scan/--diff/--watch 模式
- ✅ **commit-splitter** (~460行) - 智能提交拆分：语义分组、测试+源码关联、conventional commit 消息生成
- ✅ **diff-previewer** (~460行) - 差异预览器：git diff 解析、分支对比、staged 变更、变更统计分类
- ✅ **fault-localizer** (~330行) - 故障定位器：堆栈解析、git blame 交叉分析、错误类型→修复映射
- ✅ **impact-analyzer** (~280行) - 变更影响分析：import 图 BFS、爆炸半径、测试映射、风险评分
- ✅ **research-agent** (~250行) - 技术研究代理：库对比、错误解决方案、依赖评估、本地文档搜索
- ✅ **rules-engine** (~480行) - 规则引擎：加载/验证/应用项目编码规则（.chainlesschain/rules.md）
- ✅ **screenshot-to-code** (~380行) - 截图转代码：图片验证、Vue/React/HTML 框架模板、AI 提示构建
- ✅ **task-decomposer** (~300行) - 任务分解器：复杂任务→子任务 DAG、依赖分析、并行度计算

#### Bug 修复

- 🔧 **SSO verifyLink**: 从临时 `return { success: true }` 替换为真实 `sso:verify-link` IPC 调用
- 🔧 **rules-engine**: 修复 Windows 路径 regex bug (`/\/g` → `/\\/g`)

---

### v0.36.0 (2026-02-16)

**Unified Tool Registry AI Call Chain** - 统一工具注册表全面打通AI对话调用链

#### 核心改进

- ✅ **AI Call Chain Integration** - `ManusOptimizations.bindUnifiedRegistry()` 打通完整调用链
  - `ipc-registry.js` Phase 15: `registry.initialize().then()` → 绑定到 ManusOptimizations
  - `manus-optimizations.js`: `buildOptimizedPrompt()` 自动传递 `unifiedRegistry` 到 ContextEngineering
  - AI 对话提示词自动包含: 技能分组 + Instructions + Examples
- ✅ **Initialization Safety** - `_initPromise` 锁防止并发 `initialize()` 竞态条件
- ✅ **IPC Init-Wait Guard** - `_waitForInit()` helper (10s 超时) 保护所有 5 个读取 handler
- ✅ **MCPSkillGenerator Safety** - 空工具名 `.filter(Boolean)` 过滤
- ✅ **Parameter Serialization Limit** - `MAX_PARAMS_LENGTH = 500`，circular reference try-catch 保护
- ✅ **Type Safety** - Store 错误处理升级为 `err: unknown` + `(err as Error)?.message`
- ✅ **Error Recovery** - ToolsExplorerPage.vue `onMounted` try-catch 包裹
- ✅ **E2E Integration Tests** - 4 个端到端测试验证完整调用链 (31 tests total, 221 related pass)

#### 新增 15 个内置技能 (总计 30 个)

- ✅ **开发类 (6)**: repo-map (AST代码库映射), refactor (多文件重构), onboard-project (项目入门分析), lint-and-fix (Lint自动修复循环), project-scaffold (项目脚手架), mcp-server-generator (MCP服务器生成)
- ✅ **文档类 (1)**: doc-generator (JSDoc/API参考/序列图自动生成)
- ✅ **测试类 (2)**: api-tester (IPC/API测试发现与生成), test-and-fix (测试自动修复循环)
- ✅ **分析类 (1)**: dependency-analyzer (依赖图/影响分析/CVE可达性)
- ✅ **数据库类 (1)**: db-migration (Schema检查/迁移脚本/漂移检测)
- ✅ **知识类 (1)**: context-loader (智能上下文预加载)
- ✅ **安全类 (1)**: vulnerability-scanner (CVE扫描/SBOM/许可证审计)
- ✅ **DevOps类 (2)**: env-doctor (环境诊断), release-manager (发布管理/Changelog/Tag)

#### 新增 23 个可执行 Handler (总计 30/30, 100% 覆盖)

**第一批 (5 个)**:

- ✅ **env-doctor** (~200行) - 运行时检测(Node/npm/Java/Python/Docker/Git)、8端口扫描、Docker健康、配置验证
- ✅ **repo-map** (~250行) - 代码库扫描、JS/TS/Vue/Python/Java符号提取、树/平铺输出、符号搜索
- ✅ **context-loader** (~220行) - 意图关键词映射(25+)、文件相关度评分、token预算管理(默认6000)
- ✅ **lint-and-fix** (~230行) - ESLint/Prettier自动检测、JSON错误解析、迭代修复循环(最多5轮)
- ✅ **test-and-fix** (~230行) - Vitest/Jest/Pytest自动检测、失败解析、source-only/test-only模式

**第二批 (6 个)**:

- ✅ **refactor** (~200行) - 代码异味检测(Large File/God Class/Duplicate Code)、跨文件重命名预览、重复代码提取分析
- ✅ **doc-generator** (~230行) - JSDoc注释生成、IPC处理器参考文档、Git Changelog生成、模块README生成
- ✅ **api-tester** (~200行) - IPC handler自动发现、Vitest测试桩生成、按命名空间健康检查
- ✅ **onboard-project** (~250行) - 项目分析(tech stack/目录/关键文件)、贡献者指南、代码审查指南
- ✅ **dependency-analyzer** (~280行) - 导入图构建、变更影响分析(BFS传递)、循环依赖检测(DFS)、npm audit漏洞、许可证检查
- ✅ **project-scaffold** (~250行) - Skill脚手架(SKILL.md+handler.js)、Vue页面(+Pinia store)、IPC模块(+handler桩)

**第三批 (6 个)**:

- ✅ **db-migration** (~230行) - Schema检查(CREATE TABLE解析)、迁移脚本生成(UP/DOWN)、漂移检测、索引优化建议
- ✅ **vulnerability-scanner** (~220行) - npm audit扫描、SBOM生成(CycloneDX/SPDX)、许可证审计(GPL警告)
- ✅ **release-manager** (~260行) - 语义版本计算(auto/major/minor/patch)、Changelog生成、dry-run预览、Release Notes
- ✅ **mcp-server-generator** (~230行) - 自然语言→MCP服务器(4文件)、工具推断(CRUD模式)、传输/认证配置
- ✅ **security-audit** (~220行) - OWASP Top 10扫描(SQL注入/XSS/eval/命令注入)、硬编码密钥检测(AWS/JWT/API Key)
- ✅ **devops-automation** (~270行) - Dockerfile生成(多阶段构建)、CI/CD配置(GitHub/GitLab/Jenkins)、部署脚本、DevOps分析

- 🔧 **Bug fix**: 修复所有handler的require路径(4级→5级)，确保正确解析到`src/main/`
- 🧪 **63个测试**: skill-handlers.test.js覆盖17个新handler + SkillLoader验证(30技能/24handler)

---

### v0.35.0 (2026-02-16)

**AI Skills System 智能技能系统** - 15个内置技能 + 统一工具注册表 + 10个演示模板 + Agent Skills开放标准

#### 新增核心功能

##### 15 Built-in Skills (15个内置技能)

- ✅ **7个可执行Handler技能**:
  - `browser-automation` (264行) - 浏览器导航/点击/输入/表单/截图/数据提取
  - `computer-use` (271行) - 桌面截图/坐标点击/键盘/视觉AI
  - `workflow-automation` - 多步骤工作流(条件分支/循环/并行执行)
  - `memory-management` (252行) - 持久记忆(保存/搜索/日志/洞察提取)
  - `smart-search` - 智能混合搜索(向量60%+BM25 40%)
  - `web-scraping` - 网页数据抓取(表格/链接/文本)
  - `remote-control` - 远程设备控制(命令/文件传输/剪贴板)
- ✅ **8个文档型技能**: code-review, git-commit, explain-code, data-analysis, security-audit, devops-automation, test-generator, performance-optimizer

##### Unified Tool Registry (统一工具注册表)

- ✅ **UnifiedToolRegistry** (529行) - 聚合FunctionCaller(60+工具) + MCP(8服务器) + Skills(30技能)
- ✅ **ToolSkillMapper** (198行) - 自动将未覆盖工具分组到10个默认技能类别
- ✅ **MCPSkillGenerator** (108行) - MCP服务器连接时自动生成SkillManifestEntry
- ✅ **unified-tools-ipc** (136行) - 6个IPC处理器
- ✅ **Name Normalization** - kebab-case(SKILL.md) ↔ snake_case(FunctionCaller) 自动桥接

##### Agent Skills Open Standard (Agent Skills开放标准)

- ✅ **SkillMdParser** (363行) - YAML frontmatter + Markdown body解析，13个扩展字段
- ✅ **MarkdownSkill** (224行) - 技能实现，热重载handler
- ✅ **13个扩展字段**: tools, instructions, examples, dependencies, input-schema, output-schema, model-hints, cost, author, license, homepage, repository, capabilities

##### Demo Templates (演示模板)

- ✅ **DemoTemplateLoader** (235行) - 自动发现JSON模板，4个IPC处理器
- ✅ **10个演示模板**: 自动化(3) + AI工作流(3) + 知识管理(2) + 远程控制(2)

##### Frontend (前端)

- ✅ **ToolsExplorerPage** (485行) - 工具浏览器，按技能分组展示 (路由: `#/tools/explorer`)
- ✅ **DemoTemplatesPage** (479行) - 演示模板浏览 (路由: `#/demo-templates`)
- ✅ **unified-tools.ts** (206行) - Pinia Store，工具和技能状态管理

##### Context Engineering Integration

- ✅ 技能分组工具序列化集成到LLM提示词
- ✅ 社区MCP服务器增加 skillInstructions/skillExamples/skillCategory 元数据

#### 性能指标

| 指标             | v0.34.0 | v0.35.0  | 提升          |
| ---------------- | ------- | -------- | ------------- |
| 内置技能         | 8       | 15       | +7 skills     |
| 工具系统         | 3个独立 | 1个统一  | 统一注册表    |
| 演示模板         | 0       | 10       | +10 templates |
| Agent Skills字段 | 基础    | 13个扩展 | 完整标准      |
| 新增IPC          | -       | 6+4      | +10 handlers  |
| Pinia Stores     | 32      | 33       | +1 store      |

---

### v0.34.0 (2026-02-15)

**Enterprise Features 企业级功能** - 企业审计合规 + 插件市场 + 专业化多代理 + SSO认证 + MCP SDK

#### 新增核心功能

- ✅ **Enterprise Audit System** - 统一审计日志、GDPR/SOC2合规检查、数据主体请求(DSR)、保留策略(18 IPC)
- ✅ **Plugin Marketplace** - 插件浏览/搜索/安装/卸载/评分/发布，完整生命周期管理(22 IPC)
- ✅ **Specialized Multi-Agent** - 8种专业代理模板(安全/DevOps/数据分析/文档/测试/架构/性能/合规)(16 IPC)
- ✅ **SSO Authentication** - SAML 2.0 + OAuth 2.0 + OIDC，PKCE支持，加密会话管理(20 IPC)
- ✅ **MCP SDK** - Fluent API Server Builder，HTTP+SSE服务器，Stdio服务器，8+社区服务器
- ✅ **5 Built-in Skills** - security-audit, devops-automation, data-analysis, test-generator, performance-optimizer
- ✅ **4-Layer Skill System** - bundled → marketplace → managed → workspace 四层技能加载

**新增代码**: ~26,000行 | **新增IPC**: 76+ handlers | **新增Stores**: 4个

---

### v0.33.0 (2026-02-13)

**Remote Control + Computer Use** - P2P远程控制系统 + Chrome浏览器扩展 + Claude风格电脑操作

#### 新增核心功能

- ✅ **Remote Control Gateway** - P2P远程网关，24+命令处理器，权限验证
- ✅ **Chrome Browser Extension** - Service Worker + Content Script + WebSocket服务器
- ✅ **Computer Use Agent** - 统一代理，68+ IPC handlers
- ✅ **CoordinateAction/VisionAction/DesktopAction** - 像素点击/视觉AI/桌面控制
- ✅ **WorkflowEngine** - 工作流引擎(条件/循环/并行/子工作流)
- ✅ **SafeMode/AuditLogger/ScreenRecorder/ActionReplay** - 安全/审计/录制/回放
- ✅ **Android Remote UIs** - 8个远程控制界面

**新增代码**: ~45,000行 | **提交数**: 20+

---

### v0.32.0 (2026-02-10)

**iOS/Android 大规模功能增强** - iOS 核心模块扩展 + Android 功能模块

- ✅ **iOS**: SessionManager, PermanentMemory, ContextEngineering, PermissionEngine, HookSystem, VoiceInput 等12个模块
- ✅ **Android**: MCP集成, Hooks系统, 协作模块, 性能模块, 10+语法高亮器

---

### v0.31.0 (2026-02-09)

**安全认证增强 + RAG索引** - 安全认证增强、增量RAG索引、SIMKey NFC

- ✅ 安全认证增强(dev/prod模式, JWT认证)
- ✅ 增量RAG索引系统(MD5 hash变化检测)
- ✅ SIMKey NFC检测
- ✅ 文件版本控制(SHA-256)
- ✅ LLM Function Calling

---

### v0.30.0 (2026-02-07)

**DI测试重构 + 社交通知** - 依赖注入测试重构、社交功能增强

- ✅ 测试体系DI重构(102个数据库测试)
- ✅ 社交通知UI
- ✅ TaskMonitor ECharts仪表盘
- ✅ AbortController AI对话取消

---

### v0.29.0 (2026-02-06)

**TypeScript 迁移 + 浏览器控制 + Claude Code 风格系统完善** - 前端 TypeScript 重构、浏览器自动化控制、10 个 Claude Code 风格子系统

#### 2026-02-06 更新

##### TypeScript 迁移

- ✅ **Stores TypeScript 迁移** - memory, task, file, workspace stores 全面迁移
- ✅ **Composables TypeScript 迁移** - 核心 composables 迁移到 TypeScript
- ✅ **类型安全增强** - 完整类型定义、IDE 支持改进

##### 浏览器自动化控制

- ✅ **BrowserEngine** - Playwright 集成、12 IPC 通道
- ✅ **SnapshotEngine** - 智能快照引擎、元素定位
- ✅ **Snapshot IPC** - 6 个快照相关 IPC 通道
- ✅ **前端 UI** - SnapshotPanel 组件

##### Claude Code 风格系统 (10 子系统, 127 IPC 通道)

- ✅ **Hooks System** - 11 IPC handlers
- ✅ **Plan Mode** - 14 IPC handlers
- ✅ **Skills System** - 17 IPC handlers
- ✅ **Context Engineering** - 17 IPC handlers
- ✅ **Prompt Compressor** - 10 IPC handlers
- ✅ **Response Cache** - 11 IPC handlers
- ✅ **Token Tracker** - 12 IPC handlers
- ✅ **Stream Controller** - 12 IPC handlers
- ✅ **Resource Monitor** - 13 IPC handlers
- ✅ **Message Aggregator** - 10 IPC handlers

---

### v0.29.0 (2026-02-02)

**企业级权限系统 + Context Engineering + Claude Code 风格工具** - 企业级权限引擎、上下文窗口优化、Plan Mode 和 Skills 系统增强

#### 新增核心功能

##### Permission Engine - 企业级 RBAC 权限引擎

- ✅ **PermissionEngine** - `src/main/permission/permission-engine.js` (~700行)
  - 资源级权限评估、条件访问
  - 权限缓存（1分钟TTL）
  - 权限继承（父子资源自动继承）
  - 权限委托（临时授权、时间范围）
  - 团队权限（基于团队的访问控制）
  - 完整审计日志

- ✅ **TeamManager** - `src/main/permission/team-manager.js` (~300行)
  - 子团队创建/更新/删除
  - 层级结构（parentTeamId）
  - 成员管理（添加/移除/设置负责人）
  - 成员统计

- ✅ **ApprovalWorkflowManager** - `src/main/permission/approval-workflow-manager.js`
  - 多级审批流程
  - 自动审批规则
  - 审批状态追踪

- ✅ **DelegationManager** - `src/main/permission/delegation-manager.js`
  - 权限委托创建/撤销
  - 时间范围控制
  - 资源范围限制

##### Team Report Manager - 团队日报周报系统

- ✅ **TeamReportManager** - `src/main/task/team-report-manager.js` (~200行)
  - Daily Standup 创建
  - 昨日工作/今日计划/阻塞项
  - AI 摘要生成
  - 按日期/作者/类型过滤

##### Context Engineering - KV-Cache 优化系统

- ✅ **Context Engineering IPC** - `src/main/llm/context-engineering-ipc.js` (~760行)
  - 17 个 IPC 通道
  - 统计/配置：get-stats、reset-stats、get-config、set-config
  - Prompt 优化：optimize-messages、estimate-tokens
  - 任务上下文：set-task、update-task-progress、get-task、clear-task
  - 错误历史：record-error、resolve-error、get-errors、clear-errors
  - 内容压缩：compress、is-compressed、decompress
  - **功能特点**:
    - KV-Cache 友好的 Prompt 构建（静态内容前置）
    - 工具定义确定性序列化（按名称排序）
    - 时间戳/UUID 等动态内容清理
    - 任务目标重述（解决"丢失中间"问题）
    - 错误历史保留供模型学习
    - 可恢复压缩（保留引用，支持后续恢复）

- ✅ **TokenEstimator** - Token 数量估算
  - 中英文自动检测
  - 消息数组估算
  - 按角色统计

##### Plan Mode - Claude Code 风格计划模式

- ✅ **PlanModeManager** - `src/main/ai-engine/plan-mode/index.js` (~400行)
  - 安全分析模式（只允许 Read/Search/Analyze 工具）
  - 计划生成和存储
  - 审批流程（全部/部分审批、拒绝）
  - 与 Hooks 系统集成

- ✅ **Plan Mode IPC** - `src/main/ai-engine/plan-mode/plan-mode-ipc.js`
  - 14 个 IPC 通道
  - 进入/退出计划模式
  - 计划项管理
  - 审批操作

##### Skills 系统增强 - Markdown Skills

- ✅ **Skills IPC** - `src/main/ai-engine/cowork/skills/skills-ipc.js`
  - 17 个 IPC 通道
  - 技能加载/重新加载
  - 技能查询（列表、详情、分类）
  - 技能执行（单个执行、自动执行）
  - /skill 命令解析

- ✅ **内置技能**
  - `builtin/code-review/SKILL.md` - 代码审查
  - `builtin/git-commit/SKILL.md` - Git 提交消息生成
  - `builtin/explain-code/SKILL.md` - 代码解释

- ✅ **三层加载机制**
  - bundled（内置）→ managed（用户级）→ workspace（项目级）
  - 优先级覆盖：高层级技能覆盖低层级同名技能
  - 门控检查：平台、二进制依赖、环境变量

##### Prompt Compressor IPC - 上下文压缩系统

- ✅ **Prompt Compressor IPC** - `src/main/llm/prompt-compressor-ipc.js` (~500行)
  - 10 个 IPC 通道
  - 配置管理：get-config、set-config、reset-config
  - 压缩操作：compress、preview、estimate-tokens、get-recommendations
  - 统计信息：get-stats、get-history、clear-history
  - 三种压缩策略（去重、截断、总结）
  - 压缩率目标 0.6-0.7（节省 30-40% tokens）

#### 测试验证

- ✅ **Context Engineering 测试** - 22 个集成测试全部通过
- ✅ **Plan Mode 测试** - 48 单元测试 + 17 集成测试全部通过
- ✅ **Skills 系统测试** - 15 个集成测试全部通过
- ✅ **Prompt Compressor 测试** - 15 个集成测试全部通过
- ✅ **MCP 端到端测试** - 31 个集成测试全部通过

#### 性能提升

| 指标          | 优化前 | 优化后 | 提升     |
| ------------- | ------ | ------ | -------- |
| KV-Cache 命中 | -      | 60-85% | **极高** |
| Token 节省    | -      | 30-40% | **显著** |
| 权限检查延迟  | -      | <10ms  | **极快** |

---

### v0.27.1 (2026-01-27)

**Phase 3/4 工作流优化全部完成** - AI引擎性能大幅提升:

#### 核心优化模块 (6,344行新代码)

- ✅ **智能任务计划缓存 (Optimization 3)** - `smart-plan-cache.js` (~795行)
  - LLM Embedding向量化语义理解
  - 余弦相似度匹配(非精确匹配)
  - LRU淘汰策略 + TTL过期机制(7天)
  - TF-IDF后备方案(无LLM API时可工作)
  - **性能**: 缓存命中率20%→60-85% (+3-4x), LLM成本减少70%
  - **文档**: `docs/features/PHASE3_OPTIMIZATION3_SMART_PLAN_CACHE.md`

- ✅ **LLM辅助多代理决策 (Optimization 4)** - `llm-decision-engine.js` (~1,220行)
  - 三层智能决策策略(规则→LLM→历史学习)
  - 5个启发式规则快速判断(85%情况)
  - LLM边界情况分析(15-30%情况)
  - 历史强化学习(数据库驱动)
  - 决策缓存(LRU + 任务指纹匹配)
  - **性能**: 多代理利用率70%→90% (+20%), 决策准确率75%→92% (+17%)
  - **文档**: `docs/features/PHASE3_OPTIMIZATION4_LLM_DECISION.md`

- ✅ **代理池复用系统 (Optimization 5)** - `agent-pool.js` (~555行)
  - 预热机制(启动时预创建minSize个代理)
  - 动态伸缩(minSize→maxSize, 自动缩容)
  - 状态隔离(安全的代理复用)
  - 等待队列(池满时排队)
  - 空闲超时(自动销毁多余代理)
  - **性能**: 代理获取速度50ms→5ms (10x), 创建开销减少85%, 典型复用率70-90%
  - **集成**: `teammate-tool.js` (修改+95行)

- ✅ **关键路径优化 (Optimization 8)** - `critical-path-optimizer.js` (~860行)
  - CPM(Critical Path Method)算法实现
  - DAG分析 + 拓扑排序(Kahn算法)
  - 前向/后向传递(ES/EF/LS/LF计算)
  - 松弛时间计算 + 关键路径识别
  - 动态优先级调整(关键任务2x加成)
  - **性能**: 复杂工作流执行时间减少15-36%, 并行效率提升50%
  - **集成**: `task-executor.js` (修改+30行)
  - **文档**: `docs/features/PHASE3_OPTIMIZATION8_CRITICAL_PATH.md`

- ✅ **实时质量检查 (Optimization 11)** - `real-time-quality-gate.js` (~930行)
  - 文件监控(chokidar) + 防抖机制(500ms)
  - 5个内置质量规则(括号匹配/长函数/硬编码密钥/console.log/TODO)
  - 严重级别(ERROR/WARNING/INFO)
  - 问题缓存 + 统计追踪
  - 事件发射(实时通知)
  - **性能**: 问题发现30分钟→<1秒 (1800x快), 返工时间减少50%
  - **文档**: `docs/features/PHASE3_OPTIMIZATION11_REALTIME_QUALITY.md`

- ✅ **自动阶段转换 (Optimization 10)** - `task-executor.js` 新增 `AutoPhaseTransition` 类 (~145行)
  - 监听execution-started → 自动切换到executing
  - 监听execution-completed → 自动切换到validating
  - 状态机验证(planning→executing→validating→committing)
  - 统计追踪(成功率、失败次数)
  - **收益**: 消除手动阶段转换错误(100%), 自动化工作流程

- ✅ **智能检查点策略 (Optimization 15)** - `long-running-task-manager.js` 新增 `SmartCheckpointStrategy` 类 (~140行)
  - 基于任务耗时动态调整间隔(<2分钟不保存, 2-10分钟每2分钟, >10分钟每5分钟)
  - 基于任务类型调整(数据处理×0.5, LLM调用×1.5, 文件操作×0.7)
  - 基于优先级调整(高优先级×0.8, 低优先级×1.2)
  - 基于当前进度调整(接近完成×0.7, 刚开始×1.3)
  - **性能**: IO开销减少30-40%

#### 性能提升总结

| 指标                   | 优化前 | 优化后    | 提升      |
| ---------------------- | ------ | --------- | --------- |
| 任务成功率             | 40%    | 70%       | **+75%**  |
| LLM规划成本            | 基准   | 基准×0.3  | **-70%**  |
| 缓存命中率             | 20%    | 60-85%    | **+3-4x** |
| 多代理利用率           | 70%    | 90%       | **+20%**  |
| 多代理决策准确率       | 75%    | 92%       | **+17%**  |
| 代理获取速度           | 基准   | 基准×10   | **10x**   |
| 代理创建开销           | 基准   | 基准×0.15 | **-85%**  |
| 任务执行时间(复杂流程) | 基准   | 基准×0.75 | **-25%**  |
| 质量问题发现时间       | 30分钟 | <1秒      | **1800x** |
| 返工时间               | 基准   | 基准×0.5  | **-50%**  |
| IO开销(检查点)         | 基准   | 基准×0.7  | **-30%**  |
| 人为错误(阶段转换)     | 偶发   | 0         | **-100%** |

#### 测试验证

- ✅ **单元测试** - 新增测试文件:
  - `smart-plan-cache.test.js` (280行, 9个测试套件)
  - `llm-decision-engine.test.js` (550行, 15个测试套件)
  - `agent-pool.test.js` (未明确提及)
  - `critical-path-optimizer.test.js` (260行, 11个测试套件)
  - `real-time-quality-gate.test.js` (280行, 10个测试套件)
  - **总计**: 约1,370行测试代码

#### 完整文档

- `docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md` (1,337行) - Phase 3/4完成总结
- `docs/features/PHASE3_OPTIMIZATION3_SMART_PLAN_CACHE.md` (576行) - 智能计划缓存
- `docs/features/PHASE3_OPTIMIZATION4_LLM_DECISION.md` (815行) - LLM辅助决策
- `docs/features/PHASE3_OPTIMIZATION8_CRITICAL_PATH.md` (571行) - 关键路径优化
- `docs/features/PHASE3_OPTIMIZATION11_REALTIME_QUALITY.md` (572行) - 实时质量检查
- **总计**: 约3,871行文档

#### 用户价值

**核心改进**:

- ✅ 更高的成功率: 任务执行从40%提升到70% (+75%)
- ✅ 更低的成本: LLM规划成本减少70%, 月度节省$2,550 (1000次/天)
- ✅ 更智能的决策: 多代理利用率90%, 决策准确率92%
- ✅ 更快的执行: 代理获取快10倍, 任务执行快25%, 质量发现快1800倍
- ✅ 更好的可靠性: 消除人为错误, 智能检查点, 自动阶段转换
- ✅ 完全向后兼容: 所有优化默认启用, 但可单独禁用

**详细报告**: `docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md`

---

### v0.27.0 (2026-01-27)

**Cowork 多代理协作系统 v1.0.0** - 企业级生产就绪:

- ✅ **智能编排系统** - AI驱动的单/多代理决策，三场景模型实现
  - CoworkOrchestrator (500行) - 智能任务分配
  - 支持简单/中等/复杂任务自动识别
  - 动态负载均衡和故障转移

- ✅ **核心协作引擎** - 13个协作操作的完整实现
  - TeammateTool (1,100行) - 团队管理、任务分配、投票决策
  - 三重存储策略(内存+文件系统+数据库)
  - EventEmitter事件系统

- ✅ **文件沙箱系统** - 企业级安全防护
  - FileSandbox (700行) - 18+敏感文件模式检测
  - 路径遍历防护、细粒度权限控制
  - 完整审计日志和完整性校验

- ✅ **长时任务管理** - 可靠性保障
  - LongRunningTaskManager (750行)
  - 检查点/恢复机制、指数退避重试
  - 进度跟踪和时间估算

- ✅ **技能系统** - 智能匹配和动态加载
  - 4个Office技能(Excel/Word/PPT/数据分析)
  - SkillRegistry智能匹配(0-100评分)
  - BaseSkill抽象类和动态技能注册

- ✅ **ChainlessChain集成** - 无缝对接现有系统
  - RAG集成 (350行) - 知识库查询
  - LLM集成 (550行) - AI决策和任务分析
  - ErrorMonitor集成 (250行) - 自动诊断
  - SessionManager集成 (250行) - 会话跟踪(30-40% token节省)

- ✅ **完整前端UI** - 企业级用户体验
  - CoworkDashboard (950行) - 主控制面板
  - TaskMonitor (850行) - 任务监控和进度跟踪
  - SkillManager (750行) - 技能管理和测试
  - CoworkAnalytics (650行) - 数据分析和可视化
  - Pinia状态管理 (1,200行) - 30+操作，15+getter

- ✅ **ECharts数据可视化** - 10+图表类型
  - 任务完成趋势(折线图+柱状图)
  - 状态分布(饼图)、代理利用率(热力图)
  - 技能使用统计(条形图)、任务时间线(甘特图)
  - 优先级vs时长(散点图)、团队性能(堆叠柱状图)
  - 实时监控(3个仪表盘)

- ✅ **数据库架构** - 高性能设计
  - 9张专用表(teams/agents/tasks/messages/audit/metrics/checkpoints/permissions/decisions)
  - 35个索引(27单列+8复合索引)
  - 查询性能提升40-60%

- ✅ **IPC通信层** - 45个处理器
  - cowork-ipc.js (850行)
  - 完整的前后端通信接口
  - 一致的错误处理和事件进度更新

**测试和质量保证**:

- ✅ **200+ 测试用例** - 90%+ 代码覆盖率
  - 150+ 单元测试 (teammate-tool/file-sandbox/skill-registry/orchestrator)
  - 40+ 集成测试 (E2E工作流/多团队并发/文件沙箱)
  - 50+ 安全测试 (路径遍历/SQL注入/XSS/权限提升)
  - 性能基准测试 (自动化基准比较)

- ✅ **性能优化** - 所有指标优于基线
  - 团队创建: 45ms (优于50ms目标10%)
  - 代理创建: 28ms (优于30ms目标7%)
  - 任务分配: 38ms (优于40ms目标5%)
  - 权限检查: 3ms (优于5ms目标40%)
  - 内存清理效率: 94%

- ✅ **安全强化** - 零关键漏洞
  - 5层防护架构(输入验证/文件沙箱/IPC安全/数据库安全/审计日志)
  - 零信任安全模型
  - 完整审计跟踪

**完整文档** (9,750+ 行):

- COWORK_QUICK_START.md (1,000行) - 快速入门指南
- COWORK_DEPLOYMENT_CHECKLIST.md (1,200行) - 部署检查清单
- COWORK_USAGE_EXAMPLES.md (2,500行) - 16个实践示例
- COWORK_PERFORMANCE_GUIDE.md (1,400行) - 性能优化指南
- COWORK_SECURITY_GUIDE.md (1,800行) - 安全最佳实践
- COWORK_INTEGRATION_GUIDE.md (1,100行) - 集成指南
- COWORK_FINAL_PROJECT_SUMMARY.md (1,000行) - 项目总结

**代码统计**:

- 生产代码: ~15,750 行
- 测试代码: ~3,150 行
- 文档: ~9,750 行
- **总计**: ~28,650 行

**项目状态**: ✅ **生产就绪** - 100% 完成

---

### v0.26.0 (2026-01-19)

**重大更新**:

- ✅ **统一日志系统** - 将700+个console调用迁移到集中式logger，支持日志级别控制、结构化日志、生产环境调试
  - 新增 `logger-ipc.js` (120行) - IPC日志接口
  - 新增 `logger.js` (245行) - 集中式日志管理器
  - 支持日志级别: DEBUG, INFO, WARN, ERROR
  - 生产环境调试支持

- ✅ **Android P2P UI完整集成** - 8个P2P屏幕（设备发现/配对/安全验证/DID管理/消息队列/QR扫描）
  - 完整P2P设备管理体验
  - DID管理界面
  - 消息队列可视化
  - QR码扫描功能

- ✅ **ChatPanel内存泄漏防护** - 4层防护机制（定时器安全/事件清理/API取消/消息限制）
  - 确保长时间运行稳定性
  - 自动资源清理
  - 内存使用优化

- ✅ **P2P WebRTC兼容层** - 新增WebRTC兼容性层，优化P2P通信稳定性，完善测试覆盖

- ✅ **代码结构重构** - src/main目录按功能分类重组(api/config/database/monitoring/system等)，提升代码可维护性

- ✅ **测试框架优化** - 修复不稳定测试，跳过依赖特定环境的测试，提升CI/CD稳定性

**新增文档**:

- P2P文档 (709行)
- 日志系统文档

---

## 历史版本

### v0.25.0 (2026-01-17)

**Manus AI 优化系统**:

- ✅ **Context Engineering** - KV-Cache优化，减少重复计算
- ✅ **Tool Masking** - 工具掩码，智能工具选择
- ✅ **TaskTrackerFile** - todo.md机制，任务追踪
- ✅ **可恢复压缩** - 智能上下文压缩

**Multi-Agent 多智能体系统**:

- ✅ Agent协调器
- ✅ 3个专用Agent（代码生成/数据分析/文档处理）
- ✅ 并行执行、链式执行
- ✅ Agent间通信

**性能提升**:

- 理论Token成本降低 50-90%
- 复杂任务完成时间降低 30%

**新增代码**: 5,500+ 行

---

### v0.24.0 (2026-01-16)

**MCP Chat Integration**:

- ✅ MCP工具集成到AI聊天
- ✅ 通过Function Calling调用MCP服务器工具
- ✅ 新增 `mcp-function-executor.js` (268行)

---

### v0.23.0 (2026-01-15)

**SessionManager 增强**:

- ✅ 会话搜索
- ✅ 会话标签
- ✅ 会话导出/导入
- ✅ 自动摘要
- ✅ 会话模板
- ✅ 批量操作

**ErrorMonitor AI 诊断**:

- ✅ 智能错误诊断
- ✅ 本地 Ollama LLM（免费）
- ✅ 自动分类
- ✅ 严重程度评估
- ✅ 自动修复策略

---

### v0.22.0 (2026-01-13) ⭐ 重大更新

**区块链集成完成**:

- ✅ Phase 4-6 全部完成
- ✅ 15链支持（以太坊/Polygon/BSC/Arbitrum/Optimism/Avalanche/Base等）
- ✅ RPC管理（智能切换、故障转移）
- ✅ 事件监听（实时同步）
- ✅ 完整UI（12个组件）
- ✅ 完整测试覆盖

**新增代码**: 6,566 行
**新增组件**: 12 个

---

### v0.21.0 (2026-01-12)

**知识图谱可视化**:

- ✅ 8个图分析算法
  - PageRank
  - 度中心性、接近中心性、中介中心性
  - Louvain社区检测
  - K-means聚类
  - 关键节点识别
  - 图谱统计分析

- ✅ 5种可视化方式
  - 2D可视化（力导向/环形/层级布局）
  - 3D可视化（WebGL渲染）
  - 时间轴可视化
  - 热力图可视化
  - 综合分析面板

- ✅ 智能实体提取
  - 9种实体类型
  - 8种关系类型
  - 基于规则 + LLM 双模式

- ✅ 6种导出格式
  - JSON、GraphML、GEXF、DOT、CSV、HTML

**企业版 DID 邀请链接系统**:

- ✅ 安全令牌生成（32字节随机）
- ✅ 灵活使用控制（单次/多次/无限制）
- ✅ 过期时间管理
- ✅ 权限控制（基于角色）
- ✅ 使用记录追踪
- ✅ 统计分析

**移动端增强**:

- ✅ Markdown渲染（代码高亮/图片预览）
- ✅ 工具栏支持
- ✅ 实时预览
- ✅ 图片上传
- ✅ 自动保存草稿

---

### v0.20.0 (2026-01-11)

**语音识别完善**:

- ✅ Whisper集成测试通过（100%准确度/2.5x实时速度）
- ✅ 语音设置UI完成
- ✅ 支持本地/云端识别

**PC端核心功能**:

- ✅ 多语言支持（中/英/日/韩）
- ✅ STUN/TURN网络测试
- ✅ 系统设置优化
- ✅ 性能监控增强

**P2P通信完善**:

- ✅ WebRTC语音/视频通话完整实现
- ✅ 屏幕共享支持
- ✅ MediaStream桥接
- ✅ Signal Protocol高级测试
- ✅ 信令服务器优化

**文档结构重构**:

- ✅ 重新组织文档目录结构
- ✅ 提升可维护性和可读性
- ✅ 新增测试报告

---

### v0.20.0 (2026-01-03)

**测试框架升级**:

- ✅ 全面迁移到Vitest（94个测试文件/900+用例）
- ✅ 性能优化集成完成

**性能优化**:

- ✅ 内存降级
- ✅ 磁盘检查
- ✅ 并发控制
- ✅ 文件恢复

**新增测试**:

- ✅ Git模块测试
- ✅ 文件权限测试
- ✅ 合约引擎测试
- ✅ 桥接管理测试

**其他**:

- ✅ 安全防护体系
- ✅ 移动端数据同步
- ✅ Linux平台完整支持

---

### v0.19.5 (2026-01-02)

**P2优化**:

- ✅ 意图融合（927行）
- ✅ 知识蒸馏（668行）
- ✅ 流式响应（684行）
- ✅ 任务分解增强
- ✅ 工具组合系统
- ✅ 历史记忆优化

**性能提升**:

- LLM调用减少 58%
- 感知延迟降低 93%
- 计算成本节省 28%

**V3工具系统恢复**:

- ✅ 工具总数扩展至300个
- ✅ 恢复28个专业领域工具
- ✅ 覆盖区块链/财务/CRM等9大领域

**应用菜单集成**:

- ✅ 原生应用菜单支持
- ✅ MenuManager管理器
- ✅ 20+个IPC通道
- ✅ 高级特性控制面板

---

### v0.19.0 (2025-12-31)

**代码库完善与优化**:

- ✅ 更新项目文档
- ✅ 优化模板配置
- ✅ 完善测试套件（62个测试文件）
- ✅ 代码库重构优化

---

### v0.18.0 (2025-12-30)

**企业版（去中心化组织）**:

- ✅ 多身份架构
- ✅ RBAC权限系统
- ✅ 组织管理（创建/加入/成员管理）
- ✅ 数据库隔离（9个新表）
- ✅ 组织DID支持

**技能工具系统扩展**:

- ✅ 第6-10批扩展完成
- ✅ 115个技能
- ✅ 300个工具
- ✅ 涵盖10大类别

**测试框架**:

- ✅ Playwright测试框架
- ✅ 94个测试文件
- ✅ 900+测试用例
- ✅ Vitest框架迁移

**多数据库隔离**:

- ✅ 个人数据库 + 多个组织数据库
- ✅ 数据完全隔离
- ✅ 动态切换

---

### v0.17.0 (2025-12-29)

**区块链集成 Phase 1-3**:

- ✅ 智能合约系统（6个合约 + 测试 + 部署）
  - ChainlessToken (ERC20)
  - ChainlessNFT (ERC721)
  - EscrowContract (托管)
  - SubscriptionContract (订阅)
  - BountyContract (悬赏)
  - AssetBridge (跨链桥)

- ✅ 钱包系统
  - 内置HD钱包
  - MetaMask集成
  - WalletConnect支持

- ✅ Hardhat开发环境

**其他**:

- ✅ 技能工具系统
- ✅ 插件系统
- ✅ 浏览器扩展
- ✅ 语音识别Phase 3

---

### v0.16.0 (2025-12-28)

**Phase 3 完成 - 去中心化交易系统**:

- ✅ 8大交易模块（5625+行代码）
  - 数字资产管理（1,052行）
  - 交易市场（773行）
  - 智能合约引擎（1,871行）
  - 托管服务（592行）
  - 知识付费（896行）
  - 信用评分（637行）
  - 评价系统（671行）
  - 订单管理

- ✅ 19个AI专用引擎
- ✅ 完整后端服务体系
  - Project Service（48 API）
  - AI Service（38 API）
  - Community Forum（63 API）

- ✅ 145个Vue组件
- ✅ 数据库同步
- ✅ 测试框架

---

### v0.11.0 (2025-12-18)

**图片处理功能**:

- ✅ 图片上传支持
- ✅ OCR识别（Tesseract.js + Sharp）
- ✅ 支持中英文识别
- ✅ 图片压缩和格式转换

---

### v0.10.0 (2025-12)

**RAG 增强**:

- ✅ 3种重排序算法
  - LLM重排序
  - CrossEncoder
  - 混合重排序

- ✅ 3种查询重写策略
  - 多查询生成
  - HyDE（假设文档嵌入）
  - 逐步回溯

---

### v0.9.0 (2025-11)

**文件导入功能完善**:

- ✅ PDF文件导入
- ✅ Word文档导入
- ✅ TXT文本导入
- ✅ Markdown导入优化

---

### v0.8.0 (2025-11)

**可验证凭证系统**:

- ✅ W3C VC标准实现
- ✅ 5种凭证类型
  - 自我声明
  - 技能证书
  - 信任背书
  - 教育凭证
  - 工作经历

- ✅ 签名和验证
- ✅ 凭证生命周期管理
- ✅ 撤销机制

---

### v0.6.1 (2025-10)

**DHT 网络发布**:

- ✅ DID文档发布到DHT
- ✅ DHT查询和解析
- ✅ 缓存机制
- ✅ 自动更新

---

### v0.4.0 (2025-09)

**Git 功能增强**:

- ✅ Git冲突解决
- ✅ 可视化冲突界面
- ✅ AI自动生成提交消息
- ✅ Git同步优化

---

### v0.1.0 (2025-08)

**首个 MVP 版本**:

- ✅ 基础知识库管理
- ✅ SQLCipher加密数据库
- ✅ U盾集成
- ✅ Markdown编辑器
- ✅ 基础AI对话
- ✅ 本地LLM支持（Ollama）

---

## 版本对比

### v0.26.0 vs v0.25.0

- 新增统一日志系统（700+迁移）
- 新增Android P2P UI（8屏幕）
- 新增内存泄漏防护（4层机制）
- 代码结构重构
- 测试稳定性提升

### v0.22.0 vs v0.21.0

- 区块链集成完成（15链支持）
- 新增6,566行代码
- 新增12个UI组件
- RPC管理系统
- 事件监听系统

### v0.20.0 vs v0.19.5

- 测试框架升级到Vitest
- 新增900+测试用例
- Linux平台支持完成
- 移动端数据同步

---

## 升级指南

### 从 v0.25.0 升级到 v0.26.0

1. **备份数据**

   ```bash
   cp -r data data.backup
   cp -r .chainlesschain .chainlesschain.backup
   ```

2. **下载新版本**
   - 下载对应平台的安装包

3. **安装/解压**
   - 按照安装指南操作

4. **数据迁移**
   - 数据会自动迁移
   - 如有问题，恢复备份

5. **验证功能**
   - 检查日志系统是否正常
   - 测试P2P连接
   - 验证数据完整性

### 从 v0.21.0 之前版本升级

建议先升级到 v0.22.0，再逐步升级到最新版本。

---

## 路线图

### 已完成

- [x] Phase 1: 知识库管理（100%）
- [x] Phase 2: 去中心化社交（100%）
- [x] Phase 3: 去中心化交易（100%）
- [x] Phase 4: 区块链集成（100%）
- [x] Phase 5: 生态完善（100%）
- [x] Phase 6: 企业版（100%）
- [x] Phase 41: EvoMap GEP-A2A（100%）
- [x] Phase 42-45: Social AI + Compliance + SCIM + Unified Key（100%）
- [x] Phase 46-51: 门限签名 + BLE + 推荐 + Nostr + DLP + SIEM（100%）
- [x] Phase 52-56: PQC + OTA + 治理 + Matrix + Terraform（100%）

### 计划中

- [ ] Phase 57+: 下一代功能扩展

---

## 相关文档

- [返回主文档](../README.md)
- [功能详解](./FEATURES.md)
- [安装指南](./INSTALLATION.md)
- [开发指南](./DEVELOPMENT.md)
