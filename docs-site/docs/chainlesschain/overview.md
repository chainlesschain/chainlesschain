# ChainlessChain 系统概述

> **当前版本: v5.0.2.9 进化版 | 138桌面技能 + 28 Android技能 | 102 Phase | AI Agent 2.0 + Web3深化 + 企业平台 + 自进化AI + CLI 64命令/5517+测试 + Agent Context Engineering + Autonomous Agent + EvoMap + 10 LLM Providers + 3 Proxy Relays + Task Model Selector + CLI-Anything Integration + WebSocket Server + Sub-Agent Isolation v2 + Phase 7-8 企业CLI + Persona系统 + Web UI管理面板 + AI Orchestration编排层 + Hashline哈希锚定编辑 + Skill-Embedded MCP + Category Routing类别路由 + Canonical Tool Descriptor工具描述规范 + Coding Agent Envelope Protocol + Sub-Runtime Pool子运行时池**

## 概述

ChainlessChain 是一个完全去中心化的个人 AI 管理系统，整合知识库管理、去中心化社交和交易辅助三大核心功能。系统通过 U-Key/SIMKey 硬件加密和本地 AI 模型提供军事级隐私保护，支持 138 个桌面内置技能、28 个 Android 技能、64 个 CLI 命令以及 14+ 云端 LLM 和本地 Ollama 模型集成。

**v5.0.2.x新增**: CLI进化版 — Hashline哈希锚定行编辑（内容哈希替代行号，抗格式化漂移）、Hooks三件套（SessionStart/UserPromptSubmit/SessionEnd会话级钩子触发）、Skill-Embedded MCP（技能内联MCP服务器按需mount/unmount）、Category Routing类别路由（5类别quick/deep/reasoning/vision/creative自动匹配provider）、Canonical Tool Descriptor工具描述规范统一（inputSchema为真源，parameters只读镜像）、Coding Agent Envelope Protocol（统一WS信封协议，dot-case类型，requestId关联）、Sub-Runtime Pool子运行时池（Electron主进程子进程spawn，sessionId分片）、Web UI管理面板（HTTP 18810端口，项目/全局双模式）、AI Orchestration编排层（Claude Code/Codex/多Agent路由，5种策略）、AI Doc Creator模板（doc-generate/libre-convert/doc-edit三技能）、CLI Skill Packs（9个领域技能包，sync-cli命令自动生成）。

**v1.1.0新增**: 全栈智能化 — Cowork v3.0 全自动开发流水线（需求→部署DAG编排）、v3.1 自然语言编程（NL→代码9步翻译）、v3.2 多模态协作（音频/图像/文档/屏幕/文本五模态融合）、v3.3 自主运维（告警/Playbook/事故报告）、v4.0 去中心化代理网络（Agent DID/联邦发现/跨组织协作/信誉系统）。**Q2 2026主线升级** — Phase 42: AI社交助手增强（话题分析/关系图谱/上下文回复）+ActivityPub桥接（双向互通Mastodon/Misskey）、Phase 43: SOC2合规包（自动证据收集）+数据分类分级（PII/PHI/PCI）、Phase 44: SCIM 2.0用户同步（Azure AD/Okta）、Phase 45: 统一密钥管理（U盾+SIMKey+TEE三端统一）+FIDO2 WebAuthn（无密码登录）+跨平台USB驱动（macOS/Linux）。共新增44个后端模块、118个IPC处理器、9个前端页面、7个Pinia Store、23张数据库表。**Q3 2026安全与社交增强** — Phase 46: 门限签名（Shamir 2-of-3）+生物特征绑定（TEE）、Phase 47: BLE U-Key（GATT蓝牙通信）、Phase 48: 内容推荐（本地兴趣画像/协同过滤）、Phase 49: Nostr桥接（NIP-01/02/04）、Phase 50: 数据防泄漏DLP（策略引擎/拦截审计）、Phase 51: SIEM集成（CEF/LEEF/JSON导出）。**代码质量** — 全项目ES6模块迁移，Node.js协议导入规范化。

## 核心特性

- 📝 **知识库管理**: 个人第二大脑，Markdown 编辑 + RAG 语义搜索 + 知识图谱 + AI 智能摘要
- 🤖 **AI 智能引擎**: 16 个专用引擎 + 138 内置技能 + 14+ 云 LLM + Ollama 本地模型 + Cowork 多智能体 + AI Orchestration编排
- 🔐 **军事级安全**: U-Key/SIMKey 硬件加密 + Signal E2E + 后量子密码(PQC) + 零知识证明
- 🌐 **去中心化社交**: W3C DID 身份 + P2P 加密通信 + WebRTC 音视频 + ActivityPub 联邦
- 🏢 **企业级平台**: RBAC 权限 + SSO 认证 + 审计合规 + 组织管理 + SCIM 同步
- 💾 **数据主权**: 本地优先存储 + Git 同步 + IPFS 去中心化 + 完全用户控制

## 系统架构

```
┌─────────────────────────────────────────────┐
│              用户界面层                       │
│  PC(Electron) / Android / iOS / Web / CLI   │
└───────────────────┬─────────────────────────┘
                    │ IPC / REST
┌───────────────────▼─────────────────────────┐
│              AI 智能层                        │
│  Cowork多Agent │ Skills(138) │ Plan Mode    │
│  RAG搜索      │ LLM(14+)    │ Agent任务    │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│              业务逻辑层                       │
│  知识库 │ 社交P2P │ 交易 │ 企业管理         │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│              基础服务层                       │
│  SQLite/SQLCipher │ Git │ IPFS │ MCP        │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│              安全硬件层                       │
│  U-Key │ SIMKey │ TEE │ PQC(ML-KEM/DSA)    │
└─────────────────────────────────────────────┘
```

**v1.0.0新增**: 企业级 - 企业组织管理（多层级部门/审批流）、实时协作编辑（CRDT/Yjs P2P同步）、IPFS去中心化存储（嵌入式Helia/外部Kubo）、高级数据分析仪表盘（实时KPI/时间序列/报告导出）、AI Agent自主任务执行（ReAct循环/暂停恢复/检查点）、多语言国际化（zh-CN/en-US/fr-FR/es-ES）、性能监控和自动调优（5规则引擎/自动优化）、74个新IPC处理器。**社交平台全面升级** - P2P语音/视频通话（WebRTC+SFU）、共享加密相册、社区/频道（Gossip+治理投票）、协作编辑文档（Yjs CRDT）、朋友圈时光机（AI回忆生成）、去中心化直播（弹幕+录制）、匿名模式/社交代币/Mesh离线社交、AI社交助手，以及5个全新Cowork协作演化技能（共138个内置技能）。

## 项目统计

| 指标        | 数值                                    |
| ----------- | --------------------------------------- |
| 代码总行数  | 400,000+                                |
| Vue组件数   | 564+个                                  |
| IPC处理器   | 735+ (+178 v5.0)                        |
| 测试用例    | 5,517+ (桌面+CLI+Android)               |
| AI专用引擎  | 16个                                    |
| 内置技能    | 138个                                   |
| 统一工具    | 60+ FunctionCaller + 8 MCP + 138 Skills |
| Pinia Store | 99个                                    |
| 数据库表    | 95+张                                   |
| CLI命令     | 64个                                    |
| CLI版本     | v0.45.76                                |
| 钩子事件    | 32个 (4种类型)                          |
| 开发阶段    | Phase 1-102 完成                        |
| 演示模板    | 10个                                    |
| 浏览器命令  | 215个                                   |
| CLI技能包   | 9个领域包 (101测试)                     |

## 系统定位

ChainlessChain旨在成为用户的"第二大脑"和数字资产管理中心：

- 📝 **知识管理中心**: 个人笔记、文档、对话历史的统一管理，8个图分析算法
- 🤖 **AI智能助手**: 16个专用引擎 + 14+云LLM提供商 + Ollama本地部署 + AI Orchestration编排
- 🔐 **安全钱包**: 硬件加密的数字资产管理，6个智能合约
- 🌐 **去中心化社交**: P2P通信，WebRTC语音/视频，群聊，消息转发
- 💾 **数据主权**: 完全掌控自己的数据，不依赖第三方
- 🔌 **MCP集成**: Model Context Protocol，5个官方服务器
- 🤖 **Cowork协作**: 多智能体协作系统，智能任务分配，文件沙箱安全
- 🖥️ **Computer Use**: 类似Claude Computer Use的电脑操作能力，视觉AI定位
- 🌐 **浏览器插件**: 215个远程命令，完整浏览器自动化控制
- 🎭 **Persona 系统**: 项目级 AI 角色配置（7 种模板），自动替换默认编码助手，工具权限控制
- 🧩 **技能系统**: 138个内置技能，Agent Skills开放标准，四层加载架构
- 🪝 **Hooks扩展**: 32个钩子事件，4种类型，会话级三件套，自定义逻辑注入
- 🧠 **永久记忆**: 跨会话持久化，Daily Notes，混合搜索引擎
- 🏢 **企业版**: SSO认证、RBAC权限、审计合规、插件市场、专业化Agent

## 核心功能

### 📚 知识库管理

构建个人第二大脑，统一管理所有知识资产。

#### 笔记和文档

- **Markdown编辑器**: 所见即所得的Markdown编辑
- **富文本支持**: 图片、表格、代码块、LaTeX公式
- **标签分类**: 灵活的标签系统，多维度组织内容
- **全文搜索**: 毫秒级全文搜索，支持中英文分词
- **版本控制**: 基于Git的完整版本历史

#### AI增强功能

- **智能摘要**: AI自动生成文档摘要
- **智能问答**: 基于知识库的AI问答
- **内容生成**: AI辅助写作和内容创作
- **关系图谱**: 自动构建知识关联图谱
- **语义搜索**: 基于语义的智能搜索

#### 多媒体支持

- **图片管理**: 图片存储和预览
- **文档导入**: 支持PDF、Word、Excel等格式
- **网页剪藏**: 浏览器插件一键保存网页
- **代码片段**: 语法高亮的代码管理

[详细了解知识库管理 →](/chainlesschain/knowledge-base)

---

### 💬 去中心化社交

基于W3C DID标准的完全去中心化社交网络。

#### DID身份

- **去中心化标识符**: 基于W3C DID标准
- **自主身份**: 完全掌控自己的身份
- **多设备支持**: 一个DID可关联多个设备
- **隐私保护**: 可选择性公开身份信息

#### P2P通信

- **端到端加密**: Signal协议端到端加密
- **P2P直连**: 点对点通信，无需服务器中转
- **离线消息**: 支持离线消息暂存和推送
- **多种消息类型**: 文本、图片、文件、语音、视频

#### 社交功能

- **好友管理**: 通过DID添加和管理好友
- **群组聊天**: 支持加密的群组通信
- **朋友圈**: 去中心化的动态分享
- **文件传输**: P2P大文件传输

#### 隐私控制

- **选择性公开**: 精细控制信息可见性
- **匿名模式**: 支持匿名发言和浏览
- **数据加密**: 所有数据端到端加密
- **无追踪**: 不记录用户行为数据

[详细了解去中心化社交 →](/chainlesschain/social)

---

### 💰 交易辅助

安全便捷的数字资产管理和交易辅助。

#### 硬件钱包集成

- **U盾集成**: 支持各类U盾硬件
- **SIMKey集成**: SIM卡密钥存储，iOS eSIM，5G优化，NFC离线签名，量子抗性
- **多链支持**: Ethereum、Bitcoin、Polygon等
- **私钥保护**: 私钥永不离开硬件设备

#### 钱包功能

- **多币种支持**: 主流加密货币和代币
- **地址管理**: HD钱包，无限地址生成
- **余额查询**: 实时余额和价格查询
- **交易历史**: 完整的交易记录

#### 智能合约

- **合约交互**: 图形化界面调用智能合约
- **合约部署**: 一键部署智能合约
- **ABI管理**: 智能合约ABI管理
- **事件监听**: 实时监听链上事件

#### DeFi集成

- **Swap交易**: 去中心化交易所集成
- **流动性挖矿**: 收益农场管理
- **NFT管理**: NFT展示和交易
- **DAO治理**: 参与DAO投票

#### 交易辅助增强 (v0.40.0新增)

- **拍卖系统**: 英式/荷兰式拍卖，出价托管，买断价支持，自动结算
- **团购/拼单**: 目标价格达成即成交，多人合力享受更低价格
- **分期付款**: 信用评级审批，灵活分期，逾期健康检查
- **闪电网络支付**: 支付通道，发票系统，多跳路由

#### 去中心化金融 (v0.40.0新增)

- **P2P信用借贷**: 基于去中心化信誉的借贷池，动态利率，LTV监控，抵押品清算
- **DAO保险池**: 去中心化保险池，质押贡献，DAO投票理赔裁决
- **跨链原子互换**: HTLC哈希时间锁，无信任跨链交换，订单匹配，汇率发现

[详细了解交易辅助 →](/chainlesschain/trading)

---

### 🤖 Cowork多智能体协作 (v0.27.0新增)

企业级多智能体协作系统，实现智能任务分配和团队协作。

#### 核心能力

- **智能编排**: AI驱动的单/多代理决策，自动选择最优执行策略
- **团队协作**: 13个核心操作（创建团队/分配任务/投票决策等）
- **文件沙箱**: 18+敏感文件模式检测，5层防御架构，零关键漏洞
- **长时任务**: 检查点/恢复机制，支持任务暂停和恢复
- **技能系统**: Office文档处理（Excel/Word/PPT）、数据分析等专业技能

#### 性能指标

| 操作     | 响应时间 | 状态 |
| -------- | -------- | ---- |
| 创建团队 | < 45ms   | ✅   |
| 添加代理 | < 15ms   | ✅   |
| 分配任务 | < 25ms   | ✅   |
| 权限检查 | < 3ms    | ✅   |
| 投票决策 | < 35ms   | ✅   |

#### 前端组件

- **CoworkDashboard**: 全局统计、团队管理
- **TaskMonitor**: 任务监控、进度跟踪
- **SkillManager**: 技能管理、执行历史

#### 安全特性

- **文件安全**: 敏感文件检测、路径遍历防护
- **权限控制**: 细粒度READ/WRITE/EXECUTE权限
- **审计日志**: 100%操作记录和完整性检查
- **数据加密**: SQLCipher AES-256加密

[详细了解Cowork系统 →](/chainlesschain/cowork)

---

### 🖥️ Computer Use电脑操作 (v0.33.0新增)

类似Anthropic Claude Computer Use的电脑操作能力，让AI能够真正"看到"和"操作"您的电脑。

#### 核心能力

- **CoordinateAction**: 像素级坐标点击、拖拽、手势操作
- **VisionAction**: Vision AI集成，视觉元素定位，支持Claude/GPT-4V/LLaVA
- **DesktopAction**: 桌面级截图、鼠标键盘控制、窗口管理
- **NetworkInterceptor**: 网络请求拦截、模拟、条件控制

#### 高级功能

| 模块           | 功能                                   | IPC处理器 |
| -------------- | -------------------------------------- | --------- |
| AuditLogger    | 操作审计，风险评估，敏感信息脱敏       | 5         |
| ScreenRecorder | 屏幕录制为截图序列，暂停/恢复/导出     | 10        |
| ActionReplay   | 操作回放，变速、单步、断点调试         | 8         |
| SafeMode       | 安全模式，权限控制、区域限制、速率限制 | 7         |
| WorkflowEngine | 工作流引擎，条件分支、循环、并行执行   | 11        |

#### AI工具集成

12个工具可供AI调用：

- `browser_click`, `visual_click` - 点击操作
- `browser_type`, `browser_key` - 输入操作
- `browser_scroll`, `browser_screenshot` - 滚动和截图
- `analyze_page`, `browser_navigate` - 页面分析和导航
- `desktop_screenshot`, `desktop_click`, `desktop_type` - 桌面操作

[详细了解Computer Use →](/chainlesschain/computer-use)

---

### 🌐 浏览器插件 (v0.29.0+)

ChainlessChain Desktop的浏览器扩展组件，提供完整的浏览器自动化和远程控制能力。

#### 核心统计

| 类别     | 命令数  | 说明                                |
| -------- | ------- | ----------------------------------- |
| 标签管理 | 8       | 创建、关闭、导航、焦点控制          |
| 页面操作 | 5       | 截图、执行脚本、导出PDF             |
| DOM操作  | 40+     | 点击、输入、选择、等待              |
| 网络拦截 | 10+     | 请求拦截、Mock、限流                |
| 调试工具 | 70+     | WebSocket、Service Worker、内存分析 |
| 设备模拟 | 20+     | 触摸、传感器、地理位置              |
| **总计** | **215** | 完整的浏览器控制能力                |

#### 安装方式

1. 打开浏览器扩展页面（`chrome://extensions`）
2. 开启开发者模式
3. 加载已解压的扩展程序
4. 选择 `browser-extension` 文件夹

#### 支持的浏览器

- Chrome 88+
- Edge 88+
- Arc
- Brave
- Opera

[详细了解浏览器插件 →](/chainlesschain/browser-extension)

---

### 🔐 安全机制

军事级的安全保护，确保数据和资产安全。

#### 硬件级加密

- **U盾加密**: 基于国密SM2/SM3/SM4算法
- **SIMKey加密**: SIM卡安全单元 + iOS eSIM + 后量子密码学
- **TEE支持**: Trusted Execution Environment
- **生物识别**: 指纹、面部识别集成

#### 数据加密

- **端到端加密**: 所有通信端到端加密
- **本地加密存储**: AES-256-GCM加密
- **零知识证明**: 服务端无法解密数据
- **安全删除**: 军事级数据擦除

#### 权限管理

- **细粒度权限**: 精确控制应用权限
- **多因素认证**: 密码+硬件+生物识别
- **会话管理**: 自动超时和强制登出
- **审计日志**: 完整的操作日志

[详细了解安全机制 →](/chainlesschain/encryption)

---

### 🧠 本地AI模型

完全本地运行的AI模型，隐私保护的智能服务。

#### 支持的模型

- **Ollama**: 便捷的本地模型管理
- **LLaMA 3**: Meta开源大语言模型
- **Qwen**: 阿里通义千问开源模型
- **GLM**: 清华智谱开源模型
- **自定义模型**: 支持导入自定义模型

#### AI功能

- **对话问答**: 基于上下文的智能对话
- **文档理解**: 阅读和理解长文档
- **内容生成**: 文章、代码、创意写作
- **翻译**: 多语言翻译
- **摘要提取**: 自动提取文档摘要

#### RAG检索增强

- **知识库索引**: 自动索引个人知识库
- **向量检索**: 基于语义的相似度检索
- **上下文增强**: 结合知识库的回答
- **引用来源**: 显示回答的知识来源

[详细了解AI模型配置 →](/chainlesschain/ai-models)

---

### 🔄 Git同步

基于Git的跨设备数据同步和版本控制。

#### Git集成

- **自动提交**: 修改自动提交到Git
- **版本历史**: 完整的修改历史
- **分支管理**: 支持Git分支操作
- **冲突解决**: 可视化的冲突解决工具

#### 多设备同步

- **自动同步**: 后台自动拉取和推送
- **选择性同步**: 选择要同步的内容
- **离线支持**: 离线修改，联网后同步
- **冲突处理**: 智能合并冲突

#### 备份恢复

- **自动备份**: 定时自动备份到Git
- **远程仓库**: 支持GitHub、GitLab等
- **加密备份**: 推送前加密敏感数据
- **快速恢复**: 从Git恢复数据

[详细了解Git同步 →](/chainlesschain/git-sync)

---

### 🧩 AI技能系统 (v0.29.0+)

可扩展的技能框架，138个内置技能覆盖开发、文档、安全、媒体等全场景。

#### 技能概览

| 分类     | 技能数 | 示例                                                        |
| -------- | ------ | ----------------------------------------------------------- |
| 开发工具 | 22     | code-review, test-generator, refactor, code-runner          |
| 文档处理 | 8      | pdf-toolkit, word-generator, pptx-creator, doc-converter    |
| 媒体处理 | 7      | audio-transcriber, video-toolkit, image-editor, ocr-scanner |
| DevOps   | 8      | devops-automation, log-analyzer, system-monitor             |
| 安全审计 | 4      | security-audit, vulnerability-scanner, crypto-toolkit       |
| AI增强   | 5      | prompt-enhancer, multi-model-router, image-generator        |
| 自动化   | 4      | browser-automation, computer-use, workflow-automation       |
| 数据分析 | 5      | data-analysis, chart-creator, csv-processor                 |
| 知识管理 | 6      | knowledge-graph, memory-management, codebase-qa             |
| 实用工具 | 21     | json-yaml-toolkit, regex-playground, http-client            |

#### 核心架构

- **四层加载**: bundled → marketplace → managed → workspace（高层覆盖低层）
- **Gate检查**: 平台、二进制依赖、环境变量前置校验
- **Agent Skills开放标准**: 13个扩展字段（tools, instructions, examples, dependencies, input-schema, output-schema, model-hints等）
- **统一工具注册表**: FunctionCaller 60+ 工具 + MCP 8 服务器 + Skills 95 技能
- **/skill命令**: 用户命令解析和自动执行
- **Android端**: 28个技能（含PC远程委托），SkillRegistry支持LLM function calling

#### 演示模板

10个演示项目模板，涵盖自动化、AI工作流、知识管理、远程控制四大场景。

[详细了解技能系统 →](/chainlesschain/skills)

---

### 🔌 MCP集成 (v0.29.0+)

Model Context Protocol标准化AI工具集成，支持社区服务器发现和自定义SDK开发。

#### 支持的服务器

| 服务器       | 功能         | 类型 |
| ------------ | ------------ | ---- |
| Filesystem   | 文件系统操作 | 官方 |
| PostgreSQL   | 数据库查询   | 官方 |
| SQLite       | 本地数据库   | 官方 |
| Git          | 版本控制操作 | 官方 |
| Brave Search | 网络搜索     | 社区 |
| Puppeteer    | 浏览器自动化 | 社区 |
| Slack        | 团队通讯     | 社区 |
| GitHub       | 代码仓库管理 | 社区 |

#### MCP SDK

- **Server Builder**: 流式API (`new MCPServerBuilder().name().tool().build()`)
- **HTTP+SSE Server**: HTTP服务器，SSE流式传输，CORS，Bearer/API-Key/Basic认证
- **Stdio Server**: 行分隔JSON-RPC 2.0，stdin/stdout通信
- **社区注册表**: 8+预配置社区MCP服务器，一键安装

#### 安全架构

- 纵深防御安全模型
- 工具级权限控制
- 审计日志全覆盖

---

### 🪝 Hooks扩展系统 (v0.27.0+)

受Claude Code启发的可扩展钩子系统，在关键操作点注入自定义逻辑。

#### 钩子能力

- **32个钩子事件**: PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, FileModified, IterationBudgetExhausted等
- **4种钩子类型**: Sync（同步）, Async（异步）, Command（Shell命令）, Script（JS/Python/Bash脚本）
- **优先级系统**: SYSTEM(0) → HIGH(100) → NORMAL(500) → LOW(900) → MONITOR(1000)
- **中间件集成**: IPC、Tool、Session、File、Agent中间件工厂
- **脚本钩子**: 自动加载 `.chainlesschain/hooks/*.js`

[详细了解Hooks系统 →](/chainlesschain/hooks)

---

### 🧠 永久记忆系统 (v0.26.2+)

跨会话持久化记忆，灵感源自Clawdbot架构，确保AI助手保持长期上下文。

#### 核心功能

- **Daily Notes**: 自动记录每日活动到 `.chainlesschain/memory/daily/YYYY-MM-DD.md`
- **MEMORY.md**: 长期知识提取和持久洞察
- **Pre-compaction Flush**: 上下文压缩前自动保存（防止数据丢失）
- **混合搜索**: 向量语义(0.6权重) + BM25关键词(0.4权重) + RRF融合
- **自动索引**: 文件监听（1.5s去抖），自动重建索引
- **嵌入缓存**: SQLite缓存，避免重复计算

#### Context Engineering

KV-Cache优化系统，提升LLM性能：

- **静态/动态分离**: 静态内容前置，缓存命中率60-85%
- **任务上下文管理**: 目标重述，防止"lost in the middle"
- **错误历史追踪**: 从过去错误中学习
- **Token估算**: 中英文自动检测

[详细了解会话管理 →](/chainlesschain/session-manager)

---

### 🏢 企业级功能 (v0.34.0+)

面向企业的安全合规、身份认证和扩展能力。

#### 企业审计与合规

- **统一审计日志**: 跨子系统审计事件聚合（浏览器、权限、文件、API、Cowork）
- **合规管理**: GDPR/SOC2/HIPAA合规检查，策略引擎，报告生成
- **数据主体处理**: GDPR DSR请求（访问、擦除、更正、可携带性）
- **18个IPC处理器**: 审计日志、合规策略、DSR、数据保留策略全覆盖

#### SSO企业认证

- **多提供商SSO**: SAML 2.0、OAuth 2.0、OIDC，支持PKCE
- **身份桥接**: DID ↔ SSO身份双向链接
- **加密会话**: AES-256-GCM令牌加密存储，自动刷新
- **20个IPC处理器**: 提供商配置、认证流程、身份链接、会话管理

#### 权限引擎 (Enterprise RBAC)

- **资源级权限**: 个体资源细粒度访问控制
- **权限继承**: 父子资源权限传播
- **权限委派**: 带时间边界的临时权限授予
- **团队权限**: 基于团队成员的访问控制
- **审计日志**: 完整权限变更历史

[详细了解权限系统 →](/chainlesschain/permissions)

#### 插件市场

- **市场客户端**: HTTP客户端，DID认证，REST API
- **插件安装**: 下载、哈希校验、解压、SkillLoader注册
- **插件更新**: 后台更新检查，自动更新通知
- **22个IPC处理器**: 浏览、安装、卸载、更新、评分、发布、配置

#### 专业化多Agent系统

- **8个Agent模板**: CodeSecurity, DevOps, DataAnalysis, Documentation, TestGenerator, Architect, Performance, Compliance
- **Agent协调器**: 多Agent任务分解、分配、结果聚合
- **Agent注册表**: 类型注册、工厂、版本管理、实例生命周期

---

### 🏗️ 企业组织管理 (v1.0新增)

多层级企业组织架构和审批流引擎。

#### 核心功能

- **部门管理**: 创建/编辑/删除部门，部门嵌套层级，循环引用检测
- **组织层级树**: BFS遍历构建完整组织层级，仪表盘统计
- **成员管理**: 批量导入成员，部门调动，角色分配
- **审批工作流**: 成员加入审批，集成ApprovalWorkflowManager
- **10个IPC处理器**: 部门CRUD、层级查询、成员管理、仪表盘

#### 技术实现

| 模块                 | 文件                                        | 说明         |
| -------------------- | ------------------------------------------- | ------------ |
| EnterpriseOrgManager | `main/enterprise/enterprise-org-manager.js` | 核心管理器   |
| Enterprise IPC       | `main/enterprise/enterprise-ipc.js`         | IPC处理器    |
| Pinia Store          | `renderer/stores/enterprise-org.ts`         | 前端状态管理 |

---

### 📝 实时协作编辑 (v1.0新增)

基于CRDT的P2P实时协作编辑系统，支持多人同时编辑同一文档。

#### 核心功能

- **CRDT引擎**: 基于Yjs实现无冲突复制数据类型
- **P2P同步**: 通过libp2p自定义协议同步编辑状态和感知信息
- **段落锁定**: 支持全文/段落/区域锁定，带超时自动释放
- **冲突解决**: 记录冲突历史，支持我的/对方的/合并/自定义四种策略
- **评论线程**: 内联评论，支持打开/已解决状态
- **版本历史**: 基于knowledge_snapshots表的版本管理和恢复
- **21个IPC处理器**: 文档打开/关闭、同步、游标、锁定、冲突、评论、历史、导出

#### 数据库表

`collaboration_sessions`, `collab_cursor_positions`, `collab_document_locks`, `collab_conflict_history`, `knowledge_yjs_updates`, `knowledge_comments`, `collab_stats`

---

### 💾 去中心化存储 IPFS (v1.0新增)

IPFS去中心化存储集成，支持嵌入式和外部节点双模式。

#### 核心功能

- **双模式运行**: 嵌入式Helia节点（自动启动）或外部Kubo守护进程（HTTP连接）
- **加密存储**: AES-256-GCM加密后上传，密钥本地保存
- **配额管理**: 默认1GB存储配额，使用率监控
- **Pin管理**: 内容固定/取消固定，垃圾回收
- **知识库集成**: 知识库附件直接存储到IPFS，CID关联
- **18个IPC处理器**: 节点启停、上传下载、Pin管理、配额、GC

#### 技术架构

| 模式   | 依赖                                | 说明             |
| ------ | ----------------------------------- | ---------------- |
| 嵌入式 | helia, blockstore-fs, @helia/unixfs | 内置IPFS节点     |
| 外部   | Kubo HTTP API (127.0.0.1:5001)      | 连接本地守护进程 |

---

### 📊 高级数据分析仪表盘 (v1.0新增)

统一指标聚合和实时数据分析仪表盘。

#### 核心功能

- **四源聚合**: TokenTracker(AI调用) + SkillMetrics(技能执行) + ErrorMonitor(错误监控) + PerformanceMonitor(系统性能)
- **实时推送**: 5秒间隔实时推送快照到前端
- **时间序列**: 按小时/天粒度聚合，支持自定义时间范围查询
- **TopN排行**: 最热技能、最常用模型、最频繁错误
- **报告导出**: JSON/CSV格式报告生成
- **数据保留**: 默认90天自动清理
- **16个IPC处理器**: 摘要、时间序列、TopN、报告、清理

#### KPI指标

| 指标             | 来源               | 说明         |
| ---------------- | ------------------ | ------------ |
| totalAICalls     | TokenTracker       | AI调用总次数 |
| totalTokens      | TokenTracker       | Token消耗量  |
| tokenCost        | TokenTracker       | 估算成本     |
| skillExecutions  | SkillMetrics       | 技能执行次数 |
| skillSuccessRate | SkillMetrics       | 技能成功率   |
| errorCount       | ErrorMonitor       | 错误数量     |
| cpuUsage         | PerformanceMonitor | CPU使用率    |
| memoryUsage      | PerformanceMonitor | 内存使用率   |

---

### 🤖 AI Agent自主任务执行 (v1.0新增)

基于ReAct循环的AI Agent自主目标执行系统，支持长时间运行的复杂任务。

#### 核心功能

- **ReAct循环**: Reason-Act-Observe推理-执行-观察循环
- **目标管理**: QUEUED→RUNNING→PAUSED/WAITING_INPUT/COMPLETED/FAILED/CANCELLED
- **暂停恢复**: 运行中目标可暂停、恢复执行
- **用户输入**: Agent可请求用户输入后继续执行
- **检查点恢复**: 步骤级检查点，故障后可恢复
- **自动纠错**: 失败步骤自动重试/重规划（最多3次）
- **优先级队列**: AgentTaskQueue优先级调度
- **资源限制**: 100步/目标, 120秒/步, 3并发, 50K Token预算
- **18个IPC处理器**: 目标创建/暂停/恢复/取消、队列管理、状态查询

#### 权限类别

`skills` (技能调用), `file-ops` (文件操作), `browser` (浏览器控制), `network` (网络请求)

---

### 🌍 多语言国际化 (v1.0新增)

运行时i18n系统和源码国际化管理技能。

#### 运行时i18n

- **4种语言**: zh-CN（默认）, en-US, fr-FR, es-ES
- **分类消息**: errors（8种错误类型）, status（5种状态）
- **回退机制**: 未找到翻译时回退到zh-CN
- **API**: `t(key)`, `setLocale(locale)`, `getSupportedLocales()`

#### i18n-Manager技能

- **源码扫描**: 扫描JS/TS/JSX/TSX/Vue文件（最多2000个）
- **字符串提取**: 自动提取硬编码字符串
- **翻译覆盖率**: 检查各语言翻译完成度
- **Locale生成**: 自动生成新语言的locale文件

---

### ⚡ 性能监控和自动调优 (v1.0新增)

全方位性能监控和基于规则的自动调优引擎。

#### 性能监控

- **系统指标**: CPU使用率、内存使用率、磁盘使用率（5秒采样）
- **DB性能**: 查询耗时记录，慢查询告警（>1000ms）
- **IPC性能**: IPC调用耗时记录，慢调用告警（>500ms）
- **告警阈值**: CPU>80%, Memory>85%, Disk>90%
- **历史数据**: 保留720个样本（1小时）

#### 自动调优引擎

| 规则             | 触发条件                 | 调优动作                      |
| ---------------- | ------------------------ | ----------------------------- |
| db-slow-queries  | 平均查询>100ms (连续3次) | 设置cache_size=20000, WAL模式 |
| db-vacuum        | 运行>24h且>7天未清理     | 执行VACUUM                    |
| llm-high-latency | 持续高LLM延迟            | 减少上下文窗口                |
| memory-pressure  | 内存压力过高             | 触发GC，发出警告              |
| p2p-connections  | P2P连接数过多            | 减少最大连接数                |

- **冷却机制**: 每条规则10分钟冷却期
- **自定义规则**: 支持注册自定义调优规则
- **12个IPC处理器**: 规则管理、状态查询、手动触发、历史记录

---

### 🔩 全自动开发流水线 (v1.1.0 / Cowork v3.0)

从需求描述到生产部署全程AI代理协作，人工干预率 < 20%。

#### 核心模块

| 模块                  | 文件                     | 职责                                            |
| --------------------- | ------------------------ | ----------------------------------------------- |
| Pipeline Orchestrator | `pipeline-ipc.js`        | DAG 流水线编排，5 种步骤类型，10 个预置模板     |
| Requirement Parser    | `requirement-parser.js`  | NL→Spec JSON，用户故事/验收标准提取             |
| Deploy Agent          | `deploy-agent.js`        | 多环境部署（dev/staging/prod），蓝绿/金丝雀策略 |
| Post-Deploy Monitor   | `post-deploy-monitor.js` | 健康监控，KPI 基线偏差检测                      |
| Rollback Manager      | `rollback-manager.js`    | Git Revert/Docker/Config 多策略自动回滚         |

- **15个IPC处理器**, 3张数据库表
- 前端页面: `DeploymentMonitorPage.vue` + `deployment.ts` Store

[详细了解流水线编排 →](/chainlesschain/pipeline)

---

### 💬 自然语言编程 (v1.1.0 / Cowork v3.1)

用自然语言描述需求，代理团队自动实现符合项目编码约定的代码。

#### 核心模块

| 模块                   | 文件                        | 职责                                            |
| ---------------------- | --------------------------- | ----------------------------------------------- |
| Spec Translator        | `spec-translator.js`        | NL→结构化 Spec 9 步翻译，9 种意图分类，LLM 增强 |
| Project Style Analyzer | `project-style-analyzer.js` | 编码约定提取（命名/缩进/注释），自动规则生成    |

- **10个IPC处理器**, 2张数据库表
- 前端页面: `NLProgrammingPage.vue` + `nlProgram.ts` Store

[详细了解自然语言编程 →](/chainlesschain/nl-programming)

---

### 🖼️ 多模态协作 (v1.1.0 / Cowork v3.2)

集成语音、视觉、文档等多模态输入输出，支持5+模态。

#### 核心模块

| 模块               | 文件                    | 职责                                       |
| ------------------ | ----------------------- | ------------------------------------------ |
| Modality Fusion    | `modality-fusion.js`    | 音频/图像/文档/屏幕/文本统一融合引擎       |
| Document Parser    | `document-parser.js`    | PDF/Word/Excel 解析，表格/图片提取，OCR    |
| Screen Recorder    | `screen-recorder.js`    | Electron desktopCapturer 截屏/录制         |
| Multimodal Context | `multimodal-context.js` | 多模态会话上下文，Token 预算控制           |
| Multimodal Output  | `multimodal-output.js`  | 富媒体输出（Markdown/HTML/ECharts/幻灯片） |

- **12个IPC处理器**, 2张数据库表
- 前端页面: `MultimodalCollabPage.vue` + `multimodal.ts` Store

[详细了解多模态协作 →](/chainlesschain/multimodal)

---

### 🚨 自主运维 (v1.1.0 / Cowork v3.3)

代理自动监控、诊断、修复生产环境问题，MTTR < 5分钟。

#### 核心模块

| 模块                 | 文件                      | 职责                                         |
| -------------------- | ------------------------- | -------------------------------------------- |
| Alert Manager        | `alert-manager.js`        | 多通道告警（Webhook/Email/IM），P0-P3 升级链 |
| Auto Remediator      | `auto-remediator.js`      | Playbook 驱动自动修复，8 种动作类型          |
| Postmortem Generator | `postmortem-generator.js` | LLM 事故报告生成，根因分析，改进建议         |

- **15个IPC处理器**, 3张数据库表
- 前端页面: `AutonomousOpsPage.vue` + `autonomousOps.ts` Store

[详细了解自主运维 →](/chainlesschain/autonomous-ops)

---

### 🪪 去中心化代理网络 (v1.1.0 / Cowork v4.0)

基于DID的代理身份认证和跨组织协作，支持100+节点。

#### 核心模块

| 模块                | 文件                          | 职责                                                     |
| ------------------- | ----------------------------- | -------------------------------------------------------- |
| Agent DID           | `agent-did.js`                | W3C DID 规范，`did:cc:agent-{uuid}` 格式，Ed25519 密钥对 |
| Credential Manager  | `agent-credential-manager.js` | W3C VC 签发/验证/吊销，3 种凭证类型                      |
| Agent Authenticator | `agent-authenticator.js`      | Challenge-Response / 凭证证明 / 双向 TLS                 |
| Federated Registry  | `federated-agent-registry.js` | KadDHT 去中心化发现，跨组织技能查询                      |
| Cross-Org Router    | `cross-org-task-router.js`    | 跨组织任务委派，SLA 预算，审计日志                       |
| Reputation System   | `agent-reputation.js`         | 多维信誉评分（0.0-1.0），时间衰减，4 级声望              |

- **20个IPC处理器**, 3张数据库表
- 前端页面: `FederatedNetworkPage.vue` + `agentNetwork.ts` Store

[详细了解代理联邦网络 →](/chainlesschain/agent-federation)

---

### 🎯 AI社交助手增强 (v1.1.0 Q2 / Phase 42)

AI驱动的社交洞察和智能回复建议,让去中心化社交更智能化。

#### 核心模块

| 模块                | 文件                     | 职责                                                     |
| ------------------- | ------------------------ | -------------------------------------------------------- |
| Topic Analyzer      | `topic-analyzer.js`      | 话题提取、情感分析、趋势分析、关键词提取                 |
| Social Graph        | `social-graph.js`        | 社交关系图谱构建、互动频率、亲密度计算、社区聚类         |
| AI Social Assistant | `ai-social-assistant.js` | 上下文感知回复建议（简短/详细/问题）                     |
| ActivityPub Bridge  | `activitypub-bridge.js`  | ActivityPub S2S协议、Actor/Inbox/Outbox、HTTP Signatures |
| AP Content Sync     | `ap-content-sync.js`     | 双向同步帖子/评论/点赞/转发/关注                         |
| AP WebFinger        | `ap-webfinger.js`        | WebFinger协议、远程用户发现                              |

- **18个IPC处理器** (8个社交AI + 10个ActivityPub)
- **3张数据库表**: `topic_analyses`, `social_graph_edges`, `activitypub_actors`, `activitypub_activities`
- 前端页面: `SocialInsightsPage.vue` + `ActivityPubBridgePage.vue` + `socialAI.ts` Store

**功能亮点**:

- **话题深度分析**: 自动提取讨论热点、情感倾向、趋势预测
- **社交关系图谱**: 可视化展示好友互动网络、识别核心圈层
- **智能回复建议**: 根据对话上下文AI生成三种风格回复选项
- **ActivityPub互通**: 与Mastodon/Misskey/Pleroma双向同步社交内容
- **去中心化联邦**: 无需中心服务器,直接与ActivityPub网络节点通信

---

### 🔒 合规与数据分类 (v1.1.0 Q2 / Phase 43)

企业级合规管理和敏感数据自动分类系统。

#### 核心模块

| 模块                  | 文件                       | 职责                                                          |
| --------------------- | -------------------------- | ------------------------------------------------------------- |
| SOC 2 Compliance      | `soc2-compliance.js`       | 自动收集审计日志/访问记录/变更历史、SOC 2 Type II证据报告生成 |
| Data Classifier       | `data-classifier.js`       | 基于规则+LLM的敏感数据识别（PII/PHI/PCI）                     |
| Classification Policy | `classification-policy.js` | 分级策略引擎（公开/内部/机密/绝密）、自动标签关联             |

- **12个IPC处理器**, 3张数据库表: `soc2_evidence`, `data_classifications`, `classification_policies`
- 前端页面: `ComplianceDashboardPage.vue` + `compliance.ts` Store

**功能亮点**:

- **SOC 2 自动化**: 自动收集合规证据,一键生成Type II审计报告
- **智能数据分类**: AI+规则双引擎识别PII(个人信息)/PHI(健康信息)/PCI(支付卡信息)
- **分级策略**: 四级分类策略（公开/内部/机密/绝密）,自动打标签
- **合规报告**: 合规评分、风险项识别、改进建议
- **审计追溯**: 完整的数据分类变更历史和审计日志

---

### 👥 SCIM 2.0 用户同步 (v1.1.0 Q2 / Phase 44)

与企业身份提供商(Azure AD/Okta)的自动用户同步。

#### 核心模块

| 模块        | 文件             | 职责                                                        |
| ----------- | ---------------- | ----------------------------------------------------------- |
| SCIM Server | `scim-server.js` | SCIM 2.0 Server实现(/Users, /Groups CRUD + 过滤/分页/PATCH) |
| SCIM Sync   | `scim-sync.js`   | 增量同步引擎,与Azure AD/Okta/OneLogin对接                   |

- **8个IPC处理器**, 2张数据库表: `scim_resources`, `scim_sync_log`
- 前端页面: `SCIMIntegrationPage.vue`

**功能亮点**:

- **SCIM 2.0标准**: 完整实现SCIM 2.0协议规范
- **增量同步**: 自动检测Azure AD/Okta用户变更,增量同步
- **双向同步**: 支持从IdP同步用户,也支持推送本地变更
- **映射配置**: 灵活的属性映射配置(SCIM字段↔本地字段)
- **同步监控**: 实时同步状态、历史记录、错误追踪

---

### 🔐 统一密钥管理 (v1.1.0 Q2 / Phase 45)

U盾+SIMKey+TEE三端统一密钥管理,FIDO2无密码认证,跨平台USB驱动。

#### 核心模块

| 模块                | 文件                     | 职责                                         |
| ------------------- | ------------------------ | -------------------------------------------- |
| Unified Key Manager | `unified-key-manager.js` | BIP-32统一密钥派生、三端密钥轮换、跨设备同步 |
| FIDO2 Authenticator | `fido2-authenticator.js` | WebAuthn注册/认证、CTAP2协议、凭证管理       |
| USB Transport       | `usb-transport.js`       | 跨平台USB通信(macOS/Linux/Windows)、设备发现 |
| WebUSB Fallback     | `webusb-fallback.js`     | WebUSB API降级方案、浏览器兼容性             |

- **8个IPC处理器** (6个密钥管理 + 2个USB驱动)
- **2张数据库表**: `unified_keys`, `fido2_credentials`

**功能亮点**:

- **三端统一**: U盾、SIMKey、TEE使用统一密钥派生协议(BIP-32)
- **FIDO2无密码**: 作为FIDO2认证器,支持Web无密码登录
- **密钥轮换**: 自动定期轮换密钥,提升安全性
- **跨平台USB**: 基于libusb/WebUSB的macOS/Linux U盾驱动(Windows原生支持)
- **WebUSB降级**: 浏览器环境下使用WebUSB API访问USB设备

---

### 🏗️ 生产加固 + 联邦网络 (v2.0.0 / Phase 57-61)

企业级生产环境加固和联邦网络优化。

#### 核心模块

| 模块                 | 文件                          | 职责                              |
| -------------------- | ----------------------------- | --------------------------------- |
| Performance Baseline | `performance-baseline.js`     | 性能基线采集，历史对比，回归检测  |
| Security Auditor     | `security-auditor.js`         | OWASP Top 10 扫描，依赖漏洞检测   |
| Federation Hardening | `federation-hardening.js`     | 断路器模式，健康检查，连接池      |
| Stress Tester        | `federation-stress-tester.js` | 100 节点压力测试，延迟/吞吐量基准 |
| Reputation Optimizer | `reputation-optimizer.js`     | 贝叶斯优化信誉权重，异常检测      |
| SLA Manager          | `sla-manager.js`              | 跨组织 SLA 合约，违约检测         |

- **23个IPC处理器**, 10张数据库表
- 前端页面: 5个 + 5个Pinia Store

[详细了解生产加固 →](/chainlesschain/production-hardening)

---

### 🤖 全自主 AI 开发者 (v3.0.0 / Phase 62-64)

用户描述业务目标，AI 自主完成从架构到运维的全生命周期。

#### 核心模块

| 模块                     | 文件                          | 职责                                       |
| ------------------------ | ----------------------------- | ------------------------------------------ |
| Tech Learning Engine     | `tech-learning-engine.js`     | 自主技术栈感知，最佳实践提取，在线学习     |
| Autonomous Developer     | `autonomous-developer.js`     | 端到端自主开发（需求→架构→代码→测试→部署） |
| Collaboration Governance | `collaboration-governance.js` | 决策审批网关，操作回放审计，置信度门控     |

- **15个IPC处理器**, 6张数据库表
- 前端页面: 3个 + 3个Pinia Store

[详细了解自主技术学习 →](/chainlesschain/tech-learning)

---

### 🏪 去中心化 AI 市场 (v3.1.0 / Phase 65-67)

基于代理信誉的去中心化 AI 服务市场，让 AI 能力像商品一样自由交易。

#### 核心模块

| 模块                    | 文件                         | 职责                                 |
| ----------------------- | ---------------------------- | ------------------------------------ |
| Skill Service Protocol  | `skill-service-protocol.js`  | 标准化技能描述，REST/gRPC 远程调用   |
| Skill Invoker           | `skill-invoker.js`           | 跨组织代理技能委派，版本兼容检测     |
| Token Ledger            | `token-ledger.js`            | 代币账本（发行/转账），贡献奖励结算  |
| Contribution Tracker    | `contribution-tracker.js`    | 技能/算力/数据贡献追踪，信誉加权定价 |
| Inference Node Registry | `inference-node-registry.js` | GPU/CPU 推理节点注册，算力基准测试   |
| Inference Scheduler     | `inference-scheduler.js`     | 延迟/成本/算力智能调度，模型分片推理 |

- **16个IPC处理器**, 6张数据库表
- 前端页面: 3个 + 3个Pinia Store

[详细了解技能市场 →](/chainlesschain/skill-marketplace)

---

### 🔒 硬件安全生态 (v3.2.0 / Phase 68-71)

从芯片到卫星的全链路安全，完整的硬件信任链生态。

#### 核心模块

| 模块                  | 文件                       | 职责                                      |
| --------------------- | -------------------------- | ----------------------------------------- |
| Trust Root Manager    | `trust-root-manager.js`    | 三位一体统一信任根，硬件认证链互验        |
| PQC Ecosystem Manager | `pqc-ecosystem-manager.js` | ML-KEM/ML-DSA 全子系统迁移，固件 PQC 加速 |
| Satellite Comm        | `satellite-comm.js`        | LEO 卫星短消息通道，加密+压缩             |
| Disaster Recovery     | `disaster-recovery.js`     | 完全离线密钥恢复，紧急吊销广播            |
| HSM Adapter Manager   | `hsm-adapter-manager.js`   | Yubikey/Ledger/Trezor 适配，统一 HSM 接口 |

- **18个IPC处理器**, 5张数据库表
- 前端页面: 4个 + 4个Pinia Store

[详细了解信任根 →](/chainlesschain/trust-root)

---

### 🌍 全球去中心化社交 (v3.3.0 / Phase 72-75)

跨协议、跨平台、跨国界的去中心化社交网络。

#### 核心模块

| 模块                     | 文件                          | 职责                                    |
| ------------------------ | ----------------------------- | --------------------------------------- |
| Protocol Fusion Bridge   | `protocol-fusion-bridge.js`   | ActivityPub/Nostr/Matrix 多协议统一桥接 |
| Realtime Translator      | `realtime-translator.js`      | 本地 LLM 实时多语言翻译（50+语言）      |
| Content Quality Assessor | `content-quality-assessor.js` | AI 内容质量评估，去中心化共识审核       |
| Filecoin Storage         | `filecoin-storage.js`         | Filecoin 持久化存储交易，存储证明       |
| Content Distributor      | `content-distributor.js`      | P2P 内容分发网络，热点缓存              |
| Anti-Censorship Manager  | `anti-censorship-manager.js`  | Tor/域前置/卫星广播，抗审查通信         |
| Mesh Network Manager     | `mesh-network-manager.js`     | BLE/WiFi Direct 本地网状网络            |

- **20个IPC处理器**, 5张数据库表
- 前端页面: 4个 + 4个Pinia Store

[详细了解协议融合 →](/chainlesschain/protocol-fusion)

---

### 🧬 EvoMap 全球进化网络 (v3.4.0 / Phase 76-77)

基于 EvoMap GEP 协议的全球 AI 知识进化网络。

#### 核心模块

| 模块              | 文件                   | 职责                                        |
| ----------------- | ---------------------- | ------------------------------------------- |
| EvoMap Federation | `evomap-federation.js` | 多 Hub 联邦互连，Gene 跨 Hub 流通，进化选择 |
| Gene IP Manager   | `gene-ip-manager.js`   | Gene 所有权证明（DID+VC），贡献溯源         |
| EvoMap DAO        | `evomap-dao.js`        | 社区治理 DAO，Gene 投票，争议仲裁           |

- **10个IPC处理器**, 4张数据库表
- 前端页面: 2个 + 2个Pinia Store

[详细了解 EvoMap 联邦 →](/chainlesschain/evomap-federation)

---

### 🔧 CLI进化版 (v5.0.2.x)

CLI Agent核心架构大幅升级，借鉴oh-my-openagent等先进实践。

#### Hashline 哈希锚定行编辑

- **内容哈希替代行号**: `base64url(sha256(line.trim())).slice(0,6)` 生成6字符锚点
- **抗格式化漂移**: `.trim()`使哈希对缩进变化不敏感
- **三层自愈**: hash_mismatch / ambiguous_anchor / content_mismatch 三种错误返回

#### Hooks 三件套

- **SessionStart**: banner后、prompt前触发
- **UserPromptSubmit**: 用户输入后、messages.push前触发
- **SessionEnd**: rl.close后、shutdown前触发
- **fire-and-forget**: 钩子失败不中断REPL

#### Skill-Embedded MCP

- **技能内联MCP**: SKILL.md中用 `mcp-servers` 代码块声明MCP服务器
- **按需mount/unmount**: 技能激活时挂载，退出时卸载，解决工具爆炸问题

#### Category Routing 类别路由

- **5个类别**: quick/deep/reasoning/vision/creative
- **自动匹配provider**: 根据用户llm-config已配置的provider智能选择
- **Skill驱动**: 从SKILL.md的model-hints字段推断类别

#### Canonical Tool Descriptor 工具描述规范

- **inputSchema为真源**: parameters只读镜像，由normalizer自动派生
- **四端统一**: CLI/Desktop Main/Renderer/MCP工具定义标准化

#### 其他新增

- **Coding Agent Envelope Protocol**: 统一WS信封协议，dot-case类型，requestId关联
- **Sub-Runtime Pool**: Electron主进程子进程spawn，sessionId分片 `{parent}.m{idx}-{role}`
- **Web UI管理面板**: HTTP 18810端口，项目/全局双模式，4主题
- **AI Orchestration编排层**: Claude Code/Codex/多Agent路由，5种策略（round-robin/primary/parallel-all/by-type/weighted）
- **AI Doc Creator模板**: doc-generate/libre-convert/doc-edit三技能，LLM+pandoc+soffice
- **CLI Skill Packs**: 9个领域技能包（knowledge/identity/infra/ai-query/agent/web3/security/enterprise/integration），sync-cli命令自动生成

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   用户界面层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ PC端     │  │ Android  │  │   iOS    │  │  Web端   │ │
│  │(Electron)│  │(Compose) │  │(SwiftUI) │  │  (Vue)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                   业务逻辑层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │知识库管理│  │去中心社交│  │交易辅助  │  │ AI服务   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                   基础服务层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │数据存储  │  │P2P网络   │  │加密服务  │  │ Git同步  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                   硬件和系统层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  U盾     │  │ SIMKey   │  │  TEE     │  │本地AI    │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

#### 前端技术

**PC端 (Electron)**

- Framework: Electron 39.2.7
- UI: Vue 3.4 + Composition API
- UI库: Ant Design Vue 4.1
- 状态管理: Pinia (99 TypeScript stores)
- 路由: Vue Router
- P2P: libp2p 3.1.2
- 加密: Signal Protocol

**Android端**

- Language: Kotlin
- UI: Jetpack Compose
- Architecture: MVVM + Clean Architecture
- DI: Hilt
- Network: Retrofit + OkHttp
- P2P UI: 8个完整屏幕

**iOS端**

- Language: Swift
- UI: SwiftUI
- Architecture: MVVM
- Network: Alamofire
- Storage: CoreData + SwiftData

#### 后端技术

**本地服务**

- Runtime: Node.js 18+
- Database: SQLite + SQLCipher (AES-256加密)
- Search: 全文搜索 + 向量检索
- AI: Ollama (本地大模型) + 14+云LLM

**微服务架构**

- Project Service: Spring Boot 3.1.11 + Java 17
- AI Service: FastAPI + Python
- Community Forum: 63个API

**P2P网络**

- Framework: libp2p 3.1.2
- DHT: Kademlia
- NAT穿透: AutoNAT + Relay
- 传输协议: QUIC/TCP
- WebRTC: 语音/视频通话 + 屏幕共享

**区块链**

- Web3: ethers.js / web3.js
- 链: 15链支持 (Ethereum, Polygon, BSC等)
- 智能合约: 6个合约 (Token/NFT/托管/订阅/悬赏/跨链桥)
- Wallet: MetaMask + WalletConnect

#### 数据和存储

**本地存储**

- 结构化数据: SQLite + SQLCipher
- 文件存储: 本地文件系统
- 索引: 全文搜索 + 向量索引
- 缓存: LevelDB

**加密**

- 对称加密: AES-256-GCM
- 非对称加密: RSA-2048, ECC
- 国密算法: SM2, SM3, SM4
- E2E加密: Signal Protocol
- 密钥管理: U盾/SIMKey硬件存储

**版本控制**

- VCS: Git
- 仓库: 本地 + 远程
- 加密: git-crypt
- LFS: Git LFS (大文件)

---

## 系统特点

### ✅ 完全去中心化

| 传统云服务       | ChainlessChain |
| ---------------- | -------------- |
| 数据存储在云端   | 数据存储在本地 |
| 依赖中心服务器   | P2P直连通信    |
| 服务商可访问数据 | 只有用户能解密 |
| 账号受平台控制   | DID自主身份    |
| 需要持续付费     | 一次性购买     |

### ✅ 军事级安全

- **硬件加密**: U盾/SIMKey硬件级密钥保护
- **端到端加密**: 所有通信和数据端到端加密
- **零知识**: 任何第三方都无法访问用户数据
- **审计**: 完整的操作审计日志
- **合规**: 符合GDPR、网络安全法等法规

### ✅ AI原生设计

- **本地运行**: AI完全在本地运行，保护隐私
- **知识增强**: RAG检索增强，基于个人知识库
- **多模态**: 支持文本、图片、语音等多模态
- **离线可用**: 无需联网也能使用AI功能
- **自定义**: 支持微调和自定义模型

### ✅ 跨平台支持

- **统一体验**: PC、移动端一致的用户体验
- **自动同步**: 基于Git的跨设备同步
- **冲突解决**: 智能处理多设备修改冲突
- **渐进式**: 从单设备开始，逐步扩展

### ✅ 开源透明

- **代码开源**: 核心代码MIT开源
- **可审计**: 任何人都可审计代码安全性
- **社区驱动**: 接受社区贡献和建议
- **可扩展**: 插件系统支持功能扩展

---

## 应用场景

### 个人知识管理

**适用人群**: 学生、研究人员、知识工作者

**使用方式**:

- 记录学习笔记和读书摘要
- 构建个人知识图谱
- AI辅助总结和提炼知识
- 跨设备访问和编辑

**优势**:

- 完全隐私，不担心数据泄露
- AI增强，提高学习效率
- 永久保存，版本可追溯

### 隐私通讯

**适用人群**: 注重隐私的用户、团队协作

**使用方式**:

- 与朋友进行端到端加密聊天
- 分享加密的文件和图片
- 组建加密的工作群组
- P2P视频通话

**优势**:

- Signal级别加密
- 无需信任服务提供商
- 不留痕迹，不被监控

### 数字资产管理

**适用人群**: 加密货币持有者、DeFi用户

**使用方式**:

- 管理多链数字资产
- 参与DeFi收益农场
- 交易NFT
- 参与DAO治理

**优势**:

- 硬件钱包级别安全
- 多链统一管理
- 交易记录AI分析

### 创作者工具

**适用人群**: 作家、博主、内容创作者

**使用方式**:

- AI辅助内容创作
- 版本控制和协作
- 素材库管理
- 跨平台发布

**优势**:

- AI创作助手
- 完整版本历史
- 数据完全自主

### 企业知识库

**适用人群**: 小型团队、企业

**使用方式**:

- 构建企业知识库
- 团队文档协作
- 加密通讯
- 数据自主可控

**优势**:

- 无需订阅云服务
- 数据完全掌控
- 符合合规要求

---

## 与竞品对比

### vs Notion

| 特性     | ChainlessChain | Notion       |
| -------- | -------------- | ------------ |
| 数据存储 | 本地           | 云端         |
| 隐私保护 | 端到端加密     | 服务器可访问 |
| AI功能   | 本地运行       | 云端API      |
| 离线使用 | 完全支持       | 有限支持     |
| 费用     | 一次性         | 持续订阅     |
| 自定义   | 完全开源       | 黑盒系统     |

### vs Evernote

| 特性     | ChainlessChain | Evernote |
| -------- | -------------- | -------- |
| 数据主权 | 用户拥有       | 平台拥有 |
| AI能力   | 本地大模型     | 有限AI   |
| 加密     | 硬件加密       | 软件加密 |
| 社交     | P2P去中心      | 不支持   |
| 区块链   | 原生支持       | 不支持   |

### vs Obsidian

| 特性   | ChainlessChain | Obsidian |
| ------ | -------------- | -------- |
| 同步   | Git原生        | 付费同步 |
| AI     | 集成大模型     | 需插件   |
| 加密   | 硬件加密       | 软件加密 |
| 社交   | 内置P2P        | 不支持   |
| 移动端 | 原生App        | 有限功能 |

---

## 系统要求

### PC端（Windows/macOS/Linux）

**最低配置**:

- CPU: 双核 2.0GHz+
- 内存: 4GB
- 硬盘: 10GB可用空间
- 显卡: 集成显卡

**推荐配置**:

- CPU: 四核 3.0GHz+
- 内存: 8GB+
- 硬盘: 50GB+ SSD
- 显卡: 独立显卡（运行AI模型）

### 移动端

**Android**:

- 系统: Android 8.0+
- 内存: 3GB+
- 存储: 5GB+

**iOS**:

- 系统: iOS 14.0+
- 设备: iPhone 8+
- 存储: 5GB+

### 硬件设备

**U盾**:

- 支持国密SM2/SM3/SM4算法
- USB接口

**SIMKey** (v0.38.0):

- 支持JavaCard / 5G USIM / iOS eSIM
- SIM卡插槽 / eSIM Profile
- NFC离线签名、多SIM卡自动切换
- 健康监控仪表盘
- 后量子密码学 (ML-KEM/ML-DSA)

---

## 快速开始

### 5分钟体验

```bash
# 1. 克隆项目
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain

# 2. 安装依赖
npm install

# 3. 启动后端服务
cd backend/docker
docker-compose up -d

# 4. 启动PC端
cd ../..
npm run dev:desktop
```

访问: 应用会自动打开

### 首次配置

1. **设备初始化**
   - 插入U盾或SIMKey
   - 设置PIN码
   - 生成密钥对

2. **创建身份**
   - 生成DID身份
   - 设置昵称和头像
   - 备份助记词

3. **配置AI**
   - 选择AI模型（Ollama推荐）
   - 下载模型文件
   - 测试AI功能

4. **开始使用**
   - 创建第一个笔记
   - 添加第一个好友
   - 同步到Git仓库

[查看详细安装指南 →](/chainlesschain/installation)

---

## 路线图

### Phase 1: 基础平台 (v0.1–v0.26) ✅

- ✅ 知识库基础功能 + Markdown编辑器
- ✅ 本地全文搜索 + 向量检索(RAG)
- ✅ Git同步 + 版本控制
- ✅ U盾/SIMKey硬件加密集成
- ✅ PC端（Windows/Mac/Linux）+ Android端
- ✅ DID身份 + P2P即时通讯 + Signal加密
- ✅ Ollama本地模型 + 14+云LLM集成
- ✅ 永久记忆系统 + 混合搜索引擎(Vector+BM25)
- ✅ IPC错误处理中间件

### Phase 2: AI增强 (v0.27–v0.29) ✅

- ✅ Cowork多智能体协作系统 (13核心操作, 文件沙箱)
- ✅ Hooks可扩展系统 (21事件, 4类型)
- ✅ Manus优化 (Context Engineering, KV-Cache)
- ✅ Plan Mode安全规划模式
- ✅ Skills技能系统 (Markdown定义, 三层加载)
- ✅ 权限引擎 (Enterprise RBAC)
- ✅ 团队管理 + 日报/周报
- ✅ SessionManager智能会话管理
- ✅ 浏览器自动化系统 + 录制回放
- ✅ iOS端应用 + WebRTC语音/视频

### Phase 3: 能力扩展 (v0.33–v0.34) ✅

- ✅ Computer Use电脑操作 (12 AI工具, 68+ IPC)
- ✅ 企业审计与合规 (GDPR/SOC2/HIPAA)
- ✅ SSO企业认证 (SAML/OAuth/OIDC)
- ✅ 插件市场 (发现/安装/更新)
- ✅ MCP SDK + 社区注册表 (8服务器)
- ✅ 专业化多Agent系统 (8模板)
- ✅ 浏览器插件 (215远程命令)

### Phase 4: 技能生态 (v0.35–v0.37) ✅

- ✅ 138个内置技能 (100% Handler覆盖)
- ✅ 统一工具注册表 (FunctionCaller+MCP+Skills)
- ✅ Agent Skills开放标准 (13扩展字段)
- ✅ 10个AI演示模板
- ✅ Android 28技能 + PC远程委托
- ✅ 技能市场第四层加载 (bundled→marketplace→managed→workspace)

### Phase 5: 生态完善 (v0.38–v0.40) ✅

- ✅ SIMKey v0.38.0 (iOS eSIM, 5G优化, NFC离线签名, 多SIM卡切换, 健康监控, 量子抗性算法)
- ✅ iOS端技能系统 + Computer Use (15文件技能系统, 23文件Computer Use)
- ✅ 工作流编排可视化编辑器 (Vue Flow, 实时执行可视化, 条件构建器, 编排模板导入)
- ✅ 跨设备技能同步和迁移 (P2P技能包传输, 版本冲突解决, 7个IPC处理器)
- ✅ MCP服务器热加载和动态发现 (目录监控, 健康检测, 自动重连, 6个IPC处理器)
- ✅ 多模态AI能力增强 (MultimodalRouter统一路由, 12个IPC处理器, 图片/音频/视频理解)
- ✅ 社区技能市场上线 (技能搜索/发布/安装/评价, 15个IPC处理器, 用户贡献技能)
- ✅ 交易辅助增强 (拍卖系统, 团购/拼单, 分期付款, 闪电网络支付, 28个IPC处理器)
- ✅ 去中心化金融扩展 (P2P信用借贷, 保险池, 跨链原子互换, 22个IPC处理器)

### Phase 6: 企业级 (v1.0) ✅

- ✅ 企业组织管理 (多层级部门, 审批流, 层级树, 批量导入, 仪表盘统计, 10个IPC处理器)
- ✅ 实时协作编辑 (CRDT/Yjs, P2P libp2p同步, 段落锁定, 冲突解决, 评论线程, 版本历史, 21个IPC处理器)
- ✅ 去中心化存储 (IPFS集成, 嵌入式Helia/外部Kubo双模式, AES-256-GCM加密, 1GB配额, Pin管理, 18个IPC处理器)
- ✅ 高级数据分析仪表盘 (四源聚合: Token/技能/错误/性能, 实时推送, 时间序列, TopN, CSV/JSON报告, 16个IPC处理器)
- ✅ AI Agent自主任务执行 (ReAct循环, 100步/目标, 暂停/恢复, 用户输入请求, 检查点恢复, 3并发, 50K Token预算, 18个IPC处理器)
- ✅ 多语言国际化 (i18n运行时: zh-CN/en-US/fr-FR/es-ES, i18n-manager技能: 源码扫描/提取/翻译覆盖率)
- ✅ 性能监控和自动调优 (5规则自动调优引擎, 统一性能采集器, DB/IPC性能拦截器, CPU/内存/磁盘告警, 12个IPC处理器)
- ✅ P2P语音/视频通话 (WebRTC DTLS-SRTP, SFU中继, 多人通话, call-manager/media-engine/call-signaling)
- ✅ 共享加密相册 (AES-256分布式存储, EXIF隐私剥离, P2P同步, 6个新Vue组件)
- ✅ 社区/频道系统 (Gossip协议分发, 去中心化治理投票, AI内容审核, 多级角色权限)
- ✅ 协作文档编辑社交 (Yjs CRDT多人实时协作, 光标同步感知, 版本历史)
- ✅ 朋友圈时光机 (AI社交回忆生成, 情感趋势分析, 时间线多维浏览)
- ✅ 去中心化直播 (P2P推流+SFU混合架构, 实时弹幕, 直播录制回放)
- ✅ 高级社交特性 (匿名模式ZKP, 跨平台桥接, 社交代币治理, AI社交助手, Mesh离线社交)
- ✅ Cowork协作演化技能 (debate-review, ab-compare, orchestrate, verification-loop, stream-processor, 共138个内置技能)

### Phase 7: 全栈智能化 (v1.1.0) ✅

- ✅ Cowork v3.0 全自动开发流水线 (DAG编排, 需求解析, 部署监控, 自动回滚, 15 IPC)
- ✅ Cowork v3.1 自然语言编程 (NL→Spec 9步翻译, 项目风格分析, 10 IPC)
- ✅ Cowork v3.2 多模态协作 (五模态融合, 文档解析, 屏幕录制, 富媒体输出, 12 IPC)
- ✅ Cowork v3.3 自主运维 (告警管理, Playbook修复, 事故报告, 15 IPC)
- ✅ Cowork v4.0 去中心化代理网络 (Agent DID, 联邦注册, 跨组织路由, 信誉系统, 20 IPC)
- ✅ 5个新前端页面 + 5个Pinia Store + 13张数据库表
- ✅ 187个单元测试 + 72个E2E测试

### Phase 8: 生产加固 (v2.0.0) ✅

- ✅ 性能基线采集与安全审计 (Phase 57, 6 IPC)
- ✅ 联邦网络加固 — 断路器/健康检查/连接池 (Phase 58, 4 IPC)
- ✅ 100节点联邦压力测试 (Phase 59, 4 IPC)
- ✅ 信誉系统贝叶斯优化 (Phase 60, 4 IPC)
- ✅ 跨组织SLA合约管理 (Phase 61, 5 IPC)

### Phase 9: 全自主AI (v3.0.0) ✅

- ✅ 自主技术学习引擎 (Phase 62, 5 IPC)
- ✅ 端到端自主开发 (Phase 63, 5 IPC)
- ✅ 人机协作治理框架 (Phase 64, 5 IPC)

### Phase 10: 去中心化AI市场 (v3.1.0) ✅

- ✅ Skill-as-a-Service协议 (Phase 65, 5 IPC)
- ✅ 代币激励机制 (Phase 66, 5 IPC)
- ✅ 去中心化推理网络 (Phase 67, 6 IPC)

### Phase 11: 硬件安全生态 (v3.2.0) ✅

- ✅ 三位一体信任根 (Phase 68, 5 IPC)
- ✅ PQC全子系统迁移 (Phase 69, 4 IPC)
- ✅ 卫星通信离线安全 (Phase 70, 5 IPC)
- ✅ 开放硬件安全标准 (Phase 71, 4 IPC)

### Phase 12: 全球去中心化社交 (v3.3.0) ✅

- ✅ 多协议融合桥接 (Phase 72, 5 IPC)
- ✅ AI社交增强 (Phase 73, 5 IPC)
- ✅ 去中心化内容存储 (Phase 74, 5 IPC)
- ✅ 抗审查通信 (Phase 75, 5 IPC)

### Phase 13: EvoMap全球进化 (v3.4.0) ✅

- ✅ EvoMap多Hub联邦 (Phase 76, 5 IPC)
- ✅ 知识产权与DAO治理 (Phase 77, 5 IPC)

### Phase 14: CLI进化版 (v5.0.2.x) ✅

- ✅ Hashline哈希锚定行编辑 (edit_file_hashed, 41 tests)
- ✅ Hooks三件套 — SessionStart/UserPromptSubmit/SessionEnd (session-hooks.js, 15 tests)
- ✅ Skill-Embedded MCP — 技能内联MCP服务器 (skill-mcp.js, 32 tests)
- ✅ Category Routing — 5类别LLM自动路由 (llm-manager.js, 26 tests)
- ✅ Canonical Tool Descriptor — 工具描述规范统一 (inputSchema真源)
- ✅ Coding Agent Envelope Protocol — 统一WS信封协议
- ✅ Sub-Runtime Pool — Electron主进程子运行时池 (94 tests)
- ✅ Web UI管理面板 — HTTP+WS双服务 (99 tests)
- ✅ AI Orchestration编排层 — 多Agent路由+5种策略
- ✅ AI Doc Creator模板 — 文档创作3技能 (168 tests)
- ✅ CLI Skill Packs — 9领域技能包 (101 tests)

### 远景 (v4.0+) 🔮

- 🔮 AR/VR知识空间
- 🔮 语音/手势自然交互
- 🔮 联邦学习隐私保护AI
- 🔮 跨链互操作协议
- 🔮 量子计算安全原语

---

## 社区和支持

### 加入社区

- 🌐 **官网**: https://www.chainlesschain.com
- 💬 **论坛**: https://community.chainlesschain.com
- 📱 **微信群**: 扫码加入
- 🐦 **Twitter**: @chainlesschain

### 开源贡献

- 📖 [贡献指南](https://github.com/chainlesschain/chainlesschain/blob/main/CONTRIBUTING.md)
- 🐛 [报告问题](https://github.com/chainlesschain/chainlesschain/issues)
- 💡 [功能建议](https://github.com/chainlesschain/chainlesschain/discussions)
- 🔧 [提交PR](https://github.com/chainlesschain/chainlesschain/pulls)

### 技术支持

- 📧 **邮箱**: zhanglongfa@chainlesschain.com
- 📞 **电话**: 400-1068-687
- 💬 **企业微信**: [加入](https://work.weixin.qq.com/ca/cawcde653996f7ecb2)

---

## 下一步

- [安装部署](/chainlesschain/installation) - 详细安装指南
- [知识库管理](/chainlesschain/knowledge-base) - 学习知识库功能
- [AI技能系统](/chainlesschain/skills) - 138个内置技能
- [Cowork多智能体](/chainlesschain/cowork) - 多Agent协作
- [流水线编排](/chainlesschain/pipeline) - 全自动开发流水线 (v1.1.0)
- [自然语言编程](/chainlesschain/nl-programming) - NL→代码 (v1.1.0)
- [多模态协作](/chainlesschain/multimodal) - 五模态融合 (v1.1.0)
- [自主运维](/chainlesschain/autonomous-ops) - 告警/修复/报告 (v1.1.0)
- [代理联邦网络](/chainlesschain/agent-federation) - Agent DID/跨组织 (v1.1.0)
- [Computer Use](/chainlesschain/computer-use) - 电脑操作能力
- [去中心化社交](/chainlesschain/social) - 了解P2P通讯
- [AI模型配置](/chainlesschain/ai-models) - 配置本地AI
- [会话管理](/chainlesschain/session-manager) - 智能会话和记忆
- [Hooks扩展](/chainlesschain/hooks) - 自定义钩子系统
- [权限管理](/chainlesschain/permissions) - 企业级RBAC
- [生产加固](/chainlesschain/production-hardening) - 性能基线与安全审计 (v2.0.0)
- [联邦网络加固](/chainlesschain/federation-hardening) - 断路器与健康检查 (v2.0.0)
- [自主技术学习](/chainlesschain/tech-learning) - AI自主学习引擎 (v3.0.0)
- [自主开发者](/chainlesschain/autonomous-developer) - 端到端自主开发 (v3.0.0)
- [技能市场](/chainlesschain/skill-marketplace) - Skill-as-a-Service (v3.1.0)
- [推理网络](/chainlesschain/inference-network) - 去中心化推理 (v3.1.0)
- [信任根](/chainlesschain/trust-root) - 三位一体信任根 (v3.2.0)
- [卫星通信](/chainlesschain/satellite-comm) - LEO卫星离线安全 (v3.2.0)
- [协议融合](/chainlesschain/protocol-fusion) - 多协议统一桥接 (v3.3.0)
- [抗审查](/chainlesschain/anti-censorship) - Tor/域前置/网状网络 (v3.3.0)
- [EvoMap联邦](/chainlesschain/evomap-federation) - 全球进化网络 (v3.4.0)
- [EvoMap治理](/chainlesschain/evomap-governance) - 知识产权DAO (v3.4.0)
- [CLI-Anything集成](/chainlesschain/cli-cli-anything) - 外部软件Agent化 (v5.0.1)
- [Web UI管理面板](/chainlesschain/web-ui) - HTTP管理界面 (v5.0.2)
- [AI Orchestration](/chainlesschain/orchestration) - 多Agent编排层 (v5.0.2)
- [产品路线图](/chainlesschain/product-roadmap) - 产品演进规划

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/index.js` | Electron 主进程入口，IPC 通道注册 |
| `src/main/database.js` | SQLite/SQLCipher 数据库 Schema 定义 |
| `src/main/ai-engine/` | AI 引擎目录（16 个专用引擎） |
| `src/main/ai-engine/cowork/` | Cowork 多智能体协作系统 |
| `src/main/llm/` | LLM 会话、记忆、Instinct 管理 |
| `src/main/p2p/` | P2P 通信与 WebRTC 信令 |
| `src/main/ukey/` | U-Key/SIMKey 硬件加密 |
| `src/main/permission/` | RBAC 权限引擎 |
| `src/main/mcp/` | MCP 协议集成 |
| `src/renderer/stores/` | 99 个 Pinia 状态管理 Store |

## 相关文档

- [安装部署](/chainlesschain/installation) - 详细安装与配置指南
- [AI 技能系统](/chainlesschain/skills) - 138 个内置技能完整列表
- [Cowork 多智能体](/chainlesschain/cowork) - 多 Agent 协作系统
- [产品路线图](/chainlesschain/product-roadmap) - 产品演进规划

---

**用技术捍卫隐私，用AI赋能个人** 🚀
