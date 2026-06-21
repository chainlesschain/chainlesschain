package com.chainlesschain.android.pdh

import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §3.5.10 接线4 HubAsk route-config 桥接纯逻辑测试:可选档(云常在/局域网需 URL)、
 * 局域网 → ollama@LAN 覆盖(model 默认/可覆盖)、云与端侧/桌面 → 不覆盖。
 */
class PdhRouteBridgeTest {

    @Test
    fun cloud_always_selectable_lan_only_with_url() {
        assertEquals(
            listOf(LlmRoute.CLOUD_ANDROID),
            PdhRouteBridge.agentSelectableRoutes(PdhRouteBridge.Config(lanBaseUrl = null)),
        )
        assertEquals(
            listOf(LlmRoute.CLOUD_ANDROID, LlmRoute.LAN_OLLAMA),
            PdhRouteBridge.agentSelectableRoutes(
                PdhRouteBridge.Config(lanBaseUrl = "http://192.168.1.5:11434"),
            ),
        )
    }

    @Test
    fun on_device_and_desktop_are_not_agent_selectable() {
        val cfg = PdhRouteBridge.Config(lanBaseUrl = "http://lan:11434")
        assertFalse(PdhRouteBridge.isAgentSelectable(LlmRoute.LOCAL_DEVICE, cfg))
        assertFalse(PdhRouteBridge.isAgentSelectable(LlmRoute.PC_LOCAL, cfg))
        assertTrue(PdhRouteBridge.isAgentSelectable(LlmRoute.CLOUD_ANDROID, cfg))
        assertTrue(PdhRouteBridge.isAgentSelectable(LlmRoute.LAN_OLLAMA, cfg))
    }

    @Test
    fun lan_maps_to_ollama_override_with_default_model() {
        val o = PdhRouteBridge.toLlmOverride(
            LlmRoute.LAN_OLLAMA,
            PdhRouteBridge.Config(lanBaseUrl = "http://192.168.1.5:11434"),
        )
        assertEquals("ollama", o!!.provider)
        assertEquals(PdhRouteBridge.DEFAULT_LAN_MODEL, o.model)
        assertEquals("http://192.168.1.5:11434", o.baseUrl)
    }

    @Test
    fun lan_model_is_overridable() {
        val o = PdhRouteBridge.toLlmOverride(
            LlmRoute.LAN_OLLAMA,
            PdhRouteBridge.Config(lanBaseUrl = "http://lan:11434", lanModel = "llama3.2"),
        )
        assertEquals("llama3.2", o!!.model)
    }

    @Test
    fun cloud_and_unconfigured_lan_and_local_have_no_override() {
        // 云 = 会话默认,不覆盖
        assertNull(
            PdhRouteBridge.toLlmOverride(
                LlmRoute.CLOUD_ANDROID,
                PdhRouteBridge.Config(lanBaseUrl = "http://lan:11434"),
            ),
        )
        // 局域网但没配 URL → 无覆盖(调用方退回默认)
        assertNull(
            PdhRouteBridge.toLlmOverride(
                LlmRoute.LAN_OLLAMA,
                PdhRouteBridge.Config(lanBaseUrl = null),
            ),
        )
        // 端侧 = 非直连 cc 端点
        assertNull(
            PdhRouteBridge.toLlmOverride(
                LlmRoute.LOCAL_DEVICE,
                PdhRouteBridge.Config(lanBaseUrl = "http://lan:11434"),
            ),
        )
    }
}
