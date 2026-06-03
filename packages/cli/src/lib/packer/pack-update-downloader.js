/**
 * Phase 5b: stream a packed exe to disk and verify its SHA-256 against the
 * manifest. Self-replacement is Phase 5c; this module just writes the new
 * artifact next to the old one (conventionally `<exePath>.new`).
 *
 * Design notes:
 *   - Streaming, not buffered: artifacts are ~80-140 MB, so we write chunks
 *     straight to disk and hash incrementally. Node's fetch yields a web
 *     ReadableStream, which we consume via its async iterator.
 *   - Atomicity: we write to `<outputPath>.partial` and rename on success.
 *     A SHA mismatch or mid-stream failure deletes the partial so a retry
 *     starts from scratch.
 *   - No resume: first cut skips Range / If-Range. Large-artifact resume
 *     is a Phase 5d concern if it becomes painful.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * @param {object} ctx
 * @param {string}   ctx.url                  absolute http(s) URL to the artifact
 * @param {string}   ctx.sha256               lowercase hex SHA-256 from the manifest
 * @param {string}   ctx.outputPath           where the verified artifact lands
 * @param {typeof fetch} [ctx.fetchImpl]      injected for tests
 * @param {(p:{bytes:number,total:number|null})=>void} [ctx.onProgress]
 *                                            fires as chunks arrive; total
 *                                            is null if Content-Length was
 *                                            absent or unparseable
 * @returns {Promise<{outputPath:string,bytes:number,sha256:string}>}
 */
export async function downloadAndVerify(ctx) {
  const { url, sha256, outputPath, fetchImpl = fetch, onProgress } = ctx;

  if (!url || typeof url !== "string") {
    throw new DownloadError("url is required", "NO_URL");
  }
  if (!sha256 || !SHA256_HEX.test(sha256)) {
    throw new DownloadError(
      `sha256 must be a 64-char lowercase hex string (got ${JSON.stringify(sha256)})`,
      "BAD_SHA256",
    );
  }
  if (!outputPath || typeof outputPath !== "string") {
    throw new DownloadError("outputPath is required", "NO_OUTPUT");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const partialPath = outputPath + ".partial";

  // Clean up any stale partial from a prior interrupted attempt. Ignoring
  // ENOENT is fine — we just want to start with a blank slate.
  try {
    fs.unlinkSync(partialPath);
  } catch {
    /* no prior partial */
  }

  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "*/*" } });
  } catch (err) {
    throw new DownloadError(
      `fetch failed: ${err.message}`,
      err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
    );
  }
  if (!response.ok) {
    throw new DownloadError(
      `artifact fetch failed: HTTP ${response.status}`,
      "FETCH_FAILED",
    );
  }

  const totalRaw = response.headers?.get?.("content-length");
  const total = totalRaw ? Number(totalRaw) : null;
  const body = response.body;
  if (!body) {
    throw new DownloadError(
      "response has no body stream (fetch impl returned no body)",
      "NO_BODY",
    );
  }

  const hasher = crypto.createHash("sha256");
  const out = fs.createWriteStream(partialPath);
  let bytes = 0;

  try {
    // Web ReadableStream exposes an async iterator in Node ≥18. We prefer
    // that over pumping via pipe() because we need to see each chunk for
    // hashing + progress, and we want the final rename deterministic.
    for await (const chunk of body) {
      // `chunk` is a Uint8Array
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hasher.update(buf);
      bytes += buf.length;
      const ok = out.write(buf);
      if (!ok) {
        await new Promise((r) => out.once("drain", r));
      }
      if (typeof onProgress === "function") {
        try {
          onProgress({ bytes, total: Number.isFinite(total) ? total : null });
        } catch {
          /* progress callback errors must not interrupt the download */
        }
      }
    }
    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    try {
      out.destroy();
      fs.unlinkSync(partialPath);
    } catch {
      /* best effort */
    }
    throw new DownloadError(`stream aborted: ${err.message}`, "STREAM_ERROR");
  }

  const actualSha = hasher.digest("hex");
  if (actualSha !== sha256.toLowerCase()) {
    try {
      fs.unlinkSync(partialPath);
    } catch {
      /* best effort */
    }
    throw new DownloadError(
      `SHA-256 mismatch: expected ${sha256}, got ${actualSha}`,
      "SHA_MISMATCH",
    );
  }

  // Atomic rename — on Windows this fails if the destination exists; delete
  // first. On POSIX rename atomically replaces, but the extra unlink is
  // harmless and keeps behavior symmetric across platforms.
  try {
    fs.unlinkSync(outputPath);
  } catch {
    /* no prior artifact */
  }
  fs.renameSync(partialPath, outputPath);

  return { outputPath, bytes, sha256: actualSha };
}

/**
 * Typed error with a machine-readable `code`. The `cc pack check-update
 * --download` command turns these into friendly messages + exit codes.
 */
export class DownloadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
  }
}
