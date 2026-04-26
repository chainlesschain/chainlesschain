"use strict";

const canonicalize = require("canonicalize");

function jcs(value) {
  const str = canonicalize(value);
  if (typeof str !== "string") {
    throw new TypeError("jcs: canonicalize returned non-string");
  }
  return Buffer.from(str, "utf-8");
}

module.exports = { jcs };
