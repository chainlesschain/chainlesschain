package com.chainlesschain.android.capture.location

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * 测试用 LocationProvider。控制 [permissionState] 与推流（通过 [emit]）。
 */
class FakeLocationProvider(
    initialPermissionState: LocationProvider.PermissionState =
        LocationProvider.PermissionState.Granted,
    private val cached: LocationTag? = null,
) : LocationProvider {

    override var permissionState: LocationProvider.PermissionState = initialPermissionState

    private val flow = MutableSharedFlow<LocationTag>(
        replay = 0,
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    override fun updates(minIntervalMs: Long): Flow<LocationTag> = flow.asSharedFlow()

    override suspend fun lastKnown(timeoutMs: Long): LocationTag? = cached

    fun emit(tag: LocationTag) {
        flow.tryEmit(tag)
    }
}
