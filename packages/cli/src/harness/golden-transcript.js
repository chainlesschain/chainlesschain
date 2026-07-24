/**
 * Normalize runtime events before comparing them with a golden transcript.
 *
 * Runtime envelopes intentionally contain volatile identity and timing fields.
 * Golden files should describe observable behavior, not a particular run, so
 * those fields are removed recursively and platform-specific workspace paths
 * are replaced with a stable token.
 */

const VOLATILE_KEYS = new Set([
  "eventId",
  "id",
  "requestId",
  "sessionId",
  "sequence",
  "timestamp",
  "createdAt",
  "updatedAt",
  "duration",
  "durationMs",
  "permission_decision_id",
  "tool_use_id",
  "turn_id",
  "toolTelemetryRecord",
]);

function normalizeString(value, workspace) {
  if (!workspace) return value;
  const variants = new Set([
    workspace,
    workspace.replaceAll("\\", "/"),
    workspace.replaceAll("/", "\\"),
  ]);
  let normalized = value;
  for (const variant of variants) {
    normalized = normalized.split(variant).join("<WORKSPACE>");
  }
  return normalized.replaceAll("<WORKSPACE>\\", "<WORKSPACE>/");
}

function normalizeValue(value, workspace) {
  if (typeof value === "string") return normalizeString(value, workspace);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, workspace));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeValue(item, workspace)]),
  );
}

/**
 * @param {Array<object>} events
 * @param {{workspace?: string, ignoredTypes?: string[]}} [options]
 */
export function normalizeGoldenTranscript(events, options = {}) {
  if (!Array.isArray(events)) {
    throw new TypeError("Golden transcript input must be an array");
  }
  const ignored = new Set(options.ignoredTypes || ["run-started", "run-ended"]);
  return events
    .filter((event) => !ignored.has(event?.type))
    .map((event) => normalizeValue(event, options.workspace));
}
