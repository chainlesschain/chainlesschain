package com.chainlesschain.android.presentation.screens

import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
import org.junit.Test
import kotlin.test.assertEquals

/**
 * 2026-05-24 — 首页 ChatInputBar 4 路 LLM selector send 分流决策测试。
 *
 * 关键 invariant：CLOUD_ANDROID（手机端云 LLM）路径走老 AI 聊天屏（无 RAG），
 * 其他 3 路（LOCAL_DEVICE / LAN_OLLAMA / PC_LOCAL）全走本机 vault RAG。
 * 加新路由时必须显式扩展枚举映射，否则 when 缺分支编译失败 — 阻止隐式回退。
 */
class HomeSendActionTest {

    @Test
    fun cloud_route_navs_to_existing_ai_chat() {
        assertEquals(
            HomeSendAction.NAV_CLOUD_CHAT,
            resolveHomeSendAction(LlmRoute.CLOUD_ANDROID),
        )
    }

    @Test
    fun local_device_invokes_local_rag() {
        assertEquals(
            HomeSendAction.INVOKE_LOCAL_RAG,
            resolveHomeSendAction(LlmRoute.LOCAL_DEVICE),
        )
    }

    @Test
    fun lan_ollama_invokes_local_rag() {
        assertEquals(
            HomeSendAction.INVOKE_LOCAL_RAG,
            resolveHomeSendAction(LlmRoute.LAN_OLLAMA),
        )
    }

    @Test
    fun pc_local_invokes_local_rag() {
        assertEquals(
            HomeSendAction.INVOKE_LOCAL_RAG,
            resolveHomeSendAction(LlmRoute.PC_LOCAL),
        )
    }

    /**
     * 守护：4 路全部覆盖。新增 LlmRoute 值时这个测试必随之扩展，否则
     * resolveHomeSendAction 的 when 缺分支编译失败 — 把"新路由该走 cloud 还是
     * local RAG"的决策强制摆到 reviewer 面前。
     */
    @Test
    fun every_route_value_has_explicit_mapping() {
        val expected = mapOf(
            LlmRoute.CLOUD_ANDROID to HomeSendAction.NAV_CLOUD_CHAT,
            LlmRoute.LOCAL_DEVICE to HomeSendAction.INVOKE_LOCAL_RAG,
            LlmRoute.LAN_OLLAMA to HomeSendAction.INVOKE_LOCAL_RAG,
            LlmRoute.PC_LOCAL to HomeSendAction.INVOKE_LOCAL_RAG,
        )
        LlmRoute.values().forEach { route ->
            assertEquals(expected[route], resolveHomeSendAction(route), "route=$route")
        }
    }
}
