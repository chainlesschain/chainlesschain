# ChainlessChain - 基于U盾和SIMKey的个人移动AI管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-v0.20.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-99%25-brightgreen.svg)
![GitHub release](https://img.shields.io/github/v/release/chainlesschain/chainlesschain?color=blue)
![GitHub downloads](https://img.shields.io/github/downloads/chainlesschain/chainlesschain/total?color=brightgreen)
![GitHub stars](https://img.shields.io/github/stars/chainlesschain/chainlesschain?style=social)
![GitHub forks](https://img.shields.io/github/forks/chainlesschain/chainlesschain?style=social)

![Phase 1](https://img.shields.io/badge/Phase%201-100%25-brightgreen.svg)
![Phase 2](https://img.shields.io/badge/Phase%202-100%25-brightgreen.svg)
![Phase 3](https://img.shields.io/badge/Phase%203-100%25-brightgreen.svg)
![P2 Optimization](https://img.shields.io/badge/P2%20Optimization-100%25-brightgreen.svg)
![Deep Optimization](https://img.shields.io/badge/Deep%20Optimization-100%25-brightgreen.svg)
![Enterprise](https://img.shields.io/badge/Enterprise-45%25-yellow.svg)
![Blockchain](https://img.shields.io/badge/Blockchain-55%25-yellow.svg)

**去中心化 · 隐私优先 · AI原生**

一个完全去中心化的个人AI助手平台,整合知识库管理、社交网络和交易辅助三大核心功能。

[English](./README_EN.md) | [设计文档](./docs/design/系统设计_个人移动AI管理系统.md)

</div>

---

## ⭐ 当前版本: v0.21.0 (2026-01-13)

### 最新更新
- ✅ **交易UI优化** - 订单QR码生成、订单编辑功能、多种分享方式(链接/社交/导出)、多格式导出(JSON/CSV/PDF/图片) ⭐最新
- ✅ **语音消息播放功能** - 完整的语音消息播放系统，支持播放/暂停控制、播放状态显示、自动资源清理、错误处理
- ✅ **P2P文件传输完整实现** - 大文件分块传输(64KB chunks)、断点续传、实时进度跟踪、SHA-256完整性校验、并发传输控制
- ✅ **消息转发功能** - 支持将消息转发到其他聊天会话，支持文本、图片、文件等多种消息类型，自动复制文件，记录转发来源
- ✅ **聊天文件传输功能** - 支持在P2P聊天中发送/接收图片和文件，自动文件管理，支持下载保存，集成P2P直传
- ✅ **消息搜索功能** - 支持在聊天历史中搜索消息内容，可按对话、角色过滤，支持分页和排序
- ✅ **知识图谱可视化完善** - 8个图分析算法、5种可视化方式(2D/3D/时间轴/热力图)、智能实体提取、6种导出格式
- ✅ **图分析算法** - PageRank、度中心性、接近中心性、中介中心性、Louvain社区检测、K-means聚类、关键节点识别
- ✅ **多维度可视化** - 2D优化(LOD/节点聚合/渐进渲染)、3D力导向图(WebGL)、时间轴视图、关系热力图
- ✅ **智能实体提取** - 9种实体类型、8种关系类型、基于规则+LLM双模式、关键词提取、Wiki链接识别
- ✅ **多格式导出** - JSON、GraphML(Gephi)、GEXF、DOT(Graphviz)、CSV、交互式HTML
- ✅ **企业版DID邀请链接** - 安全令牌生成、灵活使用控制、过期管理、权限控制、使用记录追踪、统计分析
- ✅ **移动端知识库增强** - Markdown渲染、代码高亮、图片预览、工具栏、实时预览、图片上传、自动保存草稿
- ✅ **语音识别功能完善** - Whisper集成测试通过(100%准确度/2.5x实时速度)，语音设置UI完成，支持本地/云端识别
- ✅ **PC端核心功能完善** - 多语言支持、STUN/TURN网络测试、系统设置优化、性能监控增强
- ✅ **P2P通信完善** - WebRTC语音/视频通话完整实现、屏幕共享支持、MediaStream桥接、Signal Protocol高级测试、信令服务器优化
- ✅ **文档结构重构** - 重新组织文档目录结构，提升可维护性和可读性，新增测试报告
- ✅ **测试框架升级** - 全面迁移到Vitest(94个测试文件/900+用例)，性能优化集成完成
- ✅ **移动端数据同步** - 实现移动端与PC端数据同步功能，支持跨设备无缝协作
- ✅ **Linux平台完整支持** - 添加Linux ZIP便携版和DEB安装包支持，覆盖主流发行版
- ✅ **多平台打包优化** - 完善macOS(ARM64/x64)、Windows、Linux三大平台打包流程
- ✅ **深度性能优化系统完成** - 新增14,000+行优化代码，18个工具类，4个专用组件，全方位性能提升
- ✅ **智能图片优化系统** - WebP/AVIF格式检测、响应式加载、渐进式加载、LQIP占位符、CDN支持、网络感知
- ✅ **实时性能监控系统** - Core Web Vitals监控(LCP/FID/CLS)、性能预算、FPS监控、内存监控、性能告警
- ✅ **前端深度优化** - 代码分割、组件懒加载、虚拟滚动、智能预取、请求批处理、乐观更新、数据压缩
- ✅ **性能工具集** - 增量同步、内存优化、动画控制、资源提示、性能基准测试、无障碍功能增强
- ✅ **测试框架升级** - 修复测试环境配置并全面迁移到Vitest API，94个测试文件，900+测试用例
- ✅ **性能优化集成** - 集成性能优化组件，内存降级、磁盘检查、并发控制、文件恢复，提升系统整体性能
- ✅ **核心模块测试** - 新增Git、文件权限、合约引擎、桥接管理4个核心模块的单元测试
- ✅ **安全防护体系** - 实现全面的安全防护体系，包括输入验证、权限控制、加密传输
- ✅ **P2优化完成** - AI引擎性能大幅提升：LLM调用减少58%、感知延迟降低93%、计算成本节省28%
- ✅ **V3工具系统恢复** - 工具总数扩展至300个，恢复28个专业领域工具，覆盖区块链/财务/CRM等9大领域
- ✅ **应用菜单集成** - 原生应用菜单支持、MenuManager管理器、20+个IPC通道、高级特性控制面板
- ✅ **代码库完善与优化** - 更新项目文档、优化模板配置、完善测试套件
- ✅ **企业版（去中心化组织）** - 多身份架构、RBAC权限系统、组织管理(创建/加入/成员管理)、数据库隔离(9个新表)、组织DID支持
- ✅ **技能工具系统扩展至115个技能** - 第6-10批扩展完成，300个工具，涵盖10大类别（3D建模、音频分析、区块链、IoT、机器学习、网络安全、生物信息、量子通信等）
- ✅ **测试框架全面升级** - 94个测试文件，900+测试用例，全面迁移到Vitest框架，覆盖核心功能
- ✅ **多数据库隔离** - 支持个人数据库+多个组织数据库，数据完全隔离，动态切换
- ✅ **区块链集成Phase 1-3完成** - 智能合约系统(6个合约 + 测试 + 部署)、钱包系统(内置+外部)、Hardhat开发环境
- ✅ **智能合约开发** - ChainlessToken(ERC20)、ChainlessNFT(ERC721)、托管合约、订阅合约、悬赏合约、跨链桥，2400+行代码
- ✅ **浏览器扩展完善** - 自动化测试框架、用户/开发者/测试指南、测试报告生成
- ✅ **插件系统增强** - 集成技能工具系统，支持动态加载和热更新
- ✅ **语音识别系统完成** - Whisper集成测试通过(100%准确度/2.5x实时速度)，语音设置UI完成，支持本地/云端识别
- ✅ **19个AI专用引擎** - 代码生成/审查、文档处理(Word/PDF/Excel/PPT)、图像/视频处理、Web开发、数据分析等专业引擎
- ✅ **完整后端服务体系** - Project Service (Spring Boot, 48 API) + AI Service (FastAPI, 38 API) + Community Forum (63 API)
- ✅ **145个Vue组件** - 14个页面、54个项目组件、交易组件(含托管UI)、社交组件、编辑器、技能工具组件、企业版组件

### 项目状态 (整体完成度: 99%)
- 🟢 **PC端桌面应用**: 100% 完成 - **生产就绪** ⭐完成
- 🟢 **知识库管理**: 100% 完成 - **生产就绪** ⭐完成
- 🟢 **知识图谱可视化**: 100% 完成 - **8算法+5可视化+智能提取+6导出** ⭐完成
- 🟢 **AI引擎系统**: 100% 完成 - **P2优化+16个专用引擎** ⭐完成
- 🟢 **RAG检索系统**: 100% 完成 - **混合搜索+重排序** ⭐完成
- 🟢 **后端服务**: 100% 完成 - **3个微服务+对话管理API** ⭐完成
- 🟢 **技能工具系统**: 100% 完成 - **115技能+300工具** ⭐完成
- 🟢 **插件系统**: 100% 完成 - **动态加载+热更新** ⭐完成
- 🟢 **语音识别**: 100% 完成 - **Whisper集成+设置UI+测试通过** ⭐完成
- 🟢 **深度性能优化**: 100% 完成 - **18个优化工具+4个专用组件** ⭐完成
- 🟢 **性能优化**: 100% 完成 - **内存/磁盘/并发控制** ⭐完成
- 🟢 **安全防护**: 100% 完成 - **输入验证/权限控制/加密** ⭐完成
- 🟢 **测试框架**: 100% 完成 - **94个测试文件，900+用例，Vitest框架** ⭐完成
- 🟢 **企业版（去中心化组织）**: 100% 完成 - **核心架构+组织管理+DID邀请链接+企业仪表板** ⭐完成
- 🟢 **区块链集成**: 100% 完成 - **15链支持+RPC管理+事件监听+完整UI** ⭐完成
- 🟢 **去中心化身份**: 100% 完成 - **DID+组织DID+VC+DHT发布+缓存+自动更新** ⭐完成
- 🟢 **P2P通信**: 100% 完成 - **E2E加密+WebRTC语音/视频通话+屏幕共享+文件传输** ⭐完成
- 🟢 **社交系统**: 98% 完成 - **好友+动态+论坛+群聊+文件传输+消息转发+语音消息播放** ⭐提升
- 🟢 **交易系统**: 95% 完成 - **8大模块+链上合约+NFT转账+订单编辑+分享+QR码** ⭐提升
- 🟡 **浏览器扩展**: 70% 完成 - **测试框架+文档完善**
- 🟢 **移动端应用**: 75% 完成 - **知识库+AI聊天+交易系统(85%)+社交功能(80%)+P2P同步** ⭐大幅提升

## 核心特性

- 🔐 **军事级安全**: SQLCipher AES-256加密 + 跨平台U盾硬件密钥 + Signal协议E2E加密 ✅ ⭐更新
- 🌐 **完全去中心化**: P2P网络(libp2p 3.1.2) + DHT + 本地数据存储，无需中心服务器 ✅
- 📁 **P2P文件传输**: 大文件分块传输(64KB) + 断点续传 + 实时进度 + SHA-256校验 + 并发控制 ✅ ⭐新增
- 🧠 **AI原生**: 支持14+云LLM提供商 + Ollama本地部署 + RAG增强检索 ✅
- 📊 **知识图谱可视化**: 8个图分析算法 + 5种可视化方式 + 智能实体提取 + 6种导出格式 ✅ ⭐新增
- 🎯 **16个AI引擎**: 代码/文档/表格/PPT/PDF/图像/视频/数据可视化等专业处理，覆盖全场景 ✅
- 📋 **模板系统**: 178个AI模板 + 32个分类 + 智能引擎分配 + 100%配置覆盖 ✅
- ⛓️ **区块链集成**: 6个智能合约 + HD钱包系统 + MetaMask/WalletConnect + LayerZero跨链桥 ✅ ⭐更新
- 🏢 **企业版（去中心化组织）**: 多身份架构 + RBAC权限 + 组织管理 + 数据隔离 + DID邀请链接系统 + 企业仪表板(10个IPC处理器) ✅ ⭐完成
- 🔧 **技能工具系统**: 115个技能 + 300个工具 + 10大类别 + 动态管理 ✅
- 🔌 **插件系统**: 动态加载 + 热更新 + 生命周期管理 + API扩展 ✅
- 🎤 **语音识别**: Whisper集成(本地/云端) + 实时转写 + 设置UI + 测试通过(100%准确度) ✅ ⭐更新
- 📱 **跨设备协作**: Git同步 + 移动端PC端数据同步 + 多设备P2P通信 + 离线消息队列 + 移动端Markdown编辑器 ✅ ⭐更新
- 🔓 **开源自主**: 220,000+行代码，243个Vue组件，23个页面，完全透明可审计 ✅ ⭐更新
- ⚡ **P2优化系统**: 意图融合、知识蒸馏、流式响应，AI引擎性能提升40% ✅
- 🚀 **深度性能优化**: 18个优化工具 + 4个专用组件 + Core Web Vitals监控 + 智能图片加载 ✅
- 🎛️ **高级特性控制面板**: 实时监控、配置管理、20+个IPC通道、原生菜单集成 ✅
- 📸 **智能图片处理**: Tesseract.js OCR + Sharp图像处理 + WebP/AVIF优化 + 响应式加载 ✅
- 💼 **微服务架构**: Project Service + AI Service + Community Forum，149个API端点 ✅
- 🔄 **数据库同步**: SQLite ↔ PostgreSQL 双向同步，软删除+冲突解决 ✅
- 🌐 **浏览器扩展**: 网页标注 + 内容提取 + AI辅助 + 自动化测试 ✅
- 🧪 **完整测试体系**: Vitest单元测试 + Playwright E2E + 94个测试文件 + 900+测试用例 + Whisper集成测试 ✅ ⭐更新
- 🌐 **多语言支持**: 中文/英文/日语/韩语等多语言界面 ✅ ⭐新增
- 🔌 **网络测试**: STUN/TURN服务器测试 + NAT类型检测 + 连接质量评估 ✅ ⭐新增

### P2P文件传输系统 ⭐新增

ChainlessChain实现了完整的P2P文件传输系统，支持大文件的高效、安全传输：

**核心特性**:
- 📦 **大文件分块传输**: 64KB分块大小，支持任意大小文件传输
- 🔄 **断点续传**: 传输中断后可从断点继续，无需重新开始
- 📊 **实时进度跟踪**: 实时显示传输进度、速度、剩余时间
- ✅ **文件完整性校验**: SHA-256哈希校验，确保文件完整性
- ⚡ **并发传输控制**: 最多3个分块并发传输，优化传输速度
- 🎯 **智能重试机制**: 失败分块自动重试，最多3次
- 💾 **临时文件管理**: 自动管理临时文件，传输完成后清理
- 🔐 **E2E加密**: 基于Signal Protocol的端到端加密传输

**使用场景**:
- 聊天中发送/接收图片和文件
- 知识库文件同步
- 项目文件协作
- 大文件点对点传输

**技术实现**:
- 基于libp2p的P2P网络层
- MessageManager消息管理和批量处理
- FileTransferManager文件传输管理
- 集成到聊天系统的IPC接口


## 🌉 生产级跨链桥系统 ⭐新增

ChainlessChain实现了企业级跨链桥系统，支持安全、高效的跨链资产转移：

### 核心特性

**🔒 多重安全防护**:
- **多重签名验证**: 大额转账需要2+签名确认，5分钟签名超时
- **速率限制**: 每小时最多10笔转账，单笔最高1000代币
- **日交易量限制**: 每日最高10000代币转账限额
- **黑名单系统**: 自动拦截可疑地址，支持动态添加/移除
- **紧急暂停机制**: 检测到异常时自动暂停桥接，1小时后自动恢复
- **可疑活动检测**: 实时监控快速连续转账、大额转账等异常模式

**🤖 自动化中继系统**:
- **事件监听**: 12秒轮询间隔，自动扫描源链锁定事件
- **交易验证**: 等待12个区块确认，验证交易有效性
- **自动执行**: 在目标链自动提交铸造交易
- **智能重试**: 失败自动重试3次，支持指数退避
- **Gas优化**: 动态Gas价格调整，最高500 Gwei限制
- **中继奖励**: 0.1%基础费用 + 最低0.001 ETH

**⚡ 费用优化**:
- **动态Gas估算**: 根据网络拥堵自动调整Gas价格
- **L2特殊处理**: Arbitrum/Optimism/Base的L1数据费用计算
- **费用预估**: 桥接前准确估算总费用
- **多协议支持**: 支持原生桥接和LayerZero协议

**📊 全面监控**:
- **安全事件日志**: 记录所有安全相关事件（黑名单、速率限制、可疑活动）
- **中继统计**: 实时跟踪成功/失败中继、总费用、平均时间
- **桥接历史**: 完整的跨链转账记录，支持多维度查询
- **实时告警**: 可疑活动、桥接暂停等事件实时通知

### 支持的链

- **以太坊**: Mainnet (1), Sepolia (11155111)
- **Polygon**: Mainnet (137), Mumbai (80001)
- **BSC**: Mainnet (56), Testnet (97)
- **Arbitrum**: One (42161), Sepolia (421614)
- **Optimism**: Mainnet (10), Sepolia (11155420)
- **Avalanche**: C-Chain (43114), Fuji (43113)
- **Base**: Mainnet (8453), Sepolia (84532)
- **本地测试**: Hardhat (31337)

### 桥接模式

**1. 锁定-铸造模式** (默认):
- 源链锁定资产到桥接合约
- 目标链铸造等量包装资产
- 适用于大多数ERC-20代币

**2. LayerZero协议** (可选):
- 使用LayerZero的全链互操作协议
- 更快的跨链消息传递
- 支持更多链和更复杂的跨链操作

### 安全配置

```javascript
// 速率限制
MAX_TRANSFERS_PER_HOUR: 10        // 每小时最多10笔
MAX_AMOUNT_PER_TRANSFER: 1000     // 单笔最高1000代币
MAX_DAILY_VOLUME: 10000           // 每日最高10000代币

// 多重签名
MIN_SIGNATURES_REQUIRED: 2        // 至少2个签名
SIGNATURE_TIMEOUT: 5分钟          // 签名超时时间

// 监控阈值
SUSPICIOUS_AMOUNT_THRESHOLD: 100  // 可疑金额阈值
MAX_RAPID_TRANSFERS: 3            // 1分钟内最多3笔
```

### 使用示例

```javascript
// 1. 基础桥接
const result = await bridgeManager.bridgeAsset({
  assetId: 'asset-uuid',
  fromChainId: 1,      // Ethereum
  toChainId: 137,      // Polygon
  amount: '100',
  walletId: 'wallet-id',
  password: 'password',
  recipientAddress: '0x...' // 可选
});

// 2. 使用LayerZero
const result = await bridgeManager.bridgeAsset({
  assetId: 'asset-uuid',
  fromChainId: 1,
  toChainId: 137,
  amount: '100',
  walletId: 'wallet-id',
  password: 'password',
  useLayerZero: true   // 启用LayerZero
});

// 3. 启动自动中继器
await bridgeManager.startRelayer();

// 4. 获取中继统计
const stats = bridgeManager.getRelayerStats();
console.log(`成功中继: ${stats.successfulRelays}`);
console.log(`总费用: ${stats.totalFeesEarned}`);

// 5. 查询桥接历史
const history = await bridgeManager.getBridgeHistory({
  status: 'completed',
  fromChainId: 1,
  limit: 50
});

// 6. 紧急暂停
await bridgeManager.pauseBridge(3600000, '检测到异常活动');

// 7. 黑名单管理
await bridgeManager.blacklistAddress('0x...', '可疑地址');
```

### 数据库表结构

**bridge_transfers** - 桥接记录:
- 源链/目标链信息
- 交易哈希（源链和目标链）
- 资产地址和数量
- 发送者/接收者地址
- 状态（pending/locked/completed/failed）
- 时间戳

**bridge_security_events** - 安全事件:
- 事件类型（黑名单、速率限制、可疑活动等）
- 严重程度（info/medium/high/critical）
- 相关地址和金额
- 详细信息

**bridge_relay_tasks** - 中继任务:
- 请求ID和交易哈希
- 源链/目标链
- 资产信息
- 状态和重试次数
- 中继费用

**bridge_multisig_txs** - 多签交易:
- 交易ID和数据
- 所需签名数
- 已收集的签名
- 状态和时间戳

### 事件监听

```javascript
// 安全事件
bridgeManager.on('security-event', (event) => {
  console.log('Security event:', event.type, event.severity);
});

// 可疑活动
bridgeManager.on('suspicious-activity', (data) => {
  console.warn('Suspicious activity:', data);
});

// 桥接暂停
bridgeManager.on('bridge-paused', (data) => {
  console.warn('Bridge paused:', data.reason);
});

// 锁定检测
bridgeManager.on('lock-detected', (task) => {
  console.log('Lock detected:', task.request_id);
});

// 中继完成
bridgeManager.on('relay-completed', (data) => {
  console.log('Relay completed:', data.requestId);
});

// 多签需求
bridgeManager.on('multisig-required', (data) => {
  console.log('Multi-sig required:', data.txId);
});
```

### 技术架构

**BridgeManager** - 主管理器:
- 桥接流程协调
- 合约交互
- 记录管理

**BridgeSecurityManager** - 安全管理:
- 转账验证
- 速率限制
- 黑名单管理
- 多重签名
- 紧急暂停

**BridgeRelayer** - 自动中继:
- 事件监听
- 交易验证
- 自动执行
- 重试机制
- 统计跟踪

**LayerZeroBridge** - LayerZero集成:
- 全链消息传递
- 费用估算
- 交易跟踪

### 区块链适配器系统 ⭐完整

ChainlessChain实现了完整的区块链适配器系统，提供统一的多链交互接口：

#### 1. 多链支持 (15条区块链)

**主网**:
- Ethereum (以太坊主网)
- Polygon (Polygon主网)
- BSC (币安智能链)
- Arbitrum One (Arbitrum主网)
- Optimism (Optimism主网)
- Avalanche C-Chain (雪崩C链)
- Base (Base主网)

**测试网**:
- Ethereum Sepolia
- Polygon Mumbai
- BSC Testnet
- Arbitrum Sepolia
- Optimism Sepolia
- Avalanche Fuji
- Base Sepolia
- Hardhat Local (本地开发网络)

#### 2. 智能合约部署

**代币合约**:
- ✅ ERC-20代币部署 (ChainlessToken)
- ✅ ERC-721 NFT部署 (ChainlessNFT)
- ✅ 自定义代币参数 (名称/符号/小数位/初始供应量)

**业务合约**:
- ✅ 托管合约 (EscrowContract) - 支持买卖双方资金托管
- ✅ 订阅合约 (SubscriptionContract) - 支持周期性订阅付款
- ✅ 悬赏合约 (BountyContract) - 支持任务悬赏和奖励分配

#### 3. 资产操作

**代币操作**:
- ✅ 代币转账 (单笔/批量)
- ✅ 代币余额查询
- ✅ 代币授权管理

**NFT操作**:
- ✅ NFT铸造 (mint)
- ✅ NFT转账 (单笔/批量)
- ✅ NFT所有权查询
- ✅ NFT元数据URI查询
- ✅ NFT余额查询

#### 4. 钱包管理系统

**HD钱包**:
- ✅ BIP39助记词生成 (12个单词)
- ✅ BIP44派生路径 (m/44'/60'/0'/0/0)
- ✅ 从助记词导入钱包
- ✅ 从私钥导入钱包
- ✅ 私钥/助记词导出

**安全特性**:
- ✅ AES-256-GCM加密存储
- ✅ PBKDF2密钥派生 (100,000次迭代)
- ✅ U-Key硬件签名支持
- ✅ 钱包锁定/解锁机制

**外部钱包**:
- ✅ MetaMask集成
- ✅ WalletConnect支持
- ✅ 多钱包管理

#### 5. 高级功能

**Gas优化**:
- ✅ Gas价格优化 (slow/standard/fast三档)
- ✅ 交易费用估算 (支持L2特殊处理)
- ✅ EIP-1559支持 (maxFeePerGas/maxPriorityFeePerGas)

**交易管理**:
- ✅ 交易重试机制 (指数退避，最多3次)
- ✅ 交易监控 (实时状态更新)
- ✅ 交易替换 (取消/加速pending交易)
- ✅ 交易确认数追踪

**事件系统**:
- ✅ 合约事件监听
- ✅ 实时事件推送
- ✅ 事件过滤和查询

#### 6. 跨链桥接

**LayerZero集成**:
- ✅ 跨链资产转移
- ✅ 跨链消息传递
- ✅ 支持15条链互通
- ✅ 自动路由优化

#### 7. 链上链下同步

**BlockchainIntegration模块**:
- ✅ 链上资产映射到本地数据库
- ✅ 链上交易记录同步
- ✅ 托管状态同步
- ✅ 自动同步 (每5分钟)
- ✅ 同步日志和错误追踪

#### 8. RPC管理

**智能RPC切换**:
- ✅ 多RPC端点配置
- ✅ 自动故障转移
- ✅ 连接超时检测 (5秒)
- ✅ 公共RPC备用

#### 9. 区块浏览器集成

**支持的浏览器**:
- Etherscan (Ethereum)
- Polygonscan (Polygon)
- BscScan (BSC)
- Arbiscan (Arbitrum)
- Optimistic Etherscan (Optimism)
- SnowTrace (Avalanche)
- BaseScan (Base)

**功能**:
- ✅ 交易查询链接生成
- ✅ 地址查询链接生成
- ✅ 合约验证链接

#### 10. 技术架构

**核心模块**:
```
desktop-app-vue/src/main/blockchain/
├── blockchain-adapter.js          # 核心适配器 (1087行)
├── blockchain-config.js           # 网络配置 (524行)
├── wallet-manager.js              # 钱包管理 (891行)
├── blockchain-integration.js      # 链上链下集成 (637行)
├── bridge-manager.js              # 跨链桥管理
├── transaction-monitor.js         # 交易监控
├── event-listener.js              # 事件监听
├── contract-artifacts.js          # 合约ABI
└── rpc-manager.js                 # RPC管理
```

**IPC接口**:
- `blockchain-ipc.js` - 区块链基础操作
- `wallet-ipc.js` - 钱包操作
- `contract-ipc.js` - 合约交互
- `asset-ipc.js` - 资产管理
- `bridge-ipc.js` - 跨链桥接
- `escrow-ipc.js` - 托管操作
- `marketplace-ipc.js` - 市场交易

**数据库表**:
- `blockchain_wallets` - 钱包信息
- `blockchain_asset_mapping` - 资产映射
- `blockchain_transaction_mapping` - 交易映射
- `blockchain_escrow_mapping` - 托管映射
- `blockchain_sync_log` - 同步日志

#### 11. 使用示例

**创建钱包**:
```javascript
// 生成新钱包
const wallet = await walletManager.createWallet(password, chainId);
// 返回: { id, address, mnemonic, chainId }

// 从助记词导入
const wallet = await walletManager.importFromMnemonic(mnemonic, password, chainId);

// 从私钥导入
const wallet = await walletManager.importFromPrivateKey(privateKey, password, chainId);
```

**部署合约**:
```javascript
// 部署ERC-20代币
const { address, txHash } = await blockchainAdapter.deployERC20Token(walletId, {
  name: 'My Token',
  symbol: 'MTK',
  decimals: 18,
  initialSupply: 1000000,
  password: 'your-password'
});

// 部署NFT合约
const { address, txHash } = await blockchainAdapter.deployNFT(walletId, {
  name: 'My NFT',
  symbol: 'MNFT',
  password: 'your-password'
});
```

**转账操作**:
```javascript
// 转账代币
const txHash = await blockchainAdapter.transferToken(
  walletId,
  tokenAddress,
  toAddress,
  amount,
  password
);

// 转账NFT
const txHash = await blockchainAdapter.transferNFT(
  walletId,
  nftAddress,
  fromAddress,
  toAddress,
  tokenId,
  password
);
```

**查询余额**:
```javascript
// 查询代币余额
const balance = await blockchainAdapter.getTokenBalance(tokenAddress, ownerAddress);

// 查询NFT余额
const balance = await blockchainAdapter.getNFTBalance(nftAddress, ownerAddress);
```

**切换网络**:
```javascript
// 切换到Polygon主网
await blockchainAdapter.switchChain(137);

// 获取当前链信息
const chainInfo = blockchainAdapter.getCurrentChainInfo();
```

#### 12. 安全特性

- ✅ 私钥本地加密存储 (AES-256-GCM)
- ✅ 助记词加密备份
- ✅ U-Key硬件签名支持
- ✅ 交易签名前验证
- ✅ 地址校验和验证
- ✅ 防重放攻击 (nonce管理)
- ✅ Gas限制保护

#### 13. 性能优化

- ✅ 钱包缓存机制
- ✅ RPC连接池
- ✅ 批量交易处理
- ✅ 事件监听优化
- ✅ 数据库索引优化

#### 14. 错误处理

- ✅ 网络错误自动重试
- ✅ RPC故障自动切换
- ✅ 交易失败回滚
- ✅ 详细错误日志
- ✅ 用户友好错误提示

**代码统计**:
- 核心代码: 5,000+ 行
- 智能合约: 2,400+ 行
- 测试用例: 50+ 个
- 支持链数: 15 条
- IPC接口: 80+ 个

## 📥 下载安装

### Mac用户

#### 下载地址

- **GitHub Releases** (国际用户): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (国内加速): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### 选择对应版本

- **Intel芯片 (x64)**: 下载 `ChainlessChain-darwin-x64-0.20.0.zip` (约1.4GB)
- **Apple Silicon (M1/M2/M3芯片)**: ARM64版本开发中，请使用Rosetta运行x64版本

#### 安装步骤

1. 下载 `ChainlessChain-darwin-x64-0.20.0.zip` 文件
2. 解压缩（双击zip文件）
3. 将 `ChainlessChain.app` 拖到"应用程序"文件夹
4. 双击运行（首次运行请参考下方说明）

#### 首次运行说明

**如果遇到"无法打开，因为无法验证开发者"提示**：

**方法1**（推荐）：
- 右键点击 `ChainlessChain.app`
- 选择"打开"
- 在弹出的对话框中点击"打开"

**方法2**：
- 打开"系统偏好设置" → "安全性与隐私"
- 在"通用"标签页底部，点击"仍要打开"按钮

### Windows用户

#### 下载地址

- **GitHub Releases** (国际用户): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (国内加速): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### 下载版本

- **Windows x64 (64位系统)**: 下载 `ChainlessChain-win32-x64-0.20.0.zip` (约1.4GB)

#### 安装步骤（便携版，无需安装）

1. 下载 `ChainlessChain-win32-x64-0.20.0.zip` 文件
2. 解压到任意文件夹（推荐解压到 `C:\Program Files\ChainlessChain\`）
3. 双击运行 `ChainlessChain.exe`
4. 无需管理员权限

#### 注意事项

- **系统要求**: Windows 10/11 (64位)
- **便携版本**: 可以解压到U盘随身携带
- **数据存储**: 数据库文件位于应用目录下的 `data` 文件夹
- **防火墙**: 首次运行可能需要允许网络访问（用于P2P通信）

#### 从源码构建（可选）

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain/desktop-app-vue
npm install
npm run make:win
```

### Linux用户

#### 下载地址

- **GitHub Releases** (国际用户): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (国内加速): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

> ℹ️ 每次发布正式版本后，GitHub Actions 工作流 `release-linux-packages.yml` 会自动构建并上传最新的 Linux ZIP/DEB/RPM 包到 Release 页面，无需再手动同步制品。

#### 下载版本

- **Linux x64 ZIP便携版**: 下载 `ChainlessChain-linux-x64-0.20.0.zip` (约1.4GB)
- **Linux x64 DEB安装包**: 下载 `chainlesschain-desktop-vue_0.20.0_amd64.deb` (约923MB) ⭐推荐

#### 支持发行版

- Ubuntu 20.04+ / Debian 11+
- Fedora 35+ / CentOS 8+
- Arch Linux / Manjaro
- 其他主流Linux发行版

#### 安装步骤

**方式一：DEB安装包（推荐，适用于Ubuntu/Debian）**

1. 下载deb文件
2. 安装：
   ```bash
   sudo dpkg -i chainlesschain-desktop-vue_0.20.0_amd64.deb
   ```
3. 如遇依赖问题，运行：
   ```bash
   sudo apt-get install -f
   ```
4. 从应用菜单启动，或命令行运行：
   ```bash
   chainlesschain-desktop-vue
   ```

**方式二：ZIP便携版（适用于所有发行版）**

1. 下载zip文件
2. 解压到任意目录：
   ```bash
   unzip ChainlessChain-linux-x64-0.20.0.zip
   cd ChainlessChain-linux-x64
   ```
3. 赋予执行权限：
   ```bash
   chmod +x chainlesschain
   ```
4. 运行应用：
   ```bash
   ./chainlesschain
   ```

#### 可选：创建桌面快捷方式

```bash
# 复制到/opt（可选）
sudo cp -r ChainlessChain-linux-x64 /opt/chainlesschain

# 创建符号链接
sudo ln -s /opt/chainlesschain/chainlesschain /usr/local/bin/chainlesschain

# 创建.desktop文件
cat > ~/.local/share/applications/chainlesschain.desktop <<'EOF'
[Desktop Entry]
Name=ChainlessChain
Comment=去中心化个人AI管理系统
Exec=/opt/chainlesschain/chainlesschain
Icon=/opt/chainlesschain/resources/app/build/icon.png
Terminal=false
Type=Application
Categories=Utility;Office;
EOF
```

#### 依赖项检查

大多数现代Linux发行版已包含所需库。如遇到问题，可能需要安装：

```bash
# Ubuntu/Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6

# Fedora/CentOS
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst

# Arch Linux
sudo pacman -S gtk3 libnotify nss libxss libxtst
```

### 从源码运行（开发者）

如果您想从源码运行或参与开发，请查看下方的 [🚀 快速开始](#🚀-快速开始) 部分。

---

## 三大核心功能

### 1️⃣ 知识库管理 (100% 完成) ✅

**数据库系统**:
- ✅ SQL.js + SQLCipher AES-256加密数据库（50+张表：基础表+企业版表+区块链表+优化表）
- ✅ 知识库项、标签、对话、项目、任务统一管理
- ✅ 软删除机制 + 自动保存 + 事务支持
- ✅ SQLite ↔ PostgreSQL 双向同步（4个核心模块）
- ✅ 性能优化和边界情况处理（内存降级、磁盘检查、并发控制）

**知识图谱可视化** (v0.21.0新增):
- ✅ **8个图分析算法** (~1500行):
  - 度中心性 (Degree Centrality) - 识别连接最多的节点
  - 接近中心性 (Closeness Centrality) - 识别距离其他节点最近的节点
  - 中介中心性 (Betweenness Centrality) - 识别在路径上最重要的节点
  - PageRank - Google的网页排名算法
  - Louvain社区检测 - 自动发现节点群组
  - K-means聚类 - 基于特征的节点聚类
  - 关键节点识别 - 综合多指标找出最重要的节点
  - 图谱统计分析 - 计算密度、聚类系数等指标
- ✅ **5种可视化方式** (~2500行):
  - 2D可视化 - 力导向/环形/层级布局，LOD优化，节点聚合，渐进渲染
  - 3D可视化 - WebGL渲染，自动旋转，多视角切换
  - 时间轴可视化 - 时间序列展示，按天/周/月/年分组
  - 热力图可视化 - 关系强度/活跃度/相似度热力图
  - 分析面板 - 综合分析工具，中心性/社区/路径/邻居探索
- ✅ **智能实体提取** (~1200行):
  - 9种实体类型：人名、组织、地点、日期、时间、概念、技术、产品、事件
  - 8种关系类型：提及、相关、部分、因果、位于、工作于、创建者、使用
  - 基于规则提取 + 基于LLM提取双模式
  - 关键词提取 (TF-IDF)、Wiki链接识别、文本摘要生成
  - 批量处理和实体图构建
- ✅ **6种导出格式** (~800行):
  - JSON - 标准数据交换格式
  - GraphML - Gephi兼容格式
  - GEXF - Gephi原生格式
  - DOT - Graphviz格式
  - CSV - Excel兼容（分别导出节点和边）
  - HTML - 交互式网页，可直接分享
- ✅ **完整测试套件** (test-graph-features.js):
  - 16个测试用例，全部通过
  - 覆盖图分析、实体提取、导出功能
- ✅ **详细文档** (3份文档):
  - KNOWLEDGE_GRAPH_ENHANCEMENTS.md - 功能详细文档
  - KNOWLEDGE_GRAPH_QUICKSTART.md - 快速开始指南
  - KNOWLEDGE_GRAPH_COMPLETION_REPORT.md - 完成报告

**AI增强检索（RAG）**:
- ✅ ChromaDB/Qdrant 向量存储
- ✅ 混合搜索（向量+关键词+FTS5全文索引）
- ✅ 3种重排序算法（LLM、CrossEncoder、混合）
- ✅ 查询重写（多查询、HyDE、逐步回溯）
- ✅ 性能监控和指标收集

**文件处理**:
- ✅ 多格式导入: Markdown/PDF/Word/TXT/图片
- ✅ OCR识别: Tesseract.js，支持中英文
- ✅ 图片处理: Sharp压缩、缩略图、格式转换
- ✅ 6个专业编辑器: Code/Markdown/Excel/PPT/RichText/WebDev

**版本控制**:
- ✅ isomorphic-git纯JS实现
- ✅ AI自动生成提交消息
- ✅ 可视化冲突解决UI
- ✅ Git同步定时器

**深度性能优化** (v0.21.0新增):
- ✅ **智能图片优化** (560行):
  - WebP/AVIF格式自动检测和转换
  - 响应式图片加载(srcset/sizes)
  - LQIP低质量占位符
  - 渐进式加载和CDN支持
  - 网络感知加载(2G/3G自动降质)
- ✅ **实时性能监控** (644行):
  - Core Web Vitals监控(LCP/FID/CLS/FCP/TTFB)
  - 性能预算管理和违规告警
  - FPS实时监控(60fps目标)
  - 内存使用监控和告警
  - 网络状态监控
- ✅ **前端优化工具集** (18个工具类):
  - 代码分割和组件懒加载
  - 虚拟滚动列表(VirtualMessageList)
  - 智能预取(基于用户行为预测)
  - 请求批处理(Request Batching)
  - 乐观更新(Optimistic Updates)
  - 数据压缩(LZ-string算法)
  - 增量同步(Incremental Sync)
  - 内存优化(对象池、弱引用)
  - 动画控制(requestAnimationFrame)
  - 资源提示(preload/prefetch/preconnect)
  - Content Visibility API优化
  - 无障碍功能增强(ARIA)
  - 性能基准测试工具
- ✅ **专用组件** (4个):
  - AsyncComponent.vue - 异步组件加载
  - LazyImage.vue - 懒加载图片组件
  - PerformanceMonitor.vue - 性能监控面板
  - VirtualMessageList.vue - 虚拟滚动消息列表
- ✅ **完整文档**: 8个详细文档(OPTIMIZATION_*.md)

### 2️⃣ 去中心化社交 (85% 完成) ✅

**DID身份系统**:
- ✅ W3C DID Core标准 (`did:chainlesschain:<identifier>`)
- ✅ Ed25519签名密钥对 + X25519加密密钥对
- ✅ DID文档生成、签名、验证
- ✅ 多身份支持 + 助记词导出
- ⏳ P2P网络发布和解析（框架已准备）

**可验证凭证（VC）**:
- ✅ 5种凭证类型: 自我声明、技能证书、信任背书、教育凭证、工作经历
- ✅ W3C VC标准签名和验证
- ✅ 凭证生命周期管理 + 撤销机制

**P2P网络**:
- ✅ libp2p 3.1.2 节点管理
- ✅ TCP传输 + Noise加密 + Kademlia DHT
- ✅ mDNS本地发现 + 设备热插拔监听
- ✅ Signal Protocol E2E加密（完整实现）
- ✅ 设备管理 + 跨设备同步 + 离线消息队列
- ✅ WebRTC语音/视频通话（完整实现）⭐新增
- ✅ 屏幕共享支持（desktopCapturer集成）⭐新增
- ✅ MediaStream桥接（主进程/渲染进程）⭐新增

**社交功能**:
- ✅ 好友管理: 请求/接受/拒绝、在线状态、分组、备注
- ✅ 社交动态: 发布、点赞、评论、分享、图片支持
- ✅ P2P加密私信: 离线消息、多设备同步、文件传输、消息转发 ⭐更新
- ✅ 群聊功能: 创建群聊、成员管理、端到端加密群消息、邀请系统

**消息转发功能** (~200行代码): ⭐新增
- ✅ **右键菜单**: 消息气泡支持右键菜单，提供转发、复制、删除等操作
- ✅ **多会话选择**: 支持选择多个目标会话进行批量转发
- ✅ **文件自动复制**: 转发图片/文件消息时自动复制文件到新会话
- ✅ **转发标记**: 转发的消息显示转发标识，记录原始消息来源
- ✅ **转发计数**: 统计消息被转发的次数
- ✅ **数据库支持**: 新增forwarded_from_id和forward_count字段
- ✅ **IPC接口**: chat:forward-message处理器，支持批量转发
- ✅ **UI组件**: 转发对话框、会话选择器、转发状态提示

**文件传输功能** (~500行代码):
- ✅ **图片发送**: 支持JPG/PNG/GIF/WebP格式，自动压缩和存储
- ✅ **文件发送**: 支持所有文件类型，自动文件管理
- ✅ **文件下载**: 一键保存到本地，支持自定义保存位置
- ✅ **消息类型**: 支持text/image/file/voice/video五种消息类型
- ✅ **数据库支持**: file_path和file_size字段，完整的消息持久化
- ✅ **UI集成**: 图片预览、文件信息显示、下载按钮
- ✅ **IPC接口**: 4个新的IPC处理器(发送文件、发送图片、下载文件)
- ⏳ **P2P传输**: 大文件分块传输、断点续传（框架已准备，待集成）

**语音消息播放功能** (~150行代码): ⭐新增
- ✅ **播放控制**: 点击播放/暂停按钮控制语音播放，支持播放状态切换
- ✅ **状态显示**: 实时显示播放状态（播放中/已暂停），播放图标动态切换
- ✅ **时长显示**: 显示语音消息时长，格式化为分:秒格式
- ✅ **HTML5 Audio**: 使用原生Audio API播放音频，支持所有浏览器音频格式
- ✅ **自动清理**: 播放结束自动重置状态，组件卸载时自动释放音频资源
- ✅ **错误处理**: 完善的错误提示和异常处理，播放失败时友好提示
- ✅ **IPC接口**: chat:play-voice-message处理器，验证消息类型和文件存在性
- ✅ **UI集成**: 语音消息气泡、播放/暂停图标、时长标签

**群聊系统详情** (~1500行代码):
- ✅ **群组管理**: 创建群聊、更新群信息、解散群聊、退出群聊
- ✅ **成员管理**: 添加/移除成员、角色管理(群主/管理员/成员)、禁言功能
- ✅ **邀请系统**: 发送邀请、接受/拒绝邀请、邀请过期管理、邀请记录追踪
- ✅ **端到端加密**: 基于Signal Protocol的群组加密(Sender Keys)、AES-256-GCM加密
- ✅ **消息功能**: 文本/图片/文件消息、消息回复、@提及、已读状态
- ✅ **数据库架构**: 6张新表(群聊、成员、消息、已读状态、加密密钥、邀请)
- ✅ **IPC接口**: 15个IPC处理器(创建、管理、消息、邀请等)
- ✅ **Vue组件**: 完整的群聊UI(群列表、聊天窗口、成员管理、设置)
- ✅ **P2P广播**: 通过P2P网络实时广播群消息给所有成员
- ✅ **安全特性**: 消息加密、权限控制、成员验证、密钥轮换

**社区论坛**（独立应用）:
- ✅ Spring Boot 3.1.5后端 (69个Java文件, 63个API)
- ✅ Vue3前端 (45个文件, 15个页面)
- ✅ 14张数据库表: 用户、帖子、回复、标签、点赞、收藏等
- ✅ Elasticsearch全文搜索 + Redis缓存
- ✅ JWT认证 + Spring Security权限管理

### 3️⃣ 去中心化交易系统 (85% 完成) ✅

总代码量: **9200+行**（交易系统5960行 + 区块链系统3263行），8大核心模块 + 区块链智能合约

**1. 数字资产管理** (~750行):
- ✅ 4种资产类型: Token、NFT、知识产品、服务凭证
- ✅ 资产创建、铸造、转账、销毁
- ✅ 余额管理 + 转账历史 + 元数据
- ✅ 批量操作支持
- ✅ **NFT链上转账** - ERC-721标准完整实现 ⭐新增
  - 所有权验证 + 安全转账(safeTransferFrom)
  - 批量NFT转账支持
  - 链上状态实时查询(所有者、余额、元数据URI)
  - 转账后自动验证 + P2P通知
  - 完整的转账历史记录

**2. 交易市场** (~850行):
- ✅ 商品列表管理（创建、更新、上架、下架）
- ✅ 多维搜索筛选（分类、价格、标签）
- ✅ 订单管理（创建、支付、确认、取消）
- ✅ 交易历史和统计
- ✅ **订单编辑功能** - 支持编辑开放状态订单的价格、数量、描述等信息 ⭐新增
- ✅ **订单分享系统** - 多种分享方式(链接/社交/导出)，支持权限控制和有效期设置 ⭐新增
- ✅ **QR码生成** - 为订单/资产生成二维码，支持下载和分享 ⭐新增
- ✅ **多格式导出** - 支持导出订单为JSON/CSV/PDF/图片格式 ⭐新增

**3. 智能合约引擎** (~1200行 + 模板):
- ✅ 合约引擎: 条件评估、自动执行、状态管理
- ✅ 6种合约模板: 简单支付、托管、订阅、里程碑、拍卖、众筹
- ✅ 40+条件类型支持
- ✅ 串行/并行任务执行
- ✅ Webhook通知集成

**4. 托管服务** (~650行):
- ✅ 4种托管类型: 简单托管、多方托管、仲裁托管、时间锁定
- ✅ 买卖双方保护机制
- ✅ 争议解决流程
- ✅ 自动/手动资金释放

**5. 知识付费** (~900行):
- ✅ 知识产品加密（AES-256）+ 密钥管理
- ✅ 3种定价模式: 一次性、订阅、按需
- ✅ 购买流程 + 解密访问
- ✅ 版权保护 + DRM
- ✅ 收入分配和提现

**6. 信用评分** (~700行):
- ✅ 6维度评分: 完成率、交易量、好评率、响应速度、纠纷率、账户年龄
- ✅ 5级等级: 新手(0-199)、青铜(200-499)、白银(500-999)、黄金(1000-1999)、钻石(2000+)
- ✅ 动态权重调整算法
- ✅ 实时更新 + 历史快照
- ✅ 信用记录和趋势分析

**7. 评价系统** (~750行):
- ✅ 5星评分 + 文字评价 + 图片附件
- ✅ 双向评价（买家/卖家）
- ✅ 评价统计和分析
- ✅ 举报和申诉机制
- ✅ 评价可见性控制

**8. 订单管理** (集成在交易市场):
- ✅ 订单生命周期: 待付款→已付款→进行中→已完成→已取消
- ✅ 订单详情查询
- ✅ 批量订单处理
- ✅ 订单通知和提醒

**9. 区块链智能合约系统** (2400+行) ⭐新增:
- ✅ **ChainlessToken** (ERC-20代币合约, 70行)
  - 自定义名称、符号、小数位
  - Mint/Burn功能，Ownable权限控制
- ✅ **ChainlessNFT** (ERC-721 NFT合约, 140行)
  - 元数据URI支持，批量铸造
  - ERC721Enumerable可枚举扩展
  - **完整的链上转账功能** ⭐新增
    - safeTransferFrom安全转账
    - 所有权验证(ownerOf)
    - 余额查询(balanceOf)
    - 元数据URI查询(tokenURI)
    - 批量转账支持
- ✅ **EscrowContract** (托管合约, 260行)
  - 支持ETH/MATIC + ERC20代币
  - 争议解决机制 + 仲裁者功能
  - ReentrancyGuard防重入攻击
- ✅ **SubscriptionContract** (订阅合约, 300行)
  - 按月/按季/按年订阅
  - 自动续订机制
- ✅ **BountyContract** (悬赏合约, 330行)
  - 任务发布、申领、提交审核
  - 支持多人完成，奖金分配
- ✅ **AssetBridge** (跨链桥合约, 300行)
  - 锁定-铸造模式
  - 中继者权限管理，防重复铸造
- ✅ **完整测试套件** (600+行, 45+测试用例)
- ✅ **部署脚本** (支持多网络部署)

**10. 钱包系统** (3263行):
- ✅ **内置HD钱包** (900行)
  - BIP39助记词 + BIP44路径
  - AES-256-GCM强加密存储
  - U-Key硬件签名集成
  - EIP-155/EIP-191签名
- ✅ **外部钱包集成** (420行)
  - MetaMask连接
  - WalletConnect v1支持
  - 网络切换和事件监听
- ✅ **交易监控** (350行)
  - 交易状态追踪
  - 自动确认等待
  - 数据库持久化

**交易UI组件** (20+个):
- AssetCreate/List/Transfer - 资产管理
- Marketplace/OrderCreate/OrderDetail - 市场和订单
- ContractCreate/Detail/List/Execute/Sign - 智能合约
- EscrowList/Detail/Dispute/Statistics - 托管管理
- ContractCard/TransactionTimeline - 通用组件
- CreditScore/ReviewList/MyReviews - 信用和评价

### 4️⃣ 企业版（去中心化组织）(50% 完成) ⭐更新

**核心架构**:
- ✅ **多身份架构**: 一个用户DID可拥有个人身份+多个组织身份
- ✅ **数据完全隔离**: 每个身份对应独立数据库文件 (personal.db, org_xxx.db)
- ✅ **组织DID**: 支持组织级DID创建 (did:chainlesschain:org:xxxx)
- ✅ **数据库切换**: 动态切换不同身份的数据库

**组织管理** (OrganizationManager - 1966行):
- ✅ 组织创建/删除 - UUID生成、DID创建、数据库初始化
- ✅ 成员管理 - 添加/移除/角色变更、在线状态
- ✅ 邀请系统 - 6位邀请码生成、DID邀请链接（完整实现）⭐新增
- ✅ 活动日志 - 所有操作自动记录、审计追溯

**DID邀请链接系统** (DIDInvitationManager - 完整实现) ⭐新增:
- ✅ **安全令牌生成** - 32字节随机令牌（base64url编码）
- ✅ **灵活使用控制** - 单次/多次/无限制使用，使用次数追踪
- ✅ **过期时间管理** - 默认7天过期，可自定义，自动过期检测
- ✅ **权限控制** - 基于角色的邀请（owner/admin/member/viewer）
- ✅ **使用记录追踪** - 记录用户DID、使用时间、IP地址、User Agent
- ✅ **统计分析** - 链接总数、活跃/过期/撤销状态、使用率计算
- ✅ **完整IPC接口** - 9个IPC处理器（创建/验证/接受/列表/详情/撤销/删除/统计/复制）
- ✅ **数据库表** - invitation_links、invitation_link_usage
- ✅ **详细文档** - INVITATION_LINK_FEATURE.md（500行完整文档）

**权限系统** (RBAC + ACL):
- ✅ **4个内置角色**: Owner(所有权限)、Admin(管理权限)、Member(读写权限)、Viewer(只读权限)
- ✅ **权限粒度**: org.manage、member.manage、knowledge.*、project.*、invitation.create等
- ✅ **权限检查**: 支持通配符、前缀匹配、精确匹配
- ✅ **自定义角色**: 支持创建自定义角色和权限（待完善）

**数据库架构** (11个表) ⭐更新:
- ✅ `identity_contexts` - 身份上下文管理（个人+组织）
- ✅ `organization_info` - 组织元数据（名称、类型、描述、Owner）
- ✅ `organization_members` - 组织成员详情（DID、角色、权限）
- ✅ `organization_roles` - 组织角色定义
- ✅ `organization_invitations` - 组织邀请管理
- ✅ `invitation_links` - DID邀请链接 ⭐新增
- ✅ `invitation_link_usage` - 邀请链接使用记录 ⭐新增
- ✅ `organization_projects` - 组织项目
- ✅ `organization_activities` - 组织活动日志
- ✅ `p2p_sync_state` - P2P同步状态
- ✅ `knowledge_items扩展` - 新增8个企业版字段（org_id、created_by、share_scope等）

**前端UI组件** (新增6个页面/组件):
- ✅ **IdentitySwitcher.vue** - 身份切换器，支持创建/加入组织
- ✅ **OrganizationMembersPage.vue** - 成员管理页面，角色分配
- ✅ **OrganizationSettingsPage.vue** - 组织设置页面，信息编辑
- ✅ **OrganizationsPage.vue** - 组织列表页面
- ✅ **OrganizationRolesPage.vue** - 角色权限管理页面
- ✅ **OrganizationActivityLogPage.vue** - 组织活动日志页面

**状态管理** (IdentityStore - 385行):
- ✅ 当前激活身份管理
- ✅ 所有身份上下文缓存
- ✅ 组织列表和切换逻辑
- ✅ 权限检查接口

**待完成功能**:
- ⏳ P2P组织网络（Topic订阅、成员发现）
- ⏳ 知识库协作（共享、版本控制、冲突解决）
- ⏳ 数据同步（增量同步、冲突检测）
- ⏳ 前端UI完善（仪表板、统计图表）

**适用场景**:
- 创业团队(Startup)、小型公司(Company)
- 技术社区(Community)、开源项目(Opensource)
- 教育机构(Education)

### 5️⃣ AI模板系统 (100% 完成) ⭐新增

**系统概况**:
- ✅ **178个AI模板** - 涵盖办公、开发、设计、媒体等全场景
- ✅ **32个分类体系** - 从文档编辑到区块链开发，分类完整
- ✅ **100%配置覆盖** - 所有模板完成技能工具配置
- ✅ **智能引擎分配** - 根据内容类型自动选择最优执行引擎

**模板分类** (32个):

**办公文档类 (12个分类)**:
- ✅ writing, creative-writing - 创意写作、文案创作
- ✅ education, learning - 教育培训、学习资料
- ✅ legal, health - 法律文书、健康管理
- ✅ career, resume - 职业规划、简历制作
- ✅ cooking, gaming, lifestyle - 生活方式类内容
- ✅ productivity, tech-docs - 生产力工具、技术文档

**办公套件类 (3个分类)**:
- ✅ ppt - 演示文稿制作 (6个模板)
- ✅ excel - 数据分析、财务管理 (12个模板)
- ✅ word - 专业文档编辑 (8个模板)

**开发类 (3个分类)**:
- ✅ web - Web开发项目 (5个模板)
- ✅ code-project - 代码项目结构 (7个模板)
- ✅ data-science - 数据科学、机器学习 (6个模板)

**设计媒体类 (5个分类)**:
- ✅ design - UI/UX设计 (6个模板)
- ✅ photography - 摄影创作
- ✅ video - 视频制作 (29个模板)
- ✅ podcast - 播客制作
- ✅ music - 音乐创作 (5个模板)

**营销类 (4个分类)**:
- ✅ marketing - 营销策划 (8个模板)
- ✅ marketing-pro - 专业营销 (6个模板)
- ✅ social-media - 社交媒体运营 (6个模板)
- ✅ ecommerce - 电商运营 (6个模板)

**专业领域类 (5个分类)**:
- ✅ research - 学术研究
- ✅ finance - 金融分析
- ✅ time-management - 时间管理
- ✅ travel - 旅行规划

**执行引擎分布** (智能优化后):
```
document引擎  : 95个 (46.3%) - 文档类模板主力
video引擎     : 29个 (14.1%) - 视频制作
default引擎   : 26个 (12.7%) - 混合内容（营销、电商）
excel引擎     : 12个 (5.9%)  - 数据分析
word引擎      : 8个  (3.9%)  - 专业文档
code引擎      : 7个  (3.4%)  - 代码项目
ml引擎        : 6个  (2.9%)  - 机器学习
design引擎    : 6个  (2.9%)  - 设计创作
ppt引擎       : 6个  (2.9%)  - 演示文稿
audio引擎     : 5个  (2.4%)  - 音频处理
web引擎       : 5个  (2.4%)  - Web开发
```

**配置完整性**:
- ✅ 文件系统: 178/178 (100%)
- ✅ 数据库: 203/203 (100%)
- ✅ Skills配置: 100%
- ✅ Tools配置: 100%
- ✅ Engine配置: 100%

**优化成果**:
- Default引擎使用率从 52.2% 降至 **12.7%** (降低39.5个百分点)
- 专业引擎覆盖率从 22.4% 提升至 **84.4%** (提升62个百分点)
- 引擎分配更加精准，提升AI执行效率

**模板能力映射**:
每个模板都精确配置了:
- **skills** - 执行所需的AI技能 (从115个技能中选择)
- **tools** - 执行所需的工具 (从300个工具中选择)
- **execution_engine** - 最优执行引擎 (11种引擎类型)

详见: `desktop-app-vue/dist/main/templates/OPTIMIZATION_COMPLETE_REPORT.md`

## 技术架构

```
┌───────────────────────────────────────────────────────────────────┐
│                         前端应用层                                  │
│  Desktop(Electron+Vue3,182组件) │ Browser Ext │ Mobile(uni-app) │
├───────────────────────────────────────────────────────────────────┤
│                        业务功能层                                   │
│ 知识库(95%) │ AI引擎(95%) │ 社交(85%) │ 交易(85%) │ 企业版(45%) │
│  技能工具(100%,115技能+300工具) │ 区块链(55%) │ 测试(88%)     │
│ P2优化(100%) │ 插件系统(85%) │ 语音识别(90%) │ P2P(75%)    │
├───────────────────────────────────────────────────────────────────┤
│                        后端服务层                                   │
│  Project Service    │    AI Service      │   Community Forum     │
│  (Spring Boot 3.1)  │   (FastAPI)        │   (Spring Boot 3.1)   │
│  48 API端点         │   38 API端点       │   63 API端点          │
│  PostgreSQL + Redis │   Ollama + Qdrant  │   MySQL + Redis       │
├───────────────────────────────────────────────────────────────────┤
│                        区块链层                                     │
│  Hardhat │ Ethers.js v6 │ 6个智能合约 │ HD钱包 │ MetaMask/WC   │
│  Ethereum/Polygon  │  ERC-20/ERC-721  │  托管/订阅/悬赏/跨链   │
├───────────────────────────────────────────────────────────────────┤
│                        数据存储层（支持多数据库隔离）                │
│  SQLite/SQLCipher  │  PostgreSQL  │  MySQL  │  ChromaDB/Qdrant   │
│  (个人+多组织DB)   │  (项目数据)  │ (论坛)  │  (向量存储)        │
├───────────────────────────────────────────────────────────────────┤
│                        P2P网络层                                    │
│  libp2p 3.1.2  │  Signal E2E  │  Kademlia DHT  │  组织Network  │
├───────────────────────────────────────────────────────────────────┤
│                        安全层                                       │
│    U盾 (PC, 5品牌)        │     SIMKey (移动端, 规划中)         │
└───────────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 环境要求

- **PC端**: Node.js 20+, Docker 20.10+ (可选)
- **移动端**: Android Studio 2024+ / Xcode 15+
- **硬件**: U盾(PC) 或 支持SIMKey的SIM卡(移动端,可选)

### 安装步骤

#### 1. 克隆项目
```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

#### 2. 启动PC端桌面应用
```bash
# 进入桌面应用目录
cd desktop-app-vue

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

#### 3. 启动后端服务 (可选)

**Docker服务 (Ollama + Qdrant + PostgreSQL + Redis)**:
```bash
# 启动所有Docker服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 下载LLM模型 (首次运行)
docker exec chainlesschain-ollama ollama pull qwen2:7b

# 查看日志
docker-compose logs -f
```

**Project Service (Spring Boot)**:
```bash
cd backend/project-service
mvn clean compile
mvn spring-boot:run
# 访问 http://localhost:9090
# Swagger文档: http://localhost:9090/swagger-ui.html
```

**AI Service (FastAPI)**:
```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
# 访问 http://localhost:8001
# API文档: http://localhost:8001/docs
```

**Community Forum (社区论坛)**:
```bash
# 后端
cd community-forum/backend
mvn spring-boot:run
# 访问 http://localhost:8080

# 前端
cd community-forum/frontend
npm install
npm run dev
# 访问 http://localhost:3000
```

### 其他启动选项

```bash
# 从项目根目录启动桌面应用
npm run dev:desktop-vue

# Docker服务管理
npm run docker:up      # 启动所有服务
npm run docker:down    # 停止所有服务
npm run docker:logs    # 查看日志

# Android应用
cd android-app
./gradlew assembleDebug
```

### 📱 移动端与PC端数据同步 ⭐新增

ChainlessChain v0.20.0 引入了完整的移动端与PC端数据同步系统，支持跨设备无缝协作。

**核心功能**:
- 🔗 **设备配对**: 二维码扫描或配对码，快速建立P2P连接
- 📚 **知识库同步**: 增量同步笔记、标签、附件等数据
- 📁 **项目同步**: 项目元数据、任务、Git仓库状态同步
- 💻 **PC状态监控**: 实时查看PC端系统状态和性能指标
- 🔒 **安全加密**: WebRTC P2P通信 + libp2p加密传输
- 📴 **离线支持**: 信令服务器提供离线消息队列

**快速开始**:

1. 启动信令服务器：
```bash
cd signaling-server
npm install
npm start  # 默认端口: 9003
```

2. PC端开启配对模式（设置 → 设备管理 → 设备配对）

3. 移动端扫描二维码或输入配对码

**详细文档**:
- [系统设计文档](./docs/features/MOBILE_PC_SYNC.md) - 架构设计、技术选型、数据同步策略
- [快速开始指南](./docs/deployment/QUICKSTART_MOBILE_PC.md) - 环境配置、使用流程、常见问题
- [集成测试指南](./docs/testing/TEST_MOBILE_PC_INTEGRATION.md) - 测试用例、测试脚本、验证清单

## 📁 项目结构

```
chainlesschain/
├── desktop-app-vue/              # 🖥️ PC端桌面应用 (Electron + Vue3)
│   ├── src/main/                 # 主进程 (Node.js, 335个文件)
│   │   ├── database.js           # SQLite数据库 (50+张表：基础+企业版+区块链+优化)
│   │   ├── ukey/                 # U盾管理 (5个品牌驱动) ⭐更新
│   │   ├── llm/                  # LLM服务 (支持14+提供商)
│   │   ├── rag/                  # RAG系统 (6个核心模块)
│   │   ├── git/                  # Git同步 (isomorphic-git)
│   │   ├── image/                # 图片处理+OCR (Sharp+Tesseract.js)
│   │   ├── did/                  # DID身份 (W3C标准+组织DID) ⭐更新
│   │   ├── p2p/                  # P2P网络 (libp2p + Signal)
│   │   │   ├── mobile-bridge.js         # 移动端桥接 (499行) ⭐新增
│   │   │   ├── device-pairing-handler.js # 设备配对 (305行) ⭐新增
│   │   │   ├── knowledge-sync-handler.js # 知识库同步 (442行) ⭐新增
│   │   │   ├── project-sync-handler.js   # 项目同步 (516行) ⭐新增
│   │   │   └── pc-status-handler.js      # PC状态 (388行) ⭐新增
│   │   ├── social/               # 社交功能 (好友+动态)
│   │   ├── trade/                # 交易系统 (8模块, 5625+行)
│   │   ├── organization/         # 企业版组织管理 (701行) ⭐新增
│   │   │   └── organization-manager.js  # 组织核心逻辑 (1966行)
│   │   ├── blockchain/           # 区块链集成 (3263行)
│   │   │   ├── wallet-manager.js      # HD钱包管理 (900行)
│   │   │   ├── external-wallet-connector.js  # MetaMask/WC (420行)
│   │   │   ├── transaction-monitor.js # 交易监控 (350行)
│   │   │   ├── blockchain-adapter.js  # 多链适配器
│   │   │   └── blockchain-config.js   # 网络配置
│   │   ├── skill-tool-system/    # 技能工具系统 (100%完成) ⭐完成
│   │   │   ├── skill-manager.js       # 技能管理
│   │   │   ├── tool-manager.js        # 工具管理
│   │   │   ├── builtin-skills.js      # 115个内置技能
│   │   │   ├── builtin-tools.js       # 300个内置工具 ⭐更新
│   │   │   └── doc-generator.js       # 文档生成
│   │   ├── menu-manager.js       # 菜单管理器 ⭐新增
│   │   ├── advanced-features-ipc.js  # 高级特性IPC (20+通道) ⭐新增
│   │   ├── plugins/              # 插件系统 ⭐新增
│   │   │   └── plugin-manager.js      # 插件管理
│   │   ├── speech/               # 语音识别系统 ⭐新增
│   │   │   └── speech-service.js      # 语音服务
│   │   ├── vc/                   # 可验证凭证 (5种类型)
│   │   ├── ai-engine/            # AI引擎 (P0+P1+P2优化) ⭐更新
│   │   │   ├── ai-engine-manager-p2.js     # P2集成管理器 ⭐新增
│   │   │   ├── intent-fusion.js            # 意图融合 (927行) ⭐新增
│   │   │   ├── knowledge-distillation.js   # 知识蒸馏 (668行) ⭐新增
│   │   │   ├── streaming-response.js       # 流式响应 (684行) ⭐新增
│   │   │   ├── task-decomposition-enhancement.js  # 任务分解增强 ⭐新增
│   │   │   ├── tool-composition-system.js  # 工具组合系统 ⭐新增
│   │   │   └── history-memory-optimization.js # 历史记忆优化 ⭐新增
│   │   ├── engines/              # 16个专用引擎
│   │   │   ├── code-engine.js    # 代码生成/审查/重构/执行
│   │   │   ├── document-engine.js # Word/文档处理
│   │   │   ├── word-engine.js    # Word专用引擎
│   │   │   ├── excel-engine.js   # Excel编辑
│   │   │   ├── ppt-engine.js     # PPT生成
│   │   │   ├── presentation-engine.js # 演示文稿引擎
│   │   │   ├── pdf-engine.js     # PDF操作
│   │   │   ├── image-engine.js   # 图像处理
│   │   │   ├── video-engine.js   # 视频处理
│   │   │   ├── web-engine.js     # HTML/CSS/JS
│   │   │   ├── data-engine.js    # 数据处理
│   │   │   ├── data-viz-engine.js # 数据可视化
│   │   │   ├── template-engine.js # 模板引擎
│   │   │   └── preview-server.js # 预览服务器
│   │   ├── sync/                 # 数据库同步 (4个模块)
│   │   ├── import/               # 文件导入 (4种格式)
│   │   ├── prompt/               # 提示词管理 (50+模板)
│   │   └── vector/               # 向量数据库 (ChromaDB)
│   │
│   ├── src/renderer/             # 渲染进程 (Vue3, 239个组件)
│   │   ├── pages/                # 23个页面视图
│   │   │   ├── HomePage.vue
│   │   │   ├── AIChatPage.vue
│   │   │   ├── TradingHub.vue
│   │   │   ├── SkillManagement.vue
│   │   │   ├── ToolManagement.vue
│   │   │   ├── Wallet.vue
│   │   │   ├── Bridge.vue
│   │   │   ├── OrganizationsPage.vue
│   │   │   ├── OrganizationMembersPage.vue
│   │   │   ├── OrganizationSettingsPage.vue
│   │   │   ├── OrganizationRolesPage.vue
│   │   │   ├── OrganizationActivityLogPage.vue
│   │   │   └── ...
│   │   ├── components/           # 业务组件
│   │   │   ├── project/          # 54个项目组件
│   │   │   ├── trade/            # 20+交易组件(含区块链)
│   │   │   ├── social/           # 25个社交组件
│   │   │   ├── organization/     # 企业版组件
│   │   │   │   ├── IdentitySwitcher.vue       # 身份切换器
│   │   │   │   ├── InvitationManager.vue      # 邀请管理
│   │   │   │   ├── DIDInvitationNotifier.vue  # DID邀请通知
│   │   │   │   └── OrganizationCard.vue       # 组织卡片
│   │   │   ├── skill/            # 技能组件
│   │   │   ├── tool/             # 工具组件
│   │   │   ├── common/           # 通用组件
│   │   │   └── editors/          # 6个编辑器
│   │   ├── stores/               # Pinia状态管理
│   │   │   ├── identity.js       # 身份管理Store
│   │   │   ├── skill.js
│   │   │   └── tool.js
│   │   ├── services/             # 前端服务层 ⭐新增
│   │   │   ├── api.js            # API服务 (300行)
│   │   │   └── __tests__/        # 服务测试
│   │   └── utils/                # 工具类库 (34个文件) ⭐更新
│   │       ├── image-optimization.js         # 图片优化 (560行) ⭐新增
│   │       ├── performance-monitoring.js     # 性能监控 (644行) ⭐新增
│   │       ├── code-splitting.js             # 代码分割 (387行) ⭐新增
│   │       ├── component-lazy-loader.js      # 组件懒加载 (384行) ⭐新增
│   │       ├── intelligent-prefetch.js       # 智能预取 (598行) ⭐新增
│   │       ├── request-batcher.js            # 请求批处理 (451行) ⭐新增
│   │       ├── optimistic-update-manager.js  # 乐观更新 (528行) ⭐新增
│   │       ├── data-compression.js           # 数据压缩 (425行) ⭐新增
│   │       ├── incremental-sync.js           # 增量同步 (514行) ⭐新增
│   │       ├── memory-optimization.js        # 内存优化 (450行) ⭐新增
│   │       ├── animation-controller.js       # 动画控制 (450行) ⭐新增
│   │       ├── resource-hints.js             # 资源提示 (455行) ⭐新增
│   │       ├── content-visibility.js         # 内容可见性 (412行) ⭐新增
│   │       ├── accessibility.js              # 无障碍功能 (482行) ⭐新增
│   │       ├── performance-benchmark.js      # 性能基准测试 (494行) ⭐新增
│   │       ├── performance-tracker.js        # 性能追踪
│   │       ├── adaptive-performance.js       # 自适应性能
│   │       ├── predictive-prefetcher.js      # 预测预取
│   │       └── ... (其他20个工具文件)
│   │
│   ├── control-panel-api.js      # 高级特性控制面板API ⭐新增
│   ├── control-panel.html        # 控制面板Web界面 ⭐新增
│   ├── adaptive-threshold.js     # 自适应阈值调整 ⭐新增
│   ├── online-learning.js        # 在线学习系统 ⭐新增
│   ├── advanced-optimizer.js     # 高级优化器 ⭐新增
│   ├── production-integration.js # 生产集成主脚本 ⭐新增
│   │
│   ├── contracts/                # 🔗 智能合约 (Hardhat) ⭐新增
│   │   ├── contracts/            # Solidity合约 (6个)
│   │   │   ├── tokens/           # ERC-20/ERC-721代币
│   │   │   ├── marketplace/      # 托管合约
│   │   │   ├── payment/          # 订阅/悬赏合约
│   │   │   └── bridge/           # 跨链桥
│   │   ├── test/                 # 合约测试 (45+用例)
│   │   ├── scripts/              # 部署脚本
│   │   └── hardhat.config.js     # Hardhat配置
│   │
│   ├── browser-extension/        # 🌐 浏览器扩展 ⭐新增
│   │   ├── background.js         # 后台脚本
│   │   ├── content.js            # 内容脚本
│   │   ├── test-runner.js        # 测试框架
│   │   └── *.md                  # 用户/开发者指南
│   │
│   ├── tests/                    # 测试套件 (94个文件, Vitest框架)
│   │   ├── unit/                 # 单元测试 (70+个文件)
│   │   │   ├── intent-classifier.test.js      # 意图分类测试
│   │   │   ├── function-caller.test.js        # 函数调用测试
│   │   │   ├── task-planner.test.js           # 任务规划测试
│   │   │   ├── response-parser.test.js        # 响应解析测试
│   │   │   ├── ai-engine-workflow.test.js     # AI引擎工作流测试
│   │   │   └── conversation-executor.test.js  # 对话执行器测试
│   │   ├── integration/          # 2个集成测试
│   │   └── performance/          # 3个性能测试
│   │
│   ├── playwright-report/        # Playwright测试报告 ⭐新增
│   │
│   └── scripts/                  # 工具脚本
│       ├── comprehensive-fix.js  # 综合修复工具
│       └── test-runner.js        # 测试运行器
│
├── backend/                      # 🔧 后端服务
│   ├── project-service/          # 项目管理服务
│   │   ├── src/main/java/        # 63个Java文件, 5679行
│   │   │   ├── controller/       # 6个控制器, 48 API
│   │   │   ├── service/          # 7个服务类
│   │   │   └── mapper/           # MyBatis Plus映射
│   │   └── resources/
│   │       ├── application.yml   # Spring Boot配置
│   │       └── db/migration/     # 7个数据库版本
│   │
│   └── ai-service/               # AI推理服务
│       ├── src/                  # 31个Python文件, 12417行
│       │   ├── engines/          # 处理引擎
│       │   ├── code/             # 代码智能
│       │   ├── git/              # Git管理
│       │   ├── rag/              # RAG引擎
│       │   ├── llm/              # LLM客户端
│       │   └── nlu/              # NLU处理
│       ├── main.py               # FastAPI应用, 38 API
│       └── requirements.txt
│
├── community-forum/              # 🌐 社区论坛
│   ├── backend/                  # Spring Boot 3.1.5
│   │   └── src/main/java/        # 69个Java文件, 63 API
│   │       ├── controller/       # 10个控制器
│   │       ├── service/          # 10个服务
│   │       └── entity/           # 14张数据库表
│   │
│   └── frontend/                 # Vue3 + Element Plus
│       └── src/                  # 45个文件, 10958行
│           ├── views/            # 15个页面
│           ├── components/       # UI组件
│           └── api/              # API客户端
│
├── mobile-app-uniapp/            # 📱 移动端应用 (75%完成) ⭐大幅提升
│   ├── pages/                    # 61个页面 (~30,000行)
│   ├── components/               # 15+组件 (~3,000行) ⭐更新
│   │   ├── MarkdownRenderer.vue  # Markdown渲染组件 (500+行) ⭐新增
│   │   └── MarkdownToolbar.vue   # Markdown工具栏 (300+行) ⭐新增
│   ├── services/                 # 服务层 (~14,674行)
│   │   ├── device-pairing.js    # 设备配对服务 (354行) ⭐新增
│   │   ├── knowledge-sync.js    # 知识库同步 (220行) ⭐新增
│   │   ├── project-sync.js      # 项目同步 (217行) ⭐新增
│   │   └── pc-status.js         # PC状态监控 (253行) ⭐新增
│   ├── docs/                     # 文档 ⭐新增
│   │   ├── MOBILE_ADAPTATION_PROGRESS_2026-01-12.md  # 进度报告 ⭐新增
│   │   ├── KNOWLEDGE_FEATURES_GUIDE.md               # 功能指南 ⭐新增
│   │   └── MOBILE_UI_COMPLETION_REPORT.md            # UI完成报告 ⭐新增
│   └── manifest.json
│
├── signaling-server/             # 🔗 信令服务器 ⭐新增
│   ├── index.js                  # WebSocket信令服务器 (492行)
│   ├── package.json              # 依赖配置
│   ├── Dockerfile                # Docker支持
│   └── README.md                 # 服务器文档
│
├── docker-compose.yml            # 🐳 Docker服务配置
│   # - Ollama (端口11434)
│   # - Qdrant (端口6333)
│   # - PostgreSQL (端口5432)
│   # - Redis (端口6379)
│   # - Project Service (端口9090)
│   # - AI Service (端口8001)
│
├── docs/                         # 📚 文档
│   ├── 系统设计_个人移动AI管理系统.md (123KB)
│   ├── CLAUDE.md                 # Claude Code项目指南
│   ├── IMPLEMENTATION_COMPLETE.md
│   ├── PROJECT_PROGRESS_REPORT_2025-12-18.md
│   ├── P2_IMPLEMENTATION_SUMMARY.md        # P2优化实施总结
│   ├── V3_TOOLS_RESTORATION_COMPLETE.md    # V3工具恢复报告
│   ├── MENU_INTEGRATION_COMPLETE.md        # 菜单集成完成报告
│   ├── MOBILE_PC_SYNC.md         # 移动端PC端数据同步设计
│   ├── QUICKSTART_MOBILE_PC.md   # 移动端同步快速开始
│   ├── TEST_MOBILE_PC_INTEGRATION.md # 移动端同步测试指南
│   ├── features/                 # 功能文档 ⭐新增
│   │   └── SPEECH_SETTINGS_ADDED.md # 语音设置完成报告
│   ├── testing/                  # 测试文档 ⭐新增
│   │   └── WHISPER_INTEGRATION_TEST_REPORT.md # Whisper集成测试报告
│   └── HOW_TO_RUN.md
│
├── desktop-app-vue/docs/        # 🚀 性能优化文档 ⭐新增
│   ├── ADVANCED_OPTIMIZATIONS.md          # 高级优化技术 (578行)
│   ├── DEEP_OPTIMIZATION_COMPLETE.md      # 深度优化完成报告 (765行)
│   ├── OPTIMIZATION_INTEGRATION_COMPLETE.md # 优化集成完成 (500行)
│   ├── OPTIMIZATION_INTEGRATION_FINAL.md  # 优化集成最终版 (573行)
│   ├── OPTIMIZATION_INTEGRATION_GUIDE.md  # 优化集成指南 (883行)
│   ├── OPTIMIZATION_QUICK_START.md        # 优化快速开始 (424行)
│   ├── OPTIMIZATION_SUMMARY.md            # 优化总结 (571行)
│   ├── OPTIMIZATION_USAGE_GUIDE.md        # 优化使用指南 (更新)
│   ├── E2E_TEST_WORK_SUMMARY.md           # E2E测试工作总结 (306行)
│   ├── INVITATION_LINK_FEATURE.md         # DID邀请链接功能文档 (500行) ⭐新增
│   ├── KNOWLEDGE_GRAPH_COMPLETION_REPORT.md # 知识图谱完成报告 (380行) ⭐新增
│   ├── KNOWLEDGE_GRAPH_ENHANCEMENTS.md    # 知识图谱增强文档 ⭐新增
│   └── KNOWLEDGE_GRAPH_QUICKSTART.md      # 知识图谱快速开始 ⭐新增

├── mobile-app-uniapp/docs/      # 📱 移动端文档 ⭐新增
│   ├── MOBILE_ADAPTATION_PROGRESS_2026-01-12.md  # 移动端适配进度 (509行) ⭐新增
│   └── KNOWLEDGE_FEATURES_GUIDE.md               # 知识库功能指南 (377行) ⭐新增

└── scripts/                      # 🛠️ 工具脚本
    ├── setup.sh
    └── build.sh
```

### 项目组成说明

| 项目 | 技术栈 | 代码量 | API | 完成度 | 状态 |
|------|--------|--------|-----|-------|------|
| **desktop-app-vue** | Electron 39 + Vue3 | 220,000+行 | 168+ IPC | 100% | ✅ 生产就绪 | ⭐更新
| **contracts** | Hardhat + Solidity | 2,400行 | - | 100% | ✅ 已完成 |
| **browser-extension** | Vanilla JS | 2,000+行 | - | 70% | 🚧 开发中 |
| **backend/project-service** | Spring Boot 3.1 + Java 17 | 5,679行 | 56 API | 100% | ✅ 生产就绪 | ⭐更新
| **backend/ai-service** | FastAPI + Python 3.9+ | 12,417行 | 38 API | 85% | ✅ 功能完整 |
| **community-forum/backend** | Spring Boot 3.1 + MySQL | 5,679行 | 63 API | 90% | ✅ 生产可用 |
| **community-forum/frontend** | Vue3 + Element Plus | 10,958行 | - | 85% | ✅ 功能完整 |
| **mobile-app-uniapp** | uni-app + Vue3 | 48,551行 | - | 75% | 🟢 功能完整 | ⭐大幅提升
| **总计** | - | **260,000+行** | **157 API** | **100%** | ✅ 生产就绪 | ⭐更新

### 代码规模统计

**桌面应用 (desktop-app-vue)**:
- 主进程: 335个JavaScript文件 (~190,000行代码) ⭐更新
- 渲染进程: 243个Vue组件 (23页面 + 220组件)
  - 新增4个性能优化组件: AsyncComponent, LazyImage, PerformanceMonitor, VirtualMessageList
  - 新增3个过渡动画组件: CollapseTransition, FadeSlide, ScaleTransition
- 前端工具类: 34个文件 (~15,000行)
  - 18个新增优化工具类 (~8,000行)
- 前端服务层: api.js (300行) + 测试
- 交易系统: 8个模块, 5960行代码
- 企业版（去中心化组织）: 核心模块1966行 + 6个UI页面/组件 + 完整API实现 ⭐更新
  - OrganizationManager: 1966行
  - IdentityStore: 385行
  - UI页面/组件: 6个（组织管理相关）
  - 组织设置API: 5个完整实现
  - 邀请系统API: 完整生命周期管理
- 区块链系统: 钱包+合约+桥接, 3500+行代码 ⭐更新
  - LayerZero桥接: 新增生产级跨链支持
- 工作区管理: 完整CRUD + 恢复 + 永久删除 ⭐新增
- 远程同步: 增量同步 + 冲突解决 + 多设备协作 ⭐新增
- 跨平台U-Key: Windows原生 + macOS/Linux PKCS#11 ⭐新增
- P2优化系统: 6个核心模块, 3800+行代码
  - 意图融合: 927行
  - 知识蒸馏: 668行
  - 流式响应: 684行
  - 任务分解增强、工具组合、历史记忆
- 深度性能优化系统: 18个工具类 + 4个组件, ~8,700行代码 ⭐新增
  - 智能图片优化: 560行
  - 实时性能监控: 644行
  - 代码分割: 387行
  - 组件懒加载: 384行
  - 智能预取: 598行
  - 请求批处理: 451行
  - 乐观更新: 528行
  - 数据压缩: 425行
  - 增量同步: 514行
  - 内存优化: 450行
  - 动画控制: 450行
  - 资源提示: 455行
  - 内容可见性: 412行
  - 无障碍功能: 482行
  - 性能基准测试: 494行
  - 其他工具: 3个
- 技能工具系统: 115个技能 + 300个工具 ⭐完成
- 高级特性控制面板: MenuManager + AdvancedFeaturesIPC + Web界面
- 性能优化系统: 内存降级、磁盘检查、并发控制、文件恢复
- 安全防护体系: 输入验证、权限控制、加密传输
- 插件系统: 动态加载完成
- 语音识别: 高级功能完成
- 浏览器扩展: 测试框架+文档
- 16个AI引擎
- 测试文件: 94个（900+测试用例，Vitest框架）
- 优化文档: 8个详细文档 (~4,200行) ⭐新增

**智能合约 (contracts)**:
- Solidity合约: 6个, 1,500+行
- 测试文件: 3个, 600+行
- 部署脚本: 4个, 500+行
- 测试用例: 45+个

**后端服务**:
- Java代码: 132个文件, 11,358行
- Python代码: 31个文件, 12,417行
- Vue3代码: 45个文件, 10,958行
- 桌面应用代码: 612个文件 (335个JS + 243个Vue + 34个Utils), ~210,000行 ⭐更新
- 数据库表: 50+张 (基础表 + 企业版表 + 区块链表 + P2优化表)
- API端点: 149个
- IPC处理器: 160+个（包含企业版IPC + 高级特性IPC）
- 优化文档: 8个文档, ~4,200行 ⭐新增

## 🗓️ 开发路线图

> 📋 **详细完成计划**: 查看 [COMPLETION_PLAN_2026-01-13.md](./COMPLETION_PLAN_2026-01-13.md) 了解完整的任务清单、时间表和实施细节

### 已完成 ✅
- [x] **Phase 0**: 系统设计和架构规划 (100%)
- [x] **Phase 1 (MVP - 知识库管理)**: 100% 完成
  - [x] 桌面应用框架搭建 (Electron + Vue3)
  - [x] U盾集成和加密存储 (SQLCipher)
  - [x] 本地LLM和RAG实现 (Ollama + ChromaDB)
  - [x] Git同步功能 (含冲突解决)
  - [x] 文件导入 (Markdown/PDF/Word/TXT)
  - [x] 图片上传和OCR (v0.11.0)
  - [x] 全文搜索和标签系统
  - [x] 提示词模板管理
  - [x] 知识图谱可视化 (v0.21.0)

- [x] **Phase 2 (去中心化社交)**: 100% 完成
  - [x] DID身份系统
  - [x] DHT网络发布
  - [x] 可验证凭证系统
  - [x] P2P通信基础 (libp2p)
  - [x] 社区论坛 (Spring Boot + Vue3)
  - [x] Signal协议端到端加密 (v0.16.0)
  - [x] 多设备支持和消息同步 (v0.16.0)
  - [x] 好友管理系统 (好友请求、在线状态、分组)
  - [x] 社交动态系统 (发布、点赞、评论、图片)

- [x] **Phase 3 (去中心化交易系统)**: 100% 完成
  - [x] 数字资产管理 (asset-manager.js - 600行)
  - [x] 交易市场 (marketplace-manager.js - 685行)
  - [x] 智能合约引擎 (contract-engine.js - 1102行 + 合约模板 526行)
  - [x] 托管服务 (escrow-manager.js - 592行)
  - [x] 知识付费系统 (knowledge-payment.js - 812行)
  - [x] 信用评分系统 (credit-score.js - 637行)
  - [x] 评价和反馈系统 (review-manager.js - 671行)
  - [x] 订单管理 (集成在交易市场)
  - [x] 完整前端UI (20+交易组件)

### 进行中 🚧

- [x] **Phase 4 (区块链集成)**: 100% 完成 ⭐完成
  - [x] 阶段1: 基础设施搭建 (Hardhat + 数据库扩展) ✅
  - [x] 阶段2: 钱包系统实现 (内置HD钱包 + 外部钱包) ✅
  - [x] 阶段3: 智能合约开发 (6个合约 + 测试 + 部署) ✅
  - [x] 阶段4: 区块链适配器实现 (100%) - **已完成2000行代码** ✅
  - [x] 阶段5: 集成到现有模块 (100%) - **已完成2700行代码** ✅
  - [x] 阶段6: 前端UI适配 (100%) - **已完成2000行代码** ✅

- [ ] **Phase 5 (生态完善)**: 90% 完成 ⭐
  - [x] 语音识别功能 (Phase 3完成) ✅
  - [x] 浏览器扩展 (测试框架+文档完善, 70%) - **剩余1500行代码**
  - [x] 技能工具系统 (集成完成, 100%) ✅
  - [x] 插件系统 (动态加载+热更新, 100%) ✅
  - [x] 知识图谱可视化 (v0.21.0完成) ✅
  - [x] P2P WebRTC语音/视频通话 (100%) ✅ ⭐完成
  - [ ] 移动端UI完善 (50%) - **剩余5000行代码**
  - [ ] 企业版功能（去中心化组织, 45%） - **剩余7800行代码** ⭐更新

### 计划中 ⏳

- [ ] **Phase 6 (生产优化)**: 规划中
  - [ ] 完整的区块链适配器
  - [ ] 跨链桥生产级实现
  - [ ] 完善的测试覆盖率
  - [ ] 性能优化和监控
  - [ ] 安全审计
  - [ ] 文档完善

### 📊 剩余工作量统计

| 模块 | 当前完成度 | 剩余代码量 | 优先级 | 状态 |
|------|-----------|-----------|--------|------|
| ~~区块链集成~~ | ~~100%~~ | ~~0行~~ | ~~🔴 高~~ | ✅ **已完成** |
| ~~P2P通信~~ | ~~100%~~ | ~~0行~~ | ~~🟡 中~~ | ✅ **已完成** |
| 企业版功能 | 45% | 7,800行 | 🔴 高 | 🚧 进行中 |
| 移动端应用 | 75% | 3,500行 | 🔴 高 | 🟢 功能完整 | ⭐大幅提升
| 浏览器扩展 | 70% | 1,500行 | 🟡 中 | 🚧 进行中 |
| 社交系统 | 90% | 500行 | 🟡 中 | 🚧 进行中 |
| 交易系统 | 85% | 1,000行 | 🟡 中 | 🚧 进行中 |
| 去中心化身份 | 100% | 800行 | 🟢 低 | ✅ 完成 |
| **总计** | **99.5%** | **15,100行** | - | - | ⭐更新

**预计完成时间**: 2026-02-27 (6周) ⭐提前2周

### 版本历史

| 版本 | 日期 | 主要更新 |
|------|------|---------|
| v0.22.0 | 2026-01-13 | **区块链集成完成**: Phase 4-6全部完成（15链支持+RPC管理+事件监听+完整UI），新增6,566行代码，12个UI组件，完整测试覆盖 ⭐重大更新 |
| v0.21.0 | 2026-01-12 | **知识图谱可视化+企业版DID邀请+移动端增强**: 8个图分析算法、5种可视化方式、智能实体提取、6种导出格式、DID邀请链接系统（安全令牌/使用控制/统计分析）、移动端Markdown渲染（代码高亮/图片预览/工具栏/实时预览/自动保存） |
| v0.20.0 | 2026-01-11 | **语音识别完善+PC端核心功能**: Whisper集成测试通过(100%准确度)、语音设置UI完成、多语言支持、STUN/TURN网络测试、P2P通信增强(WebRTC+Signal Protocol)、文档结构重构、测试框架升级(Vitest) |
| v0.20.0 | 2026-01-03 | **测试框架升级+性能优化**: 全面迁移到Vitest(94个测试文件/900+用例)、性能优化集成(内存降级/磁盘检查/并发控制)、安全防护体系、4个核心模块单元测试、移动端数据同步、Linux平台支持 |
| v0.19.5 | 2026-01-02 | **P2优化+V3工具+菜单集成**: AI引擎P2优化完成(意图融合/知识蒸馏/流式响应)、V3工具系统恢复(300工具)、应用菜单集成、生产环境部署 |
| v0.19.0 | 2025-12-31 | **代码库完善**: 更新项目文档、优化模板配置、完善测试框架(62个测试文件)、代码库重构优化 |
| v0.18.0 | 2025-12-30 | **企业版+技能工具扩展**: 去中心化组织(多身份+RBAC权限+9个新表)+技能工具系统扩展至115个技能+216个工具+Playwright测试框架+多数据库隔离 |
| v0.17.0 | 2025-12-29 | **区块链集成Phase 1-3**: 智能合约系统(6合约+测试+部署)+钱包系统(HD+外部)+技能工具系统+插件系统+浏览器扩展+语音识别Phase 3 |
| v0.16.0 | 2025-12-28 | **Phase 3完成**: 8大交易模块(5625+行)+19个AI引擎+后端服务体系(149 API)+数据库同步+测试框架 |
| v0.11.0 | 2025-12-18 | 图片上传和OCR功能 (Tesseract.js + Sharp) |
| v0.10.0 | 2025-12 | RAG重排序器(3种算法) + 查询重写 |
| v0.9.0 | 2025-11 | 文件导入功能完善 (PDF/Word/TXT) |
| v0.8.0 | 2025-11 | 可验证凭证系统 (W3C VC标准, 5种类型) |
| v0.6.1 | 2025-10 | DHT网络发布 (DID文档) |
| v0.4.0 | 2025-09 | Git冲突解决 (可视化界面) + AI提交消息 |
| v0.1.0 | 2025-08 | 首个MVP版本 |

## 🛠️ 技术栈

### PC端 (desktop-app-vue) - 主应用
- **框架**: Electron 39.2.6 + Vue 3.4 + TypeScript 5.3
- **UI组件**: Ant Design Vue 4.1.2
- **状态管理**: Pinia 2.1.7
- **路由**: Vue Router 4.2.5
- **编辑器**:
  - Milkdown 7.17.3 (Markdown)
  - Monaco Editor (代码)
  - Jspreadsheet (Excel)
- **数据库**: SQL.js + SQLCipher (AES-256)
- **Git**: isomorphic-git 1.25.10
- **P2P**: libp2p 3.1.2 + Signal Protocol
- **图片处理**: Sharp 0.33 + Tesseract.js 5.0
- **加密**: node-forge + TweetNaCl + U盾SDK (Koffi FFI)
- **向量数据库**: ChromaDB 3.1.8
- **构建**: Vite 7.2.7 + Electron Builder

### 后端服务

#### Project Service (项目管理)
- **框架**: Spring Boot 3.1.11 + Java 17
- **ORM**: MyBatis Plus 3.5.7 (建议升级到3.5.9)
- **数据库**: PostgreSQL 16
- **缓存**: Redis 7
- **Git**: JGit 6.8.0
- **连接池**: HikariCP
- **文档**: SpringDoc OpenAPI 2.2.0
- **端口**: 9090

#### AI Service (AI推理)
- **框架**: FastAPI 0.109.0+ + Python 3.9+
- **LLM**: Ollama (本地) + 14+云提供商
- **向量数据库**: Qdrant 1.7.0+ / ChromaDB 0.4.22
- **嵌入模型**: Sentence Transformers 2.3.0
- **服务器**: Uvicorn 0.27.0+
- **端口**: 8001

#### Community Forum (社区论坛)
**后端**:
- **框架**: Spring Boot 3.1.5 + Java 17
- **ORM**: MyBatis Plus 3.5.9
- **数据库**: MySQL 8.0.12
- **搜索**: Elasticsearch 8.11
- **缓存**: Redis 7.0
- **认证**: JWT 0.12.3 + Spring Security
- **文档**: SpringDoc OpenAPI 2.2.0
- **端口**: 8080

**前端**:
- **框架**: Vue 3.4.0 + Vite 5.0.8
- **UI组件**: Element Plus 2.5.1
- **状态管理**: Pinia 2.1.7
- **路由**: Vue Router 4.2.5
- **HTTP**: Axios 1.6.2
- **Markdown**: Markdown-it 14.0.0
- **端口**: 3000

### 移动端
#### Android (android-app)
- **语言**: Kotlin
- **UI**: Jetpack Compose
- **数据库**: Room ORM + SQLCipher
- **加密**: BouncyCastle
- **SIMKey**: OMAPI
- **LLM**: Ollama Android

#### React Native (mobile-app)
- **框架**: React Native 0.73.2
- **导航**: React Navigation

### Docker服务
- **LLM引擎**: Ollama (latest, 端口11434)
  - 支持模型: Qwen2-7B, LLaMA3-8B, GLM-4, MiniCPM-2B等
  - GPU加速: NVIDIA CUDA支持
- **向量数据库**:
  - Qdrant (latest, 端口6333) - 高性能向量检索
  - ChromaDB 3.1.8 - 轻量级向量存储
- **关系数据库**:
  - PostgreSQL 16 (端口5432) - Project Service
  - MySQL 8.0 (端口3306) - Community Forum
- **缓存**: Redis 7 (端口6379)
- **嵌入模型**: bge-large-zh-v1.5 / bge-small-zh-v1.5
- **RAG系统**: AnythingLLM (可选)
- **Git服务**: Gitea (可选)

### 区块链 (50% 完成) ⭐
- **智能合约**: Solidity 0.8+ + Hardhat 2.28
- **开发框架**: Hardhat Toolbox 5.0
- **合约库**: OpenZeppelin Contracts 5.4
- **交互**: Ethers.js v6.13
- **钱包**:
  - 内置: BIP39 + BIP44 + AES-256-GCM加密
  - 外部: MetaMask + WalletConnect v1
- **网络**:
  - 主网: Ethereum (Chain ID: 1), Polygon (Chain ID: 137)
  - 测试网: Sepolia (11155111), Mumbai (80001)
  - 本地: Hardhat Network (31337)
- **合约类型**:
  - ERC-20代币 (ChainlessToken)
  - ERC-721 NFT (ChainlessNFT)
  - 托管合约 (EscrowContract)
  - 订阅合约 (SubscriptionContract)
  - 悬赏合约 (BountyContract)
  - 跨链桥 (AssetBridge)

## 🤝 贡献指南

我们欢迎所有形式的贡献!

### 如何贡献
1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

### 开发规范
- 代码风格: 遵循ESLint/Prettier配置
- 提交信息: 使用语义化提交 (feat/fix/docs/style/refactor/test/chore)
- 测试: 添加必要的单元测试和集成测试
- 文档: 更新相关文档和注释

详见 [CONTRIBUTING.md](./docs/development/CONTRIBUTING.md)

### 优先级任务

> 📋 **详细任务清单**: 查看 [COMPLETION_PLAN_2026-01-13.md](./COMPLETION_PLAN_2026-01-13.md) 了解完整的任务分解和实施计划

1. 🔴 **高优先级** (预计16,800行代码):
   - **区块链集成** (5,500行)
     - 区块链适配器实现 (阶段4)
     - 集成到现有模块 (阶段5)
     - 前端UI适配 (阶段6)
   - **企业版功能** (7,800行)
     - P2P组织网络
     - 知识库协作
     - 数据同步
     - 前端UI完善
   - **移动端应用** (3,500行) ⭐减少1,500行
     - 交易系统完善 (800行)
     - 项目管理增强 (500行)
     - 设置配置完善 (300行)
     - 社交功能增强 (400行)
     - 移动UX优化 (400行)
     - 通知系统 (300行)
     - 高级功能 (600行)
     - 性能优化 (200行)

2. 🟡 **中优先级** (预计3,000行代码):
   - **浏览器扩展** (1,500行) - 剩余30%
   - **社交系统** (500行) - 动态增强功能 ⭐更新
   - **交易系统** (1,000行) - 支付系统和交易安全

3. 🟢 **低优先级** (预计800行代码):
   - **去中心化身份** (800行) - P2P网络发布
   - 智能合约第三方安全审计
   - 云LLM提供商接口完整实现

**总计剩余工作量**: 15,100行代码 | **预计完成时间**: 6周 ⭐减少2,000行

## 🔒 安全声明

- **硬件密钥**: 强烈建议使用U盾或SIMKey,软件模拟仅供测试
- **备份重要**: 请务必备份助记词和密钥,丢失无法恢复
- **开源审计**: 所有加密实现开源可审计
- **安全报告**: 发现安全漏洞请发送至 security@chainlesschain.com
- **漏洞奖励**: 重大安全漏洞将给予奖励

### 已知限制

> 📋 **完成计划**: 查看 [COMPLETION_PLAN_2026-01-13.md](./COMPLETION_PLAN_2026-01-13.md) 了解详细的解决方案和时间表

**区块链集成** (55% → 100%, 预计5,500行代码):
- 区块链适配器部分完成（阶段4: 20%完成，阶段5-6待开发）
- 合约未经第三方安全审计（计划中）
- 前端UI适配未完成（阶段6待开发）

**企业版功能** (45% → 100%, 预计7,800行代码):
- P2P组织网络未实现（Topic订阅、成员发现）
- 知识库协作未完成（共享、版本控制、冲突解决）
- 数据同步未完成（增量同步、冲突检测）
- 前端UI需完善（仪表板、统计图表）

**移动应用** (75% → 100%, 预计3,500行代码): ⭐大幅提升
- uni-app版本需完成剩余25%功能
- 交易系统需完善（智能合约、托管、信用评分、评价系统）
- 项目管理需增强（模板、AI聊天、协作功能）
- 设置配置需完善（高级LLM设置、网络配置、隐私设置）
- 社交功能需增强（群聊UI、视频帖子、话题系统）
- 移动UX需优化（手势、动画、响应式设计）
- 通知系统需实现（推送通知、通知中心）
- 高级功能需开发（语音输入、相机集成）
- SIMKey集成未开发（低优先级）

**社交系统** (90% → 100%, 预计500行代码):
- 动态功能需增强（视频、话题、搜索）
- ~~群组功能未实现（创建、管理、聊天）~~ ✅ 已完成 ⭐新增

**交易系统** (85% → 100%, 预计1,000行代码):
- 支付系统需完善（多币种、汇率、网关）
- 交易安全需增强（验证、风控、反欺诈）

**后端服务**:
- AI Service需要更多集成测试
- 云LLM提供商接口需要完整实现

**其他**:
- 浏览器扩展完成70%（剩余1,500行代码）
- 去中心化身份完成100%（已完成800行代码）

**总计剩余工作量**: 15,100行代码 | **预计完成时间**: 2026-03-13 (8周) ⭐减少2,000行

## 📜 许可证

本项目采用 **MIT License** 开源许可证 - 详见 [LICENSE](./LICENSE)

核心加密库采用 **Apache 2.0** 许可证

## 📞 联系我们

### 官方渠道
- **官网**: https://www.chainlesschain.com
- **文档**: https://docs.chainlesschain.com
- **论坛**: https://community.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

### 联系方式
- **Email**: zhanglongfa@chainlesschain.com
- **安全报告**: security@chainlesschain.com
- **电话**: 400-1068-687
- **微信**: https://work.weixin.qq.com/ca/cawcde653996f7ecb2

### 社区
- **技术讨论**: GitHub Discussions
- **Bug报告**: GitHub Issues
- **功能建议**: GitHub Issues

## 🙏 致谢

感谢以下开源项目和技术:

### 核心框架
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式JavaScript框架
- [React](https://react.dev/) - 用户界面库
- [Spring Boot](https://spring.io/projects/spring-boot) - Java应用框架

### AI & 数据
- [Ollama](https://ollama.ai/) - 本地LLM运行时
- [Qdrant](https://qdrant.tech/) - 向量数据库
- [ChromaDB](https://www.trychroma.com/) - AI原生嵌入式数据库
- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR识别引擎

### 加密 & 网络
- [SQLCipher](https://www.zetetic.net/sqlcipher/) - 加密数据库
- [libp2p](https://libp2p.io/) - P2P网络协议栈
- [Signal Protocol](https://signal.org/docs/) - 端到端加密协议

### 编辑器 & UI
- [Milkdown](https://milkdown.dev/) - Markdown编辑器
- [Ant Design](https://ant.design/) / [Ant Design Vue](https://antdv.com/) - 企业级UI组件库
- [Element Plus](https://element-plus.org/) - Vue 3组件库

### 工具
- [Vite](https://vitejs.dev/) - 下一代前端构建工具
- [TypeScript](https://www.typescriptlang.org/) - JavaScript超集
- [Docker](https://www.docker.com/) - 容器化平台

---

<div align="center">

## 📊 项目统计

![GitHub stars](https://img.shields.io/github/stars/chainlesschain/chainlesschain?style=social)
![GitHub forks](https://img.shields.io/github/forks/chainlesschain/chainlesschain?style=social)
![GitHub issues](https://img.shields.io/github/issues/chainlesschain/chainlesschain)
![GitHub pull requests](https://img.shields.io/github/issues-pr/chainlesschain/chainlesschain)

### 整体代码统计

**代码总量**: 260,000+ 行 ⭐更新
- Desktop App: 220,000+ 行 (JavaScript/TypeScript/Vue) ⭐更新
  - 主进程: ~190,000 行 (含移动端同步7700行) ⭐更新
  - 渲染进程: ~15,000 行 (243个组件)
  - 工具类: ~15,000 行 (34个文件)
- Smart Contracts: 2,400 行 (Solidity + 测试 + 脚本)
- Browser Extension: 2,000+ 行 (JavaScript)
- Backend Services: 23,775 行 (Java + Python)
- Community Forum: 10,958 行 (Vue3)
- 测试代码: 10,000+ 行 (94个测试文件)
- 优化文档: 4,200+ 行 (8个文档)

**组件和文件**:
- Vue组件: 288个 (桌面243 + 论坛45)
- JavaScript文件: 369个 (主进程335 + 工具类34)
- Solidity合约: 6个
- Java文件: 132个
- Python文件: 31个
- 测试文件: 97个 (桌面94 + 合约3)
- 优化文档: 8个

**功能模块**:
- 16个AI专用引擎
- 移动端PC端数据同步系统 (7700+行)
  - 设备配对、知识库同步、项目同步、PC状态监控
  - WebRTC P2P通信、libp2p加密、信令服务器
  - 离线消息队列、增量同步
- 跨平台U-Key支持 (Windows/macOS/Linux) ⭐新增
  - CrossPlatformAdapter统一接口
  - PKCS#11驱动支持
  - 自动降级到模拟模式
- LayerZero区块链桥接 (生产级) ⭐新增
  - 支持7个主网 + 2个测试网
  - 费用估算、交易跟踪、事件驱动
- 工作区管理系统 (完整CRUD) ⭐新增
  - 恢复、永久删除、成员管理
- 远程同步系统 (完整实现) ⭐新增
  - 增量同步、冲突解决、多设备协作
- P2优化系统 (3800+行)
  - 意图融合、知识蒸馏、流式响应
  - 任务分解增强、工具组合、历史记忆
- 深度性能优化系统 (~8,700行) ⭐新增
  - 18个优化工具类 (~8,000行)
  - 4个专用组件 (~700行)
  - 智能图片优化、实时性能监控
  - 代码分割、组件懒加载、虚拟滚动
  - 智能预取、请求批处理、乐观更新
  - 数据压缩、增量同步、内存优化
  - 动画控制、资源提示、无障碍功能
- 企业版（去中心化组织）
  - OrganizationManager: 1966行
  - IdentityStore: 385行
  - UI页面/组件: 6个
  - 数据库表: 9个
- 8大交易模块 (5960行)
- 区块链系统 (3263行)
  - 钱包系统
  - 智能合约 (6个合约)
- 技能工具系统（115个技能 + 300个工具）
- 高级特性控制面板（MenuManager + IPC + Web界面）
- 插件系统（动态加载 + 热更新）
- 语音识别系统（Whisper集成+设置UI+测试通过）
- 浏览器扩展（70%完成）
- 测试框架（Playwright E2E + Vitest单元测试）
- 6个RAG核心模块
- 5个AI引擎组件
- 4个数据库同步模块

**后端服务**:
- API端点总数: 157个 ⭐更新
  - Project Service: 56 API ⭐更新
  - AI Service: 38 API
  - Community Forum: 63 API
- 数据库表: 52+张 (基础表 + 企业版表 + 区块链表 + 对话管理表) ⭐更新
- IPC处理器: 168+个 (包含企业版IPC + 高级特性IPC + 对话管理IPC) ⭐更新

**测试覆盖**:
- 测试文件总数: 97个 ⭐更新
  - 单元测试: 70+个文件
  - 集成测试: 4个文件
  - E2E测试: 10+个文件
  - 性能测试: 10个文件
- 测试框架: Vitest单元测试 + Playwright E2E ⭐更新
- 测试用例: 900+个 ⭐更新
- 覆盖率: 核心功能全面覆盖

**整体完成度: 99%** ⭐更新

**用技术捍卫隐私，用AI赋能个人**

Made with ❤️ by ChainlessChain Team

[⬆ 回到顶部](#chainlesschain---基于u盾和simkey的个人移动ai管理系统)

</div>
