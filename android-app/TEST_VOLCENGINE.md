# 火山引擎豆包 API 测试指南

## 测试配置

**API Key**: `7185ce7d-9775-450c-8450-783176be6265`
**模型ID**: `doubao-seed-1-6-251015`
**端点**: `https://ark.cn-beijing.volces.com/api/v3`

## 在Android App中测试步骤

### 方法1: 通过UI界面测试

1. 打开APP，进入 **设置 → AI配置**
2. 选择 **豆包 (火山引擎)** 提供商
3. 输入API Key: `7185ce7d-9775-450c-8450-783176be6265`
4. 点击 **测试连接** 按钮
5. 查看连接状态（应显示✅ 连接成功）
6. 点击 **保存** 保存配置

### 方法2: 通过测试对话界面

1. 保存配置后，进入 **AI对话** 或 **项目详情**
2. 选择模型: `豆包 Seed 1.6`
3. 发送测试消息: "你好，请介绍一下你自己"
4. 观察流式响应

### 方法3: 单元测试（可选）

创建测试文件测试DoubaoAdapter:

```kotlin
@Test
fun testDoubaoConnection() = runTest {
    val apiKey = "7185ce7d-9775-450c-8450-783176be6265"
    val adapter = DoubaoAdapter(apiKey)

    // 测试连接
    val available = adapter.checkAvailability()
    assert(available) { "豆包API应该可用" }

    // 测试对话
    val messages = listOf(
        Message(
            id = "1",
            conversationId = "test",
            role = MessageRole.USER,
            content = "你好",
            createdAt = System.currentTimeMillis()
        )
    )

    val response = adapter.chat(
        messages = messages,
        model = "doubao-seed-1-6-251015",
        temperature = 0.7f,
        maxTokens = 100
    )

    assert(response.isNotEmpty()) { "应该收到响应" }
    println("响应: $response")
}

@Test
fun testDoubaoStreamChat() = runTest {
    val apiKey = "7185ce7d-9775-450c-8450-783176be6265"
    val adapter = DoubaoAdapter(apiKey)

    val messages = listOf(
        Message(
            id = "1",
            conversationId = "test",
            role = MessageRole.USER,
            content = "用一句话介绍Android",
            createdAt = System.currentTimeMillis()
        )
    )

    val chunks = mutableListOf<String>()
    adapter.streamChat(
        messages = messages,
        model = "doubao-seed-1-6-251015"
    ).collect { chunk ->
        chunks.add(chunk.content)
        println("Chunk: ${chunk.content}")
    }

    assert(chunks.isNotEmpty()) { "应该收到流式响应" }
}
```

## 预期结果

### 成功标志

- ✅ API密钥验证通过
- ✅ 可以发送消息并收到响应
- ✅ 流式响应正常工作
- ✅ 响应内容为中文（豆包优化了中文）

### 可能的错误

#### 错误1: API密钥无效
```
❌ 连接失败: HTTP 401
```
**解决**: 检查API Key是否正确复制

#### 错误2: 模型ID不存在
```
❌ 连接失败: model not found
```
**解决**: 确认使用 `doubao-seed-1-6-251015` 而非 `doubao-seed-1.6`

#### 错误3: 网络超时
```
❌ 连接失败: timeout
```
**解决**: 检查网络连接，尝试使用VPN

#### 错误4: 配额耗尽
```
❌ 连接失败: quota exceeded
```
**解决**: 火山引擎账户余额不足或超出免费额度

## 其他云提供商测试

在成功测试豆包后，可以尝试其他提供商：

1. **OpenAI** - 需要自己的API Key
2. **DeepSeek** - 需要自己的API Key
3. **Claude** - 需要Anthropic API Key
4. **Gemini** - 需要Google AI API Key

## 注意事项

- API Key已加密存储在 `SecurePreferences`
- 不要将API Key提交到Git仓库
- 火山引擎豆包支持256K上下文
- 流式响应延迟较低，适合实时对话
