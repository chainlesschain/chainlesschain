package com.chainlesschain.android.test

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.printToLog
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

// Compose UI test rule extensions shared across all androidTest source sets.
//
// Originally located at :app/src/androidTest/.../test/ComposeTestExtensions.kt
// (not visible to feature modules' androidTest source sets), now lifted into
// :core-test-helpers/main so any module can do
//   androidTestImplementation(project(":core-test-helpers"))
// to get them. Behavior preserved from the :app version (commit 4bfc8f474).

/**
 * 等待直到节点出现
 */
fun ComposeTestRule.waitUntilNodeExists(
    matcher: SemanticsMatcher,
    timeoutMillis: Long = 5000
) {
    waitUntilCondition(timeoutMillis) {
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
    waitUntilCondition(timeoutMillis) {
        onAllNodes(matcher).fetchSemanticsNodes().isEmpty()
    }
}

/**
 * 自旋等待直到条件满足或超时。
 *
 * 命名注意：函数原名是 `waitUntil`，但那会和 [ComposeTestRule.waitUntil] 同名/同
 * 签名造成 import 二义性（受测代码若 wildcard 引入 `androidx.compose.ui.test.*`
 * 会拿到 Compose 自带的 waitUntil；本扩展又重名导致编译器无法选择）。改名为
 * `waitUntilCondition` 让用途和 Compose 内置版本明确区分。
 */
fun ComposeTestRule.waitUntilCondition(
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
 * 在惰性列表（LazyColumn/LazyRow）中滚动到指定文本。
 *
 * [scrollToText] 的 `performScrollTo()` 要求节点已存在于语义树——但 LazyColumn
 * 只组合视口内的条目，视口外的目标根本没有节点，`performScrollTo` 直接失败。
 * 这里改为对滚动容器本身 `performScrollToNode(matcher)`，由列表负责把目标
 * 条目滚进来（同时天然驱动 Paging3 加载后续页）。要求屏幕上只有一个支持
 * scroll-to-node 的容器，多于一个时 onNode 会因歧义报错。
 */
fun ComposeTestRule.scrollListToText(
    text: String,
    substring: Boolean = false
) {
    onNode(hasScrollToNodeAction())
        .performScrollToNode(hasText(text, substring = substring))
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
        // 没有加载指示器时跳过
    }
}

/**
 * 执行下拉刷新
 */
fun ComposeTestRule.performPullToRefresh() {
    onRoot().performTouchInput {
        swipeDown(startY = centerY, endY = bottom)
    }
}

/**
 * 滚动到列表底部
 */
fun ComposeTestRule.scrollToBottom() {
    onRoot().performTouchInput {
        swipeUp(startY = bottom - 100, endY = top + 100)
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
 * 尝试关闭对话框（按常见标签顺序）
 *
 * 与 :app 版本相比修正了一处逻辑 bug：原版 `clickOnText("X") ?: clickOnText("Y")`
 * 不可能 fall through —— clickOnText 返回 Unit（非 nullable），第二个分支永远死代
 * 码。新实现先 `onAllNodes` 探测节点是否存在，再点真正出现的那个。
 */
fun ComposeTestRule.dismissDialog() {
    val candidates = listOf("取消", "关闭", "Cancel", "Close", "Dismiss")
    for (label in candidates) {
        if (onAllNodes(hasText(label)).fetchSemanticsNodes().isNotEmpty()) {
            clickOnText(label)
            return
        }
    }
    throw AssertionError("No dismiss button found (tried: $candidates)")
}
