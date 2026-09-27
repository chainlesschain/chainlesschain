import fs from "node:fs";

// CLI keeps its existing eight-image allowance; IDE composers admit four.
export const MAX_INPUT_IMAGES = 8;
export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_IMAGE_PIXELS = 40_000_000;
const MAX_HEADER_BYTES = 1024 * 1024;

/** Header admission only, not a full codec decode or animation-frame budget. */
export function inspectImageHeader(data) {
  const ascii = (start, end) => data.toString("ascii", start, end);
  if (
    data.length >= 33 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.readUInt32BE(8) === 13 &&
    ascii(12, 16) === "IHDR"
  ) {
    return {
      mediaType: "image/png",
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }
  if (data.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    return {
      mediaType: "image/gif",
      width: data.readUInt16LE(6),
      height: data.readUInt16LE(8),
    };
  }
  if (data.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const kind = ascii(12, 16);
    if (kind === "VP8X")
      return {
        mediaType: "image/webp",
        width: data.readUIntLE(24, 3) + 1,
        height: data.readUIntLE(27, 3) + 1,
      };
    if (
      kind === "VP8 " &&
      data[23] === 157 &&
      data[24] === 1 &&
      data[25] === 42
    )
      return {
        mediaType: "image/webp",
        width: data.readUInt16LE(26) & 16383,
        height: data.readUInt16LE(28) & 16383,
      };
    if (kind === "VP8L" && data[20] === 47) {
      const bits = data.readUInt32LE(21);
      return {
        mediaType: "image/webp",
        width: (bits & 16383) + 1,
        height: ((bits >>> 14) & 16383) + 1,
      };
    }
  }
  if (data.length >= 4 && data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 255) break;
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      ) {
        return {
          mediaType: "image/jpeg",
          width: data.readUInt16BE(offset + 5),
          height: data.readUInt16BE(offset + 3),
        };
      }
      offset += length;
    }
  }
  throw new Error(
    "Unsupported or malformed image header (dimensions must occur within the first 1 MiB)",
  );
}

function readAtMost(io, fd, data) {
  let offset = 0;
  while (offset < data.length) {
    const count = io.readSync(fd, data, offset, data.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  return offset;
}

/** Pin one regular-file descriptor and cap allocation/read even if it grows. */
export function readBoundedImage(
  file,
  expectedMediaType,
  remainingBytes,
  io = fs,
) {
  // O_NONBLOCK avoids hanging while opening a FIFO on POSIX. fstat then
  // rejects all non-regular files; Windows has no O_NONBLOCK flag here.
  const fd = io.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0),
  );
  try {
    const before = io.fstatSync(fd);
    if (!before.isFile()) throw new Error("Image input must be a regular file");
    if (
      !Number.isSafeInteger(before.size) ||
      before.size <= 0 ||
      before.size > MAX_INPUT_IMAGE_BYTES
    )
      throw new Error("Image must contain 1 byte to 20 MiB");
    if (before.size > remainingBytes)
      throw new Error("Total image attachments exceed 20 MiB per message");
    const header = Buffer.alloc(Math.min(before.size, MAX_HEADER_BYTES));
    const headerSize = readAtMost(io, fd, header);
    const info = inspectImageHeader(header.subarray(0, headerSize));
    if (info.mediaType !== expectedMediaType)
      throw new Error("Image extension does not match its file header");
    if (
      !info.width ||
      !info.height ||
      info.width * info.height > MAX_INPUT_IMAGE_PIXELS
    )
      throw new Error(
        "Image dimensions must be positive and at most 40 megapixels",
      );
    const data = Buffer.alloc(before.size + 1);
    const count = readAtMost(io, fd, data);
    const after = io.fstatSync(fd);
    if (
      count !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      !data.subarray(0, headerSize).equals(header.subarray(0, headerSize))
    )
      throw new Error("Image changed while being read; select it again");
    return data.subarray(0, count);
  } finally {
    io.closeSync(fd);
  }
}
