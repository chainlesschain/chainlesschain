# 快速测试指南 - 已修复功能

**APK 版本**: v0.26.2 (已更新)
**安装状态**: ✅ 已安装到设备 21e9bbfb

---

## 🎯 立即测试这3个已修复的功能

### ✅ 测试 1: 首页滚动功能

**步骤**:

1. 启动应用（如果未打开）
   ```bash
   adb shell am start -n com.chainlesschain.android.debug/com.chainlesschain.android.MainActivity
   ```
2. 在首页向上滚动
3. 检查是否能看到第三行的3个功能：
   - 项目管理 (青色)
   - 文件浏览 (绿色)
   - 远程控制 (半透明橙色)

**预期结果**: ✅ 可以滚动，能看到所有9个功能

---

### ✅ 测试 2: LLM 设置测试反馈

**步骤**:

1. 点击首页"LLM设置"卡片（蓝色）
2. 选择任意提供商（建议选 DOUBAO）
3. 输入 API Key（如果有的话）
4. 点击"测试连接"按钮
5. **观察**: 是否显示成功/失败消息卡片？

**预期结果**:

- ✅ 成功：显示绿色卡片 + "连接成功" + 详细消息
- ❌ 失败：显示红色卡片 + "连接失败" + 错误原因

---

### ✅ 测试 3: DOUBAO (豆包/火山引擎) 模型选择

**步骤**:

1. 返回首页
2. 点击"AI对话"卡片（绿色）
3. 点击"新建对话"按钮
4. 点击"选择模型"卡片
5. **检查**: 是否看到"豆包 (火山引擎)"选项？

**预期结果**:
✅ 应该显示以下模型列表:

```
📱 OpenAI
  - GPT-4o
  - GPT-4o Mini
  - GPT-3.5 Turbo

📱 DeepSeek
  - DeepSeek Chat
  - DeepSeek Coder

📱 豆包 (火山引擎)  ← 新增！
  - 豆包 Seed 1.6
  - 豆包 Seed 1.6 快速版
  - 豆包 Pro 32K
  - 豆包 Lite 32K

📱 Ollama (本地)
  - Qwen2
  - Llama 3
  - Gemma 2
```

---

## ⏳ 待调试的2个问题

### 问题 #4: Ollama 无法调用

**需要您提供的信息**:

1. **PC 上的 Ollama 是否运行？**

   ```bash
   # 在 PC PowerShell 中运行：
   curl http://localhost:11434/api/tags
   ```

   应该返回模型列表。如果报错，请启动 Ollama。

2. **PC 的 IP 地址是多少？**

   ```bash
   # 在 PC PowerShell 中运行：
   ipconfig | findstr IPv4
   ```

   记录类似 `192.168.x.x` 的地址

3. **Android 设备能否访问 PC？**

   ```bash
   # 在您的电脑上运行（假设 PC IP 是 192.168.1.100）：
   adb shell curl http://192.168.1.100:11434/api/tags
   ```

4. **应用中配置的 Ollama URL 是什么？**
   - 进入 LLM 设置
   - 选择 Ollama
   - 查看 Base URL 配置
   - 应该是: `http://<PC的IP>:11434`（不是 localhost！）

**常见错误**:

- ❌ 使用了 `http://localhost:11434` → Android 无法访问
- ✅ 应使用 `http://192.168.x.x:11434` → 局域网 IP

---

### 问题 #5: 文件浏览闪退 🔴 严重

**需要收集崩溃日志**:

1. **清空日志**:

   ```bash
   adb logcat -c
   ```

2. **点击"文件浏览"触发崩溃**

3. **立即收集日志**:

   ```bash
   adb logcat -d > file_browser_crash.log
   ```

4. **查看崩溃信息**:

   ```bash
   # PowerShell:
   Select-String -Path file_browser_crash.log -Pattern "FATAL|chainlesschain" -Context 10,20

   # 或者发送整个日志文件给我分析
   ```

**可能的原因**:

- 存储权限未授予
- MediaStore 扫描异常
- AI 分类功能 NPE

---

## 📋 测试反馈模板

测试完成后，请提供以下信息：

### 已修复功能测试结果

**1. 首页滚动**:

- [ ] ✅ 能看到所有9个功能
- [ ] ❌ 仍然无法滚动
- 备注: ****\_\_\_****

**2. LLM 设置反馈**:

- [ ] ✅ 显示测试结果消息
- [ ] ❌ 仍然没有反馈
- 反馈内容: ****\_\_\_****

**3. DOUBAO 模型**:

- [ ] ✅ 看到豆包选项和4个模型
- [ ] ❌ 仍然没有豆包选项
- 备注: ****\_\_\_****

### 待调试问题信息

**4. Ollama 调用**:

- PC Ollama 状态: [ ] 运行中 / [ ] 未运行
- PC IP 地址: ****\_\_\_****
- 配置的 URL: ****\_\_\_****
- curl 测试结果: ****\_\_\_****

**5. 文件浏览崩溃**:

- 已收集日志: [ ] 是 / [ ] 否
- 崩溃时机: [ ] 启动时 / [ ] 点击某功能
- 权限授予: [ ] 是 / [ ] 否
- 日志文件: file_browser_crash.log

---

## 🚀 快速命令参考

```bash
# 启动应用
adb shell am start -n com.chainlesschain.android.debug/com.chainlesschain.android.MainActivity

# 查看实时日志
adb logcat | findstr "chainlesschain"

# 清空日志
adb logcat -c

# 收集日志到文件
adb logcat -d > app.log

# 检查设备连接
adb devices

# 重新安装 APK（如果需要）
adb install -r android-app/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk

# 卸载应用（如果需要重置）
adb uninstall com.chainlesschain.android.debug
```

---

**准备好了吗？开始测试吧！** 🎉

有任何问题随时反馈！
