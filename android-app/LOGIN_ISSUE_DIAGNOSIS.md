# "未登录"问题诊断指南

## 问题概述

项目创建时提示"请先登录"，需要确认用户认证流程是否正常。

---

## 诊断步骤

### 1. 检查APK安装和启动

```bash
# 安装APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 启动应用并查看日志
adb logcat -c  # 清空日志
adb logcat | grep -E "ProjectViewModel|AuthViewModel|ChainlessChain"
```

---

### 2. 关键日志标记

#### ✅ 成功的登录流程应该看到：

```log
D/AuthViewModel: Setting up with PIN
D/AuthViewModel: PIN verification successful
D/AuthViewModel: User logged in: userId=xxx
D/ProjectViewModel: setCurrentUser: userId=xxx
```

#### ❌ 如果出现问题，会看到：

```log
E/ProjectViewModel: Cannot create project: userId is null
E/ProjectViewModel: createProject called. userId=null
```

---

### 3. 验证认证流程

#### 步骤A: 首次启动（PIN设置）

1. **应该看到PIN设置界面**
   - 如果没看到，检查日志：
     ```log
     grep "isSetupComplete" logcat
     ```

2. **设置6位PIN码**
   - 设置成功后日志：
     ```log
     D/AuthViewModel: Setup complete with PIN
     I/AuthRepository: User registered successfully
     ```

#### 步骤B: 后续启动（PIN验证）

1. **应该看到PIN验证界面**
   - 输入PIN后日志：
     ```log
     D/AuthViewModel: Verifying PIN: ***
     D/AuthViewModel: PIN verification successful
     ```

2. **自动登录（如果启用）**
   - 日志：
     ```log
     D/AuthViewModel: Attempting auto-login
     D/AuthViewModel: Auto-login successful
     ```

---

### 4. 检查数据库状态

```bash
# 进入设备shell
adb shell

# 查看应用数据目录（需要root权限）
cd /data/data/com.chainlesschain.android/databases
ls -la

# 如果有权限，检查数据库
sqlite3 chainlesschain.db
SELECT * FROM users;
.exit
```

---

### 5. 代码流程验证

#### 关键代码检查清单：

**1. AuthViewModel初始化（第162-170行）**
```kotlin
// 应该调用autoLogin或要求PIN验证
val user = authRepository.getCurrentUser()
_uiState.update {
    it.copy(
        isAuthenticated = true,
        currentUser = user  // ← 这个必须不为null
    )
}
```

**2. ProjectScreen初始化（ProjectScreen.kt:53-57）**
```kotlin
LaunchedEffect(authState.currentUser) {
    authState.currentUser?.let { user ->
        projectViewModel.setCurrentUser(user.id)  // ← 传递userId
    }
}
```

**3. CreateProject检查（ProjectViewModel.kt:372-378）**
```kotlin
if (userId == null) {
    Log.e(TAG, "Cannot create project: userId is null")  // ← 如果看到这个，说明userId没传递成功
    viewModelScope.launch {
        _uiEvents.emit(ProjectUiEvent.ShowError("请先登录"))
    }
    return
}
```

---

## 常见问题和解决方案

### 问题1: 首次启动没有PIN设置界面

**原因**: 数据库已存在但损坏

**解决方案**:
```bash
adb shell
pm clear com.chainlesschain.android
```

---

### 问题2: PIN验证后仍提示未登录

**原因**: authState没有正确更新

**检查日志**:
```bash
adb logcat | grep "currentUser"
```

**应该看到**:
```log
D/AuthViewModel: currentUser updated: User(id=xxx, ...)
```

---

### 问题3: authState.currentUser为null

**可能原因**:
1. PIN验证失败
2. 数据库查询失败
3. AuthRepository.getCurrentUser()返回null

**调试方法**:
```bash
# 完整的认证流程日志
adb logcat -s AuthViewModel:D AuthRepository:D SQLiteDatabase:D
```

---

## 完整测试流程

### 测试1: 全新安装

```bash
# 1. 卸载旧版本
adb uninstall com.chainlesschain.android

# 2. 安装新APK
adb install app/build/outputs/apk/debug/app-debug.apk

# 3. 启动并监控日志
adb logcat -c
adb logcat -s ChainlessChain:* ProjectViewModel:* AuthViewModel:* | tee login_test.log

# 4. 操作步骤：
#    - 设置PIN (例如: 123456)
#    - 进入主页
#    - 点击创建项目
#    - 输入项目名称
#    - 点击确认

# 5. 检查日志中是否有：
#    ✅ "PIN verification successful"
#    ✅ "setCurrentUser: userId=xxx"
#    ✅ "项目创建成功"
#    ❌ "Cannot create project: userId is null"
```

### 测试2: 已有PIN的情况

```bash
# 1. 重新启动应用
adb shell am force-stop com.chainlesschain.android
adb shell am start -n com.chainlesschain.android/.MainActivity

# 2. 监控日志
adb logcat -s ChainlessChain:* ProjectViewModel:* AuthViewModel:*

# 3. 操作：
#    - 输入PIN验证
#    - 创建项目

# 4. 检查是否看到：
#    ✅ "Auto-login successful" 或 "PIN verification successful"
#    ✅ "setCurrentUser: userId=xxx"
```

---

## 日志过滤命令

```bash
# 只看错误
adb logcat | grep -E "ERROR|Cannot create project"

# 只看认证相关
adb logcat | grep -E "Auth|Login|PIN|currentUser"

# 只看项目创建
adb logcat | grep -E "ProjectViewModel|createProject"

# 完整跟踪（保存到文件）
adb logcat -s ChainlessChain:* ProjectViewModel:* AuthViewModel:* > debug.log
```

---

## 代码修复验证

### 修复内容确认（已应用）：

**1. ProjectViewModel.kt (第372-378行)**
```kotlin
✅ 添加了userId null检查
✅ 添加了日志输出
✅ 添加了错误提示
```

**2. ProjectDetailScreenV2.kt (第50-54行)**
```kotlin
✅ 添加了AuthViewModel注入
✅ 添加了setCurrentUser调用
```

---

## 预期结果

### 成功的完整日志示例：

```log
D/AuthViewModel: Initializing AuthViewModel
D/AuthViewModel: Attempting auto-login
D/AuthRepository: Loading current user from database
D/AuthRepository: Found user: id=user_1738000000000
D/AuthViewModel: Auto-login successful
D/ProjectScreen: AuthState changed: currentUser=User(id=user_1738000000000)
D/ProjectViewModel: setCurrentUser: userId=user_1738000000000
D/ProjectViewModel: Loading projects for userId=user_1738000000000
I/ProjectViewModel: createProject called. userId=user_1738000000000, name=测试项目
D/ProjectRepository: Creating project: name=测试项目, userId=user_1738000000000
I/ProjectRepository: Project created successfully: id=project_xxx
D/ProjectViewModel: 项目创建成功
```

---

## 如果问题仍然存在

请提供以下信息：

1. **完整的logcat日志**（从启动到创建项目失败）
   ```bash
   adb logcat -s ChainlessChain:* ProjectViewModel:* AuthViewModel:* > issue.log
   ```

2. **操作步骤**
   - 是首次安装还是升级？
   - 是否设置了PIN？
   - 是否成功进入主页？
   - 在哪个页面点击创建项目？

3. **错误提示截图**

4. **设备信息**
   ```bash
   adb shell getprop ro.build.version.release  # Android版本
   adb shell getprop ro.product.model           # 设备型号
   ```

---

## 联系开发者

如果按照以上步骤仍无法解决，请提供：
- `issue.log`（完整日志）
- 操作录屏或截图
- 设备信息

将这些信息发送给开发团队进行进一步诊断。
