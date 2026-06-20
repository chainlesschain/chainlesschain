package com.chainlesschain.android.pdh

/**
 * §3.5.16 跨设备操作(纯逻辑核)—— module 101 Phase 2。
 *
 * 在一台设备指挥另一台(查数据/指挥采集/办事)。与 §3.5.14(搬资产)正交,这条是
 * **驱动能力**。本核做纯决策:目标设备解析(只允许你 DID 名下已配对设备)、反向
 * (远端驱动本机)的本机确认策略(有副作用必须本机人确认、只读低危可免打扰但仍记台账)、
 * 跨设备事务双端确认。
 *
 * 真正的 libp2p / LAN / adb-forward 传输、远端入站钩子、设备选择 UI 是 §10 / Phase 8 /
 * device-bound。**纯函数、可单测、无 Android 依赖**。
 */
object PdhCrossDevice {

    /** 目标/来源设备必须是你已配对的自有设备(防驱动陌生设备)。 */
    fun isAuthorizedDevice(deviceId: String?, pairedDevices: Set<String>): Boolean =
        !deviceId.isNullOrBlank() && deviceId in pairedDevices

    /**
     * 解析本轮目标设备:空/选本机 → 本机;选他设备且已配对 → 该设备;选了未配对设备 →
     * 回退本机(调用方提示"连不上/未授权",诚实降级,不静默驱动陌生设备)。
     */
    fun resolveTarget(selected: String?, self: String, pairedDevices: Set<String>): String = when {
        selected.isNullOrBlank() || selected == self -> self
        selected in pairedDevices -> selected
        else -> self
    }

    /**
     * 只读低危工具(远端驱动本机时可免打扰,但仍记台账):查询/搜索/分析/全貌/列表/探活。
     * 采集/打捞/读文件/事务等有副作用或涉隐私 → 非只读。
     */
    fun isReadOnly(tool: String?): Boolean {
        val t = (tool ?: "").lowercase()
        return t.contains("query") || t.contains("search") || t.contains("analysis") ||
            t.contains("overview") || t.contains("event_detail") ||
            t.contains("list_collectors") || t.contains("ping")
    }

    /**
     * 远端驱动本机(INBOUND):有副作用/涉隐私的操作**必须本机人确认**(远端不能单方面
     * 在你手机上办事或采隐私);只读低危免打扰。
     */
    fun inboundNeedsLocalConfirm(tool: String?): Boolean = !isReadOnly(tool)

    /** 跨设备事务(在他设备上办事)= 双端确认(发起端 + 执行端都确认)。 */
    fun crossDeviceTxnNeedsDoubleConfirm(): Boolean = true
}
