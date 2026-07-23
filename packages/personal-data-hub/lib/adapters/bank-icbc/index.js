/**
 * §12.1 Phase 13+ — 工商银行 (ICBC, com.icbc) adapter, "交易明细 + 信用卡".
 * Snapshot-import adapter. Discovered as a device-installed gap (2026-06-15) —
 * not in the original §12.1 bank list (民生/中行/交行), added for completeness.
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). No endpoint is selected by default; custom live collection
 * requires caller-supplied captured URLs. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-icbc";
const VERSION = "0.2.0";

const IcbcBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "icbc",
});

module.exports = { IcbcBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
