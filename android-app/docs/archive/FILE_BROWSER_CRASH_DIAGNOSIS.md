# 文件浏览器崩溃诊断指南

**问题**: 点击"文件浏览"后应用崩溃
**优先级**: 🔴 P0 严重
**状态**: 待诊断

---

## 🔍 收集崩溃信息

### 方法 1: 实时日志监控（推荐）

**步骤**:

1. **打开两个终端/PowerShell 窗口**

2. **窗口 1: 启动日志监控**

   ```powershell
   # 清空现有日志
   adb logcat -c

   # 实时监控应用日志
   adb logcat | Select-String -Pattern "chainlesschain|AndroidRuntime|FATAL" -Context 2,10
   ```

3. **窗口 2: 触发崩溃**

   ```powershell
   # 启动应用
   adb shell am start -n com.chainlesschain.android.debug/com.chainlesschain.android.MainActivity

   # 等待应用完全启动（约5秒）
   # 然后在手机上点击"文件浏览"
   ```

4. **观察窗口 1 的输出**
   - 崩溃时会立即显示 FATAL 错误
   - 记录完整的堆栈追踪

---

### 方法 2: 事后日志收集

**步骤**:

1. **清空日志**:

   ```powershell
   adb logcat -c
   ```

2. **触发崩溃**:
   - 启动应用
   - 点击"文件浏览"
   - 等待崩溃发生

3. **立即收集日志**:

   ```powershell
   adb logcat -d > file_browser_crash.log
   ```

4. **查找崩溃信息**:

   ```powershell
   # 查找 FATAL 错误
   Select-String -Path file_browser_crash.log -Pattern "FATAL" -Context 5,30

   # 查找应用包名相关错误
   Select-String -Path file_browser_crash.log -Pattern "chainlesschain" -Context 5,20

   # 查找所有异常
   Select-String -Path file_browser_crash.log -Pattern "Exception|Error" -Context 2,5
   ```

---

## 📋 需要的信息

请提供以下信息：

### 1. 崩溃堆栈追踪

**示例格式**:

```
FATAL EXCEPTION: main
Process: com.chainlesschain.android.debug, PID: 12345
java.lang.RuntimeException: Unable to start activity
    at android.app.ActivityThread.performLaunchActivity(...)
    at ...
Caused by: java.lang.NullPointerException: Attempt to invoke virtual method 'xxx' on a null object reference
    at com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel.<init>(GlobalFileBrowserViewModel.kt:42)
    at ...
```

### 2. 崩溃时机

- [ ] 点击"文件浏览"后立即崩溃
- [ ] 打开文件浏览器界面后崩溃
- [ ] 显示权限请求时崩溃
- [ ] 授予权限后崩溃
- [ ] 开始扫描文件时崩溃
- [ ] 其他: \***\*\_\_\_\*\***

### 3. 权限状态

**检查应用权限**:

```powershell
adb shell dumpsys package com.chainlesschain.android.debug | Select-String -Pattern "permission"
```

是否已授予存储权限？

- [ ] 是
- [ ] 否
- [ ] 未请求权限就崩溃了

### 4. 设备信息

已知信息:

- 设备: 24115RA8EC (小米/红米)
- Android 版本: 14/15
- CPU: arm64-v8a

---

## 🐛 可能的崩溃原因

根据代码分析，以下是可能的崩溃原因：

### 原因 #1: 依赖注入失败

**可能性**: ⭐⭐⭐⭐⭐ (最高)

**原因**: GlobalFileBrowserViewModel 依赖多个组件：

```kotlin
@HiltViewModel
class GlobalFileBrowserViewModel @Inject constructor(
    private val mediaStoreScanner: MediaStoreScanner,          // ← 可能未注入
    private val externalFileRepository: ExternalFileRepository, // ← 可能未注入
    private val fileImportRepository: FileImportRepository,     // ← 可能未注入
    val thumbnailCache: ThumbnailCache,                        // ← 可能未注入
    private val fileClassifier: FileClassifier,                // ← 可能未注入
    val textRecognizer: TextRecognizer,                        // ← 可能未注入
    val fileSummarizer: FileSummarizer                         // ← 可能未注入
)
```

**典型错误信息**:

```
Caused by: dagger.hilt.android.internal.lifecycle.HiltViewModelFactory$ViewModelCreationException
```

**解决方案**: 禁用高级功能，只保留基本的文件列表

---

### 原因 #2: 数据库访问失败

**可能性**: ⭐⭐⭐⭐

**原因**: ExternalFileDao 访问失败或表不存在

**典型错误信息**:

```
Caused by: android.database.sqlite.SQLiteException: no such table: external_files
```

**解决方案**: 确保数据库表已创建

---

### 原因 #3: 权限问题

**可能性**: ⭐⭐⭐

**原因**: 访问 MediaStore 或文件系统前未检查权限

**典型错误信息**:

```
Caused by: java.lang.SecurityException: Permission denial
```

**解决方案**: 优化权限请求流程

---

### 原因 #4: AI 分类功能异常

**可能性**: ⭐⭐

**原因**: FileClassifier 初始化失败

**典型错误信息**:

```
Caused by: java.lang.UnsatisfiedLinkError: dlopen failed: library "libtensorflowlite_jni.so" not found
```

**解决方案**: 禁用 AI 分类功能

---

### 原因 #5: Context 为空

**可能性**: ⭐

**原因**: MediaStoreScanner 需要 Context，但注入的 Context 为空

**典型错误信息**:

```
Caused by: java.lang.NullPointerException: Parameter specified as non-null is null: method ..., parameter context
```

**解决方案**: 检查 @ApplicationContext 注入

---

## 🔧 临时解决方案

在收集到详细日志之前，我可以创建一个简化版的文件浏览器：

### 简化版特性

**保留**:

- ✅ 基本文件列表
- ✅ 权限请求
- ✅ MediaStore 扫描
- ✅ 文件搜索和排序

**移除**:

- ❌ AI 文件分类
- ❌ OCR 文本识别
- ❌ 文件摘要生成
- ❌ 缩略图缓存（使用简单版）
- ❌ 文件导入到项目

**优势**:

- 更稳定，不易崩溃
- 启动更快
- 依赖更少

**是否需要我创建简化版？**

- [ ] 是，请创建简化版先测试
- [ ] 否，我先收集崩溃日志

---

## 📝 调试命令速查

```powershell
# 1. 清空日志
adb logcat -c

# 2. 实时监控
adb logcat | Select-String -Pattern "chainlesschain|FATAL"

# 3. 收集崩溃日志
adb logcat -d > crash.log

# 4. 查找 FATAL 错误
Select-String -Path crash.log -Pattern "FATAL" -Context 10,30

# 5. 查看应用进程
adb shell ps | Select-String "chainlesschain"

# 6. 强制停止应用
adb shell am force-stop com.chainlesschain.android.debug

# 7. 重新启动应用
adb shell am start -n com.chainlesschain.android.debug/com.chainlesschain.android.MainActivity

# 8. 查看应用权限
adb shell dumpsys package com.chainlesschain.android.debug | Select-String "permission"

# 9. 授予存储权限（手动）
adb shell pm grant com.chainlesschain.android.debug android.permission.READ_EXTERNAL_STORAGE
adb shell pm grant com.chainlesschain.android.debug android.permission.READ_MEDIA_IMAGES
adb shell pm grant com.chainlesschain.android.debug android.permission.READ_MEDIA_VIDEO
adb shell pm grant com.chainlesschain.android.debug android.permission.READ_MEDIA_AUDIO

# 10. 查看数据库
adb shell
run-as com.chainlesschain.android.debug
ls databases/
exit
```

---

## 🎯 下一步行动

**优先级排序**:

1. **立即执行**: 收集崩溃日志（方法1或方法2）
2. **分析日志**: 找到确切的崩溃原因
3. **针对性修复**: 根据日志修复具体问题
4. **如果诊断困难**: 使用简化版文件浏览器

**时间估计**:

- 收集日志: 5分钟
- 分析日志: 10分钟
- 修复问题: 20-60分钟

---

## 📤 提交信息

收集到崩溃日志后，请提供：

1. **完整的 FATAL 堆栈追踪**（从 "FATAL EXCEPTION" 到最后一行）
2. **崩溃前10行日志**（可能包含警告信息）
3. **崩溃时机描述**（具体在哪一步崩溃）
4. **权限授予情况**

**格式示例**:

```
=== 崩溃堆栈 ===
[粘贴完整堆栈]

=== 崩溃时机 ===
点击"文件浏览"按钮后立即崩溃，未显示任何界面

=== 权限状态 ===
未授予存储权限（崩溃发生在权限请求前）
```

---

**准备好了吗？让我们一起找出崩溃原因！** 🕵️‍♂️
