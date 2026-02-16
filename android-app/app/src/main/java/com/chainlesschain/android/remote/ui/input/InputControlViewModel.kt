package com.chainlesschain.android.remote.ui.input

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.InputCommands
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 输入控制 ViewModel
 *
 * 功能：
 * - 键盘按键发送
 * - 组合键发送
 * - 文本输入
 * - 鼠标移动、点击、滚动
 * - 触摸板模式
 */
@HiltViewModel
class InputControlViewModel @Inject constructor(
    private val inputCommands: InputCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(InputControlUiState())
    val uiState: StateFlow<InputControlUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 鼠标位置
    private val _cursorPosition = MutableStateFlow(Pair(0, 0))
    val cursorPosition: StateFlow<Pair<Int, Int>> = _cursorPosition.asStateFlow()

    // 键盘布局
    private val _keyboardLayout = MutableStateFlow("unknown")
    val keyboardLayout: StateFlow<String> = _keyboardLayout.asStateFlow()

    init {
        loadCursorPosition()
        loadKeyboardLayout()
    }

    // ========== 键盘操作 ==========

    /**
     * 发送单个按键
     */
    fun sendKey(key: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = inputCommands.sendKeyPress(key)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Key: $key"
                )}
            } else {
                handleError(result.exceptionOrNull(), "发送按键失败")
            }
        }
    }

    /**
     * 发送组合键
     */
    fun sendKeyCombo(key: String, modifiers: List<String>) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = inputCommands.sendKeyCombo(key, modifiers)

            if (result.isSuccess) {
                val modStr = modifiers.joinToString("+")
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Combo: $modStr+$key"
                )}
            } else {
                handleError(result.exceptionOrNull(), "发送组合键失败")
            }
        }
    }

    /**
     * 输入文本
     */
    fun typeText(text: String, delay: Int = 50) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = inputCommands.typeText(text, delay)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Typed: ${text.take(20)}${if (text.length > 20) "..." else ""}"
                )}
            } else {
                handleError(result.exceptionOrNull(), "输入文本失败")
            }
        }
    }

    // 便捷键盘操作
    fun pressEnter() = sendKey("enter")
    fun pressEscape() = sendKey("escape")
    fun pressTab() = sendKey("tab")
    fun pressBackspace() = sendKey("backspace")
    fun pressSpace() = sendKey("space")
    fun pressDelete() = sendKey("delete")
    fun pressHome() = sendKey("home")
    fun pressEnd() = sendKey("end")

    // 便捷组合键操作
    fun copy() {
        viewModelScope.launch {
            val result = inputCommands.copy()
            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Copy (Ctrl+C)") }
            }
        }
    }

    fun paste() {
        viewModelScope.launch {
            val result = inputCommands.paste()
            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Paste (Ctrl+V)") }
            }
        }
    }

    fun cut() {
        viewModelScope.launch {
            val result = inputCommands.cut()
            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Cut (Ctrl+X)") }
            }
        }
    }

    fun undo() {
        viewModelScope.launch {
            val result = inputCommands.undo()
            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Undo (Ctrl+Z)") }
            }
        }
    }

    fun selectAll() {
        viewModelScope.launch {
            val result = inputCommands.selectAll()
            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Select All (Ctrl+A)") }
            }
        }
    }

    fun save() {
        viewModelScope.launch {
            val result = inputCommands.save()
            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Save (Ctrl+S)") }
            }
        }
    }

    // ========== 鼠标操作 ==========

    /**
     * 移动鼠标
     */
    fun moveMouse(x: Int, y: Int, relative: Boolean = false) {
        viewModelScope.launch {
            val result = inputCommands.mouseMove(x, y, relative)

            if (result.isSuccess) {
                if (!relative) {
                    _cursorPosition.value = Pair(x, y)
                } else {
                    val (currentX, currentY) = _cursorPosition.value
                    _cursorPosition.value = Pair(currentX + x, currentY + y)
                }
            } else {
                Timber.w(result.exceptionOrNull(), "移动鼠标失败")
            }
        }
    }

    /**
     * 相对移动鼠标（触摸板模式）
     */
    fun moveMouseRelative(deltaX: Int, deltaY: Int) {
        moveMouse(deltaX, deltaY, relative = true)
    }

    /**
     * 鼠标左键单击
     */
    fun leftClick(x: Int? = null, y: Int? = null) {
        viewModelScope.launch {
            val result = inputCommands.leftClick(x, y)

            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Left Click") }
            } else {
                handleError(result.exceptionOrNull(), "鼠标点击失败")
            }
        }
    }

    /**
     * 鼠标右键单击
     */
    fun rightClick(x: Int? = null, y: Int? = null) {
        viewModelScope.launch {
            val result = inputCommands.rightClick(x, y)

            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Right Click") }
            } else {
                handleError(result.exceptionOrNull(), "鼠标点击失败")
            }
        }
    }

    /**
     * 鼠标双击
     */
    fun doubleClick(x: Int? = null, y: Int? = null) {
        viewModelScope.launch {
            val result = inputCommands.mouseDoubleClick("left", x, y)

            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Double Click") }
            } else {
                handleError(result.exceptionOrNull(), "鼠标双击失败")
            }
        }
    }

    /**
     * 鼠标拖拽
     */
    fun drag(startX: Int, startY: Int, endX: Int, endY: Int) {
        viewModelScope.launch {
            val result = inputCommands.mouseDrag(startX, startY, endX, endY)

            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Drag") }
            } else {
                handleError(result.exceptionOrNull(), "鼠标拖拽失败")
            }
        }
    }

    /**
     * 向上滚动
     */
    fun scrollUp(amount: Int = 3) {
        viewModelScope.launch {
            val result = inputCommands.scrollUp(amount)

            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Scroll Up") }
            }
        }
    }

    /**
     * 向下滚动
     */
    fun scrollDown(amount: Int = 3) {
        viewModelScope.launch {
            val result = inputCommands.scrollDown(amount)

            if (result.isSuccess) {
                _uiState.update { it.copy(lastAction = "Scroll Down") }
            }
        }
    }

    /**
     * 加载鼠标位置
     */
    fun loadCursorPosition() {
        viewModelScope.launch {
            val result = inputCommands.getCursorPosition()

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    _cursorPosition.value = Pair(response.x, response.y)
                }
            }
        }
    }

    /**
     * 加载键盘布局
     */
    fun loadKeyboardLayout() {
        viewModelScope.launch {
            val result = inputCommands.getKeyboardLayout()

            if (result.isSuccess) {
                _keyboardLayout.value = result.getOrNull()?.layout ?: "unknown"
            }
        }
    }

    /**
     * 切换输入模式
     */
    fun setInputMode(mode: InputMode) {
        _uiState.update { it.copy(inputMode = mode) }
    }

    /**
     * 处理错误
     */
    private fun handleError(throwable: Throwable?, defaultMessage: String) {
        val error = throwable?.message ?: defaultMessage
        Timber.e(throwable, defaultMessage)
        _uiState.update { it.copy(
            isExecuting = false,
            error = error
        )}
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * 输入模式
 */
enum class InputMode {
    KEYBOARD,
    MOUSE,
    TOUCHPAD,
    TEXT
}

/**
 * 输入控制 UI 状态
 */
@Immutable
data class InputControlUiState(
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    val inputMode: InputMode = InputMode.KEYBOARD
)
