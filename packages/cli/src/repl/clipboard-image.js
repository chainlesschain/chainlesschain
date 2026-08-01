/**
 * Clipboard-image capability boundary for terminal REPL hosts.
 *
 * Plain Node readline receives pasted text only; it has no portable clipboard
 * image event. We therefore enable image chips solely when an embedding host
 * supplies an explicit, testable `readImage()` binding. Standard terminals get
 * a truthful path-attachment fallback instead of a fake "paste succeeded".
 */

export const CLIPBOARD_IMAGE_MEDIA_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

export function detectClipboardImageCapability(binding) {
  if (
    binding?.supportsImagePaste === true &&
    typeof binding.readImage === "function"
  ) {
    return {
      supported: true,
      mode: "host-binding",
      reason: "The terminal host exposes clipboard image bytes.",
    };
  }
  return {
    supported: false,
    mode: "path-fallback",
    reason:
      "This terminal exposes pasted text only, not clipboard image bytes. Save the image and paste its png/jpg/gif/webp path to attach it.",
  };
}

function decodeImageData(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== "string") return null;
  const base64 = value.replace(/^data:[^;,]+;base64,/i, "").trim();
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

/**
 * Read one image from a trusted host binding and return an OpenAI-shaped image
 * content part (the CLI's provider-neutral internal multimodal shape).
 */
export async function readClipboardImageChip(binding, options = {}) {
  const capability = detectClipboardImageCapability(binding);
  if (!capability.supported) return { ok: false, ...capability };
  let image;
  try {
    image = await binding.readImage();
  } catch (error) {
    return {
      ok: false,
      supported: true,
      mode: "host-binding",
      reason: `Clipboard image read failed: ${error.message}`,
    };
  }
  if (!image) {
    return {
      ok: false,
      supported: true,
      mode: "host-binding",
      reason: "The clipboard does not currently contain an image.",
    };
  }
  const mediaType = String(image.mediaType || image.type || "").toLowerCase();
  if (!CLIPBOARD_IMAGE_MEDIA_TYPES.includes(mediaType)) {
    return {
      ok: false,
      supported: true,
      mode: "host-binding",
      reason: `Unsupported clipboard image type: ${mediaType || "unknown"}.`,
    };
  }
  const data = decodeImageData(image.data);
  if (!data?.length) {
    return {
      ok: false,
      supported: true,
      mode: "host-binding",
      reason: "The clipboard image payload is empty or invalid.",
    };
  }
  const maxBytes = Math.max(
    1,
    Number(options.maxBytes) || MAX_CLIPBOARD_IMAGE_BYTES,
  );
  if (data.length > maxBytes) {
    return {
      ok: false,
      supported: true,
      mode: "host-binding",
      reason: `Clipboard image exceeds ${maxBytes} bytes.`,
    };
  }
  return {
    ok: true,
    supported: true,
    mode: "host-binding",
    bytes: data.length,
    mediaType,
    chip: {
      type: "image_url",
      image_url: {
        url: `data:${mediaType};base64,${data.toString("base64")}`,
      },
    },
  };
}
