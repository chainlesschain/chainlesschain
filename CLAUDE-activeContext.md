# ChainlessChain 当前会话上下文

> 记录当前开发会话的状态和上下文，帮助 AI 助手快速了解工作进度
>
> **最后更新**: 2026-02-02 (MCP 端到端集成测试完成)

---

## 当前工作焦点

### 活跃任务

- [x] 完善 ErrorMonitor 自动修复（SQLite 锁、网络重连）
- [x] 验证 Session 压缩效果
- [x] 创建 Memory Bank 系统
- [x] 完善 SessionManager 增强功能
- [x] 配置 Pre-commit Hooks (Husky)
- [x] 修复应用启动稳定性问题
- [x] SessionManager 前端 UI 增强（预览、快捷键、复制、标签管理）
- [x] LLM 按模型预算限制功能（LLMModelBudgetPanel）
- [x] iOS 端 AI 对话历史持久化
- [x] iOS 端 P2P 消息持久化、Double Ratchet、自动重连
- [x] iOS 端离线消息队列持久化
- [x] iOS 端向量数据库持久化（RAG 优化）
- [x] iOS 端核心模块单元测试
- [x] iOS 端 P2P 消息状态同步（已发送/已送达/已读）
- [x] iOS 端图片选择器和处理模块
- [x] iOS 端性能优化（内存监控、分页加载）
- [x] iOS 端 UI/UX 增强（动画、暗黑模式、Toast）
- [x] iOS 端图片消息发送/显示功能
- [x] iOS 端群组聊天完整实现
- [x] Android 端 P2P 聊天界面完善
- [x] Android 端 LLM 适配器（DeepSeek、Ollama）
- [x] Android 端离线消息队列
- [x] Android 端单元测试增强
- [x] PC 端 IPC 错误处理优化（无限重试、静默失败）
- [x] Android 端 P2P 网络心跳机制和自动重连
- [x] Clawdbot 永久记忆集成 Phase 1 (基础架构)
- [x] Clawdbot 永久记忆集成 Phase 2 (混合搜索引擎)
- [x] Clawdbot 永久记忆集成 Phase 3-5 (预压缩刷新、Embedding 缓存、文件监听)
- [x] Clawdbot 永久记忆集成 Phase 6 (UI 集成)
- [x] Clawdbot 永久记忆集成 Phase 7 (测试和文档)
- [x] Hooks 系统实现 (Claude Code 风格)
- [x] MCP 系统自动化测试 (32 个测试用例)
- [x] Plan Mode 系统实现 (Claude Code 风格)
- [x] Markdown Skills 系统增强 (Claude Code 风格)
- [x] Memory 目录增强功能 (语义分块、分层搜索、分析仪表盘)
- [x] MCP 系统单元测试完善 (32 测试全部通过)
- [x] MCP 端到端集成测试 (31 测试全部通过)
- [x] Context Window Optimization 系统实现 (KV-Cache 优化, 17 handlers)

### 最近完成

0. **Context Window Optimization 系统实现** (2026-02-02):
   - 新建 `src/main/llm/context-engineering-ipc.js` - 17 个 IPC 通道（~600 行）
     - 统计和配置：get-stats、reset-stats、get-config、set-config
     - Prompt 优化：optimize-messages、estimate-tokens
     - 任务上下文：set-task、update-task-progress、get-task、clear-task
     - 错误历史：record-error、resolve-error、get-errors、clear-errors
     - 内容压缩：compress、is-compressed、decompress
   - 利用现有核心类：
     - `ContextEngineering` - KV-Cache 优化、静态/动态内容分离
     - `RecoverableCompressor` - 可恢复压缩（保留 URL/路径，丢弃内容）
   - 新增 `TokenEstimator` 类 - Token 数量估算（中/英文自动检测）
   - 新建 `scripts/test-context-engineering.js` - 集成测试（22 个测试用例）
   - 更新 `src/main/ipc/ipc-registry.js` - 注册 Context Engineering IPC
   - 更新 `package.json` - 添加 test:context 脚本
   - **功能特点**:
     - KV-Cache 友好的 Prompt 构建（静态内容前置）
     - 工具定义确定性序列化（按名称排序）
     - 时间戳/UUID 等动态内容清理
     - 任务目标重述（解决"丢失中间"问题）
     - 错误历史保留供模型学习
     - 可恢复压缩（保留引用，支持后续恢复）
   - **测试结果**: 22 个集成测试全部通过

1. **MCP 端到端集成测试** (2026-02-02):
   - 新建 `scripts/test-mcp-integration.js` - 集成测试脚本（~920 行）
   - 6 个测试套件：
     - Server Connection Lifecycle（5 测试）
     - Tool Registration and Execution（8 测试）
     - Error Handling and Recovery（4 测试）
     - Performance Metrics（6 测试）
     - Security Policy Enforcement（5 测试）
     - Complete Integration Flow（3 测试）
   - MockMCPServer 类实现完整服务器模拟
   - 修复 `avgTime` → `avgLatency` 属性名称不匹配问题
   - **测试结果**: 31 passed, 0 failed, 306ms

1. **Memory 目录增强功能** (2026-02-02):
   - 新建 `src/main/rag/semantic-chunker.js` - 语义文档分块器（~400 行）
     - Markdown 感知分割（标题、列表、代码块）
     - 可配置块大小、重叠、分隔符
     - 批量文档处理
   - 新建 `src/main/rag/advanced-memory-search.js` - 高级记忆搜索（~500 行）
     - 分层记忆：WORKING（7天）、RECALL（8-30天）、ARCHIVAL（30+天）
     - 重要性过滤（CRITICAL/HIGH/NORMAL/LOW/TRIVIAL）
     - 时间范围搜索、类型过滤
   - 新建 `src/main/rag/memory-analytics.js` - 记忆分析仪表盘（~400 行）
     - 统计概览（总记忆数、日记数、活跃天数）
     - 趋势分析（30天分布）
     - 健康评分（A+ 到 F 评级）
   - 更新 `permanent-memory-ipc.js` - 新增 18 个 IPC 通道
     - 高级搜索：advanced-search、search-by-tier、search-by-date-range
     - 分析：get-dashboard-data、get-overview、get-trends、get-health-score
     - 分块器：chunk-document、chunk-documents
   - 新建 `scripts/test-memory-enhancements.js` - 40 测试全部通过

2. **Markdown Skills 系统增强 - Claude Code 风格** (2026-02-02):
   - 新建 `src/main/ai-engine/cowork/skills/skills-ipc.js` - 17 个 IPC 通道
     - 技能加载/重新加载
     - 技能查询（列表、详情、分类）
     - 技能执行（单个执行、自动执行、查找匹配）
     - 用户命令解析（/skill-name 格式）
     - 技能管理（启用/禁用、创建新技能）
   - 新建 3 个内置技能 SKILL.md：
     - `builtin/code-review/SKILL.md` - 代码审查技能
     - `builtin/git-commit/SKILL.md` - Git 提交消息生成
     - `builtin/explain-code/SKILL.md` - 代码解释技能
   - 新建 `scripts/test-markdown-skills.js` - 集成测试（15 个测试用例）
   - 更新 `src/main/ai-engine/cowork/skills/index.js` - 导出 IPC 处理器
   - 更新 `src/main/ipc/ipc-registry.js` - 注册 Skills IPC
   - 更新 `package.json` - 添加 test:skills 和 test:skills:integration 脚本
   - **功能特点**:
     - 三层加载机制：bundled（内置）→ managed（用户级）→ workspace（项目级）
     - 优先级覆盖：高层级技能覆盖低层级同名技能
     - 门控检查：平台、二进制依赖、环境变量
     - /skill-name 命令调用：解析用户输入触发技能
     - Hooks 系统集成：技能执行前后触发钩子
   - **测试结果**: 15 个集成测试全部通过

3. **Plan Mode 系统实现 - Claude Code 风格** (2026-02-02):
   - 新建 `src/main/ai-engine/plan-mode/` 目录 - 完整计划模式系统（~700 行）
     - `index.js` - PlanModeManager、ExecutionPlan、PlanItem 类
     - `plan-mode-ipc.js` - 14 个 IPC 通道
     - `__tests__/plan-mode.test.js` - 单元测试（48 个测试用例）
   - 新建 `scripts/test-plan-mode.js` - 集成测试（17 个测试用例）
   - 更新 `src/main/ipc/ipc-registry.js` - 注册 Plan Mode IPC
   - 更新 `package.json` - 添加 test:plan-mode 和 test:plan-mode:integration 脚本
   - **功能特点**:
     - 安全分析模式：只允许 Read/Search/Analyze 工具，禁止 Write/Execute/Delete
     - 计划生成和存储：自动记录被阻止的操作到计划
     - 审批流程：全部审批或部分审批，支持拒绝
     - 与 Hooks 系统集成：通过 PreToolUse 钩子实现权限控制
     - 统计和历史：跟踪计划创建/审批/拒绝统计，保存计划历史
   - **测试结果**: 48 单元测试 + 17 集成测试全部通过

4. **MCP 系统自动化测试** (2026-02-02):
   - 新建 `scripts/test-mcp-system.js` - 独立测试脚本（~690 行）
     - MCPSecurityPolicy 测试（7 用例）：路径验证、禁止路径、只读模式、审计日志
     - MCPConfigLoader 测试（5 用例）：配置加载、验证、服务器配置获取
     - MCPFunctionExecutor 测试（5 用例）：函数转换、缓存、执行
     - MCPToolAdapter 测试（7 用例）：工具注册、标识、服务器信息
     - MCPPerformanceMonitor 测试（8 用例）：指标记录、错误跟踪、报告生成
   - **测试结果**: 32 passed, 0 failed
   - **运行命令**: `node scripts/test-mcp-system.js`
   - **功能状态**: MCP 系统核心组件测试覆盖完成

5. **Hooks 系统实现 - Claude Code 风格** (2026-02-02):
   - 新建 `src/main/hooks/` 目录 - 完整钩子系统（~1500 行）
     - `index.js` - 主入口、HookSystem 类、单例管理
     - `hook-registry.js` - 钩子注册表、21 种事件类型
     - `hook-executor.js` - 钩子执行器（async/command/script）
     - `hook-middleware.js` - 5 种中间件工厂（IPC/Tool/Session/File/Agent）
     - `hooks-ipc.js` - 11 个 IPC 通道
     - `hooks-integration.js` - 便捷集成工具
     - `types.d.ts` - TypeScript 类型定义
     - `__tests__/hook-system.test.js` - 单元测试（20+ 测试用例）
   - 新建 `src/main/bootstrap/hooks-initializer.js` - Bootstrap 集成
   - 更新 `src/main/bootstrap/index.js` - 添加 Phase 0 hooks 初始化
   - 更新 `src/main/ipc/ipc-registry.js` - 注册 Hooks IPC
   - 更新 `src/main/ai-engine/function-caller.js` - 工具调用钩子集成
   - 新建 `.chainlesschain/hooks.example.json` - JSON 配置示例
   - 新建 `.chainlesschain/hooks/example-hooks.js` - 脚本钩子示例
   - 更新 `docs/design/HOOKS_SYSTEM_DESIGN.md` - 完整设计文档（800+ 行）
   - **功能状态**: 完成，支持 21 种钩子事件、4 种钩子类型、优先级系统

6. **Clawdbot 永久记忆集成 Phase 6 增强 - AI 对话保存记忆** (2026-02-02):
   - 更新 `src/main/llm/permanent-memory-ipc.js` - 新增 3 个 IPC 通道
     - `memory:save-to-memory` - 保存内容到永久记忆
     - `memory:extract-from-conversation` - 从对话提取并保存记忆
     - `memory:get-memory-sections` - 获取 MEMORY.md 章节列表
   - 更新 `src/main/llm/permanent-memory-manager.js` - 新增记忆保存方法（+270 行）
     - `saveToMemory()` - 保存到 Daily Notes 或 MEMORY.md
     - `extractFromConversation()` - 对话摘要提取与保存
     - `getMemorySections()` - 章节列表解析（修复无限循环 bug）
     - `_buildConversationSummary()` - 对话摘要构建
     - `_extractDiscoveries()` - LLM 辅助技术发现提取
   - 更新 `src/renderer/stores/memory.js` - 新增 store actions
     - `saveToMemory()` - 保存到记忆
     - `extractFromConversation()` - 对话记忆提取
     - `loadMemorySections()` - 加载章节列表
   - 更新 `src/renderer/pages/AIChatPage.vue` - 添加保存记忆 UI
     - AI 消息旁添加"保存记忆"下拉按钮（Daily Notes/技术发现/解决方案）
     - 对话顶部添加"保存对话到记忆"按钮
     - 键盘快捷键: `Ctrl+Shift+M` 保存最后 AI 消息, `Ctrl+Shift+S` 保存对话
     - 保存成功/失败提示
   - 新增 `scripts/test-memory-save.js` - 测试脚本（6 个测试全部通过）
   - **功能状态**: Phase 6 完成，AI 对话可一键保存到永久记忆

7. **Clawdbot 永久记忆集成 Phase 6 (UI 集成)** (2026-02-02):
   - 新建 `src/renderer/stores/memory.js` - Pinia 状态管理（~350 行）
     - 完整的 IPC 调用封装
     - Daily Notes、MEMORY.md、混合搜索状态管理
     - 索引统计和缓存管理
   - 新建 `src/renderer/components/memory/` 组件目录
     - `PermanentMemoryPanel.vue` - 主面板组件（统计卡片、标签页切换）
     - `DailyNotesTimeline.vue` - Daily Notes 时间轴视图
     - `MemoryEditor.vue` - MEMORY.md 编辑器（章节跳转、追加内容）
     - `MemorySearchPanel.vue` - 混合搜索 UI（权重调整、结果展示）
     - `MemoryStatsPanel.vue` - 统计面板（Embedding 缓存、文件监听状态）
   - 新建 `src/renderer/pages/PermanentMemoryPage.vue` - 页面入口
   - 更新 `src/renderer/router/index.js` - 添加 /memory/permanent 路由
   - **功能状态**: Phase 6 完成,UI 可访问路径 /memory/permanent

8. **Clawdbot 永久记忆集成 Phase 2** (2026-02-01):
   - 新建 `bm25-search.js` - BM25 全文搜索引擎（~300 行）
     - Okapi BM25 算法实现
     - 中文/英文分词器
     - 词频 (TF) 和逆文档频率 (IDF) 计算
     - 可调参数: k1=1.5, b=0.75
   - 新建 `hybrid-search-engine.js` - 混合搜索引擎（~330 行）
     - 结合 Vector Search (语义) 和 BM25 Search (关键词)
     - RRF (Reciprocal Rank Fusion) 融合算法
     - 权重动态调整 (默认 Vector 0.6 + BM25 0.4)
     - 并行执行双路搜索
   - 更新 `permanent-memory-manager.js` - 集成混合搜索（+160 行）
     - searchMemory() 混合搜索方法
     - simpleSearch() 回退搜索
     - getDailyNotesDocuments() 文档获取
     - getMemoryDocument() MEMORY.md 获取
   - 更新 `permanent-memory-ipc.js` - 添加搜索 IPC 通道
     - memory:search 混合搜索通道
   - 新建 `test-hybrid-search.js` - 测试脚本（~340 行）
     - 8 个测试场景全部通过 ✅
     - 验证 BM25 关键词匹配
     - 验证混合搜索融合
     - 验证权重调整
     - 搜索延迟 < 20ms
   - 安装依赖: natural (自然语言处理库)
   - **功能状态**: Phase 2 完成,支持混合搜索 (Vector + BM25)

9. **Clawdbot 永久记忆集成 Phase 1** (2026-02-01):
   - 新建 `009_embedding_cache.sql` - 数据库迁移（~180 行）
     - embedding_cache 表 (Embedding 缓存)
     - memory_file_hashes 表 (文件 Hash 跟踪)
     - daily_notes_metadata 表 (Daily Notes 元数据)
     - memory_sections 表 (MEMORY.md 分类)
     - memory_stats 表 (记忆统计)
   - 新建 `permanent-memory-manager.js` - 核心管理器（~650 行）
     - Daily Notes 自动记录 (memory/daily/YYYY-MM-DD.md)
     - MEMORY.md 长期知识萃取
     - 元数据自动解析和统计
     - 文件 Hash 计算和缓存
     - 过期 Daily Notes 自动清理
   - 新建 `permanent-memory-ipc.js` - IPC 处理器（~130 行）
     - 7 个 IPC 通道：write-daily-note、read-daily-note、read-memory、append-to-memory 等
   - 新建 `test-permanent-memory.js` - 测试脚本（~380 行）
     - 10 个测试用例全部通过 ✅
     - 验证 Daily Notes 写入/读取
     - 验证 MEMORY.md 追加
     - 验证元数据解析和统计
   - 集成到主应用
     - 更新 `ipc-registry.js` - 添加 PermanentMemory IPC 注册
     - 更新 `core-initializer.js` - 添加 permanentMemoryManager 初始化
   - 新建 `docs/features/PERMANENT_MEMORY_INTEGRATION.md` - 技术方案文档（~1400 行）
     - 7 个 Phase 实施计划
     - 核心功能设计
     - 技术细节和代码示例
     - 测试计划
   - **功能状态**: Phase 1 完成,支持 Daily Notes 和 MEMORY.md 基础功能

10. **Android P2P 网络心跳和自动重连** (2026-01-20):
    - 新建 HeartbeatManager.kt - 心跳管理器（~300 行）
      - 15 秒心跳间隔，35 秒连接超时
      - 设备注册/注销、心跳记录
      - 连接超时检测和事件发送
      - 指数退避重连延迟（2s, 4s, 8s, 16s, 32s, 60s max）
      - 最多 5 次重连尝试
    - 新建 AutoReconnectManager.kt - 自动重连管理器（~280 行）
      - 设备信息缓存用于重连
      - 重连任务队列和调度
      - 暂停/恢复重连能力
      - 重连状态事件发送
    - 更新 SignalingClient.kt - 信令超时处理
      - 连接超时 10 秒
      - Socket 读取超时 30 秒
      - 自动重连（最多 3 次）
      - 连接状态流和事件流
    - 更新 P2PConnectionManager.kt - 集成心跳和重连
      - 心跳消息自动处理
      - 连接断开自动触发重连
      - 设备状态查询 API
    - 新建 P2PNetworkModule.kt - 依赖注入配置
    - 新建 HeartbeatManagerTest.kt（18 个测试用例）
    - 新建 AutoReconnectManagerTest.kt（18 个测试用例）
    - 新建 SignalingClientTest.kt（14 个测试用例）
    - Android core-p2p 模块完成度升至 90%

11. **iOS 图片消息和群组聊天** (2026-01-20):
    - P2PViewModel 扩展 - ChatMessage 支持图片数据（imageData、thumbnailData、imageSize）
    - 新增 sendImageMessages/sendImageMessage 方法 - 图片压缩、Base64 编码
    - P2PChatView 图片发送集成 - sendImages 函数完整实现
    - ImageMessageView 组件 - 异步加载、尺寸计算、点击放大
    - ImageViewerOverlay 组件 - 全屏查看、缩放平移、保存/分享
    - MultipleImagesMessageView 组件 - 多图网格布局
    - EnhancedMessageBubble 支持图片 - isImageMessage 判断、图片上下文菜单
    - P2PMessageRepository 群组支持 - getGroupConversations、createGroupConversation、addGroupMember、removeGroupMember
    - GroupChatView 完整视图 - 成员头像栏、消息列表、输入栏
    - GroupChatViewModel 逻辑 - 群组创建、成员管理、消息发送
    - GroupMessageBubble 组件 - 显示发送者名称和头像
    - GroupSettingsView - 群组设置、成员列表、退出群组
    - AddMemberView - 添加新成员
    - iOS 版本升级至 v0.2.7，完成度 88%

12. **PC 端 IPC 错误处理优化** (2026-01-20):
    - 修复 social.js 通知加载无限重试问题（添加 MAX_RETRIES 限制）
    - 修复 GlobalSettingsWizard.vue 配置加载失败（添加默认值回退）
    - 修复插件系统 IPC 错误处理（PluginSlot.vue, usePluginExtensions.js）
    - 修复 MCP 设置 IPC 错误处理（MCPSettings.vue）
    - 修复 LoginPage.vue 数据同步和窗口最大化错误
    - 修复 project.js 项目同步错误处理
    - 修复 PluginManagement.vue、PluginMarketplace.vue 插件列表加载
    - 修复 conversation.js、AIChatPage.vue 对话列表加载
    - 所有修复统一采用：IPC 未就绪时静默处理，避免控制台错误刷屏

13. **Android 离线消息队列** (2026-01-20):
    - 新建 OfflineQueueEntity.kt - 离线消息实体
    - 新建 OfflineQueueDao.kt - 数据访问层（~200 行）
    - 新建 OfflineMessageQueue.kt - 队列管理器（~300 行）
    - 支持指数退避重试（1s, 2s, 5s, 10s, 30s）
    - 支持消息优先级（HIGH, NORMAL, LOW）
    - 支持过期消息自动清理
    - 数据库迁移 v3→v4
    - Android 版本升级至 v0.5.0，完成度 70%

14. **Android 单元测试** (2026-01-20):
    - 新建 OfflineMessageQueueTest.kt（26 个测试用例）
    - 新建 P2PMessageRepositoryTest.kt（18 个测试用例）
    - 总测试用例达到 120+

15. **iOS 综合优化** (2026-01-20):
    - 新建 MessageDeliveryManager.swift（~450 行）- 消息投递可靠性管理
    - 新建 ImagePickerView.swift（~450 行）- 图片选择器组件
    - 新建 EnhancedUIComponents.swift（~500 行）- 增强 UI 组件
    - 新建 PerformanceManager.swift（~400 行）- 性能监控管理
    - P2PChatView 重构 - 集成所有优化组件
    - 消息状态动画（AnimatedMessageStatus）
    - 正在输入指示器（TypingIndicator）
    - Toast 提示系统
    - 连接状态横幅
    - 暗黑模式适配
    - 内存监控和缓存清理
    - iOS 版本升级至 v0.2.6，完成度 82%

16. **iOS 单元测试框架** (2026-01-20):
    - 新建 CoreCommonTests.swift - 通用工具测试
    - 新建 CoreSecurityTests.swift - 安全加密测试
    - 新建 CoreDatabaseTests.swift - 数据库操作测试
    - 新建 CoreDIDTests.swift - DID 身份测试
    - 新建 CoreE2EETests.swift - 端到端加密测试
    - 新建 CoreP2PTests.swift - P2P 网络测试

17. **iOS 向量数据库持久化** (2026-01-20):
    - 新建 VectorStoreRepository.swift（~400 行）
    - SQLite 存储 embeddings（BLOB 编码）
    - Embedding 缓存支持过期机制
    - 余弦相似度搜索实现
    - VectorStore 集成持久化层

18. **iOS 离线消息队列** (2026-01-20):
    - 新建 OfflineMessageQueue.swift（~400 行）
    - 离线消息持久化到 SQLite
    - 指数退避重试机制
    - 消息优先级队列
    - P2PManager 集成离线队列

19. **iOS P2P 消息系统增强** (2026-01-20):
    - 新建 P2PMessageRepository.swift（~400 行）
    - 新建 P2PContactRepository.swift（~350 行）
    - 增强 SignalProtocolManager Double Ratchet 实现
    - 添加自动重连机制（指数退避）
    - P2PViewModel 消息持久化支持

20. **iOS AI 对话持久化** (2026-01-20):
    - 新建 AIConversationRepository.swift（~400 行）
    - 实现对话和消息的完整 CRUD 操作
    - 对话列表持久化、自动刷新统计
    - 消息历史保存、自动加载
    - 自动生成对话标题（基于首条消息）
    - Token 使用统计持久化
    - 创建对话后自动导航到聊天界面
    - 下拉刷新支持
    - iOS 版本升级至 v0.2.2，完成度 65%

21. **LLM 按模型预算限制** (2026-01-18):
    - 新建 LLMModelBudgetPanel.vue 组件（588 行）
    - 支持按模型设置日/周/月预算限额（USD）
    - 进度条显示当前支出 vs 限额
    - 支持启用/禁用、超限告警、超限阻止选项
    - 支持 8 个提供商：Ollama、OpenAI、Anthropic、DeepSeek、火山引擎、阿里云、智谱AI、Moonshot
    - 集成到 LLM Performance Dashboard
    - 后端已有：llm_model_budgets 表、IPC 通道
22. **SessionManager 前端 UI 增强** (2026-01-18):
    - 会话预览 Popover：悬停 0.5 秒显示摘要、最近消息、标签、时间
    - 键盘快捷键：Ctrl+F/A/D/E、Delete、Escape、? 帮助
    - 会话复制：深拷贝会话及消息、标签，标题加"- 副本"后缀
    - 标签管理页面：/tags 路由，支持重命名、合并、删除、批量操作
    - 新建 SessionPreviewCard.vue、TagManagerPage.vue
    - 修改 SessionList.vue、SessionManagerPage.vue、router/index.js
    - 新增 6 个 IPC 通道（duplicate、rename-tag、merge-tags、delete-tag 等）
23. **应用启动稳定性修复** (2026-01-18):
    - 修复 UnifiedConfigManager EISDIR 错误（config.json/rules.md 被错误创建为目录）
    - 修复 MobileBridge 信令服务器连接失败阻塞后续初始化的问题
    - 清理 desktop-app-vue/.chainlesschain/ 下错误创建的目录
24. **SessionManager v0.21.0 增强** (2026-01-16):
    - 会话搜索：按标题和内容全文搜索
    - 标签系统：添加/移除标签、按标签过滤
    - 导出/导入：JSON 和 Markdown 格式导出、JSON 导入
    - 智能摘要：LLM 或简单模式生成摘要
    - 会话续接：上下文恢复和续接提示
    - 会话模板：保存/使用模板快速创建会话
    - 批量操作：批量删除、批量标签、批量导出
    - 全局统计：跨会话统计分析
    - 新增 20+ IPC 通道
    - 新增数据库迁移 008_session_templates.sql
    - 更新测试脚本（13 项测试）
25. ErrorMonitor 增强：添加了 `optimizeSQLiteForConcurrency()`、`releaseDatabaseLock()`、`attemptServiceReconnection()` 等实际修复方法
26. Session 压缩测试：压缩率 0.76-0.93，节省 7-24% Token
27. Memory Bank 系统：创建了 CLAUDE-patterns.md、CLAUDE-decisions.md、CLAUDE-troubleshooting.md

### 待处理

- [x] LLM Performance Dashboard UI 完善 ✅ 按模型预算已完成
- [x] SessionManager 前端 UI 组件（会话管理页面）✅ 已完成
- [x] 增强 .chainlesschain/memory/ 目录实际使用 ✅ SemanticChunker + AdvancedMemorySearch + MemoryAnalytics
- [x] MCP 端到端集成测试 ✅ 31 测试全部通过

---

## 关键文件修改记录

### 本次会话修改 (2026-01-20) - Android P2P 网络

| 文件                          | 修改类型 | 说明                                           |
| ----------------------------- | -------- | ---------------------------------------------- |
| `HeartbeatManager.kt`         | 新建     | 心跳管理器（心跳发送、超时检测、重连策略）     |
| `AutoReconnectManager.kt`     | 新建     | 自动重连管理器（设备缓存、任务调度、状态事件） |
| `P2PConnectionManager.kt`     | 修改     | 集成心跳和自动重连、连接状态管理               |
| `SignalingClient.kt`          | 修改     | 添加连接/读取超时、自动重连、状态流            |
| `P2PNetworkModule.kt`         | 新建     | core-p2p 模块依赖注入配置                      |
| `HeartbeatManagerTest.kt`     | 新建     | 心跳管理器单元测试（18 个用例）                |
| `AutoReconnectManagerTest.kt` | 新建     | 自动重连管理器单元测试（18 个用例）            |
| `SignalingClientTest.kt`      | 新建     | 信令客户端单元测试（14 个用例）                |
| `CLAUDE-activeContext.md`     | 更新     | 记录 P2P 网络优化进展                          |

### 上次会话修改 (2026-01-20) - PC 端 IPC 优化

| 文件                            | 修改类型 | 说明                                           |
| ------------------------------- | -------- | ---------------------------------------------- |
| `stores/social.js`              | 修改     | 添加 MAX_RETRIES 限制，防止无限重试            |
| `GlobalSettingsWizard.vue`      | 修改     | 添加 IPC 未就绪时的默认值回退                  |
| `plugins/PluginSlot.vue`        | 修改     | IPC 未就绪时静默返回空数组                     |
| `usePluginExtensions.js`        | 修改     | 改进 getPluginMenuItems/usePluginSlot 错误处理 |
| `MCPSettings.vue`               | 修改     | IPC 未就绪时静默处理路径和配置加载             |
| `LoginPage.vue`                 | 修改     | 数据同步和窗口最大化失败时静默处理             |
| `stores/project.js`             | 修改     | 项目同步 IPC 未就绪时静默返回                  |
| `settings/PluginManagement.vue` | 修改     | 插件列表加载失败时静默处理                     |
| `PluginMarketplace.vue`         | 修改     | IPC 未就绪时静默使用模拟数据                   |
| `stores/conversation.js`        | 修改     | 对话列表加载 IPC 未就绪时静默处理              |
| `AIChatPage.vue`                | 修改     | 对话列表加载添加 API 检查和错误处理            |
| `CLAUDE-activeContext.md`       | 更新     | 记录 IPC 优化修改                              |

### 上次会话修改 (2026-01-20) - Android

| 文件                          | 修改类型 | 说明                                         |
| ----------------------------- | -------- | -------------------------------------------- |
| `OfflineQueueEntity.kt`       | 新建     | 离线消息实体定义（含优先级、重试、过期支持） |
| `OfflineQueueDao.kt`          | 新建     | 离线队列数据访问层（~200 行）                |
| `OfflineMessageQueue.kt`      | 新建     | 离线队列管理器（~300 行）                    |
| `DatabaseMigrations.kt`       | 修改     | 添加 v3→v4 迁移（离线队列表）                |
| `ChainlessChainDatabase.kt`   | 修改     | 添加 OfflineQueueEntity 和 DAO               |
| `DatabaseModule.kt`           | 修改     | 添加 OfflineQueueDao 依赖注入                |
| `P2PModule.kt`                | 修改     | 添加 OfflineMessageQueue 依赖注入            |
| `OfflineMessageQueueTest.kt`  | 新建     | 离线队列单元测试（26 个用例）                |
| `P2PMessageRepositoryTest.kt` | 新建     | P2P 消息仓库单元测试（18 个用例）            |
| `README.md` (android-app)     | 更新     | 更新版本至 v0.5.0，完成度 70%，添加 Phase 5  |
| `CLAUDE-activeContext.md`     | 更新     | 记录 Android 优化进展                        |

### 上次会话修改 (2026-01-20) - iOS

| 文件                           | 修改类型 | 说明                          |
| ------------------------------ | -------- | ----------------------------- |
| `MessageDeliveryManager.swift` | 新建     | 消息投递可靠性管理（~450 行） |
| `ImagePickerView.swift`        | 新建     | 图片选择器组件（~450 行）     |
| `EnhancedUIComponents.swift`   | 新建     | 增强 UI 组件集合（~500 行）   |
| `PerformanceManager.swift`     | 新建     | 性能监控管理器（~400 行）     |
| `P2PChatView.swift`            | 修改     | 集成优化组件、暗黑模式、动画  |
| `PROJECT_STATUS.md`            | 更新     | 更新版本至 v0.2.6，完成度 82% |

### 历史修改 (2026-01-20 早期) - iOS

| 文件                          | 修改类型 | 说明                          |
| ----------------------------- | -------- | ----------------------------- |
| `VectorStoreRepository.swift` | 新建     | 向量存储持久化仓储（~400 行） |
| `VectorStore.swift`           | 修改     | 集成持久化层，SQLite 存储     |
| `OfflineMessageQueue.swift`   | 新建     | 离线消息队列管理（~400 行）   |
| `P2PManager.swift`            | 修改     | 集成离线消息队列              |
| `CoreCommonTests.swift`       | 新建     | 通用工具单元测试              |
| `CoreSecurityTests.swift`     | 新建     | 安全加密单元测试              |
| `CoreDatabaseTests.swift`     | 新建     | 数据库操作单元测试            |
| `CoreDIDTests.swift`          | 新建     | DID 身份单元测试              |
| `CoreE2EETests.swift`         | 新建     | 端到端加密单元测试            |
| `CoreP2PTests.swift`          | 新建     | P2P 网络单元测试              |

### 历史修改 (2026-01-20 早期)

| 文件                             | 修改类型 | 说明                          |
| -------------------------------- | -------- | ----------------------------- |
| `AIConversationRepository.swift` | 新建     | AI 对话数据仓储（~400 行）    |
| `AIChatView.swift`               | 修改     | 支持消息持久化、自动标题生成  |
| `AIConversationListView.swift`   | 修改     | 支持对话列表持久化、刷新统计  |
| `P2PMessageRepository.swift`     | 新建     | P2P 消息数据仓储（~400 行）   |
| `P2PContactRepository.swift`     | 新建     | P2P 联系人数据仓储（~350 行） |
| `P2PManager.swift`               | 修改     | 添加自动重连机制              |
| `SignalProtocolManager.swift`    | 修改     | 增强 Double Ratchet 实现      |
| `P2PViewModel.swift`             | 修改     | 集成消息持久化                |

### 历史修改 (2026-01-18)

| 文件                        | 修改类型 | 说明                                      |
| --------------------------- | -------- | ----------------------------------------- |
| `LLMModelBudgetPanel.vue`   | 新建     | 按模型预算限制组件（588 行）              |
| `llm-performance/index.js`  | 修改     | 导出 LLMModelBudgetPanel                  |
| `LLMPerformancePage.vue`    | 修改     | 集成按模型预算面板                        |
| `session-manager.js`        | 新增     | duplicateSession、renameTag、mergeTags 等 |
| `session-manager-ipc.js`    | 新增     | 6 个新 IPC 通道                           |
| `stores/session.js`         | 新增     | 对应 store actions                        |
| `SessionPreviewCard.vue`    | 新建     | 会话预览卡片组件                          |
| `SessionList.vue`           | 修改     | 添加悬停预览和复制按钮                    |
| `SessionManagerPage.vue`    | 修改     | 添加键盘快捷键和帮助模态框                |
| `TagManagerPage.vue`        | 新建     | 标签管理独立页面                          |
| `router/index.js`           | 修改     | 添加 /tags 路由                           |
| `unified-config-manager.js` | 修复     | 防止将 config.json/rules.md 创建为目录    |
| `index.js`                  | 修复     | 信令服务器连接失败时不阻塞后续初始化      |

---

## 项目当前状态

### 版本信息

- **当前版本**: v0.16.0
- **进度**: 95% 完成
- **主要应用**: desktop-app-vue (Electron + Vue3)

### 核心模块状态

| 模块       | 状态        | 说明                     |
| ---------- | ----------- | ------------------------ |
| 知识库管理 | ✅ 生产就绪 | RAG 搜索、Markdown 编辑  |
| LLM 集成   | ✅ 可用     | 14+ 提供商、本地 Ollama  |
| P2P 通信   | ⚠️ 测试中   | Signal Protocol E2E 加密 |
| 交易系统   | ⚠️ 开发中   | 6 模块部分完成           |
| MCP 集成   | 🔬 POC      | Filesystem, SQLite, Git  |

### 依赖服务

| 服务       | 端口  | 状态         |
| ---------- | ----- | ------------ |
| Ollama     | 11434 | 本地模型推理 |
| Qdrant     | 6333  | 向量数据库   |
| PostgreSQL | 5432  | 后端数据库   |
| Redis      | 6379  | 缓存         |
| Signaling  | 9001  | P2P 信令     |

---

## 技术债务

### 高优先级

1. ~~**MyBatis Plus 升级**: 已完成升级到 3.5.9 ✅~~
2. ~~**Pre-commit Hooks**: Husky v9 + lint-staged 配置完成 ✅~~

### 中优先级

1. **测试覆盖率**: 核心模块覆盖率需达到 80%
2. **TypeScript 迁移**: 渲染进程迁移到 TypeScript

### 低优先级

1. **文档国际化**: 英文文档需要更新
2. **移动端**: uni-app 版本仅 10% 完成

---

## 环境配置

### 开发环境

```bash
# 启动开发服务器
cd desktop-app-vue
npm run dev

# 启动 Docker 服务
docker-compose up -d

# 拉取 LLM 模型
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

### 测试命令

```bash
npm run test:db      # 数据库测试
npm run test:ukey    # U-Key 测试
npm run test:session # Session 压缩测试
```

---

## 会话上下文（AI 助手使用）

### 用户偏好

- 使用中文交流
- 偏好简洁的代码风格
- 重视安全性和性能

### 重要约定

- 数据库操作必须使用参数化查询
- P2P 消息必须 E2E 加密
- LLM 调用优先使用本地 Ollama

### 常用路径

- 主应用: `desktop-app-vue/`
- 数据库: `desktop-app-vue/src/main/database.js`
- LLM 管理: `desktop-app-vue/src/main/llm/`
- 错误监控: `desktop-app-vue/src/main/error-monitor.js`
- 配置目录: `.chainlesschain/`

---

## 更新日志

### 2026-01-18

- **LLM 按模型预算限制**:
  - 新建 LLMModelBudgetPanel.vue 组件
  - 支持设置日/周/月预算限额（USD）
  - 支持 8 个 LLM 提供商
  - 支持超限告警和超限阻止
  - 集成到 LLM Performance Dashboard
- **SessionManager 前端 UI 增强**:
  - 新增会话预览 Popover（悬停显示摘要、消息、标签）
  - 新增键盘快捷键（Ctrl+F/A/D/E、Delete、Escape、?）
  - 新增会话复制功能（深拷贝消息和标签）
  - 新增标签管理页面（/tags，支持重命名、合并、删除）
  - 新建 SessionPreviewCard.vue、TagManagerPage.vue
  - 新增 6 个 IPC 通道
- 修复 UnifiedConfigManager EISDIR 错误（文件路径被错误创建为目录）
- 修复 MobileBridge 信令服务器连接失败阻塞后续初始化
- 清理 `desktop-app-vue/.chainlesschain/` 下错误创建的目录
- 应用启动稳定性提升

### 2026-01-17

- 验证 Pre-commit Hooks 配置完整性
- 确认 Husky v9.1.7 + lint-staged v16.2.7 正常工作
- 所有 git hooks 可用：pre-commit、commit-msg、pre-push

### 2026-01-16

- 创建 Memory Bank 系统文件
- 增强 ErrorMonitor 自动修复功能
- 验证 Session 压缩效果（压缩率 0.76-0.93）

---

**说明**: 此文件在每次开发会话结束时更新，记录当前工作状态和上下文。
