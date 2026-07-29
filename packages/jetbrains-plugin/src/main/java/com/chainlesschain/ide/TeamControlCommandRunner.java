package com.chainlesschain.ide;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Shell-free, bounded-output process runner for {@link TeamControl}.
 *
 * <p>Every CLI token is a separate {@link ProcessBuilder} argument. No command
 * string is interpreted by a shell, so state paths, task keys and human
 * reasons cannot inject additional commands.
 */
public final class TeamControlCommandRunner {
    private static final int MAX_STREAM_CHARS = 64 * 1024;
    private static final Pattern MANAGED_WINDOWS_SHIM = Pattern.compile(
            "(?i)\\A@ECHO OFF\\r?\\nnode \"([^\"\\r\\n]+)\" %\\*\\r?\\n?\\z");

    private TeamControlCommandRunner() {}

    /**
     * Resolve the configured CLI to a shell-free executable prefix.
     *
     * <p>On Windows npm exposes {@code cc.cmd}/{@code cc.ps1}; invoking either
     * would require a command shell. Instead, locate the fixed
     * {@code node_modules/chainlesschain/bin/chainlesschain.js} sibling and
     * execute it with {@code node.exe}. The plugin-managed shim is accepted
     * only in its exact generated one-line format; no shell text is evaluated.
     */
    public static List<String> resolveCommand(String binary) throws IOException {
        if (binary == null || binary.trim().isEmpty()) {
            throw new IOException("ChainlessChain CLI executable is unavailable");
        }
        if (File.separatorChar != '\\') {
            return Collections.singletonList(binary);
        }
        String requested = unquoteWindowsPath(binary.trim());
        Path resolved = resolveWindowsPath(requested);
        if (resolved == null) {
            throw new IOException(
                    "Could not resolve a shell-free ChainlessChain CLI executable");
        }
        String lower = resolved.getFileName().toString().toLowerCase(Locale.ROOT);
        if (lower.endsWith(".exe")) {
            return Collections.singletonList(resolved.toString());
        }
        if (lower.endsWith(".js")) {
            Path node = findOnWindowsPath("node", ".exe");
            if (node == null) throw new IOException("node.exe is unavailable");
            return List.of(node.toString(), resolved.toString());
        }
        List<String> managed = managedNodeCommand(resolved);
        return managed != null ? managed : npmNodeCommand(resolved);
    }

    public static TeamControl.CliResult run(String binary, List<String> args,
            File cwd, long timeoutMs) throws IOException, InterruptedException {
        return run(Collections.singletonList(binary), args, cwd, timeoutMs);
    }

    public static TeamControl.CliResult run(List<String> executablePrefix,
            List<String> args, File cwd, long timeoutMs)
            throws IOException, InterruptedException {
        if (executablePrefix == null || executablePrefix.isEmpty()) {
            throw new IOException("ChainlessChain CLI executable is unavailable");
        }
        List<String> command = new ArrayList<String>();
        for (String executablePart : executablePrefix) {
            if (executablePart == null || executablePart.trim().isEmpty()) {
                throw new IOException("ChainlessChain CLI executable is unavailable");
            }
            command.add(executablePart);
        }
        if (args != null) command.addAll(args);

        ProcessBuilder builder = new ProcessBuilder(command);
        if (cwd != null) builder.directory(cwd);
        builder.redirectErrorStream(false);
        CliLauncher.augmentPath(builder);
        Process process = builder.start();
        BoundedText stdout = new BoundedText();
        BoundedText stderr = new BoundedText();
        Thread outPump = pump("cc-team-control-stdout", process.getInputStream(), stdout);
        Thread errPump = pump("cc-team-control-stderr", process.getErrorStream(), stderr);
        boolean complete;
        try {
            complete = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            AgentChatSession.destroyTreeForcibly(process);
            Thread.currentThread().interrupt();
            throw interrupted;
        }
        if (!complete) {
            AgentChatSession.destroyTreeForcibly(process);
            process.waitFor(2, TimeUnit.SECONDS);
            join(outPump);
            join(errPump);
            return new TeamControl.CliResult(
                    null, stdout.text(), stderr.text(), true, null);
        }
        join(outPump);
        join(errPump);
        return new TeamControl.CliResult(
                Integer.valueOf(process.exitValue()), stdout.text(), stderr.text(),
                false, null);
    }

    static List<String> npmNodeCommand(Path shim) throws IOException {
        Path absolute = shim.toAbsolutePath().normalize();
        Path bin = absolute.getParent();
        if (bin == null) throw new IOException("Invalid npm CLI shim path");
        Path script = bin.resolve("node_modules")
                .resolve("chainlesschain")
                .resolve("bin")
                .resolve("chainlesschain.js");
        if (!Files.isRegularFile(script)) {
            throw new IOException(
                    "The npm ChainlessChain CLI script was not found beside its shim");
        }
        Path node = bin.resolve("node.exe");
        if (!Files.isRegularFile(node)) node = findOnWindowsPath("node", ".exe");
        if (node == null) throw new IOException("node.exe is unavailable");
        return List.of(node.toString(), script.toString());
    }

    static List<String> managedNodeCommand(Path shim) throws IOException {
        if (shim == null || !Files.isRegularFile(shim)) return null;
        long size = Files.size(shim);
        if (size <= 0 || size > 4_096) return null;
        String content = Files.readString(shim, StandardCharsets.UTF_8);
        java.util.regex.Matcher matcher = MANAGED_WINDOWS_SHIM.matcher(content);
        if (!matcher.matches()) return null;
        Path entry;
        try {
            entry = Paths.get(matcher.group(1)).toAbsolutePath().normalize();
        } catch (RuntimeException invalidPath) {
            return null;
        }
        if (!Files.isRegularFile(entry)) return null;
        Path parent = shim.toAbsolutePath().normalize().getParent();
        Path node = parent == null ? null : parent.resolve("node.exe");
        if (node == null || !Files.isRegularFile(node)) {
            node = findOnWindowsPath("node", ".exe");
        }
        if (node == null) throw new IOException("node.exe is unavailable");
        return List.of(node.toString(), entry.toString());
    }

    private static String unquoteWindowsPath(String value) {
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")
                && value.substring(1, value.length() - 1).indexOf('"') < 0) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private static Path resolveWindowsPath(String binary) {
        try {
            Path requested = Paths.get(binary);
            if (requested.isAbsolute() || binary.indexOf('\\') >= 0
                    || binary.indexOf('/') >= 0) {
                if (Files.isRegularFile(requested)) return requested;
                if (requested.getFileName() != null
                        && requested.getFileName().toString().indexOf('.') < 0) {
                    Path exe = Paths.get(binary + ".exe");
                    if (Files.isRegularFile(exe)) return exe;
                    Path cmd = Paths.get(binary + ".cmd");
                    if (Files.isRegularFile(cmd)) return cmd;
                }
                return null;
            }
            for (String extension : new String[] { ".exe", ".cmd", ".bat", ".ps1", "" }) {
                Path found = findOnWindowsPath(binary, extension);
                if (found != null) return found;
            }
            return null;
        } catch (RuntimeException invalidPath) {
            return null;
        }
    }

    private static Path findOnWindowsPath(String name, String extension) {
        ProcessBuilder environmentSource = new ProcessBuilder("cc-path-probe");
        CliLauncher.augmentPath(environmentSource);
        Map<String, String> environment = environmentSource.environment();
        String value = null;
        for (Map.Entry<String, String> entry : environment.entrySet()) {
            if ("PATH".equalsIgnoreCase(entry.getKey())) {
                value = entry.getValue();
                break;
            }
        }
        if (value == null) return null;
        for (String directory : value.split(Pattern.quote(File.pathSeparator), -1)) {
            if (directory.isEmpty()) continue;
            try {
                Path candidate = Paths.get(directory).resolve(name + extension);
                if (Files.isRegularFile(candidate)) {
                    return candidate.toAbsolutePath().normalize();
                }
            } catch (RuntimeException ignored) {
                // Ignore a malformed PATH entry and continue with the next one.
            }
        }
        return null;
    }

    private static Thread pump(String name, InputStream input, BoundedText output) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(input, StandardCharsets.UTF_8))) {
                char[] buffer = new char[4096];
                int count;
                while ((count = reader.read(buffer)) != -1) output.append(buffer, count);
            } catch (IOException ignored) {
                // The process exited or was killed; retain the bounded text read so far.
            }
        }, name);
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private static void join(Thread thread) throws InterruptedException {
        thread.join(1_000L);
    }

    private static final class BoundedText {
        private final StringBuilder value = new StringBuilder();
        private boolean truncated;

        synchronized void append(char[] chars, int count) {
            int remaining = MAX_STREAM_CHARS - value.length();
            if (remaining <= 0) {
                truncated = true;
                return;
            }
            int accepted = Math.min(remaining, count);
            value.append(chars, 0, accepted);
            if (accepted < count) truncated = true;
        }

        synchronized String text() {
            return value.toString() + (truncated ? "\n[output truncated]" : "");
        }
    }
}
