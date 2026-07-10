package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * QrCode (pure, ECC M) — the SAME fixtures as the JS twin's
 * vscode-ext-qr-code.test.js (decode-verified with the independent jsQR
 * decoder, cross-checked against the reference npm `qrcode` lib), so both
 * IDEs render byte-identical symbols.
 */
class QrCodeTest {

    private static final List<String> HELLO_ROWS = Arrays.asList(
            "fecbf8", "821208", "ba52e8", "ba92e8", "baeae8", "829208",
            "feabf8", "009800", "8bf7c8", "10b878", "3f3690", "f8c400",
            "faab30", "00af58", "feead0", "825d98", "bad630", "ba48d8",
            "ba71c0", "821400", "feffa8");

    private static final String PAIRING_URI =
            "chainlesschain://remote-control/pair#eyJ2IjoxLCJ3cyI6IndzOi8vMTkyLjE2OC4xLjIzOjE4ODAwIiwidG9rZW4iOiJabTl2WW1GeVltRjZjWFY0TVRJek5EVTJOemc1TUdGaVkyUmxabWRvYVdwcmJHMXViM0J4Y25OMGRYWjNlSGw2UVVKRFJFVkdSdyIsInNjb3BlcyI6WyJvYnNlcnZlIiwicHJvbXB0IiwiYXBwcm92ZSIsImludGVycnVwdCJdfQ";

    private static String rowsSha256(QrCode qr) throws Exception {
        String joined = String.join("\n", qr.toRowHex());
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(joined.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    @Test
    void matchesDecodeVerifiedFixtureForShortString() {
        QrCode qr = QrCode.encode("HELLO WORLD");
        assertEquals(1, qr.version);
        assertEquals(21, qr.size);
        assertEquals(4, qr.mask);
        assertEquals(HELLO_ROWS, qr.toRowHex());
    }

    @Test
    void matchesDecodeVerifiedFixtureForRealisticPairingUri() throws Exception {
        QrCode qr = QrCode.encode(PAIRING_URI);
        assertEquals(12, qr.version);
        assertEquals(65, qr.size);
        assertEquals(2, qr.mask);
        assertEquals(
                "fa7c75a78812f95cf1d1f71daad40e43b1824dccf8f63b4e53886ba0deb0bc1c",
                rowsSha256(qr));
    }

    @Test
    void matchesFixtureForLongMultiBlockPayload() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 700; i++) sb.append('x');
        QrCode qr = QrCode.encode(sb.toString());
        assertEquals(21, qr.version);
        assertEquals(0, qr.mask);
        assertEquals(
                "cb6ead30dbb3406821d69d140ca637d2587e5ae8e409f11595862a9125444ad3",
                rowsSha256(qr));
    }

    @Test
    void holdsStructuralInvariants() {
        QrCode qr = QrCode.encode(PAIRING_URI);
        assertEquals(qr.version * 4 + 17, qr.size);
        assertTrue(qr.modules[3][3]);   // finder core dark
        assertFalse(qr.modules[7][7]);  // separator light
        for (int i = 8; i < qr.size - 8; i++) {
            assertEquals(i % 2 == 0, qr.modules[6][i]);
            assertEquals(i % 2 == 0, qr.modules[i][6]);
        }
        assertTrue(qr.modules[qr.size - 8][8]); // always-dark module
    }

    @Test
    void returnsNullBeyondCapacityAndHandlesEmptyAndNull() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 3000; i++) sb.append('x');
        assertNull(QrCode.encode(sb.toString())); // > 2331-byte ECC-M cap
        assertEquals(1, QrCode.encode("").version);
        assertEquals(1, QrCode.encode(null).version);
    }
}
