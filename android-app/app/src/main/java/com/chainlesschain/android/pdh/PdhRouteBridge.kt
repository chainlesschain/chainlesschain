package com.chainlesschain.android.pdh

import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute

/**
 * §3.5.10 接线4 — HubAsk route-config ↔ agent bridge (纯逻辑核) —— module 101.
 *
 * 把隐私档位([LlmRoute],复用 HubAsk 的 4 档定义)映射成 PDH 对话助手那一轮的 cc-agent
 * per-turn LLM 覆盖(接线6)。**只有 cc agent 能直连的档可选**:
 *  - 云 (CLOUD_ANDROID) = 会话默认(不覆盖,走 session LLM);
 *  - 局域网 (LAN_OLLAMA) = provider=ollama + 你的 LAN URL(直连)。
 * 端侧 (LOCAL_DEVICE = MediaPipe,非 cc provider) / 桌面 (PC_LOCAL = 委托桌面 hub,
 * 非直连端点) **对话助手不可直驱** → 不进可选档(诚实,§13.4),仅在「本机数据」问答用。
 *
 * 配置来自 HubAsk 的同一来源(LlmPreferences 的 LAN URL);**纯函数、可单测、无 Android
 * 依赖**(LlmRoute 是纯 enum)。真正连远端推理仍是 cc 侧 per-turn override(接线6)。
 */
object PdhRouteBridge {

    /** LAN 档默认 Ollama 模型(LlmPreferences 暂不存 LAN model;可由 [Config] 覆盖)。 */
    const val DEFAULT_LAN_MODEL = "qwen2.5"

    /** 对话助手需要的 HubAsk 路由配置(LAN URL / 可选 LAN model)。 */
    data class Config(val lanBaseUrl: String?, val lanModel: String? = null)

    /** 一轮的 cc-agent LLM 覆盖(接线6 的 `{type:user,llm:{…}}`)。 */
    data class LlmOverride(val provider: String, val model: String, val baseUrl: String)

    /** cc AGENT 能直驱的档:云常在;局域网仅当配了 LAN URL。 */
    fun agentSelectableRoutes(cfg: Config): List<LlmRoute> = buildList {
        add(LlmRoute.CLOUD_ANDROID)
        if (!cfg.lanBaseUrl.isNullOrBlank()) add(LlmRoute.LAN_OLLAMA)
    }

    /** 该档是否对话助手可直驱(可作为有效选择)。 */
    fun isAgentSelectable(route: LlmRoute, cfg: Config): Boolean =
        route in agentSelectableRoutes(cfg)

    /**
     * [route] 的 per-turn LLM 覆盖:
     *  - 局域网 + 有 LAN URL → ollama@LAN(model 取 [Config.lanModel] 或 [DEFAULT_LAN_MODEL]);
     *  - 云 → null(用会话默认,不覆盖);
     *  - 端侧/桌面 或 LAN 无 URL → null(非直连端点 / 未配置 → 调用方退回默认)。
     */
    fun toLlmOverride(route: LlmRoute, cfg: Config): LlmOverride? = when (route) {
        LlmRoute.LAN_OLLAMA ->
            if (cfg.lanBaseUrl.isNullOrBlank()) {
                null
            } else {
                LlmOverride(
                    provider = "ollama",
                    model = cfg.lanModel?.takeIf { it.isNotBlank() } ?: DEFAULT_LAN_MODEL,
                    baseUrl = cfg.lanBaseUrl,
                )
            }
        else -> null // 云=会话默认;端侧/桌面=非直连 cc 端点
    }
}
