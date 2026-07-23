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

/** Shared-fixture and tool-wiring coverage for {@code cc-ide-context/v2}. */
@SuppressWarnings("unchecked")
class IdeContextV2Test {

    private static Path fixtureFile() {
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension",
                "../../packages/vscode-extension" }) {
            Path file = Paths.get(root, "src", "__fixtures__",
                    "ide-context-v2", "cases.json");
            if (Files.isRegularFile(file)) return file;
        }
        throw new AssertionError(
                "shared IDE context v2 fixture not found; cwd="
                        + Paths.get("").toAbsolutePath());
    }

    private static List<Map<String, Object>> cases() {
        try {
            return (List<Map<String, Object>>) (List<?>) MiniJson.parse(
                    Files.readString(fixtureFile(), StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new AssertionError("cannot read IDE context v2 fixture", error);
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
        List<String> roots = new ArrayList<String>();
        for (Object root : (List<Object>) input.get("workspaceRoots")) {
            roots.add(String.valueOf(root));
        }
        Number capturedAt = (Number) input.get("capturedAtMs");
        Map<String, Object> actual = IdeContextV2.build(
                roots,
                stringOrNull(input.get("documentUri")),
                (Number) input.get("documentVersion"),
                input.get("isDirty") instanceof Boolean
                        ? (Boolean) input.get("isDirty") : null,
                stringOrNull(input.get("permissionSource")),
                stringOrNull(input.get("freshnessState")),
                capturedAt.longValue());
        assertEquals(item.get("expected"), actual);
    }

    @Test
    void workspaceDigestIsOrderIndependentAndContentFree() {
        String a = IdeContextV2.workspaceId(
                List.of("C:\\private\\repo\\b", "C:\\private\\repo\\a"));
        String b = IdeContextV2.workspaceId(
                List.of("C:\\private\\repo\\a", "C:\\private\\repo\\b"));
        assertEquals(a, b);
        assertFalse(a.contains("private"));
        assertEquals(
                "ws-8a5edab282632443",
                IdeContextV2.workspaceId(List.of("/", "/")));
    }

    @Test
    void coreReadToolsAttachMetadataWhenFacadeSupportsIt() throws Exception {
        MetadataFacade facade = new MetadataFacade();
        List<Tool> tools = IdeTools.build(facade);
        Map<String, Object> selection = result(tools, "getSelection", null);
        Map<String, Object> active = result(tools, "getActiveFile", null);
        Map<String, Object> diagnostics = result(
                tools, "getDiagnostics",
                Map.of("path", "/workspace/a.java"));
        Map<String, Object> editors = result(
                tools, "getOpenEditors", null);
        for (Map<String, Object> result :
                List.of(selection, active, diagnostics, editors)) {
            Map<String, Object> context =
                    (Map<String, Object>) result.get("context");
            assertNotNull(context);
            assertEquals(IdeContextV2.SCHEMA, context.get("schema"));
            assertEquals("ws-c52ddf65534b7b46",
                    context.get("workspaceId"));
        }
        assertEquals(4, facade.contextCalls);
    }

    private static Map<String, Object> result(
            List<Tool> tools, String name, Map<String, Object> args)
            throws Exception {
        for (Tool tool : tools) {
            if (name.equals(tool.name())) {
                return (Map<String, Object>) tool.call(args);
            }
        }
        throw new AssertionError("tool not found: " + name);
    }

    private static String stringOrNull(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static final class MetadataFacade implements EditorFacade {
        int contextCalls;

        @Override
        public Map<String, Object> getContextMetadata(
                String file, String tool) {
            contextCalls++;
            return IdeContextV2.build(
                    List.of("/workspace"),
                    file == null ? null : "file:///workspace/a.java",
                    file == null ? null : Long.valueOf(9),
                    file == null ? null : Boolean.TRUE,
                    "jetbrains-project-policy",
                    file == null ? "live-host" : "live-buffer",
                    0);
        }

        @Override
        public Map<String, Object> getSelection() {
            return new java.util.LinkedHashMap<String, Object>(
                    Map.of("file", "/workspace/a.java", "text", "x"));
        }

        @Override
        public Map<String, Object> getActiveFile() {
            return new java.util.LinkedHashMap<String, Object>(
                    Map.of("file", "/workspace/a.java", "isDirty", true));
        }

        @Override
        public List<Map<String, Object>> getDiagnostics(String path) {
            return new ArrayList<Map<String, Object>>();
        }

        @Override
        public List<Map<String, Object>> getOpenEditors() {
            return new ArrayList<Map<String, Object>>();
        }

        @Override
        public Map<String, Object> openDiff(
                String path, String modifiedText,
                String originalText, String title) {
            return null;
        }
    }
}
