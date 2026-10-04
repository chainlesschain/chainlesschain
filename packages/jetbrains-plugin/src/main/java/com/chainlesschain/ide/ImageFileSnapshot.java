package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Arrays;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/** Same-descriptor bounded snapshots. Deadlines are checked between file I/O
 * operations; they do not claim to interrupt a stalled filesystem syscall. */
public final class ImageFileSnapshot {
    private ImageFileSnapshot() {}

    public static byte[] read(Path path, int limit) throws IOException {
        return read(path, limit, () -> Thread.currentThread().isInterrupted(), 5_000L);
    }

    public static byte[] read(Path path, int limit, BooleanSupplier cancelled, long timeoutMs)
            throws IOException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        check(cancelled, deadline);
        BasicFileAttributes before = attributes(path);
        if (!before.isRegularFile() || before.size() <= 0 || before.size() > limit)
            throw new IOException("Saved draft or attachment is invalid or too large");
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            check(cancelled, deadline);
            if (channel.size() != before.size() || !same(before, attributes(path)))
                throw new IOException("Saved file changed while opening");
            ByteBuffer buffer = ByteBuffer.allocate((int) before.size() + 1);
            while (buffer.hasRemaining()) {
                check(cancelled, deadline);
                int end = buffer.limit();
                buffer.limit(Math.min(end, buffer.position() + 64 * 1024));
                int count = channel.read(buffer);
                buffer.limit(end);
                check(cancelled, deadline);
                if (count == -1) break;
            }
            if (buffer.position() != before.size() || channel.size() != before.size()
                    || !same(before, attributes(path)))
                throw new IOException("Saved file changed while reading");
            check(cancelled, deadline);
            return Arrays.copyOf(buffer.array(), buffer.position());
        }
    }

    private static BasicFileAttributes attributes(Path path) throws IOException {
        return Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    }

    private static boolean same(BasicFileAttributes left, BasicFileAttributes right) {
        return right.isRegularFile() && left.size() == right.size()
                && Objects.equals(left.fileKey(), right.fileKey())
                && left.lastModifiedTime().equals(right.lastModifiedTime())
                && left.creationTime().equals(right.creationTime());
    }

    private static void check(BooleanSupplier cancelled, long deadline) throws IOException {
        if (cancelled.getAsBoolean()) throw new IOException("Image reading cancelled");
        if (System.nanoTime() >= deadline) throw new IOException("Image reading exceeded the time budget");
    }
}
