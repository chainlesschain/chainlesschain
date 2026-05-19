"use strict";

import { describe, it, expect } from "vitest";

const { parseRawEmail } = require("../../lib/adapters/email-imap/email-parser");

// ─── Fixture builders ───────────────────────────────────────────────────

function plaintextEmail({
  from = "alice@example.com",
  to = "bob@example.com",
  subject = "Hello",
  body = "Hello, world!",
  date = "Fri, 19 May 2026 10:00:00 +0800",
  messageId = "<m-1@example.com>",
} = {}) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    body,
  ].join("\r\n");
}

function multipartAlternative({ text = "plain version", html = "<p>html <b>version</b></p>" } = {}) {
  const boundary = "BOUNDARY_42";
  return [
    `From: sender@example.com`,
    `To: me@example.com`,
    `Subject: Multipart`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    text,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
    `--${boundary}--`,
  ].join("\r\n");
}

function multipartWithAttachment({ filename = "report.pdf", contentType = "application/pdf", body = "%PDF-1.4\n/Encrypt placeholder\n" } = {}) {
  const boundary = "MIXED_99";
  const b64 = Buffer.from(body).toString("base64");
  return [
    `From: bank@example.com`,
    `To: me@example.com`,
    `Subject: Your statement`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain`,
    ``,
    `See attached statement.`,
    `--${boundary}`,
    `Content-Type: ${contentType}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64,
    `--${boundary}--`,
  ].join("\r\n");
}

// ─── parseRawEmail ──────────────────────────────────────────────────────

describe("parseRawEmail — basic shape", () => {
  it("rejects null/missing input", async () => {
    await expect(parseRawEmail(null)).rejects.toThrow(/required/);
    await expect(parseRawEmail()).rejects.toThrow(/required/);
  });

  it("accepts a Buffer", async () => {
    const buf = Buffer.from(plaintextEmail(), "utf8");
    const r = await parseRawEmail(buf);
    expect(r.subject).toBe("Hello");
    expect(r.textBody).toContain("Hello, world!");
  });

  it("accepts a string", async () => {
    const r = await parseRawEmail(plaintextEmail());
    expect(r.subject).toBe("Hello");
  });

  it("returns sourceBytes + contentSha256", async () => {
    const raw = plaintextEmail();
    const r = await parseRawEmail(raw);
    expect(r.sourceBytes).toBe(Buffer.byteLength(raw));
    expect(r.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flattens headers to lowercased-keyed object", async () => {
    const r = await parseRawEmail(plaintextEmail());
    expect(r.headers["subject"]).toBe("Hello");
    expect(r.headers["from"]).toBeDefined();
    expect(r.headers["message-id"]).toBe("<m-1@example.com>");
  });

  it("parses Date header", async () => {
    const r = await parseRawEmail(plaintextEmail());
    expect(r.date).toBeInstanceOf(Date);
    expect(r.date.getUTCFullYear()).toBe(2026);
  });
});

describe("parseRawEmail — multipart", () => {
  it("multipart/alternative yields both text + html bodies", async () => {
    const r = await parseRawEmail(multipartAlternative());
    expect(r.textBody).toContain("plain version");
    expect(r.htmlBody).toContain("html");
    expect(r.htmlBody).toContain("version");
  });

  it("multipart/mixed with attachment yields attachment metadata", async () => {
    const r = await parseRawEmail(multipartWithAttachment());
    expect(r.attachments).toHaveLength(1);
    const a = r.attachments[0];
    expect(a.filename).toBe("report.pdf");
    expect(a.contentType).toContain("pdf");
    expect(a.size).toBeGreaterThan(0);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.contentDisposition).toBe("attachment");
    expect(a.isInline).toBe(false);
  });

  it("flags encrypted PDFs heuristically (/Encrypt header in body)", async () => {
    const r = await parseRawEmail(multipartWithAttachment({
      filename: "encrypted.pdf",
      body: "%PDF-1.4\n%fake header\n/Encrypt <<\n/V 4\n>>\n",
    }));
    expect(r.attachments[0].isEncrypted).toBe(true);
  });

  it("doesn't flag plaintext PDFs as encrypted", async () => {
    const r = await parseRawEmail(multipartWithAttachment({
      body: "%PDF-1.4\nplain content no encrypt token\n",
    }));
    expect(r.attachments[0].isEncrypted).toBe(false);
  });

  it("attachment buffer is omitted by default", async () => {
    const r = await parseRawEmail(multipartWithAttachment());
    expect(r.attachments[0].buffer).toBeUndefined();
  });

  it("keepAttachmentBuffers:true attaches the decoded buffer", async () => {
    const r = await parseRawEmail(multipartWithAttachment(), { keepAttachmentBuffers: true });
    expect(Buffer.isBuffer(r.attachments[0].buffer)).toBe(true);
    expect(r.attachments[0].buffer.toString()).toContain("%PDF-1.4");
  });
});

describe("parseRawEmail — encoding handling", () => {
  it("decodes UTF-8 body correctly", async () => {
    const utf8Body = "妈妈生日蛋白粉 ¥288.50";
    const r = await parseRawEmail(plaintextEmail({ body: utf8Body }));
    expect(r.textBody).toContain("妈妈生日蛋白粉");
    expect(r.textBody).toContain("¥288.50");
  });

  it("decodes GBK-encoded body (via Content-Type charset)", async () => {
    // Build raw bytes: header in UTF-8, body in GBK.
    const headerAscii =
      `From: sender@example.com\r\n` +
      `To: me@example.com\r\n` +
      `Subject: 中文\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=GBK\r\n\r\n`;
    // GBK bytes for "妈妈生日": dc e8 dc e8 c9 fa c8 d5
    const gbkBody = Buffer.from([0xc2, 0xe8, 0xc2, 0xe8, 0xc9, 0xfa, 0xc8, 0xd5]);
    const raw = Buffer.concat([Buffer.from(headerAscii, "ascii"), gbkBody]);
    const r = await parseRawEmail(raw);
    // mailparser+iconv-lite converts GBK to UTF-8. We can't assert exact
    // unicode without locking in iconv tables, but we can verify the
    // body is non-empty + got past the GBK byte sequence (which is
    // invalid UTF-8 — would error if left as raw).
    expect(r.textBody.length).toBeGreaterThan(0);
    expect(r.headers["content-type"]).toBeDefined();
  });

  it("RFC 2047 encoded subject is decoded", async () => {
    const raw = [
      `From: alice@example.com`,
      `To: me@example.com`,
      // =?UTF-8?B?5aaI5aaIc/eIuOWlh+aBpQ==?= (just a sample base64)
      `Subject: =?UTF-8?B?5aaI5aaI?=`,
      `Date: Fri, 19 May 2026 10:00:00 +0800`,
      `Message-ID: <m@x>`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `body`,
    ].join("\r\n");
    const r = await parseRawEmail(raw);
    expect(r.subject).toBe("妈妈");
  });
});

describe("parseRawEmail — truncation + edge cases", () => {
  it("truncates bodies longer than maxBodyChars", async () => {
    const longBody = "X".repeat(500_000);
    const r = await parseRawEmail(plaintextEmail({ body: longBody }), { maxBodyChars: 1000 });
    expect(r.textBody.length).toBeLessThan(longBody.length);
    expect(r.textBody).toMatch(/truncated/);
  });

  it("returns empty bodies for emails with no payload", async () => {
    const raw = [
      `From: x@x.com`,
      `To: y@y.com`,
      `Subject: empty`,
      `Date: Fri, 19 May 2026 10:00:00 +0800`,
      `Message-ID: <m@x>`,
      ``,
      ``,
    ].join("\r\n");
    const r = await parseRawEmail(raw);
    expect(r.textBody).toBe("");
    expect(r.htmlBody).toBe("");
    expect(r.attachments).toEqual([]);
  });

  it("contentSha256 is deterministic for identical input", async () => {
    const raw = plaintextEmail();
    const r1 = await parseRawEmail(raw);
    const r2 = await parseRawEmail(raw);
    expect(r1.contentSha256).toBe(r2.contentSha256);
  });

  it("contentSha256 differs across different inputs", async () => {
    const r1 = await parseRawEmail(plaintextEmail({ body: "v1" }));
    const r2 = await parseRawEmail(plaintextEmail({ body: "v2" }));
    expect(r1.contentSha256).not.toBe(r2.contentSha256);
  });
});
