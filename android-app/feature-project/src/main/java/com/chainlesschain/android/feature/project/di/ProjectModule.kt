package com.chainlesschain.android.feature.project.di

import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.feature.project.repository.ProjectRepository
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
    fun provideProjectRepository(projectDao: ProjectDao): ProjectRepository {
        return ProjectRepository(projectDao)
    }
}
