package com.chainlesschain.android.remote.session

import com.chainlesschain.agent.protocol.generated.PermissionGrant
import org.json.JSONArray
import org.json.JSONObject

internal fun isRemoteApprovalRequest(event: JSONObject): Boolean =
    when (event.optString("type")) {
        "permission.request", "approval.requested", "approval_request" -> true
        else -> false
    }

internal fun remoteApprovalRequestId(event: JSONObject): String =
    event.optString(
        "requestId",
        event.optString("approvalId", event.optString("id")),
    ).trim()

/** Returns the exact bounded grant list rendered by the mobile UI, or null. */
internal fun reviewedApprovalPermissions(event: JSONObject): List<PermissionGrant>? {
    val raw = when {
        event.has("requested_permissions") -> event.opt("requested_permissions")
        event.has("requestedPermissions") -> event.opt("requestedPermissions")
        else -> null
    } as? JSONArray ?: return null
    if (raw.length() !in 1..64) return null
    val grants = mutableListOf<PermissionGrant>()
    for (index in 0 until raw.length()) {
        val entry = raw.optJSONObject(index) ?: return null
        val keys = entry.keys().asSequence().toSet()
        if (!keys.all { it in setOf("capability", "scope", "expiresAt") }) return null
        val capability = entry.optString("capability")
        val scope = entry.optString("scope")
        if (capability.length !in 1..128 || scope.length !in 1..1_024) return null
        val expiresAt = entry.opt("expiresAt").takeUnless {
            it == null || it == JSONObject.NULL
        }
        if (expiresAt != null && expiresAt !is String) return null
        grants += PermissionGrant(capability, scope, expiresAt)
    }
    return grants
}
