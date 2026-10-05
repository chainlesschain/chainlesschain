package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Map;

/** Explicit operator-only raw protocol capture. Disabled in ordinary IDE launches. */
public final class Verify01ProtocolCapture implements AgentChatSession.EventListener {
    public static final String ROOT_PROPERTY = "chainlesschain.verify01.captureRoot";
    private final Path root;
    private Path output;
    private FileChannel file;
    private String generation;
    private long sequence;
    private long bytes;
    private boolean failed;
    private boolean exited;

    private Verify01ProtocolCapture(Path root) { this.root = root; }

    public static Verify01ProtocolCapture configured(String workspace) throws IOException {
        String value = System.getProperty(ROOT_PROPERTY, "");
        return value.isBlank() ? null : open(Path.of(value), workspace == null ? null : Path.of(workspace));
    }

    static Verify01ProtocolCapture open(Path directory, Path workspace) throws IOException {
        if (!directory.isAbsolute()) throw new IOException("VERIFY01 capture directory must be absolute");
        Path normalized = directory.normalize();
        for (Path current = normalized; current != null; current = current.getParent()) {
            if (Files.isSymbolicLink(current)) throw new IOException("VERIFY01 capture directory traverses a link");
        }
        Path root = normalized.toRealPath();
        if (!Files.isDirectory(root) || (workspace != null && root.startsWith(workspace.toRealPath()))) {
            throw new IOException("VERIFY01 capture directory must exist outside the task workspace");
        }
        return new Verify01ProtocolCapture(root);
    }

    @Override public synchronized void onEvent(Map<String, Object> record) {
        if (failed) return; // Never resume a capture after a dropped write.
        try {
            String nextGeneration = String.valueOf(record.get("generation"));
            Object number = record.get("sequence");
            if (exited || !nextGeneration.matches("[a-f0-9-]{36}") || !(number instanceof Number)
                    || ((Number) number).longValue() != sequence + 1) {
                throw new IOException("VERIFY01 protocol generation/sequence is invalid");
            }
            if (generation == null) {
                generation = nextGeneration;
                output = root.resolve("protocol-" + generation + ".jsonl");
                file = FileChannel.open(output, StandardOpenOption.CREATE_NEW,
                        StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
            } else if (!generation.equals(nextGeneration)) {
                throw new IOException("VERIFY01 protocol generation changed");
            }
            byte[] body = (MiniJson.stringify(record) + "\n").getBytes(StandardCharsets.UTF_8);
            if (bytes + body.length > 16 * 1024 * 1024) throw new IOException("VERIFY01 protocol exceeds 16 MiB");
            // Keep the exclusive descriptor: pathname replacement cannot redirect writes.
            ByteBuffer buffer = ByteBuffer.wrap(body);
            while (buffer.hasRemaining()) file.write(buffer);
            file.force(true);
            bytes += body.length;
            sequence++;
            if ("exit".equals(record.get("direction"))) { file.close(); exited = true; }
        } catch (IOException | RuntimeException error) {
            failed = true;
            if (file != null) try { file.close(); } catch (IOException ignored) { }
            try {
                Files.writeString(root.resolve("capture-error-" + java.util.UUID.randomUUID() + ".json"),
                        MiniJson.stringify(Map.of("at", java.time.Instant.now().toString(),
                                "error", "raw protocol write failed", "lastCompleteSequence", sequence)),
                        StandardOpenOption.CREATE_NEW);
            } catch (IOException ignored) { /* Directory loss also leaves incomplete raw evidence. */ }
            // AgentChatSession intentionally isolates observer failures. A truncated
            // capture cannot provide the required final drained exit to the importer.
            throw new IllegalStateException("VERIFY01 raw protocol capture failed", error);
        }
    }
}
