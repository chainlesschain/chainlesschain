"use strict";

const {
  AlipayBillAdapter,
  mapAlipayTypeToSubtype,
  parseAlipayDateTime,
  NAME,
  VERSION,
} = require("./alipay-bill-adapter");
const {
  parseAlipayCsv,
  parseAlipayCsvBuffer,
  decodeBuffer,
  splitCsvLine,
  FIELD_ORDER,
} = require("./csv-parser");
const { extractCsvFromZip } = require("./zip-decryptor");
const {
  KNOWN_MERCHANTS,
  classifyCounterparty,
  counterpartyToPersonId,
  normalizeCounterpartyName,
} = require("./counterparty");

module.exports = {
  AlipayBillAdapter,
  ALIPAY_BILL_NAME: NAME,
  ALIPAY_BILL_VERSION: VERSION,
  mapAlipayTypeToSubtype,
  parseAlipayDateTime,
  parseAlipayCsv,
  parseAlipayCsvBuffer,
  decodeAlipayBuffer: decodeBuffer,
  splitAlipayCsvLine: splitCsvLine,
  ALIPAY_CSV_FIELDS: FIELD_ORDER,
  extractAlipayCsvFromZip: extractCsvFromZip,
  ALIPAY_KNOWN_MERCHANTS: KNOWN_MERCHANTS,
  classifyAlipayCounterparty: classifyCounterparty,
  alipayCounterpartyToPersonId: counterpartyToPersonId,
  normalizeAlipayCounterpartyName: normalizeCounterpartyName,
};
