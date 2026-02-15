package com.chainlesschain.android.core.performance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber

/**
 * Battery Monitor
 *
 * Monitors battery status, level, and charging state.
 */
class BatteryMonitor(private val context: Context) {

    companion object {
        private const val TAG = "BatteryMonitor"
    }

    private val batteryManager: BatteryManager =
        context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            ?: throw IllegalStateException("BatteryManager system service unavailable")

    // StateFlow for reactive updates
    private val _batteryLevel = MutableStateFlow(100)
    val batteryLevel: StateFlow<Int> = _batteryLevel.asStateFlow()

    private val _isCharging = MutableStateFlow(false)
    val isCharging: StateFlow<Boolean> = _isCharging.asStateFlow()

    private val _chargingType = MutableStateFlow(ChargingType.NONE)
    val chargingType: StateFlow<ChargingType> = _chargingType.asStateFlow()

    private val _batteryHealth = MutableStateFlow(BatteryHealth.GOOD)
    val batteryHealth: StateFlow<BatteryHealth> = _batteryHealth.asStateFlow()

    private var batteryReceiver: BroadcastReceiver? = null

    /**
     * Start monitoring battery status
     */
    fun start() {
        if (batteryReceiver != null) return

        batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                updateFromIntent(intent)
            }
        }

        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val intent = context.registerReceiver(batteryReceiver, filter)

        // Initial update
        intent?.let { updateFromIntent(it) }

        Timber.d("$TAG: Started battery monitoring")
    }

    /**
     * Stop monitoring battery status
     */
    fun stop() {
        batteryReceiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (e: Exception) {
                Timber.w("$TAG: Failed to unregister receiver: ${e.message}")
            }
            batteryReceiver = null
        }
        Timber.d("$TAG: Stopped battery monitoring")
    }

    /**
     * Update state from battery intent
     */
    private fun updateFromIntent(intent: Intent) {
        // Battery level
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level >= 0 && scale > 0) {
            _batteryLevel.value = (level * 100 / scale)
        }

        // Charging status
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        _isCharging.value = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL

        // Charging type
        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
        _chargingType.value = when (plugged) {
            BatteryManager.BATTERY_PLUGGED_AC -> ChargingType.AC
            BatteryManager.BATTERY_PLUGGED_USB -> ChargingType.USB
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> ChargingType.WIRELESS
            else -> ChargingType.NONE
        }

        // Battery health
        val health = intent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)
        _batteryHealth.value = when (health) {
            BatteryManager.BATTERY_HEALTH_GOOD -> BatteryHealth.GOOD
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> BatteryHealth.OVERHEAT
            BatteryManager.BATTERY_HEALTH_DEAD -> BatteryHealth.DEAD
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> BatteryHealth.OVER_VOLTAGE
            BatteryManager.BATTERY_HEALTH_COLD -> BatteryHealth.COLD
            else -> BatteryHealth.UNKNOWN
        }
    }

    /**
     * Get remaining battery percentage
     */
    fun getBatteryPercentage(): Int {
        return batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    /**
     * Check if device is in power save mode
     */
    fun isPowerSaveMode(): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        return powerManager.isPowerSaveMode
    }

    /**
     * Get current snapshot
     */
    fun getSnapshot(): BatterySnapshot {
        return BatterySnapshot(
            level = _batteryLevel.value,
            isCharging = _isCharging.value,
            chargingType = _chargingType.value,
            health = _batteryHealth.value,
            isPowerSaveMode = isPowerSaveMode()
        )
    }
}

/**
 * Charging type enum
 */
enum class ChargingType(val displayName: String) {
    NONE("Not Charging"),
    AC("AC Charger"),
    USB("USB"),
    WIRELESS("Wireless")
}

/**
 * Battery health enum
 */
enum class BatteryHealth(val displayName: String) {
    GOOD("Good"),
    OVERHEAT("Overheating"),
    DEAD("Dead"),
    OVER_VOLTAGE("Over Voltage"),
    COLD("Cold"),
    UNKNOWN("Unknown")
}

/**
 * Battery snapshot data
 */
data class BatterySnapshot(
    val level: Int,
    val isCharging: Boolean,
    val chargingType: ChargingType,
    val health: BatteryHealth,
    val isPowerSaveMode: Boolean
)
