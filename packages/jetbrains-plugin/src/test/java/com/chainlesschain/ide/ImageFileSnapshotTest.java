package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ImageFileSnapshotTest {
    @TempDir Path directory;

    @Test void readsMultipleChunksAndRejectsNonregularOrOversizeFiles() throws Exception {
        byte[] bytes = new byte[150_000];
        new java.util.Random(7).nextBytes(bytes);
        Path path = directory.resolve("bytes.png"); Files.write(path, bytes);
        assertArrayEquals(bytes, ImageFileSnapshot.read(path, bytes.length));
        assertThrows(IOException.class, () -> ImageFileSnapshot.read(path, bytes.length - 1));
        assertThrows(IOException.class, () -> ImageFileSnapshot.read(directory, bytes.length));
    }

    @Test void rejectsGrowthAfterTheFirstChunkWithoutFollowingTheGrowingFile() throws Exception {
        Path path = directory.resolve("growing.png"); Files.write(path, new byte[150_000]);
        AtomicInteger checkpoints = new AtomicInteger();
        IOException failure = assertThrows(IOException.class, () -> ImageFileSnapshot.read(path, 150_000, () -> {
            if (checkpoints.incrementAndGet() == 4) {
                try { Files.write(path, new byte[80_000], StandardOpenOption.APPEND); }
                catch (IOException error) { throw new RuntimeException(error); }
            }
            return false;
        }, 5_000));
        assertTrue(failure.getMessage().contains("changed while reading"));
        Files.delete(path); // descriptor was closed even on a read rejection
    }

    @Test void rejectsSameSizeModificationAndCancellationBetweenChunks() throws Exception {
        Path path = directory.resolve("changing.png"); Files.write(path, new byte[150_000]);
        FileTime changed = FileTime.fromMillis(Files.getLastModifiedTime(path).toMillis() + 10_000);
        AtomicInteger checkpoints = new AtomicInteger();
        IOException mutation = assertThrows(IOException.class, () -> ImageFileSnapshot.read(path, 150_000, () -> {
            if (checkpoints.incrementAndGet() == 4) {
                try { Files.setLastModifiedTime(path, changed); }
                catch (IOException error) { throw new RuntimeException(error); }
            }
            return false;
        }, 5_000));
        assertTrue(mutation.getMessage().contains("changed while reading"));
        checkpoints.set(0);
        IOException cancelled = assertThrows(IOException.class, () -> ImageFileSnapshot.read(path, 150_000,
                () -> checkpoints.incrementAndGet() == 4, 5_000));
        assertTrue(cancelled.getMessage().contains("cancelled"));
        assertThrows(IOException.class, () -> ImageFileSnapshot.read(path, 150_000, () -> false, 0));
        Files.delete(path);
    }

    @Test void validatesTheSnapshotBytesEvenIfTheSourceChangesLater() throws Exception {
        byte[] png = java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgKfjwHwAEZAJsF63ZDAAAAABJRU5ErkJggg==");
        Path path = directory.resolve("one.png"); Files.write(path, png);
        byte[] snapshot = ImageFileSnapshot.read(path, (int) ImageAttachments.MAX_IMAGE_BYTES);
        Files.write(path, new byte[] {1, 2, 3});
        assertEquals(png.length, ImageAttachments.validateSnapshot(path, snapshot));
        assertThrows(IOException.class, () -> ImageAttachments.validateFile(path));
    }
}
