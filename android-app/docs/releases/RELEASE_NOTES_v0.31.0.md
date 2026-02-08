# ChainlessChain Android v0.31.0 发布说明

**发布日期**: 2026-01-26
**版本号**: v0.31.0
**代号**: Social Enhancement (社交增强)

---

## 🎉 新功能

### 1. 二维码名片系统 ✨

**功能亮点**：

- 🎴 **个人二维码生成**: 每个用户都有独一无二的DID二维码名片
- 📸 **扫码添加好友**: 通过摄像头扫描二维码快速添加好友，无需手动输入DID
- 💾 **保存到相册**: 一键保存个人二维码到手机相册，方便分享
- 🔐 **DID加密编码**: 二维码包含加密的DID信息，安全可靠

**技术实现**：

- 使用Google ZXing库生成和解码二维码
- 支持QR_CODE、AZTEC、DATA_MATRIX等多种格式
- 自动纠错级别：Level H（30%容错率）
- 图片尺寸：512x512像素，适配各种屏幕

**使用场景**：

- 线下活动快速加好友
- 社交媒体分享个人名片
- 打印二维码进行推广

---

### 2. 动态编辑功能 📝

**功能亮点**：

- ✏️ **24小时编辑窗口**: 发布后24小时内可以编辑动态内容
- 📊 **互动提醒**: 当动态有点赞、评论或分享时，编辑前会显示警告
- 📜 **编辑历史记录**: 保存所有编辑版本，支持查看历史内容
- ⏰ **倒计时提示**: 实时显示剩余编辑时间
- 🔒 **权限控制**: 超过编辑窗口后自动锁定，防止滥用

**编辑策略**：

```
允许编辑条件：
- 发布时间 ≤ 24小时
- 当前用户是动态作者
- 动态未被删除

警告提示条件：
- 有用户点赞（提示：已有N个点赞）
- 有用户评论（提示：已有N条评论）
- 有用户分享（提示：已被分享N次）
```

**编辑历史功能**：

- 自动记录每次编辑的时间戳
- 保存修改前的内容快照
- 支持对比查看不同版本
- 在动态上显示"已编辑 N次"标记

---

### 3. Markdown富文本编辑器 📖

**功能亮点**：

- 🎨 **所见即所得**: 实时语法高亮，边写边看效果
- 🛠️ **格式化工具栏**: 8种Markdown格式一键插入
- 👁️ **三种编辑模式**: 编辑/预览/分屏模式自由切换
- 🎯 **智能渲染**: 使用Markwon库，支持GitHub Flavored Markdown
- 💡 **语法高亮**: 集成Prism4j，代码块支持多种编程语言高亮

**工具栏功能**：
| 按钮 | 格式 | Markdown语法 | 示例 |
|------|------|------------|------|
| **B** | 粗体 | `**text**` | **粗体文本** |
| _I_ | 斜体 | `*text*` | _斜体文本_ |
| ~~S~~ | 删除线 | `~~text~~` | ~~删除线~~ |
| **H** | 标题 | `# text` | # 一级标题 |
| **•** | 无序列表 | `- text` | - 列表项 |
| **1.** | 有序列表 | `1. text` | 1. 第一项 |
| **<>** | 代码块 | ` ```code``` ` | `kotlin\nfun test()\n` |
| **🔗** | 链接 | `[text](url)` | [链接文本](https://example.com) |

**编辑模式**：

1. **编辑模式 (EDIT)**: 纯文本编辑，实时语法高亮
2. **预览模式 (PREVIEW)**: 渲染后的Markdown效果，只读
3. **分屏模式 (SPLIT)**: 左侧编辑，右侧实时预览

**支持的Markdown特性**：

- ✅ 标题（H1-H6）
- ✅ 文本格式（粗体、斜体、删除线）
- ✅ 列表（有序、无序）
- ✅ 代码块（带语法高亮）
- ✅ 行内代码
- ✅ 链接
- ✅ 表格（扩展支持）
- ✅ 图片（通过URL）
- ✅ 引用块

---

## 🔧 改进与优化

### 用户体验

- 🎯 **字数统计优化**: 显示Markdown渲染后的实际字数（去除格式符号）
- 🚀 **编辑性能提升**: Markwon预渲染机制，减少UI卡顿
- 📱 **响应式布局**: 适配不同屏幕尺寸，Markdown编辑器高度自适应
- 🎨 **Material 3设计**: 全面采用Material You设计语言

### 技术架构

- 📦 **Markwon 4.6.2**: 强大的Markdown渲染和编辑库
- 🎨 **Prism4j 2.0.0**: 代码语法高亮引擎
- 🔍 **ZXing 3.5.3**: 二维码生成和解码库
- 🏗️ **模块化重构**: 核心UI组件提取到core-ui模块，提高复用性

### 数据库

- 🗄️ **数据库迁移 v15→v16**: 新增`post_edit_history`表
- 📊 **索引优化**: 为`post_id`和`edited_at`添加联合索引

---

## 🐛 修复的问题

### 社交功能

- 🔧 修复动态图片上传偶尔失败的问题
- 🔧 修复链接预览在某些网站失效的问题
- 🔧 修复时间流滚动到底部后无法加载更多的Bug

### UI/UX

- 🔧 修复Compose TextField在某些设备上卡顿的问题
- 🔧 修复暗黑模式下二维码不清晰的问题
- 🔧 修复评论列表空状态显示错误的问题

### 性能

- 🔧 优化大量动态加载时的内存占用（降低30%）
- 🔧 优化二维码生成速度（提升50%）
- 🔧 修复Markdown实时渲染导致的输入延迟

---

## 📊 性能指标

| 指标             | v0.30.0 | v0.31.0 | 改进   |
| ---------------- | ------- | ------- | ------ |
| 二维码生成时间   | 120ms   | 60ms    | ⬇️ 50% |
| Markdown渲染延迟 | 85ms    | 35ms    | ⬇️ 59% |
| 编辑器启动时间   | 180ms   | 95ms    | ⬇️ 47% |
| 动态列表内存占用 | 85MB    | 60MB    | ⬇️ 29% |
| 帧率（FPS）      | 54      | 58      | ⬆️ 7%  |

---

## 🧪 测试覆盖

### E2E测试

- ✅ **77个E2E测试用例**（新增9个v0.31.0测试）
- ✅ **QR码功能**: 3个测试用例（生成、扫描、保存）
- ✅ **动态编辑**: 3个测试用例（编辑流程、超时限制、编辑历史）
- ✅ **Markdown编辑器**: 3个测试用例（工具栏、渲染、模式切换）

### 单元测试

- ✅ **PostEditPolicyTest**: 25个测试用例（编辑权限策略）
- ✅ **MarkdownUtilsTest**: 18个测试用例（Markdown工具函数）
- ✅ **QRCodeGeneratorTest**: 12个测试用例（二维码生成）

### 覆盖率

- 📈 **UI层覆盖率**: 88%（目标80%，超额完成）
- 📈 **业务逻辑覆盖率**: 94%（目标90%，超额完成）
- 📈 **关键路径覆盖率**: 100%

---

## 📦 依赖更新

### 新增依赖

```kotlin
// Markwon Markdown渲染库
implementation("io.noties.markwon:core:4.6.2")
implementation("io.noties.markwon:editor:4.6.2")
implementation("io.noties.markwon:syntax-highlight:4.6.2")
implementation("io.noties.markwon:image-coil:4.6.2")
implementation("io.noties.markwon:ext-strikethrough:4.6.2")
implementation("io.noties.markwon:ext-tables:4.6.2")
implementation("io.noties.markwon:linkify:4.6.2")

// Prism4j 语法高亮
implementation("io.noties:prism4j:2.0.0")
kapt("io.noties:prism4j-bundler:2.0.0")

// ZXing 二维码库（已有，版本保持3.5.3）
```

### 更新的依赖

- `androidx.compose.ui:ui` → 1.6.1（Compose UI）
- `androidx.compose.material3:material3` → 1.2.0（Material 3）
- `coil-compose` → 2.6.0（图片加载）

---

## 🚀 升级指南

### 数据库迁移

从v0.30.0升级到v0.31.0会自动执行数据库迁移（v15→v16），新增`post_edit_history`表。**无需手动操作，升级时会自动完成。**

### API变更

**⚠️ 不兼容变更**:

- `PostRepository.updatePost()` 方法签名变更：

  ```kotlin
  // 旧版本
  suspend fun updatePost(postId: String, newContent: String): Result<Unit>

  // 新版本
  suspend fun updatePostContent(postId: String, newContent: String, editedAt: Long): Result<Unit>
  ```

**新增API**:

- `PostRepository.getPostEditHistory(postId: String): Flow<List<PostEditHistoryEntity>>`
- `QRCodeManager.generatePersonalQRCode(did: String, size: Int): Bitmap`
- `QRCodeScanner.scanQRCode(): Flow<Result<String>>`

### 配置变更

新增配置项（可选）：

```kotlin
// core-ui/src/main/res/values/config.xml
<integer name="qr_code_size">512</integer>
<integer name="post_edit_window_hours">24</integer>
<bool name="enable_markdown_preview">true</bool>
```

---

## 📖 文档更新

- 📘 [二维码功能使用指南](QR_CODE_GUIDE.md)
- 📘 [Markdown富文本编辑器指南](RICH_TEXT_EDITOR_GUIDE.md)
- 📘 [升级指南](UPGRADE_GUIDE_v0.31.0.md)
- 📘 [E2E测试报告](E2E_TEST_REPORT_v0.31.0.md)

---

## 🙏 致谢

感谢以下开源项目：

- [Markwon](https://github.com/noties/Markwon) - 强大的Android Markdown库
- [Prism4j](https://github.com/noties/Prism4j) - Java实现的语法高亮引擎
- [ZXing](https://github.com/zxing/zxing) - 条码和二维码处理库

---

## 🔮 下一个版本预告 (v0.32.0)

### 计划功能

- 🎤 **语音通话**: WebRTC集成，支持P2P语音通话
- 📹 **视频通话**: 远程视频画面，本地小窗可拖动
- 📞 **通话历史**: 记录所有通话记录，支持回拨
- 🤖 **AI内容审核**: 基于LLM的智能内容审核系统
- 🔇 **举报系统**: 完善的内容举报和处理机制

**预计发布时间**: 2026年2月底

---

## 📞 反馈与支持

- 🐛 **Bug报告**: [GitHub Issues](https://github.com/chainlesschain/chainlesschain/issues)
- 💡 **功能建议**: [GitHub Discussions](https://github.com/chainlesschain/chainlesschain/discussions)
- 📧 **联系邮箱**: dev@chainlesschain.com
- 💬 **社区交流**: [Discord](https://discord.gg/chainlesschain)

---

**完整更新日志**: [CHANGELOG.md](../CHANGELOG.md)
**源代码**: [GitHub Repository](https://github.com/chainlesschain/chainlesschain)

---

_ChainlessChain v0.31.0 - 让社交更智能，让表达更自由_
