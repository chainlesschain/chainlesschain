"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  WechatAdapter,
  parseWeChatContent,
  extractWeChatKey,
  deriveWeChatLegacyKey,
  WeChatDBReader,
  normalizeWeChatMessage,
  normalizeWeChatContact,
  wxidToWeChatPersonId,
  isWeChatGroupTalker,
  WECHAT_VERSION,
} = require("../lib/adapters/wechat");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// ─── content-parser ──────────────────────────────────────────────────────

describe("parseWeChatContent — type 1 text", () => {
  it("plain text message", () => {
    const r = parseWeChatContent({
      type: 1,
      content: "你好",
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("text");
    expect(r.text).toBe("你好");
  });

  it("group message strips sender prefix", () => {
    const r = parseWeChatContent({
      type: 1,
      content: "wxid_someone:\n大家好",
      talker: "12345@chatroom",
    });
    expect(r.text).toBe("大家好");
    expect(r.structured.senderWxid).toBe("wxid_someone");
  });
});

describe("parseWeChatContent — media types", () => {
  it("type 3 image", () => {
    const xml =
      '<img cdnbigimgurl="https://x.cn/a" md5="abc123" length="12345" />';
    const r = parseWeChatContent({
      type: 3,
      content: xml,
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("image");
    expect(r.text).toBe("[图片]");
    expect(r.structured.cdnUrl).toBe("https://x.cn/a");
    expect(r.structured.md5).toBe("abc123");
    expect(r.structured.length).toBe(12345);
  });

  it("type 34 voice", () => {
    const xml = '<voicemsg voicelength="3000" clientmsgid="voice123" />';
    const r = parseWeChatContent({
      type: 34,
      content: xml,
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("voice");
    expect(r.structured.voiceLength).toBe(3000);
  });

  it("type 48 location", () => {
    const xml = '<location x="31.23" y="121.47" label="上海" poiname="外滩" />';
    const r = parseWeChatContent({
      type: 48,
      content: xml,
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("location");
    expect(r.structured.x).toBe(31.23);
    expect(r.structured.y).toBe(121.47);
    expect(r.structured.label).toBe("上海");
  });
});

describe("parseWeChatContent — type 49 appmsg sub-types", () => {
  it("sub 5 link", () => {
    const xml =
      '<msg><appmsg type="5"><title>趣文一篇</title><des>简介</des><url>https://x.cn</url></appmsg></msg>';
    const r = parseWeChatContent({
      type: 49,
      content: xml,
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("link");
    expect(r.structured.title).toBe("趣文一篇");
    expect(r.structured.url).toBe("https://x.cn");
  });

  it("sub 21 redpacket", () => {
    const xml = '<msg><appmsg type="21"><title>恭喜发财</title></appmsg></msg>';
    const r = parseWeChatContent({
      type: 49,
      content: xml,
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("redpacket");
    expect(r.structured.redPacketTitle).toBe("恭喜发财");
  });

  it("sub 6 file", () => {
    const xml =
      '<msg><appmsg type="6"><title>合同.pdf</title><totallen>523456</totallen></appmsg></msg>';
    const r = parseWeChatContent({
      type: 49,
      content: xml,
      talker: "wxid_friend",
    });
    expect(r.kind).toBe("file");
    expect(r.structured.fileName).toBe("合同.pdf");
    expect(r.structured.fileSize).toBe("523456");
  });
});

describe("parseWeChatContent — system + unknown", () => {
  it("type 10000 system", () => {
    const r = parseWeChatContent({
      type: 10000,
      content: '<msg>"张三"加入了群聊</msg>',
      talker: "12345@chatroom",
    });
    expect(r.kind).toBe("system");
    expect(r.text).toContain("加入了群聊");
  });

  it("unknown type falls through with kind=type-N", () => {
    const r = parseWeChatContent({
      type: 99999,
      content: "x",
      talker: "wxid_f",
    });
    expect(r.kind).toBe("type-99999");
  });

  it("invalid input is safe", () => {
    const r = parseWeChatContent(null);
    expect(r.kind).toBe("unknown");
  });
});

// ─── key-extractor ───────────────────────────────────────────────────────

describe("deriveWeChatLegacyKey", () => {
  it("matches MD5(IMEI+UIN)[:7]", () => {
    const imei = "123456789012345";
    const uin = "987654321";
    const expected = crypto
      .createHash("md5")
      .update(imei + uin, "utf-8")
      .digest("hex")
      .slice(0, 7);
    expect(deriveWeChatLegacyKey(imei, uin)).toBe(expected);
  });

  it("lowercase hex", () => {
    const k = deriveWeChatLegacyKey("INFRA", "user123");
    expect(k).toMatch(/^[0-9a-f]{7}$/);
  });

  it("throws on missing inputs", () => {
    expect(() => deriveWeChatLegacyKey("", "uin")).toThrow();
    expect(() => deriveWeChatLegacyKey("imei", null)).toThrow();
  });
});

describe("extractWeChatKey", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-key-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_e) {}
  });

  function writeAuthXml(uin = "1234567890") {
    fs.mkdirSync(path.join(dir, "shared_prefs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "shared_prefs", "auth_info_key_prefs.xml"),
      `<?xml version='1.0' encoding='utf-8'?><map><int name="_auth_uin" value="${uin}" /></map>`,
    );
  }

  function writeCompatibleInfo(imei = "123456789012345") {
    fs.mkdirSync(path.join(dir, "MicroMsg"), { recursive: true });
    // CompatibleInfo.cfg is a Java HashMap serialization; we just want
    // to embed an IMEI in the binary so the regex finds it.
    const padding = Buffer.from("padding-before-imei-\x00\x01\x02", "binary");
    const imeiPart = Buffer.from(`\x00${imei}\x00more-after`, "binary");
    fs.writeFileSync(
      path.join(dir, "MicroMsg", "CompatibleInfo.cfg"),
      Buffer.concat([padding, imeiPart]),
    );
  }

  it("happy path: extracts UIN + IMEI + derives key", () => {
    writeAuthXml("888888888");
    writeCompatibleInfo("864000000000000");
    const r = extractWeChatKey({ wechatDataPath: dir });
    expect(r.uin).toBe("888888888");
    expect(r.imei).toBe("864000000000000");
    expect(r.key).toBeTruthy();
    expect(r.key.length).toBe(7);
  });

  it("missing UIN → key null + warning", () => {
    writeCompatibleInfo("864000000000000");
    const r = extractWeChatKey({ wechatDataPath: dir });
    expect(r.key).toBeNull();
    expect(r.warnings.some((w) => /UIN/.test(w))).toBe(true);
  });

  it("manual override skips XML", () => {
    const r = extractWeChatKey({
      wechatDataPath: dir,
      uin: "manual-uin",
      imei: "manual-imei",
    });
    expect(r.uin).toBe("manual-uin");
    expect(r.imei).toBe("manual-imei");
    expect(r.key).toBeTruthy();
  });

  it("requires wechatDataPath", () => {
    expect(() => extractWeChatKey({})).toThrow();
  });
});

// ─── isWeChatGroupTalker ────────────────────────────────────────────────

describe("isWeChatGroupTalker", () => {
  it("@chatroom suffix is group", () => {
    expect(isWeChatGroupTalker("12345678@chatroom")).toBe(true);
  });
  it("wxid_xxx is 1-on-1", () => {
    expect(isWeChatGroupTalker("wxid_friend")).toBe(false);
  });
  it("invalid input → false", () => {
    expect(isWeChatGroupTalker(null)).toBe(false);
  });
});

// ─── wxidToPersonId ──────────────────────────────────────────────────────

describe("wxidToWeChatPersonId", () => {
  it("stable id format", () => {
    expect(wxidToWeChatPersonId("wxid_friend")).toBe(
      "person-wechat-wxid_friend",
    );
  });
  it("null wxid → null", () => {
    expect(wxidToWeChatPersonId(null)).toBeNull();
  });
});

// ─── normalizeMessage ────────────────────────────────────────────────────

describe("normalizeWeChatMessage", () => {
  it("1-on-1 text inbound", () => {
    const row = {
      msgId: 1,
      msgSvrId: 100,
      talker: "wxid_friend",
      content: "你好",
      type: 1,
      createTime: Date.now(),
      isSend: 0,
    };
    const b = normalizeWeChatMessage(row, { accountUin: "self123" });
    expect(b.events).toHaveLength(1);
    expect(b.events[0].subtype).toBe("message");
    expect(b.events[0].actor).toBe("person-wechat-wxid_friend");
    expect(b.events[0].content.text).toBe("你好");
    expect(b.persons).toHaveLength(1);
    expect(b.persons[0].identifiers.wechatId).toBe("wxid_friend");
    const v = validateBatch(b);
    expect(v.valid).toBe(true);
  });

  it("1-on-1 text outbound — self is the stable canonical id, NOT keyed off accountUin", () => {
    const row = {
      msgSvrId: 101,
      talker: "wxid_friend",
      content: "你好",
      type: 1,
      createTime: Date.now(),
      isSend: 1,
    };
    // accountUin varies per collection run (uin / wxid / md5); keying self off
    // it fragmented "self" into several fake top contacts. Self must be stable.
    const b = normalizeWeChatMessage(row, { accountUin: "self123" });
    expect(b.events[0].actor).toBe("person-wechat-self");
    const b2 = normalizeWeChatMessage(row, { accountUin: "different-uin-456" });
    expect(b2.events[0].actor).toBe("person-wechat-self"); // same self id regardless of accountUin
  });

  it("group message produces Topic + isGroup extra", () => {
    const row = {
      msgSvrId: 102,
      talker: "1234@chatroom",
      content: "wxid_friend:\n大家好",
      type: 1,
      createTime: Date.now(),
      isSend: 0,
    };
    const b = normalizeWeChatMessage(row, {
      accountUin: "self123",
      chatroomByName: { "1234@chatroom": "测试群" },
    });
    expect(b.events[0].extra.isGroup).toBe(true);
    expect(b.topics).toHaveLength(1);
    expect(b.topics[0].name).toBe("测试群");
    expect(b.events[0].actor).toBe("person-wechat-wxid_friend");
    // 2 persons: the peer chatroom (subtype:unknown — not really a person but kept for ref) + sender
    expect(b.persons.length).toBeGreaterThanOrEqual(1);
  });

  it("media types map to media subtype", () => {
    const row = {
      msgSvrId: 103,
      talker: "wxid_friend",
      content: '<img cdnbigimgurl="https://x.cn/i" md5="x" />',
      type: 3,
      createTime: Date.now(),
      isSend: 0,
    };
    const b = normalizeWeChatMessage(row, { accountUin: "self123" });
    expect(b.events[0].subtype).toBe("media");
  });

  it("redpacket appmsg maps to redenvelope", () => {
    const row = {
      msgSvrId: 104,
      talker: "wxid_friend",
      content: '<msg><appmsg type="21"><title>红包</title></appmsg></msg>',
      type: 49,
      createTime: Date.now(),
      isSend: 0,
    };
    const b = normalizeWeChatMessage(row, { accountUin: "self123" });
    expect(b.events[0].subtype).toBe("redenvelope");
  });

  it("system messages map to interaction subtype", () => {
    const row = {
      msgSvrId: 105,
      talker: "1234@chatroom",
      content: '"张三"加入了群聊',
      type: 10000,
      createTime: Date.now(),
      isSend: 0,
    };
    const b = normalizeWeChatMessage(row, { accountUin: "self123" });
    expect(b.events[0].subtype).toBe("interaction");
  });

  it("rejects missing row", () => {
    expect(() => normalizeWeChatMessage(null)).toThrow();
  });
});

// ─── normalizeContact ───────────────────────────────────────────────────

describe("normalizeWeChatContact", () => {
  it("produces Person with names from conRemark / nickname / alias", () => {
    const b = normalizeWeChatContact({
      username: "wxid_mom",
      alias: "mom123",
      nickname: "妈",
      conRemark: "亲妈",
      type: 1,
    });
    expect(b.persons).toHaveLength(1);
    expect(b.persons[0].names).toContain("亲妈");
    expect(b.persons[0].names).toContain("妈");
    expect(b.persons[0].identifiers.wechatId).toBe("wxid_mom");
  });

  it("chatroom username → subtype unknown (not a real Person)", () => {
    const b = normalizeWeChatContact({
      username: "12345@chatroom",
      nickname: "群名",
      type: 2,
    });
    expect(b.persons[0].subtype).toBe("unknown");
  });

  it("missing username → empty batch", () => {
    const b = normalizeWeChatContact({});
    expect(b.persons).toHaveLength(0);
  });

  // sjqz parity audit follow-up (post-Phase 12.6.10) — classify
  // 公众号 / Official Accounts (gh_*) as merchant subtype so the Ask
  // flow / EntityResolver can filter them out of human contacts.
  it("gh_* username → subtype merchant (公众号 / Official Account)", () => {
    const b = normalizeWeChatContact({
      username: "gh_abc123def",
      nickname: "某品牌官方",
      type: 3,
    });
    expect(b.persons).toHaveLength(1);
    expect(b.persons[0].subtype).toBe("merchant");
    expect(b.persons[0].identifiers.wechatId).toBe("gh_abc123def");
  });

  it("regular wxid_* → subtype contact (default)", () => {
    const b = normalizeWeChatContact({
      username: "wxid_realfriend",
      nickname: "好友",
      type: 1,
    });
    expect(b.persons[0].subtype).toBe("contact");
  });
});

// ─── WechatAdapter contract + sync flow ──────────────────────────────────

describe("WechatAdapter contract", () => {
  it("conforms to PersonalDataAdapter spec", () => {
    const a = new WechatAdapter({ account: { uin: "test-uin" } });
    const r = assertAdapter(a);
    expect(r.ok).toBe(true);
    if (!r.ok) console.log(r.errors);
  });

  it("name/version/extractMode/capabilities", () => {
    const a = new WechatAdapter({ account: { uin: "test-uin" } });
    expect(a.name).toBe("wechat");
    expect(a.version).toBe(WECHAT_VERSION);
    expect(a.extractMode).toBe("device-pull");
    expect(a.capabilities).toContain("sync:sqlite");
    expect(a.capabilities).toContain("decrypt:sqlcipher-v1");
    expect(a.dataDisclosure.legalGate).toBe(true);
  });

  it("rejects missing account", () => {
    expect(() => new WechatAdapter()).toThrow();
    expect(() => new WechatAdapter({})).toThrow(/account/);
    expect(() => new WechatAdapter({ account: {} })).toThrow(/uin/);
  });

  it("authenticate fails without DB", async () => {
    const a = new WechatAdapter({
      account: { uin: "test-uin" },
      keyProvider: { getKey: async () => "fakekey" },
    });
    const r = await a.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_NOT_PULLED");
  });

  it("authenticate fails without keyProvider", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-"));
    const dbPath = path.join(dir, "fake.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const a = new WechatAdapter({ account: { uin: "test-uin" }, dbPath });
      const r = await a.authenticate();
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("NO_KEY_PROVIDER");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("WechatAdapter.sync with mocked DB reader", () => {
  it("accepts sync-time inputPath from the generic file collector", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-input-alias-"));
    const dbPath = path.join(dir, "EnMicroMsg.db");
    fs.writeFileSync(dbPath, "fake-db-bytes");
    let receivedPath = null;
    const dbReaderFactory = (opts) => {
      receivedPath = opts.dbPath;
      return {
        open: async () => ({ profile: "wcdb-legacy", tables: 2 }),
        isEnMicroMsg: () => true,
        fetchContacts: () => [],
        fetchChatrooms: () => [],
        fetchMessages: () => [],
        close: () => {},
      };
    };
    try {
      const adapter = new WechatAdapter({
        account: { uin: "self123" },
        keyProvider: { getKey: async () => "fakekey" },
        dbReaderFactory,
      });
      const raws = [];
      for await (const raw of adapter.sync({ inputPath: dbPath }))
        raws.push(raw);
      expect(receivedPath).toBe(dbPath);
      expect(raws).toEqual([]);
      const readiness = await adapter.authenticate({
        inputPath: dbPath,
        readinessOnly: true,
      });
      expect(readiness).toEqual({ ok: true, mode: "configured" });
      expect((await adapter.healthCheck({ inputPath: dbPath })).ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("yields contact + message raw events", async () => {
    const fakeMessages = [
      {
        msgId: 1,
        msgSvrId: "9223372036854775800",
        talker: "wxid_friend",
        content: "你好",
        type: 1,
        createTime: 1700000000000,
        isSend: 0,
      },
      {
        msgId: 2,
        msgSvrId: "9223372036854775806",
        talker: "wxid_friend",
        content: "再见",
        type: 1,
        createTime: 1700000001000,
        isSend: 1,
      },
    ];
    const fakeContacts = [
      {
        username: "wxid_friend",
        alias: "x",
        nickname: "好友",
        conRemark: "",
        type: 1,
      },
    ];
    const fakeChatrooms = [];

    let openCalled = false;
    const dbReaderFactory = (opts) => ({
      open: async () => {
        openCalled = true;
        return { profile: "wcdb-legacy", tables: 5 };
      },
      isEnMicroMsg: () => true,
      listTables: () => ["message", "rcontact"],
      fetchContacts: () => fakeContacts,
      fetchChatrooms: () => fakeChatrooms,
      fetchMessages: () => fakeMessages,
      close: () => {},
      profile: () => "wcdb-legacy",
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-"));
    const dbPath = path.join(dir, "EnMicroMsg.db");
    fs.writeFileSync(dbPath, "fake-db-bytes");

    try {
      const events = [];
      const a = new WechatAdapter({
        account: { uin: "self123" },
        dbPath,
        keyProvider: { getKey: async () => "fakekey" },
        dbReaderFactory,
      });
      const raws = [];
      let watermark;
      for await (const r of a.sync({
        onProgress: (e) => events.push(e.phase),
        updateWatermark: (value) => {
          watermark = value;
        },
      })) {
        raws.push(r);
      }
      expect(openCalled).toBe(true);
      // 1 contact + 2 messages
      expect(raws).toHaveLength(3);
      expect(raws[0].payload.kind).toBe("contact");
      expect(raws[1].payload.kind).toBe("message");
      expect(events).toContain("opening");
      expect(events).toContain("opened");
      expect(events).toContain("done");
      expect(watermark).toBe("9223372036854775806");

      // Now normalize each raw and verify they pass schema
      for (const raw of raws) {
        const batch = a.normalize(raw);
        const v = validateBatch(batch);
        expect(v.valid).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // sjqz parity audit follow-up — fetchContacts must exclude
  // @stranger and fake_* by default (vault pollution prevention).
  it("fetchContacts excludes @stranger and fake_* by default", async () => {
    // Pure DI smoke — capture the SQL passed to .prepare() to verify the
    // junk filter is in the query. We mock just enough of better-sqlite3's
    // shape: db.prepare(sql) → { all(limit) → rows }, exec, pragma.
    const seenSql = [];
    const fakeDriver = function Database(_path, _opts) {
      return {
        pragma: () => undefined,
        exec: () => undefined,
        prepare(sql) {
          seenSql.push(sql);
          return {
            all: () => {
              if (sql.startsWith("PRAGMA table_info")) {
                return [
                  { name: "username" },
                  { name: "alias" },
                  { name: "nickname" },
                  { name: "conRemark" },
                  { name: "type" },
                ];
              }
              if (sql.startsWith("SELECT count")) return [{ n: 5 }];
              if (sql.includes("FROM rcontact")) return [];
              return [];
            },
            get: () => ({ n: 5 }),
          };
        },
        close: () => undefined,
      };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-junkfilt-"));
    const dbPath = path.join(dir, "EnMicroMsg.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const reader = new WeChatDBReader({
        dbPath,
        keyProvider: { getKey: async () => "0".repeat(64) },
        driver: fakeDriver,
      });
      await reader.open();
      reader.fetchContacts({ limit: 100 });
      const contactsSql = seenSql.find((s) => s.includes("FROM rcontact"));
      expect(contactsSql).toBeDefined();
      expect(contactsSql).toMatch(/NOT LIKE '%@stranger'/);
      expect(contactsSql).toMatch(/NOT LIKE 'fake_%'/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fetchContacts with includeJunk:true drops the filter (forensic mode)", async () => {
    const seenSql = [];
    const fakeDriver = function Database() {
      return {
        pragma: () => undefined,
        exec: () => undefined,
        prepare(sql) {
          seenSql.push(sql);
          return {
            all: () => {
              if (sql.startsWith("PRAGMA table_info")) {
                return [
                  "username",
                  "alias",
                  "nickname",
                  "conRemark",
                  "type",
                ].map((name) => ({ name }));
              }
              if (sql.startsWith("SELECT count")) return [{ n: 5 }];
              return [];
            },
            get: () => ({ n: 5 }),
          };
        },
        close: () => undefined,
      };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-incljunk-"));
    const dbPath = path.join(dir, "EnMicroMsg.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const reader = new WeChatDBReader({
        dbPath,
        keyProvider: { getKey: async () => "0".repeat(64) },
        driver: fakeDriver,
      });
      await reader.open();
      reader.fetchContacts({ limit: 100, includeJunk: true });
      const contactsSql = seenSql.find((s) => s.includes("FROM rcontact"));
      expect(contactsSql).toBeDefined();
      expect(contactsSql).not.toMatch(/NOT LIKE/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("idle no-op when DB path missing", async () => {
    const a = new WechatAdapter({
      account: { uin: "self123" },
      keyProvider: { getKey: async () => "fakekey" },
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  it("aborts gracefully when DB doesn't look like EnMicroMsg", async () => {
    const dbReaderFactory = () => ({
      open: async () => ({ profile: "wcdb-legacy", tables: 0 }),
      isEnMicroMsg: () => false,
      close: () => {},
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-"));
    const dbPath = path.join(dir, "not-wechat.db");
    fs.writeFileSync(dbPath, "fake");
    try {
      const a = new WechatAdapter({
        account: { uin: "self123" },
        dbPath,
        keyProvider: { getKey: async () => "fakekey" },
        dbReaderFactory,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
