package com.chainlesschain.ide;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Node/Java probes and offline-cache diagnosis for Installation Doctor. */
public final class RuntimeEnvironment {
    private static final Pattern VERSION =
            Pattern.compile("\\bv?(\\d+\\.\\d+\\.\\d+)\\b");
    private static final Pattern JAVA_QUOTED =
            Pattern.compile("\\bversion\\s+\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);
    private static final Pattern JAVA_OPEN =
            Pattern.compile("\\b(?:openjdk|java)\\s+([0-9][^\\s]*)",
                    Pattern.CASE_INSENSITIVE);

    private RuntimeEnvironment() {}

    public static final class Result {
        public final String nodeStatus;
        public final String nodeVersion;
        public final String minimumNodeVersion;
        public final String javaStatus;
        public final String javaVersion;
        public final String ideJavaVersion;
        public final String managedCliStatus;
        public final String managedCliVersion;
        public final String rollbackVersion;
        public final String pluginRegistryStatus;
        public final int pluginRegistryEntries;

        Result(String nodeStatus, String nodeVersion,
                String minimumNodeVersion, String javaStatus,
                String javaVersion, String ideJavaVersion,
                String managedCliStatus, String managedCliVersion,
                String rollbackVersion, String pluginRegistryStatus,
                int pluginRegistryEntries) {
            this.nodeStatus = nodeStatus;
            this.nodeVersion = nodeVersion;
            this.minimumNodeVersion = minimumNodeVersion;
            this.javaStatus = javaStatus;
            this.javaVersion = javaVersion;
            this.ideJavaVersion = ideJavaVersion;
            this.managedCliStatus = managedCliStatus;
            this.managedCliVersion = managedCliVersion;
            this.rollbackVersion = rollbackVersion;
            this.pluginRegistryStatus = pluginRegistryStatus;
            this.pluginRegistryEntries = pluginRegistryEntries;
        }
    }

    public static Result probe(File cwd) {
        String node = runVersion(Arrays.asList("node", "--version"), cwd, 5000);
        String java = runVersion(Arrays.asList("java", "-version"), cwd, 5000);
        return evaluate(
                node,
                java,
                System.getProperty("java.version"),
                ManagedCliRuntime.defaultRootDir(),
                defaultPluginRegistryCacheDir());
    }

    static Result evaluate(String nodeOutput, String javaOutput,
            String ideJavaVersion, String managedRoot,
            String registryCacheDir) {
        String nodeVersion = parseNodeVersion(nodeOutput);
        String nodeStatus = nodeVersion == null
                ? "missing"
                : CliVersionCheck.compare(
                        nodeVersion, ManagedCliRuntime.MIN_NODE_VERSION) >= 0
                                ? "ready" : "outdated";
        String javaVersion = parseJavaVersion(javaOutput);

        String managedStatus = "unconfigured";
        String managedVersion = null;
        String rollbackVersion = null;
        if (managedRoot != null && !managedRoot.isEmpty()) {
            Path statePath = Paths.get(managedRoot, ManagedCli.STATE_FILE);
            if (!Files.isRegularFile(statePath)) {
                managedStatus = "missing";
            } else {
                try {
                    Object parsed = MiniJson.parse(
                            Files.readString(statePath, StandardCharsets.UTF_8));
                    if (!(parsed instanceof Map)) {
                        managedStatus = "corrupt";
                    } else {
                        Map<?, ?> state = (Map<?, ?>) parsed;
                        managedVersion = string(state.get("version"));
                        rollbackVersion = string(state.get("previousVersion"));
                        if (managedVersion == null) {
                            managedStatus = "corrupt";
                        } else {
                            Path packageDir = Paths.get(
                                    managedRoot, managedVersion, "package");
                            managedStatus = Files.isDirectory(packageDir)
                                    ? "ready" : "incomplete";
                        }
                    }
                } catch (Throwable invalid) {
                    managedStatus = "corrupt";
                }
            }
        }

        int registryEntries = countRegularFiles(registryCacheDir);
        return new Result(
                nodeStatus,
                nodeVersion,
                ManagedCliRuntime.MIN_NODE_VERSION,
                javaVersion == null ? "missing" : "ready",
                javaVersion,
                truncate(ideJavaVersion, 64),
                managedStatus,
                managedVersion,
                rollbackVersion,
                registryEntries > 0 ? "ready" : "missing",
                registryEntries);
    }

    public static List<String> formatLines(Result result) {
        Result r = result != null
                ? result
                : new Result(
                        "unknown", null, ManagedCliRuntime.MIN_NODE_VERSION,
                        "unknown", null, null, "unknown", null, null,
                        "unknown", 0);
        List<String> out = new ArrayList<>();
        out.add("Node.js: " + value(r.nodeVersion)
                + " (minimum " + r.minimumNodeVersion + ") — "
                + r.nodeStatus);
        out.add("Java on PATH: " + value(r.javaVersion)
                + " — " + r.javaStatus);
        out.add("IDE Java runtime: " + value(r.ideJavaVersion));
        out.add("Managed CLI offline copy: " + r.managedCliStatus
                + (r.managedCliVersion == null
                        ? "" : " (" + r.managedCliVersion + ")")
                + (r.rollbackVersion == null
                        ? "" : "; rollback " + r.rollbackVersion));
        out.add("Plugin registry offline cache: " + r.pluginRegistryStatus
                + " (" + r.pluginRegistryEntries + " entries)");
        return out;
    }

    static String parseNodeVersion(String output) {
        Matcher match = VERSION.matcher(output == null ? "" : output);
        return match.find() ? match.group(1) : null;
    }

    static String parseJavaVersion(String output) {
        String text = output == null ? "" : output;
        Matcher quoted = JAVA_QUOTED.matcher(text);
        if (quoted.find()) return truncate(quoted.group(1), 64);
        Matcher open = JAVA_OPEN.matcher(text);
        return open.find() ? truncate(open.group(1), 64) : null;
    }

    private static String runVersion(
            List<String> command, File cwd, long timeoutMs) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            if (cwd != null) builder.directory(cwd);
            CliLauncher.augmentPath(builder);
            builder.redirectErrorStream(true);
            Process process = builder.start();
            StringBuffer output = new StringBuffer();
            Thread pump = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(
                                process.getInputStream(),
                                StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null
                            && output.length() < 8192) {
                        output.append(line).append('\n');
                    }
                } catch (Exception ignored) {
                    // best effort
                }
            }, "cc-runtime-environment-probe");
            pump.setDaemon(true);
            pump.start();
            boolean done = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!done) {
                process.destroyForcibly();
                return "";
            }
            pump.join(500);
            return process.exitValue() == 0 ? output.toString() : "";
        } catch (Exception unavailable) {
            return "";
        }
    }

    private static int countRegularFiles(String dir) {
        if (dir == null || dir.isEmpty()) return 0;
        int count = 0;
        try (DirectoryStream<Path> stream =
                     Files.newDirectoryStream(Paths.get(dir))) {
            for (Path entry : stream) {
                if (Files.isRegularFile(entry)) count++;
            }
        } catch (Exception unavailable) {
            return 0;
        }
        return count;
    }

    private static String defaultPluginRegistryCacheDir() {
        String home = System.getProperty("user.home", ".");
        String app = "chainlesschain-desktop-vue";
        if (File.separatorChar == '\\') {
            String appData = System.getenv("APPDATA");
            if (appData == null || appData.isEmpty()) {
                appData = Paths.get(home, "AppData", "Roaming").toString();
            }
            return Paths.get(appData, app, "plugin-registry-cache").toString();
        }
        if (System.getProperty("os.name", "")
                .toLowerCase().contains("mac")) {
            return Paths.get(home, "Library", "Application Support",
                    app, "plugin-registry-cache").toString();
        }
        String xdg = System.getenv("XDG_CONFIG_HOME");
        if (xdg == null || xdg.isEmpty()) {
            xdg = Paths.get(home, ".config").toString();
        }
        return Paths.get(xdg, app, "plugin-registry-cache").toString();
    }

    private static String string(Object value) {
        return value instanceof String
                && !((String) value).trim().isEmpty()
                        ? truncate((String) value, 64) : null;
    }

    private static String value(String value) {
        return value == null || value.isEmpty() ? "missing" : value;
    }

    private static String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }
}
