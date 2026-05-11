package com.chainlesschain.android.capture.location

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LocationTaggerTest {

    private fun newTag(lat: Double = 39.9042, lon: Double = 116.4074, ts: Long = 1700000000000L) =
        LocationTag(lat, lon, 5f, ts)

    @Test
    fun `start with granted permission enters Running`() = runTest {
        val provider = FakeLocationProvider(LocationProvider.PermissionState.Granted)
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))

        val state = tagger.start()

        assertEquals(LocationTagger.State.Running, state)
        assertEquals(LocationTagger.State.Running, tagger.state.value)
    }

    @Test
    fun `start with denied permission enters PermissionRequired`() = runTest {
        val provider = FakeLocationProvider(LocationProvider.PermissionState.Denied)
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))

        val state = tagger.start()

        assertEquals(LocationTagger.State.PermissionRequired, state)
        assertNull(tagger.lastTag.value)
    }

    @Test
    fun `start with hardware unavailable enters HardwareUnavailable`() = runTest {
        val provider = FakeLocationProvider(LocationProvider.PermissionState.HardwareUnavailable)
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))

        val state = tagger.start()

        assertEquals(LocationTagger.State.HardwareUnavailable, state)
    }

    @Test
    fun `emitted location updates lastTag`() = runTest {
        val provider = FakeLocationProvider(LocationProvider.PermissionState.Granted)
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))
        tagger.start()
        // 让 collect launch 真正 subscribe 后再 emit（SharedFlow replay=0 不会回放）
        testScheduler.advanceUntilIdle()
        val tag = newTag()

        provider.emit(tag)
        testScheduler.advanceUntilIdle()

        assertEquals(tag, tagger.lastTag.value)
    }

    @Test
    fun `stop transitions out of Running and stops collecting`() = runTest {
        val provider = FakeLocationProvider(LocationProvider.PermissionState.Granted)
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))
        tagger.start()
        testScheduler.advanceUntilIdle() // ensure collector is subscribed
        provider.emit(newTag(lat = 1.0))
        testScheduler.advanceUntilIdle()

        tagger.stop()
        testScheduler.advanceUntilIdle()
        // emit after stop should NOT update lastTag (collect job cancelled)
        provider.emit(newTag(lat = 2.0))
        testScheduler.advanceUntilIdle()

        assertEquals(LocationTagger.State.Idle, tagger.state.value)
        assertEquals(1.0, tagger.lastTag.value!!.latitude, 1e-9)
    }

    @Test
    fun `fetchOnce returns provider's lastKnown`() = runTest {
        val cached = newTag()
        val provider = FakeLocationProvider(
            initialPermissionState = LocationProvider.PermissionState.Granted,
            cached = cached,
        )
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))

        val result = tagger.fetchOnce()

        assertNotNull(result)
        assertEquals(cached, result)
        // Side effect: lastTag flow also updated
        assertEquals(cached, tagger.lastTag.value)
    }

    @Test
    fun `fetchOnce returns null when permission denied`() = runTest {
        val provider = FakeLocationProvider(
            initialPermissionState = LocationProvider.PermissionState.Denied,
            cached = newTag(),
        )
        val tagger = LocationTagger(provider, TestScope(StandardTestDispatcher(testScheduler)))

        val result = tagger.fetchOnce()

        assertNull(result)
    }
}
