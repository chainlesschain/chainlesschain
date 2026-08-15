package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure-JDK normalization for context sources discovered outside the IDE SDK.
 * MCP resources deliberately remain catalog metadata: callers must use the
 * separately governed read-resource tool before any resource body is loaded.
 */
public final class ContextExternalSources {
    public static final int MAX_MCP_RESOURCES = 20;

    private ContextExternalSources() {}

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> parseMcpResources(
            String json, String capturedAt) {
        Object value;
        try {
            value = MiniJson.parse(json == null ? "" : json);
        } catch (RuntimeException error) {
            return List.of();
        }
        if (!(value instanceof List)) return List.of();
        List<?> resources = (List<?>) value;
        List<Map<String, Object>> candidates = new ArrayList<Map<String, Object>>();
        int limit = Math.min(resources.size(), MAX_MCP_RESOURCES);
        for (int index = 0; index < limit; index++) {
            Object item = resources.get(index);
            if (!(item instanceof Map)) continue;
            Map<String, Object> resource = (Map<String, Object>) item;
            String uri = bounded(resource.get("uri"), 512);
            String server = bounded(resource.get("server"), 128);
            if (uri.isEmpty() || server.isEmpty()) continue;
            String nameValue = bounded(resource.get("name"), 160);
            String descriptionValue = bounded(resource.get("description"), 512);
            String mimeTypeValue = bounded(resource.get("mimeType"), 128);
            String name = nameValue.isEmpty() ? null : nameValue;
            String description = descriptionValue.isEmpty()
                    ? null : descriptionValue;
            String mimeType = mimeTypeValue.isEmpty() ? null : mimeTypeValue;

            Map<String, Object> metadata = new LinkedHashMap<String, Object>();
            metadata.put("server", server);
            metadata.put("uri", uri);
            metadata.put("name", name);
            metadata.put("description", description);
            metadata.put("mimeType", mimeType);

            Map<String, Object> freshness = new LinkedHashMap<String, Object>();
            freshness.put("state", "connected-catalog");
            freshness.put("capturedAt",
                    capturedAt == null ? null : bounded(capturedAt, 64));

            Map<String, Object> candidate = new LinkedHashMap<String, Object>();
            candidate.put("kind", "mcp-resource");
            candidate.put("label", "MCP resource: " + (name == null ? uri : name));
            candidate.put("source", "mcp:" + server);
            candidate.put("identity", uri);
            candidate.put("content", MiniJson.stringify(metadata));
            candidate.put("range", null);
            candidate.put("freshness", freshness);
            candidate.put("autoReason",
                    "resource advertised by a connected MCP server");
            candidate.put("refreshable", Boolean.TRUE);
            candidates.add(candidate);
        }
        candidates.sort(Comparator
                .comparing((Map<String, Object> candidate) ->
                        String.valueOf(candidate.get("source")))
                .thenComparing(candidate ->
                        String.valueOf(candidate.get("identity"))));
        return candidates;
    }

    private static String bounded(Object value, int limit) {
        if (value == null) return "";
        String text = String.valueOf(value).trim();
        return text.length() <= limit ? text : text.substring(0, limit);
    }
}
