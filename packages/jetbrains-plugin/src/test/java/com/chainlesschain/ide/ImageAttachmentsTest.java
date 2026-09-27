package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link ImageAttachments} layer. */
class ImageAttachmentsTest {

    @org.junit.jupiter.api.io.TempDir
    java.nio.file.Path temp;

    @Test
    void checksRealHeadersAndRejectsSpoofedExtension() throws Exception {
        byte[] png = java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        java.nio.file.Path file = temp.resolve("one.png");
        java.nio.file.Files.write(file, png);
        assertEquals(png.length, ImageAttachments.validateFile(file));
        java.nio.file.Path disguised = temp.resolve("one.jpg");
        java.nio.file.Files.write(disguised, png);
        assertThrows(java.io.IOException.class, () -> ImageAttachments.validateFile(disguised));
    }

    @Test
    void rejectsOversizeBeforeReadingAndRejectsPixelBomb() throws Exception {
        java.nio.file.Path file = temp.resolve("large.png");
        try (java.io.RandomAccessFile sparse = new java.io.RandomAccessFile(file.toFile(), "rw")) {
            sparse.setLength(ImageAttachments.MAX_IMAGE_BYTES + 1);
        }
        assertThrows(java.io.IOException.class, () -> ImageAttachments.validateFile(file));
        assertThrows(java.io.IOException.class, () -> ImageAttachments.validateDimensions(100000, 100000));
        assertThrows(java.io.IOException.class, () -> ImageAttachments.validateDimensions(-1, 1));
        ImageAttachments.validateDimensions(8000, 5000);
    }

    @Test
    void acceptsWebpDimensionsAndRejectsTruncatedHeaders() throws Exception {
        byte[] webp = new byte[30];
        System.arraycopy("RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, webp, 0, 4);
        System.arraycopy("WEBPVP8X".getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, webp, 8, 8);
        webp[24] = 1; webp[27] = 1;
        java.nio.file.Path file = temp.resolve("two.webp");
        java.nio.file.Files.write(file, webp);
        assertEquals(30, ImageAttachments.validateFile(file));
        java.nio.file.Files.write(file, new byte[]{1, 2});
        assertThrows(java.io.IOException.class, () -> ImageAttachments.validateFile(file));
    }

    @Test
    void isImagePathAcceptsImageExtensionsCaseInsensitively() {
        assertTrue(ImageAttachments.isImagePath("a/shot.PNG"));
        assertTrue(ImageAttachments.isImagePath("b.webp"));
    }

    @Test
    void isImagePathRejectsNonImagesAndNull() {
        assertFalse(ImageAttachments.isImagePath("notes.txt"));
        assertFalse(ImageAttachments.isImagePath(null));
    }

    @Test
    void acceptDroppedCapsAtMaxAndPreservesOrder() {
        List<String> dropped = Arrays.asList("a.png", "doc.pdf", "b.jpg", "c.gif", "d.bmp", "e.png");
        List<String> accepted = ImageAttachments.acceptDropped(dropped, 0);
        assertEquals(4, accepted.size());
        assertEquals("a.png", accepted.get(0));
    }

    @Test
    void acceptDroppedRespectsAlreadyAttachedRoom() {
        List<String> dropped = Arrays.asList("a.png", "doc.pdf", "b.jpg", "c.gif", "d.bmp", "e.png");
        assertEquals(1, ImageAttachments.acceptDropped(dropped, 3).size());
        assertTrue(ImageAttachments.acceptDropped(dropped, 4).isEmpty());
    }

    @Test
    void acceptDroppedHandlesNullListAndFiltersNonImages() {
        assertTrue(ImageAttachments.acceptDropped(null, 0).isEmpty());
        assertTrue(ImageAttachments.acceptDropped(Arrays.asList("x.txt"), 0).isEmpty());
    }
}
