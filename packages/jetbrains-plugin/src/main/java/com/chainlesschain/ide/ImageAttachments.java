package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pure accept/cap logic for attaching images to the chat composer (paste and
 * drag-drop share it). Mirrors the VS Code panel: at most {@link #MAX} images
 * per message; dropped file lists are filtered to image extensions, non-images
 * are ignored rather than failing the drop.
 */
public final class ImageAttachments {

    private ImageAttachments() {}

    /** Attachment cap per message (matches the VS Code panel + paste path). */
    public static final int MAX = 4;

    private static final List<String> IMAGE_EXTENSIONS = List.of(
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp");

    /** Is this path an image by extension? (case-insensitive) */
    public static boolean isImagePath(String path) {
        if (path == null) return false;
        String p = path.toLowerCase(Locale.ROOT);
        for (String ext : IMAGE_EXTENSIONS) {
            if (p.endsWith(ext)) return true;
        }
        return false;
    }

    /**
     * Filter dropped paths to images and cap the total at {@link #MAX} counting
     * {@code alreadyAttached}. Order preserved; non-images dropped silently.
     */
    public static List<String> acceptDropped(List<String> paths, int alreadyAttached) {
        List<String> out = new ArrayList<String>();
        if (paths == null) return out;
        int room = MAX - Math.max(0, alreadyAttached);
        for (String p : paths) {
            if (out.size() >= room) break;
            if (isImagePath(p)) out.add(p);
        }
        return out;
    }
}
