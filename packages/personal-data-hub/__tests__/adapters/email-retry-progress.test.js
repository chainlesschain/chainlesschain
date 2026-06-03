"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  EmailAdapter,
} = require("../../lib/adapters/email-imap/email-adapter");

/**
 * Helpers — mock session factory + envelope generator. Mirrors the
 * patterns in email-adapter.test.js but allows per-attempt connect
 * outcomes for retry testing.
 */
function makeFlakySession(spec = {}) {
  // spec: { connectFailures: [<err>, <err>, ...], mailboxes: {INBOX: {...}} }
  const failures = (spec.connectFailures || []).slice();
  const recorder = { connectAttempts: 0, openedMailboxes: [], closedCalls: 0 };
  const factory = (_opts) => {
    let openMb = null;
    return {
      async connect() {
        recorder.connectAttempts += 1;
        if (failures.length > 0) {
          const err = failures.shift();
          throw err;
        }
        if (spec.connectThrows) throw spec.connectThrows;
      },
      async openMailbox(name) {
        recorder.openedMailboxes.push(name);
        const mb = spec.mailboxes && spec.mailboxes[name];
        if (!mb) {
          const err = new Error(`Mailbox doesn't exist: ${name}`);
          err.code = "MAILBOX_NOT_FOUND";
          throw err;
        }
        openMb = { name, ...mb };
        return {
          uidValidity: mb.uidValidity,
          uidNext: mb.uidNext || 9999,
          exists: (mb.envelopes || []).length,
        };
      },
      async *fetchFullSince(sinceUid = 0) {
        if (!openMb) return;
        for (const env of openMb.envelopes || []) {
          if (env.uid > sinceUid) yield { ...env, source: env.source || Buffer.alloc(0) };
        }
      },
      async close() {
        recorder.closedCalls += 1;
      },
    };
  };
  return { factory, recorder };
}

const env = (uid) => ({
  uid,
  internalDate: new Date(`2026-05-${String(uid % 30).padStart(2, "0")}T10:00:00Z`),
  flags: ["\\Seen"],
  messageId: `<m-${uid}@x>`,
  subject: `Subject ${uid}`,
  from: [{ name: "Sender", address: `s${uid}@example.com` }],
  to: [{ address: "me@example.com" }],
  cc: [],
  date: new Date(`2026-05-${String(uid % 30).padStart(2, "0")}T10:00:00Z`),
  size: 1024,
});

// ─── Phase 5.7.1 retry-with-backoff ──────────────────────────────────────

describe("EmailAdapter — Phase 5.7.1 connect retry", () => {
  it("retries up to maxConnectRetries on transient errors then succeeds", async () => {
    const transientErr = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    const { factory, recorder } = makeFlakySession({
      connectFailures: [transientErr, transientErr], // 2 fails then OK on 3rd
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [env(1)] } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({ textBody: "", attachments: [] }),
      maxConnectRetries: 3,
      retryBaseDelayMs: 1, // speed up test
    });

    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(recorder.connectAttempts).toBe(3); // 1 fail + 1 fail + 1 success
    expect(raws).toHaveLength(1);
  });

  it("does NOT retry AUTH_FAILED", async () => {
    const authErr = new (require("../../lib/adapters/email-imap/imap-session").ImapAuthFailedError)("bad creds");
    const { factory, recorder } = makeFlakySession({
      connectFailures: [authErr, authErr], // 2 fails — but only 1 attempt should happen
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [] } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      maxConnectRetries: 3,
      retryBaseDelayMs: 1,
    });

    let caught = null;
    try {
      for await (const _r of a.sync()) { /* drain */ }
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("AUTH_FAILED");
    expect(recorder.connectAttempts).toBe(1); // no retry
  });

  it("exhausts retries on persistent transient error then throws", async () => {
    const transientErr = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });
    const { factory, recorder } = makeFlakySession({
      connectFailures: [transientErr, transientErr, transientErr],
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [] } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      maxConnectRetries: 3,
      retryBaseDelayMs: 1,
    });

    let caught = null;
    try {
      for await (const _r of a.sync()) { /* drain */ }
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(recorder.connectAttempts).toBe(3); // all 3 attempts used
  });

  it("maxConnectRetries=1 disables retry effectively", async () => {
    const transientErr = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    const { factory, recorder } = makeFlakySession({
      connectFailures: [transientErr],
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [] } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      maxConnectRetries: 1,
      retryBaseDelayMs: 1,
    });

    let caught = null;
    try {
      for await (const _r of a.sync()) { /* drain */ }
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(recorder.connectAttempts).toBe(1);
  });
});

// ─── Phase 5.7.2 progress streaming ──────────────────────────────────────

describe("EmailAdapter — Phase 5.7.2 onProgress callback", () => {
  it("emits connecting → connected → mailbox-opened → fetching × N → done", async () => {
    const { factory } = makeFlakySession({
      mailboxes: {
        INBOX: {
          uidValidity: 1,
          envelopes: [env(1), env(2), env(3)],
        },
      },
    });
    const events = [];
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      onProgress: (e) => events.push(e),
    });

    const raws = [];
    for await (const r of a.sync()) raws.push(r);

    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe("connecting");
    expect(phases).toContain("connected");
    expect(phases).toContain("mailbox-opened");
    expect(phases.filter((p) => p === "fetching")).toHaveLength(3);
    expect(phases[phases.length - 1]).toBe("done");

    // Each fetching event should have current + total
    const fetchEvents = events.filter((e) => e.phase === "fetching");
    expect(fetchEvents[0].current).toBe(1);
    expect(fetchEvents[0].total).toBe(3);
    expect(fetchEvents[1].current).toBe(2);
    expect(fetchEvents[2].current).toBe(3);

    // mailbox-opened reports correct mailbox + count
    const opened = events.find((e) => e.phase === "mailbox-opened");
    expect(opened.mailbox).toBe("INBOX");
    expect(opened.exists).toBe(3);

    // done reports emitted + durationMs
    const done = events.find((e) => e.phase === "done");
    expect(done.emitted).toBe(3);
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits error events on transient failures with retriable flag", async () => {
    const transientErr = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    const { factory } = makeFlakySession({
      connectFailures: [transientErr, transientErr],
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [env(1)] } },
    });
    const events = [];
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      maxConnectRetries: 3,
      retryBaseDelayMs: 1,
      onProgress: (e) => events.push(e),
    });

    for await (const _r of a.sync()) { /* drain */ }
    const errs = events.filter((e) => e.phase === "error");
    expect(errs).toHaveLength(2);
    expect(errs[0].retriable).toBe(true);
    expect(errs[0].attempt).toBe(1);
    expect(errs[1].retriable).toBe(true);
    expect(errs[1].attempt).toBe(2);
  });

  it("per-sync onProgress in opts overrides constructor callback", async () => {
    const { factory } = makeFlakySession({
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [env(1)] } },
    });
    const ctorEvents = [];
    const optsEvents = [];
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      onProgress: (e) => ctorEvents.push(e),
    });

    for await (const _r of a.sync({ onProgress: (e) => optsEvents.push(e) })) { /* drain */ }
    expect(optsEvents.length).toBeGreaterThan(0);
    expect(ctorEvents).toHaveLength(0); // constructor cb shadowed
  });

  it("onProgress listener errors do NOT abort sync", async () => {
    const { factory } = makeFlakySession({
      mailboxes: { INBOX: { uidValidity: 1, envelopes: [env(1)] } },
    });
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x", folders: ["INBOX"] },
      sessionFactory: factory,
      parser: async () => ({}),
      onProgress: () => { throw new Error("listener boom"); },
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(1); // sync completed despite listener throws
  });
});

// ─── version + capability advertise the new surfaces ─────────────────────

describe("EmailAdapter — Phase 5.7 surface advertising", () => {
  it("version reflects 0.6.0", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeFlakySession({}).factory,
    });
    expect(a.version).toBe("0.7.0");
  });

  it("capabilities advertise sync:retry-backoff + sync:progress-stream", () => {
    const a = new EmailAdapter({
      account: { provider: "qq", email: "u@qq.com", authCode: "x" },
      sessionFactory: makeFlakySession({}).factory,
    });
    expect(a.capabilities).toContain("sync:retry-backoff");
    expect(a.capabilities).toContain("sync:progress-stream");
  });
});
