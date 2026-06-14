/**
 * §12.1 Phase 13+ ⭐⭐⭐ — 中国银行 (Bank of China, com.chinamworld.bocmbci)
 * adapter, "交易明细 + 信用卡". BEST-EFFORT SCAFFOLD (user-requested).
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). Endpoints FABRICATED placeholders (overridable, NOT
 * field-verified — FAMILY-23 playbook); snapshot mode is the reliable path,
 * cookie path surfaces auth.unverified=true. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-boc";
const VERSION = "0.1.0";

const BocBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "boc",
  defaultTxUrl: "https://ebsnew.boc.cn/api/v1/account/transactions",
  defaultCardUrl: "https://ebsnew.boc.cn/api/v1/creditcard/bills",
});

module.exports = { BocBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
