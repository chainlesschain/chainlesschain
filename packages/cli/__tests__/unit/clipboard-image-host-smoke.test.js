import { describe, expect, it } from "vitest";
import {
  createFixturePng,
  pngDimensions,
  pngPixelIdentity,
} from "../../scripts/clipboard-image-host-smoke.mjs";
import { detectClipboardImageMediaType } from "../../src/repl/clipboard-image.js";

describe("clipboard image host smoke fixture", () => {
  it("builds a deterministic valid PNG identity for host round trips", () => {
    const first = createFixturePng();
    const second = createFixturePng();
    expect(first.equals(second)).toBe(true);
    expect(detectClipboardImageMediaType(first)).toBe("image/png");
    expect(pngDimensions(first)).toEqual({ width: 3, height: 2 });
    expect(pngPixelIdentity(first).pixelSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("refuses a non-PNG host result", () => {
    expect(() => pngDimensions(Buffer.from("not-a-png"))).toThrow(
      "did not read a PNG",
    );
  });

  it("rejects truncated or checksum-invalid PNG evidence", () => {
    const fixture = createFixturePng();
    expect(() => pngPixelIdentity(fixture.subarray(0, -1))).toThrow();
    const corrupted = Buffer.from(fixture);
    corrupted[corrupted.length - 8] ^= 0xff;
    expect(() => pngPixelIdentity(corrupted)).toThrow("checksum");
  });
});
