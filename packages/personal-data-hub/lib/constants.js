/**
 * UnifiedSchema enums + constants
 *
 * Source of truth for valid subtypes / source.capturedBy / etc.
 * Mirrors §5 of docs/design/Personal_Data_Hub_Architecture.md
 */

"use strict";

const ENTITY_TYPES = Object.freeze({
  PERSON: "person",
  EVENT: "event",
  PLACE: "place",
  ITEM: "item",
  TOPIC: "topic",
});

const PERSON_SUBTYPES = Object.freeze({
  SELF: "self",
  CONTACT: "contact",
  MERCHANT: "merchant",
  AI_AGENT: "ai-agent",
  UNKNOWN: "unknown",
});

const EVENT_SUBTYPES = Object.freeze({
  // Communication
  MESSAGE: "message",
  AI_MESSAGE: "ai-message",
  CALL: "call",
  POST: "post",
  INTERACTION: "interaction",

  // Commerce
  ORDER: "order",
  PAYMENT: "payment",
  TRANSFER: "transfer",
  REFUND: "refund",
  INCOME: "income",
  INVESTMENT: "investment",
  REDENVELOPE: "redenvelope",
  UTILITY: "utility",
  CANCELLED: "cancelled",

  // Movement
  VISIT: "visit",
  TRIP: "trip",

  // Content
  BROWSE: "browse",
  LIKE: "like",
  MEDIA: "media",

  // Special
  AI_IMAGE_GENERATION: "ai-image-generation",

  OTHER: "other",
});

const ITEM_SUBTYPES = Object.freeze({
  PRODUCT: "product",
  MEDIA: "media",
  LINK: "link",
  DOCUMENT: "document",
  OTHER: "other",
});

const CAPTURED_BY = Object.freeze({
  EXPORT: "export",
  API: "api",
  SQLITE: "sqlite",
  ACCESSIBILITY: "accessibility",
  OCR: "ocr",
  MANUAL: "manual",
});

const AMOUNT_DIRECTIONS = Object.freeze({
  IN: "in",
  OUT: "out",
});

const SCHEMA_VERSION = "0.1.0";

module.exports = {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
  AMOUNT_DIRECTIONS,
  SCHEMA_VERSION,
};
