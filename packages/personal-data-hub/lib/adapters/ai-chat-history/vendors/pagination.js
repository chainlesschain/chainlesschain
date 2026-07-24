"use strict";

const DEFAULT_MAX_PAGES = 200;

function resolveMaxPages(opts = {}, fallback = DEFAULT_MAX_PAGES) {
  return Number.isFinite(opts.maxPages)
    ? Math.max(1, Math.floor(opts.maxPages))
    : fallback;
}

function paginationError(vendor, code, message, details = {}) {
  const err = new Error(message);
  err.name = "AIChatPaginationError";
  err.code = code;
  err.vendor = vendor;
  Object.assign(err, details);
  return err;
}

function pageSignature(items, idFields) {
  return items
    .map((item, index) => {
      for (const field of idFields) {
        if (item && item[field] != null) {
          return `${field}:${String(item[field])}`;
        }
      }
      return `missing-id:${index}:${JSON.stringify(item)}`;
    })
    .join("\u0000");
}

function hasMoreState(meta) {
  if (!meta || typeof meta !== "object") return null;
  let sawFalse = false;
  for (const key of ["has_more", "hasMore", "more"]) {
    if (meta[key] === true) return true;
    if (meta[key] === false) sawFalse = true;
  }
  return sawFalse ? false : null;
}

module.exports = {
  DEFAULT_MAX_PAGES,
  resolveMaxPages,
  paginationError,
  pageSignature,
  hasMoreState,
};
