package com.chainlesschain.android.remote.p2p

import javax.inject.Inject
import javax.inject.Singleton

/**
 * DID Manager Interface
 *
 * Defines operations for DID (Decentralized Identifier) management
 */
interface DIDManager {
    suspend fun getCurrentDID(): String
    suspend fun sign(data: String): String
}

/**
 * DID Manager Stub Implementation
 *
 * Temporary stub to allow compilation without feature-p2p module.
 * This class provides minimal functionality for remote control features.
 */
@Singleton
class DIDManagerImpl @Inject constructor() : DIDManager {

    /**
     * Returns a stub DID string
     * Real implementation should retrieve actual DID from core-did module
     */
    override suspend fun getCurrentDID(): String {
        return "did:stub:temporary"
    }

    /**
     * Returns a stub signature
     * Real implementation should use actual cryptographic signing
     */
    override suspend fun sign(data: String): String {
        return "stub-signature-$data"
    }
}

