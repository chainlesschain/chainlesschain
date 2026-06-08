"use strict";

/**
 * Phase 2a (Douyin C 路径) — cover for the douyin.pull-im-db ADB extension's
 * IM-db discovery + classification.
 *
 * Real-device verification (2026-06-08, Xiaomi chopin / MIUI 13, Douyin
 * logged in) found CURRENT Douyin no longer keeps a plaintext social-DM IM
 * db. The databases/ dir instead holds:
 *   - encrypted_<uid>_im.db  → SQLCipher social DM (header NOT `SQLite format 3`)
 *   - im_database_<uid>      → Room db, but it is the in-app 豆包/Doubao AI
 *                              assistant chat, not social DMs
 * The extension must classify these and emit a precise typed error rather
 * than the misleading DOUYIN_NO_IM_DB.
 *
 * Strategy: scripted fake `ctx.adb` returns a canned `ls` body modeled on
 * the real device listing — no ADB / device needed.
 */

import { describe, it, expect, vi } from "vitest";

const {
  createDouyinDbExtension,
  ENCRYPTED_IM_DB_PATTERN,
  DOUBAO_IM_DB_PATTERN,
  _internals,
} = require("../../lib/adapters/social-douyin-adb/db-extension");

/** Fake ctx: matches the first substring pattern in `responses`. */
function fakeCtx(responses) {
  const adb = vi.fn(async (args) => {
    const key = args.join(" ");
    for (const [pattern, body] of responses) {
      if (key.includes(pattern)) {
        return typeof body === "function" ? body(args) : body;
      }
    }
    throw new Error(`fake adb: no scripted response for: ${key}`);
  });
  return { adb, pickDevice: vi.fn(async () => "FAKE_SERIAL"), parseContentQueryRows: () => [] };
}

// Real device listing (trimmed to the IM-relevant files).
const REAL_DEVICE_LS = [
  "aweme_database_92585448288",
  "encrypted_92585448288_im.db",
  "encrypted_92585448288_im_customer_box.db",
  "im_database_",
  "im_database_6951980119394929011",
  "push_message.db",
].join("\n");

describe("patterns", () => {
  it("ENCRYPTED_IM_DB_PATTERN matches encrypted_<uid>_im.db only", () => {
    expect("encrypted_92585448288_im.db".match(ENCRYPTED_IM_DB_PATTERN)?.[1]).toBe(
      "92585448288",
    );
    // customer_box variant must NOT be mistaken for the DM store
    expect("encrypted_92585448288_im_customer_box.db".match(ENCRYPTED_IM_DB_PATTERN)).toBe(
      null,
    );
  });

  it("DOUBAO_IM_DB_PATTERN matches im_database_<uid> with a real uid", () => {
    expect("im_database_6951980119394929011".match(DOUBAO_IM_DB_PATTERN)?.[1]).toBe(
      "6951980119394929011",
    );
    // empty-uid `im_database_` must not match (needs ≥6 digits)
    expect("im_database_".match(DOUBAO_IM_DB_PATTERN)).toBe(null);
  });
});

describe("listImDbs classification (real-device listing)", () => {
  it("buckets encrypted + doubao, finds no legacy plaintext", async () => {
    const ctx = fakeCtx([["ls ", REAL_DEVICE_LS]]);
    const r = await _internals.listImDbs(ctx.adb, "FAKE_SERIAL", {});
    expect(r.candidates).toEqual([]); // no legacy `<19digit>_im.db`
    expect(r.encryptedCandidates.map((c) => c.fileName)).toEqual([
      "encrypted_92585448288_im.db",
    ]);
    expect(r.doubaoCandidates.map((c) => c.fileName)).toEqual([
      "im_database_6951980119394929011",
    ]);
  });
});

describe("createDouyinDbExtension — precise typed errors", () => {
  it("throws DOUYIN_IM_DB_ENCRYPTED when only the SQLCipher DM db exists", async () => {
    const ctx = fakeCtx([
      ["id -u", "0"],
      ["ls ", "encrypted_92585448288_im.db\nim_database_6951980119394929011"],
    ]);
    const ext = createDouyinDbExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/DOUYIN_IM_DB_ENCRYPTED/);
  });

  it("throws DOUYIN_ONLY_DOUBAO_AI_CHAT when only the Doubao Room db exists", async () => {
    const ctx = fakeCtx([
      ["id -u", "0"],
      ["ls ", "im_database_6951980119394929011\npush_message.db"],
    ]);
    const ext = createDouyinDbExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/DOUYIN_ONLY_DOUBAO_AI_CHAT/);
  });

  it("still throws DOUYIN_NO_IM_DB when nothing relevant exists", async () => {
    const ctx = fakeCtx([
      ["id -u", "0"],
      ["ls ", "push_message.db\naweme.db"],
    ]);
    const ext = createDouyinDbExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/DOUYIN_NO_IM_DB/);
  });
});
