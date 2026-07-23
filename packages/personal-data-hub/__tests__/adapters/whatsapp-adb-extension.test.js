"use strict";

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  createWhatsAppBackupExtension,
  PERSONAL_DIRS,
  BUSINESS_DIRS,
  _internal,
} = require("../../lib/adapters/messaging-whatsapp/adb-extension");

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-wa-adb-test-"));
  roots.push(root);
  return root;
}

function crypt15Prefix() {
  const iv = Buffer.alloc(16, 7);
  const nested = Buffer.concat([Buffer.from([0x0a, 0x10]), iv]);
  const top = Buffer.concat([Buffer.from([0x1a, nested.length]), nested]);
  return Buffer.concat([Buffer.from([top.length, 0x01]), top, Buffer.alloc(64)]);
}

function fakeContext({ existing, bytes = crypt15Prefix() }) {
  const calls = [];
  return {
    calls,
    ctx: {
      pickDevice: async ({ serial }) => serial || "SERIAL-1",
      adb: async (args, opts) => {
        calls.push({ args, opts });
        if (args[0] === "shell" && args[1].startsWith("test -f ")) {
          if (args[1].includes(`'${existing}'`)) return "";
          throw new Error("No such file");
        }
        if (args[0] === "pull") {
          fs.writeFileSync(args[2], bytes);
          return "1 file pulled";
        }
        throw new Error(`unexpected adb args: ${args.join(" ")}`);
      },
    },
  };
}

describe("WhatsApp public-backup ADB extension", () => {
  it("prefers crypt15, pulls it with restrictive permissions, and reports metadata", async () => {
    const root = tempRoot();
    const remotePath = `${PERSONAL_DIRS[0]}/msgstore.db.crypt15`;
    const { ctx, calls } = fakeContext({ existing: remotePath });
    const handler = createWhatsAppBackupExtension({ tmpRoot: root });

    const result = await handler({ serial: "PHONE-1" }, ctx);
    expect(result).toMatchObject({
      serial: "PHONE-1",
      remotePath,
      format: "crypt15",
    });
    expect(fs.existsSync(result.localPath)).toBe(true);
    expect(result.bytes).toBeGreaterThan(32);
    expect(calls.find((call) => call.args[0] === "pull").opts.timeoutMs).toBe(300_000);
    if (process.platform !== "win32") {
      expect(fs.statSync(result.localPath).mode & 0o777).toBe(0o600);
    }
  });

  it("supports WhatsApp Business public backup directories", async () => {
    const root = tempRoot();
    const remotePath = `${BUSINESS_DIRS[0]}/msgstore.db.crypt15`;
    const { ctx } = fakeContext({ existing: remotePath });
    const handler = createWhatsAppBackupExtension({ tmpRoot: root });

    const result = await handler({ business: true }, ctx);
    expect(result.remotePath).toBe(remotePath);
  });

  it("rejects a caller-supplied path outside the allowlist", () => {
    expect(() => _internal.validateRequestedRemotePath(
      "/sdcard/Download/msgstore.db.crypt15",
      false,
    )).toThrow(expect.objectContaining({ code: "WHATSAPP_ADB_UNSAFE_REMOTE_PATH" }));
  });

  it("returns a typed error when no public backup exists", async () => {
    const root = tempRoot();
    const { ctx } = fakeContext({ existing: "never" });
    const handler = createWhatsAppBackupExtension({ tmpRoot: root });
    await expect(handler({}, ctx)).rejects.toMatchObject({
      code: "WHATSAPP_ADB_BACKUP_NOT_FOUND",
    });
  });
});
