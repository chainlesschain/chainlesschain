package com.chainlesschain.android.push.vendor

import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 P1：按 manufacturer 自动选 vendor，加 user override。
 *
 * 决策顺序：
 *  1. user override（[VendorPreferences.userOverride] 非 null）→ 直接用
 *  2. auto-detect by [android.os.Build.MANUFACTURER] 匹配 [PushVendor.matchers]
 *  3. fallback → [PushVendor.Fcm]（海外设备 / Pixel / Samsung 国际）
 *
 * 测试可注 [manufacturerProvider] fake 控制 manufacturer string，避免 Robolectric 依赖。
 */
@Singleton
class PushVendorRegistry @Inject constructor(
    private val xiaomi: XiaomiPushService,
    private val huawei: HuaweiPushService,
    private val oppo: OppoPushService,
    private val vivo: VivoPushService,
    private val fcm: FcmPushService,
    private val preferences: VendorPreferences,
    private val manufacturerProvider: ManufacturerProvider = ManufacturerProvider.System,
) {

    /**
     * 当前应使用的 vendor service。读 preferences override 优先；否则自动检测。
     */
    fun selectVendor(): VendorPushService {
        val override = preferences.userOverride.value
        if (override != null) {
            Timber.d("PushVendorRegistry: user override → $override")
            return resolve(override)
        }
        val detected = autoDetect()
        Timber.d("PushVendorRegistry: auto-detected → ${detected.vendor}")
        return detected
    }

    /**
     * 公开 auto-detect 给 Settings UI 显示"检测到的 vendor"标签。
     */
    fun autoDetect(): VendorPushService {
        val mfr = manufacturerProvider.manufacturer().lowercase()
        for (vendor in PushVendor.values()) {
            if (vendor == PushVendor.Fcm) continue  // FCM 是 fallback，不参与 match
            if (vendor.matchers.any { mfr.contains(it) }) {
                return resolve(vendor)
            }
        }
        return fcm
    }

    /** 列出全部 vendor service（Settings UI RadioGroup 用）。 */
    fun all(): List<VendorPushService> = listOf(xiaomi, huawei, oppo, vivo, fcm)

    private fun resolve(vendor: PushVendor): VendorPushService = when (vendor) {
        PushVendor.Xiaomi -> xiaomi
        PushVendor.Huawei -> huawei
        PushVendor.Oppo -> oppo
        PushVendor.Vivo -> vivo
        PushVendor.Fcm -> fcm
    }
}

/**
 * 抽 manufacturer 字符串读取，让单测注入 fake 不依赖 Robolectric / Build。
 */
interface ManufacturerProvider {
    fun manufacturer(): String

    object System : ManufacturerProvider {
        override fun manufacturer(): String = android.os.Build.MANUFACTURER ?: ""
    }
}
