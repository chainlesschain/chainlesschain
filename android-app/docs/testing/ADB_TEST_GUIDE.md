# ADB 安装和测试指南

**测试设备**: 真实 Android 手机
**日期**: 2026-01-27
**APK 版本**: v0.26.2

---

## 🚀 第一步：验证连接

### 1.1 检查设备连接

```bash
# 查看连接的设备
adb devices

# 期望输出：
# List of devices attached
# XXXXXXXX        device
```

**如果显示 "unauthorized"**：

- 在手机上点击"允许USB调试"弹窗
- 勾选"始终允许"

**如果没有设备**：

- 检查 USB 数据线（确保不是纯充电线）
- 在手机设置中启用"开发者选项" → "USB调试"
- 尝试更换 USB 端口

### 1.2 查看设备信息

```bash
# 设备型号和 Android 版本
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release

# 设备 CPU 架构
adb shell getprop ro.product.cpu.abi
```

**根据 CPU 架构选择 APK**：

- `arm64-v8a` → 安装 `app-xxhdpiArm64-v8a-debug.apk`
- `armeabi-v7a` → 安装 `app-xxhdpiArmeabi-v7a-debug.apk`

---

## 📦 第二步：安装 APK

### 2.1 卸载旧版本（如果存在）

```bash
# 卸载旧版本
adb uninstall com.chainlesschain.android

# 或者强制卸载（保留数据）
adb shell pm clear com.chainlesschain.android
```

### 2.2 安装新版本

```bash
# 进入项目目录
cd E:\code\chainlesschain

# 安装 APK（根据你的设备架构选择）
adb install android-app/app/build/outputs/apk/debug/app-xxhdpiArm64-v8a-debug.apk

# 期望输出：
# Performing Streamed Install
# Success
```

**如果安装失败**：

**错误：INSTALL_FAILED_UPDATE_INCOMPATIBLE**

```bash
# 解决方案：卸载旧版本
adb uninstall com.chainlesschain.android
# 然后重新安装
```

**错误：INSTALL_FAILED_INSUFFICIENT_STORAGE**

```bash
# 解决方案：清理手机存储空间，至少需要 200 MB
```

**错误：INSTALL_FAILED_OLDER_SDK**

```bash
# 解决方案：检查 Android 版本，最低需要 Android 8.0 (API 26)
adb shell getprop ro.build.version.sdk
```

### 2.3 验证安装

```bash
# 检查应用是否已安装
adb shell pm list packages | grep chainlesschain

# 期望输出：
# package:com.chainlesschain.android
```

---

## 🧪 第三步：基础功能测试

### 3.1 启动应用

```bash
# 启动应用
adb shell am start -n com.chainlesschain.android/.MainActivity

# 查看实时日志（另开一个终端）
adb logcat | grep -E "(ChainlessChain|AndroidRuntime)"
```

### 3.2 测试清单（按照顺序执行）

#### ✅ 测试 1: 首次启动和 PIN 码设置

**步骤**：

1. 应用启动 → 看到 SplashScreen
2. 进入 PIN 码设置页面
3. 输入 6 位数字（例如：123456）
4. 确认 PIN 码（再次输入 123456）

**预期结果**：

- ✅ 启动无崩溃
- ✅ PIN 码设置成功
- ✅ 自动导航到首页

**验证命令**：

```bash
# 查看数据库文件
adb shell ls -la /data/data/com.chainlesschain.android/files/

# 查看 SharedPreferences
adb shell cat /data/data/com.chainlesschain.android/shared_prefs/auth_prefs.xml
```

**可能的问题**：

- ❌ 如果崩溃，查看 logcat 输出
- ❌ 如果 PIN 设置失败，检查数据库权限

---

#### ✅ 测试 2: 首页功能入口

**步骤**：

1. 查看首页 → 应该看到 3x3 功能网格
2. 验证 9 个功能入口都显示正常

**预期结果**：

```
第一行：
✅ 知识库 (粉红色图标)
✅ AI对话 (绿色图标)
✅ LLM设置 (蓝色图标)

第二行：
✅ 社交广场 (紫色图标)
✅ 我的二维码 (玫红色图标)
✅ 扫码添加 (橙色图标)

第三行：
✅ 项目管理 (青色图标)
✅ 文件浏览 (浅绿色图标)
⚠️ 远程控制 (深橙色半透明 - 已禁用)
```

**验证命令**：

```bash
# 截图保存到电脑
adb shell screencap -p /sdcard/homepage.png
adb pull /sdcard/homepage.png ./homepage.png
```

---

#### ✅ 测试 3: 知识库功能

**步骤**：

1. 点击"知识库"卡片
2. 查看知识库列表（初始为空）
3. 点击右下角"+" → 创建新知识条目
4. 输入标题："测试笔记"
5. 输入内容："这是一个测试内容"
6. 点击"保存"
7. 返回列表，验证新条目显示

**预期结果**：

- ✅ 导航成功
- ✅ 列表正常显示
- ✅ 创建功能正常
- ✅ 数据持久化成功

**已知问题**（从代码审查）：

- ⚠️ Markdown 预览功能未完全实现（显示纯文本）

**验证命令**：

```bash
# 查看数据库中的知识条目
adb shell "su -c 'sqlite3 /data/data/com.chainlesschain.android/databases/knowledge.db \"SELECT * FROM notes;\"'"

# 如果没有 root 权限，导出数据库
adb exec-out run-as com.chainlesschain.android cat databases/knowledge.db > knowledge.db
```

---

#### ✅ 测试 4: AI 对话功能

**步骤**：

1. 返回首页
2. 点击"AI对话"卡片
3. 查看对话列表（初始为空）
4. 点击"新建对话"
5. 选择 LLM 提供商（例如：火山引擎）
6. **注意**：需要先配置 API Key

**配置 API Key**：

1. 返回首页 → 点击"LLM设置"
2. 选择提供商（火山引擎/OpenAI/Ollama）
3. 输入 API Key
4. 点击"测试连接"
5. 验证连接成功

**发送消息**：

1. 创建对话后，输入消息："你好"
2. 点击发送
3. 等待 AI 响应

**预期结果**：

- ✅ 导航成功
- ✅ 对话创建成功
- ✅ 消息发送成功
- ✅ 收到 AI 响应

**关键问题（从代码审查）**：

- ⚠️ **NPE 风险**：如果 API Key 未配置或无效，可能崩溃
- ⚠️ **流式响应**：网络中断时无重试机制

**验证命令**：

```bash
# 查看对话记录
adb logcat | grep "ConversationViewModel"

# 如果崩溃，查看崩溃日志
adb logcat | grep "AndroidRuntime: FATAL"
```

---

#### ✅ 测试 5: 社交功能

**步骤**：

1. 返回首页
2. 点击"社交广场" → 自动切换到"社交" Tab
3. 查看动态列表

**预期结果**：

- ✅ Tab 切换成功
- ⚠️ 可能显示空列表或模拟数据

**已知严重问题**（从代码审查）：

- ❌ **硬编码 DID**：使用 `did:example:123456`，无法正常工作
- ❌ **P2P 聊天未实现**：点击相关功能可能无响应

**测试二维码功能**：

1. 首页 → 点击"我的二维码"
2. 查看是否显示二维码
3. 返回首页 → 点击"扫码添加"
4. 授权相机权限
5. 尝试扫描二维码

**预期结果**：

- ✅ 二维码生成显示
- ✅ 相机权限请求
- ⚠️ 扫描功能可能有限制

---

#### ✅ 测试 6: 项目管理功能

**步骤**：

1. 返回首页
2. 点击"项目管理" → 自动切换到"项目" Tab
3. 查看项目列表

**预期结果**：

- ✅ Tab 切换成功
- ⚠️ 可能显示模拟数据

**已知问题**（从代码审查）：

- ⚠️ **使用模拟数据**：ProjectScreen 使用硬编码项目列表
- ⚠️ **搜索和排序未实现**

**测试创建项目**：

1. 点击"+" 创建新项目
2. 输入项目名称
3. 保存并查看

---

#### ✅ 测试 7: 文件浏览功能

**步骤**：

1. 返回首页
2. 点击"文件浏览"卡片
3. 授权存储权限（Android 13+ 需要）
4. 浏览文件系统

**预期结果**：

- ✅ 导航成功
- ✅ 权限请求正确
- ✅ 文件列表显示

**验证命令**：

```bash
# 检查权限
adb shell dumpsys package com.chainlesschain.android | grep permission
```

---

#### ✅ 测试 8: 底部导航

**步骤**：

1. 依次点击底部 4 个 Tab：
   - 首页
   - 项目
   - 社交
   - 我的

**预期结果**：

- ✅ Tab 切换流畅
- ✅ 状态保持正确
- ✅ 无崩溃

---

#### ✅ 测试 9: 退出登录

**步骤**：

1. 进入"我的" Tab
2. 找到"退出登录"按钮
3. 点击并确认

**预期结果**：

- ✅ 返回登录页面
- ✅ 需要重新输入 PIN

---

## 📊 第四步：性能测试

### 4.1 启动时间测试

```bash
# 测量冷启动时间
adb shell am force-stop com.chainlesschain.android
adb shell am start -W -n com.chainlesschain.android/.MainActivity

# 输出示例：
# Starting: Intent { cmp=com.chainlesschain.android/.MainActivity }
# Status: ok
# LaunchState: COLD
# Activity: com.chainlesschain.android/.MainActivity
# TotalTime: 1234  # 总启动时间（毫秒）
# WaitTime: 1250
```

**目标**：

- 冷启动 < 2 秒
- 温启动 < 1 秒

### 4.2 内存使用测试

```bash
# 查看内存使用
adb shell dumpsys meminfo com.chainlesschain.android

# 关键指标：
# TOTAL: 总内存使用
# Native Heap: 原生堆内存
# Dalvik Heap: Java 堆内存
```

**目标**：

- 空闲时 < 150 MB
- 活跃时 < 300 MB

### 4.3 CPU 使用测试

```bash
# 查看 CPU 使用
adb shell top -n 1 | grep chainlesschain

# 或使用 dumpsys
adb shell dumpsys cpuinfo | grep chainlesschain
```

**目标**：

- 空闲时 CPU < 5%
- 活跃时 CPU < 30%

---

## 🐛 第五步：崩溃和错误收集

### 5.1 实时日志监控

```bash
# 方式 1：只看应用日志
adb logcat --pid=$(adb shell pidof -s com.chainlesschain.android)

# 方式 2：过滤关键字
adb logcat | grep -E "(ChainlessChain|Error|Exception|FATAL)"

# 方式 3：保存到文件
adb logcat > app_test_log.txt
```

### 5.2 崩溃日志收集

```bash
# 如果应用崩溃，立即执行：
adb logcat -d | grep -A 50 "FATAL EXCEPTION"

# 或导出完整崩溃日志
adb bugreport > bugreport.zip
```

### 5.3 常见错误模式

**错误 1: NullPointerException**

```
查找代码位置：ConversationViewModel.kt:166
原因：userMessageResult.getOrNull()!!
解决：检查 API Key 配置
```

**错误 2: DID 服务失败**

```
查找代码位置：NavGraph.kt:394, SocialScreen.kt:32
原因：硬编码 did:example:123456
解决：暂时跳过社交功能测试
```

**错误 3: 数据库错误**

```
查找：SQLiteException
原因：数据库未初始化或权限问题
解决：清除应用数据重试
```

---

## 📝 第六步：填写测试报告

### 6.1 使用测试模板

创建 `TEST_REPORT_[日期].md`：

```markdown
## Android App 测试报告

**测试日期**: 2026-01-27
**测试人员**: [你的名字]
**设备信息**:

- 品牌/型号: [例如：小米 13]
- Android 版本: [例如：Android 13]
- CPU 架构: [arm64-v8a]

### 测试结果汇总

- 通过: X 项
- 失败: X 项
- 跳过: X 项

### 详细测试记录

#### 1. 首次启动和 PIN 码设置

- [x] 启动无崩溃
- [x] PIN 码设置成功
- [ ] 自动导航到首页（失败原因：...）

#### 2. 知识库功能

- [x] 创建知识条目
- [ ] Markdown 预览（已知问题：仅显示纯文本）

... (继续其他测试项)

### 发现的 Bug

1. **崩溃 - AI 对话发送消息**
   - 严重程度: 高
   - 重现步骤: 首页 → AI对话 → 新建对话 → 发送消息（无 API Key）
   - 错误日志: NullPointerException at ConversationViewModel.kt:166
   - 截图: [附件]

2. **功能缺失 - P2P 聊天**
   - 严重程度: 中
   - 描述: 点击 P2P 聊天按钮无响应

### 性能指标

- 冷启动时间: 1.5 秒 ✅
- 内存使用: 180 MB ✅
- CPU 使用: 8% ✅

### 改进建议

1. 修复所有非安全断言
2. 实现真实 DID 服务
3. 完善 P2P 聊天功能
```

---

## 🎯 测试优先级

### 🔴 必须测试（不通过不能发布）

- [ ] 应用启动无崩溃
- [ ] PIN 码设置和登录
- [ ] 首页 9 个入口显示正确
- [ ] 底部导航正常切换
- [ ] 知识库基本 CRUD
- [ ] AI 对话基本功能（需配置 API）

### 🟡 应该测试（重要但非阻塞）

- [ ] 社交功能（已知问题：硬编码 DID）
- [ ] 项目管理（已知问题：模拟数据）
- [ ] 文件浏览
- [ ] 二维码生成和扫描
- [ ] 性能指标测试

### 🟢 可选测试（用户体验）

- [ ] 长时间使用稳定性
- [ ] 不同网络环境测试
- [ ] 多设备兼容性
- [ ] 电量消耗测试

---

## 🔧 快速调试命令

```bash
# 清除应用数据（重置到初始状态）
adb shell pm clear com.chainlesschain.android

# 重启应用
adb shell am force-stop com.chainlesschain.android
adb shell am start -n com.chainlesschain.android/.MainActivity

# 查看应用 SharedPreferences
adb shell run-as com.chainlesschain.android ls shared_prefs/
adb shell run-as com.chainlesschain.android cat shared_prefs/auth_prefs.xml

# 导出数据库到电脑
adb exec-out run-as com.chainlesschain.android cat databases/chainlesschain.db > chainlesschain.db

# 查看文件权限
adb shell ls -la /data/data/com.chainlesschain.android/

# 截取视频（Android 10+）
adb shell screenrecord /sdcard/test_recording.mp4
# 按 Ctrl+C 停止录制
adb pull /sdcard/test_recording.mp4 ./test_recording.mp4
```

---

## ✅ 测试完成检查清单

测试完成后，确保：

- [ ] 填写了完整的测试报告
- [ ] 记录了所有崩溃日志
- [ ] 保存了关键截图
- [ ] 整理了发现的 Bug 列表
- [ ] 评估了性能指标
- [ ] 提出了改进建议

---

**祝测试顺利！** 🎉

如有问题，随时查看：

- `E2E_TEST_SUMMARY.md` - 详细测试策略
- `BUILD_SUCCESS_REPORT.md` - 已知问题列表
- `FEATURES_ACCESS_GUIDE.md` - 功能说明文档
