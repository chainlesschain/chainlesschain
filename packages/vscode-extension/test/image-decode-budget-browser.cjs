// Actual Chromium codecs + Blob Worker/CSP. Run independently of DOM mocks.
/* global document */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const { deflateSync } = require("node:zlib");
const {
  createImagePreviewGate,
  drawImagePreview,
  IMAGE_PREVIEW_WORKER_SOURCE,
} = require("../src/chat/image-preview-gate");

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) {
    crc ^= chunk[i];
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
function animatedPng(separateFallback = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2);
  const frame = (sequence) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence);
    data.writeUInt32BE(1, 4);
    data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return pngChunk("fcTL", data);
  };
  const compressed = deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const second = Buffer.alloc(compressed.length + 4);
  second.writeUInt32BE(2);
  compressed.copy(second, 4);
  if (separateFallback) {
    const first = Buffer.from(second);
    first.writeUInt32BE(1);
    second.writeUInt32BE(3);
    return Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IHDR", header),
      pngChunk("acTL", animation),
      pngChunk("IDAT", compressed),
      frame(0),
      pngChunk("fdAT", first),
      frame(2),
      pngChunk("fdAT", second),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("acTL", animation),
    frame(0),
    pngChunk("IDAT", compressed),
    frame(1),
    pngChunk("fdAT", second),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function metadataPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 1;
  header[9] = 3;
  const compressedMetadata = deflateSync(Buffer.alloc(8 * 1024 * 1024));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk(
      "iCCP",
      Buffer.concat([Buffer.from("profile\0\0"), compressedMetadata]),
    ),
    pngChunk(
      "zTXt",
      Buffer.concat([Buffer.from("comment\0\0"), compressedMetadata]),
    ),
    pngChunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0])),
    pngChunk("tRNS", Buffer.from([128, 255])),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://localhost/image-budget", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; worker-src blob:; img-src data:"><body></body>',
      }),
    );
    await page.goto("http://localhost/image-budget");
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    const animation = Buffer.concat([
      gif.subarray(0, 19),
      gif.subarray(19, -1),
      gif.subarray(19),
    ]);
    const result = await page.evaluate(
      async ({
        source,
        factory,
        drawSource,
        animation,
        apng,
        fallbackPng,
        metadataPng,
      }) => {
        const createGate = (0, eval)("(" + factory + ")");
        const draw = (0, eval)("(" + drawSource + ")");
        const gate = createGate({ workerSource: source });
        const canvas = document.createElement("canvas");
        canvas.width = 3;
        canvas.height = 2;
        canvas.getContext("2d").fillRect(0, 0, 3, 2);
        const inputs = ["image/png", "image/jpeg", "image/webp"].map(
          (type) => ({ data: canvas.toDataURL(type) }),
        );
        inputs.push({ data: "data:image/gif;base64," + animation });
        const results = await gate.validate(inputs);
        const preview = document.createElement("canvas");
        preview.width = 40;
        preview.height = 40;
        const stop = draw(preview, results[3]);
        const decoded = results.map(({ thumbnails, ...info }) => ({
          ...info,
          thumbnailFrames: thumbnails.length,
          thumbnailWidth: thumbnails[0].bitmap.width,
          thumbnailHeight: thumbnails[0].bitmap.height,
        }));
        stop();
        gate.dispose(results);
        // Build an animated WebP around two real browser-encoded VP8 payloads.
        const rawWebp = Uint8Array.from(
          atob(inputs[2].data.split(",")[1]),
          (c) => c.charCodeAt(0),
        );
        const join = (parts) => {
          const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
          let at = 0;
          for (const part of parts) {
            out.set(part, at);
            at += part.length;
          }
          return out;
        };
        const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
        const le32 = (value) => {
          const data = new Uint8Array(4);
          new DataView(data.buffer).setUint32(0, value, true);
          return data;
        };
        const chunk = (type, data) =>
          join([
            ascii(type),
            le32(data.length),
            data,
            new Uint8Array(data.length % 2),
          ]);
        const x = new Uint8Array(10);
        x[0] = 2;
        x[4] = 2;
        x[7] = 1;
        const frameHeader = new Uint8Array(16);
        frameHeader[6] = 2;
        frameHeader[9] = 1;
        frameHeader[12] = 50;
        let payload;
        for (let at = 12; at < rawWebp.length;) {
          const size = new DataView(rawWebp.buffer).getUint32(at + 4, true);
          const kind = String.fromCharCode(...rawWebp.subarray(at, at + 4));
          if (kind === "VP8 " || kind === "VP8L")
            payload = rawWebp.subarray(at, at + 8 + size + (size % 2));
          at += 8 + size + (size % 2);
        }
        const frameChunk = chunk("ANMF", join([frameHeader, payload]));
        const chunks = join([
          ascii("WEBP"),
          chunk("VP8X", x),
          chunk("ANIM", new Uint8Array(6)),
          frameChunk,
          frameChunk,
        ]);
        const webp = join([ascii("RIFF"), le32(chunks.length), chunks]);
        const animatedResults = await gate.validate([
          { data: "data:image/png;base64," + apng },
          {
            data:
              "data:image/webp;base64," + btoa(String.fromCharCode(...webp)),
          },
          { data: "data:image/png;base64," + fallbackPng },
        ]);
        const animatedDecoded = animatedResults.map(
          ({ thumbnails, ...info }) => ({
            ...info,
            thumbnailFrames: thumbnails.length,
          }),
        );
        gate.dispose(animatedResults);
        const [metadataResult] = await gate.validate([
          { data: "data:image/png;base64," + metadataPng },
        ]);
        const stopMetadata = draw(preview, metadataResult);
        const metadataPreview = {
          strippedMetadata: metadataResult.strippedMetadata,
          decodedWidth: metadataResult.decodedWidth,
          decodedHeight: metadataResult.decodedHeight,
          centerPixel: [
            ...preview.getContext("2d").getImageData(20, 20, 1, 1).data,
          ],
        };
        stopMetadata();
        gate.dispose([metadataResult]);
        // Outer ANMF says 3x2, inner VP8 now advertises 9000x9000. Reject before
        // entering the codec, where such contradictory headers could allocate.
        const mismatch = webp.slice();
        const nested = 12 + 18 + 14 + 8 + 16;
        if (
          String.fromCharCode(...mismatch.subarray(nested, nested + 4)) ===
          "VP8 "
        ) {
          new DataView(mismatch.buffer).setUint16(nested + 14, 9000, true);
          new DataView(mismatch.buffer).setUint16(nested + 16, 9000, true);
        }
        let dimensionMismatch;
        try {
          await gate.validate([
            {
              data:
                "data:image/webp;base64," +
                btoa(String.fromCharCode(...mismatch)),
            },
          ]);
        } catch (error) {
          dimensionMismatch = error.message;
        }
        // Structurally complete PNG whose IDAT is damaged and CRC corrected: the
        // container validator accepts it, so rejection proves a real codec pass.
        const raw = Uint8Array.from(atob(inputs[0].data.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        const view = new DataView(raw.buffer);
        for (let at = 8; at < raw.length;) {
          const size = view.getUint32(at);
          if (String.fromCharCode(...raw.subarray(at + 4, at + 8)) === "IDAT") {
            raw[at + 8] = 0;
            let crc = 0xffffffff;
            for (let i = at + 4; i < at + 8 + size; i++) {
              crc ^= raw[i];
              for (let bit = 0; bit < 8; bit++)
                crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
            }
            view.setUint32(at + 8 + size, (crc ^ 0xffffffff) >>> 0);
            break;
          }
          at += size + 12;
        }
        let malformed;
        try {
          await gate.validate([
            {
              data:
                "data:image/png;base64," + btoa(String.fromCharCode(...raw)),
            },
          ]);
        } catch (error) {
          malformed = error.message;
        }
        const stuck = createGate({
          workerSource: "self.onmessage = () => { while (true) {} };",
          timeoutMs: 50,
        });
        let timedOut;
        try {
          await stuck.validate([]);
        } catch (error) {
          timedOut = error.message;
        }
        const cancelledGate = createGate({
          workerSource: "self.onmessage = () => { while (true) {} };",
        });
        const pending = cancelledGate.validate([]);
        cancelledGate.cancel();
        let cancelled;
        try {
          await pending;
        } catch (error) {
          cancelled = error.message;
        }
        return {
          decoded,
          animatedDecoded,
          metadataPreview,
          dimensionMismatch,
          preview: {
            width: preview.width,
            height: preview.height,
            drawn: preview.__ccPreviewDrawn,
          },
          malformed,
          timedOut,
          cancelled,
          userAgent: navigator.userAgent,
        };
      },
      {
        source: IMAGE_PREVIEW_WORKER_SOURCE,
        factory: createImagePreviewGate.toString(),
        drawSource: drawImagePreview.toString(),
        animation: animation.toString("base64"),
        apng: animatedPng().toString("base64"),
        fallbackPng: animatedPng(true).toString("base64"),
        metadataPng: metadataPng().toString("base64"),
      },
    );
    assert.deepEqual(
      result.decoded.map(({ format, frames }) => [format, frames]),
      [
        ["png", 1],
        ["jpeg", 1],
        ["webp", 1],
        ["gif", 2],
      ],
    );
    assert.deepEqual(result.preview, { width: 40, height: 40, drawn: true });
    assert.ok(
      result.decoded.every(
        (info) =>
          info.decodedWidth === info.width &&
          info.decodedHeight === info.height &&
          info.thumbnailFrames === info.frames,
      ),
    );
    assert.deepEqual(
      result.animatedDecoded.map(({ format, frames }) => [format, frames]),
      [
        ["png", 2],
        ["webp", 2],
        ["png", 2],
      ],
    );
    assert.match(result.dimensionMismatch, /dimensions disagree/);
    assert.deepEqual(result.metadataPreview, {
      strippedMetadata: ["iCCP", "zTXt"],
      decodedWidth: 1,
      decodedHeight: 1,
      centerPixel: [255, 0, 0, 128],
    });
    assert.equal(result.animatedDecoded[2].decodedPixels, 3);
    assert.ok(result.malformed);
    assert.match(result.timedOut, /budget/);
    assert.match(result.cancelled, /cancelled/);
    const report = {
      schema: "cc-image-codec-budget-browser/v1",
      status: "passed",
      platform: process.platform,
      sourceCommit: process.env.IDE_RELEASE_COMMIT || null,
      ...result,
    };
    if (process.argv[2]) {
      await fs.mkdir(path.dirname(path.resolve(process.argv[2])), {
        recursive: true,
      });
      await fs.writeFile(
        process.argv[2],
        JSON.stringify(report, null, 2) + "\n",
      );
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(async (error) => {
  if (process.argv[2]) {
    await fs.mkdir(path.dirname(path.resolve(process.argv[2])), {
      recursive: true,
    });
    await fs.writeFile(
      process.argv[2],
      JSON.stringify(
        {
          schema: "cc-image-codec-budget-browser/v1",
          status: "failed",
          platform: process.platform,
          sourceCommit: process.env.IDE_RELEASE_COMMIT || null,
          error: error.message,
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.error(error);
  process.exitCode = 1;
});
