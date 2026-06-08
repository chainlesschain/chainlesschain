"use strict";

/**
 * Unit tests for _pc-local-discovery against a synthetic filesystem — no real
 * App needs to be installed. Uses posix path so assertions are host-agnostic.
 */

import { describe, it, expect } from "vitest";
const path = require("node:path");
const { discover, SUPPORTED_APPS } = require("../../lib/adapters/_pc-local-discovery");

// Build a fake fs from a map of { dirPath: [entryName...] } + a set of file paths.
function makeFakeFs({ tree = {}, files = {}, sizes = {} } = {}) {
  const norm = (p) => p.replace(/\\/g, "/");
  const fileSet = new Set(Object.keys(files).map(norm));
  const dirSet = new Set(Object.keys(tree).map(norm));
  return {
    existsSync: (p) => fileSet.has(norm(p)) || dirSet.has(norm(p)),
    readdirSync: (p) => {
      const entries = tree[norm(p)] || [];
      return entries.map((e) => ({
        name: e.name,
        isDirectory: () => e.type === "dir",
        isFile: () => e.type === "file",
      }));
    },
    statSync: (p) => ({ size: sizes[norm(p)] || 1 }),
    constants: { R_OK: 4 },
  };
}

const D = (name) => ({ name, type: "dir" });
const F = (name) => ({ name, type: "file" });

describe("_pc-local-discovery", () => {
  it("supports the expected app keys", () => {
    expect(SUPPORTED_APPS).toEqual(["wechat-pc", "qq-pc", "dingtalk-pc", "feishu-pc"]);
  });

  it("returns installed:false for an unknown app key (never throws)", () => {
    const r = discover("totally-unknown", { fs: makeFakeFs(), home: "/h", env: {}, path: path.posix });
    expect(r.installed).toBe(false);
    expect(r.note).toMatch(/不支持/);
  });

  it("returns installed:false when nothing is on disk", () => {
    const r = discover("wechat-pc", { fs: makeFakeFs(), home: "/h", env: {}, path: path.posix });
    expect(r.installed).toBe(false);
    expect(r.primaryDb).toBe(null);
  });

  it("discovers a WeChat 4.x account and picks message_0.db as primary", () => {
    const base = "/h/Documents/xwechat_files";
    const acc = `${base}/wxid_demo_42`;
    const fs = makeFakeFs({
      tree: {
        [base]: [D("wxid_demo_42"), D("all_users")],
        [`${acc}/db_storage/message`]: [F("message_0.db"), F("biz_message_0.db"), F("message_fts.db")],
      },
      files: {
        [`${acc}/db_storage`]: 1,
        [`${acc}/db_storage/message/message_0.db`]: 1,
        [`${acc}/db_storage/contact/contact.db`]: 1,
        [`${acc}/db_storage/sns/sns.db`]: 1,
      },
      sizes: {
        [`${acc}/db_storage/message/message_0.db`]: 99,
        [`${acc}/db_storage/message/biz_message_0.db`]: 50,
      },
    });
    const r = discover("wechat-pc", { fs, home: "/h", env: {}, path: path.posix });
    expect(r.installed).toBe(true);
    expect(r.layout).toBe("4.x");
    expect(r.encrypted).toBe(true);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].id).toBe("wxid_demo");
    expect(r.primaryDb).toContain("message_0.db");
    // message_fts.db must NOT be picked up as a message db
    const purposes = r.accounts[0].dbs.map((d) => d.purpose).sort();
    expect(purposes).toContain("message");
    expect(purposes).toContain("contact");
    expect(r.accounts[0].dbs.some((d) => /message_fts/.test(d.path))).toBe(false);
  });

  it("discovers a WeChat 3.x account (MSG*.db + MicroMsg.db)", () => {
    const base = "/h/Documents/WeChat Files";
    const acc = `${base}/wxid_old`;
    const fs = makeFakeFs({
      tree: {
        [base]: [D("wxid_old"), D("All Users")],
        [`${acc}/Msg/Multi`]: [F("MSG0.db"), F("MSG1.db")],
      },
      files: {
        [`${acc}/Msg/Multi/MSG0.db`]: 1,
        [`${acc}/Msg/Multi/MSG1.db`]: 1,
        [`${acc}/Msg/MicroMsg.db`]: 1,
      },
    });
    const r = discover("wechat-pc", { fs, home: "/h", env: {}, path: path.posix });
    expect(r.installed).toBe(true);
    expect(r.layout).toBe("3.x");
    expect(r.accounts[0].dbs.filter((d) => d.purpose === "message")).toHaveLength(2);
  });

  it("discovers a QQ NT account by numeric uin dir", () => {
    const base = "/h/Documents/Tencent Files";
    const acc = `${base}/896075341`;
    const fs = makeFakeFs({
      tree: { [base]: [D("896075341"), D("nt_qq")] },
      files: {
        [`${acc}/nt_qq/nt_db/nt_msg.db`]: 1,
        [`${acc}/nt_qq/nt_db/group_info.db`]: 1,
      },
    });
    const r = discover("qq-pc", { fs, home: "/h", env: {}, path: path.posix });
    expect(r.installed).toBe(true);
    expect(r.accounts[0].id).toBe("896075341");
    expect(r.primaryDb).toContain("nt_msg.db");
    expect(r.encrypted).toBe(true);
  });

  it("dingtalk best-effort scan finds plaintext db (encrypted:false)", () => {
    const root = "/appdata/DingTalk";
    const fs = makeFakeFs({
      tree: {
        [root]: [D("user1")],
        [`${root}/user1`]: [F("im_message.db"), F("cache.db")],
      },
      files: {
        [`${root}/user1/im_message.db`]: 1,
        [`${root}/user1/cache.db`]: 1,
      },
      sizes: { [`${root}/user1/im_message.db`]: 100 },
    });
    const r = discover("dingtalk-pc", { fs, home: "/h", env: { APPDATA: "/appdata" }, path: path.posix });
    expect(r.installed).toBe(true);
    expect(r.encrypted).toBe(false);
    expect(r.bestEffort).toBe(true);
    expect(r.primaryDb).toContain("im_message.db");
  });
});
