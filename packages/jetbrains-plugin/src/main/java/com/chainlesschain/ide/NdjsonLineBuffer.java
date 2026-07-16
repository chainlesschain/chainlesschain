package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;

/**
 * Byte-level NDJSON line assembler: the carry between reads is kept as BYTES
 * and split on {@code '\n'} (0x0A) before decoding, so a multibyte UTF-8
 * character straddling a read boundary is never torn. Decoding each raw chunk
 * independently (the old {@code new String(buf, 0, n, UTF_8)} carry) turned a
 * split CJK character into U+FFFD and the JSON line failed to parse — the
 * reader then skipped it and timed out waiting for a reply that had already
 * arrived. Pure JDK, single-threaded (each reader owns one instance).
 */
public final class NdjsonLineBuffer {

    private byte[] data = new byte[0];

    /** Append the first {@code len} bytes of {@code chunk} to the carry. */
    public void feed(byte[] chunk, int len) {
        if (chunk == null || len <= 0) return;
        int n = Math.min(len, chunk.length);
        byte[] next = new byte[data.length + n];
        System.arraycopy(data, 0, next, 0, data.length);
        System.arraycopy(chunk, 0, next, data.length, n);
        data = next;
    }

    /**
     * Next complete line — decoded as UTF-8, CR stripped, trimmed — or null
     * when no full line is buffered yet (bytes stay carried for the next feed).
     */
    public String poll() {
        for (int i = 0; i < data.length; i++) {
            if (data[i] == (byte) '\n') {
                String line = new String(data, 0, i, StandardCharsets.UTF_8)
                        .replace("\r", "").trim();
                byte[] rest = new byte[data.length - i - 1];
                System.arraycopy(data, i + 1, rest, 0, rest.length);
                data = rest;
                return line;
            }
        }
        return null;
    }

    /** Bytes buffered without a terminating newline yet (diagnostics/tests). */
    public int pendingBytes() {
        return data.length;
    }
}
