package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.permission.FamilyPermissionCheckerImpl
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyFriendRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyGroupRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyMembershipRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyRelationshipRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.RevivalCodeRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.repository.RolePreferencesRepositoryImpl
import com.chainlesschain.android.feature.familyguard.data.service.FamilyGuardServiceControllerImpl
import com.chainlesschain.android.feature.familyguard.data.service.InvitePairingServiceImpl
import com.chainlesschain.android.feature.familyguard.data.signer.DidManagerInviteSigner
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyFriendRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGuardServiceController
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyMembershipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.RevivalCodeRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.RolePreferencesRepository
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService
import com.chainlesschain.android.feature.familyguard.domain.signer.InviteSigner
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

    @Binds
    @Singleton
    abstract fun bindFamilyGroupRepository(
        impl: FamilyGroupRepositoryImpl,
    ): FamilyGroupRepository

    @Binds
    @Singleton
    abstract fun bindFamilyMembershipRepository(
        impl: FamilyMembershipRepositoryImpl,
    ): FamilyMembershipRepository

    @Binds
    @Singleton
    abstract fun bindFamilyRelationshipRepository(
        impl: FamilyRelationshipRepositoryImpl,
    ): FamilyRelationshipRepository

    @Binds
    @Singleton
    abstract fun bindInviteSigner(impl: DidManagerInviteSigner): InviteSigner

    @Binds
    @Singleton
    abstract fun bindInvitePairingService(
        impl: InvitePairingServiceImpl,
    ): InvitePairingService

    @Binds
    @Singleton
    abstract fun bindFamilyPermissionChecker(
        impl: FamilyPermissionCheckerImpl,
    ): FamilyPermissionChecker
}
