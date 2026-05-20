#!/usr/bin/env node
/**
 * Build a synthetic Android contacts2.db at the given path.
 *
 * Only used by the smoke runner / docs walkthrough — production code never
 * relies on this. Mirrors the fixture from
 * packages/personal-data-hub-bridge/tests/test_parsers_system_contacts.py.
 *
 * Usage:
 *   node scripts/_make-fixture-contacts.js ./fixtures/contacts2.db
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3-multiple-ciphers");

const target = path.resolve(process.argv[2] || "./fixtures/contacts2.db");
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) fs.unlinkSync(target);

const db = new Database(target);
try {
  db.exec(`
    CREATE TABLE raw_contacts (
      _id INTEGER PRIMARY KEY,
      display_name TEXT,
      starred INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0
    );
    CREATE TABLE mimetypes (
      _id INTEGER PRIMARY KEY,
      mimetype TEXT NOT NULL UNIQUE
    );
    CREATE TABLE data (
      _id INTEGER PRIMARY KEY,
      raw_contact_id INTEGER NOT NULL,
      mimetype_id INTEGER NOT NULL,
      data1 TEXT
    );
  `);

  const MT = {
    phone: 5,
    email: 1,
    org: 4,
    note: 10,
    photo: 14,
  };
  const insertMime = db.prepare(
    "INSERT INTO mimetypes (_id, mimetype) VALUES (?, ?)",
  );
  insertMime.run(MT.phone, "vnd.android.cursor.item/phone_v2");
  insertMime.run(MT.email, "vnd.android.cursor.item/email_v2");
  insertMime.run(MT.org, "vnd.android.cursor.item/organization");
  insertMime.run(MT.note, "vnd.android.cursor.item/note");
  insertMime.run(MT.photo, "vnd.android.cursor.item/photo");

  const insertC = db.prepare(
    "INSERT INTO raw_contacts (_id, display_name, starred, deleted) VALUES (?, ?, ?, 0)",
  );
  insertC.run(1, "妈妈", 1);
  insertC.run(2, "张三", 0);
  insertC.run(3, "李四 Manager", 0);
  insertC.run(4, "", 0); // nameless — skipped by parser
  insertC.run(5, "工商银行客服", 0);

  const insertD = db.prepare(
    "INSERT INTO data (raw_contact_id, mimetype_id, data1) VALUES (?, ?, ?)",
  );
  insertD.run(1, MT.phone, "13800001111");
  insertD.run(1, MT.phone, "13900002222");
  insertD.run(1, MT.email, "mom@example.com");
  insertD.run(1, MT.note, "亲妈，过年回家");
  insertD.run(2, MT.phone, "13711112222");
  insertD.run(3, MT.phone, "13822223333");
  insertD.run(3, MT.email, "lisi@corp.example.com");
  insertD.run(3, MT.org, "Example Corp");
  insertD.run(5, MT.phone, "95588");
} finally {
  db.close();
}
console.log("fixture written:", target);
