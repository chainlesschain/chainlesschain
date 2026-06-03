/**
 * PDH Vault Browser — export helpers.
 *
 * Pure functions that serialize an array of events to JSON / NDJSON / CSV.
 * Used by PdhVaultBrowser's export dropdown; client-side blob download —
 * no server round-trip. The exported file IS the renderer-visible event
 * list (current page or accumulated pages), NOT a full vault dump (use
 * `cc hub export` for that).
 */

/**
 * Format events as a pretty-printed JSON array.
 * @param {Array<object>} events
 * @returns {string}
 */
export function eventsToJson(events) {
  return JSON.stringify(events, null, 2);
}

/**
 * Format events as newline-delimited JSON (one event per line).
 * @param {Array<object>} events
 * @returns {string}
 */
export function eventsToNdjson(events) {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * Format events as CSV. Header row + flattened scalar fields. Nested
 * `content` / `extra` / `source` are JSON-stringified into single cells
 * (the cell contains a JSON object as text — Excel users can re-parse it
 * via a follow-up =JSON column or by re-importing as JSON).
 *
 * Escapes embedded commas / newlines / double-quotes per RFC 4180.
 */
export function eventsToCsv(events) {
  const COLS = [
    "id",
    "subtype",
    "occurredAt",
    "occurredAtIso",
    "actor",
    "place",
    "adapter",
    "summary",
    "contentJson",
    "extraJson",
  ];
  const header = COLS.join(",");
  const rows = events.map((e) => {
    const occ = Number.isFinite(e.occurredAt) ? e.occurredAt : null;
    const iso = occ ? new Date(occ).toISOString() : "";
    const adapter = (e.source && e.source.adapter) || "";
    const summary =
      (e.content && (e.content.text || e.content.title || e.content.subject)) || "";
    const cells = [
      e.id || "",
      e.subtype || "",
      occ != null ? String(occ) : "",
      iso,
      e.actor || "",
      e.place || "",
      adapter,
      summary,
      e.content ? JSON.stringify(e.content) : "",
      e.extra ? JSON.stringify(e.extra) : "",
    ];
    return cells.map(_csvEscape).join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

function _csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Trigger a client-side file download. Only callable in a browser env (uses
 * URL.createObjectURL). Returns the suggested filename for tests.
 */
export function downloadAs(content, filename, mime = "application/octet-stream") {
  if (typeof window === "undefined" || typeof document === "undefined") {
    // SSR / test envs without DOM — return early. Tests should invoke
    // the formatters directly, not this helper.
    return filename;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the URL on next tick — Chrome holds onto it for the click event.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Suggest a filename based on format + current timestamp + optional category
 * filter. Example: `pdh-events-2026-05-24-shopping.csv`.
 */
export function suggestFilename(format, category = null) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const ext = format === "ndjson" ? "ndjson" : format;
  const catSuffix = category ? `-${category}` : "";
  return `pdh-events-${yyyy}-${mm}-${dd}${catSuffix}.${ext}`;
}
