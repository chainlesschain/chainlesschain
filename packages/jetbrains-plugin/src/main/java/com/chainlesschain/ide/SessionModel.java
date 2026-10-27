package com.chainlesschain.ide;

/** Conversation-only model choice; never changes credentials or connection settings. */
public final class SessionModel {
    private SessionModel() {}

    public static boolean valid(String value) {
        return value != null && !value.isEmpty() && value.length() <= 256
                && !value.matches("(?s).*[\\s\\p{Z}\\p{Cc}&|<>^\"'`%].*");
    }

    /** null means show, empty means follow defaults, otherwise an exact model ID. */
    public static String parse(String spec) {
        if (spec == null) throw new IllegalArgumentException("Use /model <model-id> or /model --default");
        String value = spec.trim();
        if (value.isEmpty()) return null;
        if ("--default".equals(value)) return "";
        if (!valid(value)) throw new IllegalArgumentException("Use one model ID of at most 256 characters without shell syntax");
        return value;
    }

    public static boolean needsRestart(String desired, String applied, boolean running, boolean active) {
        return running && !active && !java.util.Objects.equals(desired, applied);
    }

    /** Copy the redacted configuration snapshot, preserving provider and endpoint. */
    public static String[] apply(String[] configured, String override) {
        String[] result = configured.clone();
        if (valid(override)) result[1] = override;
        return result;
    }
}
