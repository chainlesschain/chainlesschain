package com.chainlesschain.android.voice

import android.content.Intent
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertNotNull

/**
 * Unit tests for #21 C.1 PR1 — VoiceLaunchActions + VoiceTriggerSource.
 *
 * Uses Robolectric so we can construct real Android Intent objects without
 * needing an instrumented test device. The actual NavGraph navigation is
 * out of scope for PR1 — see spike doc §4. PR3 will add wear-forward
 * instrumented tests once the full chain is wired.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class VoiceLaunchActionsTest {

    // ─── constants (防误改) ─────────────────────────────────

    @Test
    fun `ACTION_START_VOICE_MODE constant has expected value`() {
        // Locked: external apps / wear-app reference this string literal.
        assertEquals(
            "com.chainlesschain.android.action.START_VOICE_MODE",
            VoiceLaunchActions.ACTION_START_VOICE_MODE,
        )
    }

    @Test
    fun `EXTRA constants have expected keys`() {
        assertEquals(
            "cc.voice.trigger_source",
            VoiceLaunchActions.EXTRA_TRIGGER_SOURCE,
        )
        assertEquals(
            "cc.voice.client_request_id",
            VoiceLaunchActions.EXTRA_CLIENT_REQUEST_ID,
        )
    }

    // ─── VoiceTriggerSource.fromWireValue ─────────────────────

    @Test
    fun `fromWireValue maps each canonical wire value`() {
        assertEquals(
            VoiceTriggerSource.PHONE_SHORTCUT,
            VoiceTriggerSource.fromWireValue("phone_shortcut"),
        )
        assertEquals(
            VoiceTriggerSource.AUTO_BUTTON,
            VoiceTriggerSource.fromWireValue("auto_button"),
        )
        assertEquals(
            VoiceTriggerSource.WEAR_FORWARD,
            VoiceTriggerSource.fromWireValue("wear_forward"),
        )
        assertEquals(
            VoiceTriggerSource.EXTERNAL,
            VoiceTriggerSource.fromWireValue("external"),
        )
    }

    @Test
    fun `fromWireValue null falls back to EXTERNAL`() {
        assertEquals(VoiceTriggerSource.EXTERNAL, VoiceTriggerSource.fromWireValue(null))
    }

    @Test
    fun `fromWireValue unknown value falls back to EXTERNAL (defense)`() {
        // Per spike doc §3.2 — attacker-supplied bogus extra cannot
        // masquerade as WEAR_FORWARD to bypass future privilege gates.
        assertEquals(
            VoiceTriggerSource.EXTERNAL,
            VoiceTriggerSource.fromWireValue("evil_source"),
        )
        assertEquals(
            VoiceTriggerSource.EXTERNAL,
            VoiceTriggerSource.fromWireValue(""),
        )
    }

    @Test
    fun `each VoiceTriggerSource has unique wireValue`() {
        val wires = VoiceTriggerSource.entries.map { it.wireValue }
        assertEquals(wires.size, wires.toSet().size, "wire values must be unique")
    }

    // ─── buildIntent ─────────────────────────────────────────

    @Test
    fun `buildIntent sets correct action`() {
        val intent = VoiceLaunchActions.buildIntent(VoiceTriggerSource.WEAR_FORWARD)
        assertEquals(VoiceLaunchActions.ACTION_START_VOICE_MODE, intent.action)
    }

    @Test
    fun `buildIntent carries trigger source extra`() {
        val intent = VoiceLaunchActions.buildIntent(VoiceTriggerSource.PHONE_SHORTCUT)
        assertEquals(
            "phone_shortcut",
            intent.getStringExtra(VoiceLaunchActions.EXTRA_TRIGGER_SOURCE),
        )
    }

    @Test
    fun `buildIntent without clientRequestId omits the extra`() {
        val intent = VoiceLaunchActions.buildIntent(VoiceTriggerSource.EXTERNAL)
        assertNull(intent.getStringExtra(VoiceLaunchActions.EXTRA_CLIENT_REQUEST_ID))
    }

    @Test
    fun `buildIntent with clientRequestId carries the extra`() {
        val intent = VoiceLaunchActions.buildIntent(
            VoiceTriggerSource.WEAR_FORWARD,
            clientRequestId = "voice-1234567890-abc",
        )
        assertEquals(
            "voice-1234567890-abc",
            intent.getStringExtra(VoiceLaunchActions.EXTRA_CLIENT_REQUEST_ID),
        )
    }

    // ─── extractTriggerSource ────────────────────────────────

    @Test
    fun `extractTriggerSource returns null for null intent`() {
        assertNull(VoiceLaunchActions.extractTriggerSource(null))
    }

    @Test
    fun `extractTriggerSource returns null when action mismatches`() {
        val intent = Intent("android.intent.action.SEND")
        assertNull(VoiceLaunchActions.extractTriggerSource(intent))
    }

    @Test
    fun `extractTriggerSource returns parsed source for matching action`() {
        val intent = VoiceLaunchActions.buildIntent(VoiceTriggerSource.WEAR_FORWARD)
        assertEquals(
            VoiceTriggerSource.WEAR_FORWARD,
            VoiceLaunchActions.extractTriggerSource(intent),
        )
    }

    @Test
    fun `extractTriggerSource falls back to EXTERNAL when extra missing`() {
        val intent = Intent(VoiceLaunchActions.ACTION_START_VOICE_MODE)
        // No EXTRA_TRIGGER_SOURCE set.
        assertEquals(
            VoiceTriggerSource.EXTERNAL,
            VoiceLaunchActions.extractTriggerSource(intent),
        )
    }

    @Test
    fun `extractTriggerSource defends against bogus extra value`() {
        val intent = Intent(VoiceLaunchActions.ACTION_START_VOICE_MODE)
        intent.putExtra(VoiceLaunchActions.EXTRA_TRIGGER_SOURCE, "evil_source")
        // Defense: unknown wire value → EXTERNAL (cannot fake WEAR_FORWARD privilege)
        assertEquals(
            VoiceTriggerSource.EXTERNAL,
            VoiceLaunchActions.extractTriggerSource(intent),
        )
    }

    @Test
    fun `buildIntent extractTriggerSource round-trip preserves source`() {
        for (source in VoiceTriggerSource.entries) {
            val intent = VoiceLaunchActions.buildIntent(source)
            val parsed = VoiceLaunchActions.extractTriggerSource(intent)
            assertNotNull(parsed)
            assertEquals(source, parsed, "round-trip failed for $source")
        }
    }
}
