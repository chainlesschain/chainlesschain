package com.chainlesschain.android.capture.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Play Services FusedLocationProviderClient 包装。
 *
 * 设计文档 §5.3 M3 D-loc + Android_重新定位_设计文档.md：「LocationTagger 部分 M3 D-loc
 * `be6cb4974`（JVM-testable parts 已落）；剩 `ACCESS_FINE_LOCATION` 权限 + GPS provider 接线
 * + 笔记元数据写入」。本类落地 GPS provider 接线 — JVM 单测仍用 FakeLocationProvider。
 *
 * 权限：[permissionState] 在调用 [updates] / [lastKnown] 前已 fail-fast 检查；
 *      Foreground Service 类型 location 见 AndroidManifest.xml。
 *
 * 精度策略：默认 [Priority.PRIORITY_BALANCED_POWER_ACCURACY]（~100m，省电），需要更准
 *          可在调用方传 minIntervalMs < 60s 或后续加 priority 参数 overload。
 */
@Singleton
class AndroidFusedLocationProvider @Inject constructor(
    @ApplicationContext private val context: Context,
) : LocationProvider {

    private val client: FusedLocationProviderClient by lazy {
        LocationServices.getFusedLocationProviderClient(context)
    }

    override val permissionState: LocationProvider.PermissionState
        get() {
            val fine = ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            val coarse = ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            if (!fine && !coarse) return LocationProvider.PermissionState.Denied

            val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            val hardwareOk = locationManager?.let {
                it.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                    it.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            } ?: false
            return if (hardwareOk) LocationProvider.PermissionState.Granted
            else LocationProvider.PermissionState.HardwareUnavailable
        }

    override fun updates(minIntervalMs: Long): Flow<LocationTag> = callbackFlow {
        if (permissionState != LocationProvider.PermissionState.Granted) {
            Timber.w("AndroidFusedLocationProvider.updates: permission=$permissionState — closing")
            close()
            return@callbackFlow
        }

        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, minIntervalMs)
            .setMinUpdateIntervalMillis(minIntervalMs / 2)
            .build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { loc ->
                    runCatching {
                        trySend(
                            LocationTag(
                                latitude = loc.latitude,
                                longitude = loc.longitude,
                                accuracyMeters = if (loc.hasAccuracy()) loc.accuracy else 0f,
                                timestampMs = loc.time.takeIf { it > 0 } ?: System.currentTimeMillis(),
                                altitude = if (loc.hasAltitude()) loc.altitude else null,
                                provider = loc.provider ?: "fused",
                            )
                        )
                    }.onFailure { e ->
                        Timber.w(e, "AndroidFusedLocationProvider: invalid LocationTag inputs")
                    }
                }
            }
        }

        // SecurityException 已被 permissionState gate；仍用 runCatching 兜防御
        runCatching {
            client.requestLocationUpdates(request, callback, context.mainLooper)
        }.onFailure { e ->
            Timber.e(e, "AndroidFusedLocationProvider.updates: requestLocationUpdates failed")
            close(e)
        }

        awaitClose {
            client.removeLocationUpdates(callback)
        }
    }

    override suspend fun lastKnown(timeoutMs: Long): LocationTag? {
        if (permissionState != LocationProvider.PermissionState.Granted) return null
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<LocationTag?> { cont ->
                runCatching {
                    client.lastLocation
                        .addOnSuccessListener { loc ->
                            if (!cont.isActive) return@addOnSuccessListener
                            val tag = loc?.let {
                                runCatching {
                                    LocationTag(
                                        latitude = it.latitude,
                                        longitude = it.longitude,
                                        accuracyMeters = if (it.hasAccuracy()) it.accuracy else 0f,
                                        timestampMs = it.time.takeIf { t -> t > 0 } ?: System.currentTimeMillis(),
                                        altitude = if (it.hasAltitude()) it.altitude else null,
                                        provider = it.provider ?: "fused",
                                    )
                                }.getOrNull()
                            }
                            cont.resume(tag)
                        }
                        .addOnFailureListener { e ->
                            Timber.w(e, "AndroidFusedLocationProvider.lastKnown: failure")
                            if (cont.isActive) cont.resume(null)
                        }
                }.onFailure { e ->
                    Timber.e(e, "AndroidFusedLocationProvider.lastKnown: threw")
                    if (cont.isActive) cont.resume(null)
                }
            }
        }
    }
}
