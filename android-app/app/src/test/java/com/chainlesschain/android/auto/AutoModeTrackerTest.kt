package com.chainlesschain.android.auto

import org.junit.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * v1.2 #1 Android Auto Phase 2 — AutoModeTracker StateFlow 翻转测。
 */
class AutoModeTrackerTest {

    @Test
    fun `initial state is inactive`() {
        val tracker = AutoModeTracker()
        assertFalse(tracker.isAutoActive.value)
    }

    @Test
    fun `markActive flips to true`() {
        val tracker = AutoModeTracker()
        tracker.markActive()
        assertTrue(tracker.isAutoActive.value)
    }

    @Test
    fun `markInactive flips back to false`() {
        val tracker = AutoModeTracker()
        tracker.markActive()
        tracker.markInactive()
        assertFalse(tracker.isAutoActive.value)
    }

    @Test
    fun `markActive is idempotent`() {
        val tracker = AutoModeTracker()
        tracker.markActive()
        tracker.markActive()
        assertTrue(tracker.isAutoActive.value)
    }
}
