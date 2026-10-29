"use strict";

const { createHash } = require("node:crypto");
const { invalidArgument } = require("./errors.js");

function canonicalize(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidArgument("canonical JSON cannot contain non-finite numbers", { path });
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    throw invalidArgument("canonical JSON accepts only plain JSON values", { path });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidArgument("canonical JSON objects must be plain objects", { path });
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => [key, canonicalize(value[key], `${path}.${key}`)]),
  );
}

// Serialization needs an ordered tree, but not the intermediate key/value
// arrays created by public canonicalize. Keep its validation and read order.
function canonicalTree(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidArgument("canonical JSON cannot contain non-finite numbers", {
        path,
      });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    // Native map preserves holes, inherited indices, species and overrides.
    return value.map((entry, index) => canonicalTree(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    throw invalidArgument("canonical JSON accepts only plain JSON values", {
      path,
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidArgument("canonical JSON objects must be plain objects", {
      path,
    });
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort((left, right) => left.localeCompare(right, "en"));
  const result = Object.create(null);
  for (const key of keys) {
    result[key] = canonicalTree(value[key], `${path}.${key}`);
  }
  // Populate without inherited setters (including __proto__), then match
  // Object.fromEntries' ordinary-object result and inherited toJSON behavior.
  return Object.setPrototypeOf(result, Object.prototype);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalTree(value));
}

function canonicalDigest(value, domain = "chainlesschain.context-memory/v1") {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function cloneCanonical(value) {
  if (value === undefined) return undefined;
  return JSON.parse(canonicalJson(value));
}

module.exports = {
  canonicalize,
  canonicalJson,
  canonicalDigest,
  cloneCanonical,
};
