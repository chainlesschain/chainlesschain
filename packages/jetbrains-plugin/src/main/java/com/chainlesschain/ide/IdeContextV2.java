package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Versioned, content-free metadata envelope for IDE context reads.
 *
 * <p>Java twin of the VS Code ide-context-v2.js implementation. Workspace
 * paths are reduced to a stable digest, and both sides consume one fixture.
 */
public final class IdeContextV2 {
    public static final String SCHEMA = "cc-ide-context/v2";

    private static final DateTimeFormatter TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSX")
                    .withZone(ZoneOffset.UTC);

    private IdeContextV2() {}

    public static String normalizeWorkspaceRoot(String root) {
        String normalized = root == null ? "" : root.trim().replace('\\', '/');
        if ("/".equals(normalized)) return normalized;
        if (normalized.matches("^[A-Za-z]:/+$")) {
            return normalized.substring(0, 2) + "/";
        }
        while (normalized.endsWith("/") && !normalized.isEmpty()) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public static String workspaceId(List<String> workspaceRoots) {
        List<String> roots = new ArrayList<String>();
        if (workspaceRoots != null) {
            for (String root : workspaceRoots) {
                String normalized = normalizeWorkspaceRoot(root);
                if (!normalized.isEmpty() && !roots.contains(normalized)) {
                    roots.add(normalized);
                }
            }
        }
        if (roots.isEmpty()) return null;
        Collections.sort(roots);
        String canonical = String.join("\n", roots);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    canonical.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                hex.append(String.format("%02x", digest[i] & 0xff));
            }
            return "ws-" + hex;
        } catch (Exception impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    public static Map<String, Object> build(
            List<String> workspaceRoots,
            String documentUri,
            Number documentVersion,
            Boolean isDirty,
            String permissionSource,
            String freshnessState,
            long capturedAtMs) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("schema", SCHEMA);
        out.put("workspaceId", workspaceId(workspaceRoots));
        out.put("documentUri",
                documentUri == null || documentUri.isEmpty()
                        ? null : documentUri);
        out.put("documentVersion", documentVersion);
        out.put("isDirty", isDirty);
        out.put("permissionSource",
                boundedOr(permissionSource, "host-policy", 96));
        Map<String, Object> freshness =
                new LinkedHashMap<String, Object>();
        freshness.put("state",
                boundedOr(freshnessState, "live-host", 48));
        freshness.put("capturedAt",
                TIMESTAMP.format(Instant.ofEpochMilli(capturedAtMs)));
        out.put("freshness", freshness);
        return out;
    }

    private static String boundedOr(String value, String fallback, int max) {
        String clean = value == null ? "" : value.trim();
        if (clean.isEmpty()) clean = fallback;
        return clean.length() <= max ? clean : clean.substring(0, max);
    }
}
