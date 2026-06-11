/**
 * Toutiao on-device account_db reader tests (real-device-driven 2026-06-11).
 *
 * Validates the path that unblocks Toutiao when the web profile endpoint is
 * permission-denied (error_code 16) and the cookie jar has no numeric uid:
 * read uid+nickname+sec_uid from the plaintext local account_db.login_info.
 * adb + sqlite are injected (no device / no native driver needed).
 */
"use strict";

import { describe, it, expect } from "vitest";

const {
  createToutiaoAccountExtension,
  ACCOUNT_DB_REMOTE_PATH,
  _internals,
} = require("../../lib/adapters/social-toutiao-adb/account-reader");

// ── readToutiaoAccount (injected Database class) ──────────────────────
function makeFakeDb(rows, { hasTime = true } = {}) {
  return class FakeDb {
    constructor() {}
    prepare(sql) {
      return {
        all: () => {
          if (/table_info\(login_info\)/.test(sql)) {
            const cols = ["uid", "screen_name", "sec_uid", "platform_screen_name"];
            if (hasTime) cols.push("time");
            return cols.map((name) => ({ name }));
          }
          if (/FROM login_info/.test(sql)) return rows;
          return [];
        },
        get: () => undefined,
      };
    }
    close() {}
  };
}

describe("readToutiaoAccount", () => {
  it("picks the numeric-uid row → {uid, nickname, secUid}", () => {
    const Db = makeFakeDb([
      { uid: "92585279158", screen_name: "小明", sec_uid: "MS4wLjAB", time: 200 },
    ]);
    const r = _internals.readToutiaoAccount("x.db", { _databaseClass: Db });
    expect(r).toEqual({ uid: "92585279158", nickname: "小明", secUid: "MS4wLjAB" });
  });

  it("skips guest/zero/non-numeric uid rows, takes first valid", () => {
    const Db = makeFakeDb([
      { uid: "0", screen_name: "guest", time: 300 },
      { uid: "abc", screen_name: "bad", time: 250 },
      { uid: "555", screen_name: "real", sec_uid: null, time: 200 },
    ]);
    const r = _internals.readToutiaoAccount("x.db", { _databaseClass: Db });
    expect(r.uid).toBe("555");
    expect(r.nickname).toBe("real");
    expect(r.secUid).toBe(null);
  });

  it("falls back to platform_screen_name when screen_name empty", () => {
    const Db = makeFakeDb([
      { uid: "7", screen_name: "", platform_screen_name: "plat", time: 1 },
    ]);
    expect(_internals.readToutiaoAccount("x.db", { _databaseClass: Db }).nickname).toBe("plat");
  });

  it("returns null when no numeric-uid row exists", () => {
    const Db = makeFakeDb([{ uid: "0" }, { uid: "" }]);
    expect(_internals.readToutiaoAccount("x.db", { _databaseClass: Db })).toBe(null);
  });
});

// ── pullAccountDbViaSu (injected adb) ─────────────────────────────────
function makeAdb({ ls, pm, id, b64 }) {
  return async (args) => {
    const cmd = args.join(" ");
    if (cmd.includes("pm list packages")) return pm || "";
    if (cmd.includes("ls ")) return ls;
    if (cmd.includes("id -u")) return id;
    if (cmd.includes("base64 ")) return b64;
    throw new Error("fake adb: unexpected " + cmd);
  };
}

describe("pullAccountDbViaSu — diagnosis", () => {
  it("constant points at the toutiao account_db", () => {
    expect(ACCOUNT_DB_REMOTE_PATH).toBe(
      "/data/data/com.ss.android.article.news/databases/account_db",
    );
  });

  it("missing db + package installed → TOUTIAO_ACCOUNT_DB_MISSING", async () => {
    const adb = makeAdb({ ls: "NOT_FOUND\r\n", pm: "package:com.ss.android.article.news\r\n" });
    await expect(_internals.pullAccountDbViaSu(adb, "s", {})).rejects.toThrow(
      /TOUTIAO_ACCOUNT_DB_MISSING/,
    );
  });

  it("missing db + package not installed → TOUTIAO_NOT_INSTALLED", async () => {
    const adb = makeAdb({ ls: "NOT_FOUND\r\n", pm: "" });
    await expect(_internals.pullAccountDbViaSu(adb, "s", {})).rejects.toThrow(
      /TOUTIAO_NOT_INSTALLED/,
    );
  });

  it("non-root su → TOUTIAO_NO_ROOT", async () => {
    const adb = makeAdb({ ls: ACCOUNT_DB_REMOTE_PATH, id: "2000\r\n" });
    await expect(_internals.pullAccountDbViaSu(adb, "s", {})).rejects.toThrow(/TOUTIAO_NO_ROOT/);
  });

  it("empty base64 stream → TOUTIAO_ACCOUNT_DB_EMPTY", async () => {
    const adb = makeAdb({ ls: ACCOUNT_DB_REMOTE_PATH, id: "0", b64: "  \r\n" });
    await expect(_internals.pullAccountDbViaSu(adb, "s", {})).rejects.toThrow(
      /TOUTIAO_ACCOUNT_DB_EMPTY/,
    );
  });

  it("non-sqlite payload → TOUTIAO_ACCOUNT_DB_NOT_SQLITE", async () => {
    const buf = Buffer.alloc(2048, 0x41); // "AAAA…"
    const adb = makeAdb({ ls: ACCOUNT_DB_REMOTE_PATH, id: "uid=0(root)", b64: buf.toString("base64") });
    await expect(_internals.pullAccountDbViaSu(adb, "s", {})).rejects.toThrow(
      /TOUTIAO_ACCOUNT_DB_NOT_SQLITE/,
    );
  });
});

// ── extension contract ────────────────────────────────────────────────
describe("createToutiaoAccountExtension", () => {
  it("rejects when ctx lacks {adb, pickDevice}", async () => {
    const ext = createToutiaoAccountExtension();
    await expect(ext({}, {})).rejects.toThrow(/ctx must provide/);
  });
});
