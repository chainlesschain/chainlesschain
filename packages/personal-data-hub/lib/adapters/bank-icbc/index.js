/**
 * §12.1 Phase 13+ — 工商银行 (ICBC, com.icbc) adapter, "交易明细 + 信用卡".
 * BEST-EFFORT SCAFFOLD. Discovered as a device-installed gap (2026-06-15) —
 * not in the original §12.1 bank list (民生/中行/交行), added for completeness.
 *
 * Thin wrapper over _bank-base. ⚠️ MAXIMALLY SENSITIVE (real-name banking,
 * strong-auth). Endpoints FABRICATED placeholders (overridable, NOT
 * field-verified — FAMILY-23 playbook); snapshot mode is the reliable path,
 * cookie path surfaces auth.unverified=true. Gated high sensitivity + legalGate.
 */

"use strict";

const { createBankAdapter, SNAPSHOT_SCHEMA_VERSION } = require("../_bank-base");

const NAME = "bank-icbc";
const VERSION = "0.1.0";

const IcbcBankAdapter = createBankAdapter({
  NAME,
  VERSION,
  platform: "icbc",
  defaultTxUrl: "https://mybank.icbc.com.cn/api/v1/account/transactions",
  defaultCardUrl: "https://mybank.icbc.com.cn/api/v1/creditcard/bills",
});

module.exports = { IcbcBankAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
