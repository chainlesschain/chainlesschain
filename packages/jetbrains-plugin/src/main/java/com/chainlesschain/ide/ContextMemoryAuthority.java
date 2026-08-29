package com.chainlesschain.ide;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Production cutover mapping for the projection-only JetBrains host. */
public final class ContextMemoryAuthority {
    public static final String JETBRAINS_STAGE_ENV =
            "CHAINLESSCHAIN_CONTEXT_MEMORY_JETBRAINS_STAGE";
    public static final String CLI_STAGE_ENV =
            "CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE";
    public static final String DEFAULT_STAGE = "canonical_default";
    public static final Set<String> STAGES = Collections.unmodifiableSet(Set.of(
            "shadow",
            "internal_canary",
            "opt_in_canary",
            "canonical_default",
            "legacy_read_only",
            "retired"));

    private ContextMemoryAuthority() {}

    public static String resolveStage(Map<String, String> environment) {
        String raw = environment == null ? null : environment.get(JETBRAINS_STAGE_ENV);
        String stage = raw == null || raw.trim().isEmpty()
                ? DEFAULT_STAGE : raw.trim().toLowerCase(Locale.ROOT);
        if (!STAGES.contains(stage)) {
            throw new IllegalArgumentException(
                    "Unsupported JetBrains Context/Memory stage: " + stage);
        }
        return stage;
    }

    public static boolean isCanonical(String stage) {
        return "canonical_default".equals(stage)
                || "legacy_read_only".equals(stage)
                || "retired".equals(stage);
    }

    public static Map<String, String> cliEnvironment(Map<String, String> environment) {
        Map<String, String> output = new LinkedHashMap<String, String>();
        output.put(CLI_STAGE_ENV, resolveStage(environment));
        return Collections.unmodifiableMap(output);
    }
}
