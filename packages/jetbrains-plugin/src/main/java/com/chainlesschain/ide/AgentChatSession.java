package com.chainlesschain.ide;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Long-lived {@code cc agent} duplex session powering the chat tool window —
 * the Java twin of the VS Code extension's {@code chat/agent-session.js}.
 *
 * Spawns ONE persistent child:
 * <pre>cc agent --input-format stream-json --output-format stream-json
 *           --include-partial-messages [extra args]</pre>
 * and speaks the CLI's SDK-style protocol over its pipes: stdin takes one
 * NDJSON event per line ({@code {"type":"user","text":"…"}}), stdout emits
 * NDJSON events (system/init, stream_event deltas, tool_use, result, …).
 *
 * The child should inherit CHAINLESSCHAIN_IDE_PORT/_TOKEN via
 * {@link Options#extraEnv}, so the agent auto-connects back to THIS IDE's
 * bridge — selection context, diagnostics feedback and openDiff reviews all
 * light up for free.
 *
 * Pure JDK (no IntelliJ imports) so it is smoke-testable headless; the
 * tool-window glue lives in {@code intellij/ChatToolWindowFactory}.
 */
public final class AgentChatSession {

    /** Listener for parsed NDJSON events ({@link MiniJson} maps). */
    public interface EventListener {
        void onEvent(Map<String, Object> event);
    }

    /** Listener for raw stderr lines (tool trace, logs). */
    public interface LineListener {
        void onLine(String line);
    }

    /** Listener for child exit. */
    public interface ExitListener {
        void onExit(int code);
    }

    public static final class Options {
        /** cc executable; null → resolve cc/chainlesschain/clc (skip a shadowed
         *  `cc`, e.g. the C compiler). Windows npm shims are .cmd → run via cmd.exe. */
        public String command = null;
        /** Extra CLI args appended after the protocol flags. */
        public List<String> extraArgs = new ArrayList<>();
        /** Working directory for the agent (project root). */
        public File cwd;
        /** Extra environment (put the bridge port/token here). */
        public Map<String, String> extraEnv = new LinkedHashMap<>();
        public EventListener onEvent;
        public LineListener onStderr;
        public ExitListener onExit;
        /** Test seam: full base command overriding command+protocol args. */
        public List<String> baseCommandOverride;
    }

    private final Options opts;
    private Process child;
    private BufferedWriter stdin;

    public AgentChatSession(Options opts) {
        this.opts = opts == null ? new Options() : opts;
    }

    /** The argv this session will spawn (exposed for tests/status). */
    public List<String> buildCommandLine() {
        if (opts.baseCommandOverride != null && !opts.baseCommandOverride.isEmpty()) {
            return new ArrayList<>(opts.baseCommandOverride);
        }
        List<String> cmd = new ArrayList<>();
        if (File.separatorChar == '\\') { // Windows: cc is an npm .cmd shim
            cmd.add("cmd.exe");
            cmd.add("/c");
        }
        cmd.add(opts.command == null || opts.command.isEmpty() ? resolveBinary() : opts.command);
        cmd.addAll(Arrays.asList(
                "agent",
                "--input-format", "stream-json",
                "--output-format", "stream-json",
                "--include-partial-messages"));
        if (opts.extraArgs != null) cmd.addAll(opts.extraArgs);
        return cmd;
    }

    public synchronized boolean isRunning() {
        return child != null && child.isAlive();
    }

    /**
     * One-shot, best-effort {@code cc <args…>} → captured stdout, for short
     * introspection commands (e.g. {@code cc context <id> --json}). Reuses the
     * same {@code cmd.exe /c cc} resolution as {@link #buildCommandLine()}.
     * Returns "" on timeout, non-zero exit, or any failure — callers treat a
     * blank result as "unavailable". Pure JDK; safe to call off the EDT.
     */
    public static String runCapture(List<String> args, File cwd, long timeoutMs) {
        return runCaptureWith(resolveBinary(), args, cwd, timeoutMs);
    }

    private static volatile String resolvedBinary = null;

    /**
     * Resolve the chainlesschain CLI binary, tolerating a {@code cc} that is
     * shadowed by another tool (classically the C compiler — {@code cc} is also
     * gcc/clang's name). The npm package installs {@code cc}, {@code chainlesschain},
     * {@code clc} and {@code clchain}; we try them in order and pick the first
     * whose {@code --version} prints a BARE chainlesschain version (a leading
     * semver line, not a compiler banner). Cached; probed off the EDT. Falls back
     * to {@code cc} if none resolve (the spawn then surfaces the real error).
     */
    public static String resolveBinary() {
        String r = resolvedBinary;
        if (r != null) return r;
        String picked = chooseBinary(cand -> runCaptureWith(
                cand, java.util.Collections.singletonList("--version"), null, 12000));
        if (picked != null) {
            resolvedBinary = picked;
            return picked;
        }
        // All candidates failed (CLI not installed yet). Do NOT cache the
        // fallback: the user may install the CLI mid-session, and a cached miss
        // would keep this IDE session broken until restart.
        return "cc";
    }

    /** Pure candidate selection: first binary whose {@code --version} output
     *  looks like the chainlesschain CLI, or null when none do. Exposed for
     *  tests (the probe is injected). */
    static String chooseBinary(java.util.function.Function<String, String> versionOf) {
        for (String cand : new String[] { "cc", "chainlesschain", "clc", "clchain" }) {
            if (looksLikeCcVersion(versionOf.apply(cand))) return cand;
        }
        return null;
    }

    /** True when {@code --version} output's first non-blank line is a bare semver
     *  (chainlesschain prints "0.162.95"), distinguishing it from a {@code cc}
     *  that is really a C compiler ("cc (GCC) 12.2.0", "Apple clang …"). */
    public static boolean looksLikeCcVersion(String out) {
        if (out == null) return false;
        for (String line : out.split("\n")) {
            String t = line.trim();
            if (t.isEmpty()) continue;
            return t.matches("v?\\d+\\.\\d+\\.\\d+.*");
        }
        return false;
    }

    /** {@code <binary> <args…>} → captured stdout, or "" on failure/timeout. */
    private static String runCaptureWith(String binary, List<String> args, File cwd, long timeoutMs) {
        List<String> cmd = new ArrayList<>();
        if (File.separatorChar == '\\') {
            cmd.add("cmd.exe");
            cmd.add("/c");
        }
        cmd.add(binary);
        if (args != null) cmd.addAll(args);
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            if (cwd != null) pb.directory(cwd);
            CliLauncher.augmentPath(pb); // find cc even when the IDE PATH lacks npm-global
            pb.redirectErrorStream(false);
            Process p = pb.start();
            StringBuilder out = new StringBuilder();
            Thread pump = new Thread(() -> {
                try (BufferedReader r = new BufferedReader(
                        new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) out.append(line).append('\n');
                } catch (IOException ignored) {
                    // child closed / killed — return what we have
                }
            }, "cc-capture-pump");
            pump.setDaemon(true);
            pump.start();
            // Drain stderr too: the CLI logs warnings there (0.162.150+), and a
            // child blocked writing to a full, unread stderr pipe never exits —
            // every capture would then eat its full timeout and return "".
            Thread errDrain = new Thread(() -> {
                try (InputStream err = p.getErrorStream()) {
                    byte[] buf = new byte[8192];
                    while (err.read(buf) != -1) {
                        // discard — we only need the pipe kept empty
                    }
                } catch (IOException ignored) {
                    // child closed / killed
                }
            }, "cc-capture-stderr-drain");
            errDrain.setDaemon(true);
            errDrain.start();
            boolean done = p.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS);
            if (!done) {
                p.destroyForcibly();
                return "";
            }
            pump.join(500);
            return p.exitValue() == 0 ? out.toString() : "";
        } catch (IOException | InterruptedException e) {
            return "";
        }
    }

    /** Spawn the child and start the stdout/stderr pumps. Idempotent. */
    public synchronized void start() throws IOException {
        if (isRunning()) return;
        ProcessBuilder pb = new ProcessBuilder(buildCommandLine());
        if (opts.cwd != null) pb.directory(opts.cwd);
        CliLauncher.augmentPath(pb); // find cc even when the IDE PATH lacks npm-global
        if (opts.extraEnv != null) pb.environment().putAll(opts.extraEnv);
        final Process proc = pb.start();
        child = proc;
        stdin = new BufferedWriter(
                new OutputStreamWriter(proc.getOutputStream(), StandardCharsets.UTF_8));
        pump("cc-chat-stdout", proc.getInputStream(), new LineListener() {
            @Override
            public void onLine(String line) {
                emit(parseEventLine(line));
            }
        });
        pump("cc-chat-stderr", proc.getErrorStream(), new LineListener() {
            @Override
            public void onLine(String line) {
                if (opts.onStderr != null) {
                    try {
                        opts.onStderr.onLine(line);
                    } catch (Throwable ignored) {
                        // listener errors must not kill the pump
                    }
                }
            }
        });
        Thread waiter = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    int code = proc.waitFor();
                    synchronized (AgentChatSession.this) {
                        if (child == proc) child = null;
                    }
                    if (opts.onExit != null) opts.onExit.onExit(code);
                } catch (Throwable ignored) {
                    // never let the waiter crash the host
                }
            }
        }, "cc-chat-waiter");
        waiter.setDaemon(true);
        waiter.start();
    }

    /** Non-JSON stdout is surfaced as a {@code raw} event, mirroring VS Code. */
    static Map<String, Object> parseEventLine(String line) {
        try {
            Object parsed = MiniJson.parse(line);
            if (parsed instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> m = (Map<String, Object>) parsed;
                return m;
            }
        } catch (RuntimeException ignored) {
            // fall through to raw
        }
        Map<String, Object> raw = MiniJson.obj();
        raw.put("type", "raw");
        raw.put("text", line);
        return raw;
    }

    private void emit(Map<String, Object> evt) {
        if (opts.onEvent != null && evt != null) {
            try {
                opts.onEvent.onEvent(evt);
            } catch (Throwable ignored) {
                // listener errors must not kill the pump
            }
        }
    }

    /** One reader thread per stream; EOF/teardown races must not throw. */
    private void pump(String name, InputStream in, final LineListener onLine) {
        final BufferedReader reader =
                new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        String trimmed = line.trim();
                        if (!trimmed.isEmpty()) onLine.onLine(trimmed);
                    }
                } catch (Throwable ignored) {
                    // stream closed mid-read on stop() — expected, never crash
                }
            }
        }, name);
        t.setDaemon(true);
        t.start();
    }

    /** Send one raw NDJSON event (user turn / interrupt / approval / …). */
    public synchronized boolean sendEvent(Map<String, Object> event) {
        if (!isRunning() || stdin == null || event == null) return false;
        try {
            stdin.write(MiniJson.stringify(event));
            stdin.write("\n");
            stdin.flush();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** Send one user turn. Returns false when the session is not running. */
    public boolean send(String text) {
        return send(text, null);
    }

    /**
     * Send a user turn with optional pasted image file paths (vision). The CLI's
     * stream protocol takes file PATHS in `images` (same pipeline as
     * {@code cc agent --image}); it switches to the vision model automatically
     * when images are present. An image-only turn is valid.
     */
    public boolean send(String text, java.util.List<String> images) {
        Map<String, Object> evt = userEvent(text, images);
        return evt != null && sendEvent(evt);
    }

    /** Build a {@code user} turn event (text + optional image paths), or null
     *  when there's nothing to send. Pure — exported for tests. */
    public static Map<String, Object> userEvent(String text, java.util.List<String> images) {
        boolean hasText = text != null && !text.trim().isEmpty();
        boolean hasImg = images != null && !images.isEmpty();
        if (!hasText && !hasImg) return null;
        Map<String, Object> evt = MiniJson.obj();
        evt.put("type", "user");
        evt.put("text", hasText ? text : "Please look at the attached image(s).");
        if (hasImg) evt.put("images", new java.util.ArrayList<Object>(images));
        return evt;
    }

    /** Interrupt the in-flight turn (CLI keeps the session alive). */
    public boolean interrupt() {
        Map<String, Object> evt = MiniJson.obj();
        evt.put("type", "interrupt");
        return sendEvent(evt);
    }

    /**
     * Manual `/compact` (Claude-Code IDE parity): ask the CLI to trim its live
     * conversation history between turns. The CLI answers with a `compaction`
     * event; the conversation stays alive.
     */
    public boolean compact() {
        Map<String, Object> evt = MiniJson.obj();
        evt.put("type", "compact");
        return sendEvent(evt);
    }

    /** End the conversation gracefully (close stdin → CLI exits cleanly). */
    public synchronized void end() {
        try {
            if (stdin != null) stdin.close();
        } catch (IOException ignored) {
            // already closing
        }
    }

    /**
     * Hard stop — kills the child AND its descendants. On Windows the spawn is
     * {@code cmd.exe /c cc …} (npm .cmd shim), so {@code destroy()} alone only
     * ends cmd.exe and orphans the real node agent mid-turn (it keeps running
     * the current tool, burning tokens and holding its SQLite lock) — the same
     * grandchild-orphan trap PreviewService.stop() fixed. Close stdin first so
     * a healthy child gets a graceful EOF, then reap the whole tree.
     */
    public synchronized void stop() {
        Process p = child;
        child = null;
        try {
            if (stdin != null) stdin.close();
        } catch (IOException ignored) {
            // already closing
        }
        stdin = null;
        if (p != null) {
            try {
                p.descendants().forEach(ProcessHandle::destroy);
            } catch (Throwable ignored) {
                // best-effort — fall through to destroy()
            }
            try {
                p.destroy();
            } catch (Throwable ignored) {
                // best-effort
            }
        }
    }
}
