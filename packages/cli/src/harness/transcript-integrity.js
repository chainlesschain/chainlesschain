/**
 * Transcript integrity — hash-chained JSONL session transcripts.
 *
 * Every event appended to a session transcript carries `prevHash` (the hash of
 * the previous event, or null for the first chained event) and `hash` — a
 * SHA-256 over the previous hash plus the event's canonical core
 * (`{type, timestamp, data}`). Editing, deleting, inserting, or reordering any
 * chained line breaks the chain and is detected by `verifyTranscriptLines`.
 *
 * Design constraints:
 * - Pure module: no fs, no paths — the store layer (jsonl-session-store.js)
 *   owns file IO so this stays cycle-free and unit-testable in isolation.
 * - Backward compatible: transcripts written before chaining have no hash
 *   fields. A fully legacy file verifies as `legacy`; a legacy prefix followed
 *   by a valid chain is `partial` (chaining starts on the first upgraded
 *   append). An UNchained record appearing AFTER chained records is flagged as
 *   tampered — our writer never does that, so it is either a downgrade-write
 *   or a manual append, both of which the verifier must surface.
 * - Honest limitation: truncating the file tail (deleting the newest N chained
 *   lines) is undetectable without an external anchor — the chain is
 *   self-contained. A half-written LAST line (crash mid-append) is reported as
 *   `truncatedTail: true` rather than tampered.
 */

import { createHash } from "node:crypto";

export const TRANSCRIPT_CHAIN_STATUS = Object.freeze({
  VERIFIED: "verified", // every record chained + chain valid
  PARTIAL: "partial", // legacy prefix, then a valid chain
  LEGACY: "legacy", // no chained records at all (pre-chaining transcript)
  TAMPERED: "tampered", // chain broken: edit / delete / insert / reorder
  EMPTY: "empty", // no records
});

/**
 * Hash one event's canonical core against the previous chain hash.
 * The core is rebuilt field-by-field (not the raw line) so the hash is
 * independent of the presence/position of the prevHash/hash fields themselves;
 * JSON.parse → JSON.stringify preserves the writer's key insertion order for
 * `data`, so writer and verifier serialize identically.
 */
export function computeEventHash(prevHash, core) {
  const canonical = JSON.stringify({
    type: core.type,
    timestamp: core.timestamp,
    data: core.data,
  });
  return createHash("sha256")
    .update(`${prevHash || "genesis"}\n${canonical}`, "utf-8")
    .digest("hex");
}

/**
 * The hash the NEXT appended event must chain from: the `hash` of the last
 * parseable line, or null when the file is empty / fully legacy / the last
 * parseable line is unchained. A trailing half-written line (crash mid-append)
 * is skipped so the writer chains from the last intact record.
 */
export function latestChainHash(text) {
  const lines = String(text || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      return typeof event?.hash === "string" ? event.hash : null;
    } catch {
      // half-written tail line — chain from the previous intact record
      continue;
    }
  }
  return null;
}

/**
 * Verify a transcript's hash chain.
 *
 * @param {string[]} lines raw transcript lines (as split on "\n")
 * @returns {{
 *   status: string,            // TRANSCRIPT_CHAIN_STATUS value
 *   chainedEvents: number,
 *   legacyEvents: number,
 *   malformedLines: number,
 *   truncatedTail: boolean,    // last non-empty line is half-written JSON
 *   firstInvalidLine: number|null, // 1-based line number of the first break
 *   reason: string|null,
 * }}
 */
export function verifyTranscriptLines(lines) {
  const input = Array.isArray(lines) ? lines : [];
  let lastNonEmpty = -1;
  for (let i = input.length - 1; i >= 0; i--) {
    if (input[i] && input[i].trim()) {
      lastNonEmpty = i;
      break;
    }
  }

  const result = {
    status: TRANSCRIPT_CHAIN_STATUS.EMPTY,
    chainedEvents: 0,
    legacyEvents: 0,
    malformedLines: 0,
    truncatedTail: false,
    firstInvalidLine: null,
    reason: null,
  };

  let lastHash = null;
  let sawChain = false;

  const tampered = (lineNo, reason) => {
    result.status = TRANSCRIPT_CHAIN_STATUS.TAMPERED;
    result.firstInvalidLine = lineNo;
    result.reason = reason;
    return result;
  };

  for (let i = 0; i < input.length; i++) {
    const line = input[i];
    if (!line || !line.trim()) continue;
    const lineNo = i + 1;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      result.malformedLines++;
      if (i === lastNonEmpty) {
        // Crash mid-append: the newest line is half-written. Not tampering —
        // report it so callers can surface a warning.
        result.truncatedTail = true;
        continue;
      }
      if (sawChain) {
        return tampered(lineNo, "malformed line inside hash chain");
      }
      continue; // junk inside the legacy region — validate reports it
    }

    if (event && typeof event.hash === "string") {
      const expectedPrev = sawChain ? lastHash : null;
      if ((event.prevHash ?? null) !== expectedPrev) {
        return tampered(
          lineNo,
          sawChain
            ? "hash chain linkage broken (record deleted, inserted, or reordered)"
            : "chain does not start at a genesis record (head records removed)",
        );
      }
      if (computeEventHash(expectedPrev, event) !== event.hash) {
        return tampered(lineNo, "event content does not match its hash");
      }
      sawChain = true;
      lastHash = event.hash;
      result.chainedEvents++;
    } else {
      if (sawChain) {
        return tampered(
          lineNo,
          "unchained record after hash chain started (manual append or downgrade write)",
        );
      }
      result.legacyEvents++;
    }
  }

  if (result.chainedEvents > 0) {
    result.status =
      result.legacyEvents > 0
        ? TRANSCRIPT_CHAIN_STATUS.PARTIAL
        : TRANSCRIPT_CHAIN_STATUS.VERIFIED;
  } else if (result.legacyEvents > 0 || result.malformedLines > 0) {
    result.status = TRANSCRIPT_CHAIN_STATUS.LEGACY;
  }
  return result;
}

/** Convenience wrapper for whole-file text. */
export function verifyTranscriptText(text) {
  return verifyTranscriptLines(String(text || "").split("\n"));
}
