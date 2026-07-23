/**
 * §12.1 Phase 13+ ⭐⭐⭐ — 交通银行 (Bank of Communications,
 * com.bankcomm.maidanba) adapter, "交易明细 + 信用卡". Supports snapshot import
 * and an explicit live seam.
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). No endpoint is selected by default; custom live collection
 * requires caller-supplied captured URLs. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-bankcomm";
const VERSION = "0.2.0";

const BankcommBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "bankcomm",
});

module.exports = { BankcommBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
