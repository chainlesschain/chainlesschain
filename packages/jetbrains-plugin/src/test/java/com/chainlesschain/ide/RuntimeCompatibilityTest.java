package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

/** Cross-host parity tests driven by the VS Code-owned shared JSON fixture. */
@SuppressWarnings("unchecked")
class RuntimeCompatibilityTest {

    private static Path fixtureFile() {
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension",
                "../../packages/vscode-extension" }) {
            Path file = Paths.get(root, "src", "__fixtures__",
                    "runtime-compatibility", "cases.json");
            if (Files.isRegularFile(file)) return file;
        }
        throw new AssertionError(
                "shared runtime compatibility fixture not found; cwd="
                        + Paths.get("").toAbsolutePath());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> cases() {
        try {
            return (List<Map<String, Object>>) (List<?>) MiniJson.parse(
                    Files.readString(fixtureFile(), StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new AssertionError(
                    "cannot read runtime compatibility fixture", error);
        }
    }

    @Test
    void fixtureRepresentsAllUserFacingOutcomes() {
        List<String> statuses = new ArrayList<String>();
        for (Map<String, Object> item : cases()) {
            Map<String, Object> expected =
                    (Map<String, Object>) item.get("expected");
            statuses.add(String.valueOf(expected.get("status")));
        }
        assertTrue(statuses.contains(RuntimeCompatibility.STATUS_READY));
        assertTrue(statuses.contains(RuntimeCompatibility.STATUS_DEGRADED));
        assertTrue(statuses.contains(RuntimeCompatibility.STATUS_REPAIR));
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

    @SuppressWarnings("unchecked")
    private static void assertCase(Map<String, Object> item) {
        Map<String, Object> input = (Map<String, Object>) item.get("input");
        Map<String, Object> expected =
                (Map<String, Object>) item.get("expected");
        Boolean trusted = input.get("workspaceTrusted") instanceof Boolean
                ? (Boolean) input.get("workspaceTrusted") : null;
        RuntimeCompatibility.Result result = RuntimeCompatibility.evaluate(
                stringOrNull(input.get("cliVersionText")),
                stringOrNull(input.get("minimumCliVersion")),
                ((Number) input.get("bridgePort")).intValue(),
                trusted);
        assertEquals(expected.get("status"), result.status);
        assertEquals(expected.get("cliVersion"), result.cliVersion);
        if (expected.containsKey("minimumCliVersion")) {
            assertEquals(
                    expected.get("minimumCliVersion"),
                    result.minimumCliVersion);
        }
        assertEquals(expected.get("reasons"), result.reasons);
        assertTrue(result.summary.contains(result.label));
    }

    private static String stringOrNull(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
