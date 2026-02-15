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

    // ==================== 会话控制 ====================

    /**
     * 暂停会话
     *
     * @param sessionId 会话 ID
     */
    suspend fun pauseSession(sessionId: String): Result<SessionControlResponse> {
        return client.invoke("desktop.pauseSession", mapOf("sessionId" to sessionId))
    }

    /**
     * 恢复会话
     *
     * @param sessionId 会话 ID
     */
    suspend fun resumeSession(sessionId: String): Result<SessionControlResponse> {
        return client.invoke("desktop.resumeSession", mapOf("sessionId" to sessionId))
    }

    /**
     * 调整会话质量
     *
     * @param sessionId 会话 ID
     * @param quality 新质量 (1-100)
     * @param maxFps 新最大帧率
     */
    suspend fun adjustQuality(
        sessionId: String,
        quality: Int? = null,
        maxFps: Int? = null
    ): Result<QualityAdjustResponse> {
        val params = mutableMapOf<String, Any>("sessionId" to sessionId)
        quality?.let { params["quality"] = it }
        maxFps?.let { params["maxFps"] = it }
        return client.invoke("desktop.adjustQuality", params)
    }

    /**
     * 获取会话信息
     *
     * @param sessionId 会话 ID
     */
    suspend fun getSessionInfo(sessionId: String): Result<SessionInfoResponse> {
        return client.invoke("desktop.getSessionInfo", mapOf("sessionId" to sessionId))
    }

    /**
     * 列出所有活动会话
     */
    suspend fun listSessions(): Result<SessionsListResponse> {
        return client.invoke("desktop.listSessions", emptyMap())
    }

    // ==================== 区域截图 ====================

    /**
     * 捕获屏幕区域
     *
     * @param sessionId 会话 ID
     * @param x 左上角 X 坐标
     * @param y 左上角 Y 坐标
     * @param width 区域宽度
     * @param height 区域高度
     * @param format 格式 (png, jpeg, webp)
     * @param quality 质量 (1-100, 仅 jpeg)
     */
    suspend fun captureRegion(
        sessionId: String,
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        format: String = "png",
        quality: Int = 90
    ): Result<RegionCaptureResponse> {
        return client.invoke("desktop.captureRegion", mapOf(
            "sessionId" to sessionId,
            "x" to x,
            "y" to y,
            "width" to width,
            "height" to height,
            "format" to format,
            "quality" to quality
        ))
    }

    /**
     * 截取全屏高质量图像
     *
     * @param displayId 显示器 ID
     * @param format 格式
     */
    suspend fun screenshot(
        displayId: Int? = null,
        format: String = "png"
    ): Result<ScreenshotResponse> {
        val params = mutableMapOf<String, Any>("format" to format)
        displayId?.let { params["displayId"] = it }
        return client.invoke("desktop.screenshot", params)
    }

    // ==================== 窗口管理 ====================

    /**
     * 获取窗口列表
     *
     * @param includeMinimized 是否包含最小化窗口
     */
    suspend fun listWindows(
        includeMinimized: Boolean = true
    ): Result<WindowsListResponse> {
        return client.invoke("desktop.listWindows", mapOf(
            "includeMinimized" to includeMinimized
        ))
    }

    /**
     * 获取窗口信息
     *
     * @param windowId 窗口 ID
     */
    suspend fun getWindowInfo(windowId: String): Result<WindowInfoResponse> {
        return client.invoke("desktop.getWindowInfo", mapOf("windowId" to windowId))
    }

    /**
     * 聚焦窗口
     *
     * @param windowId 窗口 ID
     */
    suspend fun focusWindow(windowId: String): Result<WindowOperationResponse> {
        return client.invoke("desktop.focusWindow", mapOf("windowId" to windowId))
    }

    /**
     * 最小化窗口
     *
     * @param windowId 窗口 ID
     */
    suspend fun minimizeWindow(windowId: String): Result<WindowOperationResponse> {
        return client.invoke("desktop.minimizeWindow", mapOf("windowId" to windowId))
    }

    /**
     * 最大化窗口
     *
     * @param windowId 窗口 ID
     */
    suspend fun maximizeWindow(windowId: String): Result<WindowOperationResponse> {
        return client.invoke("desktop.maximizeWindow", mapOf("windowId" to windowId))
    }

    /**
     * 还原窗口
     *
     * @param windowId 窗口 ID
     */
    suspend fun restoreWindow(windowId: String): Result<WindowOperationResponse> {
        return client.invoke("desktop.restoreWindow", mapOf("windowId" to windowId))
    }

    /**
     * 关闭窗口
     *
     * @param windowId 窗口 ID
     * @param force 是否强制关闭
     */
    suspend fun closeWindow(
        windowId: String,
        force: Boolean = false
    ): Result<WindowOperationResponse> {
        return client.invoke("desktop.closeWindow", mapOf(
            "windowId" to windowId,
            "force" to force
        ))
    }

    /**
     * 移动窗口
     *
     * @param windowId 窗口 ID
     * @param x 新 X 位置
     * @param y 新 Y 位置
     */
    suspend fun moveWindow(
        windowId: String,
        x: Int,
        y: Int
    ): Result<WindowOperationResponse> {
        return client.invoke("desktop.moveWindow", mapOf(
            "windowId" to windowId,
            "x" to x,
            "y" to y
        ))
    }

    /**
     * 调整窗口大小
     *
     * @param windowId 窗口 ID
     * @param width 新宽度
     * @param height 新高度
     */
    suspend fun resizeWindow(
        windowId: String,
        width: Int,
        height: Int
    ): Result<WindowOperationResponse> {
        return client.invoke("desktop.resizeWindow", mapOf(
            "windowId" to windowId,
            "width" to width,
            "height" to height
        ))
    }

    /**
     * 截取窗口图像
     *
     * @param windowId 窗口 ID
     * @param format 格式
     */
    suspend fun captureWindow(
        windowId: String,
        format: String = "png"
    ): Result<WindowCaptureResponse> {
        return client.invoke("desktop.captureWindow", mapOf(
            "windowId" to windowId,
            "format" to format
        ))
    }

    // ==================== 屏幕录制 ====================

    /**
     * 开始屏幕录制
     *
     * @param displayId 显示器 ID
     * @param fps 帧率
     * @param quality 质量 (1-100)
     * @param includeAudio 是否录制音频
     */
    suspend fun startRecording(
        displayId: Int? = null,
        fps: Int = 30,
        quality: Int = 80,
        includeAudio: Boolean = true
    ): Result<RecordingStartResponse> {
        val params = mutableMapOf<String, Any>(
            "fps" to fps,
            "quality" to quality,
            "includeAudio" to includeAudio
        )
        displayId?.let { params["displayId"] = it }
        return client.invoke("desktop.startRecording", params)
    }

    /**
     * 停止屏幕录制
     *
     * @param recordingId 录制 ID
     * @param savePath 保存路径
     */
    suspend fun stopRecording(
        recordingId: String,
        savePath: String? = null
    ): Result<RecordingStopResponse> {
        val params = mutableMapOf<String, Any>("recordingId" to recordingId)
        savePath?.let { params["savePath"] = it }
        return client.invoke("desktop.stopRecording", params)
    }

    /**
     * 暂停屏幕录制
     *
     * @param recordingId 录制 ID
     */
    suspend fun pauseRecording(recordingId: String): Result<RecordingControlResponse> {
        return client.invoke("desktop.pauseRecording", mapOf("recordingId" to recordingId))
    }

    /**
     * 恢复屏幕录制
     *
     * @param recordingId 录制 ID
     */
    suspend fun resumeRecording(recordingId: String): Result<RecordingControlResponse> {
        return client.invoke("desktop.resumeRecording", mapOf("recordingId" to recordingId))
    }

    /**
     * 获取录制状态
     *
     * @param recordingId 录制 ID
     */
    suspend fun getRecordingStatus(recordingId: String): Result<RecordingStatusResponse> {
        return client.invoke("desktop.getRecordingStatus", mapOf("recordingId" to recordingId))
    }

    /**
     * 列出所有录制
     */
    suspend fun listRecordings(): Result<RecordingsListResponse> {
        return client.invoke("desktop.listRecordings", emptyMap())
    }

    // ==================== 剪贴板 ====================

    /**
     * 获取剪贴板内容
     *
     * @param format 格式 (text, html, image, files)
     */
    suspend fun getClipboard(format: String = "text"): Result<ClipboardGetResponse> {
        return client.invoke("desktop.getClipboard", mapOf("format" to format))
    }

    /**
     * 设置剪贴板文本
     *
     * @param text 文本内容
     */
    suspend fun setClipboardText(text: String): Result<DesktopClipboardSetResponse> {
        return client.invoke("desktop.setClipboard", mapOf(
            "type" to "text",
            "content" to text
        ))
    }

    /**
     * 设置剪贴板图像
     *
     * @param imageData Base64 编码的图像数据
     * @param format 图像格式
     */
    suspend fun setClipboardImage(
        imageData: String,
        format: String = "png"
    ): Result<DesktopClipboardSetResponse> {
        return client.invoke("desktop.setClipboard", mapOf(
            "type" to "image",
            "content" to imageData,
            "format" to format
        ))
    }

    /**
     * 清空剪贴板
     */
    suspend fun clearClipboard(): Result<DesktopClipboardSetResponse> {
        return client.invoke("desktop.clearClipboard", emptyMap())
    }

    /**
     * 监控剪贴板变化
     *
     * @param enable 是否启用
     */
    suspend fun watchClipboard(enable: Boolean): Result<ClipboardWatchResponse> {
        return client.invoke("desktop.watchClipboard", mapOf("enable" to enable))
    }

    // ==================== 音频控制 ====================

    /**
     * 启用/禁用音频流
     *
     * @param sessionId 会话 ID
     * @param enable 是否启用
     */
    suspend fun setAudioStream(
        sessionId: String,
        enable: Boolean
    ): Result<AudioControlResponse> {
        return client.invoke("desktop.setAudioStream", mapOf(
            "sessionId" to sessionId,
            "enable" to enable
        ))
    }

    /**
     * 获取系统音量
     */
    suspend fun getVolume(): Result<VolumeResponse> {
        return client.invoke("desktop.getVolume", emptyMap())
    }

    /**
     * 设置系统音量
     *
     * @param level 音量级别 (0-100)
     */
    suspend fun setVolume(level: Int): Result<VolumeResponse> {
        return client.invoke("desktop.setVolume", mapOf("level" to level))
    }

    /**
     * 静音/取消静音
     *
     * @param mute 是否静音
     */
    suspend fun setMute(mute: Boolean): Result<VolumeResponse> {
        return client.invoke("desktop.setMute", mapOf("mute" to mute))
    }

    /**
     * 列出音频设备
     */
    suspend fun listAudioDevices(): Result<AudioDevicesResponse> {
        return client.invoke("desktop.listAudioDevices", emptyMap())
    }

    // ==================== OCR 文字识别 ====================

    /**
     * 识别屏幕区域文字
     *
     * @param x 左上角 X 坐标
     * @param y 左上角 Y 坐标
     * @param width 区域宽度
     * @param height 区域高度
     * @param language 语言 (chi_sim, eng, jpn, etc.)
     */
    suspend fun ocrRegion(
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        language: String = "chi_sim+eng"
    ): Result<OcrResponse> {
        return client.invoke("desktop.ocrRegion", mapOf(
            "x" to x,
            "y" to y,
            "width" to width,
            "height" to height,
            "language" to language
        ))
    }

    /**
     * 识别图像文字
     *
     * @param imageData Base64 编码的图像
     * @param language 语言
     */
    suspend fun ocrImage(
        imageData: String,
        language: String = "chi_sim+eng"
    ): Result<OcrResponse> {
        return client.invoke("desktop.ocrImage", mapOf(
            "imageData" to imageData,
            "language" to language
        ))
    }

    // ==================== 屏幕标注 ====================

    /**
     * 绘制标注
     *
     * @param sessionId 会话 ID
     * @param type 类型 (line, rect, circle, arrow, text, freehand)
     * @param points 坐标点列表
     * @param color 颜色 (十六进制)
     * @param lineWidth 线宽
     * @param text 文本（type=text 时）
     */
    suspend fun drawAnnotation(
        sessionId: String,
        type: String,
        points: List<Map<String, Int>>,
        color: String = "#FF0000",
        lineWidth: Int = 2,
        text: String? = null
    ): Result<AnnotationResponse> {
        val params = mutableMapOf<String, Any>(
            "sessionId" to sessionId,
            "type" to type,
            "points" to points,
            "color" to color,
            "lineWidth" to lineWidth
        )
        text?.let { params["text"] = it }
        return client.invoke("desktop.drawAnnotation", params)
    }

    /**
     * 清除标注
     *
     * @param sessionId 会话 ID
     * @param annotationId 标注 ID（null 清除全部）
     */
    suspend fun clearAnnotations(
        sessionId: String,
        annotationId: String? = null
    ): Result<AnnotationClearResponse> {
        val params = mutableMapOf<String, Any>("sessionId" to sessionId)
        annotationId?.let { params["annotationId"] = it }
        return client.invoke("desktop.clearAnnotations", params)
    }

    /**
     * 撤销上一个标注
     *
     * @param sessionId 会话 ID
     */
    suspend fun undoAnnotation(sessionId: String): Result<AnnotationResponse> {
        return client.invoke("desktop.undoAnnotation", mapOf("sessionId" to sessionId))
    }

    // ==================== 系统电源管理 ====================

    /**
     * 锁定屏幕
     */
    suspend fun lockScreen(): Result<PowerOperationResponse> {
        return client.invoke("desktop.lockScreen", emptyMap())
    }

    /**
     * 休眠系统
     */
    suspend fun sleep(): Result<PowerOperationResponse> {
        return client.invoke("desktop.sleep", emptyMap())
    }

    /**
     * 关机
     *
     * @param delay 延迟秒数
     * @param force 是否强制
     */
    suspend fun shutdown(
        delay: Int = 0,
        force: Boolean = false
    ): Result<PowerOperationResponse> {
        return client.invoke("desktop.shutdown", mapOf(
            "delay" to delay,
            "force" to force
        ))
    }

    /**
     * 重启
     *
     * @param delay 延迟秒数
     * @param force 是否强制
     */
    suspend fun restart(
        delay: Int = 0,
        force: Boolean = false
    ): Result<PowerOperationResponse> {
        return client.invoke("desktop.restart", mapOf(
            "delay" to delay,
            "force" to force
        ))
    }

    /**
     * 取消关机/重启
     */
    suspend fun cancelShutdown(): Result<PowerOperationResponse> {
        return client.invoke("desktop.cancelShutdown", emptyMap())
    }

    /**
     * 获取电源状态
     */
    suspend fun getPowerStatus(): Result<PowerStatusResponse> {
        return client.invoke("desktop.getPowerStatus", emptyMap())
    }

    // ==================== 桌面通知 ====================

    /**
     * 发送桌面通知
     *
     * @param title 标题
     * @param body 内容
     * @param icon 图标 (Base64 或 URL)
     * @param actions 操作按钮
     * @param timeout 超时毫秒
     */
    suspend fun sendNotification(
        title: String,
        body: String,
        icon: String? = null,
        actions: List<String>? = null,
        timeout: Int = 5000
    ): Result<NotificationResponse> {
        val params = mutableMapOf<String, Any>(
            "title" to title,
            "body" to body,
            "timeout" to timeout
        )
        icon?.let { params["icon"] = it }
        actions?.let { params["actions"] = it }
        return client.invoke("desktop.sendNotification", params)
    }

    // ==================== 高级输入 ====================

    /**
     * 发送鼠标按下事件
     *
     * @param sessionId 会话 ID
     * @param button 按钮
     */
    suspend fun sendMouseDown(
        sessionId: String,
        button: String = "left"
    ): Result<InputResponse> {
        return client.invoke("desktop.sendInput", mapOf(
            "sessionId" to sessionId,
            "type" to "mouse_down",
            "data" to mapOf("button" to button)
        ))
    }

    /**
     * 发送鼠标释放事件
     *
     * @param sessionId 会话 ID
     * @param button 按钮
     */
    suspend fun sendMouseUp(
        sessionId: String,
        button: String = "left"
    ): Result<InputResponse> {
        return client.invoke("desktop.sendInput", mapOf(
            "sessionId" to sessionId,
            "type" to "mouse_up",
            "data" to mapOf("button" to button)
        ))
    }

    /**
     * 拖拽操作
     *
     * @param sessionId 会话 ID
     * @param startX 起始 X
     * @param startY 起始 Y
     * @param endX 结束 X
     * @param endY 结束 Y
     * @param button 按钮
     */
    suspend fun sendDrag(
        sessionId: String,
        startX: Int,
        startY: Int,
        endX: Int,
        endY: Int,
        button: String = "left"
    ): Result<InputResponse> {
        return client.invoke("desktop.sendInput", mapOf(
            "sessionId" to sessionId,
            "type" to "drag",
            "data" to mapOf(
                "startX" to startX,
                "startY" to startY,
                "endX" to endX,
                "endY" to endY,
                "button" to button
            )
        ))
    }

    /**
     * 发送按键按下事件
     *
     * @param sessionId 会话 ID
     * @param key 按键
     */
    suspend fun sendKeyDown(
        sessionId: String,
        key: String
    ): Result<InputResponse> {
        return client.invoke("desktop.sendInput", mapOf(
            "sessionId" to sessionId,
            "type" to "key_down",
            "data" to mapOf("key" to key)
        ))
    }

    /**
     * 发送按键释放事件
     *
     * @param sessionId 会话 ID
     * @param key 按键
     */
    suspend fun sendKeyUp(
        sessionId: String,
        key: String
    ): Result<InputResponse> {
        return client.invoke("desktop.sendInput", mapOf(
            "sessionId" to sessionId,
            "type" to "key_up",
            "data" to mapOf("key" to key)
        ))
    }

    /**
     * 发送快捷键组合
     *
     * @param sessionId 会话 ID
     * @param keys 按键列表（如 ["control", "c"]）
     */
    suspend fun sendHotkey(
        sessionId: String,
        keys: List<String>
    ): Result<InputResponse> {
        return client.invoke("desktop.sendInput", mapOf(
            "sessionId" to sessionId,
            "type" to "hotkey",
            "data" to mapOf("keys" to keys)
        ))
    }

    // ==================== 便捷方法 ====================

    /**
     * Ctrl+C 复制
     */
    suspend fun copy(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("control", "c"))

    /**
     * Ctrl+V 粘贴
     */
    suspend fun paste(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("control", "v"))

    /**
     * Ctrl+X 剪切
     */
    suspend fun cut(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("control", "x"))

    /**
     * Ctrl+Z 撤销
     */
    suspend fun undo(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("control", "z"))

    /**
     * Ctrl+Y 重做
     */
    suspend fun redo(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("control", "y"))

    /**
     * Ctrl+A 全选
     */
    suspend fun selectAll(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("control", "a"))

    /**
     * Alt+Tab 切换窗口
     */
    suspend fun switchWindow(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("alt", "tab"))

    /**
     * Alt+F4 关闭窗口
     */
    suspend fun altF4(sessionId: String): Result<InputResponse> =
        sendHotkey(sessionId, listOf("alt", "F4"))
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

// ==================== 会话控制响应 ====================

@Serializable
data class SessionControlResponse(
    val success: Boolean,
    val sessionId: String,
    val status: String,
    val message: String? = null
)

@Serializable
data class QualityAdjustResponse(
    val success: Boolean,
    val sessionId: String,
    val quality: Int,
    val maxFps: Int
)

@Serializable
data class SessionInfoResponse(
    val success: Boolean,
    val sessionId: String,
    val status: String,
    val quality: Int,
    val maxFps: Int,
    val displayId: Int,
    val startTime: Long,
    val frameCount: Long,
    val bytesSent: Long,
    val paused: Boolean
)

@Serializable
data class SessionsListResponse(
    val success: Boolean,
    val sessions: List<SessionInfo>,
    val total: Int
)

@Serializable
data class SessionInfo(
    val sessionId: String,
    val status: String,
    val displayId: Int,
    val startTime: Long,
    val frameCount: Long,
    val paused: Boolean
)

// ==================== 区域截图响应 ====================

@Serializable
data class RegionCaptureResponse(
    val success: Boolean,
    val imageData: String,  // Base64 编码
    val format: String,
    val width: Int,
    val height: Int,
    val size: Int
)

@Serializable
data class ScreenshotResponse(
    val success: Boolean,
    val imageData: String,  // Base64 编码
    val format: String,
    val width: Int,
    val height: Int,
    val displayId: Int,
    val size: Int,
    val timestamp: Long
)

// ==================== 窗口管理响应 ====================

@Serializable
data class WindowsListResponse(
    val success: Boolean,
    val windows: List<WindowInfo>,
    val total: Int
)

@Serializable
data class WindowInfo(
    val id: String,
    val title: String,
    val processName: String? = null,
    val processId: Int? = null,
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int,
    val visible: Boolean,
    val minimized: Boolean,
    val maximized: Boolean,
    val focused: Boolean,
    val className: String? = null
)

@Serializable
data class WindowInfoResponse(
    val success: Boolean,
    val window: WindowInfo? = null,
    val message: String? = null
)

@Serializable
data class WindowOperationResponse(
    val success: Boolean,
    val windowId: String,
    val operation: String,
    val message: String? = null
)

@Serializable
data class WindowCaptureResponse(
    val success: Boolean,
    val windowId: String,
    val imageData: String,
    val format: String,
    val width: Int,
    val height: Int,
    val size: Int
)

// ==================== 屏幕录制响应 ====================

@Serializable
data class RecordingStartResponse(
    val success: Boolean,
    val recordingId: String,
    val displayId: Int,
    val fps: Int,
    val quality: Int,
    val includeAudio: Boolean,
    val startTime: Long
)

@Serializable
data class RecordingStopResponse(
    val success: Boolean,
    val recordingId: String,
    val filePath: String,
    val duration: Long,
    val fileSize: Long,
    val frameCount: Long
)

@Serializable
data class RecordingControlResponse(
    val success: Boolean,
    val recordingId: String,
    val status: String,
    val message: String? = null
)

@Serializable
data class RecordingStatusResponse(
    val success: Boolean,
    val recordingId: String,
    val status: String,  // "recording", "paused", "stopped"
    val duration: Long,
    val frameCount: Long,
    val estimatedSize: Long,
    val paused: Boolean
)

@Serializable
data class RecordingsListResponse(
    val success: Boolean,
    val recordings: List<RecordingInfo>,
    val total: Int
)

@Serializable
data class RecordingInfo(
    val recordingId: String,
    val status: String,
    val displayId: Int,
    val startTime: Long,
    val duration: Long,
    val paused: Boolean
)

// ==================== 剪贴板响应 ====================

@Serializable
data class ClipboardGetResponse(
    val success: Boolean,
    val type: String,  // "text", "html", "image", "files", "empty"
    val content: String? = null,
    val files: List<String>? = null,
    val format: String? = null
)

@Serializable
data class DesktopClipboardSetResponse(
    val success: Boolean,
    val type: String,
    val message: String? = null
)

@Serializable
data class ClipboardWatchResponse(
    val success: Boolean,
    val enabled: Boolean,
    val message: String? = null
)

// ==================== 音频控制响应 ====================

@Serializable
data class AudioControlResponse(
    val success: Boolean,
    val sessionId: String,
    val audioEnabled: Boolean,
    val message: String? = null
)

@Serializable
data class VolumeResponse(
    val success: Boolean,
    val level: Int,
    val muted: Boolean
)

@Serializable
data class AudioDevicesResponse(
    val success: Boolean,
    val devices: List<AudioDeviceInfo>,
    val defaultOutput: String? = null,
    val defaultInput: String? = null
)

@Serializable
data class AudioDeviceInfo(
    val id: String,
    val name: String,
    val type: String,  // "output", "input"
    val isDefault: Boolean
)

// ==================== OCR 响应 ====================

@Serializable
data class OcrResponse(
    val success: Boolean,
    val text: String,
    val confidence: Double,
    val blocks: List<OcrBlock>? = null,
    val language: String
)

@Serializable
data class OcrBlock(
    val text: String,
    val confidence: Double,
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int
)

// ==================== 标注响应 ====================

@Serializable
data class AnnotationResponse(
    val success: Boolean,
    val annotationId: String? = null,
    val type: String? = null,
    val message: String? = null
)

@Serializable
data class AnnotationClearResponse(
    val success: Boolean,
    val cleared: Int,
    val message: String? = null
)

// ==================== 电源管理响应 ====================

@Serializable
data class PowerOperationResponse(
    val success: Boolean,
    val operation: String,
    val scheduled: Boolean = false,
    val scheduledTime: Long? = null,
    val message: String? = null
)

@Serializable
data class PowerStatusResponse(
    val success: Boolean,
    val batteryLevel: Int? = null,
    val isCharging: Boolean? = null,
    val isPluggedIn: Boolean,
    val powerSource: String,  // "battery", "ac", "ups"
    val estimatedRuntime: Long? = null  // minutes
)

// ==================== 通知响应 ====================

@Serializable
data class NotificationResponse(
    val success: Boolean,
    val notificationId: String,
    val message: String? = null
)
