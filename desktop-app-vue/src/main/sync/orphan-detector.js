/**
 * Remote orphan file detector (Phase 3c follow-up D7).
 *
 * Determines which remote files (returned by `<client>.listRemote()`) are
 * "orphans" — i.e. exist on the remote but are NOT recorded in the local
 * `cursor.remoteFilenameMap`. These accumulate when:
 *
 *   - User renames a file in the network drive (etag changes → 412 conflict
 *     on next sync; engine SKIPS but advances local cursor → old name keeps
 *     existing remotely, new name pushed → two copies)
 *   - User keeps an old local install, then wipes vault and re-installs;
 *     the new install starts with an empty cursor map → all prior remote
 *     files are orphans
 *   - Provider switch (WebDAV ↔ OSS) leaves leftovers in the unused provider
 *
 * This module is the **manual escape hatch** mentioned in design doc D7 —
 * not automatic in the sync loop, only triggered by the user from the
 * Settings page.
 *
 * Pure-function design: takes `cursor` + `listResult` (already fetched by
 * caller), returns a diff. No I/O. webdav-ipc and oss-ipc each wire this
 * after calling their own `client.listRemote()`.
 */
"use strict";

/**
 * Detect orphans by name-diff between remote listing and cursor map.
 *
 * @param {object} args
 * @param {object} args.cursor                 — store.getCursor() result OR {}
 * @param {object} [args.cursor.remoteFilenameMap]  — { [itemId]: filename }
 * @param {Array<object>} args.listResult      — client.listRemote() output:
 *                                                [{filename, etag, size, lastmod}, ...]
 * @returns {{
 *   orphans: Array<{filename: string, etag: string|null, size: number, lastmod: string|null}>,
 *   knownCount: number,
 *   totalRemote: number,
 *   knownFilenames: Array<string>,
 * }}
 */
function detectOrphans({ cursor, listResult }) {
  if (!Array.isArray(listResult)) {
    throw new TypeError("detectOrphans: listResult must be an array");
  }
  const remoteFilenameMap = (cursor && cursor.remoteFilenameMap) || {};
  const knownFilenames = new Set(Object.values(remoteFilenameMap));

  const orphans = [];
  let knownCount = 0;
  for (const item of listResult) {
    if (!item || typeof item.filename !== "string") {
      continue;
    }
    if (knownFilenames.has(item.filename)) {
      knownCount++;
      continue;
    }
    orphans.push({
      filename: item.filename,
      etag: item.etag ?? null,
      size: item.size ?? 0,
      lastmod: item.lastmod ?? null,
    });
  }
  return {
    orphans,
    knownCount,
    totalRemote: listResult.length,
    knownFilenames: Array.from(knownFilenames),
  };
}

/**
 * Delete a list of orphan filenames via the provided client.
 * Returns per-file outcomes; safe to call with [] (returns empty arrays).
 *
 * Sends current remote etag as an If-Match guard (where supported) to
 * prevent deleting a file the user just modified between list + delete.
 * Re-fetches etag via client.getEtag(filename) if the orphan record's
 * etag is null (some S3-compat omit it from ListObjectsV2 responses).
 *
 * @param {object} args
 * @param {object} args.client             — must have deleteFile(name, etag) + getEtag(name)
 * @param {Array<{filename:string, etag?:string|null}>} args.orphans
 * @param {function} [args.logger]         — optional log({level, msg})
 * @returns {Promise<{
 *   deleted: Array<string>,
 *   skipped: Array<{filename: string, reason: string, status?: number}>,
 *   failed: Array<{filename: string, error: string, status?: number}>,
 * }>}
 */
async function deleteOrphans({ client, orphans, logger }) {
  if (!client || typeof client.deleteFile !== "function") {
    throw new TypeError("deleteOrphans: client.deleteFile required");
  }
  if (!Array.isArray(orphans)) {
    throw new TypeError("deleteOrphans: orphans must be an array");
  }
  const deleted = [];
  const skipped = [];
  const failed = [];

  for (const o of orphans) {
    if (!o || typeof o.filename !== "string" || o.filename.length === 0) {
      continue;
    }
    // Refresh etag if missing (defensive: list endpoint may omit)
    let etag = o.etag || null;
    if (!etag && typeof client.getEtag === "function") {
      try {
        etag = await client.getEtag(o.filename);
      } catch (err) {
        // getEtag fail → proceed without etag (caller can still delete unconditionally)
        if (logger) {
          logger({
            level: "warn",
            msg: `getEtag(${o.filename}) failed: ${err?.message}`,
          });
        }
      }
    }
    let res;
    try {
      res = await client.deleteFile(o.filename, etag);
    } catch (err) {
      failed.push({
        filename: o.filename,
        error: err?.message || String(err),
      });
      continue;
    }
    if (res && res.ok) {
      deleted.push(o.filename);
    } else if (res && res.conflict) {
      skipped.push({
        filename: o.filename,
        reason:
          "etag mismatch — file was modified after list; rerun list-orphans to refresh",
        status: res.status,
      });
    } else {
      failed.push({
        filename: o.filename,
        error: res?.error || "unknown error",
        status: res?.status,
      });
    }
  }
  return { deleted, skipped, failed };
}

module.exports = {
  detectOrphans,
  deleteOrphans,
};
