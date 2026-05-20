#!/usr/bin/env node
/**
 * Build a complete fixture directory with all 4 system-data sources:
 *
 *   <out>/
 *     contacts2.db          (raw_contacts + data + mimetypes)
 *     mmssms.db             (sms)
 *     wifi/
 *       WifiConfigStore.xml
 *
 * Usage:
 *   node scripts/_make-fixture-all.js ./fixtures
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3-multiple-ciphers");

const outDir = path.resolve(process.argv[2] || "./fixtures");
fs.mkdirSync(path.join(outDir, "wifi"), { recursive: true });

// ── contacts2.db ──────────────────────────────────────────────────────────
const contactsPath = path.join(outDir, "contacts2.db");
if (fs.existsSync(contactsPath)) fs.unlinkSync(contactsPath);
const contacts = new Database(contactsPath);
contacts.exec(`
  CREATE TABLE raw_contacts (
    _id INTEGER PRIMARY KEY, display_name TEXT, starred INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0
  );
  CREATE TABLE mimetypes (_id INTEGER PRIMARY KEY, mimetype TEXT NOT NULL UNIQUE);
  CREATE TABLE data (
    _id INTEGER PRIMARY KEY, raw_contact_id INTEGER NOT NULL, mimetype_id INTEGER NOT NULL, data1 TEXT
  );
  CREATE TABLE calls (
    _id INTEGER PRIMARY KEY, number TEXT, type INTEGER, duration INTEGER, date INTEGER, name TEXT, is_read INTEGER DEFAULT 1
  );
`);
const MT = { phone: 5, email: 1, org: 4, note: 10, photo: 14 };
const mi = contacts.prepare("INSERT INTO mimetypes (_id, mimetype) VALUES (?, ?)");
mi.run(MT.phone, "vnd.android.cursor.item/phone_v2");
mi.run(MT.email, "vnd.android.cursor.item/email_v2");
mi.run(MT.org, "vnd.android.cursor.item/organization");
mi.run(MT.note, "vnd.android.cursor.item/note");
mi.run(MT.photo, "vnd.android.cursor.item/photo");
const ci = contacts.prepare(
  "INSERT INTO raw_contacts (_id, display_name, starred, deleted) VALUES (?, ?, ?, 0)",
);
ci.run(1, "妈妈", 1);
ci.run(2, "张三", 0);
ci.run(3, "李四 Manager", 0);
ci.run(5, "工商银行客服", 0);
const di = contacts.prepare(
  "INSERT INTO data (raw_contact_id, mimetype_id, data1) VALUES (?, ?, ?)",
);
di.run(1, MT.phone, "13800001111");
di.run(1, MT.phone, "13900002222");
di.run(1, MT.email, "mom@example.com");
di.run(1, MT.note, "亲妈，过年回家");
di.run(2, MT.phone, "13711112222");
di.run(3, MT.phone, "13822223333");
di.run(3, MT.email, "lisi@corp.example.com");
di.run(3, MT.org, "Example Corp");
di.run(5, MT.phone, "95588");
// Calls table inside contacts2.db (pre-Android-11 location)
const li = contacts.prepare(
  "INSERT INTO calls (_id, number, type, duration, date, name, is_read) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
li.run(1, "13800001111", 1, 120, 1737000000000, "妈妈", 1);
li.run(2, "13800001111", 2, 45, 1737010000000, "妈妈", 1);
li.run(3, "13999998888", 3, 0, 1737020000000, "", 0);
li.run(4, "10086", 1, 8, 1737030000000, "中国移动", 1);
contacts.close();
console.log("wrote:", contactsPath);

// ── mmssms.db ─────────────────────────────────────────────────────────────
const smsPath = path.join(outDir, "mmssms.db");
if (fs.existsSync(smsPath)) fs.unlinkSync(smsPath);
const sms = new Database(smsPath);
sms.exec(`
  CREATE TABLE sms (
    _id INTEGER PRIMARY KEY, thread_id INTEGER, address TEXT, body TEXT,
    type INTEGER, date INTEGER, read INTEGER
  );
`);
const si = sms.prepare(
  "INSERT INTO sms (_id, thread_id, address, body, type, date, read) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
si.run(1, 100, "13800001111", "妈妈我到家了", 2, 1737000000000, 1);
si.run(2, 100, "13800001111", "好的，注意安全", 1, 1737000010000, 1);
si.run(3, 200, "10086", "【中国移动】您的话费余额为 ¥36.50", 1, 1737000020000, 1);
si.run(4, 300, "95588", "【工商银行】您的验证码为 123456，3 分钟内有效", 1, 1737000030000, 0);
sms.close();
console.log("wrote:", smsPath);

// ── wifi/WifiConfigStore.xml ──────────────────────────────────────────────
const wifiXml = path.join(outDir, "wifi", "WifiConfigStore.xml");
fs.writeFileSync(
  wifiXml,
  `<?xml version='1.0' encoding='UTF-8'?>
<WifiConfigStoreData>
  <NetworkList>
    <Network>
      <WifiConfiguration>
        <string name="SSID">"Home_5G"</string>
        <string name="PreSharedKey">"secret"</string>
        <string name="KeyMgmt">WPA-PSK</string>
        <boolean name="HiddenSSID">false</boolean>
      </WifiConfiguration>
    </Network>
    <Network>
      <WifiConfiguration>
        <string name="SSID">"Starbucks Free"</string>
        <string name="KeyMgmt">NONE</string>
        <boolean name="HiddenSSID">false</boolean>
      </WifiConfiguration>
    </Network>
  </NetworkList>
</WifiConfigStoreData>
`,
  "utf-8",
);
console.log("wrote:", wifiXml);

console.log("\nAll fixtures ready under:", outDir);
