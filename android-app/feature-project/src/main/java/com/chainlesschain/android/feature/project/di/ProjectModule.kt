package com.chainlesschain.android.feature.project.di

import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ProjectChatMessageDao
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.dao.TaskDao
import com.chainlesschain.android.feature.project.repository.ProjectChatRepository
import com.chainlesschain.android.feature.project.repository.ProjectRepository
import com.chainlesschain.android.feature.project.repository.TaskRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
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
    fun provideProjectChatMessageDao(database: ChainlessChainDatabase): ProjectChatMessageDao {
        return database.projectChatMessageDao()
    }

    @Provides
    @Singleton
    fun provideProjectRepository(projectDao: ProjectDao): ProjectRepository {
        return ProjectRepository(projectDao)
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
