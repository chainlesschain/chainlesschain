# ChainlessChain 当前会话上下文

> 记录当前开发会话的状态和上下文，帮助 AI 助手快速了解工作进度
>
> **最后更新**: 2026-01-20 (PC 端 IPC 错误处理优化)

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
- [x] Android 端 P2P 聊天界面完善
- [x] Android 端 LLM 适配器（DeepSeek、Ollama）
- [x] Android 端离线消息队列
- [x] Android 端单元测试增强
- [x] PC 端 IPC 错误处理优化（无限重试、静默失败）

### 最近完成

1. **PC 端 IPC 错误处理优化** (2026-01-20):
   - 修复 social.js 通知加载无限重试问题（添加 MAX_RETRIES 限制）
   - 修复 GlobalSettingsWizard.vue 配置加载失败（添加默认值回退）
   - 修复插件系统 IPC 错误处理（PluginSlot.vue, usePluginExtensions.js）
   - 修复 MCP 设置 IPC 错误处理（MCPSettings.vue）
   - 修复 LoginPage.vue 数据同步和窗口最大化错误
   - 修复 project.js 项目同步错误处理
   - 修复 PluginManagement.vue、PluginMarketplace.vue 插件列表加载
   - 修复 conversation.js、AIChatPage.vue 对话列表加载
   - 所有修复统一采用：IPC 未就绪时静默处理，避免控制台错误刷屏

2. **Android 离线消息队列** (2026-01-20):
   - 新建 OfflineQueueEntity.kt - 离线消息实体
   - 新建 OfflineQueueDao.kt - 数据访问层（~200 行）
   - 新建 OfflineMessageQueue.kt - 队列管理器（~300 行）
   - 支持指数退避重试（1s, 2s, 5s, 10s, 30s）
   - 支持消息优先级（HIGH, NORMAL, LOW）
   - 支持过期消息自动清理
   - 数据库迁移 v3→v4
   - Android 版本升级至 v0.5.0，完成度 70%

3. **Android 单元测试** (2026-01-20):
   - 新建 OfflineMessageQueueTest.kt（26 个测试用例）
   - 新建 P2PMessageRepositoryTest.kt（18 个测试用例）
   - 总测试用例达到 120+

4. **iOS 综合优化** (2026-01-20):
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

5. **iOS 单元测试框架** (2026-01-20):
   - 新建 CoreCommonTests.swift - 通用工具测试
   - 新建 CoreSecurityTests.swift - 安全加密测试
   - 新建 CoreDatabaseTests.swift - 数据库操作测试
   - 新建 CoreDIDTests.swift - DID 身份测试
   - 新建 CoreE2EETests.swift - 端到端加密测试
   - 新建 CoreP2PTests.swift - P2P 网络测试

6. **iOS 向量数据库持久化** (2026-01-20):
   - 新建 VectorStoreRepository.swift（~400 行）
   - SQLite 存储 embeddings（BLOB 编码）
   - Embedding 缓存支持过期机制
   - 余弦相似度搜索实现
   - VectorStore 集成持久化层

7. **iOS 离线消息队列** (2026-01-20):
   - 新建 OfflineMessageQueue.swift（~400 行）
   - 离线消息持久化到 SQLite
   - 指数退避重试机制
   - 消息优先级队列
   - P2PManager 集成离线队列

8. **iOS P2P 消息系统增强** (2026-01-20):
   - 新建 P2PMessageRepository.swift（~400 行）
   - 新建 P2PContactRepository.swift（~350 行）
   - 增强 SignalProtocolManager Double Ratchet 实现
   - 添加自动重连机制（指数退避）
   - P2PViewModel 消息持久化支持

9. **iOS AI 对话持久化** (2026-01-20):
   - 新建 AIConversationRepository.swift（~400 行）
   - 实现对话和消息的完整 CRUD 操作
   - 对话列表持久化、自动刷新统计
   - 消息历史保存、自动加载
   - 自动生成对话标题（基于首条消息）
   - Token 使用统计持久化
   - 创建对话后自动导航到聊天界面
   - 下拉刷新支持
   - iOS 版本升级至 v0.2.2，完成度 65%

10. **LLM 按模型预算限制** (2026-01-18):
    - 新建 LLMModelBudgetPanel.vue 组件（588 行）
    - 支持按模型设置日/周/月预算限额（USD）
    - 进度条显示当前支出 vs 限额
    - 支持启用/禁用、超限告警、超限阻止选项
    - 支持 8 个提供商：Ollama、OpenAI、Anthropic、DeepSeek、火山引擎、阿里云、智谱AI、Moonshot
    - 集成到 LLM Performance Dashboard
    - 后端已有：llm_model_budgets 表、IPC 通道
11. **SessionManager 前端 UI 增强** (2026-01-18):
    - 会话预览 Popover：悬停 0.5 秒显示摘要、最近消息、标签、时间
    - 键盘快捷键：Ctrl+F/A/D/E、Delete、Escape、? 帮助
    - 会话复制：深拷贝会话及消息、标签，标题加"- 副本"后缀
    - 标签管理页面：/tags 路由，支持重命名、合并、删除、批量操作
    - 新建 SessionPreviewCard.vue、TagManagerPage.vue
    - 修改 SessionList.vue、SessionManagerPage.vue、router/index.js
    - 新增 6 个 IPC 通道（duplicate、rename-tag、merge-tags、delete-tag 等）
12. **应用启动稳定性修复** (2026-01-18):
    - 修复 UnifiedConfigManager EISDIR 错误（config.json/rules.md 被错误创建为目录）
    - 修复 MobileBridge 信令服务器连接失败阻塞后续初始化的问题
    - 清理 desktop-app-vue/.chainlesschain/ 下错误创建的目录
13. **SessionManager v0.21.0 增强** (2026-01-16):
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
14. ErrorMonitor 增强：添加了 `optimizeSQLiteForConcurrency()`、`releaseDatabaseLock()`、`attemptServiceReconnection()` 等实际修复方法
15. Session 压缩测试：压缩率 0.76-0.93，节省 7-24% Token
16. Memory Bank 系统：创建了 CLAUDE-patterns.md、CLAUDE-decisions.md、CLAUDE-troubleshooting.md

### 待处理

- [x] LLM Performance Dashboard UI 完善 ✅ 按模型预算已完成
- [x] SessionManager 前端 UI 组件（会话管理页面）✅ 已完成
- [ ] 增强 .chainlesschain/memory/ 目录实际使用

---

## 关键文件修改记录

### 本次会话修改 (2026-01-20) - PC 端 IPC 优化

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
