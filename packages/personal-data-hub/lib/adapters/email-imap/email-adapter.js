/**
 * EmailAdapter — Phase 5.1 of the Personal Data Hub.
 *
 * Connects to a user's IMAP mailbox (QQ / 189 / 163 / Outlook / Gmail /
 * custom), incrementally syncs new envelopes since the last watermark,
 * and emits one RawEvent per email. Body parsing + LLM classification +
 * 6-template extraction land in Phase 5.2–5.4; this phase just gets the
 * envelope flow working end-to-end with proper UIDVALIDITY-change
 * handling.
 *
 * Watermark format `<uidValidity>:<lastUid>`:
 *   - Same UIDVALIDITY  →  fetch UID > lastUid    (incremental)
 *   - Changed           →  reset lastUid = 0; vault dedupes via Message-ID
 */

"use strict";

const {
  EVENT_SUBTYPES,
  PERSON_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { newId } = require("../../ids");
const { resolveProvider } = require("./providers");
const {
  ImapSession,
  ImapAuthFailedError,
  ImapConnectionFailedError,
} = require("./imap-session");
const { parseRawEmail } = require("./email-parser");

const NAME = "email-imap";
const VERSION = "0.2.0"; // bumped for Phase 5.2 body parsing

class EmailAdapter {
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("EmailAdapter: opts required");
    }
    const account = opts.account;
    if (!account || typeof account !== "object") {
      throw new Error("EmailAdapter: opts.account required");
    }
    if (typeof account.email !== "string" || !account.email.includes("@")) {
      throw new Error("EmailAdapter: account.email must be a full address");
    }
    if (typeof account.authCode !== "string" || account.authCode.length === 0) {
      throw new Error("EmailAdapter: account.authCode required (provider authorization code)");
    }

    this.account = account;
    this._provider = resolveProvider(account);
    this._sessionFactory = typeof opts.sessionFactory === "function"
      ? opts.sessionFactory
      : (cfg) => new ImapSession(cfg);

    // Phase 5.2: opt-out hook for tests that don't want to depend on
    // mailparser. parser must be `async (rawBuffer) => ParsedEmail`.
    this._parser = typeof opts.parser === "function" ? opts.parser : parseRawEmail;
    // Soft cap on bodies stored in vault content.text — long newsletter
    // HTML can be megabytes; trimming keeps `events` row + KG triple
    // + RAG embed budgets sane.
    this._maxBodyChars = Number.isFinite(opts.maxBodyChars) && opts.maxBodyChars > 0
      ? opts.maxBodyChars
      : 8000;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:imap", "auth:authcode", "parse:mime-body", "parse:attachment-metadata"];
    this.rateLimits = { perMinute: 60 };
    this.dataDisclosure = {
      fields: [
        "email:headers (from/to/subject/date/messageId)",
        "email:flags + uid + internalDate",
        "email:body (text + html, capped to ~8k chars)",
        "email:attachment-metadata (filename, contentType, size, sha256; no file bytes saved in v0)",
      ],
      sensitivity: "high",
      legalGate: false,
    };
  }

  async authenticate(_ctx = {}) {
    const session = this._sessionFactory(this._sessionConfig());
    try {
      await session.connect();
      return { ok: true, account: this.account.email, provider: this._provider.providerId };
    } catch (err) {
      if (err instanceof ImapAuthFailedError) {
        return { ok: false, reason: "AUTH_FAILED", error: err.message };
      }
      if (err instanceof ImapConnectionFailedError) {
        return { ok: false, reason: "CONNECTION_FAILED", error: err.message };
      }
      return { ok: false, reason: "UNKNOWN", error: err && err.message ? err.message : String(err) };
    } finally {
      try { await session.close(); } catch (_e) {}
    }
  }

  async healthCheck() {
    const r = await this.authenticate();
    if (r.ok) return { ok: true, lastChecked: Date.now() };
    return { ok: false, reason: r.reason || "unknown", error: r.error };
  }

  async *sync(opts = {}) {
    const folders = Array.isArray(opts.folders) && opts.folders.length > 0
      ? opts.folders
      : this._provider.folders;
    const maxPerFolder = Number.isFinite(opts.maxPerFolder) && opts.maxPerFolder > 0
      ? opts.maxPerFolder
      : 5000;
    const watermark = typeof opts.sinceWatermark === "string" ? opts.sinceWatermark : "";
    const { uidValidity: prevUv, lastUid: prevLastUid } = parseWatermark(watermark);

    const session = this._sessionFactory(this._sessionConfig());
    try {
      await session.connect();

      for (const folder of folders) {
        const mb = await session.openMailbox(folder);
        const uvChanged = prevUv !== null && String(prevUv) !== String(mb.uidValidity);
        const since = uvChanged ? 0 : prevLastUid;

        let emitted = 0;
        for await (const env of session.fetchFullSince(since)) {
          // Parse the body in the adapter (not the session) so the
          // session stays a thin IMAP wrapper. Parse failures degrade
          // gracefully — emit the raw event without parsedBody so the
          // registry's invalidCount tracker isn't tripped by every
          // weird MIME structure we hit in the wild.
          let parsedBody = null;
          try {
            if (env.source && env.source.length > 0) {
              parsedBody = await this._parser(env.source);
            }
          } catch (parseErr) {
            // Phase 5.3 classifier rules can still fire on envelope-only
            // facts; we just lose body text + attachments for this email.
            parsedBody = {
              parseError: parseErr && parseErr.message ? parseErr.message : String(parseErr),
            };
          }
          yield this._envelopeToRawEvent(env, folder, parsedBody);
          emitted += 1;
          if (emitted >= maxPerFolder) break;
        }
      }
    } finally {
      try { await session.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || typeof raw !== "object" || !raw.payload) {
      throw new Error("EmailAdapter.normalize: missing raw or raw.payload");
    }
    const env = raw.payload;
    const ingestedAt = Date.now();
    const occurredAt = (env.internalDate instanceof Date ? env.internalDate.getTime() : 0)
      || (env.date instanceof Date ? env.date.getTime() : 0)
      || raw.capturedAt
      || ingestedAt;

    const persons = [];
    let actorId = "person-self";
    if (Array.isArray(env.from) && env.from.length > 0 && env.from[0].address) {
      const senderAddr = env.from[0].address.toLowerCase();
      const senderId = `person-email-${senderAddr}`;
      const senderName = env.from[0].name || senderAddr;
      persons.push({
        id: senderId,
        type: "person",
        subtype: PERSON_SUBTYPES.CONTACT,
        names: [senderName],
        identifiers: { email: [senderAddr] },
        ingestedAt,
        source: this._source(senderAddr, env.internalDate),
      });
      actorId = senderId;
    }

    const participants = ["person-self"];
    if (actorId !== "person-self") participants.push(actorId);

    const subject = env.subject || "(no subject)";

    // Phase 5.2: prefer the parsed text body over the envelope-only
    // placeholder. Falls back to the recipient prose when body parsing
    // failed or the email was envelope-only fetched.
    const parsedBody = env.parsedBody || null;
    let contentText;
    if (parsedBody && typeof parsedBody.textBody === "string" && parsedBody.textBody.length > 0) {
      contentText = trim(parsedBody.textBody, this._maxBodyChars);
    } else if (parsedBody && typeof parsedBody.htmlBody === "string" && parsedBody.htmlBody.length > 0) {
      // For HTML-only newsletters where the text/plain part is empty,
      // keep a crude strip — analysis prompts handle HTML fine, but
      // BM25 tokenization works better on stripped text.
      contentText = trim(stripHtml(parsedBody.htmlBody), this._maxBodyChars);
    } else {
      contentText = `From: ${env.from && env.from[0] ? formatAddr(env.from[0]) : "?"}; To: ${formatRecipients(env.to)}; subject: ${subject}`;
    }

    const event = {
      id: newId(),
      type: "event",
      subtype: EVENT_SUBTYPES.MESSAGE,
      occurredAt,
      actor: actorId,
      participants,
      content: {
        title: subject,
        text: contentText,
      },
      ingestedAt,
      source: this._source(env.messageId, env.internalDate),
      extra: {
        emailFolder: env.folder,
        messageId: env.messageId,
        from: env.from || [],
        to: env.to || [],
        cc: env.cc || [],
        flags: env.flags || [],
        uid: env.uid,
        size: env.size,
        accountEmail: this.account.email,
        ...(parsedBody && parsedBody.attachments
          ? {
              attachments: parsedBody.attachments.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                contentDisposition: a.contentDisposition,
                size: a.size,
                sha256: a.sha256,
                isInline: a.isInline,
                isEncrypted: a.isEncrypted,
              })),
            }
          : {}),
        ...(parsedBody && parsedBody.contentSha256
          ? { rawSha256: parsedBody.contentSha256 }
          : {}),
        ...(parsedBody && parsedBody.parseError
          ? { parseError: parsedBody.parseError }
          : {}),
        // List-Unsubscribe + other indicator headers will fuel Phase 5.3
        // classification — stash a small allowlist now.
        ...(parsedBody && parsedBody.headers
          ? {
              indicatorHeaders: pickIndicatorHeaders(parsedBody.headers),
            }
          : {}),
      },
    };

    return { events: [event], persons, places: [], items: [], topics: [] };
  }

  _sessionConfig() {
    return {
      host: this._provider.host,
      port: this._provider.port,
      secure: this._provider.secure,
      user: this.account.email,
      authCode: this.account.authCode,
    };
  }

  _envelopeToRawEvent(env, folder, parsedBody) {
    const originalId = env.messageId && env.messageId.length > 0
      ? env.messageId
      : `mid-fallback:${this.account.email}:${folder}:${env.uid}`;
    const capturedAt = env.internalDate instanceof Date && env.internalDate.getTime() > 0
      ? env.internalDate.getTime()
      : Date.now();
    // Strip the raw `source` Buffer from payload — keeping it would
    // bloat the vault's raw_events archive 100x (raw is in worst case
    // hundreds of KB per email; the parsed body alone is enough for
    // re-derive). The source is recoverable by re-syncing if absolutely
    // needed.
    const { source: _src, ...envNoSource } = env;
    return {
      adapter: NAME,
      originalId,
      capturedAt,
      payload: {
        ...envNoSource,
        folder,
        ...(parsedBody ? { parsedBody } : {}),
      },
    };
  }

  _source(originalId, internalDate) {
    return {
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: internalDate instanceof Date && internalDate.getTime() > 0
        ? internalDate.getTime()
        : Date.now(),
      capturedBy: CAPTURED_BY.API,
      originalId: typeof originalId === "string" && originalId.length > 0 ? originalId : undefined,
    };
  }
}

function parseWatermark(s) {
  if (typeof s !== "string" || s.length === 0) {
    return { uidValidity: null, lastUid: 0 };
  }
  const idx = s.indexOf(":");
  if (idx < 0) return { uidValidity: null, lastUid: 0 };
  const uv = s.slice(0, idx);
  const uid = parseInt(s.slice(idx + 1), 10);
  return {
    uidValidity: uv,
    lastUid: Number.isFinite(uid) && uid > 0 ? uid : 0,
  };
}

function formatWatermark(uidValidity, lastUid) {
  const uv = uidValidity == null ? "" : String(uidValidity);
  const uid = Number.isFinite(lastUid) && lastUid > 0 ? lastUid : 0;
  return `${uv}:${uid}`;
}

function formatAddr(a) {
  if (!a || !a.address) return "?";
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

function formatRecipients(list) {
  if (!Array.isArray(list) || list.length === 0) return "?";
  const head = list.slice(0, 3).map(formatAddr).join(", ");
  return list.length > 3 ? `${head} (+${list.length - 3} more)` : head;
}

function trim(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[truncated ${s.length - max} chars]`;
}

/**
 * Quick HTML→plaintext for cases where text/plain part is missing.
 * Phase 5.4 templating may upgrade to cheerio if structure matters,
 * but for BM25 tokenization + LLM prompt prose, a basic strip is fine.
 */
function stripHtml(html) {
  return String(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pick the small set of headers Phase 5.3 classifier rules actually use,
 * so we don't bloat each Event row with the full header bag.
 */
const INDICATOR_HEADERS = [
  "list-unsubscribe",
  "list-id",
  "x-mailer",
  "x-priority",
  "auto-submitted",
  "precedence",
  "x-amazon-mail-relay-type",
  "feedback-id",
  "x-campaign",
  "x-mc-user",
];
function pickIndicatorHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const h of INDICATOR_HEADERS) {
    if (headers[h] !== undefined) out[h] = headers[h];
  }
  return out;
}

module.exports = {
  EmailAdapter,
  parseWatermark,
  formatWatermark,
  NAME,
  VERSION,
};
