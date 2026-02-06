package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.remote.crypto.RemoteDIDManager
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DID Manager Interface
 *
 * Defines operations for DID (Decentralized Identifier) management.
 */
interface DIDManager {
    suspend fun getCurrentDID(): String
    suspend fun sign(data: String): String
}

@Singleton
class DIDManagerImpl @Inject constructor(
    private val remoteDIDManager: RemoteDIDManager
) : DIDManager {

    override suspend fun getCurrentDID(): String {
        ensureInitialized()
        return remoteDIDManager.getCurrentDID()
    }

    override suspend fun sign(data: String): String {
        ensureInitialized()
        return remoteDIDManager.sign(data)
    }

    private suspend fun ensureInitialized() {
        if (remoteDIDManager.isInitialized()) {
            return
        }

        val initResult = remoteDIDManager.initialize()
        if (initResult.isFailure) {
            throw initResult.exceptionOrNull()
                ?: IllegalStateException("Failed to initialize RemoteDIDManager")
        }
    }
}
