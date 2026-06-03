package com.chainlesschain.android.presentation.screens

import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.remote.commands.HealthLlm
import com.chainlesschain.android.remote.commands.HealthOk
import com.chainlesschain.android.remote.commands.HealthVault
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.ui.personalDataHub.AndroidLocalLlmExecutor
import com.chainlesschain.android.remote.ui.personalDataHub.HubLocalViewModel
import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * 2026-05-24 — 首页 ChatInputBar Send 前 4 路 availability gate 测试。
 *
 * Invariant：用户 chip 永远可点（让"切换"反馈即时），但 Send 必须用 [resolveHomeAskGate]
 * 校验所选路真配置过，否则跳配置页而不是 silent crash on submit。
 *
 * 加新 LlmRoute 时这个测试会 enum-exhaustive 强制 reviewer 显式扩展 4 个分支。
 */
class HomeAskGateTest {

    private fun stubProvider() = AndroidLocalLlmExecutor.ConfiguredProvider(
        provider = LLMProvider.OPENAI,
        model = "stub-model",
        displayLabel = "stub",
    )

    private fun stubHealth(isLocal: Boolean = true) = HubHealth(
        vault = HealthVault(ok = true),
        llm = HealthLlm(ok = true, isLocal = isLocal, name = "stub-ollama"),
        kgSink = HealthOk(ok = true),
        ragSink = HealthOk(ok = true),
    )

    private fun stateWith(
        route: LlmRoute,
        localReady: Boolean = false,
        cloudConfigured: Boolean = false,
        pcLocal: Boolean = false,
        lan: String? = null,
    ): HubLocalViewModel.AskCardState = HubLocalViewModel.AskCardState(
        selectedRoute = route,
        localDeviceReady = localReady,
        androidLlm = if (cloudConfigured) stubProvider() else null,
        remoteHealth = if (pcLocal) stubHealth(isLocal = true) else null,
        lanLlmBaseUrl = lan,
    )

    @Test
    fun local_device_available_submits() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.LOCAL_DEVICE, localReady = true))
        assertEquals(HomeAskGateDecision.Submit, decision)
    }

    @Test
    fun local_device_unavailable_needs_config() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.LOCAL_DEVICE, localReady = false))
        val need = assertIs<HomeAskGateDecision.NeedConfig>(decision)
        assertEquals(LlmRoute.LOCAL_DEVICE, need.route)
    }

    @Test
    fun cloud_available_submits() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.CLOUD_ANDROID, cloudConfigured = true))
        assertEquals(HomeAskGateDecision.Submit, decision)
    }

    @Test
    fun cloud_unavailable_needs_config() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.CLOUD_ANDROID, cloudConfigured = false))
        val need = assertIs<HomeAskGateDecision.NeedConfig>(decision)
        assertEquals(LlmRoute.CLOUD_ANDROID, need.route)
    }

    @Test
    fun pc_local_available_submits() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.PC_LOCAL, pcLocal = true))
        assertEquals(HomeAskGateDecision.Submit, decision)
    }

    @Test
    fun pc_local_unavailable_needs_config() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.PC_LOCAL, pcLocal = false))
        val need = assertIs<HomeAskGateDecision.NeedConfig>(decision)
        assertEquals(LlmRoute.PC_LOCAL, need.route)
    }

    @Test
    fun pc_paired_but_remote_llm_not_local_needs_config() {
        // 桌面已配对但桌面那端是云 LLM（isLocal=false）→ PC_LOCAL 不算可用
        val state = HubLocalViewModel.AskCardState(
            selectedRoute = LlmRoute.PC_LOCAL,
            remoteHealth = stubHealth(isLocal = false),
        )
        val decision = resolveHomeAskGate(state)
        val need = assertIs<HomeAskGateDecision.NeedConfig>(decision)
        assertEquals(LlmRoute.PC_LOCAL, need.route)
    }

    @Test
    fun lan_available_submits() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.LAN_OLLAMA, lan = "http://192.168.1.10:11434"))
        assertEquals(HomeAskGateDecision.Submit, decision)
    }

    @Test
    fun lan_blank_needs_config() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.LAN_OLLAMA, lan = ""))
        val need = assertIs<HomeAskGateDecision.NeedConfig>(decision)
        assertEquals(LlmRoute.LAN_OLLAMA, need.route)
    }

    @Test
    fun lan_null_needs_config() {
        val decision = resolveHomeAskGate(stateWith(LlmRoute.LAN_OLLAMA, lan = null))
        val need = assertIs<HomeAskGateDecision.NeedConfig>(decision)
        assertEquals(LlmRoute.LAN_OLLAMA, need.route)
    }

    /**
     * 守护：4 路全部覆盖。新增 LlmRoute 值时这个测试随之扩展，否则
     * resolveHomeAskGate 的 when 缺分支编译失败 — 让 reviewer 显式选择
     * 「新路要不要校验 availability」而不是隐式默认通过。
     */
    @Test
    fun every_route_has_explicit_branch() {
        LlmRoute.values().forEach { route ->
            val decision = resolveHomeAskGate(stateWith(route))
            val need = assertIs<HomeAskGateDecision.NeedConfig>(decision, "route=$route")
            assertEquals(route, need.route, "route=$route")
        }
    }
}
