package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class DiagnosticBundleExportTest {

    @Test
    void buildsTheCliExportContract() {
        assertEquals(
                Arrays.asList(
                        "doctor",
                        "--export-bundle",
                        "C:\\tmp\\support.json"),
                DiagnosticBundleExport.buildArgs(
                        "C:\\tmp\\support.json"));
        assertThrows(
                IllegalArgumentException.class,
                () -> DiagnosticBundleExport.buildArgs(" "));
    }

    @Test
    void acceptsOnlyTheVersionedPrivacyBearingBundle() {
        String valid = "{\n"
                + "  \"schema\": \"cc-diagnostic-bundle/v1\",\n"
                + "  \"meta\": {\"excluded\": [\"source code body\"]}\n"
                + "}";
        assertTrue(DiagnosticBundleExport.isValidBundle(valid));
        assertFalse(DiagnosticBundleExport.isValidBundle("{}"));
        assertFalse(DiagnosticBundleExport.isValidBundle(
                "{\"schema\":\"cc-diagnostic-bundle/v1\",\"meta\":{}}"));
        assertFalse(DiagnosticBundleExport.isValidBundle(
                "doctor output\n{\"schema\":\"cc-diagnostic-bundle/v1\","
                        + "\"meta\":{\"excluded\":[]}}"));
        assertFalse(DiagnosticBundleExport.isValidBundle(
                "{\"note\":\"\\\"schema\\\":\\\"cc-diagnostic-bundle/v1\\\" "
                        + "\\\"excluded\\\":[]\"}"));
        assertFalse(DiagnosticBundleExport.isValidBundle(
                "{\"schema\":\"cc-diagnostic-bundle/v1\","
                        + "\"meta\":{\"excluded\":{}}}"));
    }
}
