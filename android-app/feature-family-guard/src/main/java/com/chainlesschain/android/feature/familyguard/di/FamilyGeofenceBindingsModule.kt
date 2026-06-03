package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.repository.GeofenceRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.LocationPointRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.repository.GeofenceRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.LocationPointRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt bindings for M8 Geofence (FAMILY-50+).
 *
 * 单开一个 module（不并入 FamilyGuardBindingsModule）以隔离 Epic F 围栏绑定，
 * 降低与其它 epic 并行开发的合并冲突面。后续 FAMILY-51/52/54 的 location/geofence
 * 引擎绑定也加这里。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class FamilyGeofenceBindingsModule {

    @Binds
    @Singleton
    abstract fun bindGeofenceRepository(
        impl: GeofenceRepositoryImpl,
    ): GeofenceRepository

    @Binds
    @Singleton
    abstract fun bindLocationPointRepository(
        impl: LocationPointRepositoryImpl,
    ): LocationPointRepository
}
