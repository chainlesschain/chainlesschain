package com.chainlesschain.android.di

import com.chainlesschain.android.config.AppConfigManager
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * Application-level entry point for accessing singleton dependencies.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface AppEntryPoint {
    fun didManager(): com.chainlesschain.android.core.did.manager.DIDManager
    fun appConfigManager(): AppConfigManager
    fun knowledgeRepository(): KnowledgeRepository
    fun database(): ChainlessChainDatabase

    /**
     * Phase 3d v1.3 — LAN auto-discovery for desktop signaling server via mDNS / NsdManager.
     */
    fun signalingNsdAutoDiscovery(): com.chainlesschain.android.core.p2p.discovery.SignalingNsdAutoDiscovery
}

