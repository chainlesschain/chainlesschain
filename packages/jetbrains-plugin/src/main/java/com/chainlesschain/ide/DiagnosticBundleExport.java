package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Pure contract for the IDE-facing {@code cc doctor --export-bundle} action.
 *
 * <p>The CLI owns collection, de-identification and the mandatory secret-scan
 * gate. The IDE writes to a private temp, verifies this deterministic schema,
 * and only then replaces the user-approved destination.
 */
public final class DiagnosticBundleExport {
    public static final String SCHEMA = "cc-diagnostic-bundle/v1";

    private DiagnosticBundleExport() {}

    public static List<String> buildArgs(String outPath) {
        if (outPath == null || outPath.trim().isEmpty()) {
            throw new IllegalArgumentException(
                    "Diagnostic bundle target path is required");
        }
        return new ArrayList<>(Arrays.asList(
                "doctor", "--export-bundle", outPath));
    }

    /**
     * Require valid JSON, the exact top-level schema and the meta.excluded
     * privacy contract. This prevents an old CLI's human-readable doctor output
     * or a string containing lookalike fields from replacing a valid bundle.
     */
    @SuppressWarnings("unchecked")
    public static boolean isValidBundle(String json) {
        if (json == null || json.isEmpty()) return false;
        try {
            Object parsed = MiniJson.parse(json);
            if (!(parsed instanceof Map)) return false;
            Map<String, Object> bundle = (Map<String, Object>) parsed;
            if (!SCHEMA.equals(bundle.get("schema"))) return false;
            Object metaValue = bundle.get("meta");
            if (!(metaValue instanceof Map)) return false;
            Object excluded = ((Map<String, Object>) metaValue).get("excluded");
            return excluded instanceof List;
        } catch (RuntimeException invalidJson) {
            return false;
        }
    }
}
