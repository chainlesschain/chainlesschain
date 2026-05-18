package com.chainlesschain.android.core.network.test

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.util.concurrent.TimeUnit

/**
 * 网络模拟器
 *
 * 使用 MockWebServer 模拟网络请求和响应
 *
 * 使用方法：
 * ```kotlin
 * @get:Rule
 * val networkSimulator = NetworkSimulator()
 *
 * @Test
 * fun testApi() {
 *     networkSimulator.enqueueSuccess("""{"result": "ok"}""")
 *     // 执行网络请求测试
 * }
 * ```
 */
class NetworkSimulator : TestWatcher() {

    private val mockWebServer = MockWebServer()

    /**
     * 获取模拟服务器的基础URL
     */
    val baseUrl: String
        get() = mockWebServer.url("/").toString()

    override fun starting(description: Description) {
        super.starting(description)
        mockWebServer.start()
    }

    override fun finished(description: Description) {
        super.finished(description)
        mockWebServer.shutdown()
    }

    /**
     * 入队成功响应
     */
    fun enqueueSuccess(
        body: String,
        code: Int = 200,
        headers: Map<String, String> = emptyMap()
    ) {
        val response = MockResponse()
            .setResponseCode(code)
            .setBody(body)
        headers.forEach { (key, value) ->
            response.addHeader(key, value)
        }
        mockWebServer.enqueue(response)
    }

    /**
     * 入队错误响应
     */
    fun enqueueError(
        code: Int = 500,
        body: String = """{"error": "Internal Server Error"}""",
        headers: Map<String, String> = emptyMap()
    ) {
        val response = MockResponse()
            .setResponseCode(code)
            .setBody(body)
        headers.forEach { (key, value) ->
            response.addHeader(key, value)
        }
        mockWebServer.enqueue(response)
    }

    /**
     * 入队网络超时响应
     */
    fun enqueueTimeout(delaySeconds: Long = 30) {
        mockWebServer.enqueue(
            MockResponse()
                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.NO_RESPONSE)
                .setBodyDelay(delaySeconds, TimeUnit.SECONDS)
        )
    }

    /**
     * 入队 SSE (Server-Sent Events) 流响应
     *
     * 用于模拟 LLM 流式响应
     */
    fun enqueueSSE(events: List<String>, delayMs: Long = 100) {
        val sseBody = buildString {
            events.forEach { event ->
                append("data: $event\n\n")
            }
            append("data: [DONE]\n\n")
        }

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream")
                .setHeader("Cache-Control", "no-cache")
                .setBody(sseBody)
                .setBodyDelay(delayMs, TimeUnit.MILLISECONDS)
        )
    }

    /**
     * 入队多个响应（用于模拟重试）
     */
    fun enqueueMultiple(vararg responses: MockResponse) {
        responses.forEach { mockWebServer.enqueue(it) }
    }

    /**
     * 设置请求分发器（高级用法）
     */
    fun setDispatcher(dispatcher: Dispatcher) {
        mockWebServer.dispatcher = dispatcher
    }

    /**
     * 创建条件响应分发器
     */
    fun createConditionalDispatcher(
        condition: (RecordedRequest) -> Boolean,
        successResponse: MockResponse,
        failureResponse: MockResponse
    ): Dispatcher {
        return object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return if (condition(request)) successResponse else failureResponse
            }
        }
    }

    /**
     * 获取最后一个请求
     */
    fun takeRequest(timeoutMs: Long = 1000): RecordedRequest? {
        return try {
            mockWebServer.takeRequest(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 获取请求数量
     */
    fun getRequestCount(): Int {
        return mockWebServer.requestCount
    }

    /**
     * 清空请求队列
     */
    fun clearRequests() {
        while (mockWebServer.requestCount > 0) {
            mockWebServer.takeRequest(100, TimeUnit.MILLISECONDS)
        }
    }
}

/**
 * 扩展函数：创建标准响应
 */
fun NetworkSimulator.enqueueLLMResponse(
    content: String,
    model: String = "gpt-4",
    finishReason: String = "stop"
) {
    val response = """
        {
            "id": "chatcmpl-${System.currentTimeMillis()}",
            "object": "chat.completion",
            "created": ${System.currentTimeMillis() / 1000},
            "model": "$model",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "$content"
                },
                "finish_reason": "$finishReason"
            }],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30
            }
        }
    """.trimIndent()
    enqueueSuccess(response)
}

fun NetworkSimulator.enqueueLLMStreamResponse(
    chunks: List<String>,
    model: String = "gpt-4"
) {
    val events = chunks.map { chunk ->
        """
        {
            "id": "chatcmpl-${System.currentTimeMillis()}",
            "object": "chat.completion.chunk",
            "created": ${System.currentTimeMillis() / 1000},
            "model": "$model",
            "choices": [{
                "index": 0,
                "delta": {
                    "content": "$chunk"
                },
                "finish_reason": null
            }]
        }
        """.trimIndent()
    }
    enqueueSSE(events)
}

/**
 * 模拟图片上传响应
 */
fun NetworkSimulator.enqueueImageUploadResponse(imageUrl: String) {
    val response = """
        {
            "success": true,
            "url": "$imageUrl"
        }
    """.trimIndent()
    enqueueSuccess(response)
}

/**
 * 模拟链接预览响应
 */
fun NetworkSimulator.enqueueLinkPreviewResponse(
    title: String,
    description: String,
    imageUrl: String? = null
) {
    val htmlBody = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta property="og:title" content="$title">
            <meta property="og:description" content="$description">
            ${imageUrl?.let { """<meta property="og:image" content="$it">""" } ?: ""}
        </head>
        <body></body>
        </html>
    """.trimIndent()
    enqueueSuccess(htmlBody, headers = mapOf("Content-Type" to "text/html"))
}
