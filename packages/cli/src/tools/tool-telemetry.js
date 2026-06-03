import { createTelemetryRecord } from "../runtime/contracts/telemetry-record.js";

export function createToolTelemetryTags(descriptor, extraTags = []) {
  const baseTags = Array.isArray(descriptor?.telemetry?.tags)
    ? descriptor.telemetry.tags
    : [];
  const tags = [
    ...baseTags,
    descriptor?.name ? `tool:${descriptor.name}` : null,
    descriptor?.kind ? `kind:${descriptor.kind}` : null,
    ...extraTags,
  ].filter(Boolean);
  return [...new Set(tags)];
}

export function createToolTelemetryRecord({
  descriptor,
  status = "completed",
  durationMs = 0,
  sessionId = null,
  metadata = {},
} = {}) {
  return {
    ...createTelemetryRecord({
      kind: "tool-execution",
      source: descriptor?.source || "runtime",
    }, {
      ...metadata,
      category: descriptor?.telemetry?.category || descriptor?.kind || "tool",
      tags: createToolTelemetryTags(descriptor),
    }),
    toolName: descriptor?.name || null,
    category: descriptor?.telemetry?.category || descriptor?.kind || "tool",
    status,
    durationMs,
    sessionId,
    metadata,
  };
}
