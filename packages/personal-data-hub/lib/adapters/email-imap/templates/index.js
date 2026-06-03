/**
 * Phase 5.4 — template dispatcher.
 *
 * Routes a classified email through the appropriate field extractor:
 *
 *   bill_bank / bill_credit  → bill
 *   order                    → order
 *   travel                   → travel
 *   government               → government
 *   register                 → register
 *   notify / other / null    → other
 *
 * The dispatcher is the SINGLE entry point used by EmailAdapter.sync —
 * adding a new category later means adding a row to CATEGORY_TO_EXTRACTOR
 * and a new file, no other change.
 */

"use strict";

const { extractBill } = require("./bill");
const { extractOrder } = require("./order");
const { extractTravel } = require("./travel");
const { extractGovernment } = require("./government");
const { extractRegister } = require("./register");
const { extractOther } = require("./other");

const CATEGORY_TO_EXTRACTOR = Object.freeze({
  bill_bank: extractBill,
  bill_credit: extractBill,
  order: extractOrder,
  travel: extractTravel,
  government: extractGovernment,
  register: extractRegister,
  notify: extractOther,
  other: extractOther,
});

/**
 * Dispatch by classification.category. Always returns a result —
 * unknown categories fall through to the `other` extractor.
 *
 * @param {object} email — same shape EmailAdapter uses internally:
 *   { from, subject, textBody, htmlBody, headers, attachments }
 * @param {object} classification — Phase 5.3 result; `{category}` minimum
 * @param {object} [opts]
 * @param {{chat:Function}} [opts.llm]   LLM (currently only used by `other`)
 * @returns {Promise<{template:string,fields:object,confidence:number,warnings:string[]}>}
 */
async function extractFields(email, classification, opts = {}) {
  if (!email || typeof email !== "object") {
    return { template: "other", fields: {}, confidence: 0, warnings: ["email missing"] };
  }
  const category = classification && classification.category;
  const extractor = CATEGORY_TO_EXTRACTOR[category] || extractOther;
  try {
    return await extractor(email, opts);
  } catch (err) {
    return {
      template: extractor === extractOther ? "other" : (category || "other"),
      fields: {},
      confidence: 0,
      warnings: [`extractor threw: ${err && err.message ? err.message : err}`],
    };
  }
}

module.exports = {
  extractFields,
  CATEGORY_TO_EXTRACTOR,
  // Direct re-exports so callers needing one specific extractor can
  // bypass the dispatcher (handy in tests).
  extractBill,
  extractOrder,
  extractTravel,
  extractGovernment,
  extractRegister,
  extractOther,
};
