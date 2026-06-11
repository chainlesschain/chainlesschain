/**
 * GenshinApiClient — FAMILY-23 米哈游通行证 (HoYoLAB / 米游社) 采集客户端。
 *
 * v0.1 仅 cookie-scrape（extractUid）。**v0.2 接通 live HTTP fetcher**：
 * 通过米游社 takumi 接口 + DS（dynamic secret）v1 签名拉取角色档案
 * （nickname / level / region / 活跃天数）。原神 web game-record API 不暴露
 * 单次游戏时长（"玩多久" 仍走手机端 collector 快照），但 "玩什么 / 等级 /
 * 活跃天数" 可经合法 cookie 获取——两路互补。
 *
 * DS v1 算法是固定的；轮转的只有 `x-rpc-app_version` ↔ salt 配对（约每隔
 * 几个客户端版本变一次）。配对作为**可覆盖常量**钉在这里（镜像仓内
 * SignProvider 轮转模式）——轮转时改 DEFAULT_APP_VERSION / DEFAULT_DS_SALT，
 * 或在 opts 里传 appVersion / salt。每次轮转后必须用真实已登录 cookie 验证。
 *
 * Cookie key 优先级 (米游社 2023+ → 旧版):
 *   account_id_v2 > ltuid_v2 > account_id > ltuid
 */
"use strict";

const crypto = require("node:crypto");

// ─── Endpoints (CN / 国服) ─────────────────────────────────────────────
const DEFAULT_TAKUMI_API = "https://api-takumi.mihoyo.com";
const DEFAULT_RECORD_API = "https://api-takumi-record.mihoyo.com";
// 原神国服 game_biz。海外 (hk4e_global) 走不同 host，本采集器仅国服。
const GAME_BIZ_GENSHIN_CN = "hk4e_cn";

// ─── DS v1 (rotatable) ─────────────────────────────────────────────────
// 与下方 salt 配对的客户端版本号；DS 校验时 server 比对该版本与 salt。
// 轮转点：客户端大版本更新后 salt 失效 → 同步改这两个常量。
const DEFAULT_APP_VERSION = "2.71.1";
// LK2 / game-record salt（与 DEFAULT_APP_VERSION 配对）。已知会随版本轮转。
const DEFAULT_DS_SALT = "dWCcEenpFEKWPk7FQzfztReDfGdvR9D9";

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 miHoYoBBS/2.71.1";

/** md5 hex digest of a utf-8 string. */
function md5Hex(input) {
  return crypto.createHash("md5").update(String(input), "utf8").digest("hex");
}

/**
 * Generate a DS v1 dynamic-secret header value: `${t},${r},${c}` where
 *   t = floor(epoch_ms / 1000)
 *   r = random integer in [100001, 200000)  (6-digit)
 *   c = md5(`salt=${salt}&t=${t}&r=${r}`)
 *
 * @param {string} salt
 * @param {() => number} nowFn   epoch-ms clock (test seam)
 * @param {() => number} randFn  [0,1) source (test seam)
 */
function genDs(salt, nowFn, randFn) {
  const t = Math.floor(nowFn() / 1000);
  const span = 200000 - 100001;
  const r = 100001 + Math.floor(randFn() * span);
  const c = md5Hex(`salt=${salt}&t=${t}&r=${r}`);
  return `${t},${r},${c}`;
}

class GenshinApiClient {
  constructor(opts = {}) {
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
    // Network deps — resolved lazily so offline callers (extractUid) and
    // tests can construct without a fetch impl. Network methods check.
    this._fetch =
      opts.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    this._now = opts.now || Date.now;
    this._rand = opts.rand || Math.random;
    this.takumiApi = (opts.takumiApi || DEFAULT_TAKUMI_API).replace(/\/+$/, "");
    this.recordApi = (opts.recordApi || DEFAULT_RECORD_API).replace(/\/+$/, "");
    this.appVersion = opts.appVersion || DEFAULT_APP_VERSION;
    this.salt = opts.salt || DEFAULT_DS_SALT;
  }

  _setLastError(code, msg) {
    this._lastErrorCode = code;
    this._lastErrorMsg = msg;
  }

  _clearLastError() {
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
  }

  get lastError() {
    return { code: this._lastErrorCode, message: this._lastErrorMsg };
  }

  /**
   * 从 cookie 串抽米哈游通行证 uid。失败返 null + 设 lastError。
   * @param {string} cookie 形如 "account_id_v2=12345; ltoken_v2=...; ..."
   * @returns {string|null}
   */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const keys = ["account_id_v2", "ltuid_v2", "account_id", "ltuid"];
    for (const key of keys) {
      const m = new RegExp(`(?:^|; ?)${key}=(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 account_id_v2 / ltuid_v2 / account_id / ltuid — 米游社未登录或仅游客态",
    );
    return null;
  }

  _headers(cookie, ds) {
    return {
      Cookie: cookie,
      DS: ds,
      "x-rpc-app_version": this.appVersion,
      "x-rpc-client_type": "5",
      "User-Agent": BROWSER_UA,
      Referer: "https://webstatic.mihoyo.com/",
      Origin: "https://webstatic.mihoyo.com",
    };
  }

  /**
   * GET <url> with DS-signed mihoyo headers. Returns parsed `data` field on
   * success (retcode 0), null on transport / API error (sets lastError).
   * @param {string} url
   * @param {string} cookie
   */
  async _doGetJson(url, cookie) {
    if (typeof this._fetch !== "function") {
      this._setLastError(
        -2,
        "GenshinApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
      return null;
    }
    let resp;
    try {
      const ds = genDs(this.salt, this._now, this._rand);
      resp = await this._fetch(url, { method: "GET", headers: this._headers(cookie, ds) });
    } catch (e) {
      this._setLastError(-4, "network: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    const body = await resp.text();
    if (!resp.ok) {
      this._setLastError(resp.status, `HTTP ${resp.status}`);
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(body);
    } catch (e) {
      this._setLastError(-3, "parse: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    // mihoyo envelope: { retcode, message, data }
    const retcode = typeof obj.retcode === "number" ? obj.retcode : 0;
    if (retcode !== 0) {
      this._setLastError(retcode, (obj.message || "").toString() || `retcode ${retcode}`);
      return null;
    }
    this._clearLastError();
    return obj.data;
  }

  /**
   * Fetch the user's bound Genshin (国服) game roles via cookie.
   * @param {string} cookie
   * @returns {Promise<Array<{game_uid,nickname,level,region,region_name}>|null>}
   */
  async getGameRoles(cookie) {
    const url = `${this.takumiApi}/binding/api/getUserGameRolesByCookie?game_biz=${GAME_BIZ_GENSHIN_CN}`;
    const data = await this._doGetJson(url, cookie);
    if (data === null) return null;
    const list = Array.isArray(data.list) ? data.list : [];
    return list;
  }

  /**
   * Fetch game-record index stats for one role (active_day_number etc.).
   * @param {string} cookie
   * @param {string} roleId  in-game uid (game_uid)
   * @param {string} server  region code (cn_gf01 / cn_qd01)
   * @returns {Promise<object|null>}  the `stats` object or null
   */
  async getRecordStats(cookie, roleId, server) {
    const url = `${this.recordApi}/game_record/app/genshin/api/index?role_id=${encodeURIComponent(
      roleId,
    )}&server=${encodeURIComponent(server)}`;
    const data = await this._doGetJson(url, cookie);
    if (data === null) return null;
    return data.stats && typeof data.stats === "object" ? data.stats : {};
  }

  /**
   * High-level: resolve all bound Genshin roles into profile records shaped
   * to match the snapshot `profile` event (so adapter.normalize is unchanged).
   * When `fetchStats` is true also folds in active_day_number per role.
   *
   * @param {string} cookie
   * @param {object} [opts]
   * @param {boolean} [opts.fetchStats=true]
   * @param {number}  [opts.limit]
   * @returns {Promise<Array<object>|null>}  profile records, or null on hard error
   */
  async fetchProfiles(cookie, opts = {}) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const roles = await this.getGameRoles(cookie);
    if (roles === null) return null; // lastError already set
    const fetchStats = opts.fetchStats !== false;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const profiles = [];
    for (const role of roles) {
      if (profiles.length >= limit) break;
      if (!role || typeof role !== "object") continue;
      const uid = role.game_uid != null ? String(role.game_uid) : null;
      if (!uid) continue;
      const region = role.region || null;
      let activeDayNumber = null;
      if (fetchStats && region) {
        const stats = await this.getRecordStats(cookie, uid, region);
        // A per-role stats failure is non-fatal — still emit the profile.
        if (stats && Number.isFinite(stats.active_day_number)) {
          activeDayNumber = stats.active_day_number;
        }
      }
      profiles.push({
        uid,
        nickname: role.nickname || null,
        level: Number.isFinite(role.level) ? role.level : null,
        region,
        regionName: role.region_name || null,
        activeDayNumber,
      });
    }
    this._clearLastError();
    return profiles;
  }
}

module.exports = {
  GenshinApiClient,
  // Exported for tests / live-pair rotation introspection.
  genDs,
  md5Hex,
  DEFAULT_APP_VERSION,
  DEFAULT_DS_SALT,
  GAME_BIZ_GENSHIN_CN,
};
