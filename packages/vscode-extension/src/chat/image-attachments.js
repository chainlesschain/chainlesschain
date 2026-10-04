const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { inspectImageBudget } = require("./image-decode-budget");
const { readImageSnapshot } = require("./image-file-snapshot");

// Byte limit follows CLI clipboard-image. Both IDEs share these turn limits.
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TURN_BYTES = MAX_IMAGE_BYTES;
const MAX_IMAGE_PIXELS = 40_000_000;

function imageDimensions(data) {
  const ascii = (start, end) => data.toString("ascii", start, end);
  if (
    data.length >= 24 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    ascii(12, 16) === "IHDR"
  ) {
    return {
      format: "png",
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }
  if (data.length >= 10 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    return {
      format: "gif",
      width: data.readUInt16LE(6),
      height: data.readUInt16LE(8),
    };
  }
  if (data.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const kind = ascii(12, 16);
    if (kind === "VP8X")
      return {
        format: "webp",
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
        format: "webp",
        width: data.readUInt16LE(26) & 16383,
        height: data.readUInt16LE(28) & 16383,
      };
    if (kind === "VP8L" && data[20] === 47) {
      const bits = data.readUInt32LE(21);
      return {
        format: "webp",
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
          format: "jpeg",
          width: data.readUInt16BE(offset + 5),
          height: data.readUInt16BE(offset + 3),
        };
      }
      offset += length;
    }
  }
  throw new Error(
    "Unsupported or malformed image header; use PNG, JPEG, GIF or WebP",
  );
}

/** Cheap bound before cloning worker data or allocating decoded buffers. */
function checkImageEnvelope(images) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES)
    throw new Error("Attach at most 4 images per message");
  let total = 0;
  for (const [index, image] of images.entries()) {
    if (
      typeof image?.data !== "string" ||
      image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
    )
      throw new Error(
        `Image ${index + 1}: exceeds the 20 MiB limit or has no image data`,
      );
    const comma = image.data.indexOf(",");
    if (comma < 0 || comma > 32)
      throw new Error(`Image ${index + 1}: invalid data URL`);
    const padding = image.data.endsWith("==")
      ? 2
      : image.data.endsWith("=")
        ? 1
        : 0;
    const size = ((image.data.length - comma - 1) * 3) / 4 - padding;
    if (size <= 0 || size > MAX_IMAGE_BYTES)
      throw new Error(
        `Image ${index + 1}: exceeds the 20 MiB limit or is empty`,
      );
    total += size;
    if (total > MAX_TURN_BYTES)
      throw new Error(`Image ${index + 1}: total attachments exceed 20 MiB`);
  }
}

async function writeImageBatch(
  images,
  { directory = os.tmpdir(), io = fs } = {},
) {
  checkImageEnvelope(images);
  let decodedPixels = 0;
  const decoded = images.map((image, index) => {
    try {
      const match =
        /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
          image.data,
        );
      if (!match || match[2].length % 4 !== 0)
        throw new Error("invalid MIME or base64 data");
      const data = Buffer.from(match[2], "base64");
      if (data.toString("base64") !== match[2])
        throw new Error("noncanonical base64 data");
      const info = imageDimensions(data);
      if (info.format !== match[1])
        throw new Error("MIME does not match the image format");
      if (
        !info.width ||
        !info.height ||
        info.width * info.height > MAX_IMAGE_PIXELS
      )
        throw new Error("image dimensions exceed 40 megapixels or are invalid");
      const budget = inspectImageBudget(data);
      decodedPixels += budget.decodedPixels;
      if (decodedPixels > MAX_IMAGE_PIXELS)
        throw new Error(
          "attachments exceed 40 million decoded canvas pixels in total",
        );
      return { data, extension: info.format === "jpeg" ? "jpg" : info.format };
    } catch (error) {
      throw new Error(`Image ${index + 1}: ${error.message}`);
    }
  });
  const files = [];
  try {
    for (const { data, extension } of decoded) {
      const file = path.join(
        directory,
        `cc-chat-img-${crypto.randomUUID()}.${extension}`,
      );
      // Exclusive create; remember the path only after we own its descriptor.
      const handle = await io.open(file, "wx", 0o600);
      files.push(file);
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
    }
    return files;
  } catch (error) {
    await Promise.allSettled(files.map((file) => io.unlink(file)));
    throw new Error(
      `Image ${files.length || 1}: attachment could not be written (${error.code || error.message})`,
    );
  }
}

async function writeImageTemps(
  images,
  { directory = os.tmpdir(), signal, timeoutMs = 5000 } = {},
) {
  checkImageEnvelope(images);
  if (signal?.aborted) throw new Error("Image preparation cancelled");
  if (!images.length) return [];
  // The parent owns a private staging directory before starting the worker.
  // Termination can therefore clean even a partial file created just before
  // the worker reported it, without deleting paths owned by anyone else.
  // Windows mkdtemp does not automatically expand long prefixes like mkdir
  // does. Profile/workspace storage can legitimately exceed MAX_PATH; keep
  // staging beside the destination and use the extended-length form only for
  // this filesystem call (toNamespacedPath is a no-op on other platforms).
  const staging = await fs.mkdtemp(
    path.toNamespacedPath(path.join(directory, ".cc-image-")),
  );
  const files = [];
  let worker, timer, abort;
  const deadline = performance.now() + timeoutMs;
  const check = () => {
    if (signal?.aborted) throw new Error("Image preparation cancelled");
    if (performance.now() >= deadline)
      throw new Error("Image preparation exceeded the time budget");
  };
  try {
    check();
    const prepared = await new Promise((resolve, reject) => {
      worker = new Worker(__filename, {
        workerData: { images, directory: staging },
      });
      abort = () => reject(new Error("Image preparation cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(
        () => reject(new Error("Image preparation exceeded the time budget")),
        timeoutMs,
      );
      let replied = false;
      worker.once("message", (result) => {
        replied = true;
        if (result.error) reject(new Error(result.error));
        else resolve(result.files);
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (!replied) reject(new Error(`Image preparation stopped (${code})`));
      });
    });
    clearTimeout(timer);
    for (const source of prepared) {
      check();
      const target = path.join(directory, path.basename(source));
      // Own the destination before copying so cancellation can clean it, while
      // retaining support for filesystems that do not implement hard links.
      const handle = await fs.open(target, "wx", 0o600);
      files.push(target);
      try {
        const bytes = await readImageSnapshot(source, null, {
          signal,
          timeoutMs: Math.max(1, deadline - performance.now()),
        });
        check();
        await handle.writeFile(bytes, { signal });
        check();
      } finally {
        await handle.close();
      }
    }
    check();
    return files;
  } catch (error) {
    await Promise.allSettled(files.map((file) => fs.unlink(file)));
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (worker) await worker.terminate();
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (!isMainThread && workerData?.images) {
  writeImageBatch(workerData.images, { directory: workerData.directory }).then(
    (files) => parentPort.postMessage({ files }),
    (error) => parentPort.postMessage({ error: error.message }),
  );
}

module.exports = {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TURN_BYTES,
  MAX_IMAGE_PIXELS,
  imageDimensions,
  checkImageEnvelope,
  writeImageBatch,
  writeImageTemps,
};
