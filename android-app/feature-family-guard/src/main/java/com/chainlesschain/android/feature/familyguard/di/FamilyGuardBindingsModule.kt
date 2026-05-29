package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.repository.FamilyFriendRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.RevivalCodeRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.RolePreferencesRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.service.FamilyGuardServiceControllerImpl
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyFriendRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGuardServiceController
import com.chainlesschain.android.feature.familyguard.domain.repository.RevivalCodeRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
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

    @Binds
    @Singleton
    abstract fun bindRolePreferencesRepository(
        impl: RolePreferencesRepositoryImpl,
    ): RolePreferencesRepository

    @Binds
    @Singleton
    abstract fun bindFamilyGuardServiceController(
        impl: FamilyGuardServiceControllerImpl,
    ): FamilyGuardServiceController

    @Binds
    @Singleton
    abstract fun bindRevivalCodeRepository(
        impl: RevivalCodeRepositoryImpl,
    ): RevivalCodeRepository
}
