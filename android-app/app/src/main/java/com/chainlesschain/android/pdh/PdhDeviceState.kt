package com.chainlesschain.android.pdh

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §3.5.20 端侧资源预算的设备状态读取(device-bound 薄适配层)—— module 101 Phase 2。
 *
 * 把充电/电量/WiFi 现状读成 [PdhResourceBudget.Device] 喂给纯决策核。读不到/未知一律取
 * **保守默认**(未充电、非 WiFi)→ 重活倾向延后,绝不因读不到就乐观开跑(§13.4)。
 * 决策逻辑全在 [PdhResourceBudget](已单测);本类只做平台读取,device-bound 不入纯测。
 */
@Singleton
class PdhDeviceState @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun read(): PdhResourceBudget.Device = PdhResourceBudget.Device(
        charging = readCharging(),
        batteryPercent = readBatteryPercent(),
        onWifi = readOnWifi(),
    )

    private fun readCharging(): Boolean = try {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    } catch (_: Throwable) {
        false // conservative: assume not charging
    }

    private fun readBatteryPercent(): Int = try {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val pct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        if (pct in 0..100) pct else 100 // unknown → don't let battery be the blocker
    } catch (_: Throwable) {
        100
    }

    private fun readOnWifi(): Boolean = try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    } catch (_: Throwable) {
        false // conservative: assume not on wifi
    }
}
