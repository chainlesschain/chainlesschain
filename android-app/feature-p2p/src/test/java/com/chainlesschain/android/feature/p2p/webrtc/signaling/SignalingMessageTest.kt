package com.chainlesschain.android.feature.p2p.webrtc.signaling

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Unit tests for SignalingMessage serialization
 */
class SignalingMessageTest {

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
    }

    @Test
    fun `Offer message should serialize correctly`() {
        // Given
        val offer = SignalingMessage.Offer(
            from = "did:example:alice",
            to = "did:example:bob",
            timestamp = 1234567890L,
            sdp = "v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n..."
        )

        // When
        val jsonString = json.encodeToString(offer)

        // Then
        assertTrue(jsonString.contains("\"from\":\"did:example:alice\""))
        assertTrue(jsonString.contains("\"to\":\"did:example:bob\""))
        assertTrue(jsonString.contains("\"sdp\":"))
        assertTrue(jsonString.contains("\"type\":\"offer\""))
    }

    @Test
    fun `Answer message should serialize correctly`() {
        // Given
        val answer = SignalingMessage.Answer(
            from = "did:example:bob",
            to = "did:example:alice",
            timestamp = 1234567890L,
            sdp = "v=0\r\no=- 789 012 IN IP4 0.0.0.0\r\n..."
        )

        // When
        val jsonString = json.encodeToString(answer)

        // Then
        assertTrue(jsonString.contains("\"from\":\"did:example:bob\""))
        assertTrue(jsonString.contains("\"to\":\"did:example:alice\""))
        assertTrue(jsonString.contains("\"type\":\"answer\""))
    }

    @Test
    fun `IceCandidate message should serialize correctly`() {
        // Given
        val iceCandidate = SignalingMessage.IceCandidate(
            from = "did:example:alice",
            to = "did:example:bob",
            timestamp = 1234567890L,
            candidate = "candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host",
            sdpMid = "0",
            sdpMLineIndex = 0
        )

        // When
        val jsonString = json.encodeToString(iceCandidate)

        // Then
        assertTrue(jsonString.contains("\"candidate\":"))
        assertTrue(jsonString.contains("\"sdpMid\":\"0\""))
        assertTrue(jsonString.contains("\"sdpMLineIndex\":0"))
    }

    @Test
    fun `Bye message should serialize correctly`() {
        // Given
        val bye = SignalingMessage.Bye(
            from = "did:example:alice",
            to = "did:example:bob",
            timestamp = 1234567890L,
            reason = "User ended call"
        )

        // When
        val jsonString = json.encodeToString(bye)

        // Then
        assertTrue(jsonString.contains("\"reason\":\"User ended call\""))
    }

    @Test
    fun `Ping message should serialize correctly`() {
        // Given
        val ping = SignalingMessage.Ping(
            from = "did:example:alice",
            to = "server",
            timestamp = 1234567890L
        )

        // When
        val jsonString = json.encodeToString(ping)

        // Then
        assertTrue(jsonString.contains("\"from\":\"did:example:alice\""))
        assertTrue(jsonString.contains("\"to\":\"server\""))
    }

    @Test
    fun `Offer deserialization should work`() {
        // Given
        val jsonString = """
            {
                "from": "did:example:alice",
                "to": "did:example:bob",
                "timestamp": 1234567890,
                "sdp": "v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n...",
                "type": "offer"
            }
        """.trimIndent()

        // When
        val offer = json.decodeFromString<SignalingMessage.Offer>(jsonString)

        // Then
        assertEquals("did:example:alice", offer.from)
        assertEquals("did:example:bob", offer.to)
        assertEquals(1234567890L, offer.timestamp)
        assertEquals("v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n...", offer.sdp)
    }

    @Test
    fun `IceCandidate deserialization should work`() {
        // Given
        val jsonString = """
            {
                "from": "did:example:alice",
                "to": "did:example:bob",
                "timestamp": 1234567890,
                "candidate": "candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host",
                "sdpMid": "0",
                "sdpMLineIndex": 0
            }
        """.trimIndent()

        // When
        val iceCandidate = json.decodeFromString<SignalingMessage.IceCandidate>(jsonString)

        // Then
        assertEquals("did:example:alice", iceCandidate.from)
        assertEquals("did:example:bob", iceCandidate.to)
        assertEquals("candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host", iceCandidate.candidate)
        assertEquals("0", iceCandidate.sdpMid)
        assertEquals(0, iceCandidate.sdpMLineIndex)
    }

    @Test
    fun `SignalingEnvelope should wrap messages correctly`() {
        // Given
        val offer = SignalingMessage.Offer(
            from = "did:example:alice",
            to = "did:example:bob",
            sdp = "test-sdp"
        )

        // When
        val envelope = SignalingEnvelope(
            type = "offer",
            payload = json.encodeToJsonElement(
                serializer = SignalingMessage.serializer(),
                value = offer
            )
        )
        val jsonString = json.encodeToString(envelope)

        // Then
        assertTrue(jsonString.contains("\"type\":\"offer\""))
        assertTrue(jsonString.contains("\"payload\":"))
    }
}
