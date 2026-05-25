"use strict";

/**
 * Phase 2a (Douyin C 路径 — 2026-05-25): douyin.pull-im-db ADB extension.
 *
 * Plugs into the `opts.extensions` slot of `createHostAdbBridge` /
 * `createDesktopAdbBridge`. Pipeline:
 *
 *   1. ADB-ls `/data/data/com.ss.android.ugc.aweme/databases/` to find
 *      `<uid>_im.db` (19-digit numeric uid prefix) — abrignoni DFIR pattern
 *   2. ADB pull the .db cohort (main + -wal + -shm) via base64 streaming
 *      (mirrors Bilibili Phase 1a — `su -c "base64 ..."` avoids MIUI FUSE
 *      SELinux trap)
 *   3. Verify each file's SQLite magic header before returning
 *   4. Return `{tempPath, uid, walPath?, shmPath?, extractedAt}` for the
 *      collector to feed into im-db-parser
 *
 * Bilibili Phase 1a uses base64 of a single file; Douyin needs the WAL/SHM
 * cohort because the IM db is actively written by the chat thread —
 * skipping WAL would lose the most-recent messages. We pull all 3 files
 * and let the sqlite reader checkpoint them on open.
 *
 * Failure modes (throws on each; UI maps the typed error code to a banner):
 *   - DOUYIN_NOT_INSTALLED — databases/ dir doesn't exist
 *   - DOUYIN_NO_IM_DB — no `<uid>_im.db` matching the 19-digit pattern
 *   - DOUYIN_MULTIPLE_USERS — >1 IM dbs (multi-account; need explicit uid)
 *   - DOUYIN_NO_ROOT — su not available
 *   - DOUYIN_PULL_FAILED — base64 stream error
 *   - DOUYIN_NOT_SQLITE — pulled file lacks SQLite magic header
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const DOUYIN_DB_REMOTE_DIR =
  "/data/data/com.ss.android.ugc.aweme/databases";

const IM_DB_PATTERN = /^(\d{19})_im\.db$/;

/**
 * List candidate IM db filenames + uid via `adb shell su -c "ls databases/"`.
 *
 * Returns `{candidates: [{uid, fileName}], dirMissing: boolean}` so the
 * caller can disambiguate "no Douyin installed" vs "Douyin installed but
 * never logged in" vs "logged in to multiple accounts".
 */
async function listImDbs(adb, serial, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 30_000 };
  // ls returns "No such file or directory" to stdout when 2>/dev/null is
  // appended (toybox ls behavior); we use a sentinel to disambiguate.
  const lsOut = await adb(
    [
      "shell",
      "su",
      "-c",
      `ls ${DOUYIN_DB_REMOTE_DIR} 2>/dev/null || echo __MISSING_DIR__`,
    ],
    adbOpts,
  );
  const lines = lsOut.replace(/\r/g, "").trim().split(/\n/);
  if (lines.length === 1 && lines[0] === "__MISSING_DIR__") {
    return { candidates: [], dirMissing: true };
  }
  const candidates = [];
  for (const line of lines) {
    const fileName = line.trim();
    if (!fileName) continue;
    const m = fileName.match(IM_DB_PATTERN);
    if (m) {
      candidates.push({ uid: m[1], fileName });
    }
  }
  return { candidates, dirMissing: false };
}

/**
 * Pull a single file via `su -c "base64 ..." | tr -d '\n\r'` streaming.
 * Mirrors Bilibili Phase 1a:pullCookiesViaSu — same trap-mitigation reasons.
 *
 * Returns the decoded bytes as a Buffer. Throws on:
 *  - ENOENT (file disappeared between ls and pull)
 *  - empty base64 stream
 *  - bad base64
 *  - sqlite magic header missing
 *  - decoded size < 1024 (truncation)
 */
async function pullFileViaSu(adb, serial, remotePath, opts) {
  const adbOpts = { serial, timeoutMs: opts?.timeoutMs || 60_000 };
  const b64 = await adb(
    [
      "shell",
      "su",
      "-c",
      `base64 ${remotePath} 2>/dev/null | tr -d '\\n\\r'`,
    ],
    adbOpts,
  );
  const b64Clean = b64.replace(/[\r\n\t ]+/g, "");
  if (b64Clean.length === 0) {
    throw new Error(
      `DOUYIN_PULL_FAILED: base64 stream of ${remotePath} returned 0 bytes (su exec may have silently failed)`,
    );
  }
  let buf;
  try {
    buf = Buffer.from(b64Clean, "base64");
  } catch (e) {
    throw new Error(
      `DOUYIN_PULL_FAILED: base64 decode failed for ${remotePath}: ${e.message || String(e)}`,
    );
  }
  return buf;
}

/**
 * Factory: returns an extension handler suitable for the `opts.extensions`
 * map of `createHostAdbBridge` / `createDesktopAdbBridge`.
 *
 *   const ext = createDouyinDbExtension();
 *   const bridge = createHostAdbBridge({ extensions: { "douyin.pull-im-db": ext } });
 *   const { tempPath, uid } = await bridge.invoke("douyin.pull-im-db");
 *
 * Params (all optional):
 *   - uid: prefer this specific uid when multiple `<uid>_im.db` exist on
 *     the device (defaults to throwing DOUYIN_MULTIPLE_USERS so the user
 *     picks one explicitly)
 *
 * @param {{timeoutMs?: number, onCleanupFailed?: (path: string) => void}} [factoryOpts]
 * @returns {(params: object, ctx: object) => Promise<{tempPath, uid, walPath?, shmPath?, extractedAt}>}
 */
function createDouyinDbExtension(factoryOpts = {}) {
  const timeoutMs = factoryOpts.timeoutMs || 60_000;
  const onCleanupFailed = factoryOpts.onCleanupFailed || (() => {});

  return async function douyinPullImDbHandler(params, ctx) {
    if (
      !ctx ||
      typeof ctx.adb !== "function" ||
      typeof ctx.pickDevice !== "function"
    ) {
      throw new TypeError(
        "douyin.pull-im-db: ctx must provide {adb, pickDevice}",
      );
    }
    const serial = await ctx.pickDevice();

    // Step 0: probe su availability — clearer error than "ls failed".
    const idOut = await ctx.adb(
      ["shell", "su", "-c", "id -u"],
      { serial, timeoutMs },
    );
    const idLine = idOut.replace(/\r+$/gm, "").trim();
    if (idLine !== "0" && !idLine.includes("uid=0")) {
      throw new Error(
        `DOUYIN_NO_ROOT: phone isn't rooted (su -c id -u returned \`${idLine.substring(0, 60)}\`). Douyin release APK isn't debuggable, so root is required to read /data/data/com.ss.android.ugc.aweme/databases/.`,
      );
    }

    // Step 1: discover candidate IM dbs.
    const { candidates, dirMissing } = await listImDbs(ctx.adb, serial, {
      timeoutMs,
    });
    if (dirMissing) {
      throw new Error(
        "DOUYIN_NOT_INSTALLED: " +
          DOUYIN_DB_REMOTE_DIR +
          " does not exist. Install Douyin App on the phone, then retry.",
      );
    }
    if (candidates.length === 0) {
      throw new Error(
        "DOUYIN_NO_IM_DB: no `<19-digit-uid>_im.db` found in databases/. Open the Douyin App + log in once + open any chat thread to materialize the IM database, then retry.",
      );
    }
    let chosen;
    const requestedUid = params && typeof params.uid === "string" ? params.uid : null;
    if (requestedUid) {
      chosen = candidates.find((c) => c.uid === requestedUid);
      if (!chosen) {
        throw new Error(
          `DOUYIN_UID_NOT_FOUND: requested uid=${requestedUid} not in ${JSON.stringify(candidates.map((c) => c.uid))}`,
        );
      }
    } else if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      throw new Error(
        `DOUYIN_MULTIPLE_USERS: multiple IM dbs found (${candidates.map((c) => c.uid).join(", ")}). Pass {uid: "<19-digit>"} to disambiguate.`,
      );
    }

    // Step 2: pull the cohort (main + -wal + -shm).
    // Brignoni's article notes the WAL sibling holds the most-recent
    // messages — Douyin commits to WAL on send/receive but only
    // checkpoints back to main on app idle. Skipping WAL loses the last
    // ~hour of chat. Best-effort: WAL/SHM may not exist if app just
    // checkpointed.
    const remoteDb = `${DOUYIN_DB_REMOTE_DIR}/${chosen.fileName}`;
    const remoteWal = remoteDb + "-wal";
    const remoteShm = remoteDb + "-shm";

    const tmpDir = os.tmpdir();
    const tmpId = crypto.randomUUID();
    const tempPath = path.join(tmpDir, `cc-douyin-im-${tmpId}.db`);
    let walPath = null;
    let shmPath = null;

    const dbBuf = await pullFileViaSu(ctx.adb, serial, remoteDb, { timeoutMs });
    // Magic check on the main file.
    if (dbBuf.length < 1024) {
      throw new Error(
        `DOUYIN_PULL_FAILED: decoded ${remoteDb} is only ${dbBuf.length} bytes — expected ≥4KB sqlite. Possible MIUI silent su fail.`,
      );
    }
    const magic = dbBuf.subarray(0, 16).toString("latin1");
    if (!magic.startsWith("SQLite format 3")) {
      throw new Error(
        `DOUYIN_NOT_SQLITE: ${remoteDb} decoded but lacks 'SQLite format 3' magic header. Got: ${dbBuf.subarray(0, 16).toString("hex")}`,
      );
    }
    fs.writeFileSync(tempPath, dbBuf);

    // Best-effort: pull WAL+SHM if present. Errors here just skip — main
    // db parses fine without them, only loses recent messages.
    try {
      const walBuf = await pullFileViaSu(ctx.adb, serial, remoteWal, {
        timeoutMs,
      });
      if (walBuf.length > 0) {
        walPath = path.join(tmpDir, `cc-douyin-im-${tmpId}.db-wal`);
        fs.writeFileSync(walPath, walBuf);
      }
    } catch (_e) {
      // No WAL — typical if app idle for >a few hours
    }
    try {
      const shmBuf = await pullFileViaSu(ctx.adb, serial, remoteShm, {
        timeoutMs,
      });
      if (shmBuf.length > 0) {
        shmPath = path.join(tmpDir, `cc-douyin-im-${tmpId}.db-shm`);
        fs.writeFileSync(shmPath, shmBuf);
      }
    } catch (_e) {
      // No SHM — same as WAL
    }

    return {
      tempPath,
      uid: chosen.uid,
      walPath,
      shmPath,
      extractedAt: Date.now(),
      // Caller is responsible for cleanup. We expose the cleanup helper
      // separately so the caller can run it in a finally block.
      cleanup() {
        for (const p of [tempPath, walPath, shmPath]) {
          if (!p) continue;
          try {
            fs.unlinkSync(p);
          } catch (_e) {
            onCleanupFailed(p);
          }
        }
      },
    };
  };
}

module.exports = {
  createDouyinDbExtension,
  DOUYIN_DB_REMOTE_DIR,
  IM_DB_PATTERN,
  // Exposed for tests
  _internals: {
    listImDbs,
    pullFileViaSu,
  },
};
