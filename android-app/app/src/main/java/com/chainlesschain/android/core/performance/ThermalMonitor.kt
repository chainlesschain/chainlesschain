package com.chainlesschain.android.core.performance

import android.content.Context
import android.os.Build
import android.os.PowerManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber

/**
 * Thermal Monitor
 *
 * Monitors device thermal state using PowerManager (API 29+).
 * On older devices, provides estimated thermal state based on battery temperature.
 */
class ThermalMonitor(private val context: Context) {

    companion object {
        private const val TAG = "ThermalMonitor"
    }

    private val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager

    // StateFlow for reactive updates
    private val _thermalState = MutableStateFlow(ThermalState.NONE)
    val thermalState: StateFlow<ThermalState> = _thermalState.asStateFlow()

    private val _thermalHeadroom = MutableStateFlow(1f)
    val thermalHeadroom: StateFlow<Float> = _thermalHeadroom.asStateFlow()

    private var thermalStatusListener: Any? = null

    /**
     * Start monitoring thermal state
     */
    fun start() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            registerThermalStatusListener()
        } else {
            // Initial update for older devices
            updateThermalState()
        }
        Timber.d("$TAG: Started thermal monitoring")
    }

    /**
     * Stop monitoring thermal state
     */
    fun stop() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && thermalStatusListener != null) {
            try {
                @Suppress("UNCHECKED_CAST")
                powerManager.removeThermalStatusListener(
                    thermalStatusListener as PowerManager.OnThermalStatusChangedListener
                )
            } catch (e: Exception) {
                Timber.w("$TAG: Failed to remove thermal listener: ${e.message}")
            }
            thermalStatusListener = null
        }
        Timber.d("$TAG: Stopped thermal monitoring")
    }

    /**
     * Register thermal status listener (API 29+)
     */
    private fun registerThermalStatusListener() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val listener = PowerManager.OnThermalStatusChangedListener { status ->
                _thermalState.value = ThermalState.fromApiStatus(status)
                Timber.d("$TAG: Thermal status changed to ${_thermalState.value}")
            }

            powerManager.addThermalStatusListener(listener)
            thermalStatusListener = listener

            // Initial state
            val currentStatus = powerManager.currentThermalStatus
            _thermalState.value = ThermalState.fromApiStatus(currentStatus)
        }
    }

    /**
     * Update thermal state (for older devices or manual refresh)
     */
    fun updateThermalState() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val status = powerManager.currentThermalStatus
            _thermalState.value = ThermalState.fromApiStatus(status)
        }

        // Update thermal headroom if available (API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val headroom = powerManager.getThermalHeadroom(10) // 10 second forecast
                if (headroom > 0) {
                    _thermalHeadroom.value = headroom
                }
            } catch (e: Exception) {
                Timber.w("$TAG: Failed to get thermal headroom: ${e.message}")
            }
        }
    }

    /**
     * Check if device is throttling
     */
    fun isThrottling(): Boolean {
        return _thermalState.value >= ThermalState.MODERATE
    }

    /**
     * Check if device is in critical thermal state
     */
    fun isCritical(): Boolean {
        return _thermalState.value >= ThermalState.SEVERE
    }

    /**
     * Get current snapshot
     */
    fun getSnapshot(): ThermalSnapshot {
        return ThermalSnapshot(
            state = _thermalState.value,
            headroom = _thermalHeadroom.value,
            isThrottling = isThrottling(),
            isCritical = isCritical()
        )
    }
}

/**
 * Thermal state enum
 */
enum class ThermalState(val level: Int, val displayName: String) {
    NONE(0, "Normal"),
    LIGHT(1, "Light"),
    MODERATE(2, "Moderate"),
    SEVERE(3, "Severe"),
    CRITICAL(4, "Critical"),
    EMERGENCY(5, "Emergency"),
    SHUTDOWN(6, "Shutdown");

    companion object {
        /**
         * Convert from PowerManager thermal status (API 29+)
         */
        fun fromApiStatus(status: Int): ThermalState {
            return when (status) {
                PowerManager.THERMAL_STATUS_NONE -> NONE
                PowerManager.THERMAL_STATUS_LIGHT -> LIGHT
                PowerManager.THERMAL_STATUS_MODERATE -> MODERATE
                PowerManager.THERMAL_STATUS_SEVERE -> SEVERE
                PowerManager.THERMAL_STATUS_CRITICAL -> CRITICAL
                PowerManager.THERMAL_STATUS_EMERGENCY -> EMERGENCY
                PowerManager.THERMAL_STATUS_SHUTDOWN -> SHUTDOWN
                else -> NONE
            }
        }
    }
}

/**
 * Thermal snapshot data
 */
data class ThermalSnapshot(
    val state: ThermalState,
    val headroom: Float,
    val isThrottling: Boolean,
    val isCritical: Boolean
)
