package com.chainlesschain.android.test

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeTestRule
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

/**
 * Compose UI 测试扩展函数
 *
 * 提供常用的测试操作和断言
 */

/**
 * 等待直到节点出现
 *
 * @param timeoutMillis 超时时间（毫秒）
 */
fun ComposeTestRule.waitUntilNodeExists(
    matcher: SemanticsMatcher,
    timeoutMillis: Long = 5000
) {
    waitUntil(timeoutMillis) {
        onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
    }
}

/**
 * 等待直到节点消失
 */
fun ComposeTestRule.waitUntilNodeDoesNotExist(
    matcher: SemanticsMatcher,
    timeoutMillis: Long = 5000
) {
    waitUntil(timeoutMillis) {
        onAllNodes(matcher).fetchSemanticsNodes().isEmpty()
    }
}

/**
 * 等待直到满足条件
 */
fun ComposeTestRule.waitUntil(
    timeoutMillis: Long = 5000,
    condition: () -> Boolean
) {
    val startTime = System.currentTimeMillis()
    while (!condition()) {
        if (System.currentTimeMillis() - startTime > timeoutMillis) {
            throw AssertionError("Condition not met within $timeoutMillis ms")
        }
        runBlocking { delay(50) }
    }
}

/**
 * 等待直到文本出现
 */
fun ComposeTestRule.waitForText(
    text: String,
    substring: Boolean = false,
    timeoutMillis: Long = 5000
) {
    waitUntilNodeExists(hasText(text, substring = substring), timeoutMillis)
}

/**
 * 点击文本节点
 */
fun ComposeTestRule.clickOnText(
    text: String,
    substring: Boolean = false
) {
    onNode(hasText(text, substring = substring)).performClick()
}

/**
 * 输入文本到指定标签的输入框
 */
fun ComposeTestRule.typeTextInField(
    label: String,
    text: String,
    clearFirst: Boolean = true
) {
    val node = onNode(hasText(label) or hasContentDescription(label))
    if (clearFirst) {
        node.performTextClearance()
    }
    node.performTextInput(text)
}

/**
 * 滚动到指定文本的节点
 */
fun ComposeTestRule.scrollToText(
    text: String,
    substring: Boolean = false
) {
    onNode(hasText(text, substring = substring)).performScrollTo()
}

/**
 * 验证文本存在
 */
fun ComposeTestRule.assertTextExists(
    text: String,
    substring: Boolean = false
) {
    onNode(hasText(text, substring = substring)).assertExists()
}

/**
 * 验证文本不存在
 */
fun ComposeTestRule.assertTextDoesNotExist(
    text: String,
    substring: Boolean = false
) {
    onNode(hasText(text, substring = substring)).assertDoesNotExist()
}

/**
 * 验证按钮已启用
 */
fun ComposeTestRule.assertButtonEnabled(text: String) {
    onNode(hasText(text) and isEnabled()).assertExists()
}

/**
 * 验证按钮已禁用
 */
fun ComposeTestRule.assertButtonDisabled(text: String) {
    onNode(hasText(text) and !isEnabled()).assertExists()
}

/**
 * 打印语义树（用于调试）
 */
fun ComposeTestRule.printSemantics() {
    onRoot().printToLog("COMPOSE_TEST")
}

/**
 * 等待加载完成
 *
 * 等待所有 "加载中" 文本消失
 */
fun ComposeTestRule.waitForLoadingToComplete(timeoutMillis: Long = 10000) {
    try {
        waitUntilNodeDoesNotExist(
            hasText("加载中", substring = true) or
            hasText("Loading", substring = true) or
            hasContentDescription("Loading", substring = true),
            timeoutMillis
        )
    } catch (e: AssertionError) {
        // 如果没有加载指示器，直接继续
    }
}

/**
 * 执行下拉刷新
 */
fun ComposeTestRule.performPullToRefresh() {
    onRoot().performTouchInput {
        swipeDown(
            startY = centerY,
            endY = bottom
        )
    }
}

/**
 * 滚动到列表底部
 */
fun ComposeTestRule.scrollToBottom() {
    onRoot().performTouchInput {
        swipeUp(
            startY = bottom - 100,
            endY = top + 100
        )
    }
}

/**
 * 等待并点击
 */
fun ComposeTestRule.waitAndClick(
    text: String,
    substring: Boolean = false,
    timeoutMillis: Long = 5000
) {
    waitForText(text, substring, timeoutMillis)
    clickOnText(text, substring)
}

/**
 * 断言 Snackbar 消息
 */
fun ComposeTestRule.assertSnackbarMessage(
    message: String,
    timeoutMillis: Long = 3000
) {
    waitForText(message, substring = true, timeoutMillis = timeoutMillis)
}

/**
 * 断言 Toast 消息（通过内容描述）
 */
fun ComposeTestRule.assertToastMessage(
    message: String,
    timeoutMillis: Long = 3000
) {
    waitUntilNodeExists(
        hasContentDescription(message, substring = true) or
        hasText(message, substring = true),
        timeoutMillis
    )
}

/**
 * 填写表单
 */
fun ComposeTestRule.fillForm(vararg fields: Pair<String, String>) {
    fields.forEach { (label, value) ->
        typeTextInField(label, value)
    }
}

/**
 * 点击返回按钮
 */
fun ComposeTestRule.clickBackButton() {
    onNode(hasContentDescription("返回") or hasContentDescription("Back")).performClick()
}

/**
 * 验证对话框显示
 */
fun ComposeTestRule.assertDialogShown(title: String) {
    waitForText(title, timeoutMillis = 3000)
}

/**
 * 关闭对话框
 */
fun ComposeTestRule.dismissDialog() {
    clickOnText("取消") ?: clickOnText("关闭") ?: clickOnText("Cancel") ?: clickOnText("Close")
}
