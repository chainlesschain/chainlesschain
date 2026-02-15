# ChainlessChain - 基于U盾和SIMKey的个人移动AI管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-v0.33.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-100%25-brightgreen.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.2.7-blue.svg)
![Tests](https://img.shields.io/badge/tests-2000%2B-brightgreen.svg)

**去中心化 · 隐私优先 · AI原生**

一个完全去中心化的个人AI助手平台,整合知识库管理、社交网络和交易辅助三大核心功能。

[English](./README_EN.md) | [设计文档](./docs/design/系统设计_主文档.md) | [详细功能](./docs/FEATURES.md)

</div>

---

## ⭐ 当前版本: v0.33.0 (2026-02-13)

### 最新更新 - Remote Control 远程控制系统 + Browser Extension 浏览器扩展

**P2P Remote Control System** - 基于P2P网络的远程命令系统，支持Android设备远程控制PC，24+命令处理器，45,000+行代码

#### 新增核心功能 (2026-02-13)

- ✅ **Remote Control Gateway** - P2P远程网关，命令路由、权限验证(1,876行)、日志统计
- ✅ **24+ Command Handlers** - AI/系统/文件传输/浏览器/电源/进程/媒体/网络/存储/显示/输入/应用管理/安全/知识库/设备管理/命令历史/剪贴板/通知/工作流 全面控制
- ✅ **Chrome Browser Extension** - Chrome扩展集成，WebSocket服务器(3,326行)，Service Worker(15,077行)，Content Script
- ✅ **Browser Extension APIs (Phase 11-25)** - 剪贴板/文件/通知/会话管理/控制台/调试/网络模拟/设备仿真/Web APIs/WebRTC/高级存储/Chrome特性/硬件/媒体/Reader模式/截图/标注
- ✅ **Remote Workflow Engine** - 远程工作流引擎(812行)，支持条件分支和自动化任务编排
- ✅ **Android Remote UIs** - 电源/进程/媒体/网络/存储/输入/应用管理/安全信息 8个远程控制界面
- ✅ **Streaming Command Client** - 流式命令客户端，实时数据传输
- ✅ **Event Subscription** - 事件订阅系统，实时状态推送
- ✅ **Logging System** - 命令日志(614行)/批量日志(457行)/统计收集(681行)/性能配置

#### v0.33.0 功能回顾 - Computer Use (2026-02-11)

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

- 🟢 **PC端桌面应用**: 100% 完成 - **生产就绪**
- 🟢 **知识库管理**: 100% 完成 - **8算法+5可视化+智能提取+6导出**
- 🟢 **AI引擎系统**: 100% 完成 - **17项优化+16个专用引擎+智能决策系统**
- 🟢 **Cowork多代理系统**: 100% 完成 - **智能编排+代理池+4技能+4集成+10+图表**
- 🟢 **企业版**: 100% 完成 - **知识库协作+DID邀请链接+企业仪表板**
- 🟢 **区块链集成**: 100% 完成 - **15链支持+RPC管理+完整UI**
- 🟢 **远程控制系统**: 100% 完成 - **P2P远程网关+24+命令处理器+Chrome扩展+45,000+行代码**
- 🟢 **移动端应用**: 100% 完成 - **完整功能+桌面同步+Android P2P UI+远程控制UI**

## 核心特性

- 🔐 **军事级安全**: SQLCipher AES-256加密 + U盾硬件密钥 + Signal协议E2E加密
- 📡 **Remote Control**: P2P远程控制 + 24+命令处理器 + Chrome扩展 + 45,000+行代码
- 🖥️ **Computer Use**: Claude风格电脑操作 + 视觉AI定位 + 工作流引擎 + 68+ IPC通道
- 🧠 **永久记忆系统**: Daily Notes自动记录 + MEMORY.md长期萃取 + 混合搜索(Vector+BM25)
- 🎯 **Context Engineering**: KV-Cache优化 + Token预估 + 可恢复压缩 + 任务上下文管理
- 📋 **Plan Mode**: Claude Code风格计划模式 + 安全分析 + 审批工作流
- 🛡️ **企业级权限**: RBAC权限引擎 + 资源级控制 + 权限继承 + 委托机制
- 👥 **团队管理**: 子团队层级结构 + 成员管理 + Daily Standup + AI日报摘要
- 📊 **统一日志系统**: 集中式logger管理 + 日志级别控制 + 结构化日志
- 🌐 **完全去中心化**: P2P网络(libp2p 3.1.2) + DHT + 本地数据存储
- 🧠 **AI原生**: 支持14+云LLM提供商 + Ollama本地部署 + RAG增强检索
- 🤖 **Cowork多代理协作**: AI智能编排 + 代理池复用 + 45个IPC接口 + 文件沙箱 + 10+可视化图表
- ⚡ **智能工作流优化**: 17项优化(语义缓存+智能决策+关键路径+实时质量+自动化)
- 🔌 **MCP集成**: Model Context Protocol支持,5个官方服务器 + 安全沙箱 + 63测试用例
- 🪝 **Hooks系统**: 21种钩子事件 + 4种钩子类型 + 优先级系统 + 脚本钩子
- 🎨 **Skills系统**: Markdown Skills + 三层加载机制 + /skill命令 + 门控检查
- 📊 **知识图谱可视化**: 8个图分析算法 + 5种可视化方式 + 6种导出格式
- ⛓️ **区块链集成**: 6个智能合约 + HD钱包系统 + LayerZero跨链桥
- 🏢 **企业版**: 多身份架构 + RBAC权限 + 知识库协作 + DID邀请链接
- 📱 **跨设备协作**: Git同步 + 桌面-移动端双向同步 + 多设备P2P通信
- 🧪 **全面测试体系**: 2000+测试用例 + 417测试文件 + OWASP安全验证 + DI测试重构
- 🌐 **浏览器自动化**: BrowserEngine + SnapshotEngine + 智能元素定位 + 18个IPC通道
- 📝 **TypeScript支持**: Stores/Composables TypeScript迁移 + 类型安全 + IDE增强
- 🔓 **开源自主**: 250,000+行代码,358个Vue组件,完全透明可审计

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
- ✅ WebRTC语音/视频通话
- ✅ 社区论坛(Spring Boot + Vue3)

### 3️⃣ 去中心化交易 (100% 完成) ✅

- ✅ 数字资产管理(Token/NFT/知识产品)
- ✅ 智能合约引擎(5种合约类型)
- ✅ 托管服务(4种托管类型)
- ✅ 区块链集成(15链支持+跨链桥)
- ✅ 信用评分系统(6维度评分+5级等级)

### 4️⃣ Cowork多代理协作 + 工作流优化 (100% 完成) ✅

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
- ✅ **Skills系统** - Markdown技能定义、三层加载机制
- ✅ **/skill命令** - 用户命令解析、自动执行
- ✅ **门控检查** - 平台、依赖、环境变量检测

详细功能说明见 [Hooks系统设计](./docs/design/HOOKS_SYSTEM_DESIGN.md)

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
│   │   │   │   ├── context-engineering.js       # KV-Cache优化核心
│   │   │   │   └── context-engineering-ipc.js   # Context Engineering IPC (17通道)
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
│   │   │   ├── p2p/          # P2P网络 (libp2p)
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
│   │   │   │   ├── cowork/   # Cowork多代理协作系统
│   │   │   │   │   └── skills/               # Skills系统
│   │   │   │   │       ├── index.js          # 技能加载器
│   │   │   │   │       ├── skills-ipc.js     # Skills IPC (17通道)
│   │   │   │   │       └── builtin/          # 内置技能 (代码审查/Git提交/代码解释)
│   │   │   │   ├── plan-mode/                # Plan Mode系统 (Claude Code风格)
│   │   │   │   │   ├── index.js              # PlanModeManager
│   │   │   │   │   └── plan-mode-ipc.js      # Plan Mode IPC (14通道)
│   │   │   │   ├── smart-plan-cache.js           # 智能计划缓存
│   │   │   │   ├── llm-decision-engine.js        # LLM决策引擎
│   │   │   │   ├── critical-path-optimizer.js    # 关键路径优化
│   │   │   │   ├── real-time-quality-gate.js     # 实时质量检查
│   │   │   │   ├── task-executor.js              # 任务执行器
│   │   │   │   └── task-planner-enhanced.js      # 增强型任务规划器
│   │   │   └── monitoring/   # 监控和日志
│   │   └── renderer/         # 渲染进程 (Vue3 + TypeScript, 31 Pinia Stores)
│   ├── contracts/            # 智能合约 (Hardhat + Solidity)
│   └── tests/                # 测试套件 (2000+测试用例, 417测试文件)
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
- SQLite/SQLCipher (AES-256) + libp2p 3.1.2
- 16个专用AI引擎 + 17项智能优化 + 115个技能 + 300个工具
- 永久记忆: Daily Notes + MEMORY.md + 混合搜索(Vector+BM25)
- Context Engineering: KV-Cache优化 + Token预估 + 可恢复压缩
- 企业权限: RBAC引擎 + 团队管理 + 审批工作流 + 权限委托
- 远程控制: P2P网关 + 24+命令处理器 + Chrome扩展 + 工作流引擎 + 45,000+行
- 浏览器控制: BrowserEngine + SnapshotEngine + DI可测性 + 18 IPC通道
- Claude Code风格: 10子系统 + 127 IPC通道 (Hooks/Plan Mode/Skills等)
- 工作流优化: 智能缓存 + LLM决策 + 代理池 + 关键路径 + 实时质量
- 可视化: ECharts TaskMonitor仪表盘 + Tree-shaking优化
- Firebase: 消息推送 + WebRTC增强
- 测试框架: Vitest + 2000+测试用例 + 417测试文件 + DI重构

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

### 未来优化方向 ⏳

- [ ] **扩展MCP服务器支持**: HTTP+SSE传输, 更多MCP服务器
- [ ] **增强多代理协作**: 更多专业化代理
- [ ] **社区生态**: 插件市场, 社区MCP服务器
- [ ] **企业高级功能**: SSO, 审计日志, 合规管理

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
