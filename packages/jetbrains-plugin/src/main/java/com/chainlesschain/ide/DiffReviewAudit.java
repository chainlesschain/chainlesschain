package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Content-minimized, cross-host audit envelope for one native diff decision. */
public final class DiffReviewAudit {
    private DiffReviewAudit() {}

    public static final String SCHEMA = "cc-diff-review/v1";
    public static final int MAX_COMMENTS = 64;
    public static final int MAX_HUNKS = 128;

    public static Map<String, Object> build(
            String path,
            String originalText,
            String proposedText,
            Map<String, Object> result,
            Map<?, ?> reviewContext,
            String host,
            String actor,
            Instant now) {
        Map<String, Object> decision = result != null
                ? result : new LinkedHashMap<String, Object>();
        String reviewedText = decision.get("reviewedText") instanceof String
                ? (String) decision.get("reviewedText")
                : decision.get("finalText") instanceof String
                        ? (String) decision.get("finalText") : proposedText;
        List<Integer> selectedHunks = selectedHunks(decision.get("selectedHunks"));
        String outcome = or(bounded(decision.get("outcome"), 64), "rejected");
        boolean written = "accepted".equals(outcome) || "partial".equals(outcome);
        String createdAt = String.valueOf(now != null ? now : Instant.now());
        Map<String, Object> proposed = fingerprintText(proposedText);
        Map<String, Object> reviewed = fingerprintText(reviewedText);
        String finalText = written
                ? decision.get("finalText") instanceof String
                        ? (String) decision.get("finalText") : reviewedText
                : null;
        String source = !selectedHunks.isEmpty()
                ? "hunk-selection"
                : proposed != null && reviewed != null
                        && !proposed.get("sha256").equals(reviewed.get("sha256"))
                                ? "user-edited" : "agent-proposed";
        String identity = bounded(path, 2048) + "\0"
                + (proposed == null ? "" : proposed.get("sha256")) + "\0"
                + createdAt + "\0" + outcome;

        Map<String, Object> audit = new LinkedHashMap<String, Object>();
        audit.put("schema", SCHEMA);
        audit.put("reviewId", "drev_" + sha256(identity).substring(0, 24));
        audit.put("createdAt", createdAt);
        audit.put("actor", or(bounded(actor, 128), "local-user"));
        audit.put("host", or(bounded(host, 64), "ide"));
        audit.put("path", bounded(path, 2048));
        audit.put("sessionId", contextString(reviewContext, "sessionId", 256));
        audit.put("turnId", contextString(reviewContext, "turnId", 256));
        audit.put("toolUseId", contextString(reviewContext, "toolUseId", 256));
        audit.put("outcome", outcome);
        audit.put("source", source);
        audit.put("written", written);
        audit.put("followUpRequested", "changes-requested".equals(outcome));
        audit.put("baseline", fingerprintText(originalText));
        audit.put("proposed", proposed);
        audit.put("reviewed", reviewed);
        audit.put("final", fingerprintText(finalText));
        audit.put("selectedHunks", selectedHunks);
        audit.put("appliedHunks", positive(decision.get("appliedHunks")));
        audit.put("totalHunks", positive(decision.get("totalHunks")));
        audit.put("comments", normalizeComments(decision.get("comments")));
        audit.put("reason", emptyToNull(bounded(decision.get("reason"), 512)));
        return audit;
    }

    public static Map<String, Object> fingerprintText(String value) {
        if (value == null) return null;
        Map<String, Object> fingerprint = new LinkedHashMap<String, Object>();
        fingerprint.put("sha256", sha256(value));
        fingerprint.put("chars", value.length());
        fingerprint.put("lines", value.isEmpty() ? 0 : value.split("\\r?\\n", -1).length);
        return fingerprint;
    }

    public static List<Map<String, Object>> normalizeComments(Object values) {
        List<Map<String, Object>> comments = new ArrayList<Map<String, Object>>();
        if (!(values instanceof List)) return comments;
        for (Object raw : (List<?>) values) {
            if (comments.size() >= MAX_COMMENTS) break;
            if (!(raw instanceof Map)) continue;
            Map<?, ?> value = (Map<?, ?>) raw;
            String note = bounded(value.get("note"), 2000);
            if (note.isEmpty()) continue;
            Map<String, Object> comment = new LinkedHashMap<String, Object>();
            String lineText = bounded(value.get("lineText"), 1000);
            comment.put("line", positive(value.get("line")));
            comment.put("endLine", positive(value.get("endLine")));
            comment.put("lineFingerprint",
                    lineText.isEmpty() ? null : fingerprintText(lineText));
            comment.put("note", note);
            comments.add(comment);
        }
        return comments;
    }

    private static List<Integer> selectedHunks(Object values) {
        Set<Integer> unique = new LinkedHashSet<Integer>();
        if (values instanceof List) {
            for (Object value : (List<?>) values) {
                Integer number = positive(value);
                if (number != null) unique.add(number);
            }
        }
        List<Integer> selected = new ArrayList<Integer>(unique);
        Collections.sort(selected);
        if (selected.size() > MAX_HUNKS) {
            return new ArrayList<Integer>(selected.subList(0, MAX_HUNKS));
        }
        return selected;
    }

    private static Integer positive(Object value) {
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number)
                || number < 0
                || number > Integer.MAX_VALUE
                || number != Math.rint(number)) return null;
        return (int) number;
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) hex.append(String.format("%02x", b & 0xff));
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String bounded(Object value, int max) {
        String text = value == null ? "" : String.valueOf(value);
        return text.length() <= max ? text : text.substring(0, max);
    }

    private static String or(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static Object contextString(
            Map<?, ?> context, String key, int max) {
        if (context == null) return null;
        return emptyToNull(bounded(context.get(key), max));
    }

    private static Object emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }
}
