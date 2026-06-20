package com.chainlesschain.android.pdh

/**
 * §3.5.20 端侧资源预算(纯逻辑核)—— module 101 Phase 2。
 *
 * 手机资源受限:重活(大批采集 / 索引抽取 OCR·转写·embedding / 端侧 LLM 大任务)默认
 * 择机跑(充电 + WiFi + idle,§13.2),不抢前台;轻活(查询 / 小采集)立即。本核做
 * 纯决策:任务分级 + RUN_NOW/DEFER + 现在跑警示 + 存储超限。真正的 WorkManager 调度
 * 与电量/网络探测是 device-bound 集成层,基于本核搭建。
 *
 * **纯函数、可单测、无 Android 依赖**(设备状态作为入参注入)。
 */
object PdhResourceBudget {

    /** 任务轻重。 */
    enum class Weight { LIGHT, HEAVY }

    /** 用户可调预算(默认保守:省电省流量)。 */
    data class Settings(
        val wifiOnly: Boolean = true,
        val minBatteryPercent: Int = 20,
        val storageCapMb: Long = 2048,
    )

    /** 当前设备状态(调用方从 BatteryManager/ConnectivityManager 注入)。 */
    data class Device(
        val charging: Boolean,
        val batteryPercent: Int,
        val onWifi: Boolean,
    )

    /** 调度决策:是否延后 + 一句诚实原因。 */
    data class Decision(val deferred: Boolean, val reason: String)

    /** 任务分类:大批采集/索引/抽取/打捞/端侧大模型 = HEAVY;其余 LIGHT。 */
    fun weightOf(kind: String?): Weight {
        val k = (kind ?: "").lowercase()
        val heavy = k.contains("bulk") || k.contains("index") || k.contains("ocr") ||
            k.contains("transcrib") || k.contains("embed") || k.contains("salvage") ||
            k.contains("collect_all") || k.contains("collect_files")
        return if (heavy) Weight.HEAVY else Weight.LIGHT
    }

    /**
     * 默认调度:轻活立即;重活默认延后到 充电+WiFi(idle 由 WorkManager 引擎判,纯核
     * 只看 充电/WiFi/电量)。**绝不**因省资源静默升云——这只决定本机何时跑(§13.4)。
     */
    fun decide(weight: Weight, device: Device, settings: Settings): Decision {
        if (weight == Weight.LIGHT) return Decision(false, "轻任务,立即执行")
        // 网络达标 = 在 WiFi,或用户允许移动数据(wifiOnly=false)。
        val networkOk = device.onWifi || !settings.wifiOnly
        if (!networkOk) {
            return Decision(true, "等连上 WiFi 再采集(省流量)")
        }
        if (!device.charging && device.batteryPercent < settings.minBatteryPercent) {
            return Decision(true, "电量低(${device.batteryPercent}%),等充电再采集")
        }
        if (device.charging && networkOk) {
            return Decision(false, "充电且网络就绪,现在执行")
        }
        return Decision(true, "重活默认在充电 + WiFi 时执行(可「现在就跑」)")
    }

    /** 「现在就跑」覆盖时给的诚实成本提示;无成本则 null。 */
    fun forceRunWarning(device: Device, settings: Settings): String? {
        val w = buildList {
            if (!device.onWifi) add("将用移动数据")
            if (!device.charging) add("将耗电")
        }
        return if (w.isEmpty()) null else "现在执行:" + w.joinToString("、")
    }

    /** 存储占用是否超出上限(超则提醒降冷/导出后清,§7.4)。 */
    fun storageOverCap(usedMb: Long, settings: Settings): Boolean =
        usedMb > settings.storageCapMb
}
