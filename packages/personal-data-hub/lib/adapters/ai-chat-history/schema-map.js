/**
 * RawConversation / RawMessage → UnifiedSchema normalized batch.
 *
 * Mirrors `docs/design/Adapter_AIChat_History.md` §5.2. This module is
 * pure-transform: given a RawConversation + its RawMessage[], it returns a
 * {events, persons, topics, items} bundle ready for the AdapterRegistry to
 * write into LocalVault.
 *
 * Why pure: it's the easiest part to test exhaustively without any HTTP
 * mocks. Vendor sub-adapters (skeletons in Phase 10.1) only need to produce
 * Raw* objects matching the documented shape; this module handles the rest.
 */

"use strict";

const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { newId } = require("../../ids");

const SELF_PERSON_ID = "person-self";
const ADAPTER_NAME = "ai-chat-history";
const ADAPTER_VERSION = "0.2.0";

function personIdForVendor(vendor) {
  return `person-ai-${vendor}`;
}

function topicIdForConversation(vendor, originalConvId) {
  return `topic-aiconv-${vendor}-${originalConvId}`;
}

/**
 * Build the vendor "AI agent" Person entity. The hub upserts these once per
 * vendor — the consistent `id` form means re-emitting from multiple sync
 * passes is idempotent.
 */
function buildVendorPerson(vendor, displayName) {
  const now = Date.now();
  return {
    id: personIdForVendor(vendor),
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.AI_AGENT,
    names: [displayName],
    identifiers: { vendor },
    notes: `${displayName} — 用户的 ${displayName} AI 助手账户`,
    ingestedAt: now,
    source: {
      adapter: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
      originalId: `vendor:${vendor}`,
      capturedAt: now,
      capturedBy: CAPTURED_BY.API,
    },
  };
}

/**
 * Build the conversation Topic entity.
 */
function buildConversationTopic(rawConv) {
  const now = Date.now();
  return {
    id: topicIdForConversation(rawConv.vendor, rawConv.originalId),
    type: ENTITY_TYPES.TOPIC,
    name: rawConv.title || "(无标题对话)",
    ingestedAt: now,
    source: {
      adapter: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
      originalId: `${rawConv.vendor}:conv:${rawConv.originalId}`,
      capturedAt: Number(rawConv.updatedAt) || Number(rawConv.createdAt) || now,
      capturedBy: CAPTURED_BY.API,
    },
    extra: {
      vendor: rawConv.vendor,
      kind: "ai-conversation",
      modelName: rawConv.modelName,
      conversationOriginalId: rawConv.originalId,
      createdAt: rawConv.createdAt,
      updatedAt: rawConv.updatedAt,
      messageCount: rawConv.messageCount,
      archived: Boolean(rawConv.archived),
    },
  };
}

/**
 * Build an Event entity for one message.
 *
 * - role "user"      → actor = self,             subtype = ai-message
 * - role "assistant" → actor = person-ai-vendor, subtype = ai-message
 * - vendor=dreamina + generatedImages → subtype overridden to ai-image-generation
 */
function buildMessageEvent(rawMsg, capturedAt) {
  const vendorPersonId = personIdForVendor(rawMsg.vendor);
  const actor = rawMsg.role === "user" ? SELF_PERSON_ID : vendorPersonId;
  const subtype =
    rawMsg.content && Array.isArray(rawMsg.content.generatedImages) && rawMsg.content.generatedImages.length > 0
      ? EVENT_SUBTYPES.AI_IMAGE_GENERATION
      : EVENT_SUBTYPES.AI_MESSAGE;
  const now = Date.now();
  // Schema requires positive integer ms timestamps for occurredAt / ingestedAt
  // / source.capturedAt — see lib/schemas.js validateEvent + validateBaseEntity.
  const occurredAtMs = Number(rawMsg.createdAt);
  // Deterministic id keyed on (vendor, originalId) so re-syncs hit
  // ON CONFLICT(id) DO UPDATE in putEvent and stay idempotent (instead of
  // throwing on the secondary UNIQUE(source_adapter, source_original_id)
  // constraint with a fresh newId() each time).
  return {
    id: `evt-aichat-${rawMsg.vendor}-${rawMsg.originalId}`,
    type: ENTITY_TYPES.EVENT,
    subtype,
    occurredAt: Number.isFinite(occurredAtMs) && occurredAtMs > 0 ? occurredAtMs : now,
    actor,
    participants: [SELF_PERSON_ID, vendorPersonId],
    content: {
      text: (rawMsg.content && rawMsg.content.text) || undefined,
      mediaRefs: rawMsg.content && Array.isArray(rawMsg.content.attachments)
        ? rawMsg.content.attachments.map((a) => a.url).filter(Boolean)
        : undefined,
    },
    topics: [topicIdForConversation(rawMsg.vendor, rawMsg.conversationId)],
    ingestedAt: now,
    source: {
      adapter: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
      originalId: `${rawMsg.vendor}/${rawMsg.originalId}`,
      capturedAt: Number(capturedAt) || now,
      capturedBy: CAPTURED_BY.API,
    },
    extra: {
      vendor: rawMsg.vendor,
      conversationOriginalId: rawMsg.conversationId,
      role: rawMsg.role,
      modelName: rawMsg.modelName,
      parentMessageId: rawMsg.parentMessageId,
      toolCalls: rawMsg.content ? rawMsg.content.toolCalls : undefined,
      generatedImages: rawMsg.content ? rawMsg.content.generatedImages : undefined,
    },
  };
}

/**
 * Build Item entities for any generated images. Each image becomes a `media`
 * Item so KG queries like "what images did I generate this month" work.
 */
function buildGeneratedImageItems(rawMsg) {
  if (!rawMsg.content || !Array.isArray(rawMsg.content.generatedImages)) return [];
  const now = Date.now();
  const capturedAt = Number(rawMsg.createdAt) || now;
  return rawMsg.content.generatedImages.map((img, idx) => ({
    id: `item-aichat-${rawMsg.vendor}-${rawMsg.originalId}-${idx}`,
    type: ENTITY_TYPES.ITEM,
    subtype: ITEM_SUBTYPES.MEDIA,
    name: (img.prompt || "AI image").slice(0, 80),
    ingestedAt: now,
    source: {
      adapter: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
      originalId: `${rawMsg.vendor}:img:${rawMsg.originalId}:${idx}`,
      capturedAt,
      capturedBy: CAPTURED_BY.API,
    },
    extra: {
      vendor: rawMsg.vendor,
      kind: "ai-generated-image",
      prompt: img.prompt,
      model: img.model,
      url: img.url,
      params: img.params,
    },
  }));
}

/**
 * Convert one RawConversation + its messages into a NormalizedBatch.
 *
 * @param {object} rawConv
 * @param {Array} rawMessages
 * @param {object} [vendorMeta]   { displayName: string }
 * @param {number} [capturedAt]
 * @returns {{events:Array,persons:Array,places:Array,items:Array,topics:Array}}
 */
function conversationToBatch(rawConv, rawMessages, vendorMeta, capturedAt) {
  if (!rawConv || typeof rawConv !== "object") {
    throw new Error("conversationToBatch: rawConv required");
  }
  if (!Array.isArray(rawMessages)) {
    throw new Error("conversationToBatch: rawMessages must be an array");
  }
  const vendorPerson = buildVendorPerson(rawConv.vendor, (vendorMeta && vendorMeta.displayName) || rawConv.vendor);
  const topic = buildConversationTopic(rawConv);

  const events = [];
  const items = [];
  for (const msg of rawMessages) {
    if (msg.vendor !== rawConv.vendor) {
      throw new Error(
        `conversationToBatch: message vendor "${msg.vendor}" != conv vendor "${rawConv.vendor}"`,
      );
    }
    events.push(buildMessageEvent(msg, capturedAt));
    items.push(...buildGeneratedImageItems(msg));
  }

  return {
    events,
    persons: [vendorPerson],
    places: [],
    items,
    topics: [topic],
  };
}

/**
 * Merge multiple NormalizedBatch results. Vendor Person is deduped by id
 * (every batch declares the same `person-ai-<vendor>` so we collapse).
 */
function mergeBatches(batches) {
  const events = [];
  const personsById = new Map();
  const places = [];
  const items = [];
  const topicsById = new Map();
  for (const b of batches) {
    for (const e of b.events) events.push(e);
    for (const p of b.persons) personsById.set(p.id, p);
    for (const pl of b.places) places.push(pl);
    for (const it of b.items) items.push(it);
    for (const t of b.topics) topicsById.set(t.id, t);
  }
  return {
    events,
    persons: [...personsById.values()],
    places,
    items,
    topics: [...topicsById.values()],
  };
}

module.exports = {
  SELF_PERSON_ID,
  ADAPTER_NAME,
  ADAPTER_VERSION,
  personIdForVendor,
  topicIdForConversation,
  buildVendorPerson,
  buildConversationTopic,
  buildMessageEvent,
  buildGeneratedImageItems,
  conversationToBatch,
  mergeBatches,
};
