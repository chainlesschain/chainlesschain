package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Display-only CLI-owned diagnostic summaries. Never retains arbitrary CLI fields. */
public record SessionModelInputs(long total, boolean truncated, List<Map<String, Object>> records) {
    public static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    public static final String UNAVAILABLE = "Model input diagnostics are unavailable. Update the cc CLI if it does not support --model-inputs, and check that this session has a readable canonical journal.";
    public SessionModelInputs { records = List.copyOf(records); }

    public static List<String> arguments(String sessionId) {
        require(sessionId != null && sessionId.matches("[\\w.:-]{1,256}"));
        return List.of("session", "show", "--json", "--model-inputs", "--limit", "50", "--", sessionId);
    }

    public static SessionModelInputs parse(String json, String sessionId) {
        arguments(sessionId);
        require(json != null && json.length() <= MAX_RESPONSE_BYTES
                && json.getBytes(StandardCharsets.UTF_8).length <= MAX_RESPONSE_BYTES);
        Map<?, ?> report = MiniJson.parseObject(json);
        require("chainlesschain.session-model-inputs/v1".equals(report.get("schema"))
                && sessionId.equals(report.get("sessionId")) && Boolean.FALSE.equals(report.get("billingVerified")));
        long total = count(report.get("total"));
        boolean truncated = bool(report.get("truncated"));
        require(report.get("records") instanceof List<?>);
        List<?> rows = (List<?>) report.get("records");
        require(rows.size() == Math.min(50L, total) && truncated == (total > rows.size()));
        List<Map<String, Object>> records = new ArrayList<>();
        for (Object raw : rows) {
            Map<?, ?> row = object(raw), event = object(row.get("diagnostic"));
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("eventHash", hash(row.get("eventHash"), false));
            require("chainlesschain.model-input-diagnostic/v1".equals(event.get("schema"))
                    && Boolean.FALSE.equals(event.get("billingVerified")));
            summary.put("requestId", identifier(event.get("requestId"), false));
            summary.put("usageCallId", identifier(event.get("usageCallId"), true));
            Object phase = event.get("phase");
            require(List.of("logical-input", "body-prepared").contains(phase));
            summary.put("phase", phase);
            if ("logical-input".equals(phase)) {
                summary.put("logicalDigest", hash(event.get("logicalDigest"), false));
                summary.put("bytes", count(event.get("bytes")));
                summary.put("messageCount", count(event.get("messageCount")));
                summary.put("toolCount", count(event.get("toolCount")));
                Map<?, ?> plan = object(event.get("planning")), projection = object(event.get("projection"));
                summary.put("planningCovered", bool(plan.get("covered")));
                summary.put("planDigest", hash(plan.get("digest"), true));
                summary.put("selectedCount", nullableCount(plan.get("selectedCount")));
                Map<?, ?> dropped = object(plan.get("dropped"));
                Map<String, Object> reasons = new LinkedHashMap<>();
                for (String reason : List.of("expired", "scope_denied", "sink_denied", "untrusted_system_policy",
                        "input_budget", "partition_ceiling", "unknown")) {
                    if (dropped.containsKey(reason)) reasons.put(reason, count(dropped.get(reason)));
                }
                summary.put("dropped", java.util.Collections.unmodifiableMap(reasons));
                summary.put("projectionCovered", bool(projection.get("covered")));
                for (String key : List.of("manifestDigest", "projectionDigest", "rulesetDigest"))
                    summary.put(key, hash(projection.get(key), true));
            } else {
                Object stage = event.get("stage");
                require(List.of("adapter-body", "fetch-body", "governed-fetch-body").contains(stage)
                        && Boolean.FALSE.equals(event.get("providerAcceptanceVerified")));
                summary.put("stage", stage);
                summary.put("attempt", nullableCount(event.get("attempt")));
                summary.put("bodyCovered", bool(event.get("bodyCovered")));
                summary.put("bodyDigest", hash(event.get("bodyDigest"), true));
                summary.put("bytes", nullableCount(event.get("bytes")));
            }
            records.add(java.util.Collections.unmodifiableMap(summary));
        }
        return new SessionModelInputs(total, truncated, records);
    }

    public String describe() {
        StringBuilder text = new StringBuilder("Current session model inputs\n\n");
        text.append("CLI-verified journal summaries: ").append(total)
                .append(truncated ? " (showing the latest 50)" : "").append('\n');
        text.append("Provider acceptance: unverified. Billing / actual token usage: unknown.\n");
        text.append("These summaries describe prepared requests; they do not prove model receipt.\n\n");
        if (records.isEmpty()) text.append("No model input diagnostics have been recorded for this session.\n");
        for (Map<String, Object> record : records) {
            for (Map.Entry<String, Object> field : record.entrySet())
                text.append(field.getKey()).append(": ").append(field.getValue() == null ? "unknown" : field.getValue()).append('\n');
            text.append('\n');
        }
        return text.toString();
    }

    private static Map<?, ?> object(Object value) { require(value instanceof Map<?, ?>); return (Map<?, ?>) value; }
    private static boolean bool(Object value) { require(value instanceof Boolean); return (Boolean) value; }
    private static Object nullableCount(Object value) { return value == null ? null : count(value); }
    private static long count(Object value) {
        require(value instanceof Number);
        double number = ((Number) value).doubleValue();
        require(Double.isFinite(number) && number >= 0 && number <= 9_007_199_254_740_991d && number == Math.floor(number));
        return ((Number) value).longValue();
    }
    private static String hash(Object value, boolean nullable) {
        if (value == null && nullable) return null;
        require(value instanceof String && ((String) value).matches("(?:sha256:)?[a-f0-9]{64}"));
        return (String) value;
    }
    private static String identifier(Object value, boolean usage) {
        if (usage && value == null) return null;
        require(value instanceof String && ((String) value).matches((usage ? "(?:mdl|cmp|sub)-" : "")
                + "[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}"));
        return (String) value;
    }
    private static void require(boolean valid) { if (!valid) throw new IllegalArgumentException(UNAVAILABLE); }
}
