/**
 * VendorSpec — per-AI-vendor contract used by AIChatHistoryAdapter.
 *
 * Each of the 8 supported vendors (DeepSeek / Kimi / 通义 / 智谱 / 混元 / 千帆 /
 * 扣子 / Dreamina) provides one VendorSpec object describing:
 *
 *   - Identity (`name`, `displayName`, `androidPackage`)
 *   - Login surface (`loginUrl`, `cookieDomains`)
 *   - Sync surface (`listConversations(ctx, opts)`, `listMessages(ctx, convId, opts)`)
 *   - Health (`validateCookie(ctx)`)
 *   - Rate limits (`rateLimits`)
 *
 * The parent adapter fans out to all configured vendors and reuses one cookie
 * jar per vendor. Vendor implementations live in `./vendors/<name>.js` and are
 * SKELETONS in Phase 10.1 — they advertise the right shape and ratelimit so
 * the AdapterRegistry contract holds, but the actual HTTP wiring is wired in
 * later (Phase 10.2+). See `Adapter_AIChat_History.md` §6 per-vendor detail.
 */

"use strict";

const SUPPORTED_VENDORS = Object.freeze([
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

class NotImplementedYetError extends Error {
  constructor(vendor, capability) {
    super(`vendor "${vendor}" capability "${capability}" not wired yet (Phase 10.2+)`);
    this.code = "VENDOR_NOT_WIRED";
    this.vendor = vendor;
    this.capability = capability;
  }
}

function assertVendorSpec(spec) {
  const errors = [];
  if (spec == null || typeof spec !== "object") {
    return { ok: false, errors: ["vendor spec must be an object"] };
  }
  if (typeof spec.name !== "string" || !SUPPORTED_VENDORS.includes(spec.name)) {
    errors.push(`name must be one of ${SUPPORTED_VENDORS.join("|")}`);
  }
  if (typeof spec.displayName !== "string" || spec.displayName.length === 0) {
    errors.push("displayName required");
  }
  if (typeof spec.androidPackage !== "string" || spec.androidPackage.length === 0) {
    errors.push("androidPackage required");
  }
  if (typeof spec.loginUrl !== "string" || !/^https:\/\//.test(spec.loginUrl)) {
    errors.push("loginUrl required and must be https URL");
  }
  if (!Array.isArray(spec.cookieDomains) || spec.cookieDomains.length === 0) {
    errors.push("cookieDomains must be a non-empty array");
  }
  if (typeof spec.listConversations !== "function") {
    errors.push("listConversations must be an async generator function");
  }
  if (typeof spec.listMessages !== "function") {
    errors.push("listMessages must be an async generator function");
  }
  if (typeof spec.validateCookie !== "function") {
    errors.push("validateCookie must be an async function");
  }
  if (
    spec.rateLimits == null
    || typeof spec.rateLimits !== "object"
    || typeof spec.rateLimits.perMinute !== "number"
  ) {
    errors.push("rateLimits.perMinute (number) required");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

module.exports = {
  SUPPORTED_VENDORS,
  NotImplementedYetError,
  assertVendorSpec,
};
