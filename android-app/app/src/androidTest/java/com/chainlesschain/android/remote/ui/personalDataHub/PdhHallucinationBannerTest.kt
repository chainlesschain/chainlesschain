package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test

/**
 * 2026-06-03 — On-device Compose 渲染验证 for [PdhHallucinationBanner].
 *
 * banner 的触发（LLM 真幻觉）在真机问答流程里非确定性，无法靠"等模型编造"复现。
 * 这里直接 setContent 强制 count，确定性地验证三条 ask 界面共用的这个组件在真机上：
 *  - count>0 → 渲染告警标题 + 条数文案
 *  - count=0 → 提前返回，什么都不渲染（不能误显空 banner）
 *  - count=1 → 单条也显示（文案用 "$count 条"，无单复数分支）
 *
 * 纯 stateless composable，无 Hilt/VM，规避 mockk-on-final-VM emulator 坑
 * （memory android_mockk_viewmodel_androidtest_initializer_trap）。
 */
class PdhHallucinationBannerTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun countPositive_showsWarningTitleAndCount() {
        composeTestRule.setContent {
            PdhHallucinationBanner(count = 2)
        }
        composeTestRule.onNodeWithText("可能存在编造").assertIsDisplayed()
        composeTestRule.onNodeWithText("2 条本机记录", substring = true).assertIsDisplayed()
    }

    @Test
    fun countZero_rendersNothing() {
        composeTestRule.setContent {
            PdhHallucinationBanner(count = 0)
        }
        composeTestRule.onNodeWithText("可能存在编造").assertDoesNotExist()
    }

    @Test
    fun countOne_stillShows() {
        composeTestRule.setContent {
            PdhHallucinationBanner(count = 1)
        }
        composeTestRule.onNodeWithText("可能存在编造").assertIsDisplayed()
        composeTestRule.onNodeWithText("1 条本机记录", substring = true).assertIsDisplayed()
    }
}
