package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Shared-fixture coverage for metadata-only Context Center sources. */
@SuppressWarnings("unchecked")
class ContextExternalSourcesTest {

    private static Path fixtureFile() {
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension",
                "../../packages/vscode-extension" }) {
            Path file = Paths.get(root, "src", "__fixtures__",
                    "context-center", "external-sources.json");
            if (Files.isRegularFile(file)) return file;
        }
        throw new AssertionError("shared external-sources fixture not found");
    }

    @Test
    void normalizesMcpResourceMetadataWithoutReadingBodies() throws IOException {
        Map<String, Object> fixture = MiniJson.parseObject(
                Files.readString(fixtureFile(), StandardCharsets.UTF_8));
        List<Map<String, Object>> actual =
                ContextExternalSources.parseMcpResources(
                        MiniJson.stringify(fixture.get("input")),
                        String.valueOf(fixture.get("capturedAt")));
        assertEquals(fixture.get("expected"), actual);
    }

    @Test
    void invalidCatalogFailsClosed() {
        assertEquals(List.of(),
                ContextExternalSources.parseMcpResources("not-json", null));
        assertEquals(List.of(),
                ContextExternalSources.parseMcpResources("{}", null));
    }
}
