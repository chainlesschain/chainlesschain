"use strict";

/**
 * PC local-data auto-discovery — find a desktop App's local SQLite database(s)
 * on the host WITHOUT the user having to type a path.
 *
 * Why this exists: every device-pull desktop IM adapter (wechat-pc / qq-pc /
 * dingtalk-pc / feishu-pc) used to require an explicit `opts.dbPath`. With no
 * path the readiness probe reported `DB_NOT_PULLED` and the UI offered no way
 * to start — so "一键采集" was impossible for these sources even though the
 * database sits at a well-known location on the very machine running cc.
 *
 * This module scans the known default install / data directories for each
 * supported App and returns the discovered database files, grouped by the
 * login account, with an `encrypted` flag and the *primary* message DB picked
 * out. Adapters call it from `authenticate()` (readiness) and `sync()` (auto
 * path) so the common case becomes truly one-click: install the App, log in,
 * click 采集.
 *
 * Layout knowledge is version-aware where it matters:
 *   - WeChat 4.x:  ~/Documents/xwechat_files/<wxid>_<n>/db_storage/...
 *   - WeChat 3.x:  ~/Documents/WeChat Files/<wxid>/Msg/...
 *   - QQ NT:       ~/Documents/Tencent Files/<uin>/nt_qq/nt_db/nt_msg.db
 *   - DingTalk:    %APPDATA%/DingTalk/**, ~/Documents/DingTalk/**  (best-effort)
 *   - Feishu/Lark: %APPDATA%/Feishu | Lark /**                     (best-effort)
 *
 * Pure + dependency-injectable: pass { fs, path, platform, home, env } so the
 * whole thing is unit-testable against a synthetic filesystem with no real
 * Apps installed. Defaults read the real host.
 *
 * Everything is best-effort and defensive: a missing directory, a permission
 * error, or an unexpected layout yields `{ installed: false }` rather than
 * throwing — discovery must never break a readiness probe.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeOs = require("node:os");

/** App keys this module knows how to discover. */
const SUPPORTED_APPS = Object.freeze([
  "wechat-pc",
  "qq-pc",
  "dingtalk-pc",
  "feishu-pc",
]);

// ─── injectable host accessors ─────────────────────────────────────────────

function makeDeps(deps = {}) {
  const fs = deps.fs || nodeFs;
  const path = deps.path || nodePath;
  const platform = deps.platform || process.platform;
  const home =
    deps.home || (deps.os && deps.os.homedir ? deps.os.homedir() : nodeOs.homedir());
  const env = deps.env || process.env;
  return { fs, path, platform, home, env };
}

function safeReaddir(fs, dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
}

function safeExists(fs, p) {
  try {
    return fs.existsSync(p);
  } catch (_e) {
    return false;
  }
}

function safeSize(fs, p) {
  try {
    return fs.statSync(p).size;
  } catch (_e) {
    return 0;
  }
}

/** List immediate subdirectory names of `dir` (empty array on any error). */
function listSubdirs(fs, path, dir) {
  return safeReaddir(fs, dir)
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * Recursively collect *.db / *.sqlite / *.sqlite3 files under `root` up to
 * `maxDepth`. Used for best-effort Apps (DingTalk / Feishu) whose internal
 * layout is proprietary and version-volatile. Bounded so a huge tree can't
 * stall a readiness probe.
 */
function collectDbFiles(fs, path, root, maxDepth, out, depth) {
  if (depth > maxDepth) return out;
  for (const e of safeReaddir(fs, root)) {
    const fp = path.join(root, e.name);
    if (e.isFile() && /\.(db|sqlite|sqlite3)$/i.test(e.name)) {
      out.push(fp);
    } else if (e.isDirectory()) {
      collectDbFiles(fs, path, fp, maxDepth, out, depth + 1);
    }
  }
  return out;
}

// ─── per-App discovery ─────────────────────────────────────────────────────

/**
 * WeChat desktop — handles BOTH the 4.x (`xwechat_files`) and 3.x
 * (`WeChat Files`) layouts. Both store SQLCipher-encrypted DBs.
 */
function discoverWeChat({ fs, path, home, env }) {
  const accounts = [];
  let layout = null;

  // ── 4.x: ~/Documents/xwechat_files/<wxid>_<n>/db_storage/ ──
  const v4Root = path.join(home, "Documents", "xwechat_files");
  if (safeExists(fs, v4Root)) {
    for (const name of listSubdirs(fs, path, v4Root)) {
      // account dirs look like wxid_xxx_1234 ; skip all_users / login etc.
      if (!/^wxid_/.test(name)) continue;
      const storage = path.join(v4Root, name, "db_storage");
      if (!safeExists(fs, storage)) continue;
      const dbs = [];
      const msgDir = path.join(storage, "message");
      for (const e of safeReaddir(fs, msgDir)) {
        if (e.isFile() && /^message_\d+\.db$/i.test(e.name)) {
          dbs.push(mkDb(path.join(msgDir, e.name), "message", "私聊/群聊消息", true, fs));
        }
        if (e.isFile() && /^biz_message_\d+\.db$/i.test(e.name)) {
          dbs.push(mkDb(path.join(msgDir, e.name), "biz-message", "公众号消息", true, fs));
        }
      }
      const contactDb = path.join(storage, "contact", "contact.db");
      if (safeExists(fs, contactDb)) {
        dbs.push(mkDb(contactDb, "contact", "联系人", true, fs));
      }
      const snsDb = path.join(storage, "sns", "sns.db");
      if (safeExists(fs, snsDb)) dbs.push(mkDb(snsDb, "sns", "朋友圈", true, fs));
      const favDb = path.join(storage, "favorite", "favorite.db");
      if (safeExists(fs, favDb)) dbs.push(mkDb(favDb, "favorite", "收藏", true, fs));
      if (dbs.length > 0) {
        layout = "4.x";
        accounts.push({ id: name.replace(/_\d+$/, ""), root: path.join(v4Root, name), dbs });
      }
    }
  }

  // ── 3.x: ~/Documents/WeChat Files/<wxid>/Msg/ ──
  const v3Roots = [
    path.join(home, "Documents", "WeChat Files"),
    env.APPDATA ? path.join(env.APPDATA, "Tencent", "WeChat", "WeChat Files") : null,
  ].filter(Boolean);
  for (const root of v3Roots) {
    if (!safeExists(fs, root)) continue;
    for (const name of listSubdirs(fs, path, root)) {
      if (name === "All Users" || name === "Applet" || name === "WMPF") continue;
      const msgDir = path.join(root, name, "Msg");
      const multiDir = path.join(msgDir, "Multi");
      const dbs = [];
      for (const e of safeReaddir(fs, multiDir)) {
        if (e.isFile() && /^MSG\d+\.db$/i.test(e.name)) {
          dbs.push(mkDb(path.join(multiDir, e.name), "message", "私聊/群聊消息", true, fs));
        }
      }
      const microMsg = path.join(msgDir, "MicroMsg.db");
      if (safeExists(fs, microMsg)) {
        dbs.push(mkDb(microMsg, "contact", "联系人", true, fs));
      }
      if (dbs.length > 0) {
        layout = layout || "3.x";
        accounts.push({ id: name, root: path.join(root, name), dbs });
      }
    }
  }

  return finalize("wechat-pc", accounts, {
    layout,
    encryptedNote:
      "微信本地库为 SQLCipher 加密，需提取数据库密钥后才能解密读取（见 wechat 密钥提取）",
  });
}

/** QQ NT desktop — ~/Documents/Tencent Files/<uin>/nt_qq/nt_db/nt_msg.db */
function discoverQQ({ fs, path, home, env }) {
  const accounts = [];
  const roots = [
    path.join(home, "Documents", "Tencent Files"),
    env.APPDATA ? path.join(env.APPDATA, "Tencent", "QQ") : null,
  ].filter(Boolean);
  for (const root of roots) {
    if (!safeExists(fs, root)) continue;
    for (const name of listSubdirs(fs, path, root)) {
      // per-uin dirs are all-digit; skip nt_qq (global) etc.
      if (!/^\d+$/.test(name)) continue;
      const ntDb = path.join(root, name, "nt_qq", "nt_db", "nt_msg.db");
      if (safeExists(fs, ntDb)) {
        const dbs = [mkDb(ntDb, "message", "私聊/群聊消息", true, fs)];
        const grpInfo = path.join(root, name, "nt_qq", "nt_db", "group_info.db");
        if (safeExists(fs, grpInfo)) dbs.push(mkDb(grpInfo, "group-info", "群信息", true, fs));
        const profile = path.join(root, name, "nt_qq", "nt_db", "profile_info.db");
        if (safeExists(fs, profile)) dbs.push(mkDb(profile, "profile", "好友资料", true, fs));
        accounts.push({ id: name, root: path.join(root, name, "nt_qq"), dbs });
      }
    }
  }
  return finalize("qq-pc", accounts, {
    encryptedNote:
      "QQ NT 本地库为 SQLCipher 加密（数字混淆列 + protobuf 消息体），需密钥解密",
  });
}

/** DingTalk / Feishu — proprietary layout, best-effort recursive scan. */
function discoverGenericIm(appName, roots, { fs, path }) {
  const accounts = [];
  for (const root of roots) {
    if (!safeExists(fs, root)) continue;
    const files = collectDbFiles(fs, path, root, 5, [], 0);
    // Heuristic: message DBs are the larger files whose name hints at chat.
    const dbs = files
      .filter((fp) => !/\b(fts|index|cache|emoji|emoticon|head_image)\b/i.test(fp))
      .map((fp) => {
        const base = path.basename(fp);
        const isMsg = /msg|message|chat|conversation|im_/i.test(base);
        return mkDb(fp, isMsg ? "message" : "other", base, /* encrypted */ false, fs);
      })
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
    if (dbs.length > 0) {
      accounts.push({ id: "default", root, dbs });
    }
  }
  return finalize(appName, accounts, {
    encryptedNote:
      "桌面本地库为私有结构、可能加密、随版本变化；优先尝试明文直读，必要时先解密",
    bestEffort: true,
  });
}

function discoverDingTalk({ fs, path, home, env }) {
  const roots = [
    env.APPDATA ? path.join(env.APPDATA, "DingTalk") : null,
    path.join(home, "Documents", "DingTalk"),
  ].filter(Boolean);
  return discoverGenericIm("dingtalk-pc", roots, { fs, path });
}

function discoverFeishu({ fs, path, home, env }) {
  const roots = [
    env.APPDATA ? path.join(env.APPDATA, "Feishu") : null,
    env.APPDATA ? path.join(env.APPDATA, "Lark") : null,
  ].filter(Boolean);
  return discoverGenericIm("feishu-pc", roots, { fs, path });
}

// ─── helpers ───────────────────────────────────────────────────────────────

function mkDb(p, purpose, label, encrypted, fs) {
  return {
    path: p,
    purpose, // message | biz-message | contact | sns | favorite | group-info | profile | other
    label,
    encrypted: !!encrypted,
    sizeBytes: safeSize(fs, p),
  };
}

/**
 * Common tail: pick the primary message DB (largest message-purpose file
 * across all accounts) and compute the installed flag + summary.
 */
function finalize(app, accounts, extra = {}) {
  const allDbs = accounts.flatMap((a) => a.dbs);
  const messageDbs = allDbs
    .filter((d) => d.purpose === "message")
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
  const primaryDb = (messageDbs[0] || allDbs[0] || null);
  const anyEncrypted = allDbs.some((d) => d.encrypted);
  return {
    app,
    installed: accounts.length > 0,
    accounts,
    primaryDb: primaryDb ? primaryDb.path : null,
    primaryDbInfo: primaryDb,
    encrypted: anyEncrypted,
    dbCount: allDbs.length,
    layout: extra.layout || null,
    bestEffort: !!extra.bestEffort,
    note: accounts.length > 0 ? extra.encryptedNote || null : "未检测到本地数据（可能未安装或未登录）",
  };
}

const DISCOVERERS = Object.freeze({
  "wechat-pc": discoverWeChat,
  "qq-pc": discoverQQ,
  "dingtalk-pc": discoverDingTalk,
  "feishu-pc": discoverFeishu,
});

/**
 * Discover one App's local databases.
 *
 * @param {string} appKey  one of SUPPORTED_APPS
 * @param {object} [deps]  { fs, path, platform, home, env } — inject for tests
 * @returns {DiscoveryResult}
 *
 * @typedef {object} DiscoveryResult
 * @property {string}  app
 * @property {boolean} installed       any account+DB found?
 * @property {Array}   accounts        [{ id, root, dbs: [{path,purpose,label,encrypted,sizeBytes}] }]
 * @property {string|null} primaryDb   best message DB path to point sync at
 * @property {object|null} primaryDbInfo
 * @property {boolean} encrypted       any discovered DB is encrypted?
 * @property {number}  dbCount
 * @property {string|null} layout      version layout hint (wechat: "4.x"/"3.x")
 * @property {boolean} bestEffort      heuristic discovery (dingtalk/feishu)?
 * @property {string|null} note
 */
function discover(appKey, deps = {}) {
  const fn = DISCOVERERS[appKey];
  if (!fn) {
    return {
      app: appKey,
      installed: false,
      accounts: [],
      primaryDb: null,
      primaryDbInfo: null,
      encrypted: false,
      dbCount: 0,
      layout: null,
      bestEffort: false,
      note: `不支持的 App: ${appKey}`,
    };
  }
  try {
    return fn(makeDeps(deps));
  } catch (err) {
    // Discovery must never throw into a readiness probe.
    return {
      app: appKey,
      installed: false,
      accounts: [],
      primaryDb: null,
      primaryDbInfo: null,
      encrypted: false,
      dbCount: 0,
      layout: null,
      bestEffort: false,
      note: `自动发现出错：${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = {
  discover,
  SUPPORTED_APPS,
  // exported for unit tests
  _internals: { collectDbFiles, finalize, mkDb },
};
