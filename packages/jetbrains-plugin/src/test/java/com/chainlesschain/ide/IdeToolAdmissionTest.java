package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Contract coverage for the secret-free IDE-to-CLI admission envelope. */
class IdeToolAdmissionTest {

    @Test
    void environmentEnvelopeIsEnforcedAttributedAndHostBounded() {
        String json = IdeToolAdmission.environmentJson();

        assertTrue(json.contains("\"enforce\":true"));
        assertTrue(json.contains("\"source\":\"jetbrains-plugin\""));
        assertTrue(json.contains("\"capabilityGranted\":true"));
        assertTrue(json.contains("\"policyAllowed\":true"));
        assertTrue(json.contains("\"permissionGranted\":true"));
        assertTrue(json.contains("\"budgetOk\":true"));
        assertTrue(json.contains("\"uiSupported\":true"));
        assertTrue(json.contains("\"publish_artifact\":{\"policyAllowed\":false}"));
        assertTrue(json.contains("\"notify\":{\"policyAllowed\":false}"));
        assertFalse(json.matches("(?i).*(api.?key|token|prompt|arguments).*"));
    }
}
