package com.chainlesschain.android.feature.enterprise.di

import com.chainlesschain.android.feature.enterprise.data.engine.AuditLogger
import com.chainlesschain.android.feature.enterprise.data.engine.PermissionCache
import com.chainlesschain.android.feature.enterprise.data.engine.PermissionEngine
import com.chainlesschain.android.feature.enterprise.data.manager.RBACManager
import com.chainlesschain.android.feature.enterprise.data.manager.TeamManager
import com.chainlesschain.android.feature.enterprise.data.repository.RBACRepository
import com.chainlesschain.android.feature.enterprise.data.repository.TeamRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for enterprise feature dependencies
 */
@Module
@InstallIn(SingletonComponent::class)
object EnterpriseModule {

    @Provides
    @Singleton
    fun providePermissionCache(): PermissionCache {
        return PermissionCache()
    }

    @Provides
    @Singleton
    fun provideAuditLogger(): AuditLogger {
        return AuditLogger()
    }

    @Provides
    @Singleton
    fun providePermissionEngine(
        permissionCache: PermissionCache,
        auditLogger: AuditLogger
    ): PermissionEngine {
        return PermissionEngine(permissionCache, auditLogger)
    }

    @Provides
    @Singleton
    fun provideRBACRepository(): RBACRepository {
        return RBACRepository()
    }

    @Provides
    @Singleton
    fun provideTeamRepository(): TeamRepository {
        return TeamRepository()
    }

    @Provides
    @Singleton
    fun provideRBACManager(
        rbacRepository: RBACRepository,
        teamRepository: TeamRepository,
        permissionEngine: PermissionEngine,
        auditLogger: AuditLogger
    ): RBACManager {
        return RBACManager(rbacRepository, teamRepository, permissionEngine, auditLogger)
    }

    @Provides
    @Singleton
    fun provideTeamManager(
        teamRepository: TeamRepository,
        permissionEngine: PermissionEngine,
        auditLogger: AuditLogger
    ): TeamManager {
        return TeamManager(teamRepository, permissionEngine, auditLogger)
    }
}
