/**
 * AlipayApiClient — FAMILY-23 支付宝采集客户端。
 *
 * 支付宝 web cookie uid 不易直取（多走 session token）；v0.1 仅 cookie-scrape
 * （extractUid，best-effort 从 alipay_uid / userId / loginUserId 抽数字 uid）。
 * **v0.2 接通 live 账单 fetcher**：cookie（支付宝会话）经 mobilegw（mgw.htm）
 * 拉账单/交易明细（商户 / 金额 / 收支方向 / 时间）。
 *
 * ⚠️ **best-effort**：mobilegw 接口无公开稳定文档，且生产环境多数 operationType
 *    需要 app 级签名 — 本客户端留 `signProvider` seam（`buildHeaders({url,
 *    operationType, body}) → headers`，镜像仓内 SignProvider 模式），未注入时
 *    发未签名请求（服务端可能拒，错误经 lastError 透出）。端点/operationType/
 *    字段名按社区逆向常见形态实现 + 多字段名兼容（pick 回退），**未经真实
 *    支付宝登录态实地验证**，漂移时改常量 / opts 覆盖。
 * ⚠️ **高敏感**（涉资金）— 上行受 telemetry level + quiet hours 闸（adapter 层
 *    sensitivity: "high"）。
 *
 * profile 不走接口：live 模式 uid 直接由 extractUid 从 cookie 抽（抽不到则只
 *  出账单不出 profile）— 避免再引入一个未经验证的 user-info operationType。
 */
"use strict";

const { pick, toEpochMs } = require("../_live-json-helpers");

const DEFAULT_BASE_URL = "https://mobilegw.alipay.com";
// 端点 / operationType（best-effort，可经 opts 覆盖）。
const PATH_MGW = "/mgw.htm";
const OP_BILL_LIST = "alipay.mobile.bill.list";

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/114.0.0.0 Mobile Safari/537.36 AlipayClient/10.5.0";

/**
 * 金额（元，number 或 "12.50"/"-12.50"/"+12.50" 字符串）→ { amountFen, sign }。
 * amountFen 取绝对值整数分；sign -1/0/1（账单负数=支出）。解析失败返 null。
 */
function parseAmountYuan(v) {
  let n;
  if (Number.isFinite(v)) {
    n = v;
  } else if (typeof v === "string") {
    const cleaned = v.replace(/[¥￥,\s]/g, "");
    if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
    n = parseFloat(cleaned);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return {
    amountFen: Math.round(Math.abs(n) * 100),
    sign: n > 0 ? 1 : n < 0 ? -1 : 0,
  };
}

/**
 * 收支方向：显式字段（"收入"/"in"/"INCOME" → in；"支出"/"out"/"EXPENSE" → out）
 * 优先，否则按金额符号（负=out 正=in），都没有默认 "out"（家长关心消费）。
 */
function deriveDirection(explicit, sign) {
  if (typeof explicit === "string" && explicit.length > 0) {
    const s = explicit.toLowerCase();
    if (s === "in" || s === "income" || explicit.includes("收入")) return "in";
    if (s === "out" || s === "expense" || explicit.includes("支出")) return "out";
  }
  if (sign === 1) return "in";
  return "out";
}

class AlipayApiClient {
  constructor(opts = {}) {
    this._lastErrorCode = 0;
    this._lastErrorMsg = "";
    this._fetch =
      opts.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.mgwPath = opts.mgwPath || PATH_MGW;
    this.billListOp = opts.billListOp || OP_BILL_LIST;
    // 签名 seam：{ buildHeaders({url, operationType, body}) → object }。
    this.signProvider = opts.signProvider || null;
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

  /** @param {string} cookie @returns {string|null} */
  extractUid(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-1, "cookie 为空");
      return null;
    }
    for (const key of ["alipay_uid", "userId", "loginUserId"]) {
      const m = new RegExp(`(?:^|; ?)${key}=(\\d+)`).exec(cookie);
      if (m && m[1] && m[1] !== "0") {
        this._clearLastError();
        return m[1];
      }
    }
    this._setLastError(
      -7,
      "cookie 缺 alipay_uid / userId / loginUserId — 支付宝未登录或仅 session token",
    );
    return null;
  }

  /**
   * live 模式会话探测：数字 uid 可抽，或常见会话 token key（ALIPAYJSESSIONID /
   * JSESSIONID / ctoken / zone）在场即放行，真伪交给服务端校验。
   * @param {string} cookie @returns {boolean}
   */
  hasSession(cookie) {
    if (typeof cookie !== "string" || cookie.length === 0) {
      this._setLastError(-7, "cookie 为空 — 支付宝未登录");
      return false;
    }
    if (/(?:^|; ?)(ALIPAYJSESSIONID|JSESSIONID|ctoken|zone)=[^;\s]+/.test(cookie)) {
      this._clearLastError();
      return true;
    }
    if (this.extractUid(cookie)) return true;
    this._setLastError(
      -7,
      "cookie 缺会话 token（ALIPAYJSESSIONID / JSESSIONID / ctoken）且无数字 uid — 支付宝未登录",
    );
    return false;
  }

  /**
   * POST mgw.htm：form 体 `operationType=<op>&requestData=<json-array>`，带
   * cookie + 可选 signProvider 头。mgw envelope：`{ resultStatus, memo, result }`
   * （resultStatus 1000 = ok，result 可能是 JSON 字符串），或直接平铺业务体
   * （`{ success, ... }`）。成功返业务体，失败返 null（设 lastError）。
   */
  async _postMgw(operationType, requestData, cookie) {
    if (typeof this._fetch !== "function") {
      this._setLastError(
        -2,
        "AlipayApiClient: fetch not available — pass opts.fetch or run on Node 18+",
      );
      return null;
    }
    const url = `${this.baseUrl}${this.mgwPath}`;
    const body =
      `operationType=${encodeURIComponent(operationType)}` +
      `&requestData=${encodeURIComponent(JSON.stringify([requestData]))}`;
    let headers = {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": BROWSER_UA,
    };
    if (this.signProvider && typeof this.signProvider.buildHeaders === "function") {
      try {
        const extra = await this.signProvider.buildHeaders({ url, operationType, body });
        if (extra && typeof extra === "object") headers = { ...headers, ...extra };
      } catch (e) {
        this._setLastError(-5, "sign: " + (e && e.message ? e.message : String(e)));
        return null;
      }
    }
    let resp;
    try {
      resp = await this._fetch(url, { method: "POST", headers, body });
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
    // mgw 网关层错误（resultStatus != 1000）。
    if (obj.resultStatus !== undefined && Number(obj.resultStatus) !== 1000) {
      this._setLastError(
        Number(obj.resultStatus),
        pick(obj, ["memo", "tips", "message"], `resultStatus ${obj.resultStatus}`).toString(),
      );
      return null;
    }
    let result = obj.result !== undefined ? obj.result : obj;
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch (e) {
        this._setLastError(-3, "parse(result): " + (e && e.message ? e.message : String(e)));
        return null;
      }
    }
    // 业务层错误（success === false）。
    if (result && result.success === false) {
      this._setLastError(
        -6,
        pick(result, ["resultMessage", "memo", "message", "msg"], "业务失败").toString(),
      );
      return null;
    }
    this._clearLastError();
    return result;
  }

  /**
   * 账单列表 → [{ orderId, merchant, amountFen, direction, startAt }].
   * null on error.
   * @param {string} cookie
   * @param {object} [opts] { limit, offset }
   */
  async getBillList(cookie, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20;
    const offset = Number.isInteger(opts.offset) && opts.offset > 0 ? opts.offset : 0;
    const result = await this._postMgw(
      this.billListOp,
      { pageSize: limit, pageNum: Math.floor(offset / limit) + 1, offset },
      cookie,
    );
    if (result === null) return null;
    const list = pick(
      result,
      ["billList", "list", "records", "items"],
      Array.isArray(result) ? result : [],
    );
    if (!Array.isArray(list)) return [];
    return list.map((b) => {
      const amount = parseAmountYuan(pick(b, ["amount", "tradeAmount", "money"]));
      return {
        orderId: pick(b, ["billId", "tradeNo", "bizInNo", "alipayOrderNo", "id"]),
        merchant: pick(b, [
          "displayName",
          "merchantName",
          "shopName",
          "goodsTitle",
          "title",
        ]),
        amountFen: amount ? amount.amountFen : null,
        direction: deriveDirection(
          pick(b, ["direction", "inOut", "incomeOrExpense"]),
          amount ? amount.sign : 0,
        ),
        startAt: toEpochMs(pick(b, ["gmtCreate", "createTime", "tradeTime", "payTime"])),
      };
    });
  }

  /**
   * High-level: cookie-scraped uid (profile) + bill list (orders) →
   * snapshot-shaped { account, events } so the adapter normalize path is
   * unchanged. uid 抽不到时仅出账单（account null、无 profile 事件）。
   * @returns {Promise<{account, events}|null>}
   */
  async fetchSnapshot(cookie, opts = {}) {
    if (!this.hasSession(cookie)) return null; // lastError already set
    const include = opts.include || {};
    const events = [];
    let account = null;

    if (include.profile !== false) {
      const uid = this.extractUid(cookie);
      if (uid) {
        account = { uid, displayName: null };
        events.push({ kind: "profile", id: `profile-${uid}`, uid, nickname: null });
      }
      // uid 抽不到不是硬错 — 账单仍可拉。
      this._clearLastError();
    }

    if (include.order !== false) {
      const bills = await this.getBillList(cookie, {
        limit: opts.limit,
        offset: opts.offset,
      });
      if (bills === null) return null;
      for (const b of bills) {
        events.push({
          kind: "order",
          id: b.orderId ? `order-${b.orderId}` : null,
          merchant: b.merchant,
          amountFen: b.amountFen,
          direction: b.direction,
          startAt: b.startAt,
        });
      }
    }

    this._clearLastError();
    return { account, events };
  }
}

module.exports = {
  AlipayApiClient,
  // Exported for tests / endpoint introspection.
  parseAmountYuan,
  deriveDirection,
  PATH_MGW,
  OP_BILL_LIST,
};
