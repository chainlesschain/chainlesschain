// SMS transaction parser — turn bank / payment notification SMS into
// amount-bearing financial events so they feed the PDH spending analysis
// (intent=sum-amount / amount-rank / by-currency).
//
// Context: android-sms rows collected via method D (system-data-android) are
// reliably captured plaintext, but bank/pay SMS ("您尾号1234的储蓄卡消费500.00元")
// were normalized as plain MESSAGE events with title/text only — their amount
// and direction were thrown away, leaving the spending engine with no data on
// the one reliably-collected money source. This module extracts them.
//
// Design discipline (mirrors AnalysisEngine intent routing): STRICTLY additive
// and conservative. A row only becomes a financial event when we are confident
// it is a real transaction notification; anything ambiguous (verification code,
// marketing, balance-only alerts) returns null and keeps the plain MESSAGE
// mapping. False positives (mislabeling an OTP as a payment) are worse than
// false negatives (leaving a real transaction as a message), so the gates are
// deliberately strict.

// Transaction verbs, split by money direction. Presence of one of these is a
// hard requirement — a currency amount alone is never enough.
const OUT_VERBS = [
  "支出",
  "消费",
  "支付",
  "扣款",
  "扣费",
  "扣除",
  "转出",
  "缴费",
  "还款",
  "代扣",
  "取现",
  "取款",
  "汇出",
  "付款",
];
const IN_VERBS = [
  "收入",
  "到账",
  "存入",
  "转入",
  "入账",
  "退款",
  "返现",
  "返还",
  "发放",
  "汇入",
  "退还",
  "工资",
  "报销",
];

// Reject rows that merely look monetary. Verification codes and marketing
// routinely contain digits and even "元", but are not transactions.
const OTP_PATTERNS = [
  /验证码/,
  /校验码/,
  /动态码/,
  /动态密码/,
  /verification\s*code/i,
  /随机码/,
];
const MARKETING_PATTERNS = [
  /满\s*[\d,.]+\s*(?:元|减)/,
  /立减/,
  /优惠券/,
  /代金券/,
  /领取/,
  /抽奖/,
  /中奖/,
  /邀请/,
  /回T退订/,
  /退订回/,
  /积分兑换/,
  /加油包/,
  /会员/,
];

// Currency-anchored amount: either a prefix marker (￥/¥/人民币/RMB/CNY) before
// the number, or the number immediately followed by 元. A bare number without a
// currency anchor is never treated as money (guards against OTP digits).
const PREFIX_AMOUNT =
  /(?:人民币|RMB|CNY|￥|¥)\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
const SUFFIX_AMOUNT =
  /([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:美元|美金|元)/g;

// Words that mark an amount as a running balance rather than the transaction
// value, so "消费500元，余额1000元" picks 500, not 1000.
const BALANCE_MARKERS = [
  "余额",
  "结余",
  "可用额度",
  "账户余额",
  "剩余",
  "可用余额",
];

function containsAny(text, needles) {
  return needles.some((n) => text.includes(n));
}

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

/**
 * Collect every currency-anchored amount in the body with its position and
 * whether a balance marker sits just before it.
 * @returns {Array<{ value:number, index:number, isBalance:boolean }>}
 */
function collectAmounts(body) {
  const found = [];
  for (const re of [PREFIX_AMOUNT, SUFFIX_AMOUNT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      const value = parseFloat(m[1].replace(/,/g, ""));
      if (!Number.isFinite(value) || value <= 0) continue;
      // A balance marker within the ~8 chars before the amount tags it as a
      // balance, not the transaction figure.
      const windowStart = Math.max(0, m.index - 8);
      const preceding = body.slice(windowStart, m.index);
      found.push({
        value,
        index: m.index,
        isBalance: containsAny(preceding, BALANCE_MARKERS),
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function classifySubtype(body, direction) {
  if (/退款|返现|退还/.test(body)) return "refund";
  if (/转账|转入|转出|汇[入出]/.test(body)) return "transfer";
  if (direction === "in") return "income";
  return "payment";
}

/**
 * Decide money direction. A real SMS is one direction; when both verb classes
 * appear (rare), the amount's nearest verb wins.
 */
function resolveDirection(body, amountIndex) {
  const hasOut = containsAny(body, OUT_VERBS);
  const hasIn = containsAny(body, IN_VERBS);
  if (hasOut && !hasIn) return "out";
  if (hasIn && !hasOut) return "in";
  if (!hasOut && !hasIn) return null;
  // Both present — pick the verb class whose nearest occurrence is closest to
  // the transaction amount.
  const nearest = (verbs) =>
    verbs.reduce((best, v) => {
      const i = body.indexOf(v);
      if (i < 0) return best;
      const d = Math.abs(i - amountIndex);
      return d < best ? d : best;
    }, Infinity);
  return nearest(OUT_VERBS) <= nearest(IN_VERBS) ? "out" : "in";
}

/**
 * Parse a bank / payment notification SMS body into a financial event shape,
 * or return null when the row is not a confident transaction notification.
 *
 * @param {string} body  raw SMS text
 * @returns {null | { amountYuan:number, currency:string, direction:'in'|'out',
 *                    subtype:string, balanceYuan?:number }}
 */
function parseTransactionSms(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  // Gate 1: reject verification codes and marketing outright.
  if (matchesAny(body, OTP_PATTERNS)) return null;
  if (matchesAny(body, MARKETING_PATTERNS)) return null;
  // Gate 2: require a transaction verb.
  if (!containsAny(body, OUT_VERBS) && !containsAny(body, IN_VERBS))
    return null;
  // Gate 3: require a currency-anchored amount that is not just a balance.
  const amounts = collectAmounts(body);
  const txAmounts = amounts.filter((a) => !a.isBalance);
  if (txAmounts.length === 0) return null;
  const tx = txAmounts[0];

  const direction = resolveDirection(body, tx.index);
  if (!direction) return null;
  const subtype = classifySubtype(body, direction);

  const result = {
    amountYuan: tx.value,
    currency: /美元|USD|\$/.test(body) ? "USD" : "CNY",
    direction,
    subtype,
  };
  const balance = amounts.find((a) => a.isBalance);
  if (balance) result.balanceYuan = balance.value;
  return result;
}

module.exports = { parseTransactionSms };
