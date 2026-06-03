"use strict";

import { describe, it, expect } from "vitest";

const {
  PROVIDERS,
  resolveProvider,
} = require("../../lib/adapters/email-imap/providers");

describe("EMAIL_PROVIDERS preset table", () => {
  it("exposes qq / 189 / 163 / outlook / gmail", () => {
    expect(PROVIDERS.qq.host).toBe("imap.qq.com");
    expect(PROVIDERS["189"].host).toBe("imap.189.cn");
    expect(PROVIDERS["163"].host).toBe("imap.163.com");
    expect(PROVIDERS.outlook.host).toBe("outlook.office365.com");
    expect(PROVIDERS.gmail.host).toBe("imap.gmail.com");
  });

  it("every preset uses port 993 + TLS by default", () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.port).toBe(993);
      expect(p.secure).toBe(true);
    }
  });

  it("each preset advertises an authNote pointing at authorization-code, not password", () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.authNote.length).toBeGreaterThan(10);
    }
    expect(PROVIDERS.qq.authNote).toMatch(/授权码|auth.*code|app password/i);
  });
});

describe("resolveProvider", () => {
  it("returns preset config when no overrides", () => {
    const r = resolveProvider({ provider: "qq" });
    expect(r.host).toBe("imap.qq.com");
    expect(r.port).toBe(993);
    expect(r.secure).toBe(true);
    expect(r.folders).toEqual(["INBOX", "Sent Messages"]);
    expect(r.providerId).toBe("qq");
  });

  it("respects user overrides", () => {
    const r = resolveProvider({
      provider: "qq",
      host: "imap.example.com",
      port: 143,
      secure: false,
      folders: ["INBOX", "Drafts", "Custom"],
      displayName: "My Mailbox",
    });
    expect(r.host).toBe("imap.example.com");
    expect(r.port).toBe(143);
    expect(r.secure).toBe(false);
    expect(r.folders).toEqual(["INBOX", "Drafts", "Custom"]);
    expect(r.displayName).toBe("My Mailbox");
  });

  it("rejects unknown provider", () => {
    expect(() => resolveProvider({ provider: "myproto" })).toThrow(/unknown provider/i);
  });

  it("custom provider requires host", () => {
    expect(() => resolveProvider({ provider: "custom" })).toThrow(/host/);
  });

  it("custom provider applies sensible defaults", () => {
    const r = resolveProvider({
      provider: "custom",
      host: "mail.acme.test",
    });
    expect(r.host).toBe("mail.acme.test");
    expect(r.port).toBe(993);
    expect(r.secure).toBe(true);
    expect(r.folders).toEqual(["INBOX"]);
    expect(r.providerId).toBe("custom");
  });

  it("rejects null / wrong-type account", () => {
    expect(() => resolveProvider()).toThrow();
    expect(() => resolveProvider(null)).toThrow();
  });
});
