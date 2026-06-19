"use strict";

/**
 * @chainlesschain/core-settlement — P1 结算核公开面。
 * 联邦签名转账日志账本（ledger）+ 托管人 escrow（multisig 门控）。
 */

const schema = require("./schema.js");
const signing = require("./signing.js");
const { createLedger } = require("./ledger.js");
const { createEscrow } = require("./escrow.js");

module.exports = {
  DDL: schema.DDL,
  applySchema: schema.applySchema,
  canonicalizeEntry: signing.canonicalizeEntry,
  signEntry: signing.signEntry,
  verifyEntry: signing.verifyEntry,
  ALG: signing.ALG,
  createLedger,
  createEscrow,
};
