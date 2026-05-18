package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 输入控制命令 API
 *
 * 提供类型安全的键盘和鼠标控制命令
 */
@Singleton
class InputCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 发送单个按键
     *
     * @param key 按键名称（如 enter, tab, escape, f1-f12, a-z, 0-9 等）
     */
    suspend fun sendKeyPress(key: String): Result<KeyPressResponse> {
        val params = mapOf("key" to key)
        return client.invoke("input.sendKeyPress", params)
    }

    /**
     * 发送组合键
     *
     * @param key 主按键
     * @param modifiers 修饰键列表（ctrl, alt, shift, meta, win, cmd）
     */
    suspend fun sendKeyCombo(
        key: String,
        modifiers: List<String> = emptyList()
    ): Result<KeyComboResponse> {
        val params = mapOf(
            "key" to key,
            "modifiers" to modifiers
        )
        return client.invoke("input.sendKeyCombo", params)
    }

    /**
     * 输入文本
     *
     * @param text 要输入的文本
     * @param delay 字符间延迟（毫秒）
     */
    suspend fun typeText(
        text: String,
        delay: Int = 50
    ): Result<TypeTextResponse> {
        val params = mapOf(
            "text" to text,
            "delay" to delay
        )
        return client.invoke("input.typeText", params)
    }

    /**
     * 移动鼠标
     *
     * @param x X 坐标
     * @param y Y 坐标
     * @param relative 是否相对移动
     */
    suspend fun mouseMove(
        x: Int,
        y: Int,
        relative: Boolean = false
    ): Result<MouseMoveResponse> {
        val params = mapOf(
            "x" to x,
            "y" to y,
            "relative" to relative
        )
        return client.invoke("input.mouseMove", params)
    }

    /**
     * 鼠标点击
     *
     * @param button 按钮：left, right, middle
     * @param x X 坐标（可选，如提供则先移动到该位置）
     * @param y Y 坐标（可选）
     */
    suspend fun mouseClick(
        button: String = "left",
        x: Int? = null,
        y: Int? = null
    ): Result<MouseClickResponse> {
        val params = mutableMapOf<String, Any>("button" to button)
        x?.let { params["x"] = it }
        y?.let { params["y"] = it }

        return client.invoke("input.mouseClick", params)
    }

    /**
     * 鼠标双击
     *
     * @param button 按钮：left, right, middle
     * @param x X 坐标（可选）
     * @param y Y 坐标（可选）
     */
    suspend fun mouseDoubleClick(
        button: String = "left",
        x: Int? = null,
        y: Int? = null
    ): Result<MouseClickResponse> {
        val params = mutableMapOf<String, Any>("button" to button)
        x?.let { params["x"] = it }
        y?.let { params["y"] = it }

        return client.invoke("input.mouseDoubleClick", params)
    }

    /**
     * 鼠标拖拽
     *
     * @param startX 起始 X 坐标
     * @param startY 起始 Y 坐标
     * @param endX 结束 X 坐标
     * @param endY 结束 Y 坐标
     * @param button 按钮：left, right, middle
     */
    suspend fun mouseDrag(
        startX: Int,
        startY: Int,
        endX: Int,
        endY: Int,
        button: String = "left"
    ): Result<MouseDragResponse> {
        val params = mapOf(
            "startX" to startX,
            "startY" to startY,
            "endX" to endX,
            "endY" to endY,
            "button" to button
        )
        return client.invoke("input.mouseDrag", params)
    }

    /**
     * 鼠标滚动
     *
     * @param direction 方向：up, down, left, right
     * @param amount 滚动量
     */
    suspend fun mouseScroll(
        direction: String = "down",
        amount: Int = 3
    ): Result<MouseScrollResponse> {
        val params = mapOf(
            "direction" to direction,
            "amount" to amount
        )
        return client.invoke("input.mouseScroll", params)
    }

    /**
     * 获取鼠标位置
     */
    suspend fun getCursorPosition(): Result<InputCursorPositionResponse> {
        return client.invoke("input.getCursorPosition", emptyMap())
    }

    /**
     * 获取键盘布局
     */
    suspend fun getKeyboardLayout(): Result<KeyboardLayoutResponse> {
        return client.invoke("input.getKeyboardLayout", emptyMap())
    }

    // 便捷方法

    /**
     * 发送 Enter 键
     */
    suspend fun pressEnter(): Result<KeyPressResponse> = sendKeyPress("enter")

    /**
     * 发送 Escape 键
     */
    suspend fun pressEscape(): Result<KeyPressResponse> = sendKeyPress("escape")

    /**
     * 发送 Tab 键
     */
    suspend fun pressTab(): Result<KeyPressResponse> = sendKeyPress("tab")

    /**
     * 发送 Backspace 键
     */
    suspend fun pressBackspace(): Result<KeyPressResponse> = sendKeyPress("backspace")

    /**
     * 发送 Ctrl+C（复制）
     */
    suspend fun copy(): Result<KeyComboResponse> = sendKeyCombo("c", listOf("ctrl"))

    /**
     * 发送 Ctrl+V（粘贴）
     */
    suspend fun paste(): Result<KeyComboResponse> = sendKeyCombo("v", listOf("ctrl"))

    /**
     * 发送 Ctrl+X（剪切）
     */
    suspend fun cut(): Result<KeyComboResponse> = sendKeyCombo("x", listOf("ctrl"))

    /**
     * 发送 Ctrl+Z（撤销）
     */
    suspend fun undo(): Result<KeyComboResponse> = sendKeyCombo("z", listOf("ctrl"))

    /**
     * 发送 Ctrl+A（全选）
     */
    suspend fun selectAll(): Result<KeyComboResponse> = sendKeyCombo("a", listOf("ctrl"))

    /**
     * 发送 Ctrl+S（保存）
     */
    suspend fun save(): Result<KeyComboResponse> = sendKeyCombo("s", listOf("ctrl"))

    /**
     * 左键单击
     */
    suspend fun leftClick(x: Int? = null, y: Int? = null): Result<MouseClickResponse> =
        mouseClick("left", x, y)

    /**
     * 右键单击
     */
    suspend fun rightClick(x: Int? = null, y: Int? = null): Result<MouseClickResponse> =
        mouseClick("right", x, y)

    /**
     * 向上滚动
     */
    suspend fun scrollUp(amount: Int = 3): Result<MouseScrollResponse> =
        mouseScroll("up", amount)

    /**
     * 向下滚动
     */
    suspend fun scrollDown(amount: Int = 3): Result<MouseScrollResponse> =
        mouseScroll("down", amount)
}

// 响应数据类

@Serializable
data class KeyPressResponse(
    val success: Boolean,
    val key: String,
    val message: String
)

@Serializable
data class KeyComboResponse(
    val success: Boolean,
    val modifiers: List<String>,
    val key: String,
    val message: String
)

@Serializable
data class TypeTextResponse(
    val success: Boolean,
    val length: Int,
    val delay: Int,
    val message: String
)

@Serializable
data class MouseMoveResponse(
    val success: Boolean,
    val x: Int,
    val y: Int,
    val relative: Boolean,
    val message: String
)

@Serializable
data class MouseClickResponse(
    val success: Boolean,
    val button: String,
    val x: Int? = null,
    val y: Int? = null,
    val message: String
)

@Serializable
data class MouseDragResponse(
    val success: Boolean,
    val startX: Int,
    val startY: Int,
    val endX: Int,
    val endY: Int,
    val message: String
)

@Serializable
data class MouseScrollResponse(
    val success: Boolean,
    val direction: String,
    val amount: Int,
    val message: String
)

@Serializable
data class InputCursorPositionResponse(
    val success: Boolean,
    val x: Int,
    val y: Int
)

@Serializable
data class KeyboardLayoutResponse(
    val success: Boolean,
    val layout: String,
    val platform: String,
    val error: String? = null
)
