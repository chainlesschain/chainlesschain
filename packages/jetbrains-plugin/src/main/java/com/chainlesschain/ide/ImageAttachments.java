package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

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
    public static final long MAX_IMAGE_BYTES = 20L * 1024 * 1024;
    public static final long MAX_TURN_BYTES = MAX_IMAGE_BYTES;
    public static final long MAX_PIXELS = 40_000_000L;

    private static final List<String> IMAGE_EXTENSIONS = List.of(
            ".png", ".jpg", ".jpeg", ".gif", ".webp");

    public static void validateDimensions(long width, long height) throws IOException {
        if (width <= 0 || height <= 0 || width > MAX_PIXELS / height) {
            throw new IOException("Image dimensions exceed 40 megapixels or are invalid");
        }
    }

    /** Inspect bounded headers without allocating a decoded pixel buffer. */
    public static long validateFile(Path file) throws IOException {
        long bytes = Files.size(file);
        if (bytes <= 0 || bytes > MAX_IMAGE_BYTES) throw new IOException("Image must be at most 20 MiB and nonempty");
        byte[] header;
        try (InputStream stream = Files.newInputStream(file)) {
            header = stream.readNBytes((int) Math.min(bytes, 1024 * 1024));
        }
        ByteBuffer b = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
        String format = null;
        long width = 0, height = 0;
        if (header.length >= 24 && b.getInt(0) == 0x474e5089 && b.getInt(4) == 0x0a1a0a0d && ascii(header, 12, 4).equals("IHDR")) {
            format = "png";
            b.order(ByteOrder.BIG_ENDIAN);
            width = Integer.toUnsignedLong(b.getInt(16));
            height = Integer.toUnsignedLong(b.getInt(20));
        } else if (header.length >= 10 && (ascii(header, 0, 6).equals("GIF87a") || ascii(header, 0, 6).equals("GIF89a"))) {
            format = "gif";
            width = Short.toUnsignedInt(b.getShort(6)); height = Short.toUnsignedInt(b.getShort(8));
        } else if (header.length >= 30 && ascii(header, 0, 4).equals("RIFF") && ascii(header, 8, 4).equals("WEBP")) {
            format = "webp";
            String chunk = ascii(header, 12, 4);
            if (chunk.equals("VP8X")) {
                width = 1 + (b.getInt(24) & 0xffffff); height = 1 + ((b.getInt(26) >>> 8) & 0xffffff);
            } else if (chunk.equals("VP8L") && header[20] == 47) {
                int bits = b.getInt(21); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
            } else if (chunk.equals("VP8 ") && Byte.toUnsignedInt(header[23]) == 157 && header[24] == 1 && header[25] == 42) {
                width = b.getShort(26) & 16383; height = b.getShort(28) & 16383;
            }
        } else if (header.length >= 4 && Byte.toUnsignedInt(header[0]) == 255 && Byte.toUnsignedInt(header[1]) == 216) {
            b.order(ByteOrder.BIG_ENDIAN);
            int offset = 2;
            while (offset + 4 <= header.length && Byte.toUnsignedInt(header[offset++]) == 255) {
                while (offset < header.length && Byte.toUnsignedInt(header[offset]) == 255) offset++;
                if (offset >= header.length) break;
                int marker = Byte.toUnsignedInt(header[offset++]);
                if (marker == 217 || marker == 218) break;
                if (marker == 1 || (marker >= 208 && marker <= 215)) continue;
                if (offset + 2 > header.length) break;
                int length = Short.toUnsignedInt(b.getShort(offset));
                if (length < 2 || offset + length > header.length) break;
                if (List.of(192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207).contains(marker) && length >= 8) {
                    format = "jpeg";
                    height = Short.toUnsignedInt(b.getShort(offset + 3)); width = Short.toUnsignedInt(b.getShort(offset + 5)); break;
                }
                offset += length;
            }
        }
        if (format == null) throw new IOException("Unsupported image header (inspect limit: 1 MiB)");
        String name = file.toString().toLowerCase(Locale.ROOT);
        if (!(name.endsWith("." + format) || (format.equals("jpeg") && name.endsWith(".jpg")))) throw new IOException("File extension does not match the image format");
        validateDimensions(width, height);
        return bytes;
    }

    private static String ascii(byte[] data, int offset, int length) {
        return new String(data, offset, length, StandardCharsets.US_ASCII);
    }

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
