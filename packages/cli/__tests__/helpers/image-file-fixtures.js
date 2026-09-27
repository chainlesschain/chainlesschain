import fs from "node:fs";

export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Header fixtures exercise admission, not complete codec decoding.
export function imageHeader(format) {
  if (format === "png") return Buffer.from(PNG_BYTES);
  if (format === "jpeg")
    return Buffer.from([
      255, 216, 255, 192, 0, 11, 8, 0, 2, 0, 3, 1, 1, 17, 0, 255, 217,
    ]);
  if (format === "gif") return Buffer.from("47494638396103000200000000", "hex");
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8);
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(2, 24, 3);
  bytes.writeUIntLE(1, 27, 3);
  return bytes;
}

export function imageFsFixture() {
  return {
    openSync(file) {
      return imageHeader(
        /\.jpe?g$/i.test(file)
          ? "jpeg"
          : /\.webp$/i.test(file)
            ? "webp"
            : /\.gif$/i.test(file)
              ? "gif"
              : "png",
      );
    },
    fstatSync(data) {
      return { size: data.length, mtimeMs: 1, ctimeMs: 1, isFile: () => true };
    },
    readSync(data, target, offset, length, position) {
      return data.copy(target, offset, position, position + length);
    },
    closeSync() {},
    constants: fs.constants,
  };
}
