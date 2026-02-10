package com.chainlesschain.android.core.performance

import android.os.Process
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.RandomAccessFile

/**
 * CPU Monitor
 *
 * Monitors CPU usage by reading /proc/stat and process stats.
 * Note: Some stats may be restricted on newer Android versions.
 */
class CPUMonitor {

    companion object {
        private const val TAG = "CPUMonitor"
    }

    // Previous CPU time measurements for delta calculation
    private var previousCpuTime: Long = 0
    private var previousAppCpuTime: Long = 0
    private var previousIdleTime: Long = 0

    // StateFlow for reactive updates
    private val _cpuUsage = MutableStateFlow(0f)
    val cpuUsage: StateFlow<Float> = _cpuUsage.asStateFlow()

    private val _appCpuUsage = MutableStateFlow(0f)
    val appCpuUsage: StateFlow<Float> = _appCpuUsage.asStateFlow()

    /**
     * Update CPU usage measurements
     */
    suspend fun update() = withContext(Dispatchers.IO) {
        try {
            // Read system CPU stats
            val systemStats = readSystemCpuStats()
            if (systemStats != null) {
                val (totalTime, idleTime) = systemStats

                if (previousCpuTime > 0) {
                    val totalDelta = totalTime - previousCpuTime
                    val idleDelta = idleTime - previousIdleTime

                    if (totalDelta > 0) {
                        val usage = 100f * (1f - idleDelta.toFloat() / totalDelta)
                        _cpuUsage.value = usage.coerceIn(0f, 100f)
                    }
                }

                previousCpuTime = totalTime
                previousIdleTime = idleTime
            }

            // Read app CPU stats
            val appStats = readAppCpuStats()
            if (appStats != null) {
                val appCpuTime = appStats

                if (previousAppCpuTime > 0 && previousCpuTime > 0) {
                    val totalDelta = previousCpuTime - (previousCpuTime - (previousCpuTime / 10)) // rough estimate
                    val appDelta = appCpuTime - previousAppCpuTime

                    if (totalDelta > 0) {
                        val usage = 100f * appDelta / totalDelta
                        _appCpuUsage.value = usage.coerceIn(0f, 100f)
                    }
                }

                previousAppCpuTime = appCpuTime
            }
        } catch (e: Exception) {
            Timber.w("$TAG: Failed to read CPU stats: ${e.message}")
        }
    }

    /**
     * Read system CPU stats from /proc/stat
     *
     * @return Pair of (total CPU time, idle time) or null if unavailable
     */
    private fun readSystemCpuStats(): Pair<Long, Long>? {
        return try {
            RandomAccessFile("/proc/stat", "r").use { reader ->
                val line = reader.readLine()
                if (line != null && line.startsWith("cpu ")) {
                    val parts = line.split("\\s+".toRegex())
                    if (parts.size >= 8) {
                        val user = parts[1].toLongOrNull() ?: 0
                        val nice = parts[2].toLongOrNull() ?: 0
                        val system = parts[3].toLongOrNull() ?: 0
                        val idle = parts[4].toLongOrNull() ?: 0
                        val iowait = parts[5].toLongOrNull() ?: 0
                        val irq = parts[6].toLongOrNull() ?: 0
                        val softirq = parts[7].toLongOrNull() ?: 0

                        val total = user + nice + system + idle + iowait + irq + softirq
                        return Pair(total, idle + iowait)
                    }
                }
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Read app CPU stats from /proc/[pid]/stat
     *
     * @return Total CPU time for this process or null if unavailable
     */
    private fun readAppCpuStats(): Long? {
        return try {
            val pid = Process.myPid()
            RandomAccessFile("/proc/$pid/stat", "r").use { reader ->
                val line = reader.readLine()
                if (line != null) {
                    val parts = line.split("\\s+".toRegex())
                    if (parts.size >= 17) {
                        val utime = parts[13].toLongOrNull() ?: 0
                        val stime = parts[14].toLongOrNull() ?: 0
                        val cutime = parts[15].toLongOrNull() ?: 0
                        val cstime = parts[16].toLongOrNull() ?: 0
                        return utime + stime + cutime + cstime
                    }
                }
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Get number of CPU cores
     */
    fun getCoreCount(): Int {
        return Runtime.getRuntime().availableProcessors()
    }

    /**
     * Get current snapshot
     */
    fun getSnapshot(): CPUSnapshot {
        return CPUSnapshot(
            systemCpuUsage = _cpuUsage.value,
            appCpuUsage = _appCpuUsage.value,
            coreCount = getCoreCount()
        )
    }

    /**
     * Reset measurements
     */
    fun reset() {
        previousCpuTime = 0
        previousAppCpuTime = 0
        previousIdleTime = 0
        _cpuUsage.value = 0f
        _appCpuUsage.value = 0f
    }
}

/**
 * CPU snapshot data
 */
data class CPUSnapshot(
    val systemCpuUsage: Float,
    val appCpuUsage: Float,
    val coreCount: Int
)
