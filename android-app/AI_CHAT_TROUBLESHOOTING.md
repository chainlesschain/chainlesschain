# Android AI聊天功能故障排查指南

## 问题：输入消息后没有任何反应

### 可能原因和解决方案

#### 1. API Key未配置或配置错误

**症状**：

- 输入消息后没有响应
- 界面底部可能显示警告卡片："未配置XX API Key"

**解决方案**：

1. 点击顶部的"设置"按钮（齿轮图标）
2. 选择对应的AI提供商（如：豆包、DeepSeek等）
3. 输入正确的API Key
4. 返回聊天界面重试

**如何获取API Key**：

- **豆包（字节跳动）**：访问 https://www.volcengine.com/product/doubao
- **DeepSeek**：访问 https://platform.deepseek.com/
- **OpenAI**：访问 https://platform.openai.com/

#### 2. 错误提示不明显

**修复后的显示方式**：

- ✅ 消息列表中会显示红色错误卡片
- ✅ 底部会弹出Snackbar提示
- ✅ 未配置API Key时会显示橙色警告卡片

#### 3. 网络连接问题

**检查方法**：

1. 确保手机/模拟器可以访问互联网
2. 如果使用国内模型（豆包、通义千问等），确保网络可达
3. 如果使用国外模型（OpenAI、Claude等），可能需要代理

**查看日志**：

```bash
# 连接Android设备后，运行以下命令查看详细日志
adb logcat | grep -E "ConversationViewModel|LLMAdapter|ChatScreen"
```

#### 4. 模型选择错误

**检查方法**：

- 查看聊天界面顶部显示的模型名称
- 确保选择的是真实存在的模型

**豆包支持的模型**（2024-12）：

- `doubao-seed-1-8-251228` - 豆包 Seed 1.8（推荐）
- `doubao-seed-1-6-251015` - 豆包 Seed 1.6
- `doubao-pro-32k-240515` - 豆包 Pro 32K
- `doubao-lite-32k-240515` - 豆包 Lite 32K

#### 5. 对话未正确创建

**症状**：

- 聊天界面打开了，但实际没有对话ID

**解决方案**：

1. 返回对话列表
2. 点击"新建对话"按钮
3. 选择模型
4. 输入API Key（如果需要）
5. 点击"创建"按钮
6. 等待创建成功后自动跳转到聊天界面

## 完整的测试流程

### 方法1：使用本地Ollama（无需API Key）

1. 启动Ollama服务：

   ```bash
   ollama serve
   ollama pull qwen2:7b
   ```

2. 在Android应用中：
   - 新建对话
   - 选择"Ollama (本地)" → "Qwen2 7B"
   - 创建对话
   - 输入消息测试

### 方法2：使用云端模型（需要API Key）

1. 获取API Key（以豆包为例）：
   - 访问火山引擎控制台
   - 创建应用并获取API Key

2. 在Android应用中：
   - 新建对话
   - 选择"豆包 (火山引擎)" → "豆包 Seed 1.8"
   - 输入API Key
   - 创建对话
   - 输入"你好"测试

## 查看详细日志

### 使用Android Studio Logcat

1. 打开Android Studio
2. 底部选择"Logcat"标签页
3. 过滤器输入：`ConversationViewModel`
4. 发送消息后查看日志输出

**关键日志**：

```
D/ConversationViewModel: sendMessage called with content: 你好
D/ConversationViewModel: Current conversation: id=xxx, model=doubao-seed-1-8-251228
D/ConversationViewModel: Detected provider: DOUBAO for model: doubao-seed-1-8-251228
D/ConversationViewModel: API Key present: true
D/ConversationViewModel: Starting message send process
D/ConversationViewModel: Calling sendMessageStream with provider=DOUBAO
D/ConversationViewModel: Received chunk: content='你好', isDone=false
D/ConversationViewModel: Stream complete, total response length: 123
```

**错误日志示例**：

```
E/ConversationViewModel: No conversation loaded! Cannot send message.
W/ConversationViewModel: API Key missing for provider: DOUBAO
E/ConversationViewModel: Stream error: Connection failed
```

### 使用adb命令

```bash
# 实时查看日志
adb logcat | grep -E "ConversationViewModel|LLMAdapter"

# 保存日志到文件
adb logcat -d > android_logs.txt

# 查看特定时间段的日志
adb logcat -t '12-25 18:30:00.000'
```

## 常见错误信息及解决方案

| 错误信息                 | 原因           | 解决方案              |
| ------------------------ | -------------- | --------------------- |
| "请先创建或选择一个对话" | 没有加载对话   | 返回列表重新进入对话  |
| "请先配置XX API Key"     | API Key未配置  | 在设置中配置API Key   |
| "消息不能为空"           | 发送了空消息   | 输入内容后再发送      |
| "添加消息失败"           | 数据库写入失败 | 检查应用权限          |
| "Connection failed"      | 网络连接失败   | 检查网络连接          |
| "Invalid API Key"        | API Key错误    | 重新配置正确的API Key |
| "Model not found"        | 模型不存在     | 选择支持的模型        |

## 修复后的改进

1. **更明显的错误提示**：
   - 在消息列表中显示红色错误卡片
   - 包含错误标题和详细信息
   - 可以手动关闭

2. **API Key状态指示**：
   - 输入框上方显示警告卡片
   - 提供"去设置"快捷按钮

3. **详细的日志输出**：
   - 记录每个关键步骤
   - 包含错误堆栈信息

## 需要进一步帮助？

如果问题仍未解决：

1. **收集日志**：

   ```bash
   adb logcat -d > debug_logs.txt
   ```

2. **截图错误信息**

3. **提供以下信息**：
   - 使用的AI提供商和模型
   - 是否配置了API Key
   - 完整的错误日志
   - Android版本和设备型号

4. **提交Issue**：
   - 访问项目GitHub仓库
   - 创建新的Issue
   - 附上以上信息
