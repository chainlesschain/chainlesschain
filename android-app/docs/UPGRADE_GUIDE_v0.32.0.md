# 升级指南 - v0.31.0 → v0.32.0

本指南帮助您从v0.31.0平滑升级到v0.32.0。

---

## 🔄 升级概述

### 兼容性
- ✅ **完全向后兼容**
- ✅ **数据自动迁移**
- ✅ **无需用户操作**

### 升级时间
- **估计时长**: 5-10分钟
- **数据迁移**: 自动完成
- **首次启动**: 可能稍慢（初始化新功能）

---

## 📋 升级前准备

### 1. 备份数据（推荐）
虽然自动迁移很安全，但建议备份：

```bash
# 备份应用数据
adb backup -f chainlesschain_backup.ab com.chainlesschain.android

# 或使用Google云备份（需登录Google账号）
```

### 2. 检查系统要求
确保满足最低要求：
- ✅ Android 7.0+ (API 24+)
- ✅ 2GB+ RAM
- ✅ 100MB+ 可用空间

### 3. 网络连接
首次启动可能需要：
- 下载AI模型配置
- 同步审核规则
- 预加载资源

---

## 🚀 升级步骤

### 方式1: Google Play更新（推荐）
1. 打开Google Play商店
2. 搜索"ChainlessChain"
3. 点击"更新"
4. 等待下载和安装完成

### 方式2: APK直接安装
```bash
# 下载新版APK
wget https://github.com/chainlesschain/android/releases/download/v0.32.0/app-release.apk

# 安装（会覆盖旧版）
adb install -r app-release.apk
```

### 方式3: 从源码构建
```bash
cd android-app
./gradlew assembleRelease
adb install app/build/outputs/apk/release/app-release.apk
```

---

## 🔧 数据库迁移

### 自动迁移
升级时自动执行两次迁移：

#### Migration v16 → v17
```sql
-- 添加通话历史记录表
CREATE TABLE call_history (
    id TEXT PRIMARY KEY,
    peer_did TEXT NOT NULL,
    peer_name TEXT NOT NULL,
    call_type TEXT NOT NULL,
    media_type TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'COMPLETED',
    created_at INTEGER NOT NULL
);

-- 创建索引
CREATE INDEX idx_call_history_peer_did ON call_history(peer_did);
CREATE INDEX idx_call_history_start_time ON call_history(start_time);
CREATE INDEX idx_call_history_call_type ON call_history(call_type);
CREATE INDEX idx_call_history_media_type ON call_history(media_type);
```

#### Migration v17 → v18
```sql
-- 添加AI审核队列表
CREATE TABLE moderation_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_type TEXT NOT NULL,
    content_id TEXT NOT NULL,
    content_text TEXT NOT NULL,
    author_did TEXT NOT NULL,
    author_name TEXT,
    status TEXT NOT NULL,
    ai_result_json TEXT NOT NULL,
    human_decision TEXT,
    human_note TEXT,
    reviewer_did TEXT,
    appeal_status TEXT NOT NULL,
    appeal_text TEXT,
    appeal_at INTEGER,
    appeal_result TEXT,
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
);

-- 创建索引
CREATE INDEX idx_moderation_queue_status ON moderation_queue(status);
CREATE INDEX idx_moderation_queue_created_at ON moderation_queue(created_at);
CREATE INDEX idx_moderation_queue_content_type ON moderation_queue(content_type);
CREATE INDEX idx_moderation_queue_author_did ON moderation_queue(author_did);
```

### 验证迁移
首次启动后，检查日志：
```bash
adb logcat | grep "Migration"

# 应该看到：
# Migration 16 to 17 completed successfully
# Migration 17 to 18 completed successfully
```

---

## ⚙️ 配置更新

### 无需手动配置
所有新功能都使用默认配置，开箱即用。

### 可选配置

#### 1. AI审核配置
```kotlin
// 如需自定义审核策略
ModerationConfig.ENABLE_PRE_PUBLISH_MODERATION = true  // 默认
ModerationConfig.failureStrategy = FailureStrategy.ALLOW_WITH_LOG  // 默认
```

#### 2. 性能配置
```kotlin
// 如需调整图片缓存大小
val cacheSize = (Runtime.getRuntime().maxMemory() * 0.25).toLong()  // 默认25%

// 如需禁用动画（低端设备）
enableAnimations = false
```

---

## 🎯 新功能启用

### 1. AI内容审核
**自动启用**，无需配置。

首次发布帖子时：
1. 输入内容
2. 点击"发布"
3. AI自动审核（~500ms）
4. 通过即发布，违规则提示

### 2. 审核队列（管理员）
如果您是管理员/审核员：
1. 进入"设置"
2. 找到"内容审核"
3. 查看待审核项目

### 3. 性能监控（开发者）
```kotlin
// 在Application中启用
StartupPerformanceMonitor.recordAppStart()

// 在MainActivity中记录
StartupPerformanceMonitor.recordContentDisplay()
StartupPerformanceMonitor.printReport()
```

---

## 🐛 常见问题

### Q1: 升级后首次启动很慢？
**A**: 正常现象。首次启动需要：
- 执行数据库迁移
- 初始化新组件
- 预加载缓存

预计耗时：10-20秒（仅首次）

### Q2: 我的数据还在吗？
**A**: 是的！所有数据自动保留：
- ✅ 聊天记录
- ✅ 好友列表
- ✅ 社交帖子
- ✅ 文件传输记录

### Q3: 如何回滚到v0.31.0？
**A**: 不推荐回滚，但如果必须：
```bash
# 1. 卸载v0.32.0
adb uninstall com.chainlesschain.android

# 2. 恢复备份
adb restore chainlesschain_backup.ab

# 3. 安装v0.31.0
adb install app-v0.31.0.apk
```

**注意**: 回滚会丢失v0.32.0的新数据（审核记录等）

### Q4: APK变小了？
**A**: 是的！体积优化使APK减少~40%：
- v0.31.0: 65MB
- v0.32.0: 38MB (通用APK) 或 28MB (arm64 AAB)

### Q5: 内存占用降低了？
**A**: 是的！内存优化效果：
- 启动后: 120MB → 95MB
- 使用中: 180MB → 135MB
- 查看图片: 250MB → 180MB

### Q6: AI审核消耗流量吗？
**A**: 是的，但很少：
- 每次审核: ~1-2KB
- 批量审核: ~5-10KB
- 建议使用WiFi

### Q7: 如何禁用AI审核？
**A**: 目前不支持禁用（社区安全必需功能）

### Q8: 审核失败怎么办？
**A**: 有降级策略：
- 审核服务不可用 → 允许发布 + 记录日志
- 用户不受影响

---

## 📊 性能对比

### 启动速度
| 场景 | v0.31.0 | v0.32.0 | 提升 |
|------|---------|---------|------|
| 冷启动 | 1.8秒 | 1.2秒 | **33%** |
| 温启动 | 1.2秒 | 0.8秒 | **33%** |

您应该能明显感受到启动更快了！

### 内存使用
| 场景 | v0.31.0 | v0.32.0 | 降低 |
|------|---------|---------|------|
| 浏览Timeline | 180MB | 135MB | **25%** |
| 查看图片 | 250MB | 180MB | **28%** |

低端设备更流畅！

### APK大小
| 版本 | 大小 | 下载时间 (4G) |
|------|------|----------------|
| v0.31.0 | 65MB | ~15秒 |
| v0.32.0 | 38MB | ~9秒 |

下载和安装更快！

---

## ✅ 升级后验证

### 1. 检查版本
```
设置 → 关于 → 版本信息
应显示: v0.32.0
```

### 2. 测试新功能
- [ ] 发布一条测试帖子（验证AI审核）
- [ ] 查看通话记录（新功能）
- [ ] 感受启动速度提升
- [ ] 观察内存使用情况

### 3. 查看日志
```bash
adb logcat | grep "ChainlessChain"

# 应该看到：
# Database version: 18
# AppInitializer: Immediate initialization completed in XXXms
# ImageLoadingConfig: Memory cache size: XXX MB
```

---

## 🔧 开发者升级指南

### 依赖更新
无需更新依赖，但建议检查：
```kotlin
// 确保使用最新版本
implementation("androidx.compose.material3:material3:1.2.0")
implementation("io.coil-kt:coil-compose:2.5.0")
```

### API变化
**无破坏性变更**。所有现有API保持兼容。

### 新API
```kotlin
// AI审核
val result = contentModerator.moderateContent(content)

// 内存监控
val memoryInfo = ImageLoadingConfig.getMemoryInfo(context)

// 性能监控
StartupPerformanceMonitor.recordMilestone("checkpoint")
```

### 代码迁移
无需迁移代码。如需使用新功能：
1. 注入`ContentModerator`
2. 调用`moderateContent()`
3. 处理结果

详见: [MODERATION_INTEGRATION_GUIDE.kt](./MODERATION_INTEGRATION_GUIDE.kt)

---

## 📚 相关文档

### 用户文档
- [发布说明](./RELEASE_NOTES_v0.32.0.md)
- [AI审核指南](./AI_MODERATION_GUIDE.md)

### 开发者文档
- [审核集成指南](./MODERATION_INTEGRATION_GUIDE.kt)
- [性能优化指南](./PERFORMANCE_OPTIMIZATION_GUIDE.md)
- [滚动优化](./SCROLL_PERFORMANCE_OPTIMIZATION.md)
- [APK优化](./APK_SIZE_OPTIMIZATION.md)

### 完成报告
- [Phase 6完成报告](./PHASE_6_COMPLETION_REPORT.md)
- [Phase 7完成总结](./PHASE_7_COMPLETION_SUMMARY.md)

---

## 💬 获取帮助

### 遇到问题？
1. 查看[常见问题](#常见问题)
2. 搜索[GitHub Issues](https://github.com/chainlesschain/android/issues)
3. 提交新Issue

### 需要支持？
- 邮箱: support@chainlesschain.com
- 讨论区: [GitHub Discussions](https://github.com/chainlesschain/android/discussions)

---

**升级愉快！ 🎉**

如有任何问题，我们随时为您提供帮助。
