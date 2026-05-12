package com.chainlesschain.android.feature.project.di

import android.content.Context
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ProjectChatMessageDao
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.dao.TaskDao
import com.chainlesschain.android.core.p2p.sync.ProjectSyncApplier
import com.chainlesschain.android.feature.project.data.sync.ProjectSyncApplierImpl
import com.chainlesschain.android.feature.project.repository.ProjectChatRepository
import com.chainlesschain.android.feature.project.repository.ProjectRepository
import com.chainlesschain.android.feature.project.repository.TaskRepository
import com.chainlesschain.android.feature.project.util.ProjectFileStorage
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object ProjectModule {

    @Provides
    @Singleton
    fun provideProjectDao(database: ChainlessChainDatabase): ProjectDao {
        return database.projectDao()
    }

    @Provides
    @Singleton
    fun provideProjectFileStorage(
        @ApplicationContext context: Context
    ): ProjectFileStorage {
        return ProjectFileStorage(context)
    }

    @Provides
    @Singleton
    fun provideProjectChatMessageDao(database: ChainlessChainDatabase): ProjectChatMessageDao {
        return database.projectChatMessageDao()
    }

    @Provides
    @Singleton
    fun provideProjectRepository(projectDao: ProjectDao, @ApplicationContext context: Context): ProjectRepository {
        return ProjectRepository(projectDao, context)
    }

    @Provides
    @Singleton
    fun provideProjectChatRepository(
        projectChatMessageDao: ProjectChatMessageDao,
        projectDao: ProjectDao
    ): ProjectChatRepository {
        return ProjectChatRepository(projectChatMessageDao, projectDao)
    }

    @Provides
    @Singleton
    fun provideTaskDao(database: ChainlessChainDatabase): TaskDao {
        return database.taskDao()
    }

    @Provides
    @Singleton
    fun provideTaskRepository(taskDao: TaskDao): TaskRepository {
        return TaskRepository(taskDao)
    }
}

/**
 * v1.2：把 ProjectSyncApplierImpl 绑到 core-p2p 定义的接口上。同 KnowledgeSyncModule
 * 模式，单独 abstract class 因为 object module 不能用 @Binds。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class ProjectSyncModule {
    @Binds
    @Singleton
    abstract fun bindProjectSyncApplier(
        impl: ProjectSyncApplierImpl,
    ): ProjectSyncApplier
}
