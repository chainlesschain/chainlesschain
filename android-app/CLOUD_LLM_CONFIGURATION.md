# 安卓端云LLM配置指南

## 概述
本文档说明如何在安卓应用中配置和使用云LLM服务。配置系统从桌面端移植，支持多个云LLM提供商。

## 支持的LLM提供商

| 提供商 | 说明 | 默认模型 | API密钥要求 |
|--------|------|----------|------------|
| **Ollama** | 本地LLM（推荐） | qwen2:7b | ❌ 不需要 |
| **OpenAI** | GPT系列 | gpt-4o-mini | ✅ 需要 |
| **DeepSeek** | DeepSeek Chat | deepseek-chat | ✅ 需要 |
| **Claude** | Anthropic Claude | claude-3-5-sonnet | ✅ 需要 |
| **豆包** | 火山引擎（字节跳动） | doubao-seed-1-6-251015 | ✅ 需要 |
| **通义千问** | 阿里云 | qwen-turbo | ✅ 需要 |
| **文心一言** | 百度 | ernie-bot-4 | ✅ 需要 |
| **智谱AI** | ChatGLM | glm-4 | ✅ 需要 |
| **月之暗面** | Kimi | moonshot-v1-8k | ✅ 需要 |
| **讯飞星火** | 科大讯飞 | spark-v3.5 | ✅ 需要 |
| **Gemini** | Google | gemini-pro | ✅ 需要 |
| **自定义** | OpenAI兼容API | - | ✅ 需要 |

---

## 配置架构

### 1. 配置存储
```kotlin
// 配置文件位置
SharedPreferences: "llm_config"        // 普通配置（模型、URL等）
EncryptedSharedPreferences: "llm_config_secure"  // 敏感配置（API Keys）
```

### 2. 配置结构
```kotlin
LLMConfiguration(
    provider = "ollama",                // 当前提供商
    ollama = OllamaConfig(...),        // Ollama配置
    openai = OpenAIConfig(...),        // OpenAI配置
    deepseek = DeepSeekConfig(...),    // DeepSeek配置
    // ... 其他提供商配置
    options = LLMOptions(               // 通用选项
        temperature = 0.7f,
        topP = 0.9f,
        topK = 40,
        maxTokens = 2000,
        timeout = 120000
    ),
    systemPrompt = "...",              // 系统提示词
    streamEnabled = true,              // 流式输出
    autoSaveConversations = true       // 自动保存对话
)
```

---

## 使用方法

### 方法1: 通过代码配置（推荐）

```kotlin
// 注入配置管理器
@Inject
lateinit var configManager: LLMConfigManager

// 加载配置
configManager.load()

// 配置Ollama（本地，无需API Key）
val ollamaConfig = OllamaConfig(
    url = "http://localhost:11434",
    model = "qwen2:7b",
    embeddingModel = "nomic-embed-text"
)

// 配置OpenAI
val openaiConfig = OpenAIConfig(
    apiKey = "sk-your-api-key-here",
    baseURL = "https://api.openai.com/v1",
    model = "gpt-4o-mini",
    embeddingModel = "text-embedding-3-small",
    organization = ""
)

// 配置DeepSeek
val deepseekConfig = DeepSeekConfig(
    apiKey = "sk-your-deepseek-key",
    baseURL = "https://api.deepseek.com/v1",
    model = "deepseek-chat"
)

// 保存完整配置
val config = configManager.getConfig().copy(
    provider = "openai",  // 或 "deepseek", "ollama" 等
    openai = openaiConfig,
    deepseek = deepseekConfig,
    ollama = ollamaConfig
)
configManager.save(config)

// 切换提供商
configManager.setProvider(LLMProvider.OPENAI)
```

### 方法2: 通过环境变量配置（临时测试）

配置管理器会自动从系统环境变量读取API Keys：
- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`
- 等等...

但由于安卓应用不建议使用环境变量，推荐使用方法1。

---

## 各提供商详细配置

### Ollama（本地LLM）
```kotlin
val config = OllamaConfig(
    url = "http://localhost:11434",
    model = "qwen2:7b",              // 或 llama3, deepseek-coder, mistral
    embeddingModel = "nomic-embed-text"
)
```

**注意**:
- 安卓设备上运行Ollama需要：
  - Termux或类似终端模拟器
  - 或通过网络连接到局域网内的Ollama服务器
- 推荐：在局域网PC上运行Ollama，安卓设备通过WiFi连接

### OpenAI
```kotlin
val config = OpenAIConfig(
    apiKey = "sk-proj-...",
    baseURL = "https://api.openai.com/v1",  // 或使用代理
    model = "gpt-4o-mini",                  // 或 gpt-4, gpt-3.5-turbo
    embeddingModel = "text-embedding-3-small",
    organization = ""                       // 可选
)
```

**获取API Key**: https://platform.openai.com/api-keys

### DeepSeek
```kotlin
val config = DeepSeekConfig(
    apiKey = "sk-...",
    baseURL = "https://api.deepseek.com/v1",
    model = "deepseek-chat"
)
```

**获取API Key**: https://platform.deepseek.com/

### Anthropic Claude
```kotlin
val config = AnthropicConfig(
    apiKey = "sk-ant-...",
    baseURL = "https://api.anthropic.com",
    model = "claude-3-5-sonnet-20241022",  // 或 claude-3-opus, claude-3-haiku
    version = "2023-06-01"
)
```

**获取API Key**: https://console.anthropic.com/

### 豆包（火山引擎）
```kotlin
val config = VolcengineConfig(
    apiKey = "your-volcano-api-key",
    baseURL = "https://ark.cn-beijing.volces.com/api/v3",
    model = "doubao-seed-1-6-251015",
    embeddingModel = "doubao-embedding-text-240715"
)
```

**获取API Key**: https://www.volcengine.com/

### 通义千问（阿里云）
```kotlin
val config = QwenConfig(
    apiKey = "sk-...",
    baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model = "qwen-turbo"                   // 或 qwen-plus, qwen-max
)
```

**获取API Key**: https://help.aliyun.com/zh/dashscope/

---

## 实战示例

### 示例1: 配置多个提供商并切换

```kotlin
class MyViewModel @Inject constructor(
    private val configManager: LLMConfigManager,
    private val llmAdapterFactory: LLMAdapterFactory
) {

    fun initializeLLMConfig() {
        // 加载配置
        configManager.load()

        // 配置多个提供商
        val config = configManager.getConfig().copy(
            provider = "ollama",  // 默认使用Ollama
            ollama = OllamaConfig(
                url = "http://192.168.1.100:11434",  // 局域网Ollama服务器
                model = "qwen2:7b"
            ),
            openai = OpenAIConfig(
                apiKey = "sk-your-openai-key",
                model = "gpt-4o-mini"
            ),
            deepseek = DeepSeekConfig(
                apiKey = "sk-your-deepseek-key",
                model = "deepseek-chat"
            )
        )

        // 保存配置
        configManager.save(config)
    }

    fun switchToOpenAI() {
        configManager.setProvider(LLMProvider.OPENAI)
    }

    fun switchToDeepSeek() {
        configManager.setProvider(LLMProvider.DEEPSEEK)
    }

    fun getCurrentAdapter(): LLMAdapter {
        val provider = configManager.getProvider()
        val apiKey = configManager.getApiKey(provider)
        return llmAdapterFactory.createAdapter(provider, apiKey)
    }
}
```

### 示例2: 文件摘要使用云LLM

```kotlin
class FileSummarizerViewModel @Inject constructor(
    private val fileSummarizer: FileSummarizer,
    private val configManager: LLMConfigManager
) {

    suspend fun summarizeFileWithCloudLLM(uri: Uri) {
        // 切换到云LLM
        configManager.setProvider(LLMProvider.DEEPSEEK)

        // 生成摘要（自动使用DeepSeek）
        val result = fileSummarizer.summarizeFromUri(
            contentResolver = context.contentResolver,
            uri = uri,
            maxLength = FileSummarizer.LENGTH_MEDIUM
        )

        when (result) {
            is FileSummarizer.SummaryResult -> {
                println("摘要: ${result.summary}")
                println("关键点: ${result.keyPoints}")
                println("方法: ${result.method}")  // LLM
            }
            else -> println("摘要失败")
        }
    }
}
```

### 示例3: 验证配置

```kotlin
fun validateCurrentConfig() {
    val (isValid, errors) = configManager.validate()

    if (isValid) {
        Log.i(TAG, "配置有效")
    } else {
        Log.e(TAG, "配置错误:")
        errors.forEach { error ->
            Log.e(TAG, "  - $error")
        }
    }
}
```

---

## 安全最佳实践

### 1. API Key安全存储
✅ **正确做法**:
```kotlin
// API Keys自动加密存储在EncryptedSharedPreferences
configManager.save(config)  // API Key会自动加密
```

❌ **错误做法**:
```kotlin
// 不要在代码中硬编码API Key
val apiKey = "sk-1234567890..."  // ❌ 危险！

// 不要存储在普通SharedPreferences
prefs.edit().putString("api_key", apiKey).apply()  // ❌ 不安全！
```

### 2. 最小权限原则
- 只配置需要使用的提供商
- 定期轮换API Keys
- 使用子账号而非主账号API Key

### 3. 网络安全
- 所有云LLM请求都使用HTTPS
- 验证SSL证书
- 避免在公共WiFi下配置API Keys

---

## 从桌面端迁移配置

如果你已经在桌面端配置了LLM，可以手动复制配置：

1. **桌面端配置文件位置**:
   - Windows: `%APPDATA%/chainlesschain-desktop-vue/llm-config.json`
   - macOS: `~/Library/Application Support/chainlesschain-desktop-vue/llm-config.json`
   - Linux: `~/.config/chainlesschain-desktop-vue/llm-config.json`

2. **迁移步骤**:
   ```kotlin
   // 复制API Keys到安卓应用
   val config = configManager.getConfig().copy(
       provider = "openai",  // 从桌面端复制
       openai = OpenAIConfig(
           apiKey = "sk-...",  // 从桌面端复制
           baseURL = "https://api.openai.com/v1",
           model = "gpt-4o-mini"
       ),
       // ... 其他配置
   )
   configManager.save(config)
   ```

---

## 故障排查

### 问题1: API Key无效
```
错误: "API Key不能为空"
```

**解决方案**:
```kotlin
// 检查API Key是否已配置
val apiKey = configManager.getApiKey(LLMProvider.OPENAI)
println("API Key: ${apiKey.take(10)}...")  // 只打印前10个字符

// 重新配置
val config = configManager.getConfig().copy(
    openai = configManager.getConfig().openai.copy(
        apiKey = "sk-your-correct-key"
    )
)
configManager.save(config)
```

### 问题2: Ollama连接失败
```
错误: "Ollama连接失败"
```

**解决方案**:
```kotlin
// 检查Ollama URL
val url = configManager.getConfig().ollama.url
println("Ollama URL: $url")

// 确保Ollama服务运行
// 在局域网PC上: ollama serve
// 安卓设备可以访问: http://192.168.x.x:11434

// 更新URL
val config = configManager.getConfig().copy(
    ollama = OllamaConfig(
        url = "http://192.168.1.100:11434",  // 使用PC的IP
        model = "qwen2:7b"
    )
)
configManager.save(config)
```

### 问题3: 加密存储失败
```
错误: "保存敏感配置失败"
```

**解决方案**:
- 确保设备支持EncryptedSharedPreferences（API 23+）
- 清除应用数据重试
- 检查存储权限

---

## API费用参考

| 提供商 | 输入价格 | 输出价格 | 备注 |
|--------|---------|---------|------|
| OpenAI GPT-4o-mini | $0.15/1M tokens | $0.60/1M tokens | 推荐 |
| DeepSeek | ¥0.1/1M tokens | ¥0.2/1M tokens | 非常便宜 |
| Claude Sonnet | $3/1M tokens | $15/1M tokens | 质量高 |
| 豆包 | ¥0.3-1/1M tokens | ¥0.6-2/1M tokens | 国内快 |
| Ollama | **免费** | **免费** | 本地运行 |

---

## 总结

### 推荐配置方案

#### 方案1: 纯本地（完全免费）
```kotlin
provider = "ollama"
ollama.url = "http://localhost:11434"  // 或局域网PC
ollama.model = "qwen2:7b"
```

#### 方案2: 本地+云端备份
```kotlin
provider = "ollama"           // 主要使用本地
// 配置DeepSeek作为备份（便宜）
deepseek.apiKey = "sk-..."
deepseek.model = "deepseek-chat"
```

#### 方案3: 纯云端（高质量）
```kotlin
provider = "openai"           // 或 "claude"
openai.apiKey = "sk-..."
openai.model = "gpt-4o-mini"
```

---

## 相关文档
- [AI功能集成报告](AI_FEATURES_INTEGRATION_SUMMARY.md)
- [桌面端LLM配置](../desktop-app-vue/src/main/llm/llm-config.js)
- [Ollama官方文档](https://github.com/ollama/ollama)

---

**配置完成后，所有AI功能（文件摘要、聊天等）将自动使用你选择的LLM提供商！** 🚀
