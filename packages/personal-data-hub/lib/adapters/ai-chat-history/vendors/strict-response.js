"use strict";

const {
  SourcePageError,
  extractRecognizedArray,
} = require("../../../source-page");

function extractVendorArray(response, paths, opts = {}) {
  assertBusinessStatus(response, opts);
  return extractRecognizedArray(response, paths, {
    source: `ai-chat-history/${opts.vendor || "vendor"}`,
    stream: opts.stream,
  });
}

function assertBusinessStatus(response, opts = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return;
  }

  const statuses = opts.businessStatus || {};
  for (const [key, allowedValues] of Object.entries(statuses)) {
    if (response[key] == null) continue;
    const actual = normalizeStatus(response[key]);
    const allowed = (
      Array.isArray(allowedValues) ? allowedValues : [allowedValues]
    ).some((value) => normalizeStatus(value) === actual);
    if (!allowed) {
      throw new SourcePageError(
        "SOURCE_PAGE_ERROR",
        `ai-chat-history/${opts.vendor || "vendor"}: ${opts.stream || "page"} source returned a business error`,
      );
    }
  }
}

function normalizeStatus(value) {
  return String(value).trim().toLowerCase();
}

module.exports = {
  extractVendorArray,
};
