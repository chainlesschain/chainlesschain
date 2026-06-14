/**
 * §12.1 Phase 13+ ⭐⭐⭐ — 交通银行 (Bank of Communications,
 * com.bankcomm.maidanba) adapter, "交易明细 + 信用卡". BEST-EFFORT SCAFFOLD
 * (user-requested).
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). Endpoints FABRICATED placeholders (overridable, NOT
 * field-verified — FAMILY-23 playbook); snapshot mode is the reliable path,
 * cookie path surfaces auth.unverified=true. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-bankcomm";
const VERSION = "0.1.0";

const BankcommBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "bankcomm",
  defaultTxUrl: "https://m.bankcomm.com/api/v1/account/transactions",
  defaultCardUrl: "https://m.bankcomm.com/api/v1/creditcard/bills",
});

module.exports = { BankcommBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
