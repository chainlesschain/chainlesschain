/** Pure session-generation schema shared by persistence and source projections. */
export const SESSION_GENERATION_AUTHORITY_FIELD = "_sessionGeneration";
export const SESSION_GENERATION_AUTHORITY_SCHEMA =
  "chainlesschain.session-generation-authority/v1";

export function normalizeSessionGenerationAuthority(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== SESSION_GENERATION_AUTHORITY_SCHEMA ||
    typeof value.sessionId !== "string" ||
    value.sessionId.length === 0 ||
    typeof value.generationId !== "string" ||
    !/^generation-[0-9a-f-]{32,36}$/.test(value.generationId) ||
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 1
  ) {
    return null;
  }
  let predecessor = null;
  if (value.predecessor !== null) {
    const previous = value.predecessor;
    if (
      !previous ||
      typeof previous !== "object" ||
      Array.isArray(previous) ||
      !["tombstone", "legacy-tombstone"].includes(previous.kind) ||
      (previous.generationId !== null &&
        (typeof previous.generationId !== "string" ||
          !/^generation-[0-9a-f-]{32,36}$/.test(previous.generationId))) ||
      (previous.headHash !== null &&
        (typeof previous.headHash !== "string" ||
          !/^[0-9a-f]{64}$/.test(previous.headHash))) ||
      !Number.isSafeInteger(previous.eventCount) ||
      previous.eventCount < 0 ||
      (previous.tombstonedAtMs !== null &&
        (!Number.isSafeInteger(previous.tombstonedAtMs) ||
          previous.tombstonedAtMs < 0))
    ) {
      return null;
    }
    predecessor = {
      kind: previous.kind,
      generationId: previous.generationId,
      headHash: previous.headHash,
      eventCount: previous.eventCount,
      tombstonedAtMs: previous.tombstonedAtMs,
    };
  }
  return {
    schema: SESSION_GENERATION_AUTHORITY_SCHEMA,
    sessionId: value.sessionId,
    generationId: value.generationId,
    ordinal: value.ordinal,
    predecessor,
  };
}
