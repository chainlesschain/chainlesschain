package com.chainlesschain.android.core.agentprotocol

import com.chainlesschain.agent.protocol.generated.ApprovalDecision
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ApprovalDecisionEnvelopeTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `accept once emits canonical decision and N-1 projection`() {
        val envelope = ApprovalDecisionEnvelope.fromDecision(
            requestId = "mp:42",
            decision = ApprovalDecision.AcceptOnce,
            decidedAtMs = 42,
        )

        val raw = json.encodeToString(ApprovalDecisionEnvelope.serializer(), envelope)

        assertTrue(raw.contains("\"decision\":{\"kind\":\"acceptOnce\"}"))
        assertTrue(raw.contains("\"approved\":true"))
        assertEquals(ApprovalDecision.AcceptOnce, envelope.resolveDecision())
    }

    @Test
    fun `decline reason survives serialization and canonical validation`() {
        val envelope = ApprovalDecisionEnvelope.fromDecision(
            requestId = "sys:42",
            decision = ApprovalDecision.Decline("user-declined"),
            decidedAtMs = 43,
        )
        val raw = json.encodeToString(ApprovalDecisionEnvelope.serializer(), envelope)
        val decoded = json.decodeFromString(ApprovalDecisionEnvelope.serializer(), raw)

        assertEquals(ApprovalDecision.Decline("user-declined"), decoded.resolveDecision())
        assertEquals(false, decoded.approved)
    }

    @Test
    fun `N-1 approved bit normalizes to least privilege canonical decision`() {
        val accepted = ApprovalDecisionEnvelope(
            requestId = "mp:old",
            approved = true,
            decidedAtMs = 1,
        )
        val declined = accepted.copy(requestId = "sys:old", approved = false)

        assertEquals(ApprovalDecision.AcceptOnce, accepted.resolveDecision())
        assertIs<ApprovalDecision.Decline>(declined.resolveDecision())
    }

    @Test
    fun `canonical and legacy projection conflict fails closed`() {
        val envelope = ApprovalDecisionEnvelope(
            requestId = "mp:conflict",
            decision = buildJsonObject { put("kind", "decline") },
            approved = true,
            decidedAtMs = 1,
        )

        assertFailsWith<IllegalArgumentException> { envelope.resolveDecision() }
    }

    @Test
    fun `binary Wear UI cannot mint persistent grants or cancel`() {
        listOf<ApprovalDecision>(
            ApprovalDecision.AcceptForTurn(),
            ApprovalDecision.AcceptForSession(),
            ApprovalDecision.Cancel(),
        ).forEach { decision ->
            assertFailsWith<IllegalArgumentException> {
                ApprovalDecisionEnvelope.fromDecision("mp:grant", decision, 1)
            }
        }
    }

    @Test
    fun `receiver rejects a canonical persistent grant from an untrusted watch`() {
        val envelope = ApprovalDecisionEnvelope(
            requestId = "mp:untrusted-grant",
            decision = buildJsonObject { put("kind", "acceptForSession") },
            decidedAtMs = 1,
        )

        assertFailsWith<IllegalArgumentException> { envelope.resolveDecision() }
    }
}
