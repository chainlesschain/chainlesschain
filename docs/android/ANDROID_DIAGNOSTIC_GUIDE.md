# Android 应用问题诊断指南

**应用状态**: ✅ 已安装并运行 (v0.32.0, PID: 16709)
**日志监控**: ✅ 已启动后台日志监控

---

## 📋 请按照以下步骤逐个测试功能

### ✅ 步骤 1: 基础检查

**请回答以下问题**：

1. **应用能否正常打开？**
   - [ ] 能打开，看到主界面
   - [ ] 无法打开，闪退
   - [ ] 能打开但界面显示异常

2. **主界面有哪些标签页？**
   - [ ] 看到"首页"、"知识库"、"AI对话"等标签
   - [ ] 界面空白
   - [ ] 其他情况：___________

3. **是否有弹窗或错误提示？**
   - [ ] 有，内容是：___________
   - [ ] 没有

---

### 🗂️ 步骤 2: 测试本地文件浏览

**操作步骤**：
1. 点击主界面的"☰"菜单（左上角或抽屉菜单）
2. 找到"文件浏览"选项
3. 点击进入

**请回答**：
- [ ] ✅ 能找到"文件浏览"菜单项
- [ ] ❌ 找不到"文件浏览"菜单项
- [ ] ⚠️ 点击后崩溃或无响应

**如果能进入文件浏览界面**：
1. 是否弹出权限请求？
   - [ ] 有，请求"访问文件"权限
   - [ ] 没有弹出权限请求

2. 授予权限后，看到了什么？
   - [ ] 看到"扫描文件"按钮
   - [ ] 直接看到文件列表
   - [ ] 空白界面
   - [ ] 错误提示：___________

3. 点击"扫描文件"按钮后？
   - [ ] 显示扫描进度（"扫描图片..."、"扫描视频..."）
   - [ ] 无反应
   - [ ] 崩溃或错误

4. 扫描完成后？
   - [ ] 看到文件列表（图片、视频等）
   - [ ] 列表为空但手机确实有文件
   - [ ] 没有变化

---

### 🤖 步骤 3: 测试 LLM 配置

**操作步骤**：
1. 点击主界面右上角"设置"图标
2. 找到"LLM 设置"或"AI 设置"
3. 点击进入

**请回答**：
- [ ] ✅ 能找到 LLM/AI 设置
- [ ] ❌ 找不到相关设置
- [ ] ⚠️ 点击后崩溃

**如果能进入 LLM 设置界面**：
1. 看到了哪些选项？
   - [ ] 看到"选择提供商"下拉框
   - [ ] 看到 OpenAI、豆包、DeepSeek 等选项
   - [ ] 看到 API Key 输入框
   - [ ] 看到"测试连接"按钮
   - [ ] 界面空白

2. 尝试配置豆包（火山引擎）：
   - 选择提供商：豆包（Doubao）
   - 输入 API Key：【你的API Key】
   - 模型名称：doubao-seed-1-6-251015
   - 点击"测试连接"

3. 点击"测试连接"后？
   - [ ] 显示"测试中..."或加载动画
   - [ ] 显示"连接成功"（绿色）
   - [ ] 显示"连接失败"或错误信息：___________
   - [ ] 无反应
   - [ ] 一直转圈，超过60秒还没结果

---

### 🔄 步骤 4: 测试 P2P 功能

**操作步骤**：
1. 在主界面找到"P2P"或"社交"标签页
2. 查看设备发现或连接状态

**请回答**：
- [ ] ✅ 能找到 P2P 相关功能
- [ ] ❌ 找不到 P2P 功能
- [ ] ⚠️ 点击后崩溃

**如果能进入 P2P 界面**：
1. 看到了什么？
   - [ ] 看到"扫描设备"或"设备列表"
   - [ ] 看到"P2P 状态：已启动/未启动"
   - [ ] 看到本机设备信息
   - [ ] 界面空白或错误

2. P2P 初始化状态？
   - [ ] 显示"P2P 已就绪"
   - [ ] 显示"初始化中..."
   - [ ] 显示错误信息：___________

---

## 🔍 快速诊断命令

### 查看实时日志（如果上面步骤有问题）
```bash
# 在电脑上打开 PowerShell 或命令提示符
cd E:\code\chainlesschain
type C:\Users\admin\AppData\Local\Temp\claude\E--code-chainlesschain\tasks\b9141e2.output
```

### 查看应用崩溃日志
```bash
adb logcat -d | grep -E "AndroidRuntime|FATAL"
```

### 检查权限状态
```bash
adb shell dumpsys package com.chainlesschain.android | grep permission
```

### 检查数据库状态
```bash
adb shell "ls -la /data/data/com.chainlesschain.android/databases/"
```

---

## 📸 截图位置

如果需要发送截图：
1. 在手机上截图
2. 使用命令拉取截图：
```bash
# 截图后立即执行
adb pull /sdcard/Pictures/Screenshots/ E:\code\chainlesschain\screenshots\
```

---

## 🚨 常见问题快速修复

### 问题 1: 应用无法启动或闪退
```bash
# 查看崩溃日志
adb logcat -d | grep -A 20 "AndroidRuntime"

# 清除应用数据重试
adb shell pm clear com.chainlesschain.android
adb shell am start -n com.chainlesschain.android/.MainActivity
```

### 问题 2: 找不到菜单项
可能原因：
- 权限问题
- 功能被隐藏
- 版本不匹配

解决方法：
```bash
# 确认版本
adb shell dumpsys package com.chainlesschain.android | grep versionName

# 重新安装
cd E:\code\chainlesschain\android-app
adb install -r app/build/outputs/apk/release/app-universal-release.apk
```

### 问题 3: 权限被拒绝
```bash
# 手动授予所有权限
adb shell pm grant com.chainlesschain.android android.permission.READ_EXTERNAL_STORAGE
adb shell pm grant com.chainlesschain.android android.permission.WRITE_EXTERNAL_STORAGE
adb shell pm grant com.chainlesschain.android android.permission.CAMERA
adb shell pm grant com.chainlesschain.android android.permission.RECORD_AUDIO
adb shell pm grant com.chainlesschain.android android.permission.ACCESS_FINE_LOCATION
```

---

## 📞 下一步

**请告诉我**：
1. 上述 4 个步骤的测试结果（勾选对应的复选框）
2. 具体的错误信息或异常行为
3. 如果有截图更好

**我会根据你的反馈**：
- 定位具体问题
- 提供针对性修复方案
- 必要时重新构建和安装 APK

---

**当前监控状态**：✅ 后台日志实时监控中

操作应用时，所有日志都会被记录到：
`C:\Users\admin\AppData\Local\Temp\claude\E--code-chainlesschain\tasks\b9141e2.output`
