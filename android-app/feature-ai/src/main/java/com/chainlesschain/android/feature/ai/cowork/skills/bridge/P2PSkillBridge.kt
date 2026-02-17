package com.chainlesschain.android.feature.ai.cowork.skills.bridge

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import timber.log.Timber

/**
 * Bridge for delegating desktop-only skills via P2P DataChannel.
 *
 * When a skill is not available on Android (e.g., browser automation, filesystem ops),
 * this bridge sends the execution request to a connected desktop peer and awaits the result.
 *
 * Uses P2PClient.sendCommand() with "skill.execute" and "skill.list" methods.
 */
class P2PSkillBridge(
    private val p2pClient: P2PClient? = null
) {

    companion object {
        private const val TAG = "P2PSkillBridge"
        private const val REMOTE_TIMEOUT_MS = 30_000L
    }

    /**
     * Whether a desktop peer is connected and available for skill delegation.
     */
    val isDesktopConnected: Boolean
        get() = p2pClient?.connectionState?.value == ConnectionState.CONNECTED

    /**
     * Execute a skill on the connected desktop via P2P.
     *
     * Sends a "skill.execute" command via the P2P DataChannel and awaits
     * the result from the desktop's routeMobileCommand handler.
     *
     * @param skillName Name of the skill
     * @param input     Input parameters
     * @return SkillResult from the desktop, or error if not connected
     */
    suspend fun executeRemote(skillName: String, input: Map<String, Any>): SkillResult {
        if (p2pClient == null) {
            return SkillResult(
                success = false,
                output = "",
                error = "P2P client not available. Remote skill execution requires the remote module."
            )
        }

        if (!isDesktopConnected) {
            return SkillResult(
                success = false,
                output = "",
                error = "No desktop peer connected. Connect to a desktop to use this skill."
            )
        }

        Timber.d("$TAG: Executing remote skill '$skillName' via P2P")

        val result = p2pClient.sendCommand<Map<String, Any>>(
            method = "skill.execute",
            params = mapOf(
                "skillName" to skillName,
                "input" to input
            ),
            timeout = REMOTE_TIMEOUT_MS
        )

        return result.fold(
            onSuccess = { data ->
                @Suppress("UNCHECKED_CAST")
                val responseMap = data as? Map<String, Any> ?: emptyMap()
                SkillResult(
                    success = responseMap["success"] as? Boolean ?: false,
                    output = responseMap["output"]?.toString() ?: "",
                    error = responseMap["error"]?.toString(),
                    data = mapOf("remote" to true, "skillName" to skillName)
                )
            },
            onFailure = { e ->
                Timber.e(e, "$TAG: Remote skill execution failed for '$skillName'")
                SkillResult(
                    success = false,
                    output = "",
                    error = "P2P remote execution failed: ${e.message}"
                )
            }
        )
    }

    /**
     * Get list of skills available on the connected desktop.
     *
     * @return List of skill info maps, or empty list if not connected
     */
    suspend fun getDesktopSkills(): List<Map<String, Any>> {
        if (p2pClient == null || !isDesktopConnected) {
            return emptyList()
        }

        val result = p2pClient.sendCommand<Map<String, Any>>(
            method = "skill.list",
            params = emptyMap(),
            timeout = 10_000L
        )

        return result.fold(
            onSuccess = { data ->
                @Suppress("UNCHECKED_CAST")
                val responseMap = data as? Map<String, Any> ?: emptyMap()
                @Suppress("UNCHECKED_CAST")
                (responseMap["skills"] as? List<Map<String, Any>>) ?: emptyList()
            },
            onFailure = { e ->
                Timber.w(e, "$TAG: Failed to get desktop skills list")
                emptyList()
            }
        )
    }
}
