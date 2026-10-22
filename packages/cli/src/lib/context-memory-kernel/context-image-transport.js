import { createHash, randomBytes } from "node:crypto";
import { normalizeContextItem } from "@chainlesschain/context-memory-kernel";
import { AGENT_MODEL_IMAGE_LIMITS } from "../evolution/agent-model-projection.js";
import {
  IMAGE_TOKEN_RESERVE,
  LOW_DETAIL_IMAGE_TOKEN_RESERVE,
  inspectCanonicalImageDataUrl,
} from "../image-token-estimate.js";

export const CONTEXT_IMAGE_TRANSPORT_PREFIX = "cc-context-image://v1/";
const CONTEXT_IMAGE_TRANSPORT_MARKER = "cc-context-image";

const PLACEHOLDER_URL =
  /^cc-context-image:\/\/v1\/([a-f0-9]{32})\/(sha256-[a-f0-9]{64})$/u;

function sha256(value) {
  return `sha256-${createHash("sha256").update(value, "ascii").digest("hex")}`;
}

function supportedImageUrlBlock(message, block) {
  if (
    message?.role !== "user" ||
    !Array.isArray(message.content) ||
    !block ||
    typeof block !== "object" ||
    Array.isArray(block) ||
    Object.keys(block).sort().join() !== "image_url,type" ||
    block.type !== "image_url" ||
    !block.image_url ||
    typeof block.image_url !== "object" ||
    Array.isArray(block.image_url) ||
    Object.keys(block.image_url).some((key) => !["url", "detail"].includes(key))
  )
    return null;

  const { url, detail } = block.image_url;
  if (
    typeof url !== "string" ||
    (detail !== undefined && !["auto", "low", "high"].includes(detail))
  )
    return null;
  if (
    url.length >
    Math.ceil(AGENT_MODEL_IMAGE_LIMITS.maxImageBytes / 3) * 4 + 128
  )
    throw codedTransportError(
      "Image transport exceeds its per-image byte budget",
    );
  const image = inspectCanonicalImageDataUrl(url);
  return image ? { url, detail, bytes: image.decodedBytes } : null;
}

function codedTransportError(message) {
  const error = new Error(message);
  error.code = "CC_CONTEXT_IMAGE_TRANSPORT_INVALID";
  return error;
}

/** Replace supported user image data URLs with request-local digest commitments. */
export function captureContextImageTransport(messagesInput) {
  const messages = Array.isArray(messagesInput) ? messagesInput : [];
  const captures = new Map();
  let requestImageBytes = 0;
  let changed = false;
  const transportedMessages = messages.map((message) => {
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      return message;
    }

    let contentChanged = false;
    let messageImageBytes = 0;
    let messageImageCount = 0;
    const content = message.content.map((block) => {
      const image = supportedImageUrlBlock(message, block);
      if (!image) return block;

      messageImageCount++;
      messageImageBytes += image.bytes;
      requestImageBytes += image.bytes;
      if (
        image.bytes > AGENT_MODEL_IMAGE_LIMITS.maxImageBytes ||
        messageImageCount > AGENT_MODEL_IMAGE_LIMITS.maxMessageImages ||
        messageImageBytes > AGENT_MODEL_IMAGE_LIMITS.maxMessageImageBytes ||
        requestImageBytes > AGENT_MODEL_IMAGE_LIMITS.maxRequestImageBytes
      )
        throw codedTransportError(
          "Images exceed the bounded message or request image budget",
        );

      const digest = sha256(image.url);
      const nonce = randomBytes(16).toString("hex");
      const placeholder = `${CONTEXT_IMAGE_TRANSPORT_PREFIX}${nonce}/${digest}`;
      captures.set(placeholder, {
        url: image.url,
        digest,
        detail: image.detail,
        hasDetail: Object.hasOwn(block.image_url, "detail"),
        reserveTokens:
          image.detail === "low"
            ? LOW_DETAIL_IMAGE_TOKEN_RESERVE
            : IMAGE_TOKEN_RESERVE,
      });
      contentChanged = true;
      changed = true;
      return {
        ...block,
        image_url: { ...block.image_url, url: placeholder },
      };
    });
    return contentChanged ? { ...message, content } : message;
  });

  return {
    messages: changed ? transportedMessages : messages,
    captures,
  };
}

/** Preserve image token reserves while removing transport placeholders from item digests. */
export function adjustContextImageTokenEstimates(itemsInput, captures) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  if (!(captures instanceof Map) || captures.size === 0) return items;

  return items.map((item) => {
    if (typeof item?.content !== "string") return item;
    let placeholderBytes = 0;
    let reserveTokens = 0;
    for (const [placeholder, capture] of captures) {
      const first = item.content.indexOf(placeholder);
      if (first < 0) continue;
      if (item.content.indexOf(placeholder, first + placeholder.length) >= 0) {
        throw codedTransportError(
          "A context image transport placeholder was duplicated during planning",
        );
      }
      placeholderBytes += Buffer.byteLength(placeholder, "utf8");
      reserveTokens += capture.reserveTokens;
    }
    if (placeholderBytes === 0) return item;

    const { digest: _previousDigest, ...withoutDigest } = item;
    return normalizeContextItem({
      ...withoutDigest,
      tokenEstimate: Math.max(
        1,
        Math.ceil(
          (Buffer.byteLength(item.content, "utf8") - placeholderBytes) / 4,
        ) + reserveTokens,
      ),
    });
  });
}

function containsTransportImageUrl(messages) {
  return messages.some(
    (message) =>
      Array.isArray(message?.content) &&
      message.content.some(
        (block) =>
          block?.type === "image_url" &&
          typeof block.image_url?.url === "string" &&
          block.image_url.url.includes(CONTEXT_IMAGE_TRANSPORT_MARKER),
      ),
  );
}

function containsCapturedPlaceholder(value, captures, seen = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(
      /cc-context-image:\/\/v1\/[a-f0-9]{32}\/sha256-[a-f0-9]{64}/gu,
    )) {
      if (captures.has(match[0])) return true;
    }
    return false;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) =>
    containsCapturedPlaceholder(entry, captures, seen),
  );
}

/** Restore captured image data URLs and reject every unrecognized or altered placeholder. */
export function restoreContextImageTransport(messagesInput, captures) {
  const messages = Array.isArray(messagesInput) ? messagesInput : [];
  const captured = captures instanceof Map ? captures : new Map();
  const seenPlaceholders = new Set();
  const restored = messages.map((message) => {
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      return message;
    }
    let contentChanged = false;
    const content = message.content.map((block) => {
      if (
        !block ||
        typeof block !== "object" ||
        Array.isArray(block) ||
        block.type !== "image_url" ||
        !block.image_url ||
        typeof block.image_url !== "object" ||
        Array.isArray(block.image_url) ||
        typeof block.image_url.url !== "string" ||
        !block.image_url.url.includes(CONTEXT_IMAGE_TRANSPORT_MARKER)
      )
        return block;

      const placeholder = block.image_url.url;
      const match = PLACEHOLDER_URL.exec(placeholder);
      const capture = captured.get(placeholder);
      if (
        Object.keys(block).sort().join() !== "image_url,type" ||
        Object.keys(block.image_url).some(
          (key) => !["url", "detail"].includes(key),
        ) ||
        (block.image_url.detail !== undefined &&
          !["auto", "low", "high"].includes(block.image_url.detail)) ||
        !match ||
        !capture ||
        capture.hasDetail !== Object.hasOwn(block.image_url, "detail") ||
        capture.detail !== block.image_url.detail ||
        match[2] !== capture.digest ||
        sha256(capture.url) !== capture.digest ||
        seenPlaceholders.has(placeholder)
      ) {
        throw codedTransportError(
          "A context image transport placeholder is unknown, altered, or duplicated",
        );
      }
      seenPlaceholders.add(placeholder);
      contentChanged = true;
      return {
        ...block,
        image_url: { ...block.image_url, url: capture.url },
      };
    });
    return contentChanged ? { ...message, content } : message;
  });

  if (
    containsTransportImageUrl(restored) ||
    containsCapturedPlaceholder(restored, captured)
  ) {
    throw codedTransportError(
      "An unrecognized context image transport placeholder reached provider context",
    );
  }
  return restored;
}
