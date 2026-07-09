package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link ImageAttachments} layer. */
class ImageAttachmentsTest {

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
