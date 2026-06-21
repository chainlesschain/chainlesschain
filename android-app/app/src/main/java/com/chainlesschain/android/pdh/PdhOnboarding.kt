package com.chainlesschain.android.pdh

/**
 * §3.5.19 首跑 onboarding(纯逻辑核)—— module 101 Phase 2。
 *
 * 低门槛 = 普惠的入口(§13.1):首跑三步(建/认领 DID → 选源 → 一键采集),免 root
 * 默认先出价值。本核做纯决策:首跑检测(老用户跳过 / 新用户三步 / 换机恢复)、三步
 * 状态机、免 root 默认源 vs 高级源。
 *
 * DID 建/认领、vault 判空、采集触发(接 §3.5.15)、首份 data_overview 成果(接 §3.5.12)
 * 是 device/集成层;本核 + onboarding 三步 UI 是 Phase 2 的入口。**纯函数、可单测**。
 */
object PdhOnboarding {

    /** 首跑去向。 */
    enum class StartMode {
        /** 老用户:有 DID + 非空 vault → 直接对话。 */
        SKIP,

        /** 新用户:无 DID → 走三步 onboarding。 */
        FRESH,

        /** 换机:有 DID 但本地 vault 空 → 提示从备份恢复(§3.5.14),不重新采集。 */
        RECOVER,
    }

    /** Onboarding 三步。 */
    enum class Step { IDENTITY, SOURCES, COLLECT }

    /**
     * 首跑检测:
     *  无 DID → FRESH;有 DID + vault 非空 → SKIP;有 DID + vault 空 → RECOVER。
     */
    fun decideStart(hasDid: Boolean, vaultNonEmpty: Boolean): StartMode = when {
        !hasDid -> StartMode.FRESH
        vaultNonEmpty -> StartMode.SKIP
        else -> StartMode.RECOVER
    }

    /** 三步顺序:下一步;COLLECT 之后为 null(完成 → 进对话)。 */
    fun nextStep(current: Step): Step? = when (current) {
        Step.IDENTITY -> Step.SOURCES
        Step.SOURCES -> Step.COLLECT
        Step.COLLECT -> null
    }

    /** 免 root 默认源(普惠先出价值):L2 系统数据 + L1 本地文件。 */
    val DEFAULT_SOURCES: List<String> = listOf("system_data", "local_files")

    /** 高级源(需 root / cookie 登录),折叠在"高级,可选",不强制、不吓退。 */
    val ADVANCED_SOURCES: List<String> = listOf("app_data", "salvage")

    /** 是否高级源(默认不勾选、折叠展示)。 */
    fun isAdvanced(source: String): Boolean = source in ADVANCED_SOURCES

    /** 源 key → 中文标签(选源 chips + 采集 prompt;诚实列实际可采源,不画饼)。 */
    fun sourceLabel(source: String): String = when (source) {
        "system_data" -> "系统数据(联系人/短信/通话/媒体)"
        "local_files" -> "本地文件(文档/图片/下载)"
        "app_data" -> "App 数据(需登录/cookie)"
        "salvage" -> "App 数据库取证(需 root)"
        else -> source
    }

    /**
     * §3.5.19 接线4: 选中源 → 一句话采集请求,交给常驻 agent 的工具循环执行
     * (复用现成 chat 管线,无新协议)。空集合 → 空串(调用方禁用按钮,不偷采)。
     */
    fun collectPrompt(sources: Collection<String>): String {
        val labels = sources.map(::sourceLabel)
        if (labels.isEmpty()) return ""
        return "请采集我的" + labels.joinToString("、") + ",汇入我的本地数据库,然后给我一份数据全貌。"
    }
}
