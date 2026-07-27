package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Pure evaluation coverage for Doctor runtime/cache diagnostics. */
final class RuntimeEnvironmentTest {
    @TempDir Path temp;

    @Test
    void parsesNodeAndJavaVersions() {
        assertEquals("22.12.0",
                RuntimeEnvironment.parseNodeVersion("v22.12.0"));
        assertEquals("21.0.3",
                RuntimeEnvironment.parseJavaVersion(
                        "openjdk version \"21.0.3\" 2024-04-16 LTS"));
        assertEquals("17.0.11",
                RuntimeEnvironment.parseJavaVersion(
                        "java 17.0.11 2024-04-16"));
    }

    @Test
    void evaluatesRuntimesAndOfflineCaches() throws Exception {
        Path managed = temp.resolve("managed");
        Path packageDir = managed.resolve("0.200.0").resolve("package");
        Files.createDirectories(packageDir);
        Files.writeString(managed.resolve("current.json"),
                "{\"version\":\"0.200.0\","
                        + "\"previousVersion\":\"0.199.0\"}",
                StandardCharsets.UTF_8);
        Path registry = temp.resolve("registry");
        Files.createDirectories(registry);
        Files.writeString(registry.resolve("a.json"), "{}");
        Files.writeString(registry.resolve("b.json"), "{}");

        RuntimeEnvironment.Result result = RuntimeEnvironment.evaluate(
                "v22.12.0",
                "openjdk version \"21.0.3\"",
                "21.0.3",
                managed.toString(),
                registry.toString());
        assertEquals("ready", result.nodeStatus);
        assertEquals("ready", result.javaStatus);
        assertEquals("ready", result.managedCliStatus);
        assertEquals("0.200.0", result.managedCliVersion);
        assertEquals("0.199.0", result.rollbackVersion);
        assertEquals(2, result.pluginRegistryEntries);
        List<String> lines = RuntimeEnvironment.formatLines(result);
        assertTrue(String.join("\n", lines)
                .contains("Managed CLI offline copy: ready (0.200.0)"));
    }

    @Test
    void distinguishesOutdatedMissingAndCorrupt() throws Exception {
        Path managed = temp.resolve("bad-managed");
        Files.createDirectories(managed);
        Files.writeString(managed.resolve("current.json"), "{");
        RuntimeEnvironment.Result result = RuntimeEnvironment.evaluate(
                "v18.0.0",
                "",
                "21.0.3",
                managed.toString(),
                temp.resolve("missing-registry").toString());
        assertEquals("outdated", result.nodeStatus);
        assertEquals("missing", result.javaStatus);
        assertEquals("corrupt", result.managedCliStatus);
        assertEquals("missing", result.pluginRegistryStatus);
    }
}
