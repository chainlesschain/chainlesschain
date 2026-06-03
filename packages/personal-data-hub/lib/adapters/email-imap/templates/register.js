/**
 * register template extractor — Phase 5.4.
 *
 * Compliance: verification codes are NEVER stored. We detect their
 * PRESENCE (so an Event can later be filtered + auto-purged) and return
 * a redacted indicator only. This honours architecture-doc §9.2:
 *
 *   "验证码 / 2FA 邮件**永不存正文**（验证码本身敏感）"
 *
 * Fields:
 *   serviceName       sender display / domain root mapped to friendly
 *                     name (e.g. "GitHub" / "Apple ID" / etc.)
 *   actionType        register / password_reset / 2fa_code / consent /
 *                     login_alert / other
 *   accountIdentifier the email/username the action targets (when
 *                     embedded as "您的账号 X" / "for your account X")
 *   verificationCodePresent boolean — does NOT store the code itself
 */

"use strict";

const { detectVerificationCodes } = require("./utils");

const ACTION_KEYWORDS = [
  { action: "2fa_code", patterns: [/(验证码|verification code|otp|动态密码|安全码|one[\s-]*time\s*password)/i] },
  { action: "password_reset", patterns: [/(密码重置|重置密码|password reset|reset your password|forgot password)/i] },
  { action: "register", patterns: [/(账号已创建|账号注册|确认注册|account created|sign\s*up|registration confirmed|welcome to)/i] },
  { action: "consent", patterns: [/(consent|授权|授权应用|grant access)/i] },
  { action: "login_alert", patterns: [/(登录提醒|新设备登录|sign[-\s]*in alert|new sign-?in|安全登录提醒)/i] },
];

const ACCOUNT_KEYWORDS = /(您的账号|您的账户|for your account|account|你的账号|账号名)\s*[:：]?\s*([^\s,，。]{3,80})/i;

async function extractRegister(email, _opts = {}) {
  const warnings = [];
  const combined = collectSearchableText(email);

  // ── actionType ──────────────────────────────────────────────────
  let actionType = "other";
  for (const a of ACTION_KEYWORDS) {
    if (a.patterns.some((re) => re.test(combined))) {
      actionType = a.action;
      break;
    }
  }
  if (actionType === "other") warnings.push("actionType could not be narrowed");

  // ── verification code presence (REDACTED) ────────────────────────
  const codeProbe = detectVerificationCodes(combined);
  const verificationCodePresent = codeProbe.count > 0;

  // ── serviceName ──────────────────────────────────────────────────
  let serviceName = null;
  if (Array.isArray(email.from) && email.from[0]) {
    serviceName = email.from[0].name || domainRoot(email.from[0].address);
  }

  // ── accountIdentifier ────────────────────────────────────────────
  // Common pattern: emails address user by username or email; only
  // capture when it's a clearly tagged "account: X" form to avoid
  // false positives from sender salutations.
  let accountIdentifier = null;
  const m = combined.match(ACCOUNT_KEYWORDS);
  if (m && m[2] && /[a-z0-9@.]/i.test(m[2])) {
    accountIdentifier = m[2].trim();
  }

  const fields = {
    actionType,
    verificationCodePresent,
    ...(serviceName ? { serviceName } : {}),
    ...(accountIdentifier ? { accountIdentifier } : {}),
  };

  return {
    template: "register",
    fields,
    confidence: confidenceFor(fields),
    warnings,
    // Note: caller (EmailAdapter.normalize) MUST drop content.text from
    // the Event when verificationCodePresent=true — see comment in
    // Adapter_Email_IMAP.md §9.2.
  };
}

function collectSearchableText(email) {
  const parts = [];
  if (email.subject) parts.push(email.subject);
  if (email.textBody) parts.push(email.textBody);
  else if (email.htmlBody) parts.push(String(email.htmlBody).replace(/<[^>]+>/g, " "));
  return parts.join("\n");
}

function domainRoot(addr) {
  if (typeof addr !== "string") return null;
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const domain = addr.slice(at + 1).toLowerCase();
  const parts = domain.split(".");
  if (parts.length >= 2) return parts.slice(-2)[0];
  return domain;
}

function confidenceFor(fields) {
  const tracked = ["actionType", "serviceName", "accountIdentifier"];
  const populated = tracked.filter((k) => {
    if (k === "actionType") return fields[k] && fields[k] !== "other";
    return fields[k] != null;
  }).length;
  return Math.round((populated / tracked.length) * 100) / 100;
}

module.exports = { extractRegister };
