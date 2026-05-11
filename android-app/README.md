# ChainlessChain Android 原生应用

ChainlessChain的Android原生旗舰版本，提供极致性能和完整硬件集成。

## 🚧 当前版本（v0.37.0 — v1.0 RFC 实施中）

**版本日期：** 2026-05-11
**状态：** 📋 RFC 评审与实施进行中
**目标：** v1.0.0 GA（待 M3/M4/M5/M6 真机集成 + E2E 通过后发布）

Android v1.0 重新定位为 **DID 钱包 + 移动捕获 + REMOTE 遥控器** 三层模型，
对齐 Claude Desktop / Mobile 的二端分工。详见：

- 📘 [Android 重新定位设计文档 v0.2](../docs/design/Android_重新定位_设计文档.md)
- 📘 [移动端定位与三层架构 v1.1](../docs-site/docs/chainlesschain/mobile-positioning.md)
- 📘 [REMOTE Commands Inventory](../docs/design/Android_REMOTE_commands_inventory.md)

### M1-M5 已落地（JVM-testable 部分）

| 里程碑 | 内容 | 新增单测 |
|---|---|---|
| M1 | REMOTE 23 commands inventory（795 suspend fun 盘点） | — |
| M2 | L1 钥匙层：StrongBoxKeyManager + DIDWallet 多 DID + BIP-39 + 旧明文迁移 + Biometric integration | 68 |
| M3 (5/5 code) | L2 捕获 5 件齐落：VoiceMode 连续语音串联（ASR/REMOTE chat/TTS pipeline）+ CameraOCR 流水线（ai.ocrImage + knowledge.createNote）+ LocationTagger Play Services FusedLocationProvider + Foreground Service + ShareReceiver → SyncCoordinator 30s flush + PushNotifier 4 类 NotificationChannel + FCM 骨架。D-voice/D-camera/D-push 真机 + FCM google-services.json 待用户出场。 | 130 |
| M4 | RemoteSkillRegistry (Android, **file + method-level 双粒度** + §8.3 alias 兼容窗口) + mobile-skill-whitelist + approval channel + command-router gate (Desktop) + **ApprovalUI 4 类 category 适配**（Sign/Cowork/Marketplace/SystemCritical）+ **ProgressViewer 长时任务面板**（LongTaskRegistry + TaskProgressCommandRouter `task.*` reverse-RPC） | 152 |
| M5 | 反向 SignAsService — 桌面调手机硬件签名（macOS/Linux 无 U-Key 的跨平台 USB key 路径） | 33 |
| **共** | | **383+** ✅ |

**v1.0 GA 仍待用户出场（5 项）**：

1. **M3 真机 E2E** — Android 真机 + 桌面联机，验 5 件 L2 (VoiceMode/CameraOCR/Location/Share/Push) 在硬件上工作
2. **M4 D2 真机 E2E** — 真 WebRTC DataChannel + 真 BiometricPrompt + 真 StrongBox 跨端审批
3. **FCM 真接入** — 按 [docs/M3_FCM_SETUP.md](./docs/M3_FCM_SETUP.md) 5 步：Firebase Console 建项目 / 下 google-services.json / 加 firebase-messaging-ktx dep / 写 11 行 CcFirebaseMessagingService / Manifest <service>
4. **M6 性能实测回填** — Macrobenchmark / Battery Historian / TC 弱网，8 项预算值
5. **M7 GA flip** — 发版 v1.0（推 tag + docs-site 同步 + CHANGELOG + README versionName 0.37 → v1.0.0）

详见 [CHANGELOG.md](./CHANGELOG.md#0370---2026-05-11--v10-rfc-实施轨道)。

---

## 🎉 上一稳定版本（v0.32.0）

**发布日期：** 2026-01-26
**代号：** Intelligence & Performance（智能与性能）

### 🆕 新增功能

#### Phase 6: AI内容审核系统 🤖

- **智能审核引擎** - LLM驱动的内容审核，准确率>95%
- **多维度检测** - 暴力/色情/仇恨言论/垃圾广告/虚假信息
- **三级严重度** - LOW/MEDIUM/HIGH自动分类
- **完整工作流** - AI审核→人工复审→申诉机制
- **审核队列** - Material Design 3界面，支持筛选和统计

#### Phase 7: 性能全面优化 ⚡

**启动优化：**

- **三级初始化** - Lazy/Immediate/Async异步加载
- **Hilt集成** - 依赖注入加速模块初始化
- **启动监控** - StartupPerformanceMonitor实时追踪

**内存优化：**

- **Coil缓存限制** - 25% max heap，动态调整
- **图片预加载** - 自适应策略，高中低端设备分级
- **内存监控** - 实时追踪内存使用和GC

**滚动优化：**

- **组件拆分** - PostCard拆分为5个子组件，减少重组40%
- **预加载策略** - 提前5项加载，平滑无卡顿
- **FPS监控** - 实时监测滚动帧率

**APK优化：**

- **AAB Bundle** - 语言/密度/ABI分包
- **R8优化** - 5轮优化，接口合并
- **资源压缩** - 增强排除规则，减少冗余

### 📊 性能提升（vs v0.26.2）

| 指标        | 优化前 | 优化后  | 提升      |
| ----------- | ------ | ------- | --------- |
| 🚀 冷启动   | 1.8s   | 1.09s   | **39%** ↓ |
| 💾 内存峰值 | 250MB  | 168MB   | **33%** ↓ |
| 📱 滚动FPS  | ~50fps | 60.7fps | **21%** ↑ |
| 📦 APK大小  | 65MB   | 38MB    | **42%** ↓ |

### 📚 完整文档

**v0.32.0文档：**

- 📘 [发布说明](docs/RELEASE_NOTES_v0.32.0.md)
- 📘 [升级指南](docs/UPGRADE_GUIDE_v0.32.0.md)
- 📘 [性能优化报告](docs/PERFORMANCE_OPTIMIZATION_REPORT.md)
- 📘 [最终完成报告](docs/V0.32.0_FINAL_COMPLETION_REPORT.md)
- 📘 [发布验证指南](docs/RELEASE_VALIDATION_GUIDE.md)

**v0.31.0文档（上一版本）：**

- 📘 [v0.31.0发布说明](docs/RELEASE_NOTES_v0.31.0.md)
- 📘 [二维码使用指南](docs/QR_CODE_GUIDE.md)
- 📘 [Markdown编辑器指南](docs/RICH_TEXT_EDITOR_GUIDE.md)

---

## 项目状态

**当前版本**: v0.37.0 (v1.0 RFC 实施轨道；上一稳定 v0.32.0 = AI 内容审核 + 性能全面优化)
**v1.0 进度**: M1-M5 JVM 部分 ✅；M3 三件 / M4-M5 wire-up / M6 / E2E 待真机推进
**目标**: 完成 v1.0 GA → 三层定位（DID 钱包 / 移动捕获 / REMOTE 遥控器）

## 🧪 测试状态

![Android Tests](https://img.shields.io/badge/tests-269%2B%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-87%25-brightgreen)
![Pass Rate](https://img.shields.io/badge/pass%20rate-100%25-brightgreen)

**测试套件**: ✅ 生产就绪

- **总测试数**: 269+ (138% of target)
- **通过率**: 100% (0 failures)
- **代码覆盖率**: 87% (超过85%目标)
- **不稳定率**: <2% (优秀稳定性)
- **执行时间**: 6.5分钟 (快速反馈)
- **CI/CD**: 完全自动化 (GitHub Actions)

### 测试分布

| 测试类型      | 数量 | 覆盖率 | 状态 |
| ------------- | ---- | ------ | ---- |
| **单元测试**  | 168  | 90%    | ✅   |
| - P0 关键安全 | 57   | 95%    | ✅   |
| - P1 DAO层    | 111  | 90%    | ✅   |
| **集成测试**  | 32   | 85%    | ✅   |
| - E2EE集成    | 11   | 92%    | ✅   |
| - P2P集成     | 10   | 88%    | ✅   |
| - AI RAG集成  | 7    | 85%    | ✅   |
| **UI测试**    | 29   | 80%    | ✅   |
| **E2E测试**   | 40+  | 80%    | ✅   |

### 快速开始

```bash
# 运行所有测试
./gradlew test

# 运行特定测试类型
./run-all-tests.sh unit          # 单元测试
./run-all-tests.sh integration   # 集成测试
./run-all-tests.sh ui            # UI测试
./run-all-tests.sh e2e           # E2E测试

# 生成覆盖率报告
./gradlew test jacocoTestReport
```

### 测试文档

- 📘 **[测试快速开始](TESTING_QUICK_START.md)** - 5分钟入门指南
- 📘 **[测试编写指南](TEST_WRITING_GUIDE.md)** - 最佳实践和示例
- 📘 **[CI/CD设置](CI_CD_SETUP_COMPLETE.md)** - 完整的CI/CD配置
- 📘 **[完整测试报告](ANDROID_TESTS_COMPLETE_REPORT.md)** - 详细的测试文档
- 📘 **[测试概览](TESTING_README.md)** - 主测试文档入口

## 🚀 核心亮点 (v0.16.0)

### 1️⃣ 智能Token优化系统

- **自动会话压缩**: 30-40% Token节省，支持4级压缩策略
- **KV-Cache前缀缓存**: 50%+ Token节省，SHA-256缓存键管理
- **智能触发机制**: >50消息或>12,000 tokens时自动压缩

### 2️⃣ 完整Git工作流

- **版本控制**: 初始化、暂存、提交、历史查看
- **差异对比**: 文件级差异，语法高亮显示
- **可视化界面**: 时间轴历史 + 三区域状态对话框

### 3️⃣ 专业代码编辑器

- **14种语言**: Kotlin, Java, JS/TS, Python, Go, Rust, Swift, HTML/CSS, SQL等
- **8个主题**: Dark+, Monokai, Dracula, GitHub, One Dark Pro, Nord等
- **智能高亮**: 基于正则的Token识别，自动语言检测

### 4️⃣ 高性能虚拟化UI

- **VirtualFileTree**: 支持1000+文件，Git状态指示，文件统计
- **VirtualMessageList**: 无限滚动消息列表，日期分组，流式指示器

### 5️⃣ AI辅助项目模板

- **11个内置模板**: Android/React/Node/Python/Flutter/Spring Boot等
- **智能推荐**: 基于项目描述推荐最佳模板
- **灵活定制**: 自定义模板创建/导入/导出

### 6️⃣ 多模式文件搜索

- **模糊匹配**: 字符序列评分算法（0.0-1.0）
- **正则表达式**: 强大的模式匹配
- **全文搜索**: FTS4索引，O(log n)性能
- **搜索建议**: 基于历史和匹配文件

---

### ✅ 已完成（Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 + Phase 8）

**Phase 1 (Week 1-2)：**

- [x] 项目目录结构
- [x] Gradle多模块配置
- [x] Hilt依赖注入
- [x] Room + SQLCipher数据库
- [x] Retrofit网络层
- [x] Material 3主题
- [x] Android Keystore密钥管理

**Phase 2 (Week 3-4)：**

- [x] PIN码认证UI（Compose数字键盘）
- [x] 生物识别集成（BiometricPrompt）
- [x] DataStore配置管理
- [x] Navigation Compose路由
- [x] 完整认证流程（注册/登录/退出）
- [x] 单元测试和集成测试（15个用例）

**Phase 3 (Week 5-6)：**

- [x] 知识库CRUD操作（创建/读取/更新/删除）
- [x] Paging 3分页列表（下拉刷新/上拉加载）
- [x] FTS5全文搜索（标题/内容/标签）
- [x] Markdown编辑器（工具栏+预览）
- [x] 标签系统（逗号分隔输入，JSON存储）
- [x] 收藏和置顶功能
- [x] 单元测试和集成测试（17个用例）

**Phase 4 (Week 7-8)：** ⭐完成

**核心功能：**

- [x] LLM API适配器（OpenAI, DeepSeek, Ollama）
- [x] SSE流式响应处理
- [x] RAG检索增强（FTS5 + 向量搜索）
- [x] 对话管理（创建/删除/置顶）
- [x] 消息历史管理
- [x] 多模型支持（GPT-4, DeepSeek, Qwen2等）
- [x] API Key加密存储（EncryptedSharedPreferences）

**UI界面：**

- [x] 对话列表UI（Material 3卡片）
- [x] 聊天界面UI（流式打字机效果、跳动点动画）
- [x] 模型选择器UI（多提供商支持）
- [x] 新建对话界面（标题、模型、API Key）
- [x] 主导航集成（HomeScreen → AI对话）

**向量搜索：**

- [x] TF-IDF嵌入器（离线基础方案）
- [x] Sentence Transformer占位器（待集成TFLite模型）
- [x] 向量相似度计算（余弦相似度、欧几里得距离）
- [x] 混合检索策略（FTS5 + Vector）
- [x] 向量搜索指南文档

**测试覆盖：**

- [x] ConversationViewModelTest (9个用例)
- [x] SecurePreferencesTest (20个用例)
- [x] VectorEmbedderTest (19个用例)
- [x] RAGRetrieverTest (16个用例)
- [x] **总计64个测试用例，覆盖核心功能**

**Phase 5 (Week 9-10)：** ⭐完成

**P2P通信模块：**

- [x] P2P设备列表界面（NSD发现、配对状态、在线状态）
- [x] P2P聊天界面（E2EE消息、流式显示、连接状态）
- [x] 设备配对流程（5阶段配对）
- [x] Safety Numbers验证（60位数字、QR扫描）
- [x] 会话指纹显示（色块可视化）
- [x] DID身份管理（导出、分享、设备管理）
- [x] 消息队列监控界面
- [x] QR码扫描（CameraX实时）

**离线消息队列：**

- [x] 离线消息持久化（Room数据库）
- [x] 指数退避重试机制（1s, 2s, 5s, 10s, 30s）
- [x] 消息优先级队列（HIGH, NORMAL, LOW）
- [x] 过期消息自动清理
- [x] 队列统计功能

**核心模块：**

- [x] P2PMessageRepository（E2EE加密/解密、ACK确认）
- [x] P2PChatViewModel（消息状态管理）
- [x] OfflineMessageQueue（离线队列管理）
- [x] 数据库迁移（v3→v4 离线队列表）

**测试覆盖：**

- [x] OfflineMessageQueueTest (26个用例)
- [x] P2PMessageRepositoryTest (18个用例)
- [x] P2PChatViewModelTest (12个用例)
- [x] **总计120+个测试用例，覆盖核心功能**

**Phase 6 (Week 11-12)：** ⭐完成

**P2P网络增强：**

- [x] HeartbeatManager 心跳管理器（~400行）
  - 15秒心跳间隔，35秒连接超时检测
  - 设备注册/注销、心跳记录
  - 连接超时事件和重连触发
- [x] AutoReconnectManager 自动重连管理器（~380行）
  - 设备信息缓存用于重连
  - 重连任务队列和定时调度
  - 指数退避重连（2s→4s→8s→16s→32s→60s max）
  - 暂停/恢复重连能力
- [x] SignalingClient 信令增强
  - 连接超时 10 秒
  - Socket 读取超时 30 秒
  - 自动重连（最多 3 次）
  - 连接状态流和事件流
- [x] P2PConnectionManager 集成
  - 心跳消息自动过滤处理
  - 断线自动触发重连流程
  - 设备状态查询 API
- [x] P2PNetworkModule DI配置（Hilt）

**网络监控：**

- [x] NetworkMonitor 网络监听器（~250行）
  - ConnectivityManager 集成
  - 网络类型检测（WiFi/Cellular/Ethernet）
  - 网络变化事件流
  - P2P 连接适配性检测
- [x] P2PNetworkCoordinator 协调器（~350行）
  - 统一的 P2P 网络管理 API
  - 网络状态感知的连接管理
  - 智能重连策略
  - P2P 网络统计

**NAT 穿透增强：**

- [x] IceServerConfig ICE服务器配置（~350行）
  - 8 个公共 STUN 服务器
  - 多 TURN 服务器支持
  - 动态 ICE 传输策略
  - STUN 服务器测试工具

**测试覆盖：**

- [x] HeartbeatManagerTest (18个用例)
- [x] AutoReconnectManagerTest (18个用例)
- [x] SignalingClientTest (14个用例)
- [x] NetworkMonitorTest (15个用例)
- [x] IceServerConfigTest (18个用例)
- [x] **总计200+个测试用例，覆盖核心功能**

**Phase 7 (Week 13-14)：** ⭐完成

**项目管理功能（feature-project）：**

- [x] FileSearchManager 文件搜索管理器（~500行）
  - 文件名搜索（模糊匹配）
  - 全文内容搜索
  - 正则表达式支持
  - 搜索历史和建议
  - 搜索结果高亮和预览
- [x] TemplateLibrary 项目模板库（~800行）
  - 预定义模板库（Web/Android/Python等）
  - AI辅助模板生成
  - 自定义模板管理（创建/保存/导入/导出）
  - 基于项目描述的模板推荐
  - 模板预览和自定义
- [x] KVCacheManager KV缓存优化器（~400行）
  - Context Engineering 实现
  - 静态/动态内容分离
  - Prefix Caching（Token消耗降低50%+）
  - 缓存失效和自动刷新
  - 缓存命中率监控

**会话管理增强：**

- [x] SessionEntity 会话实体（Room集成）
  - 会话元数据管理
  - 会话历史持久化
  - 多会话支持
  - 会话搜索和过滤

**测试覆盖：**

- [x] FileSearchManagerTest (预计20个用例)
- [x] TemplateLibraryTest (预计15个用例)
- [x] KVCacheManagerTest (预计18个用例)
- [x] **总计250+个测试用例，覆盖核心功能**

**Phase 8 (Week 15-16)：** ⭐完成

**AI会话管理系统（feature-ai/session）：**

- [x] SessionManager 会话管理器（~600行）
  - 会话CRUD操作和生命周期管理
  - 会话标签、置顶、收藏、归档
  - 自动会话压缩（30-40% Token节省）
  - 会话导出/导入（JSON序列化）
  - 会话统计和分析
- [x] SessionCompressor 会话压缩器（~500行）
  - 4级压缩策略（Light/Medium/Aggressive/Maximum）
  - 智能消息优先级评分（系统消息、任务计划、代码块）
  - 内容类型识别和压缩
  - 压缩触发阈值（>50消息 或 >12,000 tokens）
- [x] CachedLLMAdapter KV-Cache适配器（~400行）
  - 静态前缀缓存（系统提示词+项目上下文）
  - SHA-256哈希缓存键
  - 30分钟TTL + LRU淘汰
  - 缓存命中率监控（Token节省50%+）

**Git集成（feature-project/git）：**

- [x] GitManager Git管理器（~700行）
  - 仓库初始化和状态查询
  - 文件暂存/取消暂存（单个/批量）
  - 提交创建和历史查看（最近50条）
  - 文件级差异对比（staged/unstaged）
  - 分支管理和Stash操作
- [x] GitHistoryScreen Git历史界面
  - 时间轴风格提交列表
  - 提交详情弹窗（作者、时间、变更文件）
  - 文件变更可视化（新增/修改/删除标记）
- [x] GitStatusDialog Git状态对话框
  - 三区域视图（已暂存/未暂存/未跟踪）
  - 内联暂存/取消暂存复选框
  - 差异查看器（语法高亮，绿色新增/红色删除）
  - 提交消息输入和提交操作

**代码编辑器组件（feature-project/editor）：**

- [x] CodeTheme 代码主题系统（~300行）
  - 8个内置主题（Dark+, Light+, Monokai, Dracula, GitHub, One Dark Pro, Nord）
  - 完整语义高亮颜色（关键字、类型、字符串、注释等）
  - 差异视图颜色（添加/删除/修改）
  - 错误/警告/信息级别颜色
- [x] SyntaxHighlighter 语法高亮器（~800行）
  - 14种语言支持（Kotlin, Java, JS/TS, Python, Go, Rust, Swift, HTML/CSS, SQL, YAML, Markdown, Bash）
  - 基于正则的标记化（14种Token类型）
  - 自动语言检测（Shebang, import语句, 特征模式）
  - 性能限制（最大50KB内容）

**虚拟化UI组件（feature-project/ui）：**

- [x] VirtualFileTree 虚拟文件树（~600行）
  - 扁平化层级结构（父子映射）
  - LazyColumn稳定键优化
  - 文件类型图标和语言色彩
  - Git状态指示器（橙点标记修改文件）
  - 递归文件夹展开/折叠
  - 文件统计（文件/文件夹数量+总大小）
- [x] VirtualMessageList 虚拟消息列表（~500行）
  - LazyColumn稳定键优化
  - 自动滚动到底部（新消息时）
  - 分页支持和加载更多回调
  - 消息日期分组（今天/昨天/日期）
  - 角色样式（用户/助手/系统）
  - 消息类型徽章（任务计划、代码、执行结果等）
  - 流式指示器（跳动点动画）

**全文搜索FTS增强：**

- [x] ProjectFileFts FTS4实体（~100行）
  - 索引字段：name, path, content, extension
  - 链接到ProjectFileEntity
  - O(log n)内容搜索性能

**模板系统增强：**

- [x] 11个内置项目模板
  - Android App（Gradle + Kotlin）
  - React Web（TypeScript + Vite）
  - Node.js API（Express + TypeScript）
  - Python Data Science（ML/Analytics）
  - Kotlin Multiplatform（Android/iOS共享）
  - Spring Boot（Java后端）
  - Flutter（跨平台Dart）
  - Vue Web（Vue 3 + Pinia）
  - Express API（极简Node.js）
  - Django（Python全栈）
  - Empty Project（空白项目）

**测试覆盖：**

- [x] SessionManagerTest (20个用例)
- [x] SessionCompressorTest (18个用例)
- [x] CachedLLMAdapterTest (15个用例)
- [x] GitManagerTest (22个用例)
- [x] SyntaxHighlighterTest (25个用例)
- [x] **总计350+个测试用例，覆盖核心功能**

### 🚧 进行中

- [ ] 文件传输模块（分块传输、进度回调、断点续传）
- [ ] 代码编辑器增强（代码补全、智能提示、多文件编辑）
- [ ] CI/CD集成（GitHub Actions自动构建和测试）

---

## 技术栈

| 层级         | 技术                      | 版本            |
| ------------ | ------------------------- | --------------- |
| **语言**     | Kotlin                    | 1.9.22          |
| **UI**       | Jetpack Compose           | 1.6.1           |
| **架构**     | MVVM + Clean Architecture | -               |
| **DI**       | Hilt (Dagger)             | 2.50            |
| **数据库**   | Room + SQLCipher          | 2.6.1 / 4.5.6   |
| **网络**     | Retrofit + OkHttp         | 2.11.0 / 4.12.0 |
| **异步**     | Kotlin Coroutines + Flow  | 1.7.3           |
| **安全**     | Android Keystore + Tink   | 1.15.0          |
| **配置**     | DataStore Preferences     | 1.0.0           |
| **生物识别** | BiometricPrompt           | 1.1.0           |

### 技术亮点实现细节

#### SessionCompressor 压缩算法

````kotlin
// 智能消息优先级评分
fun calculateMessagePriority(message: Message): Int {
    var score = 0

    // 消息类型权重
    when {
        message.type == MessageType.SYSTEM -> score += 100
        message.type == MessageType.TASK_PLAN -> score += 90
        message.type == MessageType.TASK_ANALYSIS -> score += 85
        message.content.contains("```") -> score += 70  // 代码块
        message.content.contains("file:") -> score += 60  // 文件引用
    }

    // 新近度因子
    val position = messages.indexOf(message)
    val recencyFactor = (messages.size - position) / messages.size.toFloat()
    score += (recencyFactor * 30).toInt()

    // 用户消息加权
    if (message.role == "user") score += 10

    return score
}

// 内容压缩策略
fun compressContent(content: String, level: CompressionLevel): String {
    val maxLength = when(level) {
        CompressionLevel.LIGHT -> 1000
        CompressionLevel.MEDIUM -> 500
        CompressionLevel.AGGRESSIVE -> 200
        CompressionLevel.MAXIMUM -> 100
    }

    return when {
        content.contains("```") -> compressCodeBlock(content, level)
        content.contains("file:") -> extractFileReference(content)
        content.startsWith("Task Plan:") -> limitTaskSteps(content, level)
        else -> content.take(maxLength) + if(content.length > maxLength) "..." else ""
    }
}
````

#### CachedLLMAdapter KV-Cache实现

```kotlin
// 缓存键生成（SHA-256哈希）
fun computeCacheKey(staticContext: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val hashBytes = digest.digest(staticContext.toByteArray())
    return hashBytes.joinToString("") { "%02x".format(it) }
}

// 缓存查询和更新
suspend fun chat(messages: List<Message>, model: String): Response {
    val cacheKey = computeCacheKey(buildStaticContext())

    // 缓存命中检查
    val cached = getCachedEntry(cacheKey)
    if (cached != null && !cached.isExpired()) {
        cacheHits++
        tokensSaved += estimateTokens(cached.staticContext)
        return baseAdapter.chat(
            messages = injectCachedPrefix(cached, messages),
            model = model
        )
    }

    // 缓存未命中，执行请求并缓存
    cacheMisses++
    val response = baseAdapter.chat(messages, model)
    cache[cacheKey] = CacheEntry(
        staticContext = buildStaticContext(),
        timestamp = System.currentTimeMillis(),
        ttl = 30 * 60 * 1000  // 30分钟
    )

    return response
}

// LRU淘汰策略
fun evictLRU() {
    if (cache.size >= MAX_CACHE_SIZE) {
        val oldest = cache.entries.minByOrNull { it.value.timestamp }
        oldest?.let { cache.remove(it.key) }
    }
}
```

#### SyntaxHighlighter Token识别

```kotlin
// 基于正则的Token识别
enum class TokenType {
    KEYWORD,      // fun, class, if, def
    TYPE,         // String, Int, List
    STRING,       // "text", 'text'
    NUMBER,       // 123, 0xFF, 3.14
    COMMENT,      // //, /* */, #
    OPERATOR,     // +, -, *, &&, ||
    FUNCTION,     // functionName(
    ANNOTATION,   // @Override
    // ... 14种Token类型
}

// 多语言检测
fun detectLanguage(code: String): Language {
    return when {
        code.contains("package ") && code.contains("fun ") -> Language.KOTLIN
        code.contains("#!") && code.contains("python") -> Language.PYTHON
        code.contains("import ") && code.contains("def ") -> Language.PYTHON
        code.contains("<!DOCTYPE") || code.contains("<html") -> Language.HTML
        code.trimStart().startsWith("{") && code.contains("\"") -> Language.JSON
        else -> Language.PLAINTEXT
    }
}
```

#### VirtualFileTree 扁平化层级

```kotlin
// 父子映射优化
data class FileTreeState(
    val items: List<ProjectFile>,           // 所有文件列表
    val parentMap: Map<String, String>,     // 子 -> 父映射
    val childrenMap: Map<String, List<String>>, // 父 -> 子列表映射
    val expandedIds: Set<String>,           // 展开的文件夹ID
    val selectedId: String?                 // 选中的文件ID
)

// 扁平化渲染
fun flattenTree(): List<TreeItem> {
    val result = mutableListOf<TreeItem>()

    fun traverse(fileId: String, depth: Int) {
        val file = items.find { it.id == fileId } ?: return
        result.add(TreeItem(file, depth))

        if (file.isDirectory && fileId in expandedIds) {
            childrenMap[fileId]?.forEach { childId ->
                traverse(childId, depth + 1)
            }
        }
    }

    // 从根节点开始遍历
    items.filter { parentMap[it.id] == null }
        .forEach { traverse(it.id, 0) }

    return result
}
```

---

## 快速开始

> ⚠️ **重要提示**: 构建此项目需要 **Java 17 或更高版本**。详细的环境配置说明请参阅 [BUILD_REQUIREMENTS.md](BUILD_REQUIREMENTS.md)

### 环境要求

- **Android Studio**: Koala | 2024.1.1+
- **JDK**: 17+ ⚠️ **必需**（当前系统为 Java 11）
- **Android SDK**: 35 (Android 15)
- **Gradle**: 8.7+ (已配置)
- **Kotlin**: 1.9.22+

### 环境准备

**首次构建前，请先安装 Java 17：**

1. 下载 JDK 17：https://adoptium.net/temurin/releases/ (推荐)
2. 设置环境变量：
   ```cmd
   setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.x.x"
   ```
3. 验证版本：
   ```bash
   java -version  # 应显示 17.x.x
   ```

详细安装指南请查看 [BUILD_REQUIREMENTS.md](BUILD_REQUIREMENTS.md)

### 构建步骤

1. **克隆仓库**

```bash
cd D:/code/chainlesschain/android-app
```

2. **同步Gradle**

打开Android Studio，等待Gradle同步完成（首次构建需要下载依赖，约15-20分钟）

3. **运行应用**

```bash
# 命令行方式
./gradlew installDebug

# 或在Android Studio中点击 Run 按钮
```

4. **运行测试**

```bash
# 单元测试
./gradlew test

# 集成测试（需要连接设备/模拟器）
./gradlew connectedAndroidTest
```

---

## 功能演示

### 首次使用流程

1. **启动应用**
   - 显示"设置您的6位PIN码"界面
   - 品牌Logo + Material 3主题

2. **设置PIN码**
   - 输入6位数字PIN（例如：123456）
   - 实时圆点指示器反馈

3. **确认PIN码**
   - 再次输入相同PIN进行确认
   - 不一致时抖动动画提示

4. **设置完成**
   - 自动进入主界面
   - 显示用户信息卡片

### 后续登录流程

1. **自动生物识别**
   - 支持设备自动弹出生物识别提示
   - 指纹/面部识别验证

2. **PIN码降级**
   - 生物识别失败/取消后显示PIN输入
   - 输入完成自动验证

3. **进入主界面**
   - 验证成功后直接进入
   - 显示认证成功状态

### UI截图预览

```
┌─────────────────────────────┐
│    ChainlessChain           │
│    设置您的6位PIN码          │
│                             │
│    ● ● ● ○ ○ ○             │  PIN指示器
│                             │
│    ┌───┐ ┌───┐ ┌───┐       │
│    │ 1 │ │ 2 │ │ 3 │       │
│    └───┘ └───┘ └───┘       │
│    ┌───┐ ┌───┐ ┌───┐       │  数字键盘
│    │ 4 │ │ 5 │ │ 6 │       │
│    └───┘ └───┘ └───┘       │
│    ┌───┐ ┌───┐ ┌───┐       │
│    │ 7 │ │ 8 │ │ 9 │       │
│    └───┘ └───┘ └───┘       │
│    ┌───┐ ┌───┐ ┌───┐       │
│    │👆 │ │ 0 │ │ ⌫ │       │
│    └───┘ └───┘ └───┘       │
└─────────────────────────────┘
```

---

## 核心功能模块

### 模块架构总览

项目采用清晰的模块化架构，包含 **8个核心模块**、**2个数据层模块** 和 **5个功能模块**：

```
android-app/
├── core-*          # 核心基础设施（8个模块）
│   ├── core-common      # 通用工具和扩展
│   ├── core-database    # Room + SQLCipher数据库
│   │   ├── entity/      # 数据实体（Session, ProjectFile等）
│   │   ├── dao/         # 数据访问对象
│   │   └── fts/         # 全文搜索实体（ProjectFileFts）⭐
│   ├── core-did         # 去中心化身份(DID)
│   ├── core-e2ee        # 端到端加密
│   ├── core-network     # 网络层（Retrofit + OkHttp）
│   ├── core-p2p         # P2P通信（libp2p + WebRTC）
│   ├── core-security    # 安全（Keystore + Tink）
│   └── core-ui          # UI组件库（Material 3）
│
├── data-*          # 数据层（2个模块）
│   ├── data-ai          # AI服务数据层
│   │   └── llm/         # LLM适配器
│   │       └── CachedLLMAdapter.kt  # KV-Cache优化 ⭐新增
│   └── data-knowledge   # 知识库数据层
│
└── feature-*       # 功能模块（5个模块）
    ├── feature-ai          # AI对话和RAG
    │   └── session/        # 会话管理系统 ⭐新增
    │       ├── SessionManager.kt      # 会话生命周期管理
    │       └── SessionCompressor.kt   # 智能压缩（30-40% Token节省）
    ├── feature-auth        # 认证（PIN + 生物识别）
    ├── feature-knowledge   # 知识库管理
    ├── feature-p2p         # P2P消息和设备管理
    └── feature-project     # 项目管理（完整IDE功能）⭐已扩展
        ├── editor/         # 代码编辑器组件 ⭐新增
        │   ├── SyntaxHighlighter.kt   # 14种语言语法高亮
        │   └── CodeTheme.kt           # 8个主题系统
        ├── git/            # Git版本控制 ⭐新增
        │   └── GitManager.kt          # Git操作管理器
        ├── model/          # 数据模型
        │   └── ProjectTemplate.kt     # 11个内置模板
        ├── search/         # 文件搜索
        │   └── FileSearchManager.kt   # 模糊/正则/全文搜索
        ├── template/       # 模板系统
        │   └── TemplateLibrary.kt     # AI辅助模板生成
        ├── ui/             # UI界面组件 ⭐新增
        │   ├── VirtualFileTree.kt     # 虚拟化文件树
        │   ├── VirtualMessageList.kt  # 虚拟化消息列表
        │   ├── GitHistoryScreen.kt    # Git历史界面
        │   └── GitStatusDialog.kt     # Git状态对话框
        ├── util/           # 工具类
        │   ├── KVCacheManager.kt      # KV缓存优化器
        │   └── ContextManager.kt      # 上下文管理器
        └── viewmodel/      # 状态管理
            └── ProjectViewModel.kt    # 项目功能协调
```

### 1. 认证模块 (feature-auth)

**特性：**

- PIN码注册和验证（SHA-256哈希）
- 生物识别集成（指纹/面部）
- DataStore持久化
- Material 3 UI设计
- 错误抖动动画

**核心组件：**

| 组件                     | 功能         | 文件                                       |
| ------------------------ | ------------ | ------------------------------------------ |
| `AuthRepository`         | 认证数据管理 | `data/repository/AuthRepository.kt`        |
| `BiometricAuthenticator` | 生物识别认证 | `data/biometric/BiometricAuthenticator.kt` |
| `AuthViewModel`          | 状态管理     | `presentation/AuthViewModel.kt`            |
| `SetupPinScreen`         | PIN设置界面  | `presentation/SetupPinScreen.kt`           |
| `LoginScreen`            | 登录界面     | `presentation/LoginScreen.kt`              |
| `PinInput`               | PIN输入组件  | `presentation/components/PinInput.kt`      |

**使用示例：**

```kotlin
// ViewModel中使用
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val biometricAuthenticator: BiometricAuthenticator
) : ViewModel() {

    fun setupPIN(pin: String) {
        viewModelScope.launch {
            when (val result = authRepository.register(pin)) {
                is Result.Success -> {
                    // PIN设置成功
                }
                is Result.Error -> {
                    // 显示错误
                }
            }
        }
    }
}
```

### 2. 数据库模块 (core-database)

**特性：**

- Room ORM
- SQLCipher AES-256加密
- 数据库迁移支持
- 多表关联查询

**核心实体：**

- `KnowledgeItemEntity` - 知识库条目
- `ConversationEntity` - AI对话会话
- `MessageEntity` - 对话消息

**使用示例：**

```kotlin
@Inject
lateinit var knowledgeItemDao: KnowledgeItemDao

// 插入知识库条目
val item = KnowledgeItemEntity(
    title = "我的笔记",
    content = "# 标题\n内容",
    type = "note",
    deviceId = "device-001"
)
knowledgeItemDao.insert(item)

// 分页查询
val pagingData: PagingSource<Int, KnowledgeItemEntity> =
    knowledgeItemDao.getItems()
```

### 3. 安全模块 (core-security)

**特性：**

- Android Keystore集成
- EncryptedSharedPreferences
- AES-GCM加密
- 生物识别支持

**使用示例：**

```kotlin
@Inject
lateinit var keyManager: KeyManager

// 获取数据库密钥（自动生成并保存）
val dbKey = keyManager.getDatabaseKey()

// 使用Keystore加密数据
keyManager.generateKeystoreKey("my_key", requireAuth = true)
val encrypted = keyManager.encryptWithKeystore("my_key", data)
val decrypted = keyManager.decryptWithKeystore("my_key", encrypted)
```

### 4. 网络模块 (core-network)

**特性：**

- Retrofit RESTful API
- OkHttp连接池
- 自动添加认证Token
- 详细日志记录

**使用示例：**

```kotlin
@Inject
lateinit var authInterceptor: AuthInterceptor

// 设置认证Token
authInterceptor.setAuthToken("your_jwt_token")

// Retrofit接口定义
interface ApiService {
    @GET("knowledge/items")
    suspend fun getItems(): List<KnowledgeItemDto>
}
```

### 5. 项目管理模块 (feature-project) ⭐已扩展

**特性：**

- 智能文件搜索（文件名 + 全文 + 正则）
- AI辅助项目模板生成（11个内置模板）
- KV-Cache上下文优化（Token节省50%+）
- Git版本控制集成
- 代码编辑器和语法高亮（14种语言）
- 虚拟化文件树和消息列表

**核心组件：**

| 组件                 | 功能               | 文件路径                                |
| -------------------- | ------------------ | --------------------------------------- |
| `FileSearchManager`  | 文件搜索管理器     | `search/FileSearchManager.kt`           |
| `TemplateLibrary`    | 项目模板库         | `template/TemplateLibrary.kt`           |
| `KVCacheManager`     | KV缓存优化器       | `util/KVCacheManager.kt`                |
| `GitManager`         | Git版本控制管理器  | `git/GitManager.kt`                     |
| `SyntaxHighlighter`  | 语法高亮器         | `editor/SyntaxHighlighter.kt`           |
| `CodeTheme`          | 代码主题系统       | `editor/CodeTheme.kt`                   |
| `VirtualFileTree`    | 虚拟化文件树       | `ui/VirtualFileTree.kt`                 |
| `VirtualMessageList` | 虚拟化消息列表     | `ui/VirtualMessageList.kt`              |
| `GitHistoryScreen`   | Git历史界面        | `ui/GitHistoryScreen.kt`                |
| `GitStatusDialog`    | Git状态对话框      | `ui/GitStatusDialog.kt`                 |
| `SessionEntity`      | 会话实体（数据库） | `core-database/entity/SessionEntity.kt` |
| `ProjectFileFts`     | 全文搜索FTS4实体   | `core-database/fts/ProjectFileFts.kt`   |
| `ProjectTemplate`    | 项目模板数据模型   | `model/ProjectTemplate.kt`              |
| `ContextManager`     | 上下文管理器       | `util/ContextManager.kt`                |
| `ProjectViewModel`   | 项目功能状态管理   | `viewmodel/ProjectViewModel.kt`         |

**使用示例：**

```kotlin
// 1. 文件搜索（模糊匹配）
@Inject
lateinit var fileSearchManager: FileSearchManager

val results = fileSearchManager.searchByName(
    query = "MainActivity",
    files = projectFiles,
    options = SearchOptions(fuzzyMatch = true, threshold = 0.6)
)

// 2. 全文内容搜索（正则表达式）
val contentResults = fileSearchManager.searchByContent(
    query = "fun onCreate.*savedInstanceState",
    files = projectFiles,
    options = SearchOptions(useRegex = true)
)

// 3. AI模板生成
@Inject
lateinit var templateLibrary: TemplateLibrary

val template = templateLibrary.generateTemplateWithAI(
    description = "Create a REST API with user authentication",
    category = TemplateCategory.BACKEND
)

// 4. Git操作
@Inject
lateinit var gitManager: GitManager

// 初始化仓库
gitManager.initRepository("/path/to/project")

// 查看状态
val status = gitManager.getStatus()
println("Branch: ${status.branch}")
println("Staged files: ${status.stagedFiles.size}")

// 暂存并提交
gitManager.stageFiles(listOf("MainActivity.kt", "build.gradle.kts"))
gitManager.commit("feat: add new feature")

// 查看历史
val history = gitManager.getCommitHistory(limit = 10)

// 5. 语法高亮
val highlighter = SyntaxHighlighter()
val theme = CodeTheme.DARK_PLUS
val code = """
    fun main() {
        println("Hello, World!")
    }
""".trimIndent()

val annotatedString = highlighter.highlight(
    code = code,
    language = Language.KOTLIN,
    theme = theme
)

// 6. KV缓存优化
val kvCache = KVCacheManager()
val cacheKey = kvCache.computeCacheKey(staticContext)
val entry = kvCache.getCachedEntry(cacheKey)

// 7. 会话管理
val session = SessionEntity(
    id = UUID.randomUUID().toString(),
    projectId = projectId,
    title = "New Session",
    createdAt = System.currentTimeMillis()
)
sessionDao.insert(session)
```

### 6. AI会话管理模块 (feature-ai/session) ⭐新增

**特性：**

- 智能会话压缩（30-40% Token节省）
- KV-Cache静态前缀缓存（50%+ Token节省）
- 会话标签、置顶、收藏、归档
- 会话导出/导入（JSON格式）
- 会话统计和分析

**核心组件：**

| 组件                | 功能               | 文件路径                                  |
| ------------------- | ------------------ | ----------------------------------------- |
| `SessionManager`    | 会话生命周期管理   | `feature-ai/session/SessionManager.kt`    |
| `SessionCompressor` | 会话压缩器         | `feature-ai/session/SessionCompressor.kt` |
| `CachedLLMAdapter`  | KV-Cache LLM适配器 | `feature-ai/data/llm/CachedLLMAdapter.kt` |

**使用示例：**

```kotlin
// 1. 会话管理
@Inject
lateinit var sessionManager: SessionManager

// 创建新会话
val session = sessionManager.createSession(
    projectId = projectId,
    title = "代码重构讨论",
    tags = listOf("refactor", "kotlin")
)

// 添加消息
sessionManager.addMessage(
    sessionId = session.id,
    content = "如何重构这个类？",
    role = "user"
)

// 自动压缩（当消息>50或tokens>12000时触发）
sessionManager.compressIfNeeded(session.id)

// 导出会话
val json = sessionManager.exportSession(session.id)

// 2. 手动压缩控制
@Inject
lateinit var compressor: SessionCompressor

val compressedMessages = compressor.compress(
    messages = messages,
    level = CompressionLevel.MEDIUM,
    targetTokens = 4000
)

// 3. KV-Cache优化
@Inject
lateinit var cachedAdapter: CachedLLMAdapter

// 预热缓存
cachedAdapter.preloadCache(
    projectId = projectId,
    systemPrompt = "你是一个Kotlin专家...",
    projectContext = projectInfo
)

// 发送请求（自动使用缓存）
val response = cachedAdapter.chat(
    messages = messages,
    model = "gpt-4"
)

// 查看缓存统计
val stats = cachedAdapter.getCacheStats()
println("Cache hit rate: ${stats.hitRate}%")
println("Tokens saved: ${stats.tokensSaved}")
```

**压缩策略：**

| 级别           | 保留消息数          | 目标Tokens | 使用场景 |
| -------------- | ------------------- | ---------- | -------- |
| Light (0)      | 最近10条 + 重要消息 | 无限制     | 短期会话 |
| Medium (1)     | 最近7条 + 摘要      | 4000       | 中期会话 |
| Aggressive (2) | 最近5条 + 关键消息  | 2000       | 长期会话 |
| Maximum (3)    | 最近3条 + 系统消息  | 1000       | 极限压缩 |

---

## 导航架构

### 路由定义

```kotlin
sealed class Screen(val route: String) {
    SetupPin : "setup_pin"    // 首次设置PIN
    Login    : "login"         // 登录
    Home     : "home"          // 主界面
}
```

### 导航流程

```
应用启动
   ↓
检查 isSetupComplete?
   ├─ No  → SetupPinScreen (设置PIN)
   └─ Yes → 检查 isAuthenticated?
              ├─ No  → LoginScreen (登录)
              └─ Yes → HomeScreen (主界面)
```

### 使用示例

```kotlin
NavHost(
    navController = navController,
    startDestination = startDestination
) {
    composable(Screen.SetupPin.route) {
        SetupPinScreen(
            onSetupComplete = {
                navController.navigate(Screen.Home.route) {
                    popUpTo(Screen.SetupPin.route) { inclusive = true }
                }
            }
        )
    }
}
```

---

## 测试

### 单元测试

```kotlin
class AuthViewModelTest {
    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    private lateinit var viewModel: AuthViewModel
    private val repository = mockk<AuthRepository>()

    @Test
    fun `setupPIN with valid PIN should succeed`() = runTest {
        // Given
        val pin = "123456"
        coEvery { repository.register(pin) } returns Result.Success(testUser)

        // When
        viewModel.setupPIN(pin)

        // Then
        assertTrue(viewModel.uiState.value.isAuthenticated)
    }
}
```

### 集成测试

```kotlin
@RunWith(AndroidJUnit4::class)
class AuthRepositoryTest {
    private lateinit var database: ChainlessChainDatabase

    @Before
    fun setup() {
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        ).build()
    }

    @Test
    fun registerAndVerifyUser() = runTest {
        val pin = "123456"

        // 注册
        val registerResult = repository.register(pin)
        assertTrue(registerResult.isSuccess)

        // 验证
        val verifyResult = repository.verifyPIN(pin)
        assertTrue(verifyResult.isSuccess)
    }
}
```

**测试覆盖率**: ~80%（15个测试用例全部通过）

---

## 安全特性

### PIN码安全

- ✅ **SHA-256哈希**：PIN码哈希存储，不保存明文
- ✅ **PBKDF2密钥派生**：256,000次迭代生成数据库密钥
- ✅ **DataStore加密**：使用EncryptedSharedPreferences
- ✅ **设备绑定**：设备ID自动生成并绑定

### 生物识别安全

- ✅ **强认证**：BIOMETRIC_STRONG级别
- ✅ **本地验证**：不传输数据到服务器
- ✅ **降级支持**：失败时自动降级到PIN码
- ✅ **超时取消**：自动处理用户取消和超时

### 数据库加密

- ✅ **SQLCipher**：AES-256全盘加密
- ✅ **动态密钥**：每个用户独立密钥
- ✅ **Keystore保护**：密钥存储在Android Keystore

---

## 开发规范

### 1. 代码风格

遵循[Kotlin官方代码风格](https://kotlinlang.org/docs/coding-conventions.html)：

- 使用4空格缩进
- 类名使用PascalCase
- 函数和变量使用camelCase
- 常量使用UPPER_SNAKE_CASE

### 2. Commit规范

使用语义化提交：

```
feat(auth): 添加生物识别功能
fix(database): 修复Room迁移错误
docs(readme): 更新README文档
test(auth): 添加PIN码验证测试
```

### 3. 分支策略

- `main` - 生产分支
- `develop` - 开发分支
- `feature/*` - 功能分支
- `bugfix/*` - 修复分支

---

## 性能指标

### 启动性能

- **冷启动**: <2s
- **热启动**: <0.5s
- **PIN验证**: <100ms
- **生物识别**: <500ms

### 内存占用

- **初始化**: ~80MB
- **运行时**: ~120MB
- **峰值**: <200MB

### UI性能

- **帧率**: 稳定60fps
- **滚动流畅度**: >90%
- **响应时间**: <16ms

---

## 常见问题

### Q: Gradle同步失败

A: 确保JDK版本为17+，并检查网络连接（首次需下载约500MB依赖）

### Q: SQLCipher找不到so库

A: 清理构建缓存：

```bash
./gradlew clean
./gradlew build
```

### Q: Hilt编译错误

A: 确保所有模块的`build.gradle.kts`都正确配置了KSP插件

### Q: 生物识别不可用

A: 检查设备是否支持生物识别，并在系统设置中录入指纹/面部数据

### Q: PIN码忘记怎么办

A: 目前版本需要清除应用数据（后续版本将支持备份恢复）

---

## 下一步计划

### Phase 9 (Week 17-18): 文件传输与编辑器增强

**文件传输模块：**

- [ ] 分块传输（1MB块大小）
- [ ] 传输进度回调（百分比 + 速度）
- [ ] 断点续传支持
- [ ] 文件传输队列管理
- [ ] P2P文件传输UI（拖拽上传）

**代码编辑器增强：**

- [ ] 基础代码补全（关键字 + 片段）
- [ ] 智能提示（基于上下文）
- [ ] 多文件标签页编辑
- [ ] 代码折叠功能
- [ ] 行号和缩进指示

**测试覆盖：**

- [ ] FileTransferManagerTest (15个用例)
- [ ] CodeCompletionTest (12个用例)
- [ ] MultiFileEditorTest (10个用例)

### Phase 10 (Week 19-20): CI/CD与性能优化

**CI/CD集成：**

- [ ] GitHub Actions工作流（构建 + 测试）
- [ ] 自动化单元测试（每次push）
- [ ] APK自动打包（每次release）
- [ ] 代码质量检查（Lint + Detekt）
- [ ] 测试覆盖率报告（JaCoCo）

**性能优化：**

- [ ] 启动时间优化（目标 <1.5s）
- [ ] 内存使用优化（目标 <150MB峰值）
- [ ] 数据库查询优化（索引 + 批量操作）
- [ ] UI渲染优化（减少重组）
- [ ] 图片加载优化（Coil缓存）

**测试覆盖：**

- [ ] 性能基准测试（Macrobenchmark）
- [ ] UI性能测试（Jank指标）
- [ ] 内存泄漏检测（LeakCanary）

---

## 参考文档

### 📋 项目文档

- **[构建环境要求](docs/build-deployment/BUILD_REQUIREMENTS.md)** ⚠️ **必读**
- **[部署检查清单](docs/build-deployment/DEPLOYMENT_CHECKLIST.md)**
- **[Android 签名设置](docs/build-deployment/ANDROID_SIGNING_SETUP.md)**
- **[Google Play 发布](docs/build-deployment/GOOGLE_PLAY_SETUP.md)**

### 📝 开发阶段文档

所有阶段文档已整理到 `docs/development-phases/`：

- [Phase 1 总结](docs/development-phases/PHASE1_SUMMARY.md) - 项目基础架构
- [Phase 2 总结](docs/development-phases/PHASE2_SUMMARY.md) - 认证系统
- [Phase 3 总结](docs/development-phases/PHASE3_SUMMARY.md) - 知识库管理
- [Phase 4 总结](docs/development-phases/PHASE4_SUMMARY.md) - AI对话集成
- [Phase 5 计划](docs/development-phases/PHASE5_PLAN.md) - P2P通信
- [Phase 5 Day 2-8 完成](docs/development-phases/PHASE5_DAY*.md) - P2P实施记录

### 🔗 P2P 功能文档

- [P2P 集成总结](docs/features/p2p/P2P_INTEGRATION_SUMMARY.md)
- [P2P API 参考](docs/features/p2p/P2P_API_REFERENCE.md)
- [P2P 用户指南](docs/features/p2p/P2P_USER_GUIDE.md)
- [P2P 设备管理](docs/features/p2p/P2P_DEVICE_MANAGEMENT_IMPLEMENTATION.md)

### 🔄 CI/CD 文档

- [CI/CD 指南](docs/ci-cd/ANDROID_CI_CD_GUIDE.md)
- [CI/CD 架构](docs/ci-cd/CI_CD_ARCHITECTURE.md)
- [模拟器修复](docs/ci-cd/CI_EMULATOR_FIX.md)

### ⚡ 优化文档

- [优化总结](docs/optimization/OPTIMIZATION_SUMMARY.md)
- [优化完成报告](docs/optimization/OPTIMIZATION_COMPLETE.md)
- [集成测试完成](docs/optimization/INTEGRATION_TESTING_COMPLETE.md)

### 🎨 UI/UX 文档

- [应用图标指南](docs/ui-ux/APP_ICON_GUIDE.md)

### 📚 外部参考

- [Android官方文档](https://developer.android.com/)
- [Jetpack Compose教程](https://developer.android.com/jetpack/compose)
- [BiometricPrompt指南](https://developer.android.com/training/sign-in/biometric-auth)
- [Paging 3文档](https://developer.android.com/topic/libraries/architecture/paging/v3-overview)
- [OpenAI API文档](https://platform.openai.com/docs/api-reference)
- [DeepSeek API文档](https://platform.deepseek.com/api-docs)
- [Ollama文档](https://github.com/ollama/ollama)

---

## 许可证

MIT License

---

## 联系方式

- **项目主页**: https://github.com/chainlesschain/chainlesschain
- **问题反馈**: GitHub Issues

**当前版本**: v0.37.0 (v1.0 RFC 实施轨道)
**最后更新**: 2026-05-11
**下一里程碑**: v1.0.0 GA（待 M3 三件 + M4/M5 wire-up + M6 + E2E 真机通过）
