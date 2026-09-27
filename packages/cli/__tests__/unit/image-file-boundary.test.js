import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveImages } from "../../src/lib/image-input.js";
import {
  inspectImageHeader,
  MAX_INPUT_IMAGE_BYTES,
} from "../../src/lib/image-file-boundary.js";
import {
  PNG_BYTES,
  imageHeader,
  imageFsFixture,
} from "../helpers/image-file-fixtures.js";

const root = fs.mkdtempSync(join(tmpdir(), "cc-image-boundary-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
function file(name, data = PNG_BYTES, size) {
  const target = join(root, name);
  fs.writeFileSync(target, data);
  if (size) fs.truncateSync(target, size);
  return target;
}

describe("CLI final image input boundary", () => {
  it.each(["png", "jpeg", "gif", "webp"])(
    "recognizes bounded %s headers",
    (format) => {
      expect(inspectImageHeader(imageHeader(format))).toMatchObject({
        mediaType: `image/${format}`,
      });
      expect(
        resolveImages([file(`valid.${format}`, imageHeader(format))])[0]
          .mediaType,
      ).toBe(`image/${format}`);
    },
  );

  it("rejects a forged extension and malformed header before returning content", () => {
    expect(() => resolveImages([file("mismatch.jpg")])).toThrow(
      /extension does not match/,
    );
    expect(() =>
      resolveImages([file("invalid.png", Buffer.from("not an image"))]),
    ).toThrow(/malformed image header/);
    expect(() => resolveImages([file("empty.png", Buffer.alloc(0))])).toThrow(
      /1 byte to 20 MiB/,
    );
  });

  it("rejects zero and oversized pixel declarations", () => {
    for (const width of [0, 40_000_001]) {
      const bytes = Buffer.from(PNG_BYTES);
      bytes.writeUInt32BE(width, 16);
      expect(() => resolveImages([file(`pixel-${width}.png`, bytes)])).toThrow(
        /40 megapixels/,
      );
    }
  });

  it("bounds file size before any read or full-buffer allocation", () => {
    const target = file("oversized.png", PNG_BYTES, MAX_INPUT_IMAGE_BYTES + 1);
    const readSync = vi.fn(fs.readSync);
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      resolveImages([target], { fs: { ...fs, readSync, closeSync } }),
    ).toThrow(/20 MiB/);
    expect(readSync).not.toHaveBeenCalled();
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("bounds the combined attachment bytes and identifies the failing entry", () => {
    const a = file("total-a.png", PNG_BYTES, 11 * 1024 * 1024);
    const b = file("total-b.png", PNG_BYTES, 11 * 1024 * 1024);
    expect(() => resolveImages([a, b])).toThrow(
      /Image 2: Total image attachments exceed 20 MiB/,
    );
  });

  it("rejects excess image count before opening files", () => {
    const openSync = vi.fn();
    expect(() =>
      resolveImages(Array(9).fill("same.png"), { fs: { openSync } }),
    ).toThrow(/at most 8/);
    expect(openSync).not.toHaveBeenCalled();
  });

  it("rejects non-regular handles and closes them", () => {
    const io = imageFsFixture();
    io.fstatSync = () => ({ isFile: () => false });
    io.closeSync = vi.fn();
    io.readSync = vi.fn();
    expect(() => resolveImages(["pipe.png"], { fs: io })).toThrow(
      /regular file/,
    );
    expect(io.readSync).not.toHaveBeenCalled();
    expect(io.closeSync).toHaveBeenCalledOnce();
  });

  it("uses bounded descriptor reads when the file grows after its size check", () => {
    const target = file("growing.png");
    let changed = false;
    const readSync = vi.fn((...args) => {
      const read = fs.readSync(...args);
      if (!changed) {
        changed = true;
        fs.appendFileSync(target, Buffer.alloc(1024));
      }
      return read;
    });
    const closeSync = vi.fn(fs.closeSync);
    expect(() =>
      resolveImages([target], { fs: { ...fs, readSync, closeSync } }),
    ).toThrow(/changed while being read/);
    expect(
      readSync.mock.calls.every((args) => args[3] <= PNG_BYTES.length + 1),
    ).toBe(true);
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("supports short reads and rejects a truncated file", () => {
    const target = file("short-read.png");
    const readSync = (fd, data, offset, length, position) =>
      fs.readSync(fd, data, offset, Math.min(length, 7), position);
    expect(resolveImages([target], { fs: { ...fs, readSync } })[0].data).toBe(
      PNG_BYTES.toString("base64"),
    );
    let reads = 0;
    const truncated = (...args) => (++reads === 1 ? fs.readSync(...args) : 0);
    expect(() =>
      resolveImages([target], { fs: { ...fs, readSync: truncated } }),
    ).toThrow(/changed while being read/);
  });

  it("caps JPEG header scanning at 1 MiB", () => {
    const segment = Buffer.alloc(65537);
    segment[0] = 255;
    segment[1] = 224;
    segment.writeUInt16BE(65535, 2);
    const data = Buffer.concat([
      Buffer.from([255, 216]),
      ...Array(17).fill(segment),
      imageHeader("jpeg").subarray(2),
    ]);
    expect(() => resolveImages([file("late-dimensions.jpg", data)])).toThrow(
      /first 1 MiB/,
    );
  });
});
