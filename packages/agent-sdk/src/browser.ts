/**
 * Browser-safe entry — protocol types, NDJSON framing, and the bg-* frame
 * helpers used by web-panel. No Node imports.
 */

export * from "./protocol.js";
export { createNdjsonDecoder, encodeNdjson } from "./ndjson.js";

import type {
  BgWsPushFrame,
  BgWsRequest,
  BgWsRequestType,
} from "./protocol.js";

/** Build a typed bg-* request frame for the WS gateway. */
export function bgRequest(
  type: BgWsRequestType,
  fields: Omit<BgWsRequest, "type"> = {},
): BgWsRequest {
  return { type, ...fields };
}

export function isBgPushFrame(value: unknown): value is BgWsPushFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as { type?: unknown; bgId?: unknown };
  return (
    (frame.type === "bg-event" || frame.type === "bg-log") &&
    typeof frame.bgId === "string"
  );
}
