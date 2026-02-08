# 🔧 Android 编译问题修复指南

## 问题症状

```bash
BUILD FAILED in 38s

错误1: FileAlreadyExistsException (KSP缓存冲突)
错误2: Unable to delete directory (文件被占用)
错误3: AAR metadata 缺失
```

## 根本原因

Windows 文件系统特性导致的构建缓存问题：

1. IDE/Gradle Daemon 进程占用构建文件
2. KSP 增量编译缓存损坏
3. AAR 元数据缓存不一致

## 解决方案

### 方案 1: 完整清理（推荐）

```bash
# 1. 关闭 Android Studio/IntelliJ IDEA

# 2. 终止所有 Gradle 进程
taskkill /F /IM java.exe /FI "WINDOWTITLE eq *Gradle*"

# 3. 删除构建缓存
cd E:\code\chainlesschain\android-app
rmdir /S /Q build
rmdir /S /Q .gradle
rmdir /S /Q %USERPROFILE%\.gradle\caches

# 4. 删除各模块的构建目录
for /d %G in ("*") do if exist "%G\build" rmdir /S /Q "%G\build"

# 5. 重新同步和编译
gradlew clean
gradlew assembleDebug
```

### 方案 2: 快速清理

```bash
# 1. 终止 Gradle Daemon
cd E:\code\chainlesschain\android-app
gradlew --stop

# 2. 清理 KSP 缓存
rmdir /S /Q core-database\build\kspCaches
rmdir /S /Q core-common\build\kspCaches
rmdir /S /Q feature-knowledge\build\kspCaches

# 3. 清理 AAR 元数据
rmdir /S /Q core-ui\build\intermediates\aar_metadata
rmdir /S /Q core-common\build\intermediates\aar_metadata

# 4. 重新编译
gradlew assembleDebug --no-daemon
```

### 方案 3: Android Studio GUI 操作

1. **Clean Project**
   - `Build` → `Clean Project`

2. **Invalidate Caches**
   - `File` → `Invalidate Caches / Restart...`
   - 勾选所有选项
   - 点击 `Invalidate and Restart`

3. **Rebuild Project**
   - `Build` → `Rebuild Project`

### 方案 4: 禁用并行编译（临时）

修改 `gradle.properties`:

```properties
# 临时禁用并行编译（完成后恢复）
org.gradle.parallel=false
org.gradle.caching=false
ksp.incremental=false
```

然后编译：

```bash
gradlew assembleDebug --no-parallel --no-daemon
```

## 预防措施

### 1. 定期清理缓存

```bash
# 每周清理一次
gradlew clean
rmdir /S /Q %USERPROFILE%\.gradle\caches\build-cache-1
```

### 2. 配置文件监视排除

**Windows Defender / 杀毒软件**:

- 将以下目录加入排除列表：
  - `E:\code\chainlesschain\android-app\build`
  - `E:\code\chainlesschain\android-app\.gradle`
  - `%USERPROFILE%\.gradle`
  - `%USERPROFILE%\.android`

**Android Studio**:

- `File` → `Settings` → `Build, Execution, Deployment` → `Compiler`
- 启用 `Use --release flag for compilation`
- 禁用 `Auto-import`

### 3. 增加 Gradle 堆内存

`gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx8192m -XX:MaxMetaspaceSize=2048m -XX:+UseG1GC
```

### 4. 使用 WSL2（推荐）

如果频繁遇到 Windows 文件系统问题，考虑迁移到 WSL2：

```bash
# 在 WSL2 Ubuntu 中编译
wsl
cd /mnt/e/code/chainlesschain/android-app
./gradlew assembleDebug
```

## 常见错误和解决方法

### 错误 1: `FileAlreadyExistsException`

**原因**: KSP 缓存冲突

**解决**:

```bash
rmdir /S /Q core-database\build\kspCaches
gradlew :core-database:kspDebugKotlin
```

### 错误 2: `Unable to delete directory`

**原因**: 进程占用文件

**解决**:

```bash
# 查找占用进程
handle.exe "E:\code\chainlesschain\android-app\build"

# 或使用 Process Explorer (Sysinternals)
# 强制终止占用进程后重试
```

### 错误 3: `aar-metadata.properties not found`

**原因**: AAR 元数据缺失

**解决**:

```bash
gradlew :core-ui:assembleDebug --rerun-tasks
```

### 错误 4: Gradle Daemon 内存不足

**症状**: `OutOfMemoryError: Metaspace`

**解决**:

```bash
# 停止所有 Daemon
gradlew --stop

# 增加堆内存后重启
gradlew assembleDebug
```

## 验证修复

```bash
# 1. 检查 Gradle 版本
gradlew --version

# 2. 编译测试
gradlew :core-common:assembleDebug
gradlew :app:assembleDebug

# 3. 运行测试
gradlew :core-common:testDebugUnitTest
gradlew :app:connectedDebugAndroidTest

# 4. 检查 APK 输出
dir app\build\outputs\apk\debug\*.apk
```

## 成功标志

```bash
BUILD SUCCESSFUL in 2m 15s
185 actionable tasks: 185 executed

# 输出文件存在
app/build/outputs/apk/debug/app-debug.apk
```

## 高级技巧

### 使用 Build Scan

```bash
gradlew assembleDebug --scan
# 访问生成的 URL 查看详细构建信息
```

### 启用详细日志

```bash
gradlew assembleDebug --info > build.log 2>&1
# 检查 build.log 查找具体错误
```

### 并行编译配置

```properties
# gradle.properties - 根据CPU调整
org.gradle.workers.max=4
org.gradle.parallel=true
kotlin.incremental=true
kotlin.caching.enabled=true
```

## 联系支持

如果以上方法都无法解决问题，请提供：

1. 完整错误日志（`gradlew assembleDebug --stacktrace --info`）
2. Gradle 版本（`gradlew --version`）
3. JDK 版本（`java -version`）
4. 系统信息（`systeminfo | findstr /C:"OS"`）

## 更新日志

| 版本 | 日期       | 变更                               |
| ---- | ---------- | ---------------------------------- |
| v1.0 | 2026-02-05 | 初始版本：Windows 编译问题修复指南 |
