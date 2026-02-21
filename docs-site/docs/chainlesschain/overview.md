# ChainlessChain 系统概述

> **当前版本: v0.37.6 AI技能系统 | 完成度: 100% | 生产就绪**

ChainlessChain是一个完全去中心化的个人AI管理系统，整合知识库管理、去中心化社交和交易辅助三大核心功能，通过U盾/SIMKey硬件加密和本地AI模型，为用户提供军事级隐私保护的个人数据管理平台。

**v0.37.6新增**: AI技能系统 - 90个内置技能(100% Handler覆盖)、统一工具注册表(FunctionCaller 60++MCP 8+Skills 90)、10个演示模板、Agent Skills开放标准(13扩展字段)、Android 28技能(含PC远程委托)。

## 项目统计

| 指标       | 数值                                   |
| ---------- | -------------------------------------- |
| 代码总行数 | 280,000+                               |
| Vue组件数  | 358个                                  |
| IPC处理器  | 200+                                   |
| 测试用例   | 2000+                                  |
| AI专用引擎 | 16个                                   |
| 内置技能   | 90个                                   |
| 统一工具   | 60+ FunctionCaller + 8 MCP + 90 Skills |
| 演示模板   | 10个                                   |
| 浏览器命令 | 215个                                  |

## 系统定位

ChainlessChain旨在成为用户的"第二大脑"和数字资产管理中心：

- 📝 **知识管理中心**: 个人笔记、文档、对话历史的统一管理，8个图分析算法
- 🤖 **AI智能助手**: 16个专用引擎 + 14+云LLM提供商 + Ollama本地部署
- 🔐 **安全钱包**: 硬件加密的数字资产管理，6个智能合约
- 🌐 **去中心化社交**: P2P通信，WebRTC语音/视频，群聊，消息转发
- 💾 **数据主权**: 完全掌控自己的数据，不依赖第三方
- 🔌 **MCP集成**: Model Context Protocol，5个官方服务器
- 🤖 **Cowork协作**: 多智能体协作系统，智能任务分配，文件沙箱安全
- 🖥️ **Computer Use**: 类似Claude Computer Use的电脑操作能力，视觉AI定位
- 🌐 **浏览器插件**: 215个远程命令，完整浏览器自动化控制
- 🧩 **技能系统**: 90个内置技能，Agent Skills开放标准，四层加载架构
- 🪝 **Hooks扩展**: 21个钩子事件，4种类型，自定义逻辑注入
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

#### 规划中功能

- **拍卖系统**: 英式/荷兰式/密封/反向拍卖，智能合约自动结算
- **团购/拼单**: 阶梯价格，多人合力享受更低价格
- **分期付款**: 智能合约分期，2-12期灵活方案
- **信用借贷**: 基于去中心化信誉的P2P借贷市场
- **保险服务**: 去中心化保险池，运输/质量/违约/延迟保障
- **更多支付**: 闪电网络、DAI/PYUSD稳定币、跨链支付桥

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

可扩展的技能框架，90个内置技能覆盖开发、文档、安全、媒体等全场景。

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
- **统一工具注册表**: FunctionCaller 60+ 工具 + MCP 8 服务器 + Skills 90 技能
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

- **21个钩子事件**: PreToolUse, PostToolUse, SessionStart, PreCompact, FileModified等
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

- Framework: Electron 39.2.6
- UI: Vue 3.4 + Composition API
- UI库: Ant Design Vue 4.1
- 状态管理: Pinia
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

### Phase 4: 技能生态 (v0.35–v0.37) ✅ 当前版本

- ✅ 90个内置技能 (100% Handler覆盖)
- ✅ 统一工具注册表 (FunctionCaller+MCP+Skills)
- ✅ Agent Skills开放标准 (13扩展字段)
- ✅ 10个AI演示模板
- ✅ Android 28技能 + PC远程委托
- ✅ 技能市场第四层加载 (bundled→marketplace→managed→workspace)

### Phase 5: 生态完善 (v0.38–v0.40) 🔄 进行中

- ✅ SIMKey v0.38.0 (iOS eSIM, 5G优化, NFC离线签名, 多SIM卡切换, 健康监控, 量子抗性算法)
- 🔄 多模态AI能力增强 (图片/音频/视频理解)
- 🔄 工作流编排可视化编辑器
- 🔄 跨设备技能同步和迁移
- 🔄 社区技能市场上线 (用户贡献技能)
- 🔄 MCP服务器热加载和动态发现
- 🔄 iOS端技能系统 + Computer Use
- 🔄 交易辅助增强 (拍卖系统、团购/拼单、分期付款、闪电网络支付)
- 🔄 去中心化金融扩展 (P2P信用借贷、保险池、跨链支付桥)

### Phase 6: 企业级 (v1.0) 📋 计划中

- 📋 企业组织管理 (多层级, 审批流)
- 📋 实时协作编辑 (CRDT/OT)
- 📋 去中心化存储 (IPFS集成)
- 📋 高级数据分析仪表盘
- 📋 AI Agent自主任务执行 (长时间运行)
- 📋 多语言国际化 (i18n完善)
- 📋 性能监控和自动调优

### 远景 (v2.0+) 🔮

- 🔮 去中心化AI模型训练和推理市场
- 🔮 跨链互操作协议
- 🔮 语音/手势自然交互
- 🔮 AR/VR知识空间
- 🔮 联邦学习隐私保护AI
- 🔮 开放Agent协议 (跨平台Agent互操作)

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
- [AI技能系统](/chainlesschain/skills) - 90个内置技能
- [Cowork多智能体](/chainlesschain/cowork) - 多Agent协作
- [Computer Use](/chainlesschain/computer-use) - 电脑操作能力
- [去中心化社交](/chainlesschain/social) - 了解P2P通讯
- [AI模型配置](/chainlesschain/ai-models) - 配置本地AI
- [会话管理](/chainlesschain/session-manager) - 智能会话和记忆
- [Hooks扩展](/chainlesschain/hooks) - 自定义钩子系统
- [权限管理](/chainlesschain/permissions) - 企业级RBAC
- [Git同步](/chainlesschain/git-sync) - 设置跨设备同步

---

**用技术捍卫隐私，用AI赋能个人** 🚀
