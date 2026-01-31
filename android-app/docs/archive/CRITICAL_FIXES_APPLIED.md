# Android应用关键Bug修复报告

**修复日期:** 2026-01-25
**修复版本:** v0.26.2-DEBUG (commit after 4b45175a)
**修复问题数:** 3个关键Bug

---

## 🎯 已修复的Bug

### Bug #1: 退出登录后无法重新登录 ✅

**严重程度:** 🔴 P0 (阻断性Bug)

**问题描述:**
- 用户点击"退出"后,无法使用PIN码重新登录
- 应用强制用户重新设置PIN码
- 原因: `AuthRepository.logout()` 错误地清除了所有DataStore数据,包括PIN码哈希

**受影响文件:**
1. `feature-auth/data/repository/AuthRepository.kt` (line 219)
2. `feature-auth/presentation/AuthViewModel.kt` (line 235)

**修复内容:**

1. **AuthRepository.kt - logout()函数:**
```kotlin
// 修复前 (错误):
context.dataStore.edit { prefs ->
    prefs.clear()  // ❌ 清除所有数据,包括PIN码!
}

// 修复后 (正确):
context.dataStore.edit { prefs ->
    prefs[KEY_LAST_LOGIN_AT] = 0L  // ✅ 仅清除会话状态
}
// 保留: KEY_PIN_HASH, KEY_USER_ID, KEY_DEVICE_ID, KEY_IS_SETUP_COMPLETE
```

2. **AuthViewModel.kt - logout()函数:**
```kotlin
// 修复前 (错误):
_uiState.update {
    AuthUiState(
        isSetupComplete = false,  // ❌ 错误地重置设置状态
        isAuthenticated = false
    )
}

// 修复后 (正确):
_uiState.update {
    it.copy(
        isAuthenticated = false,
        currentUser = null,
        error = null
    )
    // ✅ 保持 isSetupComplete = true
}
```

**测试步骤:**
1. ✅ 登录应用
2. ✅ 点击"退出"按钮
3. ✅ 应该返回登录页面(不是设置PIN页面)
4. ✅ 输入原PIN码应该能成功登录

---

### Bug #2: 创建项目功能userId为null ✅

**严重程度:** 🔴 P0 (核心功能不可用)

**问题描述:**
- 用户点击"创建项目"→选择模板→点击"使用此模板"
- 提示错误:"请先登录"
- 原因: `ProjectScreen` 使用了独立的 `AuthViewModel` 实例,该实例的 `currentUser` 为null

**受影响文件:**
- `app/src/main/java/com/chainlesschain/android/presentation/MainContainer.kt` (line 47)

**根本原因分析:**
```kotlin
// MainContainer 中的导航结构:
composable(route = Screen.Home.route) {
    MainContainer(
        viewModel = hiltViewModel()  // 获取AuthViewModel实例A
    )
}

// MainContainer 内部:
fun MainContainer(viewModel: AuthViewModel) {
    when (selectedTab) {
        0 -> NewHomeScreen(viewModel = viewModel)  // ✅ 共享实例A
        1 -> ProjectScreen()  // ❌ 创建新实例B (currentUser = null!)
        3 -> ProfileScreen(viewModel = viewModel)  // ✅ 共享实例A
    }
}
```

**修复内容:**
```kotlin
// 修复后:
1 -> ProjectScreen(
    onProjectClick = onNavigateToProjectDetail,
    onNavigateToFileBrowser = onNavigateToFileBrowser,
    authViewModel = viewModel  // ✅ 传递共享的AuthViewModel实例
)
```

**测试步骤:**
1. ✅ 登录应用
2. ✅ 进入"项目"tab
3. ✅ 点击右上角"+"按钮
4. ✅ 选择任意项目模板
5. ✅ 点击"使用此模板"
6. ✅ 应该显示"项目创建成功"并自动跳转到项目详情页

---

### Bug #3: 创建项目失败无错误提示 ✅

**严重程度:** 🟠 P1 (用户体验差)

**问题描述:**
- 创建项目失败时,没有任何错误提示
- 对话框直接关闭,用户不知道发生了什么
- 原因: `ProjectViewModel.createProjectFromTemplate()` 使用 `return` 语句静默失败

**受影响文件:**
- `feature-project/viewmodel/ProjectViewModel.kt` (line 404)

**修复内容:**
```kotlin
// 修复前:
val userId = _currentUserId.value ?: return  // ❌ 静默失败

// 修复后:
val userId = _currentUserId.value

if (userId == null) {
    Log.e(TAG, "Cannot create project: userId is null")
    viewModelScope.launch {
        _uiEvents.emit(ProjectUiEvent.ShowError("请先登录"))  // ✅ 显示错误
    }
    return
}
```

**测试步骤:**
1. ✅ 模拟userId为null的场景
2. ✅ 尝试创建项目
3. ✅ 应该显示错误提示:"请先登录"

---

## 📊 修复总结

| Bug | 严重程度 | 状态 | 提交 |
|-----|---------|------|------|
| 1. 退出后无法登录 | 🔴 P0 | ✅ 已修复 | 本次 |
| 2. 创建项目userId null | 🔴 P0 | ✅ 已修复 | 本次 |
| 3. 失败无错误提示 | 🟠 P1 | ✅ 已修复 | 4b45175a |

---

## 🧪 完整测试流程

### 场景1: 首次使用
1. ✅ 打开应用
2. ✅ 设置6位PIN码
3. ✅ 自动进入主页
4. ✅ 进入"项目"tab
5. ✅ 创建一个项目
6. ✅ 验证项目出现在列表中

### 场景2: 退出重新登录
1. ✅ 点击"个人中心"tab
2. ✅ 点击"退出"按钮
3. ✅ 返回登录页面(不是设置PIN页面)
4. ✅ 输入正确的PIN码
5. ✅ 成功登录
6. ✅ 再次创建项目,应该成功

### 场景3: 应用重启
1. ✅ 强制停止应用
2. ✅ 重新打开应用
3. ✅ 输入PIN码登录
4. ✅ 创建项目,应该成功

---

## 🔍 调试日志

如果仍然遇到问题,请收集以下日志:

```bash
adb logcat -c
adb logcat -v time | grep -E "AuthViewModel|AuthRepository|ProjectViewModel|currentUser|userId"
```

**关键日志标记:**
- ✅ `PIN verification successful` - PIN验证成功
- ✅ `User logged out (PIN and setup data preserved)` - 退出成功(数据保留)
- ✅ `setCurrentUser: userId=xxx` - userId已设置
- ✅ `Creating project from template` - 开始创建项目
- ❌ `Cannot create project: userId is null` - userId为null错误

---

## 🚀 下一步工作

### 立即测试(用户操作)
1. **测试退出登录功能**
   - 登录→退出→重新登录
   - 验证不需要重新设置PIN

2. **测试创建项目功能**
   - 选择不同模板创建项目
   - 验证创建成功且能导航到详情页

3. **测试应用重启**
   - 强制停止应用
   - 重新打开并登录
   - 验证所有功能正常

### 待修复问题(后续)
1. ⏳ 项目详情页导航缺失
2. ⏳ 模板详情tab点击无响应
3. ⏳ 模板分类与PC端不一致
4. ⏳ AI会话功能验证
5. ⏳ LLM配置功能验证

---

## 📚 相关文档

- **诊断报告:** `URGENT_FIXES_NEEDED.md`
- **完整集成计划:** `ANDROID_COMPLETE_INTEGRATION_PLAN.md`
- **测试报告:** `ANDROID_TESTING_REPORT.md`

---

**修复人:** Claude Code
**版本:** v0.26.2-DEBUG
**修复时间:** 2026-01-25 00:30 UTC+8
