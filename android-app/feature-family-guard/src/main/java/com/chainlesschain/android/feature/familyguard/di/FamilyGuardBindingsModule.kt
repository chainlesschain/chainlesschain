package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.repository.FamilyFriendRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyFriendRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt interface-to-impl bindings for :feature-family-guard (FAMILY-03+).
 *
 * Separated from [FamilyGuardModule] because @Binds requires an abstract class,
 * while @Provides for the database lives in an `object`. Future repositories
 * (FamilyGroupRepository in FAMILY-10, FamilyPermissionChecker in FAMILY-14)
 * 也加到这里。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class FamilyGuardBindingsModule {

    @Binds
    @Singleton
    abstract fun bindFamilyFriendRepository(
        impl: FamilyFriendRepositoryImpl,
    ): FamilyFriendRepository
}
