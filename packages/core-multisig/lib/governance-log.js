"use strict";

/**
 * v1.2 m-of-n Phase 1e — append-only JSONL audit trail for multisig 状态转移。
 *
 * 设计文档 §2.1 复用 MTC `governance.log` 模式：每行 JSON 对象，按 createdAt 升序，
 * 永不修改既往行。这里不和 MTC 共用同一物理文件 — multisig 自己一份，便于按 domain
 * 检索。
 *
 * 写策略：每条记录都 fsync 失败要 propagate 给调用方（auditability gate）；
 * 不 buffer / 不批量写（保证 crash 安全）。
 *
 * appendEvent 是同步 — 调用方在 transaction 成功后调，保证 SQLite + governance log
 * 双写同步（若 log 写失败，调用方应回滚 SQLite 或 surface error 提示用户）。
 */

const fs = require("fs");
const path = require("path");

/**
 * 把 event 追加到指定 logPath，自动 mkdir。
 *
 * @param {string} logPath - 绝对路径 (~/.chainlesschain/multisig.governance.log)
 * @param {object} event   - 任意可 JSON 序列化对象；约定含 `at` (ISO timestamp) 和
 *                            `type` (proposed/signed/reached/consumed/cancelled/expired)
 *                            字段方便后续解析
 */
function appendEvent(logPath, event) {
  if (typeof logPath !== "string" || logPath.length === 0) {
    throw new TypeError("appendEvent: logPath must be non-empty string");
  }
  if (!event || typeof event !== "object") {
    throw new TypeError("appendEvent: event must be object");
  }
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(event) + "\n";
  fs.appendFileSync(logPath, line, { encoding: "utf-8" });
}

/**
 * 读完整 log 转 JSON 数组 — 主要给 CLI list / debug 用。生产代码不应在 hot path
 * 调用（O(N) 文件读）。容忍单行解析失败：skip + 不抛。
 *
 * @returns {object[]}
 */
function readLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const raw = fs.readFileSync(logPath, "utf-8");
  const events = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (_err) {
      // skip malformed line — append-only file should be intact, but be defensive
    }
  }
  return events;
}

module.exports = { appendEvent, readLog };
