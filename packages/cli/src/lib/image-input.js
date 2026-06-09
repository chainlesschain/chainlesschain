/**
 * image-input — multimodal (vision) input for `cc agent`.
 *
 * cc's internal message format is OpenAI-shaped, so the internal multimodal
 * representation is OpenAI's: a user message whose `content` is an array of
 * `{type:"text"}` / `{type:"image_url", image_url:{url:"data:<media>;base64,..."}}`
 * parts. The OpenAI-compatible providers (openai/volcengine/deepseek/…) accept
 * that verbatim, so their branch needs no conversion. ollama and anthropic use
 * different shapes — `toOllamaMessages` and `imageUrlBlockToAnthropic` convert.
 *
 * All functions are pure (except `resolveImages`, which reads files via the
 * injectable `_deps.fs`).
 */

import fs from "fs";
import path from "path";

const EXT_MEDIA = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Read `--image <path>` values into `[{ mediaType, data(base64) }]`.
 * Throws on an unsupported extension so a typo fails loudly instead of sending
 * a broken request.
 */
export function resolveImages(paths, deps = {}) {
  const _fs = deps.fs || fs;
  if (!Array.isArray(paths) || paths.length === 0) return [];
  return paths.map((p) => {
    const ext = path.extname(String(p)).toLowerCase();
    const mediaType = EXT_MEDIA[ext];
    if (!mediaType) {
      throw new Error(
        `Unsupported image type "${ext || p}" — use png/jpg/jpeg/gif/webp.`,
      );
    }
    const data = _fs.readFileSync(p).toString("base64");
    return { mediaType, data };
  });
}

/**
 * Build a user-message `content`: the plain string when there are no images,
 * else an OpenAI-style multimodal array (the internal representation).
 */
export function buildUserContent(text, images) {
  if (!Array.isArray(images) || images.length === 0) return text;
  const parts = [];
  if (text) parts.push({ type: "text", text });
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.data}` },
    });
  }
  return parts;
}

/** Parse a `data:<media>;base64,<data>` URL into `{ mediaType, data }` or null. */
export function parseDataUrl(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ""));
  return m ? { mediaType: m[1], data: m[2] } : null;
}

/** True when a message carries any image_url part (i.e. needs provider conversion). */
export function hasImageContent(messages) {
  return (messages || []).some(
    (m) =>
      Array.isArray(m?.content) &&
      m.content.some((p) => p?.type === "image_url"),
  );
}

/**
 * Convert OpenAI-shaped multimodal messages for the ollama `/api/chat` body:
 * ollama wants `{ content: "<text>", images: ["<base64>", …] }` (bare base64,
 * no `data:` prefix). Non-multimodal messages pass through untouched.
 */
export function toOllamaMessages(messages) {
  return (messages || []).map((m) => {
    if (!m || !Array.isArray(m.content)) return m;
    let text = "";
    const images = [];
    for (const part of m.content) {
      if (part?.type === "text") {
        text += (text ? "\n" : "") + (part.text || "");
      } else if (part?.type === "image_url") {
        const parsed = parseDataUrl(part.image_url?.url);
        if (parsed) images.push(parsed.data);
        else if (part.image_url?.url) images.push(part.image_url.url);
      }
    }
    const out = { ...m, content: text };
    if (images.length) out.images = images;
    return out;
  });
}

/**
 * Convert one OpenAI `image_url` content block into an Anthropic `image` block,
 * or null when it isn't an image_url block / has no usable data URL.
 */
export function imageUrlBlockToAnthropic(block) {
  if (!block || block.type !== "image_url") return null;
  const parsed = parseDataUrl(block.image_url?.url);
  if (!parsed) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
  };
}
