/**
 * §12.1 Phase 13+ ⭐⭐⭐ — 中国银行 (Bank of China, com.chinamworld.bocmbci)
 * adapter, "交易明细 + 信用卡". Supports snapshot import and an explicit live seam.
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). No endpoint is selected by default; custom live collection
 * requires caller-supplied captured URLs. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-boc";
const VERSION = "0.2.0";

const BocBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "boc",
});

module.exports = { BocBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
