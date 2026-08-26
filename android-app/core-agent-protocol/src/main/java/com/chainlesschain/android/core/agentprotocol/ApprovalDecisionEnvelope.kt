package com.chainlesschain.android.core.agentprotocol

import com.chainlesschain.agent.protocol.generated.ApprovalDecision
import com.chainlesschain.agent.protocol.generated.parseApprovalDecision
import com.chainlesschain.agent.protocol.generated.toWireValue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Data Layer envelope for a canonical Agent Protocol approval decision.
 *
 * [approved] is emitted only as an N-1 compatibility projection. New consumers
 * must resolve [decision], reject conflicts, and never infer a persistent grant
 * from the legacy bit.
 */
@Serializable
data class ApprovalDecisionEnvelope(
    val requestId: String,
    val decision: JsonObject? = null,
    val decidedAtMs: Long,
    val biometricToken: String? = null,
    val approved: Boolean? = null,
) {
    /** Validate and normalize canonical and N-1 payloads fail closed. */
    fun resolveDecision(): ApprovalDecision {
        require(requestId.isNotBlank()) { "requestId must not be blank" }
        val canonical = decision?.let { parseApprovalDecision(it.toProtocolValue()) }
        val legacy = approved?.let {
            if (it) ApprovalDecision.AcceptOnce else ApprovalDecision.Decline()
        }
        require(canonical != null || legacy != null) {
            "decision or N-1 approved projection is required"
        }
        if (canonical != null && approved != null) {
            require(canonical.toLegacyApproved() == approved) {
                "canonical decision conflicts with N-1 approved projection"
            }
        }
        return (canonical ?: legacy!!).also { requireBinaryDecision(it) }
    }

    companion object {
        /**
         * Wear currently exposes a binary UI, so it may issue only least-
         * privilege accept-once or decline decisions.
         */
        fun fromDecision(
            requestId: String,
            decision: ApprovalDecision,
            decidedAtMs: Long,
            biometricToken: String? = null,
        ): ApprovalDecisionEnvelope {
            require(requestId.isNotBlank()) { "requestId must not be blank" }
            requireBinaryDecision(decision)
            return ApprovalDecisionEnvelope(
                requestId = requestId,
                decision = decision.toWireValue().toJsonElement() as JsonObject,
                decidedAtMs = decidedAtMs,
                biometricToken = biometricToken,
                approved = decision.toLegacyApproved(),
            )
        }

        private fun requireBinaryDecision(decision: ApprovalDecision) {
            require(
                decision is ApprovalDecision.AcceptOnce ||
                    decision is ApprovalDecision.Decline,
            ) {
                "Wear binary approval UI cannot issue ${decision::class.simpleName}"
            }
        }
    }
}

fun ApprovalDecision.toLegacyApproved(): Boolean = when (this) {
    ApprovalDecision.AcceptOnce -> true
    is ApprovalDecision.Decline -> false
    else -> throw IllegalArgumentException(
        "ApprovalDecision cannot be represented by the N-1 approved projection",
    )
}

private fun JsonElement.toProtocolValue(): Any? = when (this) {
    JsonNull -> null
    is JsonObject -> mapValues { (_, value) -> value.toProtocolValue() }
    is JsonArray -> map { it.toProtocolValue() }
    is JsonPrimitive -> when {
        isString -> content
        content == "true" -> true
        content == "false" -> false
        else -> longOrNull ?: doubleOrNull ?: content
    }
}

private fun Any?.toJsonElement(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is String -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    is Map<*, *> -> JsonObject(entries.associate { (key, value) ->
        require(key is String) { "approval wire object keys must be strings" }
        key to value.toJsonElement()
    })
    is Iterable<*> -> JsonArray(map { it.toJsonElement() })
    else -> throw IllegalArgumentException(
        "Unsupported approval wire value: ${this::class.qualifiedName}",
    )
}
