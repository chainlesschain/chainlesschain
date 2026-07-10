/**
 * artifact WS protocol — exposes the agent-published deliverable store
 * (lib/artifact-store.js, P1 #10) to web-panel / IDE clients so an
 * "Artifacts" panel can list deliverables, preview them (text inline /
 * images as base64), and manage retention.
 *
 * Routes (request → reply):
 *   artifact-list    {session?, kind?}         → {type:"artifact-list", artifacts}
 *   artifact-show    {artifactId}              → {type:"artifact-show", artifact}
 *   artifact-content {artifactId, maxBytes?}   → {type:"artifact-content", artifactId,
 *                                                 mime, encoding, content, size,
 *                                                 truncated, previewable}
 *   artifact-remove  {artifactId}              → {type:"artifact-remove", removed, found}
 *   artifact-clean   {}                        → {type:"artifact-clean", removed}
 *
 * Preview policy: text mimes stream as utf8 (capped, `truncated` flagged);
 * images as base64 (hard cap — an oversized image reports previewable:false
 * instead of flooding the socket); everything else is metadata-only
 * (previewable:false, the user has `cc artifacts open <id>` locally).
 *
 * The stored-copy filename comes from index.jsonl; serving is refused if it
 * is not a plain basename, so a hand-tampered index row can never turn the
 * content route into an arbitrary-file read.
 */

import path from "node:path";
import { readFileSync, statSync } from "node:fs";

/** Text preview cap (utf8 chars ≈ bytes for the common case). */
export const TEXT_PREVIEW_CAP = 256 * 1024;
/** Image preview cap — beyond this the panel gets metadata only. */
export const IMAGE_PREVIEW_CAP = 8 * 1024 * 1024;

const TEXT_APPLICATION_MIMES = new Set([
  "application/json",
  "application/yaml",
  "application/xml",
]);

async function loadStore() {
  const { ArtifactStore } = await import("../../lib/artifact-store.js");
  return new ArtifactStore();
}

function sendError(server, id, ws, code, message) {
  server._send(ws, { id, type: "error", code, message });
}

/** Classify how (whether) an artifact can be previewed inline. */
export function previewKindForMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("text/") || TEXT_APPLICATION_MIMES.has(m)) return "text";
  if (m.startsWith("image/")) return "image";
  return "none";
}

export async function handleArtifactList(server, id, ws, message) {
  try {
    const store = await loadStore();
    let artifacts = store.list({ sessionId: message.session || undefined });
    if (message.kind) {
      artifacts = artifacts.filter((e) => e.kind === String(message.kind));
    }
    server._send(ws, { id, type: "artifact-list", artifacts });
  } catch (err) {
    sendError(server, id, ws, "ARTIFACT_LIST_FAILED", err.message);
  }
}

export async function handleArtifactShow(server, id, ws, message) {
  try {
    if (!message.artifactId) {
      return sendError(server, id, ws, "NO_ARTIFACT_ID", "artifactId required");
    }
    const store = await loadStore();
    const entry = store.get(message.artifactId);
    if (!entry) {
      return sendError(
        server,
        id,
        ws,
        "ARTIFACT_NOT_FOUND",
        `Artifact not found: ${message.artifactId}`,
      );
    }
    server._send(ws, {
      id,
      type: "artifact-show",
      artifact: { ...entry, storedPath: store.storedPath(entry) },
    });
  } catch (err) {
    sendError(server, id, ws, "ARTIFACT_SHOW_FAILED", err.message);
  }
}

export async function handleArtifactContent(server, id, ws, message) {
  try {
    if (!message.artifactId) {
      return sendError(server, id, ws, "NO_ARTIFACT_ID", "artifactId required");
    }
    const store = await loadStore();
    const entry = store.get(message.artifactId);
    if (!entry) {
      return sendError(
        server,
        id,
        ws,
        "ARTIFACT_NOT_FOUND",
        `Artifact not found: ${message.artifactId}`,
      );
    }
    // Traversal guard: the stored filename must be a plain basename. A
    // tampered index row ("file":"../../secret") must not read outside the
    // files dir.
    if (
      !entry.file ||
      entry.file !== path.basename(entry.file) ||
      entry.file.includes("..")
    ) {
      return sendError(
        server,
        id,
        ws,
        "ARTIFACT_BAD_FILE",
        "artifact index row has a non-basename stored filename — refusing to serve it",
      );
    }
    const previewKind = previewKindForMime(entry.mime);
    const base = {
      id,
      type: "artifact-content",
      artifactId: entry.id,
      mime: entry.mime,
      size: entry.size,
    };
    if (previewKind === "none") {
      return server._send(ws, {
        ...base,
        previewable: false,
        reason: `no inline preview for ${entry.mime} — use \`cc artifacts open ${entry.id}\` locally`,
      });
    }
    const storedPath = store.storedPath(entry);
    let actualSize;
    try {
      actualSize = statSync(storedPath).size;
    } catch {
      return sendError(
        server,
        id,
        ws,
        "ARTIFACT_FILE_MISSING",
        `stored copy is missing: ${entry.file}`,
      );
    }
    if (previewKind === "image") {
      if (actualSize > IMAGE_PREVIEW_CAP) {
        return server._send(ws, {
          ...base,
          previewable: false,
          reason: `image exceeds the ${IMAGE_PREVIEW_CAP} byte preview cap`,
        });
      }
      const body = readFileSync(storedPath);
      return server._send(ws, {
        ...base,
        previewable: true,
        encoding: "base64",
        truncated: false,
        content: body.toString("base64"),
      });
    }
    // text
    const cap = Math.min(
      Number(message.maxBytes) > 0 ? Number(message.maxBytes) : TEXT_PREVIEW_CAP,
      TEXT_PREVIEW_CAP,
    );
    const text = readFileSync(storedPath, "utf-8");
    const truncated = text.length > cap;
    server._send(ws, {
      ...base,
      previewable: true,
      encoding: "utf8",
      truncated,
      content: truncated ? text.slice(0, cap) : text,
    });
  } catch (err) {
    sendError(server, id, ws, "ARTIFACT_CONTENT_FAILED", err.message);
  }
}

export async function handleArtifactRemove(server, id, ws, message) {
  try {
    if (!message.artifactId) {
      return sendError(server, id, ws, "NO_ARTIFACT_ID", "artifactId required");
    }
    const store = await loadStore();
    const found = store.remove(message.artifactId);
    server._send(ws, {
      id,
      type: "artifact-remove",
      artifactId: message.artifactId,
      removed: found ? message.artifactId : null,
      found,
    });
  } catch (err) {
    sendError(server, id, ws, "ARTIFACT_REMOVE_FAILED", err.message);
  }
}

export async function handleArtifactClean(server, id, ws, message) {
  try {
    const store = await loadStore();
    const { removed } = store.cleanupExpired();
    server._send(ws, { id, type: "artifact-clean", removed });
  } catch (err) {
    sendError(server, id, ws, "ARTIFACT_CLEAN_FAILED", err.message);
  }
}
