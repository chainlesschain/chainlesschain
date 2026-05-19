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

const NAME = "email-imap";
const VERSION = "0.1.0";

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

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:imap", "auth:authcode"];
    this.rateLimits = { perMinute: 60 };
    this.dataDisclosure = {
      fields: [
        "email:headers (from/to/subject/date/messageId)",
        "email:flags + uid + internalDate",
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
        for await (const env of session.fetchEnvelopesSince(since)) {
          yield this._envelopeToRawEvent(env, folder);
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

    const event = {
      id: newId(),
      type: "event",
      subtype: EVENT_SUBTYPES.MESSAGE,
      occurredAt,
      actor: actorId,
      participants,
      content: {
        title: subject,
        text: `From: ${env.from && env.from[0] ? formatAddr(env.from[0]) : "?"}; To: ${formatRecipients(env.to)}; subject: ${subject}`,
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

  _envelopeToRawEvent(env, folder) {
    const originalId = env.messageId && env.messageId.length > 0
      ? env.messageId
      : `mid-fallback:${this.account.email}:${folder}:${env.uid}`;
    const capturedAt = env.internalDate instanceof Date && env.internalDate.getTime() > 0
      ? env.internalDate.getTime()
      : Date.now();
    return {
      adapter: NAME,
      originalId,
      capturedAt,
      payload: { ...env, folder },
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

module.exports = {
  EmailAdapter,
  parseWatermark,
  formatWatermark,
  NAME,
  VERSION,
};
