import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { searchTextFile } from "./text-file-search.js";

/** Bounded process-local snapshots. IDs never resolve arbitrary caller paths. */
export class WebFetchSnapshots {
  constructor({
    maxBytes = 128_000_000,
    maxEntries = 32,
    ttlMs = 30 * 60_000,
    now = Date.now,
  } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
    this.bytes = 0;
    this.dir = null;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    // Only files created by this instance are ever deleted.
    fs.rmSync(entry.file, { force: true });
    this.entries.delete(id);
    this.bytes -= entry.size;
  }

  expire() {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.remove(id);
    }
  }

  save(result, identity, owner) {
    this.expire();
    // UTF-16LE makes character offsets seekable without rereading the entire
    // downloaded document for every page. Reads preserve surrogate pairs.
    const size = Buffer.byteLength(result.content, "utf16le");
    if (size > this.maxBytes || this.maxEntries < 1) {
      throw Object.assign(
        new Error(
          "Webpage exceeds the local snapshot storage budget; request a focused page or API endpoint.",
        ),
        { code: "ERR_FETCH_SNAPSHOT_LIMIT" },
      );
    }
    while (
      this.entries.size >= this.maxEntries ||
      this.bytes + size > this.maxBytes
    ) {
      this.remove(this.entries.keys().next().value);
    }
    this.dir ||= fs.mkdtempSync(path.join(os.tmpdir(), "cc-web-fetch-"));
    const id = randomUUID();
    const file = path.join(this.dir, `${id}.txt`);
    try {
      fs.writeFileSync(file, result.content, {
        encoding: "utf16le",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* preserve original failure */
      }
      throw error;
    }
    const { content, ...metadata } = result;
    this.entries.set(id, {
      file,
      size,
      metadata,
      identity,
      owner,
      expiresAt: this.now() + this.ttlMs,
    });
    this.bytes += size;
    return id;
  }

  read(id, identity, owner, offset, maxChars) {
    this.expire();
    const entry = this.entries.get(id);
    if (!entry || entry.identity !== identity || entry.owner !== owner) {
      return {
        error:
          "Webpage snapshot is unavailable or expired. Fetch the original URL again without snapshotId.",
        code: "ERR_FETCH_SNAPSHOT_MISSING",
        retryable: false,
      };
    }
    const totalChars = entry.size / 2;
    if (offset > totalChars) {
      return {
        error: `offset exceeds the saved text length (${totalChars})`,
        code: "ERR_FETCH_OFFSET",
        retryable: false,
        totalChars,
      };
    }
    const length = Math.min(maxChars, totalChars - offset);
    const buffer = Buffer.alloc(Math.min(length + 1, totalChars - offset) * 2);
    const fd = fs.openSync(entry.file, "r");
    let read = 0;
    try {
      while (read < buffer.length) {
        const n = fs.readSync(
          fd,
          buffer,
          read,
          buffer.length - read,
          offset * 2 + read,
        );
        if (!n) throw new Error("Webpage snapshot was truncated on disk");
        read += n;
      }
    } finally {
      fs.closeSync(fd);
    }
    const text = buffer.toString("utf16le");
    let content = text.slice(0, length);
    if (/[\uD800-\uDBFF]$/.test(content) && offset + length < totalChars) {
      // A one-character request must still advance over an astral character.
      content = length === 1 ? text.slice(0, 2) : content.slice(0, -1);
    }
    const nextOffset = offset + content.length;
    const hasMore = nextOffset < totalChars;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return {
      ...entry.metadata,
      content,
      snapshotId: id,
      offset,
      nextOffset: hasMore ? nextOffset : null,
      hasMore,
      totalChars,
      maxChars,
      truncated: hasMore || entry.metadata.downloadTruncated === true,
      ...(hasMore
        ? {
            hint: `More saved text is available. Call web_fetch with the same URL, format and snapshotId, offset=${nextOffset}, and maxChars. This reads the local snapshot without another download.${entry.metadata.downloadTruncated ? " The downloaded page is incomplete; increase maxBytes in a new fetch for the missing remainder." : ""}`,
          }
        : {}),
    };
  }

  async search(id, identity, owner, options) {
    const page = this.read(id, identity, owner, 0, 1);
    if (page.error) return page;
    const result = await searchTextFile(this.entries.get(id).file, {
      ...options,
      encoding: "utf16le",
    });
    return {
      ...result,
      snapshotId: id,
      url: page.url,
      totalChars: page.totalChars,
      ...(page.downloadTruncated
        ? {
            downloadTruncated: true,
            hint: "Only the downloaded prefix was searched. Increase maxBytes in a new download to search the missing remainder.",
          }
        : {}),
      ...(result.matches
        ? {
            matches: result.matches.map((match) => ({
              ...match,
              nextRead: {
                url: options.url || page.url,
                snapshotId: id,
                format: page.format,
                offset: Math.max(
                  0,
                  match.offset - (options.contextChars ?? 150),
                ),
                maxChars: 2000,
              },
            })),
          }
        : {}),
    };
  }

  dispose() {
    for (const id of this.entries.keys()) this.remove(id);
    if (this.dir) {
      fs.rmdirSync(this.dir);
      this.dir = null;
    }
  }
}

export const webFetchSnapshots = new WebFetchSnapshots();
process.once("exit", () => {
  try {
    webFetchSnapshots.dispose();
  } catch {
    /* OS temp cleanup can reclaim leftovers */
  }
});
