/**
 * NeteaseMusicApiClient — 网易云音乐 live cookie web-API fetcher.
 *
 * 走标准 weapi 加密（AES-128-CBC 双层 + textbook-RSA encSecKey）。这套加密常量
 * （presetKey / iv / RSA pubKey+modulus）自 2015 起未变，远比米哈游 DS salt 稳定，
 * 故可放心钉死。登录态仅需 cookie 里的 `MUSIC_U`。
 *
 * 拉取（只读）：
 *   - /weapi/w/nuser/account/get   → uid + nickname（cookie-only）
 *   - /weapi/v1/play/record        → 听歌排行（weekData / allData，含 playCount）
 *   - /weapi/user/playlist         → 用户歌单（id / name / trackCount / creator）
 * 输出事件形状对齐 snapshot（play / playlist），故 adapter.normalize 不变。
 * favorite（喜欢的歌）需额外解 likelist+歌曲详情，留 snapshot 模式，live 暂不出。
 *
 * 加密的随机 secKey 与网络 fetch 都经 opts 注入，可确定性单测。
 */
"use strict";

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://music.163.com";

// ─── weapi crypto constants (stable since 2015) ────────────────────────
const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const AES_IV = "0102030405060708";
const RSA_PUB_KEY = "010001";
const RSA_MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b7251" +
  "52b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ec" +
  "bda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d81" +
  "3cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const SECKEY_ALPHABET =
  "012345679abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** AES-128-CBC encrypt `text` with `key` (utf-8, fixed IV) → base64. */
function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(AES_IV, "utf8"));
  return cipher.update(text, "utf8", "base64") + cipher.final("base64");
}

/** Modular exponentiation over BigInt: base^exp mod m. */
function modpow(base, exp, m) {
  let result = 1n;
  base %= m;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

/** Textbook RSA (no padding) of a short utf-8 string → 256-hex. */
function rsaEncrypt(text, pubKeyHex, modulusHex) {
  const hex = Buffer.from(text, "utf8").toString("hex");
  const base = BigInt("0x" + (hex || "0"));
  const exp = BigInt("0x" + pubKeyHex);
  const mod = BigInt("0x" + modulusHex);
  return modpow(base, exp, mod).toString(16).padStart(256, "0");
}

/**
 * weapi envelope for a payload object. secKey is a 16-char random string
 * (injectable for tests). Returns { params, encSecKey } form fields.
 */
function weapiEncrypt(payloadObj, secKey) {
  const text = JSON.stringify(payloadObj);
  const params = aesEncrypt(aesEncrypt(text, PRESET_KEY), secKey);
  const reversed = secKey.split("").reverse().join("");
  const encSecKey = rsaEncrypt(reversed, RSA_PUB_KEY, RSA_MODULUS);
  return { params, encSecKey };
}

class NeteaseMusicApiClient {
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._fetch =
      opts.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    this._rand = opts.rand || Math.random;
    // Test seam: force a fixed secKey so weapi output is deterministic.
    this._secKey = opts.secKey || null;
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

  _genSecKey() {
    if (this._secKey) return this._secKey;
    let s = "";
    for (let i = 0; i < 16; i += 1) {
      s += SECKEY_ALPHABET[Math.floor(this._rand() * SECKEY_ALPHABET.length)];
    }
    return s;
  }

  /**
   * POST a weapi endpoint. Returns parsed JSON on success (code 200), null on
   * transport / API error (sets lastError).
   * @param {string} path   e.g. "/weapi/user/playlist"
   * @param {object} payload
   * @param {string} cookie
   */
  async _post(path, payload, cookie) {
    if (typeof this._fetch !== "function") {
      this._setLastError(-2, "NeteaseMusicApiClient: fetch not available — pass opts.fetch or run on Node 18+");
      return null;
    }
    const { params, encSecKey } = weapiEncrypt(payload, this._genSecKey());
    const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
    let resp;
    try {
      resp = await this._fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": BROWSER_UA,
          Referer: "https://music.163.com/",
          Cookie: cookie,
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
    const code = typeof obj.code === "number" ? obj.code : 200;
    if (code !== 200) {
      this._setLastError(code, (obj.message || obj.msg || `code ${code}`).toString());
      return null;
    }
    this._clearLastError();
    return obj;
  }

  /** Resolve logged-in account → { uid, nickname } or null. */
  async getAccount(cookie) {
    const obj = await this._post("/weapi/w/nuser/account/get", {}, cookie);
    if (obj === null) return null;
    const profile = obj.profile && typeof obj.profile === "object" ? obj.profile : null;
    const account = obj.account && typeof obj.account === "object" ? obj.account : null;
    const uid =
      (profile && profile.userId != null && String(profile.userId)) ||
      (account && account.id != null && String(account.id)) ||
      null;
    if (!uid) {
      this._setLastError(-7, "未登录或 cookie 失效（account.get 无 userId）");
      return null;
    }
    return { uid, nickname: (profile && profile.nickname) || null };
  }

  /**
   * 听歌排行。type 1 = 最近一周（含 playCount），0 = 累计。
   * @returns {Promise<Array<{songId,song,artist,album,playCount}>|null>}
   */
  async getPlayRecord(cookie, uid, type = 1) {
    const obj = await this._post("/weapi/v1/play/record", { uid, type }, cookie);
    if (obj === null) return null;
    const rows = Array.isArray(obj.weekData) && obj.weekData.length > 0
      ? obj.weekData
      : Array.isArray(obj.allData)
        ? obj.allData
        : [];
    return rows.map((r) => {
      const song = r && r.song ? r.song : {};
      const artist = Array.isArray(song.ar)
        ? song.ar.map((a) => a && a.name).filter(Boolean).join(" / ")
        : "";
      return {
        songId: song.id != null ? String(song.id) : null,
        song: song.name || "(未知歌曲)",
        artist,
        album: song.al && song.al.name ? song.al.name : null,
        playCount: Number.isFinite(r.playCount) ? r.playCount : null,
      };
    });
  }

  /**
   * 用户歌单。
   * @returns {Promise<Array<{playlistId,name,trackCount,creator}>|null>}
   */
  async getUserPlaylists(cookie, uid, limit = 100) {
    const obj = await this._post(
      "/weapi/user/playlist",
      { uid, limit, offset: 0, includeVideo: true },
      cookie,
    );
    if (obj === null) return null;
    const list = Array.isArray(obj.playlist) ? obj.playlist : [];
    return list.map((p) => ({
      playlistId: p.id != null ? String(p.id) : null,
      name: p.name || "(未命名歌单)",
      trackCount: Number.isFinite(p.trackCount) ? p.trackCount : null,
      creator: p.creator && p.creator.nickname ? p.creator.nickname : null,
    }));
  }

  /**
   * High-level: build snapshot-shaped events (play + playlist) for a cookie.
   * Output matches the adapter snapshot schema so normalize is unchanged.
   * @returns {Promise<{account, events}|null>}
   */
  async fetchSnapshot(cookie, opts = {}) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    const account = await this.getAccount(cookie);
    if (account === null) return null; // lastError set
    const events = [];
    const include = opts.include || {};

    if (include.play !== false) {
      const plays = await this.getPlayRecord(cookie, account.uid, opts.recordType != null ? opts.recordType : 1);
      if (plays === null) return null;
      for (const r of plays) {
        events.push({
          kind: "play",
          id: r.songId ? `play-${r.songId}` : null,
          songId: r.songId,
          song: r.song,
          artist: r.artist,
          album: r.album,
          playCount: r.playCount,
        });
      }
    }

    if (include.playlist !== false) {
      const lists = await this.getUserPlaylists(cookie, account.uid, opts.playlistLimit || 100);
      if (lists === null) return null;
      for (const p of lists) {
        events.push({
          kind: "playlist",
          id: p.playlistId ? `playlist-${p.playlistId}` : null,
          playlistId: p.playlistId,
          name: p.name,
          trackCount: p.trackCount,
          creator: p.creator,
        });
      }
    }

    this._clearLastError();
    return { account: { uid: account.uid, nickname: account.nickname }, events };
  }
}

module.exports = {
  NeteaseMusicApiClient,
  // Exported for tests.
  weapiEncrypt,
  aesEncrypt,
  rsaEncrypt,
  modpow,
};
