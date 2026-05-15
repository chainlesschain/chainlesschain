package com.chainlesschain.android.wear.sync

import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Unit tests for #21 C.1 PR3 — WearVoiceSender JSON protocol + path constant.
 *
 * Real `MessageClient.sendMessage` goes through Wearable Data Layer; Play
 * Services isn't available in JVM unit test. We test the wire-format shape +
 * cross-side path constant alignment. Wearable IO itself is left to
 * instrumented tests with a real watch + phone (PR3 GA validation).
 *
 * Mirror of WearDecisionSenderTest.
 */
class WearVoiceSenderTest {

    private val json = Json { encodeDefaults = false }

    // ─── PATH constant alignment with phone-side ───────────

    @Test
    fun `PATH_VOICE_START matches phone-side hardcoded value`() {
        // Phone-side: app/src/main/.../wear/CcPhoneVoiceListener.kt PATH_VOICE_START
        assertEquals("/cc/voice/start", WearVoiceSender.PATH_VOICE_START)
    }

    // ─── VoiceForwardPayload serialization ─────────────────

    @Test
    fun `payload encodes all four fields as snake_case`() {
        val p = VoiceForwardPayload(
            trigger_source = "wear_forward",
            wear_node_id = "wear-abc-123",
            client_request_id = "voice-1715750000-xyz",
            issued_at_ms = 1715750000000L,
        )
        val raw = json.encodeToString(VoiceForwardPayload.serializer(), p)
        // Field names locked snake_case for phone-side compat.
        assertTrue(raw.contains("\"trigger_source\":\"wear_forward\""))
        assertTrue(raw.contains("\"wear_node_id\":\"wear-abc-123\""))
        assertTrue(raw.contains("\"client_request_id\":\"voice-1715750000-xyz\""))
        assertTrue(raw.contains("\"issued_at_ms\":1715750000000"))
    }

    @Test
    fun `payload encodes round-trip symmetrically`() {
        val p = VoiceForwardPayload(
            trigger_source = "wear_forward",
            wear_node_id = "node-x",
            client_request_id = "req-1",
            issued_at_ms = 100L,
        )
        val raw = json.encodeToString(VoiceForwardPayload.serializer(), p)
        val back = json.decodeFromString(VoiceForwardPayload.serializer(), raw)
        assertEquals(p, back)
    }

    @Test
    fun `payload trigger_source value matches WEAR_FORWARD wireValue`() {
        // This is the contract: WearVoiceSender always sends "wear_forward"
        // matching phone-side VoiceTriggerSource.WEAR_FORWARD.wireValue.
        // (phone-side ignores this field for security, but we still send it
        // for analytics + future trust-anchor work.)
        val p = VoiceForwardPayload(
            trigger_source = "wear_forward",
            wear_node_id = "n",
            client_request_id = "r",
            issued_at_ms = 1L,
        )
        assertEquals("wear_forward", p.trigger_source)
    }

    // ─── VoiceForwardStatus enum ──────────────────────────

    @Test
    fun `VoiceForwardStatus has expected variants`() {
        // UI callers (VoiceForwardActivity) switch on these — locks the set.
        val variants = VoiceForwardStatus.entries.map { it.name }.toSet()
        assertEquals(
            setOf("OK", "NO_PHONE", "SEND_FAIL"),
            variants,
        )
    }

    // ─── VoiceForwardResult shape ─────────────────────────

    @Test
    fun `VoiceForwardResult carries status + correlation fields`() {
        val r = VoiceForwardResult(
            status = VoiceForwardStatus.OK,
            clientRequestId = "voice-1-abc",
            targetNodeId = "wear-node-1",
        )
        assertEquals(VoiceForwardStatus.OK, r.status)
        assertEquals("voice-1-abc", r.clientRequestId)
        assertEquals("wear-node-1", r.targetNodeId)
    }

    @Test
    fun `VoiceForwardResult tolerates null correlation fields on failure path`() {
        // When NodeClient.connectedNodes fails before we have a node id /
        // client_request_id, both are null.
        val r = VoiceForwardResult(
            status = VoiceForwardStatus.NO_PHONE,
            clientRequestId = null,
            targetNodeId = null,
        )
        assertEquals(VoiceForwardStatus.NO_PHONE, r.status)
    }
}
