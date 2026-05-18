package com.chainlesschain.android.capture.share

import com.chainlesschain.android.capture.share.IntentPayloadParser.IntentExtracts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IntentPayloadParserTest {

    private val ts = 1700000000000L

    private fun send(
        mime: String? = "text/plain",
        text: String? = null,
        subject: String? = null,
        streams: List<String> = emptyList(),
    ) = IntentExtracts(
        action = "android.intent.action.SEND",
        mimeType = mime, text = text, subject = subject,
        streamUris = streams, timestampMs = ts,
    )

    private fun sendMultiple(
        mime: String? = "image/*",
        streams: List<String> = emptyList(),
        subject: String? = null,
    ) = IntentExtracts(
        action = "android.intent.action.SEND_MULTIPLE",
        mimeType = mime, text = null, subject = subject,
        streamUris = streams, timestampMs = ts,
    )

    @Test
    fun `plain text becomes Text payload`() {
        val payload = IntentPayloadParser.parse(
            send(text = "Hello world, this is some text", subject = "FromOther"),
        )

        assertTrue(payload is SharePayload.Text)
        payload as SharePayload.Text
        assertEquals("Hello world, this is some text", payload.text)
        assertEquals("FromOther", payload.subject)
        assertEquals(ts, payload.timestampMs)
    }

    @Test
    fun `url-like text becomes Url payload`() {
        val payload = IntentPayloadParser.parse(send(text = "https://chainlesschain.com/note/42"))

        assertTrue(payload is SharePayload.Url)
        assertEquals("https://chainlesschain.com/note/42", (payload as SharePayload.Url).url)
    }

    @Test
    fun `did url is recognized as Url`() {
        val payload = IntentPayloadParser.parse(send(text = "did:key:zABC123"))

        assertTrue(payload is SharePayload.Url)
    }

    @Test
    fun `single image stream becomes SingleImage`() {
        val payload = IntentPayloadParser.parse(
            send(mime = "image/jpeg", streams = listOf("content://media/external/images/1")),
        )

        assertTrue(payload is SharePayload.SingleImage)
        payload as SharePayload.SingleImage
        assertEquals("image/jpeg", payload.mimeType)
        assertEquals("content://media/external/images/1", payload.uri)
    }

    @Test
    fun `non-image single stream becomes GenericFile`() {
        val payload = IntentPayloadParser.parse(
            send(mime = "application/pdf", streams = listOf("content://docs/x.pdf")),
        )

        assertTrue(payload is SharePayload.GenericFile)
        assertEquals("application/pdf", (payload as SharePayload.GenericFile).mimeType)
    }

    @Test
    fun `single stream with empty mimeType falls back to octet-stream`() {
        val payload = IntentPayloadParser.parse(
            send(mime = "", streams = listOf("content://anywhere/x")),
        )

        assertTrue(payload is SharePayload.GenericFile)
        assertEquals("application/octet-stream", (payload as SharePayload.GenericFile).mimeType)
    }

    @Test
    fun `SEND_MULTIPLE with multiple streams becomes MultiImage`() {
        val payload = IntentPayloadParser.parse(
            sendMultiple(
                streams = listOf("content://a/1", "content://a/2", "content://a/3"),
            ),
        )

        assertTrue(payload is SharePayload.MultiImage)
        payload as SharePayload.MultiImage
        assertEquals(3, payload.uris.size)
    }

    @Test
    fun `SEND_MULTIPLE with one stream falls back to SingleImage`() {
        val payload = IntentPayloadParser.parse(
            sendMultiple(mime = "image/png", streams = listOf("content://a/1")),
        )

        // 多图分支需要 >= 2，单图走 single stream 路径
        assertTrue(payload is SharePayload.SingleImage)
    }

    @Test
    fun `non-SEND action returns null`() {
        val payload = IntentPayloadParser.parse(
            IntentExtracts(
                action = "android.intent.action.VIEW",
                mimeType = "text/plain", text = "x", subject = null,
                streamUris = emptyList(), timestampMs = ts,
            ),
        )

        assertNull(payload)
    }

    @Test
    fun `empty intent returns null`() {
        val payload = IntentPayloadParser.parse(send(text = null, streams = emptyList()))

        assertNull(payload)
    }

    @Test
    fun `whitespace-only text returns null`() {
        val payload = IntentPayloadParser.parse(send(text = "   \n\t  "))

        assertNull(payload)
    }

    @Test
    fun `multiline text is treated as text not url`() {
        // URL-like prefix但带换行，应是文本
        val payload = IntentPayloadParser.parse(send(text = "https://example.com\nsecond line"))

        assertTrue(payload is SharePayload.Text)
    }
}
