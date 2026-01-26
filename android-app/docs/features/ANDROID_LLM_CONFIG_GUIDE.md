# Android端LLM配置和测试指南

## 📋 概述

Android端现在支持完整的LLM配置功能，包括：
- ✅ 14+云端LLM提供商配置
- ✅ API密钥加密存储（AES-256-GCM）
- ✅ Ollama本地服务自动发现
- ✅ LLM连接测试
- ✅ 流式对话测试
- ✅ 性能监控和统计

## 🚀 快速开始

### 1. 配置LLM提供商

#### 步骤：
1. 打开App，进入"我的"页面
2. 点击"AI配置"菜单项
3. 选择你要配置的提供商（如：火山引擎Doubao）
4. 输入API密钥
5. 点击"测试连接"验证配置
6. 点击"保存"保存配置

#### 支持的提供商：

| 提供商 | 模型 | 获取密钥 |
|--------|------|----------|
| **火山引擎Doubao** | doubao-pro-32k | [console.volcengine.com/ark](https://console.volcengine.com/ark) |
| **DeepSeek** | deepseek-chat, deepseek-coder | [platform.deepseek.com](https://platform.deepseek.com) |
| **OpenAI** | gpt-4, gpt-3.5-turbo | [platform.openai.com](https://platform.openai.com) |
| **Claude (Anthropic)** | claude-3-opus/sonnet/haiku | [console.anthropic.com](https://console.anthropic.com) |
| **Gemini (Google)** | gemini-pro | [ai.google.dev](https://ai.google.dev) |
| **通义千问 (Qwen)** | qwen-max/plus/turbo | [dashscope.aliyun.com](https://dashscope.aliyun.com) |
| **文心一言 (Ernie)** | ernie-bot-4.0 | [console.bce.baidu.com/qianfan](https://console.bce.baidu.com/qianfan) |
| **智谱清言 (ChatGLM)** | glm-4, glm-3-turbo | [open.bigmodel.cn](https://open.bigmodel.cn) |
| **Kimi (Moonshot)** | moonshot-v1-8k/32k/128k | [platform.moonshot.cn](https://platform.moonshot.cn) |
| **讯飞星火 (Spark)** | spark-v3.5 | [console.xfyun.cn](https://console.xfyun.cn) |
| **Ollama (本地)** | qwen2, llama3, deepseek-coder | 无需密钥 |

---

## 🔐 火山引擎（Doubao）配置示例

### 获取API密钥：
1. 访问 [火山引擎控制台](https://console.volcengine.com/ark)
2. 开通"火山方舟"服务
3. 创建API密钥（API Key）
4. 复制密钥

### 在App中配置：
1. 打开"AI配置" → 选择"火山引擎Doubao"
2. 粘贴API密钥
3. 点击"测试连接"
4. 看到"✅ 连接成功！可以开始使用"后，点击"保存"

### 测试对话：
1. 返回主界面
2. 进入"AI对话"或"LLM测试"
3. 发送消息："你好，请介绍一下自己"
4. 观察流式响应和性能统计

---

## 🏠 Ollama本地服务配置

### 前提条件：
- PC端已安装并运行Ollama
- 手机和PC在同一局域网
- PC防火墙允许11434端口

### 自动发现（推荐）：
1. 打开"AI配置" → 选择"Ollama"
2. 点击右上角WiFi图标（自动发现）
3. 等待扫描完成（约5-10秒）
4. 从发现的服务列表中选择PC地址
5. 自动测试连接

### 手动配置：
1. 在PC上运行：`ollama serve`
2. 查看PC的局域网IP（如：`192.168.1.100`）
3. 在App中输入：`http://192.168.1.100:11434`
4. 点击"测试连接"
5. 看到可用模型列表后即配置成功

### 局域网发现原理：
- 扫描常见IP段（`192.168.x.1-10`）
- 测试11434端口的`/api/tags`接口
- 自动验证Ollama服务可用性

---

## 🧪 LLM测试功能

### 测试对话界面功能：
1. **流式响应**: 实时显示AI回复，逐字输出
2. **性能统计**:
   - 响应时间（毫秒）
   - Token使用量
   - 消息数量
   - 成功率
3. **RAG开关**: 测试知识库检索增强生成
4. **清空对话**: 快速重新测试

### 测试场景建议：

#### 基础对话测试：
```
用户: 你好，请介绍一下自己
预期: 正常响应，介绍模型信息
```

#### 流式响应测试：
```
用户: 写一篇200字的文章，主题是人工智能
预期: 逐字显示，流畅输出
```

#### 代码生成测试：
```
用户: 用Python写一个快速排序算法
预期: 输出格式化代码
```

#### RAG功能测试：
```
1. 启用RAG开关
2. 发送: "ChainlessChain项目的主要功能是什么？"
3. 预期: 从知识库中检索相关信息
```

---

## 🔒 安全性说明

### API密钥加密存储：
- 使用Android EncryptedSharedPreferences
- AES-256-GCM加密
- 密钥存储在Android Keystore
- 仅本应用可访问

### 存储位置：
```
/data/data/com.chainlesschain.android/shared_prefs/
chainlesschain_secure_prefs.xml (加密)
```

### 查看已保存的密钥：
```kotlin
// 仅供调试，生产环境不应暴露
val securePreferences = SecurePreferences(context)
val apiKey = securePreferences.getApiKeyForProvider("DOUBAO")
```

---

## 📊 性能统计说明

### 响应时间：
- 测量从发送请求到收到完整响应的时间
- 包括网络延迟 + 模型推理时间
- 单位：毫秒（ms）

### Token统计：
- 估算方法：中文1字符=1token，英文4字符=1token
- 实际Token数需要使用tokenizer精确计算
- 用于成本估算和性能分析

### 成功率：
- 成功消息数 / 总消息数 × 100%
- 帮助评估API稳定性

---

## 🐛 故障排查

### 问题1：连接失败
**症状**: "❌ 连接失败，请检查API密钥和网络"

**解决方案**:
1. 检查API密钥是否正确
2. 检查网络连接
3. 确认API服务未欠费
4. 查看详细错误日志

### 问题2：Ollama自动发现失败
**症状**: "未发现服务"

**解决方案**:
1. 确认PC端Ollama正在运行：`ollama list`
2. 检查防火墙是否允许11434端口
3. 手机和PC在同一WiFi网络
4. 尝试手动输入PC的IP地址

### 问题3：流式响应卡顿
**症状**: 消息输出不连贯

**解决方案**:
1. 检查网络延迟
2. 尝试切换到更快的模型
3. 减少max_tokens参数
4. 检查服务器负载

### 问题4：API密钥丢失
**症状**: 重启后需要重新配置

**可能原因**:
- App数据被清除
- 设备重置
- 加密密钥损坏

**解决方案**:
- 重新输入API密钥
- 不要清除App数据

---

## 🔧 开发者信息

### 关键文件位置：

```
android-app/
├── app/src/main/java/com/chainlesschain/android/presentation/screens/
│   ├── LLMSettingsScreen.kt          # LLM设置界面
│   ├── LLMSettingsViewModel.kt       # 设置逻辑
│   ├── LLMTestChatScreen.kt          # 测试对话界面
│   └── LLMTestChatViewModel.kt       # 测试对话逻辑
├── core-security/src/main/java/com/chainlesschain/android/core/security/
│   └── SecurePreferences.kt          # 加密存储
└── feature-ai/src/main/java/com/chainlesschain/android/feature/ai/
    ├── data/llm/
    │   ├── CloudLLMAdapters.kt       # 云端LLM适配器
    │   ├── OpenAIAdapter.kt          # OpenAI/DeepSeek/Ollama
    │   └── LLMAdapter.kt             # 接口定义
    └── di/AIModule.kt                # 依赖注入和工厂
```

### API调用流程：

```
UI (LLMSettingsScreen)
  ↓
ViewModel (LLMSettingsViewModel)
  ↓
Factory (LLMAdapterFactory)
  ↓
Adapter (DoubaoAdapter, DeepSeekAdapter, etc.)
  ↓
HTTP Client (OkHttp)
  ↓
LLM API (Doubao, DeepSeek, etc.)
```

### 添加新提供商：

1. 在`CloudLLMAdapters.kt`中创建新适配器类
2. 在`LLMProvider`枚举中添加新提供商
3. 在`LLMAdapterFactory.createCloudAdapter`中添加反射调用
4. 在`LLMSettingsScreen`的帮助信息中添加获取密钥的链接

---

## 📝 测试清单

使用火山引擎API密钥完成以下测试：

- [ ] 配置火山引擎API密钥
- [ ] 测试连接成功
- [ ] 保存配置
- [ ] 发送基础对话消息
- [ ] 观察流式响应
- [ ] 检查性能统计（响应时间、Token数）
- [ ] 启用RAG测试知识库检索
- [ ] 清空对话重新测试
- [ ] 切换到其他提供商（如DeepSeek）
- [ ] 测试Ollama本地服务（如有条件）

---

## 🎯 下一步计划

1. **模型选择器**: 在对话界面动态切换模型
2. **成本追踪**: 详细的Token使用和成本分析
3. **对话历史**: 保存和恢复测试对话
4. **批量测试**: 自动化测试多个提供商
5. **性能对比**: 横向对比不同提供商的性能

---

## 📞 支持

遇到问题？
- 查看日志：`adb logcat | grep ChainlessChain`
- 提交Issue：[GitHub Issues](https://github.com/ChainlessChain/android-app/issues)
- 联系开发者

---

**最后更新**: 2026-01-25
**版本**: v0.17.0
