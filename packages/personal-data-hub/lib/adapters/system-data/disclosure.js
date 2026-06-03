/**
 * dataDisclosure metadata + helpers for SystemDataAdapter — Phase 4.5.6.
 *
 * The metadata itself lives on the adapter (so the AdapterRegistry sees it
 * during `assertAdapter`). This module exposes additional helpers for the
 * desktop UI / hub layer to read:
 *
 *   - SOURCE_DESCRIPTORS — per-source human-readable label + field list +
 *     sensitivity tier; the UI maps each to a toggle in the disclosure
 *     dialog (per Adapter_System_Data.md §5.1 mockup).
 *   - sanitizeInclude({...}) — clamp arbitrary user input to the supported
 *     boolean shape, so a stale Vue store can't smuggle non-boolean values
 *     past adapter.sync().
 *   - resolveRetentionMs({retentionDays}) — convert the user-set retention
 *     policy to milliseconds; the hub job runner uses this to schedule
 *     periodic deletes.
 *
 * Why a separate file rather than inline on the adapter? Three reasons:
 *   1. The Vue layer can `require()` this without spinning up a SidecarSupervisor.
 *   2. Tests can compare the descriptor list against the adapter's actual
 *      `dataDisclosure.fields` array, catching drift.
 *   3. Future sources (calendar, browser history) follow the same shape so
 *      the disclosure UI is reusable.
 */

"use strict";

const SOURCE_DESCRIPTORS = Object.freeze({
  contacts: Object.freeze({
    key: "contacts",
    label: "通讯录",
    fields: ["name", "phone", "email", "organization", "notes", "starred", "photoUri"],
    sensitivity: "medium",
    defaultEnabled: true,
    estimate: "约 50-500 人",
    rationale: "作为 EntityResolver 跨源 Person 主键的权威种子集",
  }),
  calllog: Object.freeze({
    key: "calllog",
    label: "通话记录",
    fields: ["number", "duration", "timestamp", "type", "name"],
    sensitivity: "high",
    defaultEnabled: true,
    estimate: "近 1 年约 1-10k 条",
    rationale: "跨人互动时间线，独立于 app 内聊天",
  }),
  sms: Object.freeze({
    key: "sms",
    label: "短信和彩信",
    fields: ["address", "body", "timestamp", "type", "threadId", "isRead"],
    sensitivity: "high",
    defaultEnabled: false, // opt-out (per OQ-SD1 + design doc §5.1)
    estimate: "近 3 年约 5-20k 条",
    rationale: "银行账单、验证码、物流通知的元数据源；含他人信息",
    warning: "可能包含他人电话号码或对话内容",
  }),
  wifi: Object.freeze({
    key: "wifi",
    label: "WiFi 网络（不含密码）",
    fields: ["ssid", "securityType", "hidden"],
    excludedFields: ["password"],
    sensitivity: "low",
    defaultEnabled: true,
    estimate: "约 5-50 个",
    rationale: "常去地点种子（家/办公室/常去咖啡店）",
  }),
});

const SOURCE_KEYS = Object.freeze(Object.keys(SOURCE_DESCRIPTORS));

/**
 * Clamp arbitrary user-provided `include` object to a strict boolean shape.
 * Unknown keys are dropped; missing keys fall back to descriptor defaults.
 *
 * @param {object} raw  user-controllable input from UI / IPC layer
 * @returns {{contacts: boolean, calllog: boolean, sms: boolean, wifi: boolean}}
 */
function sanitizeInclude(raw) {
  const out = {};
  for (const key of SOURCE_KEYS) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = Boolean(raw[key]);
    } else {
      out[key] = SOURCE_DESCRIPTORS[key].defaultEnabled;
    }
  }
  return out;
}

/**
 * Resolve a user-configured retention policy to a wall-clock millisecond
 * threshold (rows with `ingestedAt < now - returnedMs` are eligible for
 * background purge).
 *
 * @param {{retentionDays?: number}} policy
 * @returns {number|null}  null means "no retention cap" (default)
 */
function resolveRetentionMs(policy) {
  if (!policy || policy.retentionDays == null) return null;
  const days = Number(policy.retentionDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.floor(days * 24 * 60 * 60 * 1000);
}

/**
 * Cross-check that the disclosure-fields strings on the adapter actually
 * cover every source's declared fields. Used in tests to catch the
 * "adapter shipped a field the UI never warned about" drift bug.
 *
 * Returns { ok: boolean, missing: string[] } — `missing` lists
 * "source:field" pairs that the adapter doesn't declare.
 */
function checkDisclosureCoverage(adapterFields) {
  const declared = new Set(adapterFields || []);
  const missing = [];
  for (const desc of Object.values(SOURCE_DESCRIPTORS)) {
    const expected = `${desc.key}:${desc.fields.join(",")}`;
    const sourceHit = Array.from(declared).find((s) => s.startsWith(`${desc.key}:`));
    if (!sourceHit) {
      missing.push(expected);
      continue;
    }
    // Verify every expected field appears in the declared string.
    const declaredFields = new Set(
      sourceHit.split(":", 2)[1].split(",").map((s) => s.trim()),
    );
    for (const f of desc.fields) {
      if (!declaredFields.has(f)) missing.push(`${desc.key}:${f}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Localized disclosure dialog payload — what the UI binds to.
 * Returns a stable structure independent of the adapter instance, so the
 * Vue store can be tested without the adapter wired in.
 */
function buildDisclosurePayload() {
  return {
    adapter: "system-data",
    sensitivity: "high",
    legalGate: true,
    notice:
      "短信和通话记录可能包含他人电话号码或对话内容；所有数据在本机加密存储，不向任何服务器上传（含 AI 分析）。",
    sources: SOURCE_KEYS.map((key) => SOURCE_DESCRIPTORS[key]),
    legalDeclaration:
      [
        "您声明：",
        "1. 您是这部手机的合法使用者，对其上数据拥有访问权",
        "2. 您理解短信内容可能涉及他人隐私，承诺仅在本机使用，不向任何第三方分发",
        "3. 本工具不会将系统数据上传至云端（含 LLM 分析全部本地完成）",
        "",
        "不符合上述条件，请勿启用本 adapter。",
      ].join("\n"),
  };
}

module.exports = {
  SOURCE_DESCRIPTORS,
  SOURCE_KEYS,
  sanitizeInclude,
  resolveRetentionMs,
  checkDisclosureCoverage,
  buildDisclosurePayload,
};
