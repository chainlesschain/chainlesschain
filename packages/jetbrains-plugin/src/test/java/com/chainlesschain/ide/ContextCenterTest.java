package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Shared-fixture coverage for {@code cc-context-center/v1}. */
@SuppressWarnings("unchecked")
class ContextCenterTest {

    private static Path fixtureFile() {
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension",
                "../../packages/vscode-extension" }) {
            Path file = Paths.get(root, "src", "__fixtures__",
                    "context-center", "cases.json");
            if (Files.isRegularFile(file)) return file;
        }
        throw new AssertionError("shared Context Center fixture not found");
    }

    private static List<Map<String, Object>> cases() {
        try {
            return (List<Map<String, Object>>) (List<?>) MiniJson.parse(
                    Files.readString(fixtureFile(), StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new AssertionError("cannot read Context Center fixture", error);
        }
    }

    @TestFactory
    Iterable<DynamicTest> sharedTwinCases() {
        List<DynamicTest> tests = new ArrayList<DynamicTest>();
        for (Map<String, Object> item : cases()) {
            tests.add(DynamicTest.dynamicTest(
                    String.valueOf(item.get("name")),
                    () -> assertCase(item)));
        }
        return tests;
    }

    private static void assertCase(Map<String, Object> item) {
        Map<String, Object> input = (Map<String, Object>) item.get("input");
        Map<String, Object> actual = ContextCenter.build(
                stringOrNull(input.get("workspaceId")),
                (List<Map<String, Object>>) (List<?>) input.get("candidates"),
                ((Number) input.get("tokenBudget")).intValue(),
                strings(input.get("pinnedIds")),
                strings(input.get("removedIds")),
                strings(input.get("refreshedIds")));
        assertEquals(item.get("expected"), actual);
    }

    @Test
    void generatedIdsAreStableAndContentFree() {
        Map<String, Object> candidate = Map.of(
                "kind", "selection",
                "source", "ide.selection",
                "identity", "/private/repo/a.java:1-2",
                "content", "x");
        Map<String, Object> result = ContextCenter.build(
                null, List.of(candidate), 4,
                List.of(), List.of(), List.of());
        String id = String.valueOf(
                ((Map<?, ?>) ((List<?>) result.get("chips")).get(0)).get("id"));
        assertNotNull(id);
        assertFalse(id.contains("private"));
        assertEquals(20, id.length());
    }

    @Test
    void preferencesAreNormalizedAndUpdated() {
        Map<String, Object> raw = new java.util.LinkedHashMap<String, Object>();
        raw.put("tokenBudget", Long.valueOf(12));
        raw.put("pinnedIds", List.of(
                "ctx_aaaaaaaaaaaaaaaa", "ctx_bbbbbbbbbbbbbbbb", "bad"));
        raw.put("removedIds", List.of("ctx_aaaaaaaaaaaaaaaa"));
        Map<String, Object> normalized = ContextCenter.normalizePreferences(raw);
        assertEquals(Long.valueOf(12), normalized.get("tokenBudget"));
        assertEquals(List.of("ctx_bbbbbbbbbbbbbbbb"), normalized.get("pinnedIds"));
        assertEquals(List.of("ctx_aaaaaaaaaaaaaaaa"), normalized.get("removedIds"));

        Map<String, Object> restored = ContextCenter.updatePreferences(
                normalized, "restore", "ctx_aaaaaaaaaaaaaaaa");
        assertEquals(List.of(), restored.get("removedIds"));
        Map<String, Object> removed = ContextCenter.updatePreferences(
                restored, "remove", "ctx_bbbbbbbbbbbbbbbb");
        assertEquals(List.of(), removed.get("pinnedIds"));
        assertEquals(List.of("ctx_bbbbbbbbbbbbbbbb"), removed.get("removedIds"));
    }

    @Test
    void ideToolProjectsHostCandidates() throws Exception {
        Map<String, Object> fixtureInput =
                (Map<String, Object>) cases().get(0).get("input");
        List<Map<String, Object>> fixtureCandidates =
                (List<Map<String, Object>>) (List<?>) fixtureInput.get("candidates");
        EditorFacade facade = new EditorFacade() {
            @Override public boolean supportsContextCenter() { return true; }
            @Override public List<Map<String, Object>> getContextCandidates() {
                return fixtureCandidates;
            }
            @Override public Map<String, Object> getContextCenterPreferences() {
                return Map.of(
                        "tokenBudget", Long.valueOf(3),
                        "pinnedIds", List.of("ctx_bbbbbbbbbbbbbbbb"),
                        "removedIds", List.of("ctx_aaaaaaaaaaaaaaaa"));
            }
            @Override public Map<String, Object> getContextMetadata(
                    String file, String tool) {
                return Map.of("workspaceId", "ws-c52ddf65534b7b46");
            }
            @Override public Map<String, Object> getSelection() { return null; }
            @Override public List<Map<String, Object>> getDiagnostics(String path) {
                return List.of();
            }
            @Override public List<Map<String, Object>> getOpenEditors() {
                return List.of();
            }
            @Override public Map<String, Object> openDiff(
                    String path, String modifiedText,
                    String originalText, String title) {
                return null;
            }
        };
        Tool tool = null;
        for (Tool candidate : IdeTools.build(facade)) {
            if ("getContextCenter".equals(candidate.name())) tool = candidate;
        }
        assertNotNull(tool);
        Map<String, Object> preferred =
                (Map<String, Object>) tool.call(Map.of());
        assertEquals(Long.valueOf(3),
                ((Map<?, ?>) preferred.get("budget")).get("limitTokens"));
        assertEquals(Boolean.TRUE,
                ((Map<?, ?>) ((List<?>) preferred.get("chips")).get(0)).get("pinned"));
        Map<?, ?> removedByPreference = null;
        for (Object item : (List<?>) preferred.get("chips")) {
            Map<?, ?> chip = (Map<?, ?>) item;
            if ("ctx_aaaaaaaaaaaaaaaa".equals(chip.get("id"))) {
                removedByPreference = chip;
            }
        }
        assertNotNull(removedByPreference);
        assertEquals("removed", removedByPreference.get("status"));

        Map<String, Object> args = new java.util.LinkedHashMap<String, Object>();
        args.put("budgetTokens", Long.valueOf(6));
        args.put("pinnedIds", List.of("ctx_bbbbbbbbbbbbbbbb"));
        args.put("removedIds", List.of("ctx_dddddddddddddddd"));
        Map<String, Object> result = (Map<String, Object>) tool.call(args);
        assertEquals(ContextCenter.SCHEMA, result.get("schema"));
        assertEquals(Long.valueOf(6),
                ((Map<?, ?>) result.get("budget")).get("allocatedTokens"));
        assertEquals(Boolean.TRUE,
                ((Map<?, ?>) ((List<?>) result.get("chips")).get(0)).get("pinned"));
    }

    private static List<String> strings(Object value) {
        List<String> out = new ArrayList<String>();
        if (!(value instanceof List)) return out;
        for (Object item : (List<?>) value) out.add(String.valueOf(item));
        return out;
    }

    private static String stringOrNull(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
