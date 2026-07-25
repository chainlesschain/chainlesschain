"use strict";

const C2C_MESSAGE_TABLE = "c2c_msg_table";
const GROUP_MESSAGE_TABLE = "group_msg_table";
const QQ_NT_MESSAGE_TABLES = new Set([C2C_MESSAGE_TABLE, GROUP_MESSAGE_TABLE]);
const DECIMAL_IDENTIFIER = /^\d+$/u;

function exactDecimalIdentifier(value) {
  if (typeof value === "string" && DECIMAL_IDENTIFIER.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  return null;
}

function canonicalQqNtOriginalId(payload) {
  if (!payload || typeof payload !== "object") return null;
  const messageId = Object.prototype.hasOwnProperty.call(payload, "messageId")
    ? exactDecimalIdentifier(payload.messageId)
    : exactDecimalIdentifier(payload.msgId);
  if (!messageId) return null;
  const inferredTable =
    payload.isGroup === true
      ? GROUP_MESSAGE_TABLE
      : payload.isGroup === false
        ? C2C_MESSAGE_TABLE
        : null;
  const tableName = QQ_NT_MESSAGE_TABLES.has(payload.tableName)
    ? payload.tableName
    : inferredTable;
  return tableName ? `${tableName}:${messageId}` : null;
}

function canonicalQqPersonOriginalId(value) {
  const uin = exactDecimalIdentifier(value);
  return uin ? `person-qq-${uin}` : null;
}

function canonicalQqGroupOriginalId(value) {
  const uin = exactDecimalIdentifier(value);
  return uin ? `group-qq-${uin}` : null;
}

module.exports = {
  C2C_MESSAGE_TABLE,
  GROUP_MESSAGE_TABLE,
  canonicalQqGroupOriginalId,
  canonicalQqNtOriginalId,
  canonicalQqPersonOriginalId,
  exactDecimalIdentifier,
};
