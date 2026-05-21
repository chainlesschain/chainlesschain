/**
 * AIChat WebView 鉴权向导 — Vendor Cookie Capture Matrix（Phase 10.3.1）
 *
 * 与 `vendors/<name>.js` 的 SPEC 解耦：vendor SPEC 只描述 HTTP 抓数据接口，
 * 本文件描述 wizard 抓 cookie 时需要的"鉴权"维度信息。两层独立，让 adapter
 * 永远纯 HTTP 可测（注入 mock HttpClient 即可），而 wizard 可单独迭代而不
 * 触动 adapter。
 *
 * Reference: docs/design/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md §3
 *
 * 每条 entry 的字段约束 (run validateCookieCaptureSpec to enforce)：
 *   - vendor                ∈ KNOWN_VENDORS
 *   - loginUrl              http(s):// 开头，host 必须出现在 cookieDomains 的主域内
 *   - cookieDomains         ≥ 1 个非空字符串（含 ".<root>" 形式）
 *   - requiredCookies       ≥ 1 个；wizard 至少识别 1 个就认为登录成功
 *   - postLoginPathHints    ≥ 1 个 path（如 "/chat" / "/c/"）
 *   - cookieMaxAgeHintDays  正整数；UI 提前 3 天预警
 *   - notes                 中文用户提示
 *
 * 字段都是反向工程结果，**会变**。Phase 10.4 fixture pin 时把每家真实 cookie
 * 截屏入 `__fixtures__/aichat-cookies/<vendor>.txt` 锁住一版；bump
 * `COOKIE_SPEC_VERSION` 后 HealthChecker 会主动标 SPEC_VERSION_MISMATCH。
 */

"use strict";

const COOKIE_SPEC_VERSION = 1;

const KNOWN_VENDORS = Object.freeze([
  "deepseek",
  "kimi",
  "tongyi",
  "zhipu",
  "hunyuan",
  "qianfan",
  "coze",
  "dreamina",
  "doubao",
]);

const COOKIE_CAPTURE_SPECS = Object.freeze([
  {
    vendor: "deepseek",
    displayName: "DeepSeek",
    loginUrl: "https://chat.deepseek.com/",
    cookieDomains: ["chat.deepseek.com", ".deepseek.com"],
    requiredCookies: ["userToken"],
    optionalCookies: ["intercom-session-deepseek", "session"],
    postLoginPathHints: ["/chat", "/a/"],
    cookieMaxAgeHintDays: 30,
    notes: "需手机号 / 邮箱 + 验证码登录；自动检测 userToken cookie 出现",
  },
  {
    vendor: "kimi",
    displayName: "Kimi",
    loginUrl: "https://kimi.moonshot.cn/",
    cookieDomains: ["kimi.moonshot.cn", ".moonshot.cn"],
    requiredCookies: ["access_token"],
    optionalCookies: ["refresh_token", "session_id"],
    postLoginPathHints: ["/chat", "/"],
    cookieMaxAgeHintDays: 30,
    notes: "手机号验证码登录；access_token 落 cookie 即视为成功",
  },
  {
    vendor: "tongyi",
    displayName: "通义千问",
    loginUrl: "https://tongyi.aliyun.com/",
    cookieDomains: ["tongyi.aliyun.com", ".aliyun.com"],
    requiredCookies: ["login_aliyunid"],
    optionalCookies: ["XSRF-TOKEN", "login_aliyunid_csrf", "tongyi_sso_ticket"],
    postLoginPathHints: ["/qianwen", "/efm"],
    cookieMaxAgeHintDays: 7,
    notes: "阿里云账号 SSO；过期较快（约 7 天）需周期重登",
  },
  {
    vendor: "zhipu",
    displayName: "智谱清言",
    loginUrl: "https://chatglm.cn/",
    cookieDomains: ["chatglm.cn", ".chatglm.cn"],
    requiredCookies: ["chatglm_token"],
    optionalCookies: ["cgsessionid", "chatglm_user_id"],
    postLoginPathHints: ["/main", "/"],
    cookieMaxAgeHintDays: 30,
    notes: "手机号 + 验证码；chatglm_token 出现即认证成功",
  },
  {
    vendor: "hunyuan",
    displayName: "腾讯混元",
    loginUrl: "https://yuanbao.tencent.com/",
    cookieDomains: ["yuanbao.tencent.com", ".tencent.com"],
    requiredCookies: ["hy_token"],
    optionalCookies: ["hy_user", "uin", "skey"],
    postLoginPathHints: ["/chat", "/"],
    cookieMaxAgeHintDays: 14,
    notes: "QQ / 微信 / 手机号；hy_token 落 cookie 视为已登录",
  },
  {
    vendor: "qianfan",
    displayName: "百度文心",
    loginUrl: "https://yiyan.baidu.com/",
    cookieDomains: ["yiyan.baidu.com", ".baidu.com"],
    requiredCookies: ["BDUSS"],
    optionalCookies: ["BAIDUID", "STOKEN", "PTOKEN"],
    postLoginPathHints: ["/chat", "/"],
    cookieMaxAgeHintDays: 7,
    notes: "百度账号；BDUSS 跨域 cookie，可能需在百度首页登录后回来",
  },
  {
    vendor: "coze",
    displayName: "字节扣子 Coze",
    loginUrl: "https://www.coze.cn/",
    cookieDomains: ["www.coze.cn", ".coze.cn"],
    requiredCookies: ["sessionid"],
    optionalCookies: ["passport_csrf_token", "s_v_web_id", "uid_tt"],
    postLoginPathHints: ["/home", "/space"],
    cookieMaxAgeHintDays: 14,
    notes: "字节统一 passport；sessionid 是 bytedance 通用",
  },
  {
    vendor: "dreamina",
    displayName: "即梦 Dreamina",
    loginUrl: "https://jimeng.jianying.com/",
    cookieDomains: ["jimeng.jianying.com", ".jianying.com"],
    requiredCookies: ["sessionid"],
    optionalCookies: ["passport_csrf_token", "s_v_web_id"],
    postLoginPathHints: ["/ai-tool", "/"],
    cookieMaxAgeHintDays: 14,
    notes: "图像生成；与 Coze 共用 bytedance passport sessionid",
  },
  {
    vendor: "doubao",
    displayName: "豆包 Doubao",
    loginUrl: "https://www.doubao.com/chat/",
    cookieDomains: ["www.doubao.com", ".doubao.com"],
    requiredCookies: ["sessionid"],
    optionalCookies: ["sid_guard", "passport_csrf_token", "s_v_web_id"],
    postLoginPathHints: ["/chat"],
    cookieMaxAgeHintDays: 14,
    notes: "字节文本 AI；bytedance 通用 sessionid",
  },
]);

const SPEC_BY_VENDOR = Object.freeze(
  COOKIE_CAPTURE_SPECS.reduce((acc, s) => {
    acc[s.vendor] = s;
    return acc;
  }, Object.create(null)),
);

function getSpec(vendor) {
  if (!vendor || typeof vendor !== "string") return null;
  return SPEC_BY_VENDOR[vendor] || null;
}

function listVendors() {
  return KNOWN_VENDORS.slice();
}

/**
 * Given a probed cookie jar (`{ name: value }` shape), classify which
 * required cookies are present, which are missing, which optional were
 * also captured. Returns:
 *
 *   { ok, foundRequired, missingRequired, foundOptional }
 *
 * `ok === true` iff every required cookie has a non-empty value.
 *
 * `cookies` is tolerated as either a plain object, a Cookie[] (Electron
 * shape), or a raw "k=v; k=v" string (web-shell paste fallback).
 */
function classifyProbedCookies(vendor, cookies) {
  const spec = getSpec(vendor);
  if (!spec) {
    return { ok: false, foundRequired: [], missingRequired: [], foundOptional: [], reason: "UNKNOWN_VENDOR" };
  }

  const jar = _normalizeCookieJar(cookies);

  const foundRequired = [];
  const missingRequired = [];
  for (const name of spec.requiredCookies) {
    const v = jar[name];
    if (typeof v === "string" && v.length > 0) {
      foundRequired.push(name);
    } else {
      missingRequired.push(name);
    }
  }

  const foundOptional = [];
  for (const name of spec.optionalCookies || []) {
    const v = jar[name];
    if (typeof v === "string" && v.length > 0) foundOptional.push(name);
  }

  return {
    ok: missingRequired.length === 0 && foundRequired.length > 0,
    foundRequired,
    missingRequired,
    foundOptional,
  };
}

function _normalizeCookieJar(input) {
  if (!input) return {};
  // Already a plain object { name: value }
  if (typeof input === "object" && !Array.isArray(input)) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  // Electron `Cookie[]` shape (Cookie has { name, value, ... }).
  if (Array.isArray(input)) {
    const out = {};
    for (const c of input) {
      if (c && typeof c.name === "string" && typeof c.value === "string") {
        out[c.name] = c.value;
      }
    }
    return out;
  }
  // Raw "k=v; k=v" string (web-shell paste). Tolerates `;`, `; ` and stray
  // whitespace; only takes the first `=` so values with `=` survive.
  if (typeof input === "string") {
    const out = {};
    for (const pairRaw of input.split(/;\s*/)) {
      const pair = pairRaw.trim();
      if (!pair) continue;
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }
  return {};
}

/**
 * Validate the entire COOKIE_CAPTURE_SPECS array — used both at module
 * load time (defensive) and by the spec test. Throws on the first
 * violation with a vendor-prefixed error so spec mistakes surface fast.
 *
 * Caller can pass `{ throwOnError: false }` to get `{ ok, errors[] }` for
 * defensive validation paths.
 */
function validateCookieCaptureSpec(specs = COOKIE_CAPTURE_SPECS, opts = {}) {
  const errors = [];
  const seen = new Set();

  for (const s of specs) {
    const where = `vendor=${s && s.vendor}`;
    if (!s || typeof s !== "object") {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!KNOWN_VENDORS.includes(s.vendor)) {
      errors.push(`${where}: unknown vendor (not in KNOWN_VENDORS)`);
    }
    if (seen.has(s.vendor)) {
      errors.push(`${where}: duplicate vendor entry`);
    }
    seen.add(s.vendor);

    if (typeof s.displayName !== "string" || !s.displayName) {
      errors.push(`${where}: displayName required`);
    }
    if (typeof s.loginUrl !== "string" || !/^https?:\/\//.test(s.loginUrl)) {
      errors.push(`${where}: loginUrl must start with http:// or https://`);
    } else {
      try {
        const u = new URL(s.loginUrl);
        const host = u.host;
        const matched = (s.cookieDomains || []).some((d) => {
          if (typeof d !== "string") return false;
          if (d.startsWith(".")) return host.endsWith(d.slice(1));
          return host === d;
        });
        if (!matched) {
          errors.push(
            `${where}: loginUrl host "${host}" does not match any cookieDomain entry`,
          );
        }
      } catch (urlErr) {
        errors.push(`${where}: loginUrl unparseable (${urlErr.message})`);
      }
    }
    if (!Array.isArray(s.cookieDomains) || s.cookieDomains.length < 1) {
      errors.push(`${where}: cookieDomains must be a non-empty array`);
    }
    if (!Array.isArray(s.requiredCookies) || s.requiredCookies.length < 1) {
      errors.push(`${where}: requiredCookies must be a non-empty array`);
    }
    if (s.optionalCookies && !Array.isArray(s.optionalCookies)) {
      errors.push(`${where}: optionalCookies must be an array if present`);
    }
    if (!Array.isArray(s.postLoginPathHints) || s.postLoginPathHints.length < 1) {
      errors.push(`${where}: postLoginPathHints must be a non-empty array`);
    }
    if (!Number.isInteger(s.cookieMaxAgeHintDays) || s.cookieMaxAgeHintDays <= 0) {
      errors.push(`${where}: cookieMaxAgeHintDays must be a positive integer`);
    }
    if (typeof s.notes !== "string" || !s.notes) {
      errors.push(`${where}: notes required`);
    }
  }

  if (errors.length > 0 && opts.throwOnError !== false) {
    throw new Error("Invalid cookie capture spec: " + errors.join("; "));
  }
  return { ok: errors.length === 0, errors };
}

// Defensive load-time check — if specs ship malformed in a future patch,
// the module fails fast at require() rather than at first wizard call.
validateCookieCaptureSpec();

module.exports = {
  COOKIE_SPEC_VERSION,
  KNOWN_VENDORS,
  COOKIE_CAPTURE_SPECS,
  getSpec,
  listVendors,
  classifyProbedCookies,
  validateCookieCaptureSpec,
  // exported for tests
  _internal: { _normalizeCookieJar },
};
