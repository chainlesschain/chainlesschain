/**
 * §12.1 Phase 13+ ⭐⭐⭐ — 民生银行 (China Minsheng Bank, com.com.cmbc.newmbank)
 * adapter, "交易明细 + 信用卡". Supports snapshot import and an explicit live seam.
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). No endpoint is selected by default; custom live collection
 * requires caller-supplied captured URLs. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-cmbc";
const VERSION = "0.2.0";

const CmbcBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "cmbc",
});

module.exports = { CmbcBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
