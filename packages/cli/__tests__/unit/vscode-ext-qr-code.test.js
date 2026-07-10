/**
 * Pure QR encoder (packages/vscode-extension/src/qr-code.js) — byte mode,
 * ECC M, auto version. Fixtures were decode-verified with the independent
 * jsQR decoder and cross-checked against the reference npm `qrcode` lib
 * (identical matrices where mask choices coincide); the Java twin
 * (QrCodeTest.java) asserts the SAME fixtures so both IDEs render identical
 * symbols.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  encodeQr,
  qrToRowHex,
  qrToSvg,
} from "../../../vscode-extension/src/qr-code.js";
import { pairingQrHtml } from "../../../vscode-extension/src/remote-control-host.js";

// jsQR-decode-verified full matrix for "HELLO WORLD" (v1, ECC M, mask 4).
const HELLO_ROWS = [
  "fecbf8",
  "821208",
  "ba52e8",
  "ba92e8",
  "baeae8",
  "829208",
  "feabf8",
  "009800",
  "8bf7c8",
  "10b878",
  "3f3690",
  "f8c400",
  "faab30",
  "00af58",
  "feead0",
  "825d98",
  "bad630",
  "ba48d8",
  "ba71c0",
  "821400",
  "feffa8",
];

const PAIRING_URI =
  "chainlesschain://remote-control/pair#eyJ2IjoxLCJ3cyI6IndzOi8vMTkyLjE2OC4xLjIzOjE4ODAwIiwidG9rZW4iOiJabTl2WW1GeVltRjZjWFY0TVRJek5EVTJOemc1TUdGaVkyUmxabWRvYVdwcmJHMXViM0J4Y25OMGRYWjNlSGw2UVVKRFJFVkdSdyIsInNjb3BlcyI6WyJvYnNlcnZlIiwicHJvbXB0IiwiYXBwcm92ZSIsImludGVycnVwdCJdfQ";

function rowsSha256(qr) {
  return createHash("sha256")
    .update(qrToRowHex(qr).join("\n"), "utf8")
    .digest("hex");
}

describe("QR encoder (pure, ECC M)", () => {
  it("matches the decode-verified fixture for a short string", () => {
    const qr = encodeQr("HELLO WORLD");
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
    expect(qr.mask).toBe(4);
    expect(qrToRowHex(qr)).toEqual(HELLO_ROWS);
  });

  it("matches the decode-verified fixture for a realistic pairing URI", () => {
    const qr = encodeQr(PAIRING_URI);
    expect(qr.version).toBe(12);
    expect(qr.size).toBe(65);
    expect(qr.mask).toBe(2);
    expect(rowsSha256(qr)).toBe(
      "fa7c75a78812f95cf1d1f71daad40e43b1824dccf8f63b4e53886ba0deb0bc1c",
    );
  });

  it("matches the fixture for a long multi-block payload (v21, interleave)", () => {
    const qr = encodeQr("x".repeat(700));
    expect(qr.version).toBe(21);
    expect(qr.mask).toBe(0);
    expect(rowsSha256(qr)).toBe(
      "cb6ead30dbb3406821d69d140ca637d2587e5ae8e409f11595862a9125444ad3",
    );
  });

  it("holds structural invariants (finder, timing, dark module)", () => {
    const qr = encodeQr(PAIRING_URI);
    const m = qr.modules;
    expect(qr.size).toBe(qr.version * 4 + 17);
    // Finder cores are dark, separators light (spot-check top-left).
    expect(m[3][3]).toBe(true);
    expect(m[7][7]).toBe(false);
    // Timing pattern alternates along row/column 6.
    for (let i = 8; i < qr.size - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    // The always-dark module.
    expect(m[qr.size - 8][8]).toBe(true);
  });

  it("returns null beyond version 40 capacity and handles empty input", () => {
    expect(encodeQr("x".repeat(3000))).toBeNull(); // > 2331-byte ECC-M cap
    expect(encodeQr("")).toMatchObject({ version: 1 });
  });

  it("renders a deterministic crisp SVG with a quiet zone", () => {
    const qr = encodeQr("HELLO WORLD");
    const svg = qrToSvg(qr, { border: 4 });
    expect(svg).toContain('viewBox="0 0 29 29"'); // 21 + 2*4
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('<rect width="29" height="29" fill="#ffffff"/>');
    // Top-left finder corner module at border offset.
    expect(svg).toContain("M4,4h1v1h-1z");
    expect(qrToSvg(null)).toBeNull();
  });
});

describe("pairing QR webview HTML (VS Code glue)", () => {
  it("embeds the SVG, the escaped URI and the expiry", () => {
    const html = pairingQrHtml({
      pairingUri: PAIRING_URI + "&x=<script>",
      pairing: { expiresAt: 1760000000000 },
    });
    expect(html).toContain("<svg");
    expect(html).toContain("expires 2025-10-09");
    // URI is HTML-escaped, never raw.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;x=&lt;script&gt;");
    // Static document: no executable script tags at all.
    expect(html).not.toMatch(/<script\b/);
  });

  it("falls back to copy guidance when the URI exceeds QR capacity", () => {
    const html = pairingQrHtml({ pairingUri: "x".repeat(3000) });
    expect(html).not.toContain("<svg");
    expect(html).toContain("too long");
  });
});
