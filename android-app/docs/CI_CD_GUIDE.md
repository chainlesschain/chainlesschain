# CI/CD 使用指南

## 版本信息
- **版本**: v1.0
- **创建日期**: 2026-01-23
- **状态**: 生效中

---

## 1. 概述

ChainlessChain Android 项目使用 GitHub Actions 实现完整的 CI/CD 流程，包括：

- ✅ 自动化代码质量检查
- ✅ 自动化单元测试和集成测试
- ✅ 自动化构建 APK/AAB
- ✅ 自动化安全扫描
- ✅ 自动化发布流程

---

## 2. 工作流概览

### 2.1 主要工作流

| 工作流 | 触发条件 | 用途 | 文件 |
|--------|---------|------|------|
| **Android CI** | Push 到 main/develop<br/>PR 到 main/develop | 完整的 CI 检查 | `.github/workflows/android-ci.yml` |
| **PR Check** | Pull Request | 快速检查 PR 质量 | `.github/workflows/android-pr-check.yml` |
| **Release Build** | Push tag `v*.*.*`<br/>手动触发 | 构建发布版本 | `.github/workflows/android-release.yml` |

### 2.2 工作流执行矩阵

```
Android CI 完整流程：
┌──────────────┐
│   Lint       │  Detekt + Android Lint (15分钟)
└──────┬───────┘
       │
┌──────▼───────┐
│   Test       │  单元测试 + 覆盖率 (30分钟)
└──────┬───────┘
       │
┌──────▼───────┐
│   Build      │  构建 Debug APK (30分钟)
└──────┬───────┘
       │
┌──────▼───────────────┐
│ Instrumented Test    │  UI测试 (API 26, 33) (45分钟/级别)
└──────┬───────────────┘
       │
┌──────▼───────┐
│   Security   │  依赖安全扫描 (15分钟)
└──────────────┘
```

---

## 3. 使用指南

### 3.1 开发流程

**1. 创建功能分支**
```bash
git checkout -b feature/my-feature
```

**2. 开发和提交**
```bash
# 本地测试
cd android-app
./gradlew detekt
./gradlew testDebugUnitTest
./gradlew assembleDebug

# 提交代码
git add .
git commit -m "feat: add new feature"
git push origin feature/my-feature
```

**3. 创建 Pull Request**
- 推送代码后，在 GitHub 创建 PR
- **PR Check 工作流**会自动运行（约20分钟）
- 检查内容：
  - Detekt 代码质量检查
  - 单元测试
  - 构建 Debug APK
  - 代码度量分析

**4. 审查 PR 检查结果**
- GitHub Actions 会自动在 PR 中评论结果
- 包含：测试结果、覆盖率、APK 大小
- 示例评论：
  ```
  ## 🤖 Android PR Check Results

  | Check | Status |
  |-------|--------|
  | Detekt | ✅ Passed |
  | Unit Tests | ✅ Passed |
  | Build | ✅ Passed |

  ### 📊 Test Coverage
  Coverage report is available in the workflow artifacts.

  ### 📦 APK Size
  Debug APK: 42.3 MB
  ```

**5. 合并 PR**
- 所有检查通过后，可以合并 PR
- 合并到 main/develop 会触发完整的 CI 流程

### 3.2 发布流程

**方法 1：使用 Git Tag**

```bash
# 1. 确保在 main 分支
git checkout main
git pull origin main

# 2. 创建版本标签
git tag -a v0.27.0 -m "Release v0.27.0: 综合优化和架构改进"
git push origin v0.27.0

# 3. GitHub Actions 自动触发 Release Build 工作流
```

**方法 2：手动触发**

1. 在 GitHub 仓库中，进入 **Actions** 标签
2. 选择 **Android Release Build** 工作流
3. 点击 **Run workflow**
4. 输入版本号（如：`0.27.0`）
5. 点击 **Run workflow** 按钮

**发布产物**:
- ✅ Release APK（已签名，生产用）
- ✅ Release AAB（Google Play 上传用）
- ✅ ProGuard Mapping 文件（崩溃分析用）
- ✅ 自动创建 GitHub Release（草稿）

---

## 4. 工作流详解

### 4.1 Android CI 工作流

**触发条件**:
```yaml
on:
  push:
    branches: [ main, develop ]
    paths:
      - 'android-app/**'
  pull_request:
    branches: [ main, develop ]
```

**Job 说明**:

**Job 1: Lint Check (15分钟)**
- 运行 Detekt 静态代码分析
- 运行 Android Lint
- 生成报告并上传为 artifacts

**Job 2: Unit Tests (30分钟)**
- 运行所有单元测试
- 生成 JaCoCo 覆盖率报告
- 在 PR 中评论测试结果

**Job 3: Build APK (30分钟)**
- 依赖：Lint 和 Test 通过
- 构建 Debug APK
- 上传 APK 为 artifact

**Job 4: Instrumented Tests (45分钟/级别)**
- 在 Android API 26 和 33 上运行 UI 测试
- 使用 Android Emulator
- 上传测试报告

**Job 5: Security Scan (15分钟)**
- 运行依赖安全扫描
- 检测已知漏洞
- 生成安全报告

**Job 6: Notify Results**
- 汇总所有 Job 的结果
- 生成摘要报告

### 4.2 PR Check 工作流

**特点**:
- 快速反馈（约20分钟）
- 只运行关键检查
- 自动在 PR 中评论结果
- 并发控制（取消旧的运行）

**检查内容**:
1. Detekt 代码质量
2. 单元测试
3. 代码覆盖率
4. Debug APK 构建
5. 代码度量分析

### 4.3 Release Build 工作流

**特点**:
- 完整的发布构建流程
- 生成签名的 APK 和 AAB
- 自动创建 GitHub Release
- 包含详细的发布说明

**构建产物**:
```
release-apk-v0.27.0/
├── chainlesschain-v0.27.0.apk
└── mapping/
    └── mapping.txt

release-aab-v0.27.0/
└── chainlesschain-v0.27.0.aab
```

---

## 5. 配置和自定义

### 5.1 工作流参数

**Android CI**:
```yaml
# 修改超时时间
timeout-minutes: 30

# 修改测试的 API 级别
strategy:
  matrix:
    api-level: [26, 29, 33]

# 修改缓存策略
cache:
  path: |
    ~/.gradle/caches
    ~/.gradle/wrapper
```

**PR Check**:
```yaml
# 并发控制
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

### 5.2 签名配置

**当前状态**: 使用 Debug 签名密钥

**生产环境配置** (TODO):

1. **生成 Release Keystore**:
```bash
keytool -genkey -v \
  -keystore release.keystore \
  -alias chainlesschain \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

2. **配置 GitHub Secrets**:
   - `RELEASE_KEYSTORE_BASE64`: Base64 编码的 keystore 文件
   - `RELEASE_KEYSTORE_PASSWORD`: Keystore 密码
   - `RELEASE_KEY_ALIAS`: Key 别名
   - `RELEASE_KEY_PASSWORD`: Key 密码

3. **更新工作流**:
```yaml
- name: Setup Signing Key
  run: |
    echo "${{ secrets.RELEASE_KEYSTORE_BASE64 }}" | base64 -d > android-app/keystore/release.keystore
```

### 5.3 通知配置

**Slack 通知** (可选):
```yaml
- name: Notify Slack
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'CI Build: ${{ job.status }}'
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

**Email 通知** (可选):
```yaml
- name: Send Email
  if: failure()
  uses: dawidd6/action-send-mail@v3
  with:
    server_address: smtp.gmail.com
    server_port: 465
    username: ${{ secrets.MAIL_USERNAME }}
    password: ${{ secrets.MAIL_PASSWORD }}
    subject: CI Build Failed
    to: team@chainlesschain.com
```

---

## 6. 故障排查

### 6.1 常见问题

**问题 1: Gradle 构建超时**

```yaml
# 增加超时时间
timeout-minutes: 45

# 添加并行构建
- name: Build with parallel
  run: ./gradlew assembleDebug --parallel --max-workers=2
```

**问题 2: 缓存失效**

```bash
# 清除缓存后重新运行
# 在 GitHub Actions 界面，选择 "Clear cache" 选项
```

**问题 3: 模拟器启动失败**

```yaml
# 使用更稳定的配置
emulator-options: -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim
```

**问题 4: 测试不稳定**

```yaml
# 添加重试机制
- name: Run Tests with Retry
  uses: nick-invision/retry@v2
  with:
    timeout_minutes: 30
    max_attempts: 3
    command: ./gradlew testDebugUnitTest
```

### 6.2 调试技巧

**启用详细日志**:
```yaml
- name: Run Tests
  run: ./gradlew testDebugUnitTest --info --stacktrace
```

**保存诊断信息**:
```yaml
- name: Upload Logs
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: build-logs
    path: |
      android-app/app/build/outputs/logs/
      ~/.gradle/daemon/
```

---

## 7. 最佳实践

### 7.1 提交前检查

**本地运行 CI 检查**:
```bash
# 快速检查
./gradlew detekt
./gradlew testDebugUnitTest

# 完整检查
./gradlew clean detekt testDebugUnitTest assembleDebug
```

**Pre-commit Hook**:
```bash
# .git/hooks/pre-commit
#!/bin/bash
cd android-app
./gradlew detekt --daemon
if [ $? -ne 0 ]; then
    echo "Detekt found issues. Please fix them before committing."
    exit 1
fi
```

### 7.2 分支策略

**推荐的 Git Flow**:
```
main (生产分支)
├── develop (开发分支)
    ├── feature/xxx (功能分支)
    ├── bugfix/xxx (修复分支)
    └── release/x.x.x (发布分支)
```

**触发规则**:
- `feature/*` → 推送时运行快速检查
- `develop` → 合并时运行完整 CI
- `main` → 合并时运行完整 CI + 部署准备
- `v*.*.*` → 发布时运行 Release Build

### 7.3 性能优化

**加速构建**:
```gradle
// gradle.properties
org.gradle.jvmargs=-Xmx4096m
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.configureondemand=true
kotlin.incremental=true
```

**优化缓存**:
```yaml
# 使用更精确的缓存键
key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties', 'buildSrc/**/*.kt') }}
```

---

## 8. 监控和度量

### 8.1 关键指标

| 指标 | 目标 | 当前 |
|------|------|------|
| CI 总时间 | < 30分钟 | ~20分钟 |
| 单元测试覆盖率 | > 80% | 75% |
| Detekt 问题数 | 0 | 0 |
| 构建成功率 | > 95% | ~98% |

### 8.2 趋势分析

**使用 GitHub Insights**:
- 查看工作流运行历史
- 分析失败原因
- 优化瓶颈环节

---

## 9. 下一步改进

- [ ] 配置正式的签名密钥
- [ ] 集成 Firebase App Distribution
- [ ] 添加性能基准测试
- [ ] 集成 Crashlytics
- [ ] 自动发布到 Google Play Console
- [ ] 添加更多平台通知（Slack, Email）
- [ ] 实现蓝绿部署策略
- [ ] 添加 AB 测试框架

---

**文档维护者：** Android 团队
**最后更新：** 2026-01-23
