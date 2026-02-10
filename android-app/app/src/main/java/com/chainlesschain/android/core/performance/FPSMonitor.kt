package com.chainlesschain.android.core.performance

import android.view.Choreographer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * FPS Monitor
 *
 * Monitors frame rate using Choreographer.
 * Provides real-time FPS measurements and dropped frame detection.
 */
class FPSMonitor : Choreographer.FrameCallback {

    companion object {
        private const val TAG = "FPSMonitor"
        private const val NANOS_PER_SECOND = 1_000_000_000L
        private const val NANOS_PER_MS = 1_000_000L
        private const val TARGET_FPS = 60
        private const val TARGET_FRAME_TIME_NS = NANOS_PER_SECOND / TARGET_FPS
        private const val SAMPLE_WINDOW_SIZE = 60 // 1 second at 60fps
    }

    private val choreographer = Choreographer.getInstance()
    private val isRunning = AtomicBoolean(false)

    // Frame timing
    private val lastFrameTimeNanos = AtomicLong(0)
    private val frameTimes = mutableListOf<Long>()
    private val droppedFrameCount = AtomicLong(0)

    // StateFlow for reactive updates
    private val _currentFps = MutableStateFlow(0f)
    val currentFps: StateFlow<Float> = _currentFps.asStateFlow()

    private val _frameTimeMs = MutableStateFlow(0f)
    val frameTimeMs: StateFlow<Float> = _frameTimeMs.asStateFlow()

    private val _droppedFrames = MutableStateFlow(0)
    val droppedFrames: StateFlow<Int> = _droppedFrames.asStateFlow()

    /**
     * Start monitoring FPS
     */
    fun start() {
        if (isRunning.compareAndSet(false, true)) {
            lastFrameTimeNanos.set(System.nanoTime())
            choreographer.postFrameCallback(this)
            Timber.d("$TAG: Started FPS monitoring")
        }
    }

    /**
     * Stop monitoring FPS
     */
    fun stop() {
        if (isRunning.compareAndSet(true, false)) {
            choreographer.removeFrameCallback(this)
            Timber.d("$TAG: Stopped FPS monitoring")
        }
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!isRunning.get()) return

        val lastTime = lastFrameTimeNanos.getAndSet(frameTimeNanos)
        if (lastTime > 0) {
            val frameTime = frameTimeNanos - lastTime

            // Track frame times
            synchronized(frameTimes) {
                frameTimes.add(frameTime)
                if (frameTimes.size > SAMPLE_WINDOW_SIZE) {
                    frameTimes.removeAt(0)
                }

                // Calculate FPS
                if (frameTimes.size >= 10) {
                    val avgFrameTime = frameTimes.average()
                    val fps = NANOS_PER_SECOND.toFloat() / avgFrameTime.toFloat()
                    _currentFps.value = fps.coerceIn(0f, 120f)
                    _frameTimeMs.value = (avgFrameTime / NANOS_PER_MS).toFloat()
                }
            }

            // Detect dropped frames (frame took longer than 2x target)
            if (frameTime > TARGET_FRAME_TIME_NS * 2) {
                val dropped = ((frameTime / TARGET_FRAME_TIME_NS) - 1).toInt().coerceAtLeast(1)
                droppedFrameCount.addAndGet(dropped.toLong())
                _droppedFrames.value = droppedFrameCount.get().toInt()

                Timber.w("$TAG: Dropped $dropped frames (frame time: ${frameTime / NANOS_PER_MS}ms)")
            }
        }

        // Schedule next frame
        if (isRunning.get()) {
            choreographer.postFrameCallback(this)
        }
    }

    /**
     * Reset statistics
     */
    fun reset() {
        synchronized(frameTimes) {
            frameTimes.clear()
        }
        droppedFrameCount.set(0)
        _currentFps.value = 0f
        _frameTimeMs.value = 0f
        _droppedFrames.value = 0
    }

    /**
     * Get current FPS snapshot
     */
    fun getSnapshot(): FPSSnapshot {
        return FPSSnapshot(
            fps = _currentFps.value,
            frameTimeMs = _frameTimeMs.value,
            droppedFrames = _droppedFrames.value,
            isMonitoring = isRunning.get()
        )
    }
}

/**
 * FPS snapshot data
 */
data class FPSSnapshot(
    val fps: Float,
    val frameTimeMs: Float,
    val droppedFrames: Int,
    val isMonitoring: Boolean
)
