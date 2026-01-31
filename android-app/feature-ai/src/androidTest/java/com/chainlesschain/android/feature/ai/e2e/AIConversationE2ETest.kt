package com.chainlesschain.android.feature.ai.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.core.network.test.NetworkSimulator
import com.chainlesschain.android.core.network.test.enqueueLLMResponse
import com.chainlesschain.android.core.network.test.enqueueLLMStreamResponse
import com.chainlesschain.android.test.*
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * AI 对话 E2E 测试
 *
 * 测试完整的 AI 对话流程，包括流式响应、模型切换、RAG等
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AIConversationE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 2)
    val networkSimulator = NetworkSimulator()

    @Before
    fun setup() {
        hiltRule.inject()
        composeTestRule.waitForLoadingToComplete()
        navigateToAIChat()
    }

    private fun navigateToAIChat() {
        composeTestRule.apply {
            clickOnText("AI助手", substring = true)
            waitForLoadingToComplete()
        }
    }

    /**
     * E2E-AI-01: 完整对话流程
     * 创建→发送→流式响应→压缩
     */
    @Test
    fun testCompleteConversationFlow() {
        // 模拟流式响应
        networkSimulator.enqueueLLMStreamResponse(
            chunks = listOf("Hello", " there", "! How", " can", " I", " help", " you", "?")
        )

        composeTestRule.apply {
            // 1. 创建新会话
            clickOnText("新建对话")
            waitForLoadingToComplete()

            // 2. 发送消息
            val userMessage = "What is Kotlin?"
            typeTextInField("输入消息", userMessage)
            clickOnText("发送")

            // 3. 验证用户消息显示
            assertTextExists(userMessage)

            // 4. 等待流式响应完成
            waitForText("Hello there! How can I help you?", substring = true, timeoutMillis = 10000)

            // 5. 验证助手回复
            assertTextExists("Hello there! How can I help you?", substring = true)

            // 6. 验证会话已保存
            clickBackButton()
            assertTextExists(userMessage, substring = true)
        }
    }

    /**
     * E2E-AI-02: 模型切换测试
     */
    @Test
    fun testModelSwitching() {
        val models = listOf("GPT-4", "Claude", "Gemini")

        composeTestRule.apply {
            clickOnText("新建对话")
            waitForLoadingToComplete()

            models.forEach { model ->
                // 打开模型选择器
                clickOnText("模型", substring = true)
                waitForLoadingToComplete()

                // 选择模型
                clickOnText(model)
                waitForLoadingToComplete()

                // 验证模型已切换
                assertTextExists(model, substring = true)

                // 发送测试消息
                networkSimulator.enqueueLLMResponse("Response from $model", model = model.lowercase())
                typeTextInField("输入消息", "Hello from $model")
                clickOnText("发送")
                waitForText("Response from $model", substring = true, timeoutMillis = 5000)
                assertTextExists("Response from $model", substring = true)
            }
        }
    }

    /**
     * E2E-AI-03: API Key 配置测试
     */
    @Test
    fun testAPIKeyConfiguration() {
        composeTestRule.apply {
            // 1. 打开设置
            clickOnText("设置")
            waitForLoadingToComplete()

            // 2. 打开API Key配置
            clickOnText("API Keys")
            waitForLoadingToComplete()

            // 3. 配置OpenAI API Key
            clickOnText("OpenAI")
            typeTextInField("API Key", "sk-test-key-123456")
            clickOnText("保存")
            assertSnackbarMessage("API Key已保存")

            // 4. 验证配置成功
            clickBackButton()
            assertTextExists("已配置", substring = true)

            // 5. 测试清除API Key
            clickOnText("OpenAI")
            clickOnText("清除")
            clickOnText("确认")
            assertSnackbarMessage("已清除")
        }
    }

    /**
     * E2E-AI-04: RAG 检索增强测试
     */
    @Test
    fun testRAGRetrieval() {
        // 准备知识库内容
        val knowledgeContent = "Kotlin is a modern programming language developed by JetBrains"

        composeTestRule.apply {
            // 1. 启用RAG
            clickOnText("新建对话")
            clickOnText("设置", substring = true)
            clickOnText("启用知识库检索")
            clickBackButton()

            // 2. 发送需要检索的问题
            networkSimulator.enqueueLLMResponse(
                "Based on the knowledge base: $knowledgeContent. Kotlin is a statically typed language."
            )

            typeTextInField("输入消息", "Tell me about Kotlin")
            clickOnText("发送")

            // 3. 等待响应
            waitForText("knowledge base", substring = true, timeoutMillis = 10000)

            // 4. 验证检索到的内容被引用
            assertTextExists("Kotlin is a statically typed language", substring = true)

            // 5. 查看检索来源
            clickOnText("来源", substring = true)
            assertTextExists(knowledgeContent, substring = true)
        }
    }

    /**
     * E2E-AI-05: Token 统计测试
     */
    @Test
    fun testTokenStatistics() {
        networkSimulator.enqueueLLMResponse(
            content = "This is a test response",
            model = "gpt-4"
        )

        composeTestRule.apply {
            clickOnText("新建对话")

            // 发送消息
            typeTextInField("输入消息", "Hello AI")
            clickOnText("发送")
            waitForLoadingToComplete()

            // 查看Token统计
            clickOnText("统计", substring = true)
            waitForLoadingToComplete()

            // 验证统计信息
            assertTextExists("Prompt Tokens", substring = true)
            assertTextExists("Completion Tokens", substring = true)
            assertTextExists("Total Tokens", substring = true)
            assertTextExists("估算费用", substring = true)
        }
    }

    /**
     * E2E-AI-06: 会话压缩触发测试 (50+ 消息)
     */
    @Test
    fun testSessionCompressionTrigger() {
        composeTestRule.apply {
            clickOnText("新建对话")

            // 发送50+条消息触发压缩
            repeat(52) { index ->
                networkSimulator.enqueueLLMResponse("Response $index")
                typeTextInField("输入消息", "Message $index")
                clickOnText("发送")
                waitForLoadingToComplete()
            }

            // 验证压缩通知
            assertSnackbarMessage("会话已自动压缩", timeoutMillis = 5000)

            // 查看压缩历史
            clickOnText("历史", substring = true)
            assertTextExists("压缩记录", substring = true)
            assertTextExists("节省 30-40% tokens", substring = true)
        }
    }

    /**
     * E2E-AI-07: KV-Cache 优化测试
     */
    @Test
    fun testKVCacheOptimization() {
        composeTestRule.apply {
            clickOnText("新建对话")
            clickOnText("设置")
            clickOnText("启用 KV-Cache")
            clickBackButton()

            // 发送首条消息（建立cache）
            networkSimulator.enqueueLLMResponse("First response")
            typeTextInField("输入消息", "First message")
            clickOnText("发送")
            waitForLoadingToComplete()

            // 发送后续消息（使用cache）
            networkSimulator.enqueueLLMResponse("Second response (cached)")
            typeTextInField("输入消息", "Second message")
            clickOnText("发送")
            waitForLoadingToComplete()

            // 验证cache生效（响应更快）
            assertTextExists("Second response (cached)", substring = true)

            // 查看统计
            clickOnText("统计")
            assertTextExists("Cache 命中", substring = true)
        }
    }

    /**
     * E2E-AI-08: 多模型并发测试
     */
    @Test
    fun testMultiModelConcurrent() {
        composeTestRule.apply {
            // 打开多模型对比
            clickOnText("多模型对比")
            waitForLoadingToComplete()

            // 选择多个模型
            clickOnText("添加模型")
            clickOnText("GPT-4")
            clickOnText("添加模型")
            clickOnText("Claude")

            // 发送消息到所有模型
            networkSimulator.enqueueMultiple(
                networkSimulator.createMockResponse("GPT-4 response"),
                networkSimulator.createMockResponse("Claude response")
            )

            typeTextInField("输入消息", "Compare this")
            clickOnText("发送给所有模型")

            // 等待所有响应
            waitForText("GPT-4 response", timeoutMillis = 10000)
            waitForText("Claude response", timeoutMillis = 10000)

            // 验证并发响应
            assertTextExists("GPT-4 response")
            assertTextExists("Claude response")
        }
    }

    /**
     * E2E-AI-09: 错误处理测试（网络失败）
     */
    @Test
    fun testErrorHandlingNetworkFailure() {
        composeTestRule.apply {
            clickOnText("新建对话")

            // 模拟网络错误
            networkSimulator.enqueueError(code = 500, body = """{"error": "Server error"}""")

            typeTextInField("输入消息", "This will fail")
            clickOnText("发送")

            // 验证错误提示
            waitForText("网络错误", substring = true, timeoutMillis = 5000)
            assertTextExists("重试", substring = true)

            // 测试重试
            networkSimulator.enqueueLLMResponse("Success after retry")
            clickOnText("重试")
            waitForText("Success after retry", timeoutMillis = 5000)
            assertTextExists("Success after retry")
        }
    }

    /**
     * E2E-AI-10: 会话导出/导入测试
     */
    @Test
    fun testSessionExportImport() {
        val sessionName = "Export Test Session ${System.currentTimeMillis()}"

        composeTestRule.apply {
            // 1. 创建会话
            clickOnText("新建对话")
            networkSimulator.enqueueLLMResponse("Test response")
            typeTextInField("输入消息", "Test message")
            clickOnText("发送")
            waitForLoadingToComplete()

            // 2. 重命名会话
            clickOnText("会话设置")
            clickOnText("重命名")
            typeTextInField("会话名称", sessionName, clearFirst = true)
            clickOnText("确认")

            // 3. 导出会话
            clickOnText("导出")
            clickOnText("JSON 格式")
            assertSnackbarMessage("导出成功")

            // 4. 删除当前会话
            clickOnText("删除会话")
            clickOnText("确认")

            // 5. 导入会话
            clickOnText("导入")
            clickOnText("选择文件")
            // 选择刚导出的文件（模拟）
            clickOnText(sessionName, substring = true)
            clickOnText("导入")
            assertSnackbarMessage("导入成功")

            // 6. 验证会话已恢复
            assertTextExists(sessionName)
            clickOnText(sessionName)
            assertTextExists("Test message")
            assertTextExists("Test response", substring = true)
        }
    }

    // ===== Helper Methods =====

    private fun NetworkSimulator.createMockResponse(content: String): okhttp3.mockwebserver.MockResponse {
        return okhttp3.mockwebserver.MockResponse()
            .setResponseCode(200)
            .setBody("""{"choices": [{"message": {"content": "$content"}}]}""")
    }
}
