package com.chainlesschain.android.wear

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.voice.VoiceLaunchActions
import com.chainlesschain.android.voice.VoiceTriggerSource
import kotlinx.serialization.json.Json
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Unit tests for #21 C.1 PR2 — CcPhoneVoiceListener + VoiceForwardWire.
 *
 * Tests focus on the message-parsing + Intent-construction pipeline. We
 * exercise the `startVoiceActivity` static helper directly with a
 * Robolectric Context so the WearableListenerService lifecycle is not
 * required. PR3 will add instrumented tests that verify the full
 * wear→phone path with a real Wearable Data Layer.
 */
@RunWith(RobolectricTestRunner::class)
class CcPhoneVoiceListenerTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    // ─── PATH constant lock ───────────────────────────────

    @Test
    fun `PATH_VOICE_START constant value`() {
        // Locked: wear-side WearVoiceSender (PR3) references this string.
        assertEquals("/cc/voice/start", CcPhoneVoiceListener.PATH_VOICE_START)
    }

    // ─── VoiceForwardWire serialization ────────────────────

    @Test
    fun `VoiceForwardWire round-trip preserves fields`() {
        val original = VoiceForwardWire(
            trigger_source = "wear_forward",
            wear_node_id = "wear-node-abc",
            client_request_id = "voice-1715750000-xyz",
            issued_at_ms = 1715750000000L,
        )
        val encoded = json.encodeToString(VoiceForwardWire.serializer(), original)
        val decoded = json.decodeFromString(VoiceForwardWire.serializer(), encoded)
        assertEquals(original, decoded)
    }

    @Test
    fun `VoiceForwardWire decode tolerates missing optional fields`() {
        // Wear-side might omit some fields in early payloads — ignoreUnknownKeys
        // + nullable defaults handle that.
        val decoded = json.decodeFromString(
            VoiceForwardWire.serializer(),
            """{"client_request_id":"voice-only-id"}""",
        )
        assertEquals("voice-only-id", decoded.client_request_id)
        assertNull(decoded.trigger_source)
        assertNull(decoded.wear_node_id)
        assertNull(decoded.issued_at_ms)
    }

    @Test
    fun `VoiceForwardWire decode tolerates unknown fields (forward compat)`() {
        val decoded = json.decodeFromString(
            VoiceForwardWire.serializer(),
            """{"client_request_id":"req-1","future_field":"ignored","another":42}""",
        )
        assertEquals("req-1", decoded.client_request_id)
    }

    // ─── startVoiceActivity (Intent construction + dispatch) ────

    @Test
    fun `startVoiceActivity builds intent with WEAR_FORWARD trigger source`() {
        val wire = VoiceForwardWire(
            trigger_source = "wear_forward",
            wear_node_id = "wear-1",
            client_request_id = "voice-test-1",
            issued_at_ms = 1L,
        )
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        assertNotNull(started, "startActivity must be invoked")
        assertEquals(VoiceLaunchActions.ACTION_START_VOICE_MODE, started.action)
        // Source locked to WEAR_FORWARD regardless of payload's trigger_source.
        assertEquals(
            "wear_forward",
            started.getStringExtra(VoiceLaunchActions.EXTRA_TRIGGER_SOURCE),
        )
        assertEquals(
            "voice-test-1",
            started.getStringExtra(VoiceLaunchActions.EXTRA_CLIENT_REQUEST_ID),
        )
    }

    @Test
    fun `startVoiceActivity ignores attacker-forged trigger_source in payload`() {
        // PR2 design note: payload trigger_source is informational only. An
        // attacker on the wear side cannot inject AUTO_BUTTON / PHONE_SHORTCUT
        // via this path — we always lock to WEAR_FORWARD.
        val wire = VoiceForwardWire(
            trigger_source = "auto_button", // <- attacker forgery attempt
            wear_node_id = "wear-1",
            client_request_id = "voice-attack-1",
            issued_at_ms = 1L,
        )
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        assertEquals(
            VoiceTriggerSource.WEAR_FORWARD.wireValue,
            started.getStringExtra(VoiceLaunchActions.EXTRA_TRIGGER_SOURCE),
            "trigger_source MUST be locked to WEAR_FORWARD regardless of payload",
        )
    }

    @Test
    fun `startVoiceActivity sets FLAG_ACTIVITY_NEW_TASK (non-Activity context)`() {
        val wire = VoiceForwardWire(client_request_id = "voice-flag-test")
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        assertTrue(
            started.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0,
            "FLAG_ACTIVITY_NEW_TASK required from non-Activity context",
        )
    }

    @Test
    fun `startVoiceActivity sets FLAG_ACTIVITY_RESET_TASK_IF_NEEDED`() {
        val wire = VoiceForwardWire(client_request_id = "voice-reset-test")
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        assertTrue(
            started.flags and Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED != 0,
            "FLAG_ACTIVITY_RESET_TASK_IF_NEEDED required to avoid stale back-stack",
        )
    }

    @Test
    fun `startVoiceActivity scopes intent to current package`() {
        val wire = VoiceForwardWire(client_request_id = "voice-scope-test")
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        assertEquals(
            context.packageName,
            started.`package`,
            "intent.setPackage prevents implicit dispatch to other apps",
        )
    }

    @Test
    fun `startVoiceActivity does not throw on null fields`() {
        val wire = VoiceForwardWire() // all nulls
        // Should not throw; client_request_id null is acceptable.
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        assertNotNull(started)
        // EXTRA_CLIENT_REQUEST_ID omitted when wire field is null per
        // VoiceLaunchActions.buildIntent contract.
        assertNull(started.getStringExtra(VoiceLaunchActions.EXTRA_CLIENT_REQUEST_ID))
    }

    // ─── round-trip: full pipeline (wire JSON → intent → extract) ──

    @Test
    fun `pipeline wire JSON to Intent to extracted trigger source`() {
        val wireJson = """
            {
              "trigger_source": "wear_forward",
              "wear_node_id": "wear-node-aaa",
              "client_request_id": "voice-pipeline-1",
              "issued_at_ms": 1715750000000
            }
        """.trimIndent()
        val wire = json.decodeFromString(VoiceForwardWire.serializer(), wireJson)
        CcPhoneVoiceListener.startVoiceActivity(context, wire)
        val shadowApp = Shadows.shadowOf(
            context.applicationContext as android.app.Application,
        )
        val started = shadowApp.nextStartedActivity
        // Receiver (MainActivity) would call extractTriggerSource on this:
        val parsed = VoiceLaunchActions.extractTriggerSource(started)
        assertEquals(VoiceTriggerSource.WEAR_FORWARD, parsed)
    }
}
