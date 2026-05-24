package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chainlesschain.android.remote.commands.HealthLlm
import com.chainlesschain.android.remote.commands.HealthOk
import com.chainlesschain.android.remote.commands.HealthVault
import com.chainlesschain.android.remote.commands.HubHealth
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals

/**
 * 2026-05-24 — Compose UI integration test for the 4-way LLM route selector
 * surfaced on tab 0 [HubAskScreen] and tabs 3/4 ([HubAskCard]).
 *
 * Both surfaces are stateless composables (state + onClick callback), so they
 * test cleanly without mockk-on-final-VM emulator pitfalls (see memory
 * `android_mockk_viewmodel_androidtest_initializer_trap`).
 *
 * Scenarios per surface:
 *  1. 0 routes available → errorContainer banner shown, no radio
 *  2. 1 route available → single-label readout, no radio
 *  3. ≥2 routes available → 4 radios visible, disabled-state honored
 *  4. RadioButton click → callback fires with expected route enum value
 */
class HubAskRouteSelectorTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    // ─── tab 0 — HubAskScreen.HubAskRouteSelector ─────────────────────────

    @Test
    fun screen_noRoutesAvailable_showsConfigBanner() {
        composeTestRule.setContent {
            HubAskRouteSelector(
                state = HubAskUiState(),  // all defaults: nothing available
                isLoading = false,
                onRouteSelected = {},
            )
        }
        composeTestRule.onNodeWithText("暂无可用 LLM", substring = true).assertIsDisplayed()
    }

    @Test
    fun screen_onlyCloudAvailable_showsSingleLabel() {
        val state = HubAskUiState(
            androidLlm = AndroidLocalLlmExecutor.ConfiguredProvider(
                provider = com.chainlesschain.android.feature.ai.domain.model.LLMProvider.DOUBAO,
                model = "doubao-pro-32k",
                displayLabel = "豆包",
            ),
        )
        composeTestRule.setContent {
            HubAskRouteSelector(state = state, isLoading = false, onRouteSelected = {})
        }
        composeTestRule.onNodeWithText("推理走云 LLM", substring = true).assertIsDisplayed()
        // single-label form has NO radio rows — text "PC 本机模型" shouldn't appear
        composeTestRule.onNodeWithText("PC 本机模型", substring = true).assertDoesNotExist()
    }

    @Test
    fun screen_multipleRoutesAvailable_showsRadios() {
        val state = HubAskUiState(
            androidLlm = AndroidLocalLlmExecutor.ConfiguredProvider(
                provider = com.chainlesschain.android.feature.ai.domain.model.LLMProvider.DOUBAO,
                model = "doubao-pro",
                displayLabel = "豆包",
            ),
            health = HubHealth(
                vault = HealthVault(ok = true, schemaVersion = 1),
                llm = HealthLlm(ok = true, isLocal = true, name = "ollama:qwen2.5"),
                kgSink = HealthOk(ok = true),
                ragSink = HealthOk(ok = true),
            ),
            localDeviceReady = true,
            lanLlmBaseUrl = "http://192.168.1.5:11434",
        )
        composeTestRule.setContent {
            HubAskRouteSelector(state = state, isLoading = false, onRouteSelected = {})
        }
        // 4 routes all visible
        composeTestRule.onNodeWithText("云 LLM", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("PC 本机模型", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("本地模型", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("局域网 LLM", substring = true).assertIsDisplayed()
    }

    @Test
    fun screen_radioClick_invokesCallbackWithRoute() {
        var captured: LlmRoute? = null
        val state = HubAskUiState(
            androidLlm = AndroidLocalLlmExecutor.ConfiguredProvider(
                provider = com.chainlesschain.android.feature.ai.domain.model.LLMProvider.DOUBAO,
                model = "doubao-pro",
                displayLabel = "豆包",
            ),
            health = HubHealth(
                vault = HealthVault(ok = true, schemaVersion = 1),
                llm = HealthLlm(ok = true, isLocal = true, name = "ollama:qwen2.5"),
                kgSink = HealthOk(ok = true),
                ragSink = HealthOk(ok = true),
            ),
        )
        composeTestRule.setContent {
            HubAskRouteSelector(
                state = state,
                isLoading = false,
                onRouteSelected = { captured = it },
            )
        }
        // Click the PC_LOCAL row's text. RadioButton has no semantic label,
        // but clicking the wrapping Row label propagates via onClick.
        composeTestRule.onNodeWithText("PC 本机模型", substring = true).performClick()
        assertEquals(LlmRoute.PC_LOCAL, captured)
    }

    // ─── tab 3/4 — HubAskCard.HubAskCardRouteSelector ─────────────────────

    @Test
    fun card_noRoutesAvailable_showsConfigBanner() {
        composeTestRule.setContent {
            HubAskCardRouteSelector(
                state = HubLocalViewModel.AskCardState(),
                isLoading = false,
                onRouteSelected = {},
            )
        }
        composeTestRule.onNodeWithText("暂无可用 LLM", substring = true).assertIsDisplayed()
    }

    @Test
    fun card_onlyLocalDeviceAvailable_showsSingleLabel() {
        composeTestRule.setContent {
            HubAskCardRouteSelector(
                state = HubLocalViewModel.AskCardState(localDeviceReady = true),
                isLoading = false,
                onRouteSelected = {},
            )
        }
        composeTestRule.onNodeWithText("推理走端侧 LocalLlmServer", substring = true)
            .assertIsDisplayed()
        composeTestRule.onNodeWithText("PC 本机模型", substring = true).assertDoesNotExist()
    }

    @Test
    fun card_allFourRoutesAvailable_showsRadios() {
        val state = HubLocalViewModel.AskCardState(
            localDeviceReady = true,
            androidLlm = AndroidLocalLlmExecutor.ConfiguredProvider(
                provider = com.chainlesschain.android.feature.ai.domain.model.LLMProvider.DEEPSEEK,
                model = "deepseek-chat",
                displayLabel = "DeepSeek",
            ),
            remoteHealth = HubHealth(
                vault = HealthVault(ok = true, schemaVersion = 1),
                llm = HealthLlm(ok = true, isLocal = true, name = "ollama:llama3"),
                kgSink = HealthOk(ok = true),
                ragSink = HealthOk(ok = true),
            ),
            lanLlmBaseUrl = "http://10.0.0.5:11434",
        )
        composeTestRule.setContent {
            HubAskCardRouteSelector(state = state, isLoading = false, onRouteSelected = {})
        }
        composeTestRule.onNodeWithText("本地模型", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("云 LLM", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("PC 本机模型", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("局域网 LLM", substring = true).assertIsDisplayed()
    }

    @Test
    fun card_radioClick_invokesCallback() {
        var captured: LlmRoute? = null
        val state = HubLocalViewModel.AskCardState(
            localDeviceReady = true,
            lanLlmBaseUrl = "http://10.0.0.5:11434",
        )
        composeTestRule.setContent {
            HubAskCardRouteSelector(
                state = state,
                isLoading = false,
                onRouteSelected = { captured = it },
            )
        }
        composeTestRule.onNodeWithText("局域网 LLM", substring = true).performClick()
        assertEquals(LlmRoute.LAN_OLLAMA, captured)
    }

    @Test
    fun card_isLoadingHidesRadiosWhenAllOthersAvailable_keepsLabelsVisible() {
        // isLoading=true 把 onClick 抹成 null。我们不直接 performClick (Compose-test
        // 会在 disabled 节点上抛)。仅断言 4 个 route label 仍然可见,
        // 验证 radio container 没在 isLoading=true 时被整段隐藏（与"暂无可用 LLM" banner 区分）。
        val state = HubLocalViewModel.AskCardState(
            localDeviceReady = true,
            lanLlmBaseUrl = "http://10.0.0.5:11434",
        )
        composeTestRule.setContent {
            HubAskCardRouteSelector(state = state, isLoading = true, onRouteSelected = {})
        }
        composeTestRule.onNodeWithText("本地模型", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("局域网 LLM", substring = true).assertIsDisplayed()
        // banner 不该出 — 仍有 2 路可用 (localDevice + lan)
        composeTestRule.onNodeWithText("暂无可用 LLM", substring = true).assertDoesNotExist()
    }
}
