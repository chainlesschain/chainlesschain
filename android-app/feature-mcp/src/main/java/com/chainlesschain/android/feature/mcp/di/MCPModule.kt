package com.chainlesschain.android.feature.mcp.di

import com.chainlesschain.android.feature.mcp.data.client.MCPClientManager
import com.chainlesschain.android.feature.mcp.data.repository.MCPRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for MCP feature
 */
@Module
@InstallIn(SingletonComponent::class)
object MCPModule {

    @Provides
    @Singleton
    fun provideMCPRepository(): MCPRepository {
        return MCPRepository()
    }

    @Provides
    @Singleton
    fun provideMCPClientManager(
        repository: MCPRepository
    ): MCPClientManager {
        return MCPClientManager(repository)
    }
}
