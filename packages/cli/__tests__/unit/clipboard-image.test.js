import { describe, expect, it, vi } from "vitest";
import {
  detectClipboardImageCapability,
  readClipboardImageChip,
} from "../../src/repl/clipboard-image.js";

describe("clipboard image capability", () => {
  it("does not claim standard readline has image clipboard support", () => {
    expect(detectClipboardImageCapability(null)).toEqual({
      supported: false,
      mode: "path-fallback",
      reason:
        "This terminal exposes pasted text only, not clipboard image bytes. Save the image and paste its png/jpg/gif/webp path to attach it.",
    });
  });

  it("accepts a declared host binding and creates an internal image chip", async () => {
    const binding = {
      supportsImagePaste: true,
      readImage: vi.fn(async () => ({
        mediaType: "image/png",
        data: Buffer.from("png-bytes"),
      })),
    };
    const result = await readClipboardImageChip(binding);
    expect(result).toMatchObject({
      ok: true,
      mode: "host-binding",
      mediaType: "image/png",
      bytes: 9,
      chip: { type: "image_url" },
    });
    expect(result.chip.image_url.url).toBe(
      `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
    );
  });

  it("rejects undeclared, unsupported, empty, and oversized payloads", async () => {
    await expect(
      readClipboardImageChip({ readImage: async () => ({}) }),
    ).resolves.toMatchObject({ ok: false, mode: "path-fallback" });
    await expect(
      readClipboardImageChip({
        supportsImagePaste: true,
        readImage: async () => ({ mediaType: "image/tiff", data: "eA==" }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("type"),
    });
    await expect(
      readClipboardImageChip({
        supportsImagePaste: true,
        readImage: async () => null,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("does not"),
    });
    await expect(
      readClipboardImageChip(
        {
          supportsImagePaste: true,
          readImage: async () => ({
            mediaType: "image/png",
            data: Buffer.alloc(5),
          }),
        },
        { maxBytes: 4 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("exceeds"),
    });
  });
});
