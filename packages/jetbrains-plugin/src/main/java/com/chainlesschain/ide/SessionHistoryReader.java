package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** Bounded, cancellable read-only CLI capture; never uses the Agent stdin protocol. */
public final class SessionHistoryReader {
    private SessionHistoryReader() {}
    public static final class CursorExpired extends IOException {
        public CursorExpired() { super("Saved history changed; reload the latest page"); }
    }
    static final class CaptureFailure extends IOException {
        final String stdout;
        CaptureFailure(int exit, String stdout, String stderr) {
            super("Saved history unavailable (CLI exit " + exit + "): " + stderr.substring(0, Math.min(500, stderr.length())));
            this.stdout = stdout;
        }
    }

    public static SessionTranscriptPage read(String sessionId, String cursor, File cwd,
            BooleanSupplier cancelled) throws IOException, InterruptedException {
        List<String> args = SessionTranscriptPage.arguments(sessionId, cursor);
        if (cancelled.getAsBoolean()) throw new IOException("History read cancelled");
        List<String> command = AgentChatSession.buildCaptureCommand(
                AgentChatSession.resolveBinary(), args, File.separatorChar == '\\');
        return SessionTranscriptPage.parse(capture(command, cwd, 35_000, cancelled), sessionId, cursor);
    }

    public static SessionTranscriptChanges readChanges(String sessionId, String cursor, File cwd,
            BooleanSupplier cancelled) throws IOException, InterruptedException {
        List<String> args = SessionTranscriptChanges.arguments(sessionId, cursor);
        if (cancelled.getAsBoolean()) throw new IOException("History read cancelled");
        List<String> command = AgentChatSession.buildCaptureCommand(
                AgentChatSession.resolveBinary(), args, File.separatorChar == '\\');
        return readChanges(command, sessionId, cursor, cwd, cancelled);
    }

    static SessionTranscriptChanges readChanges(List<String> command, String sessionId, String cursor, File cwd,
            BooleanSupplier cancelled) throws IOException, InterruptedException {
        try { return SessionTranscriptChanges.parse(capture(command, cwd, 35_000, cancelled), sessionId, cursor); }
        catch (CaptureFailure failure) {
            boolean stale = false;
            try {
                java.util.Map<String, Object> error = MiniJson.parseObject(failure.stdout);
                stale = "chainlesschain.session-transcript-changes-error/v1".equals(error.get("schema"))
                        && sessionId.equals(error.get("sessionId")) && "SESSION_TRANSCRIPT_CURSOR_STALE".equals(error.get("code"));
            } catch (RuntimeException ignored) { /* Other errors never silently discard the sync cursor. */ }
            if (stale) throw new CursorExpired();
            throw failure;
        }
    }

    static String capture(List<String> command, File cwd, long timeoutMs,
            BooleanSupplier cancelled) throws IOException, InterruptedException {
        if (command.isEmpty() || cancelled.getAsBoolean()) throw new IOException("History read cancelled or command unavailable");
        ProcessBuilder builder = new ProcessBuilder(command);
        if (cwd != null) builder.directory(cwd);
        CliLauncher.augmentPath(builder);
        Process process = builder.start();
        ProcessTreeTermination termination = new ProcessTreeTermination(process);
        AtomicReference<IOException> failure = new AtomicReference<>();
        CompletableFuture<byte[]> stdout = pump(process.getInputStream(), SessionTranscriptPage.MAX_RESPONSE_BYTES, true, failure);
        CompletableFuture<byte[]> stderr = pump(process.getErrorStream(), 16 * 1024, false, failure);
        boolean complete = false;
        try {
            process.getOutputStream().close();
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
            while (process.isAlive() || !stdout.isDone() || !stderr.isDone()) {
                if (failure.get() != null) throw failure.get();
                if (cancelled.getAsBoolean()) throw new IOException("History read cancelled");
                if (System.nanoTime() >= deadline) throw new IOException("History read timed out");
                Thread.sleep(20);
            }
            if (failure.get() != null) throw failure.get();
            if (cancelled.getAsBoolean()) throw new IOException("History read cancelled");
            String output = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(stdout.join())).toString();
            if (process.exitValue() != 0) {
                String detail = new String(stderr.join(), StandardCharsets.UTF_8).strip();
                throw new CaptureFailure(process.exitValue(), output, detail);
            }
            complete = true;
            return output;
        } finally {
            boolean interrupted = Thread.interrupted();
            try {
                if (!complete) termination.await(0, 1500);
            } finally {
                try { process.getInputStream().close(); } catch (IOException ignored) { }
                try { process.getErrorStream().close(); } catch (IOException ignored) { }
                if (interrupted) Thread.currentThread().interrupt();
            }
        }
    }

    private static CompletableFuture<byte[]> pump(InputStream input, int limit, boolean failOnLimit,
            AtomicReference<IOException> failure) {
        CompletableFuture<byte[]> done = new CompletableFuture<>();
        Thread thread = new Thread(() -> {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (input) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    int remaining = limit - output.size();
                    output.write(buffer, 0, Math.min(remaining, read));
                    if (read > remaining && failOnLimit) {
                        failure.compareAndSet(null, new IOException("History response exceeds 2 MiB"));
                        break;
                    }
                }
            } catch (IOException error) { failure.compareAndSet(null, error); }
            done.complete(output.toByteArray());
        }, "cc-history-capture");
        thread.setDaemon(true);
        thread.start();
        return done;
    }
}
