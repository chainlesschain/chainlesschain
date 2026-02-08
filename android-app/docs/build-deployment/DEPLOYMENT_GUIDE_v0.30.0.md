# 🚀 ChainlessChain Android v0.30.0 部署指南

**版本**: v0.30.0
**发布日期**: 2026-01-26
**目标环境**: 生产环境

---

## 📋 部署前检查清单

### 1. 代码完整性验证

**核心文件检查**:
```bash
# 验证所有新增文件存在
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/AddFriendScreen.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/FriendDetailScreen.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/UserProfileScreen.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/CommentDetailScreen.kt

# 验证ViewModel文件
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/viewmodel/social/AddFriendViewModel.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/viewmodel/social/FriendDetailViewModel.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/viewmodel/social/UserProfileViewModel.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/viewmodel/social/CommentDetailViewModel.kt

# 验证组件文件
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/components/ImagePreviewGrid.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/components/LinkPreviewCard.kt
ls -la feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/components/ReportDialog.kt

# 验证测试文件
ls -la feature-knowledge/src/androidTest/java/e2e/KnowledgeE2ETest.kt
ls -la feature-ai/src/androidTest/java/e2e/AIConversationE2ETest.kt
ls -la feature-p2p/src/androidTest/java/e2e/SocialE2ETest.kt
ls -la feature-p2p/src/androidTest/java/e2e/P2PCommE2ETest.kt
ls -la feature-project/src/androidTest/java/e2e/ProjectE2ETest.kt
```

### 2. 构建验证

**步骤**:
```bash
# 1. 清理构建缓存
cd android-app
./gradlew clean

# 2. 编译检查
./gradlew compileDebugKotlin
./gradlew compileReleaseKotlin

# 3. Lint检查
./gradlew lintDebug
./gradlew lintRelease

# 4. 单元测试
./gradlew testDebugUnitTest
./gradlew testReleaseUnitTest

# 5. E2E测试（本地）
./gradlew connectedDebugAndroidTest

# 6. 覆盖率报告
./gradlew jacocoE2ETestReport
```

**成功标准**:
- ✅ 0 编译错误
- ✅ 0 Lint错误，0 Lint警告
- ✅ 100% 单元测试通过
- ✅ 100% E2E测试通过 (42/42)
- ✅ UI覆盖率 ≥ 85%
- ✅ 业务逻辑覆盖率 ≥ 92%

### 3. 数据库迁移验证

**迁移脚本检查** (`ChainlessChainDatabase.kt`):
```kotlin
// 验证版本号
version = 15

// 验证新实体已注册
entities = [
    // ... 原有实体
    PostReportEntity::class,
    BlockedUserEntity::class
]

// 验证迁移逻辑
val MIGRATION_14_15 = object : Migration(14, 15) {
    override fun migrate(database: SupportSQLiteDatabase) {
        // 创建举报表
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS PostReportEntity (
                id TEXT PRIMARY KEY NOT NULL,
                postId TEXT NOT NULL,
                reporterDid TEXT NOT NULL,
                reason TEXT NOT NULL,
                description TEXT,
                createdAt INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING'
            )
        """)

        // 创建屏蔽用户表
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS BlockedUserEntity (
                id TEXT PRIMARY KEY NOT NULL,
                blockerDid TEXT NOT NULL,
                blockedDid TEXT NOT NULL,
                reason TEXT,
                createdAt INTEGER NOT NULL
            )
        """)
    }
}
```

**测试迁移**:
```bash
# 1. 备份v0.26.2数据库
adb pull /data/data/com.chainlesschain.android/databases/chainlesschain.db backup_v0.26.2.db

# 2. 安装v0.30.0
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 3. 启动应用，触发迁移
adb shell am start -n com.chainlesschain.android/.MainActivity

# 4. 验证数据完整性
adb shell run-as com.chainlesschain.android cat /data/data/com.chainlesschain.android/databases/chainlesschain.db | sqlite3
> .schema PostReportEntity
> .schema BlockedUserEntity
> SELECT * FROM FriendEntity LIMIT 5;  # 验证旧数据未丢失
```

### 4. 依赖检查

**验证 `app/build.gradle.kts`**:
```kotlin
// 新增依赖
implementation("org.jsoup:jsoup:1.17.2")

// 测试依赖
androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
androidTestImplementation("androidx.test:orchestrator:1.4.2")
androidTestImplementation("app.cash.turbine:turbine:1.0.0")

// JaCoCo配置
jacoco {
    toolVersion = "0.8.11"
}
```

**依赖安全扫描**:
```bash
./gradlew dependencyCheckAnalyze
```

---

## 🏗️ 构建生产版本

### 1. 签名配置

**创建签名配置** (`android-app/keystore/release.properties`):
```properties
KEYSTORE_FILE=../keystore/chainlesschain-release.jks
KEYSTORE_PASSWORD=your_keystore_password
KEY_ALIAS=chainlesschain
KEY_PASSWORD=your_key_password
```

**生成Keystore** (首次发布):
```bash
keytool -genkey -v \
  -keystore keystore/chainlesschain-release.jks \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -alias chainlesschain \
  -dname "CN=ChainlessChain, OU=Dev, O=ChainlessChain, L=Beijing, ST=Beijing, C=CN"
```

### 2. 混淆配置

**验证 `proguard-rules.pro`**:
```proguard
# Keep Hilt components
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }

# Keep Room entities
-keep class com.chainlesschain.android.core.database.entity.** { *; }

# Keep Jsoup
-keep class org.jsoup.** { *; }

# Keep ViewModel
-keep class * extends androidx.lifecycle.ViewModel { *; }

# Keep Compose
-keep class androidx.compose.** { *; }
```

### 3. 构建Release版本

```bash
# 1. 设置版本号
# 编辑 app/build.gradle.kts
versionCode = 30000  # v0.30.0
versionName = "0.30.0"

# 2. 构建Release APK
./gradlew assembleRelease

# 3. 构建Release AAB (Google Play)
./gradlew bundleRelease

# 4. 验证签名
jarsigner -verify -verbose -certs app/build/outputs/apk/release/app-release.apk

# 5. 优化对齐
zipalign -v 4 \
  app/build/outputs/apk/release/app-release.apk \
  app/build/outputs/apk/release/chainlesschain-v0.30.0.apk
```

**输出文件**:
- APK: `app/build/outputs/apk/release/chainlesschain-v0.30.0.apk`
- AAB: `app/build/outputs/bundle/release/app-release.aab`

---

## 🧪 发布前测试

### 1. 冒烟测试

**关键功能验证** (使用 `FEATURE_VERIFICATION_CHECKLIST.md`):
```bash
# 安装Release版本
adb install -r chainlesschain-v0.30.0.apk

# 执行手动测试
# [ ] 添加好友流程
# [ ] 发布动态（文字+图片+链接）
# [ ] 点赞、评论、分享
# [ ] 举报和屏蔽用户
# [ ] 编辑好友备注
# [ ] 查看好友详情
# [ ] 查看用户资料
# [ ] 查看评论详情
```

### 2. 回归测试

**运行完整E2E测试套件**:
```bash
# 在3个Android版本上测试
./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.e2e.AppE2ETestSuite

# 验证结果
cat app/build/reports/androidTests/connected/index.html
```

### 3. 性能测试

**Macrobenchmark**:
```bash
# 启动性能
./gradlew :benchmark:connectedBenchmarkAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=StartupBenchmark

# 滚动性能
./gradlew :benchmark:connectedBenchmarkAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=TimelineScrollBenchmark

# 上传性能
./gradlew :benchmark:connectedBenchmarkAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=ImageUploadBenchmark
```

**性能基准**:
- 冷启动: < 1.5s
- UI帧率: ≥ 58fps
- 图片上传: > 500KB/s
- 链接预览: < 2s
- 内存峰值: < 200MB

### 4. 安全测试

**静态分析**:
```bash
# Android Security Scan
./gradlew securityCheckRelease

# OWASP Dependency Check
./gradlew dependencyCheckAnalyze

# 查看报告
open build/reports/security/index.html
```

**关键安全检查**:
- [ ] 数据库加密（SQLCipher AES-256）
- [ ] 网络通信HTTPS
- [ ] E2EE消息加密（Signal Protocol）
- [ ] API Key安全存储（Android Keystore）
- [ ] 权限最小化原则
- [ ] WebView安全配置

---

## 📦 发布流程

### 1. GitHub Release

**创建Release**:
```bash
# 1. 打标签
git tag -a v0.30.0 -m "Release v0.30.0 - Milestone Complete"
git push origin v0.30.0

# 2. 创建GitHub Release
gh release create v0.30.0 \
  --title "ChainlessChain Android v0.30.0 - Milestone Complete" \
  --notes-file android-app/RELEASE_NOTES_v0.30.0.md \
  app/build/outputs/apk/release/chainlesschain-v0.30.0.apk

# 3. 上传AAB
gh release upload v0.30.0 \
  app/build/outputs/bundle/release/app-release.aab
```

### 2. Google Play Console

**上传步骤**:
1. 登录 [Google Play Console](https://play.google.com/console)
2. 选择「ChainlessChain」应用
3. 左侧菜单 → 发布 → 制作版本 → 生产
4. 上传 `app-release.aab`
5. 填写版本说明（从 `RELEASE_NOTES_v0.30.0.md` 复制）
6. 设置发布时间（建议分阶段发布）:
   - 第1天: 5% 用户
   - 第3天: 20% 用户
   - 第7天: 50% 用户
   - 第14天: 100% 用户

### 3. 内部测试渠道

**Alpha测试**:
- 受众: 内部团队（10-20人）
- 时长: 3-5天
- 目标: 发现关键Bug

**Beta测试**:
- 受众: 早期用户（100-500人）
- 时长: 7-10天
- 目标: 收集用户反馈，验证稳定性

**Open Testing**:
- 受众: 公开招募（1000+人）
- 时长: 7-14天
- 目标: 大规模压力测试

---

## 🔧 后端配置

### 1. 图片上传服务

**AWS S3配置** (示例):
```kotlin
// ImageUploadService.kt 需要配置

object ImageUploadConfig {
    const val UPLOAD_ENDPOINT = "https://api.chainlesschain.com/v1/upload/image"
    const val MAX_SIZE_MB = 5
    const val MAX_IMAGES = 9
    const val QUALITY = 85
    const val MAX_DIMENSION = 1920
}

// 后端API规范
POST /v1/upload/image
Content-Type: multipart/form-data

Request:
- file: Binary image data
- userId: String
- postId: String (optional)

Response:
{
  "success": true,
  "url": "https://cdn.chainlesschain.com/images/abc123.jpg",
  "thumbnail": "https://cdn.chainlesschain.com/images/abc123_thumb.jpg"
}
```

**Cloudflare R2配置** (备选):
```bash
# 环境变量
export R2_ACCOUNT_ID=your_account_id
export R2_ACCESS_KEY_ID=your_access_key
export R2_SECRET_ACCESS_KEY=your_secret_key
export R2_BUCKET_NAME=chainlesschain-images
```

### 2. 链接预览服务

**自建服务** (推荐):
```kotlin
// LinkPreviewFetcher.kt 配置

object LinkPreviewConfig {
    // 使用自建服务（缓存+速率限制）
    const val API_ENDPOINT = "https://api.chainlesschain.com/v1/link-preview"

    // 或直接解析（需要处理CORS）
    const val DIRECT_FETCH = true
}
```

**第三方服务** (备选):
- [LinkPreview API](https://www.linkpreview.net/)
- [Microlink](https://microlink.io/)
- [OpenGraph.io](https://www.opengraph.io/)

### 3. CDN配置

**Cloudflare CDN**:
```nginx
# 图片缓存规则
location ~* \.(jpg|jpeg|png|webp)$ {
    proxy_cache_valid 200 7d;
    proxy_cache_valid 404 1h;
    expires 7d;
    add_header Cache-Control "public, immutable";
}

# 预览缓存规则
location /link-preview/ {
    proxy_cache_valid 200 1d;
    proxy_cache_valid 404 1h;
    expires 1d;
}
```

---

## 📊 监控与告警

### 1. Firebase Crashlytics

**集成验证**:
```kotlin
// MainApplication.kt
FirebaseCrashlytics.getInstance().apply {
    setCrashlyticsCollectionEnabled(true)
    setCustomKey("app_version", BuildConfig.VERSION_NAME)
    setUserId(currentUserDid)
}
```

**关键指标**:
- Crash-free率 > 99.5%
- ANR率 < 0.1%
- 启动时间 < 1.5s

### 2. Firebase Performance

```kotlin
// 关键路径监控
val trace = FirebasePerformance.getInstance().newTrace("image_upload")
trace.start()
imageUploadService.upload(images)
trace.stop()
```

**监控指标**:
- 图片上传成功率 > 95%
- 链接预览加载时间 < 2s
- 时间流滚动帧率 > 58fps

### 3. Google Analytics

**事件追踪**:
```kotlin
// 关键功能使用
analytics.logEvent("friend_added") { /* ... */ }
analytics.logEvent("post_published") { /* ... */ }
analytics.logEvent("image_uploaded") { /* ... */ }
analytics.logEvent("link_previewed") { /* ... */ }
analytics.logEvent("post_shared") { /* ... */ }
analytics.logEvent("user_blocked") { /* ... */ }
```

---

## 🚨 应急预案

### 1. 回滚计划

**触发条件**:
- Crash率 > 2%
- 关键功能失败率 > 10%
- 数据库迁移失败 > 5%

**回滚步骤**:
```bash
# 1. 停止新版本发布
# Google Play Console → 停止推出

# 2. 发布修复版本或回滚
gh release create v0.30.1 \
  --title "Hotfix v0.30.1" \
  --notes "修复关键问题，恢复到v0.26.2" \
  app-v0.26.2-rollback.apk

# 3. 数据库降级脚本
# 如果必要，提供v15→v14降级脚本（不推荐）
```

### 2. 热修复方案

**Tinker集成** (可选):
```kotlin
// 用于紧急修复关键Bug
dependencies {
    implementation 'com.tencent.tinker:tinker-android-lib:1.9.14.25'
}
```

### 3. Feature Flag

**远程配置**:
```kotlin
// Firebase Remote Config
val enableImageUpload = remoteConfig.getBoolean("enable_image_upload")
val enableLinkPreview = remoteConfig.getBoolean("enable_link_preview")
val enableSharing = remoteConfig.getBoolean("enable_sharing")
val enableReporting = remoteConfig.getBoolean("enable_reporting")

// 紧急关闭功能
if (!enableImageUpload) {
    // 隐藏图片上传入口
}
```

---

## 📞 支持与维护

### 1. 用户支持渠道

- **Email**: support@chainlesschain.com
- **GitHub Issues**: https://github.com/yourusername/chainlesschain/issues
- **Discord**: https://discord.gg/chainlesschain
- **FAQ**: https://chainlesschain.com/faq

### 2. 问题追踪

**优先级定义**:
- **P0**: 应用崩溃、数据丢失 → 2小时响应
- **P1**: 核心功能不可用 → 24小时响应
- **P2**: 次要功能问题 → 3天响应
- **P3**: 优化建议 → 1周响应

### 3. 版本维护周期

- **v0.30.x**: 主要维护版本（6个月）
- **v0.29.x**: 安全补丁（3个月）
- **v0.28.x及更早**: 停止支持

---

## ✅ 发布检查清单

**部署前** (所有项必须打勾):
- [ ] 所有代码已合并到 main 分支
- [ ] 所有E2E测试通过 (42/42)
- [ ] 代码覆盖率达标 (UI≥85%, 业务≥92%)
- [ ] Lint检查通过 (0 Error, 0 Warning)
- [ ] 安全扫描通过（无高危漏洞）
- [ ] 数据库迁移测试通过
- [ ] 性能基准测试通过
- [ ] Release版本构建成功
- [ ] APK/AAB签名验证通过
- [ ] 手动冒烟测试通过
- [ ] CHANGELOG.md 已更新
- [ ] RELEASE_NOTES.md 已完成
- [ ] API文档已更新（如有变更）
- [ ] 后端服务已配置（图片上传、链接预览）
- [ ] CDN已配置
- [ ] 监控告警已设置
- [ ] 应急回滚方案已准备

**发布后** (24小时内):
- [ ] 监控Crashlytics (crash率 < 1%)
- [ ] 检查Google Play评分 (≥ 4.0)
- [ ] 查看用户反馈
- [ ] 验证核心功能可用性
- [ ] 确认数据库迁移成功率 (> 95%)
- [ ] 检查服务端日志（图片上传、链接预览）
- [ ] 更新支持文档（如有新问题）

---

## 📄 相关文档

1. [发布说明](./RELEASE_NOTES_v0.30.0.md) - 用户可见的变更
2. [快速开始](./QUICK_START_v0.30.0.md) - 新用户指南
3. [功能验证清单](./FEATURE_VERIFICATION_CHECKLIST.md) - QA测试清单
4. [E2E测试指南](./E2E_TESTING_GUIDE.md) - 自动化测试文档
5. [变更日志](./CHANGELOG.md) - 完整版本历史

---

**部署负责人**: _________________
**QA负责人**: _________________
**发布日期**: 2026-01-26
**下次审查**: 2026-02-02 (发布后7天)

---

**ChainlessChain 开发团队**
2026-01-26
