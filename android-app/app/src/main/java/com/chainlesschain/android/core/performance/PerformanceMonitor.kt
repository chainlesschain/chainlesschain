package com.chainlesschain.android.core.performance

import android.content.Context
import android.os.Build
import android.os.StrictMode
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Performance Monitor
 *
 * Comprehensive performance monitoring system for the application.
 * Integrates FPS, CPU, battery, and thermal monitoring.
 *
 * Features:
 * 1. StrictMode detection - Development mode thread/VM violation detection
 * 2. Startup time tracking
 * 3. Memory monitoring
 * 4. FPS monitoring via Choreographer
 * 5. CPU usage monitoring
 * 6. Battery status monitoring
 * 7. Thermal state monitoring (API 29+)
 *
 * Aligns with iOS implementation patterns.
 */
object PerformanceMonitor {

    private const val TAG = "PerformanceMonitor"
    private const val UPDATE_INTERVAL_MS = 1000L

    // Sub-monitors (initialized lazily)
    @Volatile private var fpsMonitor: FPSMonitor? = null
    @Volatile private var cpuMonitor: CPUMonitor? = null
    @Volatile private var batteryMonitor: BatteryMonitor? = null
    @Volatile private var thermalMonitor: ThermalMonitor? = null

    // Monitoring state
    private val _isMonitoring = MutableStateFlow(false)
    val isMonitoring: StateFlow<Boolean> = _isMonitoring.asStateFlow()

    // Aggregated metrics
    private val _metrics = MutableStateFlow(PerformanceMetrics())
    val metrics: StateFlow<PerformanceMetrics> = _metrics.asStateFlow()

    // Coroutine scope for periodic updates
    @Volatile private var monitoringJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Context reference
    @Volatile private var appContext: Context? = null

    /**
     * Initialize performance monitoring
     * Only enables StrictMode in debug builds
     */
    fun init(context: Context, isDebug: Boolean) {
        appContext = context.applicationContext

        if (isDebug) {
            enableStrictMode()
        }

        Timber.d("$TAG: Initialized (debug=$isDebug)")
    }

    /**
     * Start comprehensive monitoring
     */
    fun startMonitoring(context: Context? = null) {
        val ctx = context?.applicationContext ?: appContext
        if (ctx == null) {
            Timber.w("$TAG: Cannot start monitoring without context")
            return
        }

        if (_isMonitoring.value) {
            Timber.d("$TAG: Already monitoring")
            return
        }

        appContext = ctx

        // Initialize sub-monitors
        fpsMonitor = FPSMonitor().also { it.start() }
        cpuMonitor = CPUMonitor()
        batteryMonitor = BatteryMonitor(ctx).also { it.start() }
        thermalMonitor = ThermalMonitor(ctx).also { it.start() }

        // Start periodic update loop
        monitoringJob = scope.launch {
            while (isActive) {
                updateMetrics()
                delay(UPDATE_INTERVAL_MS)
            }
        }

        _isMonitoring.value = true
        Timber.d("$TAG: Started monitoring")
    }

    /**
     * Stop monitoring
     */
    fun stopMonitoring() {
        if (!_isMonitoring.value) return

        monitoringJob?.cancel()
        monitoringJob = null

        fpsMonitor?.stop()
        fpsMonitor = null

        cpuMonitor = null

        batteryMonitor?.stop()
        batteryMonitor = null

        thermalMonitor?.stop()
        thermalMonitor = null

        appContext = null

        _isMonitoring.value = false
        Timber.d("$TAG: Stopped monitoring")
    }

    /**
     * Update aggregated metrics
     */
    private suspend fun updateMetrics() {
        try {
            // Update CPU stats
            cpuMonitor?.update()

            // Get current values from sub-monitors
            val fpsSnapshot = fpsMonitor?.getSnapshot()
            val cpuSnapshot = cpuMonitor?.getSnapshot()
            val batterySnapshot = batteryMonitor?.getSnapshot()
            val thermalSnapshot = thermalMonitor?.getSnapshot()

            // Get memory stats
            val runtime = Runtime.getRuntime()
            val usedMemory = (runtime.totalMemory() - runtime.freeMemory()) / (1024f * 1024f)
            val maxMemory = runtime.maxMemory() / (1024f * 1024f)

            _metrics.value = PerformanceMetrics(
                fps = fpsSnapshot?.fps ?: 0f,
                frameTimeMs = fpsSnapshot?.frameTimeMs ?: 0f,
                droppedFrames = fpsSnapshot?.droppedFrames ?: 0,
                cpuUsage = cpuSnapshot?.systemCpuUsage ?: 0f,
                memoryUsageMB = usedMemory,
                maxMemoryMB = maxMemory,
                batteryLevel = batterySnapshot?.level ?: 100,
                isCharging = batterySnapshot?.isCharging ?: false,
                thermalState = thermalSnapshot?.state?.level ?: 0
            )
        } catch (e: Exception) {
            Timber.e("$TAG: Error updating metrics: ${e.message}")
        }
    }

    /**
     * Enable StrictMode for debug builds
     */
    private fun enableStrictMode() {
        StrictMode.setThreadPolicy(
            StrictMode.ThreadPolicy.Builder()
                .detectAll()
                .penaltyLog()
                .build()
        )

        StrictMode.setVmPolicy(
            StrictMode.VmPolicy.Builder()
                .detectAll()
                .penaltyLog()
                .build()
        )

        Timber.d("$TAG: StrictMode enabled")
    }

    /**
     * Startup timer for tracking app launch time
     */
    class StartupTimer {
        private val startTime = System.currentTimeMillis()
        private val milestones = mutableListOf<Pair<String, Long>>()

        fun logMilestone(milestone: String) {
            val elapsed = System.currentTimeMillis() - startTime
            milestones.add(milestone to elapsed)
            Timber.d("$TAG: Startup milestone: $milestone at ${elapsed}ms")
        }

        fun finish(): Long {
            val totalTime = System.currentTimeMillis() - startTime
            Timber.i("$TAG: App startup completed in ${totalTime}ms")
            milestones.forEach { (name, time) ->
                Timber.d("$TAG:   - $name: ${time}ms")
            }
            return totalTime
        }

        fun getMilestones(): List<Pair<String, Long>> = milestones.toList()
    }

    /**
     * Log current memory usage
     */
    fun logMemoryUsage(tag: String = "Memory") {
        val runtime = Runtime.getRuntime()
        val usedMemory = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val maxMemory = runtime.maxMemory() / 1024 / 1024
        val availableMemory = maxMemory - usedMemory

        Timber.d("$tag - Used: ${usedMemory}MB, Available: ${availableMemory}MB, Max: ${maxMemory}MB")
    }

    /**
     * Get current FPS
     */
    fun getCurrentFps(): Float = fpsMonitor?.currentFps?.value ?: 0f

    /**
     * Get current CPU usage
     */
    fun getCurrentCpuUsage(): Float = cpuMonitor?.cpuUsage?.value ?: 0f

    /**
     * Get battery level
     */
    fun getBatteryLevel(): Int = batteryMonitor?.batteryLevel?.value ?: 100

    /**
     * Check if device is throttling due to thermal
     */
    fun isThrottling(): Boolean = thermalMonitor?.isThrottling() ?: false

    /**
     * Get current performance snapshot
     */
    fun getSnapshot(): PerformanceSnapshot {
        return PerformanceSnapshot(
            metrics = _metrics.value,
            fpsSnapshot = fpsMonitor?.getSnapshot(),
            cpuSnapshot = cpuMonitor?.getSnapshot(),
            batterySnapshot = batteryMonitor?.getSnapshot(),
            thermalSnapshot = thermalMonitor?.getSnapshot()
        )
    }
}

/**
 * Complete performance snapshot
 */
data class PerformanceSnapshot(
    val metrics: PerformanceMetrics,
    val fpsSnapshot: FPSSnapshot?,
    val cpuSnapshot: CPUSnapshot?,
    val batterySnapshot: BatterySnapshot?,
    val thermalSnapshot: ThermalSnapshot?
)

// ===== Utility Extensions =====

/**
 * Debounce function - limits execution rate
 */
fun <T> debounce(
    delayMs: Long,
    scope: CoroutineScope,
    action: (T) -> Unit
): (T) -> Unit {
    var job: Job? = null
    return { value: T ->
        job?.cancel()
        job = scope.launch {
            delay(delayMs)
            action(value)
        }
    }
}

/**
 * Throttle function - ensures minimum interval between executions
 */
fun <T> throttle(
    intervalMs: Long,
    scope: CoroutineScope,
    action: (T) -> Unit
): (T) -> Unit {
    val lastExecutionTime = AtomicLong(0L)
    return { value: T ->
        val currentTime = System.currentTimeMillis()
        val lastTime = lastExecutionTime.get()
        if (currentTime - lastTime >= intervalMs &&
            lastExecutionTime.compareAndSet(lastTime, currentTime)
        ) {
            scope.launch { action(value) }
        }
    }
}
