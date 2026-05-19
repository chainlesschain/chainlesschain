/**
 * Thin async-iterator wrapper around imapflow.
 *
 * The hub never imports imapflow directly — this file is the single
 * static require boundary. EmailAdapter takes an ImapSession instance
 * (or any object with the same surface) so tests can inject a mock
 * without imapflow even being installed.
 *
 * Errors are surfaced with normalized `code`:
 *   AUTH_FAILED          login rejected
 *   CONNECTION_FAILED    TCP / TLS failure
 *   MAILBOX_NOT_FOUND    folder doesn't exist
 */

"use strict";

class ImapAuthFailedError extends Error {
  constructor(message, cause) {
    super(message || "IMAP authentication failed");
    this.name = "ImapAuthFailedError";
    this.code = "AUTH_FAILED";
    if (cause) this.cause = cause;
  }
}

class ImapConnectionFailedError extends Error {
  constructor(message, cause) {
    super(message || "IMAP connection failed");
    this.name = "ImapConnectionFailedError";
    this.code = "CONNECTION_FAILED";
    if (cause) this.cause = cause;
  }
}

class ImapMailboxNotFoundError extends Error {
  constructor(name) {
    super(`Mailbox not found: ${name}`);
    this.name = "ImapMailboxNotFoundError";
    this.code = "MAILBOX_NOT_FOUND";
    this.mailbox = name;
  }
}

class ImapSession {
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("ImapSession: opts required");
    }
    for (const f of ["host", "port", "user", "authCode"]) {
      if (opts[f] === undefined || opts[f] === null || opts[f] === "") {
        throw new Error(`ImapSession: opts.${f} required`);
      }
    }
    this.host = String(opts.host);
    this.port = Number(opts.port);
    this.secure = opts.secure !== false;
    this.user = String(opts.user);
    this.authCode = String(opts.authCode);
    this.connectTimeoutMs = Number.isFinite(opts.connectTimeoutMs)
      ? opts.connectTimeoutMs
      : 15000;
    this._factory = typeof opts.imapFlowFactory === "function" ? opts.imapFlowFactory : null;
    this._client = null;
  }

  async connect() {
    let ImapFlowCtor;
    if (this._factory) {
      ImapFlowCtor = this._factory;
    } else {
      try {
        const mod = require("imapflow");
        ImapFlowCtor = mod.ImapFlow || mod.default || mod;
      } catch (err) {
        throw new ImapConnectionFailedError(
          "imapflow is not installed. Run `npm install imapflow` in the workspace.",
          err
        );
      }
    }

    const ctorOpts = {
      host: this.host,
      port: this.port,
      secure: this.secure,
      auth: { user: this.user, pass: this.authCode },
      logger: false,
    };
    let client;
    try {
      // Real imapflow's ImapFlow is an ES class → must use `new`. Test
      // injection sometimes passes an arrow factory which `new` rejects
      // (TypeError: not a constructor). Try constructor first, fall
      // through to plain call so both shapes work.
      try {
        client = new ImapFlowCtor(ctorOpts);
      } catch (ctorErr) {
        if (ctorErr instanceof TypeError) {
          client = ImapFlowCtor(ctorOpts);
        } else {
          throw ctorErr;
        }
      }
    } catch (err) {
      throw new ImapConnectionFailedError(
        `Failed to construct IMAP client: ${err && err.message ? err.message : err}`,
        err
      );
    }

    let connectPromise;
    try {
      connectPromise = client.connect();
    } catch (err) {
      throw new ImapConnectionFailedError(
        `IMAP connect threw synchronously: ${err && err.message ? err.message : err}`,
        err
      );
    }

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new ImapConnectionFailedError(
          `IMAP connect timed out after ${this.connectTimeoutMs}ms`
        ));
      }, this.connectTimeoutMs);
    });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      try { await client.close(); } catch (_e) {}
      const msg = (err && err.message ? err.message : String(err)).toLowerCase();
      if (msg.includes("auth") || msg.includes("invalid credentials") || msg.includes("login") || msg.includes("rejected")) {
        throw new ImapAuthFailedError(err && err.message, err);
      }
      if (err && err.code === "AUTH_FAILED") throw err;
      if (err && err.code === "CONNECTION_FAILED") throw err;
      throw new ImapConnectionFailedError(
        `IMAP connect failed: ${err && err.message ? err.message : err}`,
        err
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    this._client = client;
  }

  _requireConnected() {
    if (!this._client) {
      throw new Error("ImapSession: not connected; call connect() first.");
    }
    return this._client;
  }

  async openMailbox(name) {
    const c = this._requireConnected();
    if (typeof name !== "string" || !name) {
      throw new Error("openMailbox: name must be a non-empty string");
    }
    let info;
    try {
      info = await c.mailboxOpen(name);
    } catch (err) {
      const msg = (err && err.message ? err.message : "").toLowerCase();
      if (msg.includes("doesn't exist") || msg.includes("nonexistent") || msg.includes("not found")) {
        throw new ImapMailboxNotFoundError(name);
      }
      throw err;
    }
    return {
      uidValidity: info.uidValidity,
      uidNext: info.uidNext,
      exists: info.exists,
    };
  }

  async listMailboxes() {
    const c = this._requireConnected();
    const items = await c.list();
    if (!Array.isArray(items)) return [];
    return items.map((m) => ({
      name: m.name,
      path: m.path,
      specialUse: m.specialUse || null,
      flags: Array.isArray(m.flags) ? m.flags : [],
    }));
  }

  async *fetchEnvelopesSince(sinceUid = 0) {
    const c = this._requireConnected();
    const baseUid = Number.isFinite(sinceUid) && sinceUid > 0 ? sinceUid : 0;
    const range = `${baseUid + 1}:*`;
    const fields = { envelope: true, internalDate: true, flags: true, size: true, uid: true };
    const iter = c.fetch(range, fields, { uid: true });
    for await (const msg of iter) {
      yield this._toEnvelopeRow(msg);
    }
  }

  async close() {
    if (!this._client) return;
    try {
      await this._client.logout();
    } catch (_err) {}
    try {
      await this._client.close();
    } catch (_err) {}
    this._client = null;
  }

  _toEnvelopeRow(msg) {
    const env = msg.envelope || {};
    // imapflow returns flags as a Set; older shapes use Array. Cover both.
    let flags = [];
    if (msg.flags) {
      if (msg.flags instanceof Set || Array.isArray(msg.flags) || typeof msg.flags[Symbol.iterator] === "function") {
        flags = Array.from(msg.flags);
      }
    }
    return {
      uid: msg.uid,
      internalDate: msg.internalDate instanceof Date ? msg.internalDate : new Date(msg.internalDate || 0),
      flags,
      messageId: typeof env.messageId === "string" ? env.messageId : "",
      subject: typeof env.subject === "string" ? env.subject : "",
      from: this._addrs(env.from),
      to: this._addrs(env.to),
      cc: this._addrs(env.cc),
      date: env.date instanceof Date ? env.date : env.date ? new Date(env.date) : null,
      size: typeof msg.size === "number" ? msg.size : 0,
    };
  }

  _addrs(list) {
    if (!Array.isArray(list)) return [];
    return list.map((a) => ({
      name: a && a.name ? String(a.name) : undefined,
      address: a && a.address ? String(a.address) : "",
    }));
  }
}

module.exports = {
  ImapSession,
  ImapAuthFailedError,
  ImapConnectionFailedError,
  ImapMailboxNotFoundError,
};
