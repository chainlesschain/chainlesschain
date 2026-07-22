package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** Pure PR/CI status adapter shared by the JetBrains action and tests. */
public final class PrStatus {
    private PrStatus() {}

    public static List<String> buildArgs() {
        return new ArrayList<>(Arrays.asList(
                "session", "pr-status", "last", "--json"));
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parse(String text) {
        try {
            Map<String, Object> value = MiniJson.parseObject(text == null ? "" : text.trim());
            return value.isEmpty() ? null : value;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    public static String render(Map<String, Object> status) {
        if (status == null) return null;
        StringBuilder out = new StringBuilder("PR / CI Status\n\n");
        out.append("Source: ").append(String.valueOf(status.getOrDefault("source", "unknown")))
                .append("\n\n");
        Object rawLines = status.get("lines");
        if (rawLines instanceof List) {
            for (Object line : (List<Object>) rawLines) {
                out.append("- ").append(String.valueOf(line)).append('\n');
            }
        } else {
            out.append(MiniJson.stringify(status)).append('\n');
        }
        return out.toString();
    }
}
