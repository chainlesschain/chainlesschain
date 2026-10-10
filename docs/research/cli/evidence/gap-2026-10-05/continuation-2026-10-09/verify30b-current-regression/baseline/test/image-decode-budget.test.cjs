"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { deflateSync } = require("node:zlib");
const { inspectImageBudget } = require("../src/chat/image-decode-budget");

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

// A complete grayscale APNG with a separate default image and one animation
// frame. Both have valid compressed scanlines, including each row's filter byte.
function apngWithFallback(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(1);
  const control = Buffer.alloc(26);
  control.writeUInt32BE(width, 4);
  control.writeUInt32BE(height, 8);
  control.writeUInt16BE(1, 20);
  control.writeUInt16BE(10, 22);
  const pixels = deflateSync(Buffer.alloc((width + 1) * height));
  const frameData = Buffer.alloc(pixels.length + 4);
  frameData.writeUInt32BE(1);
  pixels.copy(frameData, 4);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("acTL", animation),
    pngChunk("IDAT", pixels),
    pngChunk("fcTL", control),
    pngChunk("fdAT", frameData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("admits exactly 40 million decoded pixels including the APNG fallback", () => {
  const image = apngWithFallback(5000, 4000);
  assert.ok(image.length < 20 * 1024 * 1024);
  assert.deepEqual(inspectImageBudget(image), {
    format: "png",
    width: 5000,
    height: 4000,
    frames: 1,
    extraCanvases: 1,
    decodedPixels: 40_000_000,
  });
});

test("rejects an APNG whose fallback alone pushes total decoded pixels over budget", () => {
  const width = 5001;
  const height = 4000;
  const image = apngWithFallback(width, height);
  assert.ok(image.length < 20 * 1024 * 1024);
  assert.ok(width * height < 40_000_000);
  assert.equal(width * height * 2, 40_008_000);
  // One declared frame and one fallback are below the 200-canvas limit;
  // neither dimensions nor animation-only pixels exceed their limits.
  assert.throws(() => inspectImageBudget(image), {
    message:
      "Animation and fallback exceed 200 frames or 40 million decoded canvas pixels",
  });
});
