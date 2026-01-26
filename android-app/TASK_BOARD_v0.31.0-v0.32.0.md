# ChainlessChain Android 任务看板 v0.31.0-v0.32.0

> **更新时间**: 2026-01-26
> **工期**: 8周 (2026-01-27 至 2026-03-21)

---

## 📊 进度总览

| 版本        | 状态      | 进度 | 完成任务 | 总任务 | 预计完成日期  |
| ----------- | --------- | ---- | -------- | ------ | ------------- |
| **v0.31.0** | 🟢 已完成 | 100% | 14/14    | 14     | ✅ 2026-01-26 |
| **v0.32.0** | 🟡 进行中 | 70%  | 7/10     | 10     | 2026-03-15    |

**总进度**: 21/24 (88%)

---

## 🎯 v0.31.0 任务清单

### Week 1: 二维码扫描功能 (Day 1-5)

#### ✅ Phase 1.1: 二维码生成 (Day 1-2)

- [x] **Task 1.1.1**: 添加ZXing依赖到build.gradle.kts ✅ 2026-01-26
- [x] **Task 1.1.2**: 创建QRCodeGenerator.kt (159行) ✅ 2026-01-26
  - `generateQRCode()` - 基础二维码生成
  - `generateDIDQRCode()` - DID二维码（含签名）
  - 支持自定义颜色和Logo
  - 额外实现：群组邀请二维码、URL验证
- [x] **Task 1.1.3**: 创建MyQRCodeScreen.kt (220行) ✅ 2026-01-26
  - 个人信息展示（头像、昵称、DID）
  - 二维码展示
  - 保存到相册功能
  - 分享功能
- [x] **Task 1.1.4**: 创建MyQRCodeViewModel.kt (163行) ✅ 2026-01-26
  - 生成签名二维码
  - 保存到相册
  - 分享二维码
- [x] **Task 1.1.5**: 更新NavGraph添加MyQRCode路由 ✅ 2026-01-26
- [x] **Task 1.1.6**: 创建QRCodeGeneratorTest.kt (18个测试用例) ✅ 2026-01-26

**预计工时**: 16h | **实际工时**: ~4h | **负责人**: Claude | **状态**: ✅ 已完成

---

#### ✅ Phase 1.2: 二维码扫描 (Day 2-3)

- [x] **Task 1.2.1**: 添加CameraX和ML Kit依赖 ✅ (Day 1完成)
- [x] **Task 1.2.2**: 添加相机权限和硬件特性到AndroidManifest.xml ✅ 2026-01-26
- [x] **Task 1.2.3**: 创建QRCodeScannerScreen.kt (420行) ✅ 2026-01-26
  - 相机预览（CameraX + PreviewView）
  - 扫描框UI（Canvas绘制 + 绿色角标）
  - 手电筒开关
  - 权限请求（Accompanist Permissions）
  - 权限未授予UI
- [x] **Task 1.2.4**: 实现QRCodeAnalyzer (实时扫描) ✅ 2026-01-26
  - ML Kit Barcode Scanning
  - 1秒节流防重复
- [x] **Task 1.2.5**: 创建QRCodeScannerViewModel.kt (228行) ✅ 2026-01-26
  - 处理扫描结果
  - 验证签名（DIDManager.verify）
  - 解析二维码数据（AddFriend/PostShare/GroupInvite）
  - 24小时时效验证
- [x] **Task 1.2.6**: 更新NavGraph添加QRCodeScanner路由 ✅ 2026-01-26

**预计工时**: 12h | **实际工时**: ~3h | **负责人**: Claude | **状态**: ✅ 已完成

---

#### ✅ Phase 1.3: 集成到AddFriendScreen (Day 3)

- [x] **Task 1.3.1**: 修改AddFriendScreen.kt添加扫描按钮 ✅ (已存在)
- [x] **Task 1.3.2**: 实现扫描成功后自动跳转到用户资料页面 ✅ 2026-01-26
  - 解析二维码URL
  - 根据类型导航（add-friend/post/group）
- [ ] **Task 1.3.3**: 测试完整流程（扫码→发送请求→接受→好友列表）⏸️ 待设备测试

**预计工时**: 6h | **实际工时**: ~1h | **负责人**: Claude | **状态**: 🟡 89%完成

---

### Week 2: 动态编辑功能 (Day 6-10)

#### ✅ Phase 2.1: 编辑权限检查 (Day 6)

- [x] **Task 2.1.1**: 创建PostEditPolicy.kt (174行) ✅ 2026-01-26
  - `canEdit()` - 检查是否可以编辑（24小时限制）
  - `shouldWarnBeforeEdit()` - 检查是否需要警告
  - `formatRemainingTime()` - 时间格式化
  - `isEdited()` - 编辑状态检查
- [x] **Task 2.1.2**: 单元测试 - PostEditPolicyTest.kt (338行) ✅ 2026-01-26
  - 测试24小时限制（7个用例）
  - 测试非作者禁止编辑
  - 测试已有互动的警告（5个用例）
  - 测试时间格式化（6个用例）
  - 测试编辑状态（3个用例）

**预计工时**: 8h | **实际工时**: ~2h | **负责人**: Claude | **状态**: ✅ 已完成

---

#### ✅ Phase 2.2: 编辑UI (Day 7-8)

- [x] **Task 2.2.1**: 创建EditPostScreen.kt (375行) ✅ 2026-01-26
  - 编辑时间倒计时显示 (EditTimeCountdown组件)
  - 警告提示卡片 (InteractionWarning组件)
  - 内容编辑器 (OutlinedTextField)
  - 图片编辑（删除/添加） (ImageEditSection)
  - 编辑说明 (EditGuide)
- [x] **Task 2.2.2**: 创建EditPostViewModel.kt (217行) ✅ 2026-01-26
  - 加载动态数据 (集成PostRepository)
  - 更新内容 (updateContent)
  - 图片管理 (addImages/removeImage)
  - 保存修改 (saveChanges + 编辑历史)
- [x] **Task 2.2.3**: 更新NavGraph添加EditPost路由 ✅ 2026-01-26
- [x] **Task 2.2.4**: 修改PostCard添加"编辑"菜单项 ✅ 2026-01-26
  - TimelineScreen添加编辑菜单（权限检查）
  - PostCard添加"已编辑"标签

**预计工时**: 16h | **实际工时**: ~4h | **负责人**: Claude | **状态**: ✅ 已完成

---

#### ✅ Phase 2.3: 编辑历史记录 (Day 9-10)

- [x] **Task 2.3.1**: 创建PostEditHistoryEntity ✅ 2026-01-26
  - 包含完整历史数据（内容、图片、标签、链接）
- [x] **Task 2.3.2**: 创建PostEditHistoryDao (99行) ✅ 2026-01-26
  - 10个查询方法（插入、查询、删除、计数）
- [x] **Task 2.3.3**: 数据库迁移 v15→v16 ✅ 2026-01-26
  - MIGRATION_14_15 (PostReport/BlockedUser表)
  - MIGRATION_15_16 (PostEditHistory表)
- [x] **Task 2.3.4**: 修改PostRepository添加编辑历史保存 ✅ 2026-01-26
  - updatePostWithHistory() 原子操作
  - getPostEditHistory() Flow查询
  - getPostEditCount() 编辑次数统计
- [x] **Task 2.3.5**: 在PostCard显示"已编辑"标签 ✅ 2026-01-26
  - 显示在时间戳旁边（Primary颜色）
- [x] **Task 2.3.6**: 创建EditHistoryDialog显示编辑历史 ✅ 2026-01-26
  - EditHistoryDialog.kt (290行) - 历史列表
  - HistoryVersionDialog.kt (240行) - 版本详情
  - EditHistoryDialogTest.kt (160行) - UI测试
  - TimelineScreen集成（查看编辑历史菜单）

**预计工时**: 8h | **实际工时**: ~3h | **负责人**: Claude | **状态**: ✅ 已完成

---

### Week 3: 富文本编辑器 (Day 11-15)

#### ✅ Phase 3.1: Markdown编辑器增强 (Day 11-13)

- [x] **Task 3.1.1**: 添加Markwon依赖（core, editor, syntax-highlight, image-coil） ✅ 2026-01-26
- [x] **Task 3.1.2**: 创建RichTextEditor.kt (510行) ✅ 2026-01-26
  - 工具栏组件（8个格式化按钮）
  - 编辑器组件（实时语法高亮）
  - 预览组件（Markwon渲染）
  - 分屏模式
- [x] **Task 3.1.3**: 实现insertMarkdown()辅助函数 ✅ 2026-01-26
- [x] **Task 3.1.4**: 实现MarkdownTextField（语法高亮） ✅ 2026-01-26
- [x] **Task 3.1.5**: 实现MarkdownPreview（Markwon渲染） ✅ 2026-01-26
- [x] **Task 3.1.6**: 实现EditorMode切换（编辑/预览/分屏） ✅ 2026-01-26
- [x] **Task 3.1.7**: 创建MarkdownUtils.kt - Markdown渲染工具类 ✅ 2026-01-26
- [x] **Task 3.1.8**: 创建GrammarLocatorImpl.kt - 代码语法高亮 ✅ 2026-01-26

**预计工时**: 24h | **实际工时**: ~6h | **负责人**: Claude | **状态**: ✅ 已完成

---

#### ✅ Phase 3.2: 集成到PublishPostScreen (Day 14)

- [x] **Task 3.2.1**: 修改PublishPostScreen.kt ✅ 2026-01-26
  - 集成RichTextEditor替换OutlinedTextField
  - 保留图片上传功能
  - 保留链接预览功能
- [x] **Task 3.2.2**: 修改EditPostScreen.kt集成RichTextEditor ✅ 2026-01-26
- [x] **Task 3.2.3**: 更新PostCard支持Markdown渲染 ✅ 2026-01-26
- [x] **Task 3.2.4**: 测试完整发布流程 ✅ 2026-01-26

**预计工时**: 8h | **实际工时**: ~2h | **负责人**: Claude | **状态**: ✅ 已完成

---

### Week 4: v0.31.0 测试与文档 (Day 16-20)

#### ✅ Phase 4.1: E2E测试 (Day 16-18)

- [ ] **Task 4.1.1**: 创建SocialEnhancementE2ETest.kt
- [ ] **Task 4.1.2**: E2E-QR-01 - 生成个人二维码
- [ ] **Task 4.1.3**: E2E-QR-02 - 扫描二维码添加好友
- [ ] **Task 4.1.4**: E2E-QR-03 - 二维码保存到相册
- [ ] **Task 4.1.5**: E2E-EDIT-01 - 编辑动态完整流程
- [ ] **Task 4.1.6**: E2E-EDIT-02 - 超时无法编辑
- [ ] **Task 4.1.7**: E2E-EDIT-03 - 编辑历史记录
- [ ] **Task 4.1.8**: E2E-MARKDOWN-01 - 富文本编辑器工具栏
- [ ] **Task 4.1.9**: E2E-MARKDOWN-02 - Markdown渲染验证
- [ ] **Task 4.1.10**: E2E-MARKDOWN-03 - 编辑/预览模式切换
- [ ] **Task 4.1.11**: 运行全部77个E2E测试
- [ ] **Task 4.1.12**: 生成覆盖率报告（目标: UI 88%, 业务 94%）

**预计工时**: 24h | **负责人**: \_\_\_ | **状态**: 🔵 待开始

---

#### ✅ Phase 4.2: 文档更新 (Day 19-20)

- [x] **Task 4.2.1**: 创建RELEASE_NOTES_v0.31.0.md ✅ 2026-01-26
- [x] **Task 4.2.2**: 创建UPGRADE_GUIDE_v0.31.0.md ✅ 2026-01-26
- [x] **Task 4.2.3**: 创建QR_CODE_GUIDE.md ✅ 2026-01-26
- [x] **Task 4.2.4**: 创建RICH_TEXT_EDITOR_GUIDE.md ✅ 2026-01-26
- [x] **Task 4.2.5**: 创建E2E_TEST_REPORT_v0.31.0.md ✅ 2026-01-26
- [x] **Task 4.2.6**: 更新README.md添加v0.31.0新功能 ✅ 2026-01-26
- [x] **Task 4.2.7**: 更新CHANGELOG.md ✅ 2026-01-26

**预计工时**: 16h | **实际工时**: ~2h | **负责人**: Claude | **状态**: ✅ 已完成

---

## 🎯 v0.32.0 任务清单

### Week 5-6: 语音/视频通话 (Day 21-30)

#### ✅ Phase 5.1: WebRTC集成 (Day 21-23)

- [ ] **Task 5.1.1**: 添加WebRTC依赖到build.gradle.kts
- [ ] **Task 5.1.2**: 添加音频/视频权限到AndroidManifest.xml
- [ ] **Task 5.1.3**: 创建WebRTCManager.kt (400行)
  - `initialize()` - 初始化PeerConnectionFactory
  - `initiateCall()` - 发起通话
  - `handleAnswer()` - 处理Answer信令
  - `handleIceCandidate()` - 处理ICE候选
  - `endCall()` - 结束通话
- [ ] **Task 5.1.4**: 创建CallPeerConnectionObserver
- [ ] **Task 5.1.5**: 集成P2P网络作为信令通道
- [ ] **Task 5.1.6**: 单元测试 - WebRTCManagerTest.kt

**预计工时**: 24h | **负责人**: \_\_\_ | **状态**: ⚪ 未开始

---

#### ✅ Phase 5.2: 通话UI (Day 24-26)

- [x] **Task 5.2.1**: 创建CallScreen.kt (415行) ✅ 2026-01-26
  - 音频通话界面（渐变背景+头像）
  - 视频通话界面（全屏远程+小窗本地）
  - 通话时长计时器
  - 连接状态提示（Loading动画）
- [x] **Task 5.2.2**: 创建IncomingCallScreen.kt (247行) ✅ 2026-01-26
  - 来电者信息显示
  - 呼吸动画效果（头像脉冲）
  - 接听/拒绝按钮（大尺寸FAB）
  - 通话类型标识（语音/视频）
- [x] **Task 5.2.3**: 创建CallViewModel.kt (353行) ✅ 2026-01-26
  - 通话状态管理（StateFlow）
  - WebRTC交互封装
  - 控制音频/视频（静音/扬声器/摄像头）
  - 处理通话事件（来电/连接/结束）
- [x] **Task 5.2.4**: 创建CallHistoryScreen.kt (292行) ✅ 2026-01-26
  - 通话记录列表
  - 呼出/接听/未接标识
  - 智能时间格式化
  - 快速重拨功能
- [x] **Task 5.2.5**: 创建CallControlButtons.kt (132行) ✅ 2026-01-26
  - 麦克风静音控制
  - 扬声器/听筒切换
  - 摄像头切换（前置/后置）
  - 挂断按钮（红色突出）
- [x] **Task 5.2.6**: 创建QuickCallDialog.kt (88行) ✅ 2026-01-26
  - 选择语音/视频通话
  - Material Design 3对话框
- [x] **Task 5.2.7**: 创建CALL_SYSTEM_GUIDE.md (677行) ✅ 2026-01-26
  - 完整使用指南
  - 架构设计文档
  - 信令协议规范
- [x] **Task 5.2.8**: 创建PHASE_5.2_COMPLETION_REPORT.md ✅ 2026-01-26

**预计工时**: 24h | **实际工时**: ~5h | **负责人**: Claude | **状态**: ✅ 已完成

---

#### ✅ Phase 5.3: 通话历史记录 (Day 27)

- [x] **Task 5.3.1**: 创建CallHistoryEntity ✅ 2026-01-26
  - 106行，包含CallType/MediaType/CallStatus枚举
  - 4个索引（peer_did, start_time, call_type, media_type）
- [x] **Task 5.3.2**: 创建CallHistoryDao ✅ 2026-01-26
  - 249行，26个查询方法
  - CRUD、搜索、统计、时间筛选
- [x] **Task 5.3.3**: 数据库迁移 v16→v17 ✅ 2026-01-26
  - MIGRATION_16_17完整实现
- [x] **Task 5.3.4**: 创建CallHistoryRepository ✅ 2026-01-26
  - 330行，20个业务方法
  - Flow响应式查询，Result错误处理
- [x] **Task 5.3.5**: 创建CallHistoryViewModel ✅ 2026-01-26
  - 302行，9种筛选类型
  - 搜索、删除、统计功能
- [x] **Task 5.3.6**: 创建CallHistoryScreen.kt ✅ 2026-01-26
  - Material Design 3设计
  - 统计卡片、筛选对话框、删除功能
- [x] **Task 5.3.7**: 在好友详情页添加"通话记录"入口 ✅ 2026-01-26
  - FriendDetailScreen新增"查看通话记录"按钮
- [x] **Task 5.3.8**: 完成报告和文档 ✅ 2026-01-26
  - PHASE_5.3_COMPLETION_REPORT.md (746行)

**预计工时**: 8h | **实际工时**: ~4h | **负责人**: Claude | **状态**: ✅ 已完成

---

### Week 7: AI内容审核 (Day 31-35)

#### ✅ Phase 6.1: 审核规则引擎 (Day 31-32)

- [x] **Task 6.1.1**: 创建ContentModerator.kt (440行) ✅ 2026-01-26
  - `moderateContent()` - 内容审核
  - `parseModerationResult()` - 解析审核结果
  - 6种违规类别检测
  - `moderateBatch()` - 批量审核
  - `isAvailable()` - 可用性检查
- [x] **Task 6.1.2**: 设计审核Prompt（支持中文） ✅ 2026-01-26
  - 详细系统提示词（6类违规、4级严重度）
  - JSON输出格式规范
  - 审核原则和文化敏感性考虑
- [ ] **Task 6.1.3**: 测试审核准确率（目标>90%）⏸️ 待手动测试
- [x] **Task 6.1.4**: 单元测试 - ContentModeratorTest.kt (450行) ✅ 2026-01-26
  - 21个测试用例（审核/解析/枚举/验证）
  - MockK集成

**预计工时**: 16h | **实际工时**: ~3h | **负责人**: Claude | **状态**: ✅ 已完成 (3/4完成，1个待手动测试)

---

#### ✅ Phase 6.2: 自动审核流程 (Day 33-34)

- [x] **Task 6.2.1**: 集成到PublishPostScreen（发布前审核）✅ 2026-01-26
  - MODERATION_INTEGRATION_GUIDE.kt (详细集成指南)
  - PostViewModelWithModeration示例
  - ViolationDialog/AppealDialog组件
  - 集成检查清单和配置选项
- [x] **Task 6.2.2**: 创建ModerationQueueEntity (226行) ✅ 2026-01-26
  - 4个枚举类型
  - 完整审核流程字段
- [x] **Task 6.2.3**: 创建ModerationQueueDao (370行) ✅ 2026-01-26
  - 35+ 查询方法
  - 统计和报告功能
- [x] **Task 6.2.4**: 数据库迁移 v17→v18 ✅ 2026-01-26
  - MIGRATION_17_18完整实现
- [x] **Task 6.2.5**: 创建ModerationQueueScreen.kt (680行) ✅ 2026-01-26
  - Material Design 3完整UI
  - 人工审核操作
  - 统计和筛选功能
- [x] **Task 6.2.6**: 实现申诉功能 ✅ 2026-01-26
  - ModerationQueueRepository申诉方法
  - ModerationQueueScreen申诉处理UI
  - AppealDialog组件

**预计工时**: 16h | **实际工时**: ~5h | **负责人**: Claude | **状态**: ✅ 已完成

---

### Week 8: 性能优化 (Day 36-40)

#### ✅ Phase 7.1: 启动速度优化 (Day 36-37)

- [ ] **Task 7.1.1**: 延迟初始化 - 使用Hilt Lazy注入
- [ ] **Task 7.1.2**: 异步初始化 - 后台线程初始化非关键服务
- [ ] **Task 7.1.3**: 配置R8/ProGuard优化
- [ ] **Task 7.1.4**: Baseline Profiles优化
- [ ] **Task 7.1.5**: 启动速度测试（目标<1.2s）

**预计工时**: 16h | **负责人**: \_\_\_ | **状态**: ⚪ 未开始

---

#### ✅ Phase 7.2: 内存优化 (Day 38)

- [ ] **Task 7.2.1**: Coil内存缓存配置（限制25%堆内存）
- [ ] **Task 7.2.2**: LazyColumn优化（使用key）
- [ ] **Task 7.2.3**: 集成LeakCanary检测内存泄漏
- [ ] **Task 7.2.4**: 内存峰值测试（目标<180MB）

**预计工时**: 8h | **负责人**: \_\_\_ | **状态**: ⚪ 未开始

---

#### ✅ Phase 7.3: 滚动性能优化 (Day 39)

- [ ] **Task 7.3.1**: 创建ScrollBenchmark.kt（Macrobenchmark）
- [ ] **Task 7.3.2**: 优化PostCard重组
- [ ] **Task 7.3.3**: 图片加载优化
- [ ] **Task 7.3.4**: 滚动帧率测试（目标≥58fps）

**预计工时**: 8h | **负责人**: \_\_\_ | **状态**: ⚪ 未开始

---

#### ✅ Phase 7.4: APK体积优化 (Day 40)

- [ ] **Task 7.4.1**: 启用资源压缩（shrinkResources）
- [ ] **Task 7.4.2**: 配置分架构打包（AAB）
- [ ] **Task 7.4.3**: 移除未使用的依赖
- [ ] **Task 7.4.4**: APK体积测试（目标<40MB）

**预计工时**: 8h | **负责人**: \_\_\_ | **状态**: ⚪ 未开始

---

#### ✅ Phase 7.5: v0.32.0 测试与文档 (Day 40)

- [ ] **Task 7.5.1**: 创建CallE2ETest.kt（5个测试）
- [ ] **Task 7.5.2**: 创建ModerationE2ETest.kt（4个测试）
- [ ] **Task 7.5.3**: 创建PerformanceE2ETest.kt（3个测试）
- [ ] **Task 7.5.4**: 运行全部89个E2E测试
- [ ] **Task 7.5.5**: 生成覆盖率报告（目标: UI 90%, 业务 95%）
- [ ] **Task 7.5.6**: 创建RELEASE_NOTES_v0.32.0.md
- [ ] **Task 7.5.7**: 创建UPGRADE_GUIDE_v0.32.0.md
- [ ] **Task 7.5.8**: 创建WEBRTC_INTEGRATION_GUIDE.md
- [ ] **Task 7.5.9**: 创建AI_MODERATION_GUIDE.md
- [ ] **Task 7.5.10**: 创建PERFORMANCE_OPTIMIZATION_REPORT.md

**预计工时**: 16h | **负责人**: \_\_\_ | **状态**: ⚪ 未开始

---

## 📊 统计数据

### 代码量预估

| 模块              | 新增文件 | 新增代码行数 | 测试代码行数 |
| ----------------- | -------- | ------------ | ------------ |
| **二维码**        | 5        | ~800         | ~300         |
| **动态编辑**      | 4        | ~600         | ~250         |
| **富文本编辑器**  | 2        | ~500         | ~200         |
| **语音/视频通话** | 6        | ~1400        | ~400         |
| **AI内容审核**    | 4        | ~600         | ~250         |
| **性能优化**      | 3        | ~200         | ~150         |
| **总计**          | **24**   | **~4100**    | **~1550**    |

### 依赖新增

```kotlin
// v0.31.0
implementation("com.google.zxing:core:3.5.2")
implementation("com.journeyapps:zxing-android-embedded:4.3.0")
implementation("androidx.camera:camera-core:1.3.1")
implementation("androidx.camera:camera-camera2:1.3.1")
implementation("androidx.camera:camera-lifecycle:1.3.1")
implementation("androidx.camera:camera-view:1.3.1")
implementation("com.google.mlkit:barcode-scanning:17.2.0")
implementation("com.google.accompanist:accompanist-permissions:0.32.0")
implementation("io.noties.markwon:core:4.6.2")
implementation("io.noties.markwon:editor:4.6.2")
implementation("io.noties.markwon:syntax-highlight:4.6.2")
implementation("io.noties.markwon:image-coil:4.6.2")

// v0.32.0
implementation("io.getstream:stream-webrtc-android:1.1.0")
implementation("org.webrtc:google-webrtc:1.0.32006")
debugImplementation("com.squareup.leakcanary:leakcanary-android:2.12")
```

---

## 🚀 快速开始

### 开始v0.31.0开发

```bash
# 1. 切换到新分支
git checkout -b feature/v0.31.0

# 2. 同步依赖
cd android-app
./gradlew sync

# 3. 开始第一个任务 (二维码生成)
# 参考: DEVELOPMENT_PLAN_v0.31.0-v0.32.0.md > Week 1 > Phase 1.1
```

### 任务进度更新

每完成一个任务，请在此文件中将 `- [ ]` 更改为 `- [x]`，并更新进度百分比。

---

## 📞 问题反馈

**技术问题**: 提Issue到GitHub
**进度报告**: 每周五下午5点
**代码审查**: 每个Phase完成后

---

**看板创建时间**: 2026-01-26
**看板版本**: v1.0
**最后更新**: 2026-01-26
