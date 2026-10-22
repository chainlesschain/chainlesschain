// Context planning estimates vision work separately from base64 transport.
// Providers and models meter images differently. These are planning reserves;
// provider usage receipts remain authoritative for token and cost settlement.
export const IMAGE_TOKEN_RESERVE = 8192;
export const LOW_DETAIL_IMAGE_TOKEN_RESERVE = 1024;
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function inspectCanonicalImageDataUrl(url) {
  if (typeof url !== "string") return null;
  const match =
    /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
      url,
    );
  if (!match || match[1].length % 4 !== 0) return null;
  const data = match[1];
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const finalValue = BASE64_ALPHABET.indexOf(data[data.length - padding - 1]);
  if (
    (padding === 2 && finalValue % 16 !== 0) ||
    (padding === 1 && finalValue % 4 !== 0)
  )
    return null;
  return {
    decodedBytes: (data.length / 4) * 3 - padding,
    encodedBytes: data.length,
  };
}

export function imageTransportEstimate(messages) {
  let bytes = 0;
  let tokens = 0;
  for (const message of messages) {
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (
        block?.type !== "image_url" ||
        Object.keys(block).sort().join() !== "image_url,type" ||
        !block.image_url ||
        Object.keys(block.image_url).some(
          (key) => !["url", "detail"].includes(key),
        )
      )
        continue;
      const { url, detail } = block.image_url;
      if (
        typeof url !== "string" ||
        (detail !== undefined && !["auto", "low", "high"].includes(detail)) ||
        !inspectCanonicalImageDataUrl(url)
      )
        continue;
      // Canonical base64 data URLs are ASCII and need no JSON escaping.
      bytes += url.length;
      tokens +=
        detail === "low" ? LOW_DETAIL_IMAGE_TOKEN_RESERVE : IMAGE_TOKEN_RESERVE;
    }
  }
  return { bytes, tokens };
}
