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
        /** cc executable; Windows npm shims are .cmd → run through cmd.exe. */
        public String command = "cc";
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
        cmd.add(opts.command == null || opts.command.isEmpty() ? "cc" : opts.command);
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

    /** Spawn the child and start the stdout/stderr pumps. Idempotent. */
    public synchronized void start() throws IOException {
        if (isRunning()) return;
        ProcessBuilder pb = new ProcessBuilder(buildCommandLine());
        if (opts.cwd != null) pb.directory(opts.cwd);
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
        if (text == null || text.trim().isEmpty()) return false;
        Map<String, Object> evt = MiniJson.obj();
        evt.put("type", "user");
        evt.put("text", text);
        return sendEvent(evt);
    }

    /** Interrupt the in-flight turn (CLI keeps the session alive). */
    public boolean interrupt() {
        Map<String, Object> evt = MiniJson.obj();
        evt.put("type", "interrupt");
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

    /** Hard stop. */
    public synchronized void stop() {
        Process p = child;
        child = null;
        if (p != null) {
            try {
                p.destroy();
            } catch (Throwable ignored) {
                // best-effort
            }
        }
    }
}
