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
 * Claude-Code-style auto-detection: find local image-file paths mentioned in a
 * prompt so the turn can attach them as vision input. A token is treated as an
 * image only when (a) its extension is one we support and (b) the file actually
 * exists on disk — so prose like "I edited a.png" attaches only when a.png is
 * really there, and a typo'd/remote path stays as plain text. Matched path
 * tokens are stripped from the returned text ("describe ./a.png" → "describe" +
 * an attachment); an all-path message leaves empty text, which the caller turns
 * into an image-only turn. URLs / data: URIs are never auto-attached (local
 * files only). Pure except for the existence check (inject `deps.existsSync`).
 *
 * @param {string} text
 * @param {object} deps  { existsSync }
 * @returns {{ images: string[], text: string }}
 */
export function detectImagePaths(text, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  if (typeof text !== "string" || !text.trim()) {
    return { images: [], text: typeof text === "string" ? text : "" };
  }
  const exts = Object.keys(EXT_MEDIA)
    .map((e) => e.slice(1))
    .join("|"); // png|jpg|jpeg|gif|webp
  // Quoted ("…"/'…') paths first (may contain spaces), then bare
  // whitespace-delimited tokens ending in a supported image extension.
  const re = new RegExp(
    `"([^"]+?\\.(?:${exts}))"|'([^']+?\\.(?:${exts}))'|(\\S+?\\.(?:${exts}))(?=$|[\\s)\\]'",])`,
    "gi",
  );
  const images = [];
  const seen = new Set();
  const ranges = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] || m[2] || m[3];
    if (!raw) continue;
    // Local files only — never auto-attach URLs / data: URIs.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^data:/i.test(raw)) continue;
    let exists = false;
    try {
      exists = existsSync(raw);
    } catch {
      exists = false;
    }
    if (!exists) continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      images.push(raw);
    }
    ranges.push([m.index, m.index + m[0].length]);
  }
  if (!images.length) return { images: [], text };
  let out = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    out = out.slice(0, ranges[i][0]) + out.slice(ranges[i][1]);
  }
  out = out.replace(/ {2,}/g, " ").trim();
  return { images, text: out };
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

/**
 * Default vision model when none is configured — Volcengine Ark
 * Doubao-Seed-2.0-lite (id `doubao-seed-2-0-lite-260215`, dated YYMMDD =
 * 2026-02-15), a natively multimodal model (text/image/video; 2.0 has no
 * separate "-vision-" SKU). Override via --vision-model or config.llm.visionModel
 * to pin a different snapshot.
 */
export const DEFAULT_VISION_MODEL = "doubao-seed-2-0-lite-260215";

/**
 * Resolve the effective LLM config for a run. When an image is attached, default
 * the provider/model/baseUrl/apiKey to the configured vision LLM so
 * `cc agent --image foo.png` works without extra flags — using `llm.visionModel`
 * (a separate, configurable vision model) and falling back to DEFAULT_VISION_MODEL.
 * Explicit flags always win; with no image, behaviour is unchanged (vision config
 * is ignored). `--vision-model` overrides the configured/default vision model.
 *
 * @param {object} p
 * @param {boolean} p.hasImage  true when the run carries an attached image
 * @param {object}  p.flags     { provider, model, baseUrl, apiKey, visionModel }
 * @param {object}  p.llm       config.llm ({ provider, model, baseUrl, apiKey, visionModel })
 * @returns {{provider, model, baseUrl, apiKey}}
 */
export function resolveVisionLlm({ hasImage, flags = {}, llm = {} } = {}) {
  // No image → no vision override; the caller falls back to its normal LLM
  // config (`visionLlm.x || options.x`).
  if (!hasImage) {
    return {
      provider: undefined,
      model: undefined,
      baseUrl: undefined,
      apiKey: undefined,
    };
  }
  const visionModel =
    flags.visionModel || llm.visionModel || DEFAULT_VISION_MODEL;
  // `flags.model` must be the EXPLICIT `--model` (not a settings/default), so an
  // attached image uses the vision model unless the user deliberately picked one.
  return {
    provider: flags.provider || llm.provider,
    model: flags.model || visionModel,
    baseUrl: flags.baseUrl || llm.baseUrl,
    apiKey: flags.apiKey || llm.apiKey,
  };
}
