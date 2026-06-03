package com.chainlesschain.android.core.p2p

/**
 * Abstraction for remote skill execution via P2P.
 *
 * This interface decouples the feature-ai module from the concrete P2PClient
 * implementation in the app module, allowing dependency inversion through
 * the shared core-p2p module.
 *
 * Implementors (e.g., P2PClient) provide the actual transport mechanism.
 */
interface RemoteSkillProvider {

    /**
     * Whether a remote desktop peer is currently connected and available
     * for skill delegation.
     */
    val isRemoteConnected: Boolean

    /**
     * Send a command to the connected desktop peer and return the result.
     *
     * @param method  The RPC method name (e.g., "skill.execute", "skill.list")
     * @param params  Parameters map to send with the command
     * @param timeout Timeout in milliseconds
     * @return Result wrapping the response, or failure on error
     */
    suspend fun <T> sendRemoteCommand(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = 30_000L
    ): Result<T>
}
