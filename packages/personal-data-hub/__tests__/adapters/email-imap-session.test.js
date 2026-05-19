"use strict";

import { describe, it, expect } from "vitest";

const {
  ImapSession,
  ImapAuthFailedError,
  ImapConnectionFailedError,
  ImapMailboxNotFoundError,
} = require("../../lib/adapters/email-imap/imap-session");

function makeFakeFactory({
  connectThrows = null,
  mailboxThrows = null,
  fetchRows = [],
  mailboxInfo = { uidValidity: 1, uidNext: 100, exists: 0 },
} = {}) {
  return function FakeImapFlow(_opts) {
    return {
      connect: async () => {
        if (connectThrows) throw connectThrows;
      },
      mailboxOpen: async (name) => {
        if (mailboxThrows) throw mailboxThrows;
        return { path: name, name, ...mailboxInfo };
      },
      list: async () => [
        { name: "INBOX", path: "INBOX", flags: [], specialUse: null },
        { name: "Sent", path: "Sent", flags: [], specialUse: "\\Sent" },
      ],
      fetch: function () {
        const rows = fetchRows.slice();
        let i = 0;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () =>
                i < rows.length
                  ? { value: rows[i++], done: false }
                  : { value: undefined, done: true },
            };
          },
        };
      },
      logout: async () => {},
      close: async () => {},
    };
  };
}

describe("ImapSession construction", () => {
  it("rejects missing required opts", () => {
    expect(() => new ImapSession()).toThrow();
    expect(() => new ImapSession({})).toThrow(/host/);
    expect(() => new ImapSession({ host: "x", port: 993, user: "u" })).toThrow(/authCode/);
    expect(() => new ImapSession({ host: "x", port: 993, authCode: "z" })).toThrow(/user/);
  });

  it("constructs cleanly with required opts", () => {
    const s = new ImapSession({
      host: "imap.test", port: 993, secure: true, user: "u@test.com", authCode: "abc",
    });
    expect(s.host).toBe("imap.test");
    expect(s.port).toBe(993);
    expect(s.secure).toBe(true);
  });

  it("defaults secure=true when not specified", () => {
    const s = new ImapSession({ host: "x", port: 993, user: "u@t", authCode: "z" });
    expect(s.secure).toBe(true);
  });
});

describe("ImapSession.connect", () => {
  it("connects successfully with injected factory", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory(),
    });
    await expect(s.connect()).resolves.toBeUndefined();
  });

  it("classifies auth failure as ImapAuthFailedError", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({
        connectThrows: new Error("Authentication failed - invalid credentials"),
      }),
    });
    await expect(s.connect()).rejects.toBeInstanceOf(ImapAuthFailedError);
  });

  it("classifies generic network errors as ImapConnectionFailedError", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({
        connectThrows: new Error("ECONNREFUSED"),
      }),
    });
    await expect(s.connect()).rejects.toBeInstanceOf(ImapConnectionFailedError);
  });

  it("enforces connectTimeoutMs", async () => {
    function slowFactory() {
      return {
        connect: () => new Promise(() => {}),
        close: async () => {},
      };
    }
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      connectTimeoutMs: 50,
      imapFlowFactory: slowFactory,
    });
    await expect(s.connect()).rejects.toThrow(/timed out/);
  });

  it("requires connect() before openMailbox", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory(),
    });
    await expect(s.openMailbox("INBOX")).rejects.toThrow(/not connected/);
  });
});

describe("ImapSession.openMailbox", () => {
  it("returns uidValidity / uidNext / exists snapshot", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({
        mailboxInfo: { uidValidity: 42, uidNext: 200, exists: 150 },
      }),
    });
    await s.connect();
    const r = await s.openMailbox("INBOX");
    expect(r.uidValidity).toBe(42);
    expect(r.uidNext).toBe(200);
    expect(r.exists).toBe(150);
  });

  it("converts 'not found' messages to ImapMailboxNotFoundError", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({
        mailboxThrows: new Error("Mailbox doesn't exist: NoSuch"),
      }),
    });
    await s.connect();
    await expect(s.openMailbox("NoSuch")).rejects.toBeInstanceOf(ImapMailboxNotFoundError);
  });

  it("rejects non-string mailbox name", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory(),
    });
    await s.connect();
    await expect(s.openMailbox("")).rejects.toThrow(/non-empty string/);
  });
});

describe("ImapSession.listMailboxes", () => {
  it("returns name / path / flags / specialUse", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory(),
    });
    await s.connect();
    const list = await s.listMailboxes();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("INBOX");
    expect(list[1].specialUse).toBe("\\Sent");
  });
});

describe("ImapSession.fetchEnvelopesSince", () => {
  it("yields normalized envelope rows", async () => {
    const fakeRow = {
      uid: 42,
      internalDate: new Date("2026-04-01T10:00:00Z"),
      flags: new Set(["\\Seen"]),
      size: 1234,
      envelope: {
        messageId: "<msg-1@example.com>",
        subject: "Hello",
        from: [{ name: "Alice", address: "alice@example.com" }],
        to: [{ name: "Me", address: "me@example.com" }],
        cc: [],
        date: new Date("2026-04-01T10:00:00Z"),
      },
    };
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({ fetchRows: [fakeRow] }),
    });
    await s.connect();
    await s.openMailbox("INBOX");
    const got = [];
    for await (const env of s.fetchEnvelopesSince(0)) got.push(env);
    expect(got).toHaveLength(1);
    expect(got[0].uid).toBe(42);
    expect(got[0].subject).toBe("Hello");
    expect(got[0].messageId).toBe("<msg-1@example.com>");
    expect(got[0].from[0].address).toBe("alice@example.com");
    expect(got[0].flags).toEqual(["\\Seen"]);
    expect(got[0].size).toBe(1234);
    expect(got[0].internalDate).toBeInstanceOf(Date);
  });

  it("emits empty for an empty mailbox", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({ fetchRows: [] }),
    });
    await s.connect();
    await s.openMailbox("INBOX");
    const got = [];
    for await (const env of s.fetchEnvelopesSince(0)) got.push(env);
    expect(got).toEqual([]);
  });

  it("preserves order from underlying iterator", async () => {
    const rows = [10, 20, 30].map((uid) => ({
      uid,
      internalDate: new Date(),
      flags: [],
      size: 0,
      envelope: { messageId: `<m-${uid}@x>`, subject: `s${uid}`, from: [], to: [], cc: [], date: new Date() },
    }));
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({ fetchRows: rows }),
    });
    await s.connect();
    await s.openMailbox("INBOX");
    const uids = [];
    for await (const env of s.fetchEnvelopesSince(0)) uids.push(env.uid);
    expect(uids).toEqual([10, 20, 30]);
  });
});

describe("ImapSession.fetchFullSince", () => {
  it("yields source bytes alongside envelope", async () => {
    const raw = Buffer.from("RAW RFC822 SOURCE BYTES", "utf8");
    const fakeRow = {
      uid: 100,
      internalDate: new Date(),
      flags: [],
      size: raw.length,
      source: raw,
      envelope: {
        messageId: "<m@x>",
        subject: "s",
        from: [{ name: "A", address: "a@b" }],
        to: [],
        cc: [],
        date: new Date(),
      },
    };
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({ fetchRows: [fakeRow] }),
    });
    await s.connect();
    await s.openMailbox("INBOX");
    const got = [];
    for await (const row of s.fetchFullSince(0)) got.push(row);
    expect(got).toHaveLength(1);
    expect(Buffer.isBuffer(got[0].source)).toBe(true);
    expect(got[0].source.toString()).toBe("RAW RFC822 SOURCE BYTES");
    expect(got[0].uid).toBe(100);
    expect(got[0].subject).toBe("s");
  });

  it("emits empty Buffer when server returns no source", async () => {
    const fakeRow = {
      uid: 1,
      internalDate: new Date(),
      flags: [],
      size: 0,
      // no `source` field
      envelope: { messageId: "<m@x>", subject: "", from: [], to: [], cc: [], date: new Date() },
    };
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory({ fetchRows: [fakeRow] }),
    });
    await s.connect();
    await s.openMailbox("INBOX");
    const got = [];
    for await (const row of s.fetchFullSince(0)) got.push(row);
    expect(Buffer.isBuffer(got[0].source)).toBe(true);
    expect(got[0].source.length).toBe(0);
  });
});

describe("ImapSession.close", () => {
  it("is idempotent on never-connected session", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory(),
    });
    await expect(s.close()).resolves.toBeUndefined();
  });

  it("clears client reference so post-close calls fail clean", async () => {
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: makeFakeFactory(),
    });
    await s.connect();
    await s.close();
    await expect(s.openMailbox("INBOX")).rejects.toThrow(/not connected/);
  });

  it("doesn't fail when underlying logout throws", async () => {
    let logoutCalled = false;
    function factory() {
      return {
        connect: async () => {},
        logout: async () => { logoutCalled = true; throw new Error("conn already dead"); },
        close: async () => {},
      };
    }
    const s = new ImapSession({
      host: "x", port: 993, user: "u@t", authCode: "z",
      imapFlowFactory: factory,
    });
    await s.connect();
    await expect(s.close()).resolves.toBeUndefined();
    expect(logoutCalled).toBe(true);
  });
});
