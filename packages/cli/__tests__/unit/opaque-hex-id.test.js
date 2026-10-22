import { describe, expect, it } from "vitest";
import {
  encodeOpaqueHexId,
  formatOpaqueHexId,
} from "../../src/lib/evolution/opaque-hex-id.js";

const FIXED_UUID = "12345678-1234-4567-8123-123456789012";
const CARD_LIKE_DIGITS = /\b(?:\d[ -]*?){13,19}\b/u;

describe("opaque hex ID encoding", () => {
  it("preserves every nibble of a fixed 128-bit UUID without card-like digits", () => {
    const hex = FIXED_UUID.replaceAll("-", "");
    const legacy = formatOpaqueHexId(hex);
    const encoded = encodeOpaqueHexId(hex);

    expect(hex).toHaveLength(32);
    expect(legacy).toMatch(CARD_LIKE_DIGITS);
    expect(encoded).toMatch(/^(?:[a-p]{8}-){3}[a-p]{8}$/u);
    expect(encoded).not.toMatch(/\d/u);
    expect(encoded).not.toMatch(CARD_LIKE_DIGITS);
    expect(
      encoded
        .replaceAll("-", "")
        .replace(/[g-p]/gu, (letter) =>
          String.fromCharCode(letter.charCodeAt(0) - 103 + 48),
        ),
    ).toBe(hex);
  });

  it("maps all sixteen hex nibbles one-to-one", () => {
    const source = "0123456789abcdef";
    const encoded = encodeOpaqueHexId(source).replaceAll("-", "");
    expect(encoded).toHaveLength(source.length);
    expect(new Set(encoded).size).toBe(16);
    expect(encoded).toBe("ghijklmnopabcdef");
  });
});
