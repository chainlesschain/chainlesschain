/**
 * channel-envelope-archiver — periodic archival of B4-merkle batches +
 * B4-cross remote caches to external storage so audit history survives
 * device wipe / uninstall / disk loss.
 *
 * v1 scope:
 *   - pack(communityId, sinceBatchId) → zip Buffer of batches/<id>/* +
 *     remote-landmarks/* + remote-envelopes/*
 *   - restore(provider, communityId, archiveName) → unzip back into
 *     <userData>/channel-mtc/<communityId>/
 *   - Provider abstraction: any object with putFile/getFile/listFiles
 *     methods. Two built-in providers ship: filesystem (mirror to a local
 *     dir, useful for Syncthing-class external sync) + WebDAV (uses
 *     existing src/main/sync/webdav-client.js).
 *   - Manual trigger only via IPC (channel-archive:push / restore / list).
 *     Cron / timer scheduling is a follow-up sub-phase — most users won't
 *     want auto-archival on by default anyway.
 *
 * Why zip (not tar.gz): adm-zip is already a desktop-app-vue dep, ships
 * pure JS (no native deps), works the same on Windows / mac / Linux,
 * has straightforward random-access entry extraction. tar+gzip would
 * require streaming archiver which adds complexity for marginal size win.
 *
 * Archive name convention:
 *   "channel-mtc-<communityId>-<isoTimestamp>-<sinceBatchId>-to-<latestBatchId>.zip"
 * stored under provider's `<remoteRoot>/<communityId>/` namespace so multi-
 * community archives don't collide.
 *
 * @module channel-envelope-archiver
 */

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { logger } = require("../utils/logger.js");

const ARCHIVE_NAME_PREFIX = "channel-mtc";

function safeCommunityId(communityId) {
  if (typeof communityId !== "string" || !communityId) {
    throw new TypeError("communityId required");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(communityId)) {
    throw new Error("communityId unsafe: " + communityId);
  }
  return communityId;
}

function communityRoot(rootDir, communityId) {
  return path.join(rootDir, safeCommunityId(communityId));
}

function listBatchIds(communityDir) {
  const batchesDir = path.join(communityDir, "batches");
  if (!fs.existsSync(batchesDir)) {
    return [];
  }
  return fs
    .readdirSync(batchesDir)
    .filter((n) => /^\d+$/.test(n))
    .sort();
}

function listRemoteLandmarks(communityDir) {
  const dir = path.join(communityDir, "remote-landmarks");
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
}

function listRemoteEnvelopes(communityDir) {
  const dir = path.join(communityDir, "remote-envelopes");
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
}

class ChannelEnvelopeArchiver {
  /**
   * @param {object} opts
   * @param {string} opts.rootDir - same `<userData>/channel-mtc` that
   *   ChannelEventBatcher uses
   */
  constructor(opts = {}) {
    if (!opts.rootDir) {
      throw new Error("ChannelEnvelopeArchiver: rootDir required");
    }
    this._rootDir = opts.rootDir;
  }

  /**
   * Pack a community's batch dir contents into a zip Buffer.
   *
   * @param {string} communityId
   * @param {object} [opts]
   * @param {string} [opts.sinceBatchId] - only include batches with id strictly
   *   greater than this (lexicographic, since batch ids are zero-padded numerics)
   * @param {boolean} [opts.includeRemote=true] - include remote-landmarks/ +
   *   remote-envelopes/ (full archive). Set false for "self-only" archives.
   * @returns {{ buffer: Buffer, manifest: object }}
   */
  pack(communityId, opts = {}) {
    const root = communityRoot(this._rootDir, communityId);
    if (!fs.existsSync(root)) {
      throw new Error("community has no channel-mtc dir: " + communityId);
    }
    const since = opts.sinceBatchId || null;
    const includeRemote = opts.includeRemote !== false;

    const allBatchIds = listBatchIds(root);
    const includedBatchIds = since
      ? allBatchIds.filter((id) => id > since)
      : allBatchIds;
    if (includedBatchIds.length === 0 && !includeRemote) {
      throw new Error(
        "nothing to archive (no new batches since " +
          (since || "<beginning>") +
          ")",
      );
    }

    const zip = new AdmZip();
    const fileEntries = [];

    // Pack batches
    for (const batchId of includedBatchIds) {
      const batchDir = path.join(root, "batches", batchId);
      if (!fs.statSync(batchDir).isDirectory()) {
        continue;
      }
      const files = fs.readdirSync(batchDir).filter((n) => n.endsWith(".json"));
      for (const f of files) {
        const abs = path.join(batchDir, f);
        const content = fs.readFileSync(abs);
        const archivePath = `batches/${batchId}/${f}`;
        zip.addFile(archivePath, content);
        fileEntries.push(archivePath);
      }
    }

    // Pack remote caches (optional)
    if (includeRemote) {
      for (const f of listRemoteLandmarks(root)) {
        const abs = path.join(root, "remote-landmarks", f);
        zip.addFile(`remote-landmarks/${f}`, fs.readFileSync(abs));
        fileEntries.push(`remote-landmarks/${f}`);
      }
      for (const f of listRemoteEnvelopes(root)) {
        const abs = path.join(root, "remote-envelopes", f);
        zip.addFile(`remote-envelopes/${f}`, fs.readFileSync(abs));
        fileEntries.push(`remote-envelopes/${f}`);
      }
    }

    const manifest = {
      schema: "channel-mtc-archive/v1",
      communityId,
      packedAt: new Date().toISOString(),
      sinceBatchId: since,
      latestBatchId:
        includedBatchIds.length > 0
          ? includedBatchIds[includedBatchIds.length - 1]
          : null,
      batchIds: includedBatchIds,
      includeRemote,
      fileCount: fileEntries.length,
      files: fileEntries,
    };
    zip.addFile(
      "MANIFEST.json",
      Buffer.from(JSON.stringify(manifest, null, 2)),
    );

    return { buffer: zip.toBuffer(), manifest };
  }

  /**
   * Push a packed archive to a provider.
   *
   * @param {object} provider - has async putFile(remotePath, Buffer) method
   * @param {string} communityId
   * @param {object} [packOpts] - forwarded to pack()
   * @returns {Promise<{ ok: boolean, name: string, manifest: object,
   *   bytes: number, providerResult: object }>}
   */
  async push(provider, communityId, packOpts = {}) {
    if (!provider || typeof provider.putFile !== "function") {
      throw new TypeError("push: provider must implement putFile");
    }
    const { buffer, manifest } = this.pack(communityId, packOpts);
    const name = ChannelEnvelopeArchiver.archiveName(manifest);
    const remotePath = communityId + "/" + name;
    const providerResult = await provider.putFile(remotePath, buffer);
    if (providerResult && providerResult.ok === false) {
      throw new Error(
        "push: provider putFile failed: " +
          (providerResult.error || providerResult.status || "unknown"),
      );
    }
    logger.info(
      "[ChannelEnvelopeArchiver] pushed " +
        name +
        " (" +
        manifest.fileCount +
        " files, " +
        buffer.length +
        " bytes)",
    );
    return {
      ok: true,
      name,
      remotePath,
      manifest,
      bytes: buffer.length,
      providerResult,
    };
  }

  /**
   * Restore an archive from a provider into local channel-mtc dir.
   * Existing files are NOT overwritten (idempotent: same content already
   * present is a no-op; conflicts log warn + skip — caller can retry with
   * a fresh community dir if they want clobbering).
   *
   * @param {object} provider - has async getFile(remotePath) → Buffer
   * @param {string} communityId
   * @param {string} archiveName - name returned by push() or list()
   * @returns {Promise<{ ok: boolean, restored: number, skipped: number,
   *   batchIds: string[], manifest: object }>}
   */
  async restore(provider, communityId, archiveName) {
    if (!provider || typeof provider.getFile !== "function") {
      throw new TypeError("restore: provider must implement getFile");
    }
    safeCommunityId(communityId);
    const remotePath = communityId + "/" + archiveName;
    const buffer = await provider.getFile(remotePath);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("restore: provider returned empty / non-buffer response");
    }
    const zip = new AdmZip(buffer);
    const root = communityRoot(this._rootDir, communityId);
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }

    let manifest = null;
    let restored = 0;
    let skipped = 0;
    const batchIdsTouched = new Set();

    for (const entry of zip.getEntries()) {
      const archivePath = entry.entryName;
      if (entry.isDirectory) {
        continue;
      }
      const data = entry.getData();

      if (archivePath === "MANIFEST.json") {
        try {
          manifest = JSON.parse(data.toString("utf-8"));
        } catch (err) {
          logger.warn(
            "[ChannelEnvelopeArchiver] manifest parse failed: " + err.message,
          );
        }
        continue;
      }

      // Path-traversal guard: archivePath must NOT contain ".." or absolutes
      if (archivePath.includes("..") || path.isAbsolute(archivePath)) {
        logger.warn(
          "[ChannelEnvelopeArchiver] skipping unsafe entry: " + archivePath,
        );
        skipped++;
        continue;
      }

      const target = path.join(root, archivePath);
      const targetDir = path.dirname(target);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (fs.existsSync(target)) {
        // Idempotent: skip if file exists. Don't overwrite — user may have
        // local-fresh content we don't want to clobber.
        skipped++;
        continue;
      }
      fs.writeFileSync(target, data);
      restored++;

      // Track which batches we touched (for telemetry)
      const m = archivePath.match(/^batches\/(\d+)\//);
      if (m) {
        batchIdsTouched.add(m[1]);
      }
    }

    logger.info(
      "[ChannelEnvelopeArchiver] restored from " +
        archiveName +
        ": " +
        restored +
        " new files, " +
        skipped +
        " skipped",
    );
    return {
      ok: true,
      restored,
      skipped,
      batchIds: [...batchIdsTouched].sort(),
      manifest,
    };
  }

  /**
   * List available archives for a community via the provider.
   * @param {object} provider - has async listFiles(remoteDir) → string[]
   * @param {string} communityId
   * @returns {Promise<string[]>} archive filenames sorted ascending (oldest first)
   */
  async list(provider, communityId) {
    if (!provider || typeof provider.listFiles !== "function") {
      throw new TypeError("list: provider must implement listFiles");
    }
    safeCommunityId(communityId);
    const items = await provider.listFiles(communityId);
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .filter((n) => typeof n === "string" && n.startsWith(ARCHIVE_NAME_PREFIX))
      .sort();
  }

  /** @returns {string} canonical archive filename derived from manifest */
  static archiveName(manifest) {
    const ts = (manifest.packedAt || new Date().toISOString()).replace(
      /[:.]/g,
      "-",
    );
    const since = manifest.sinceBatchId || "0";
    const latest = manifest.latestBatchId || "none";
    return `${ARCHIVE_NAME_PREFIX}-${manifest.communityId}-${ts}-${since}-to-${latest}.zip`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Built-in providers
// ─────────────────────────────────────────────────────────────────────

/**
 * filesystemProvider — mirror archives to a local directory tree.
 * Useful for: testing, Syncthing-class external sync, USB-stick backups.
 */
function filesystemProvider(opts = {}) {
  const { rootDir } = opts;
  if (!rootDir) {
    throw new Error("filesystemProvider: rootDir required");
  }
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  function abs(p) {
    if (p.includes("..") || path.isAbsolute(p)) {
      throw new Error("filesystemProvider: unsafe path " + p);
    }
    return path.join(rootDir, p);
  }

  return {
    async putFile(remotePath, buffer) {
      const a = abs(remotePath);
      fs.mkdirSync(path.dirname(a), { recursive: true });
      fs.writeFileSync(a, buffer);
      return { ok: true, path: a, bytes: buffer.length };
    },
    async getFile(remotePath) {
      const a = abs(remotePath);
      if (!fs.existsSync(a)) {
        throw new Error("filesystemProvider: not found " + remotePath);
      }
      return fs.readFileSync(a);
    },
    async listFiles(remoteDir) {
      const a = abs(remoteDir);
      if (!fs.existsSync(a)) {
        return [];
      }
      return fs
        .readdirSync(a, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    },
  };
}

/**
 * webdavProvider — wrap src/main/sync/webdav-client.js for archive use.
 * The webdav-client takes care of auth, retry, etag; we just adapt its
 * putFile/listFiles surface to our provider contract (Buffer payloads,
 * plain returns).
 */
function webdavProvider(webdavClient) {
  if (!webdavClient || typeof webdavClient.putFile !== "function") {
    throw new TypeError("webdavProvider: webdav-client instance required");
  }
  return {
    async putFile(remotePath, buffer) {
      const r = await webdavClient.putFile(remotePath, buffer);
      if (r && r.ok === false) {
        return {
          ok: false,
          error: r.error || "webdav putFile failed",
          status: r.status,
        };
      }
      return { ok: true, etag: r && r.etag };
    },
    async getFile(remotePath) {
      // webdav-client may not have a generic getFile — try common shapes
      if (typeof webdavClient.getFile === "function") {
        const r = await webdavClient.getFile(remotePath);
        if (Buffer.isBuffer(r)) {
          return r;
        }
        if (r && r.ok && r.content) {
          return Buffer.isBuffer(r.content)
            ? r.content
            : Buffer.from(r.content);
        }
        throw new Error("webdavProvider: getFile returned unexpected shape");
      }
      throw new Error("webdavProvider: client lacks getFile");
    },
    async listFiles(remoteDir) {
      if (typeof webdavClient.listFiles === "function") {
        const items = await webdavClient.listFiles(remoteDir);
        if (Array.isArray(items)) {
          return items
            .map((it) => (typeof it === "string" ? it : it && it.basename))
            .filter(Boolean);
        }
      }
      return [];
    },
  };
}

module.exports = {
  ChannelEnvelopeArchiver,
  filesystemProvider,
  webdavProvider,
  ARCHIVE_NAME_PREFIX,
};
