package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@link NdjsonLineBuffer} — the byte-level line assembler behind the
 * background-session pipe reader. The killer case: a multibyte UTF-8 char
 * straddling a read boundary must decode intact (the old per-chunk String
 * decode produced U+FFFD and tore the JSON line).
 */
final class NdjsonLineBufferTest {

    private static void feedAll(NdjsonLineBuffer b, byte[] bytes, int chunkSize) {
        for (int off = 0; off < bytes.length; off += chunkSize) {
            int len = Math.min(chunkSize, bytes.length - off);
            b.feed(Arrays.copyOfRange(bytes, off, off + len), len);
        }
    }

    @Test
    void multibyteCharSplitAcrossFeedsDecodesIntact() {
        String line = "{\"text\":\"会话已恢复——继续\"}";
        byte[] bytes = (line + "\n").getBytes(StandardCharsets.UTF_8);
        // Every possible split point, including mid-CJK-char boundaries.
        for (int split = 1; split < bytes.length; split++) {
            NdjsonLineBuffer b = new NdjsonLineBuffer();
            b.feed(Arrays.copyOfRange(bytes, 0, split), split);
            byte[] rest = Arrays.copyOfRange(bytes, split, bytes.length);
            b.feed(rest, rest.length);
            assertEquals(line, b.poll(), "split at byte " + split);
            assertFalse(b.poll() != null, "no phantom second line");
        }
    }

    @Test
    void oneByteChunksStillYieldWholeLines() {
        String a = "{\"type\":\"hello\"}";
        String b = "{\"msg\":\"许可请求 №2\"}";
        NdjsonLineBuffer buf = new NdjsonLineBuffer();
        feedAll(buf, (a + "\n" + b + "\n").getBytes(StandardCharsets.UTF_8), 1);
        assertEquals(a, buf.poll());
        assertEquals(b, buf.poll());
        assertNull(buf.poll());
    }

    @Test
    void multipleLinesInOneChunk() {
        NdjsonLineBuffer b = new NdjsonLineBuffer();
        byte[] bytes = "one\ntwo\nthree".getBytes(StandardCharsets.UTF_8);
        b.feed(bytes, bytes.length);
        assertEquals("one", b.poll());
        assertEquals("two", b.poll());
        assertNull(b.poll(), "trailing partial line stays buffered");
        assertEquals(5, b.pendingBytes());
        byte[] end = "\n".getBytes(StandardCharsets.UTF_8);
        b.feed(end, end.length);
        assertEquals("three", b.poll());
    }

    @Test
    void crlfAndSurroundingWhitespaceAreStripped() {
        NdjsonLineBuffer b = new NdjsonLineBuffer();
        byte[] bytes = "  {\"a\":1}\r\n".getBytes(StandardCharsets.UTF_8);
        b.feed(bytes, bytes.length);
        assertEquals("{\"a\":1}", b.poll());
    }

    @Test
    void emptyAndNullFeedsAreTolerated() {
        NdjsonLineBuffer b = new NdjsonLineBuffer();
        b.feed(null, 10);
        b.feed(new byte[4], 0);
        assertNull(b.poll());
        assertEquals(0, b.pendingBytes());
    }
}
