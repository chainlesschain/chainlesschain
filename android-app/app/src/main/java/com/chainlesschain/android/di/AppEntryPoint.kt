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

    /**
     * 实时事件管理器（启动时需注入 SelfProfileProvider 让 PROFILE_QUERY 能被响应）
     */
    fun realtimeEventManager(): com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager

    /**
     * 默认自身资料提供者（DID 占位昵称版；待 SelfProfileStore 上线后替换）
     */
    fun defaultSelfProfileProvider(): com.chainlesschain.android.feature.p2p.repository.social.DefaultSelfProfileProvider

    /**
     * A3.2 — Kotlin-hosted Ollama-compat HTTP server on 127.0.0.1:<port>.
     * Started in [ChainlessChainApplication.delayedInit].
     */
    fun localLlmServer(): com.chainlesschain.android.pdh.llm.LocalLlmServer

    /**
     * Module 101 Phase 0 — PDH bridge: device-capability MCP server on
     * 127.0.0.1:<port> the in-APK cc agent discovers + connects to (lockfile +
     * CHAINLESSCHAIN_PDH_PORT). Started in [ChainlessChainApplication.delayedInit].
     */
    fun pdhBridgeServer(): com.chainlesschain.android.pdh.bridge.PdhBridgeServer
}

