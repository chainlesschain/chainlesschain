/* global ImageDecoder, OffscreenCanvas, Worker */
const { inspectImageBudget } = require("./image-decode-budget");

async function decodeImagePreviewBatch(images) {
  if (typeof ImageDecoder !== "function")
    throw new Error(
      "This editor cannot safely decode image previews; update the editor before attaching images",
    );
  if (!Array.isArray(images) || images.length > 4)
    throw new Error("Attach at most 4 images per message");
  let total = 0;
  let totalBytes = 0;
  const admitted = images.map((image) => {
    const match =
      /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        image.data,
      );
    if (!match || match[2].length > Math.ceil((20 * 1024 * 1024) / 3) * 4)
      throw new Error("Invalid image data");
    totalBytes +=
      match[2].length * 0.75 -
      (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
    if (totalBytes > 20 * 1024 * 1024)
      throw new Error("Images exceed 20 MiB in total");
    const raw = atob(match[2]);
    const data = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const info = inspectImageBudget(data);
    if (info.format !== match[1])
      throw new Error("Image MIME does not match its format");
    total += info.decodedPixels;
    if (total > 40_000_000)
      throw new Error(
        "Attachments exceed 40 million decoded canvas pixels in total",
      );
    return { data, info, type: "image/" + match[1] };
  });
  const results = [];
  const retained = [];
  let transferred = false;
  try {
    for (const { data, info, type } of admitted) {
      if (!(await ImageDecoder.isTypeSupported(type)))
        throw new Error("This editor does not support decoding " + type);
      let rasterData = data;
      const strippedMetadata = [];
      if (info.format === "png") {
        // Ancillary metadata can itself contain an unbounded compressed stream
        // (ICC/text). Decode only raster/animation and fixed-size color chunks.
        // Original attachment bytes are retained for persistence and sending.
        const keep = [
          "IHDR",
          "PLTE",
          "tRNS",
          "IDAT",
          "IEND",
          "acTL",
          "fcTL",
          "fdAT",
          "gAMA",
          "cHRM",
          "sRGB",
        ];
        const parts = [data.subarray(0, 8)];
        const view = new DataView(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        );
        for (let at = 8; at < data.length;) {
          const length = view.getUint32(at) + 12;
          const kind = String.fromCharCode(...data.subarray(at + 4, at + 8));
          if (keep.includes(kind)) parts.push(data.subarray(at, at + length));
          else strippedMetadata.push(kind);
          at += length;
        }
        rasterData = new Uint8Array(
          parts.reduce((size, part) => size + part.length, 0),
        );
        let at = 0;
        for (const part of parts) {
          rasterData.set(part, at);
          at += part.length;
        }
      }
      const decoder = new ImageDecoder({
        data: rasterData,
        type,
        preferAnimation: true,
      });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        const track = decoder.tracks.selectedTrack;
        if (!track || track.frameCount !== info.frames)
          throw new Error(
            "Decoded animation frame count differs from its container",
          );
        const thumbnails = [];
        let decodedWidth, decodedHeight;
        const canvas = new OffscreenCanvas(40, 40);
        const context = canvas.getContext("2d");
        for (let frameIndex = 0; frameIndex < info.frames; frameIndex++) {
          const result = await decoder.decode({
            frameIndex,
            completeFramesOnly: true,
          });
          try {
            if (
              !result.complete ||
              result.image.displayWidth !== info.width ||
              result.image.displayHeight !== info.height
            )
              throw new Error(
                "Decoded image dimensions differ from its canvas",
              );
            decodedWidth = result.image.displayWidth;
            decodedHeight = result.image.displayHeight;
            context.clearRect(0, 0, 40, 40);
            const ratio = Math.min(40 / decodedWidth, 40 / decodedHeight);
            const width = decodedWidth * ratio,
              height = decodedHeight * ratio;
            context.drawImage(
              result.image,
              (40 - width) / 2,
              (40 - height) / 2,
              width,
              height,
            );
            const bitmap = canvas.transferToImageBitmap();
            retained.push(bitmap);
            thumbnails.push({
              bitmap,
              duration: Math.max(20, (result.image.duration || 100000) / 1000),
            });
          } finally {
            result.image.close();
          }
        }
        // APNG can carry a separate still fallback not used by the animation.
        // It also consumes decode work, so admission counts and validates it.
        if (info.extraCanvases) {
          // Chromium exposes only the animated track for this APNG layout.
          // Remove animation chunks (already CRC-checked) to expose precisely
          // the default IDAT image to another decoder within the same worker.
          const parts = [rasterData.subarray(0, 8)];
          const view = new DataView(
            rasterData.buffer,
            rasterData.byteOffset,
            rasterData.byteLength,
          );
          for (let at = 8; at < rasterData.length;) {
            const length = view.getUint32(at) + 12;
            const kind = String.fromCharCode(
              ...rasterData.subarray(at + 4, at + 8),
            );
            if (!["acTL", "fcTL", "fdAT"].includes(kind))
              parts.push(rasterData.subarray(at, at + length));
            at += length;
          }
          const still = new Uint8Array(
            parts.reduce((size, part) => size + part.length, 0),
          );
          let offset = 0;
          for (const part of parts) {
            still.set(part, offset);
            offset += part.length;
          }
          const fallback = new ImageDecoder({ data: still, type });
          try {
            await fallback.tracks.ready;
            const result = await fallback.decode({
              frameIndex: 0,
              completeFramesOnly: true,
            });
            try {
              if (
                !result.complete ||
                result.image.displayWidth !== info.width ||
                result.image.displayHeight !== info.height
              )
                throw new Error(
                  "Decoded PNG fallback dimensions differ from its canvas",
                );
            } finally {
              result.image.close();
            }
          } finally {
            fallback.close();
          }
        }
        results.push({
          ...info,
          decodedWidth,
          decodedHeight,
          strippedMetadata,
          repetitions: track.repetitionCount,
          thumbnails,
        });
      } finally {
        decoder.close();
      }
    }
    transferred = true;
    return results;
  } finally {
    if (!transferred) for (const bitmap of retained) bitmap.close();
  }
}

// One cancellable decoder per visible composer. Only bounded bitmaps leave it;
// original compressed bytes are never offered to a second DOM image decoder.
function createImagePreviewGate({
  workerSource,
  timeoutMs = 5000,
  workerFactory,
} = {}) {
  let active = null;
  const dispose = (results) => {
    for (const result of results || [])
      for (const frame of result.thumbnails || []) frame.bitmap.close();
  };
  const cancel = () => {
    if (active) active(new Error("Image decoding cancelled"));
  };
  function validate(images) {
    cancel();
    return new Promise((resolve, reject) => {
      let worker,
        timer,
        settled = false;
      const finish = (error, result) => {
        if (settled) {
          dispose(result);
          return;
        }
        settled = true;
        clearTimeout(timer);
        worker?.terminate();
        if (active === finish) active = null;
        if (error) reject(error);
        else resolve(result);
      };
      active = finish;
      try {
        if (workerFactory) worker = workerFactory();
        else {
          const url = URL.createObjectURL(
            new Blob([workerSource], { type: "text/javascript" }),
          );
          try {
            worker = new Worker(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        worker.onmessage = ({ data }) =>
          finish(data.error ? new Error(data.error) : null, data.results);
        worker.onerror = () => finish(new Error("Image decoder failed"));
        timer = setTimeout(
          () =>
            finish(new Error("Image decoding exceeded the 5 second budget")),
          timeoutMs,
        );
        worker.postMessage(images.map(({ data }) => ({ data })));
      } catch (error) {
        finish(error);
      }
    });
  }
  return { validate, cancel, dispose };
}

// Only 40x40 transferred bitmaps reach the DOM: at most 4 * 200 * 6400
// RGBA bytes (5.12 MB), in addition to the one active worker's admitted input.
function drawImagePreview(canvas, result) {
  const context = canvas.getContext("2d");
  let timer,
    stopped = false,
    index = 0,
    repeats = 0;
  const draw = () => {
    if (stopped) return;
    context.clearRect(0, 0, 40, 40);
    context.drawImage(result.thumbnails[index].bitmap, 0, 0);
    canvas.__ccPreviewDrawn = true;
    if (result.thumbnails.length === 1) return;
    const duration = result.thumbnails[index].duration;
    timer = setTimeout(
      () => {
        index++;
        if (index === result.thumbnails.length) {
          index = 0;
          if (
            Number.isFinite(result.repetitions) &&
            repeats++ >= result.repetitions
          )
            return;
        }
        draw();
      },
      Math.max(20, Math.min(2147483647, duration || 100)),
    );
  };
  draw();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const IMAGE_PREVIEW_WORKER_SOURCE = `${inspectImageBudget.toString()}
${decodeImagePreviewBatch.toString()}
self.onmessage = async ({ data }) => {
  let results;
  try {
    results = await decodeImagePreviewBatch(data);
    self.postMessage({ results }, results.flatMap(result => result.thumbnails.map(frame => frame.bitmap)));
  }
  catch (error) {
    for (const result of results || []) for (const frame of result.thumbnails) frame.bitmap.close();
    self.postMessage({ error: error.message });
  }
};`;

module.exports = {
  createImagePreviewGate,
  drawImagePreview,
  decodeImagePreviewBatch,
  IMAGE_PREVIEW_WORKER_SOURCE,
};
