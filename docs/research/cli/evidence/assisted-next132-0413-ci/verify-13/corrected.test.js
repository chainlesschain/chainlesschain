import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_INPUT_IMAGE_BYTES,
  readBoundedImage,
} from "../src/lib/image-file-boundary.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const root = fs.mkdtempSync(join(tmpdir(), "cc-verify13-"));
function file(name, data = PNG_BYTES) {
  const target = join(root, name);
  fs.writeFileSync(target, data);
  return target;
}

describe("attachment same-handle read boundary", () => {
  it("reads a small image via one handle and closes it", () => {
    const target = file("ok.png");
    const closeSync = vi.fn(fs.closeSync);
    const data = readBoundedImage(target, "image/png", MAX_INPUT_IMAGE_BYTES, {
      ...fs,
      closeSync,
    });
    expect(data).toEqual(PNG_BYTES);
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("rejects an input that shrinks after its size check and closes the handle", () => {
    const target = file("shrink.png", Buffer.concat([PNG_BYTES, Buffer.alloc(64)]));
    let shrank = false;
    const readSync = vi.fn((...args) => {
      const read = fs.readSync(...args);
      if (!shrank) {
        shrank = true;
        fs.truncateSync(target, PNG_BYTES.length);
      }
      return read;
    });
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      readBoundedImage(target, "image/png", MAX_INPUT_IMAGE_BYTES, {
        ...fs,
        readSync,
        closeSync,
      }),
    ).toThrow(/changed while being read/);
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("rejects an input that grows after its size check and closes the handle", () => {
    const target = file("grow.png");
    let changed = false;
    const readSync = vi.fn((...args) => {
      const read = fs.readSync(...args);
      if (!changed) {
        changed = true;
        fs.appendFileSync(target, Buffer.alloc(32));
      }
      return read;
    });
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      readBoundedImage(target, "image/png", MAX_INPUT_IMAGE_BYTES, {
        ...fs,
        readSync,
        closeSync,
      }),
    ).toThrow(/changed while being read/);
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("rejects an input replaced with a different same-size payload and closes the handle", () => {
    const target = file("replaced.png");
    let swapped = false;
    const readSync = vi.fn((...args) => {
      const read = fs.readSync(...args);
      if (!swapped && read === 0) {
        swapped = true;
        const replaced = Buffer.from(PNG_BYTES);
        // Mutate only after both header and data reads completed. Their byte
        // snapshots remain equal, so only the pinned handle time check detects it.
        replaced[replaced.length - 1] ^= 1; // same size, header unchanged
        const beforeChange = fs.statSync(target);
        fs.writeFileSync(target, replaced);
        fs.utimesSync(target, beforeChange.atime, new Date(beforeChange.mtimeMs + 60_000));
      }
      return read;
    });
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      readBoundedImage(target, "image/png", MAX_INPUT_IMAGE_BYTES, {
        ...fs,
        readSync,
        closeSync,
      }),
    ).toThrow(/changed while being read/);
    expect(closeSync).toHaveBeenCalledOnce();
    expect(swapped).toBe(true);
    const stableReplacement = Buffer.from(PNG_BYTES);
    stableReplacement[stableReplacement.length - 1] ^= 1;
    // Once stable, the same-size replacement still passes normal header admission.
    expect(readBoundedImage(target, "image/png", MAX_INPUT_IMAGE_BYTES)).toEqual(stableReplacement);
  });

  it("rejects an input exceeding the remaining attachment budget before reading", () => {
    const target = file("over-remainder.png");
    const readSync = vi.fn(fs.readSync);
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      readBoundedImage(target, "image/png", PNG_BYTES.length - 1, {
        ...fs,
        readSync,
        closeSync,
      }),
    ).toThrow(/Total image attachments exceed 20 MiB/);
    expect(readSync).not.toHaveBeenCalled();
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("rejects an input larger than the per-file cap before reading", () => {
    const target = file("over-cap.png", Buffer.alloc(MAX_INPUT_IMAGE_BYTES + 1));
    const readSync = vi.fn(fs.readSync);
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      readBoundedImage(target, "image/png", MAX_INPUT_IMAGE_BYTES, {
        ...fs,
        readSync,
        closeSync,
      }),
    ).toThrow(/1 byte to 20 MiB/);
    expect(readSync).not.toHaveBeenCalled();
    expect(closeSync).toHaveBeenCalledOnce();

    // A small file may still exceed the independent pixel allocation budget.
    // Keep valid header/byte-count prerequisites and exercise the real reader.
    const pixelClose = vi.fn(fs.closeSync);
    const overPixels = Buffer.from(PNG_BYTES);
    overPixels.writeUInt32BE(8001, 16);
    overPixels.writeUInt32BE(5000, 20);
    expect(() => readBoundedImage(file("over-pixels.png", overPixels), "image/png", MAX_INPUT_IMAGE_BYTES, {
      ...fs, closeSync: pixelClose,
    })).toThrow(/at most 40 megapixels/);
    expect(pixelClose).toHaveBeenCalledOnce();
    const atPixels = Buffer.from(overPixels);
    atPixels.writeUInt32BE(8000, 16);
    expect(readBoundedImage(file("at-pixels.png", atPixels), "image/png", MAX_INPUT_IMAGE_BYTES)).toEqual(atPixels);
  });
});
