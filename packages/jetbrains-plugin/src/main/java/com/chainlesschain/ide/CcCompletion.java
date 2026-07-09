package com.chainlesschain.ide;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Inline code-completion (ghost-text) backend glue for the JetBrains provider.
 *
 * <p>The request-building and response-parsing are pure JDK (no IntelliJ SDK, no
 * Kotlin) so they are unit-testable with plain JUnit; {@link #fetch} is the thin
 * process spawn that pipes the request to {@code cc complete --json} on stdin and
 * returns the completion text. It mirrors the VS Code {@code completion.js}
 * design and shares the same {@code cc complete} backend, so both IDEs honour the
 * user's configured LLM with no new auth.
 *
 * <p>Everything fails quiet: a spawn error, timeout, non-zero exit, or malformed
 * reply yields {@code ""} (no suggestion) rather than a thrown error, because a
 * backend hiccup must never surface as an editor popup.
 */
public final class CcCompletion {

    private CcCompletion() {}

    /** Hard cap so a runaway model can't flood the editor with a whole file. */
    public static final int MAX_COMPLETION_CHARS = 2000;

    /**
     * Build the stdin JSON body {@code cc complete --json} consumes:
     * {@code {"prefix":…,"suffix":…,"language":…}}. Null fields become empty
     * strings so the CLI always sees well-formed input.
     */
    public static String buildRequestJson(String prefix, String suffix, String language) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("prefix", prefix == null ? "" : prefix);
        req.put("suffix", suffix == null ? "" : suffix);
        req.put("language", language == null ? "" : language);
        return MiniJson.stringify(req);
    }

    /**
     * Read the {@code completion} field from {@code cc complete --json} stdout;
     * returns {@code ""} for any bad shape (not JSON, missing/non-string field).
     */
    public static String parseCompletion(String stdout) {
        try {
            Map<String, Object> data = MiniJson.parseObject(stdout == null ? "" : stdout);
            Object c = data == null ? null : data.get("completion");
            return c instanceof String ? (String) c : "";
        } catch (RuntimeException e) {
            return "";
        }
    }

    /**
     * Defensive clean of the completion text: strip an accidental markdown fence,
     * drop any echoed {@code <CURSOR>} sentinel, hard-cap the length, and trim
     * trailing whitespace (leading indentation is meaningful). The CLI already
     * cleans, so this only guards against a future/alternate backend — matching
     * {@code complete.js}'s {@code cleanCompletion} contract.
     */
    public static String cleanCompletion(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        String s = raw;
        // A model that ignored "no fences" wraps the code in ```lang … ```.
        s = s.replaceFirst("^\\s*```[^\\n]*\\n?", "");
        s = s.replaceFirst("\\n?```\\s*$", "");
        s = s.replace("<CURSOR>", "");
        if (s.length() > MAX_COMPLETION_CHARS) s = s.substring(0, MAX_COMPLETION_CHARS);
        // Trim trailing whitespace only.
        return s.replaceFirst("\\s+$", "");
    }

    /**
     * Spawn {@code cc complete --json}, pipe {@code {prefix,suffix,language}} on
     * stdin, and return the cleaned completion string. Never throws — returns
     * {@code ""} on any failure. Blocking + off-EDT: callers run it on a
     * background dispatcher.
     *
     * @param prefix    code before the caret
     * @param suffix    code after the caret
     * @param language  editor language id (informational; the CLI FIM prompt uses it)
     * @param cwd       working directory for the spawn (project root), or null
     * @param timeoutMs kill the child after this many ms and return ""
     */
    public static String fetch(String prefix, String suffix, String language,
                               java.io.File cwd, long timeoutMs) {
        if ((prefix == null || prefix.isEmpty()) && (suffix == null || suffix.isEmpty())) {
            return "";
        }
        List<String> cmd = new ArrayList<>();
        if (java.io.File.separatorChar == '\\') { // Windows: cc is an npm .cmd shim
            cmd.add("cmd.exe");
            cmd.add("/c");
        }
        cmd.add(AgentChatSession.resolveBinary());
        cmd.add("complete");
        cmd.add("--json");

        String body = buildRequestJson(prefix, suffix, language);
        Process p = null;
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            if (cwd != null) pb.directory(cwd);
            CliLauncher.augmentPath(pb); // find cc even when the IDE PATH lacks npm-global
            pb.redirectErrorStream(false);
            p = pb.start();

            // Write the request, then close stdin so the CLI's readStdin resolves.
            try (OutputStream stdin = p.getOutputStream()) {
                stdin.write(body.getBytes(StandardCharsets.UTF_8));
                stdin.flush();
            } catch (IOException ignored) {
                // child died before we finished writing — capture/exit handles it
            }

            StringBuffer out = new StringBuffer();
            Process proc = p;
            Thread pump = new Thread(() -> {
                try (BufferedReader r = new BufferedReader(
                        new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) out.append(line).append('\n');
                } catch (IOException ignored) {
                    // child closed / killed — return what we have
                }
            }, "cc-complete-pump");
            pump.setDaemon(true);
            pump.start();
            // Keep stderr drained so a chatty child can't block on a full pipe.
            Thread errDrain = new Thread(() -> {
                try (InputStream err = proc.getErrorStream()) {
                    byte[] buf = new byte[8192];
                    while (err.read(buf) != -1) {
                        // discard
                    }
                } catch (IOException ignored) {
                    // child closed / killed
                }
            }, "cc-complete-stderr-drain");
            errDrain.setDaemon(true);
            errDrain.start();

            boolean done = p.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!done) {
                p.destroyForcibly();
                return "";
            }
            pump.join(500);
            if (p.exitValue() != 0) return "";
            return cleanCompletion(parseCompletion(out.toString()));
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return "";
        } finally {
            if (p != null && p.isAlive()) p.destroyForcibly();
        }
    }
}
