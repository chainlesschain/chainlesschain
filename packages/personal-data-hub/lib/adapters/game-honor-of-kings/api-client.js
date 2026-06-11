/**
 * HonorOfKingsApiClient — 王者荣耀 (Honor of Kings) 采集客户端。
 *
 * v0.1 仅 cookie-scrape（extractUid）。**v0.2 接通 live 营地战绩 fetcher**：
 * 经 王者营地 (KOH Camp / gamehelper) 接口拉取个人资料 + 最近对局（含对局时长，
 * 即家长关心的 "玩多久"）。
 *
 * ⚠️ 鉴权与 genshin/netease 不同：营地走 QQ/微信 OAuth，需 access_token + openid
 *    + acctype（"qc"=QQ / "wx"=微信）+ 游戏角色 (areaId / roleId)，**不是 web
 *    cookie**——这些 token 由营地 App 登录态产出（手机端 collector 取得后回传）。
 * ⚠️ **best-effort**：营地接口路径/字段无公开稳定文档，下方端点与字段名按社区
 *    逆向常见形态实现，且做了多字段名兼容（pick 回退）。**未经真实营地登录态
 *    实地验证**，端点/字段漂移时按需调整（同 SignProvider 轮转思路，端点/字段
 *    都集中在常量与 pick 列表里便于改）。
 *
 * Cookie key 优先级 (extractUid，仅 v0.1 探测用): openid > uin(QQ号) > tencent_uid。
 */
"use strict";

const DEFAULT_BASE_URL = "https://ssl.kohsocialapp.qq.com:10001";

// 营地常见端点（best-effort，可经 opts 覆盖）。
const PATH_PROFILE = "/play/profildetail";
const PATH_BATTLE_LIST = "/game/getbattlelist";

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 12; gamehelper) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/103.0.5060.129 Mobile Safari/537.36 GameHelper";

/** First present, non-empty value among `keys` on `obj`. */
function pick(obj, keys, fallback = null) {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

/**
 * Coerce a seconds-or-ms match duration to ms. Match lengths separate cleanly:
 * seconds form is ≤ ~7200 (2h), ms form is ≥ ~300000 (5min) — so a 1e5 threshold
 * disambiguates without overlap.
 */
function toDurationMs(v) {
  if (!Number.isFinite(v)) {
    const n = typeof v === "string" && /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return 0;
    v = n;
  }
  if (v <= 0) return 0;
  return v < 1e5 ? v * 1000 : v;
}

/** Coerce epoch seconds-or-ms (or date string) to ms, else null. */
function toEpochMs(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

class HonorOfKingsApiClient {
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.profilePath = opts.profilePath || PATH_PROFILE;
    this.battleListPath = opts.battleListPath || PATH_BATTLE_LIST;
    this._fetch =
      opts.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    this._now = opts.now || Date.now;
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
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
   * 从 cookie 串抽 uid（v0.1 探测；live 模式用 credential.roleId）。
   * @param {string} cookie @returns {string|null}
   */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const openid = /(?:^|; ?)openid=([A-Za-z0-9_-]+)/.exec(cookie);
    if (openid && openid[1] && openid[1].length >= 8) {
      this._clearLastError();
      return openid[1];
    }
    for (const key of ["uin", "tencent_uid"]) {
      const m = new RegExp(`(?:^|; ?)${key}=o?0*(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(-7, "cookie 缺 openid / uin / tencent_uid — 营地/微信/QQ 未登录");
    return null;
  }

  /** Auth fields every Camp request carries, derived from a credential bundle. */
  _authFields(cred) {
    return {
      accessToken: cred.accessToken,
      openid: cred.openid,
      // Camp uses acctype "qc" (QQ) / "wx" (WeChat); login type mirrors it.
      acctype: cred.acctype || "qc",
      gameId: cred.gameId || "20001", // KOH gameId on the camp platform
      areaId: cred.areaId != null ? String(cred.areaId) : undefined,
      partition: cred.partition != null ? String(cred.partition) : undefined,
      roleId: cred.roleId != null ? String(cred.roleId) : undefined,
      serverId: cred.serverId != null ? String(cred.serverId) : undefined,
    };
  }

  /**
   * POST a Camp endpoint with auth fields merged into the JSON body. Returns
   * the envelope `data` on success, null on transport / API error.
   */
  async _post(path, extraBody, cred) {
    if (typeof this._fetch !== "function") {
      this._setLastError(-2, "HonorOfKingsApiClient: fetch not available — pass opts.fetch or run on Node 18+");
      return null;
    }
    const body = JSON.stringify({ ...this._authFields(cred), ...extraBody });
    let resp;
    try {
      resp = await this._fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": BROWSER_UA,
        },
        body,
      });
    } catch (e) {
      this._setLastError(-4, "network: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    const txt = await resp.text();
    if (!resp.ok) {
      this._setLastError(resp.status, `HTTP ${resp.status}`);
      return null;
    }
    let obj;
    try {
      obj = JSON.parse(txt);
    } catch (e) {
      this._setLastError(-3, "parse: " + (e && e.message ? e.message : String(e)));
      return null;
    }
    // Camp envelope: { returnCode|result|ret, returnMsg|msg, data }. 0 = ok.
    const code = pick(obj, ["returnCode", "result", "ret", "code"], 0);
    if (Number(code) !== 0) {
      this._setLastError(Number(code), pick(obj, ["returnMsg", "msg", "message"], `code ${code}`).toString());
      return null;
    }
    this._clearLastError();
    return obj.data !== undefined ? obj.data : obj;
  }

  /** 个人资料 → { uid, nickname, level, rank, avatarUrl } or null. */
  async getProfile(cred) {
    const data = await this._post(this.profilePath, {}, cred);
    if (data === null) return null;
    // Camp may wrap the role under data.role / data.roleInfo / data directly.
    const role = pick(data, ["role", "roleInfo", "baseInfo"], data);
    const uid =
      pick(role, ["roleId", "uid", "roleIdStr"]) || (cred.roleId != null ? String(cred.roleId) : null);
    return {
      uid: uid != null ? String(uid) : null,
      nickname: pick(role, ["roleName", "nickName", "nickname", "name"]),
      level: (() => {
        const lv = pick(role, ["level", "roleLevel"]);
        return Number.isFinite(Number(lv)) ? Number(lv) : null;
      })(),
      rank: pick(role, ["rankName", "gradeName", "segmentName", "rank", "dengjib"]),
      avatarUrl: pick(role, ["logo", "headUrl", "avatar", "iconUrl"]),
    };
  }

  /**
   * 最近对局 → [{ matchId, startAt, durationMs, mode }]. null on error.
   * @param {object} cred
   * @param {object} [opts] { limit, offset }
   */
  async getBattleList(cred, opts = {}) {
    const data = await this._post(
      this.battleListPath,
      { offset: opts.offset || 0, num: opts.limit || 20, count: opts.limit || 20 },
      cred,
    );
    if (data === null) return null;
    const list = pick(data, ["list", "battleList", "records", "data"], Array.isArray(data) ? data : []);
    if (!Array.isArray(list)) return [];
    return list.map((m) => ({
      matchId: pick(m, ["gameSeq", "gameId", "relaySvrId", "battleId", "id"]),
      startAt: toEpochMs(pick(m, ["startTime", "stTime", "gameTime", "battleTime"])),
      durationMs: toDurationMs(pick(m, ["gametime", "usedTime", "gameDuration", "duration"], 0)),
      mode: pick(m, ["mapName", "modeName", "gameName", "mode", "mapId"]),
    }));
  }

  /**
   * High-level: profile + recent battles → snapshot-shaped events so the
   * adapter normalize path is unchanged.
   * @returns {Promise<{account, events}|null>}
   */
  async fetchSnapshot(cred, opts = {}) {
    if (!cred || typeof cred !== "object" || !cred.accessToken || !cred.openid) {
      this._setLastError(-1, "credential 缺 accessToken / openid（营地未登录）");
      return null;
    }
    const include = opts.include || {};
    const events = [];
    let account = null;

    if (include.profile !== false) {
      const profile = await this.getProfile(cred);
      if (profile === null) return null;
      account = { uid: profile.uid, displayName: profile.nickname };
      events.push({
        kind: "profile",
        id: profile.uid ? `profile-${profile.uid}` : null,
        uid: profile.uid,
        nickname: profile.nickname,
        level: profile.level,
        rank: profile.rank,
        avatarUrl: profile.avatarUrl,
      });
    }

    if (include.play !== false) {
      const battles = await this.getBattleList(cred, { limit: opts.limit, offset: opts.offset });
      if (battles === null) return null;
      for (const b of battles) {
        events.push({
          kind: "play",
          id: b.matchId ? `play-${b.matchId}` : null,
          durationMs: b.durationMs,
          mode: b.mode,
          startAt: b.startAt,
        });
      }
    }

    this._clearLastError();
    return { account, events };
  }
}

module.exports = {
  HonorOfKingsApiClient,
  // Exported for tests / endpoint introspection.
  pick,
  toDurationMs,
  toEpochMs,
  PATH_PROFILE,
  PATH_BATTLE_LIST,
};
