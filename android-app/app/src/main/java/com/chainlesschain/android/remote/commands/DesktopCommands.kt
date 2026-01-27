package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程桌面命令 API
 *
 * 提供类型安全的远程桌面相关命令
 */
@Singleton
class DesktopCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 开始远程桌面会话
     *
     * @param displayId 显示器 ID (null = 主显示器)
     * @param quality JPEG 质量 (1-100, 默认 80)
     * @param maxFps 最大帧率 (默认 30)
     * @return 会话信息
     */
    suspend fun startSession(
        displayId: Int? = null,
        quality: Int = 80,
        maxFps: Int = 30
    ): Result<StartSessionResponse> {
        val params = mutableMapOf<String, Any>(
            "quality" to quality,
            "maxFps" to maxFps
        )

        displayId?.let { params["displayId"] = it }

        return client.invoke("desktop.startSession", params)
    }

    /**
     * 停止远程桌面会话
     *
     * @param sessionId 会话 ID
     * @return 会话统计信息
     */
    suspend fun stopSession(
        sessionId: String
    ): Result<StopSessionResponse> {
        val params = mapOf(
            "sessionId" to sessionId
        )

        return client.invoke("desktop.stopSession", params)
    }

    /**
     * 获取屏幕帧
     *
     * @param sessionId 会话 ID
     * @param displayId 显示器 ID (可选)
     * @return 屏幕帧数据 (Base64 编码的 JPEG)
     */
    suspend fun getFrame(
        sessionId: String,
        displayId: Int? = null
    ): Result<FrameResponse> {
        val params = mutableMapOf<String, Any>(
            "sessionId" to sessionId
        )

        displayId?.let { params["displayId"] = it }

        return client.invoke("desktop.getFrame", params)
    }

    /**
     * 发送鼠标移动事件
     *
     * @param sessionId 会话 ID
     * @param x X 坐标
     * @param y Y 坐标
     */
    suspend fun sendMouseMove(
        sessionId: String,
        x: Int,
        y: Int
    ): Result<InputResponse> {
        val params = mapOf(
            "sessionId" to sessionId,
            "type" to "mouse_move",
            "data" to mapOf(
                "x" to x,
                "y" to y
            )
        )

        return client.invoke("desktop.sendInput", params)
    }

    /**
     * 发送鼠标点击事件
     *
     * @param sessionId 会话 ID
     * @param button 按钮 ("left", "right", "middle")
     * @param double 是否双击
     */
    suspend fun sendMouseClick(
        sessionId: String,
        button: String = "left",
        double: Boolean = false
    ): Result<InputResponse> {
        val params = mapOf(
            "sessionId" to sessionId,
            "type" to "mouse_click",
            "data" to mapOf(
                "button" to button,
                "double" to double
            )
        )

        return client.invoke("desktop.sendInput", params)
    }

    /**
     * 发送鼠标滚轮事件
     *
     * @param sessionId 会话 ID
     * @param deltaX 水平滚动量
     * @param deltaY 垂直滚动量
     */
    suspend fun sendMouseScroll(
        sessionId: String,
        deltaX: Int,
        deltaY: Int
    ): Result<InputResponse> {
        val params = mapOf(
            "sessionId" to sessionId,
            "type" to "mouse_scroll",
            "data" to mapOf(
                "deltaX" to deltaX,
                "deltaY" to deltaY
            )
        )

        return client.invoke("desktop.sendInput", params)
    }

    /**
     * 发送按键事件
     *
     * @param sessionId 会话 ID
     * @param key 按键 (例如: "a", "enter", "escape")
     * @param modifiers 修饰键列表 (例如: ["control", "shift"])
     */
    suspend fun sendKeyPress(
        sessionId: String,
        key: String,
        modifiers: List<String> = emptyList()
    ): Result<InputResponse> {
        val params = mapOf(
            "sessionId" to sessionId,
            "type" to "key_press",
            "data" to mapOf(
                "key" to key,
                "modifiers" to modifiers
            )
        )

        return client.invoke("desktop.sendInput", params)
    }

    /**
     * 发送文本输入
     *
     * @param sessionId 会话 ID
     * @param text 要输入的文本
     */
    suspend fun sendTextInput(
        sessionId: String,
        text: String
    ): Result<InputResponse> {
        val params = mapOf(
            "sessionId" to sessionId,
            "type" to "text_input",
            "data" to mapOf(
                "text" to text
            )
        )

        return client.invoke("desktop.sendInput", params)
    }

    /**
     * 获取显示器列表
     *
     * @return 显示器列表
     */
    suspend fun getDisplays(): Result<DisplaysResponse> {
        return client.invoke("desktop.getDisplays", emptyMap())
    }

    /**
     * 切换显示器
     *
     * @param sessionId 会话 ID
     * @param displayId 显示器 ID
     */
    suspend fun switchDisplay(
        sessionId: String,
        displayId: Int
    ): Result<SwitchDisplayResponse> {
        val params = mapOf(
            "sessionId" to sessionId,
            "displayId" to displayId
        )

        return client.invoke("desktop.switchDisplay", params)
    }

    /**
     * 获取性能统计
     *
     * @return 性能统计信息
     */
    suspend fun getStats(): Result<StatsResponse> {
        return client.invoke("desktop.getStats", emptyMap())
    }
}

// 响应数据类

@Serializable
data class StartSessionResponse(
    val sessionId: String,
    val quality: Int,
    val maxFps: Int,
    val captureInterval: Int,
    val displays: List<DisplayInfo>,
    val inputControlEnabled: Boolean
)

@Serializable
data class StopSessionResponse(
    val sessionId: String,
    val duration: Long,
    val frameCount: Int,
    val bytesSent: Long
)

@Serializable
data class FrameResponse(
    val sessionId: String,
    val frameData: String,  // Base64 编码的 JPEG
    val width: Int,
    val height: Int,
    val format: String,
    val size: Int,
    val timestamp: Long,
    val captureTime: Long,
    val encodeTime: Long
)

@Serializable
data class InputResponse(
    val success: Boolean
)

@Serializable
data class DisplaysResponse(
    val displays: List<DisplayInfo>,
    val count: Int
)

@Serializable
data class DisplayInfo(
    val id: Int,
    val name: String,
    val width: Int? = null,
    val height: Int? = null,
    val primary: Boolean? = null
)

@Serializable
data class SwitchDisplayResponse(
    val sessionId: String,
    val displayId: Int
)

@Serializable
data class StatsResponse(
    val totalFrames: Long,
    val totalBytes: Long,
    val avgFrameSize: Double,
    val avgCaptureTime: Double,
    val avgEncodeTime: Double,
    val activeSessions: Int
)
