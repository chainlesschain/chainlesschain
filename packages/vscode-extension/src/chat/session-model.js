"use strict";

// Model IDs also reach Windows CLI inspection commands. Keep aliases intact,
// while rejecting shell syntax, control characters and oversized identities.
function validSessionModel(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\s\p{Cc}&|<>^"'`%]/u.test(value)
  );
}

function parseSessionModel(spec) {
  if (typeof spec !== "string")
    throw new Error("Use /model <model-id> or /model --default");
  const value = spec.trim();
  if (!value) return null; // show the current selection
  if (value === "--default") return "";
  if (!validSessionModel(value))
    throw new Error(
      "Use one model ID of at most 256 characters without shell syntax",
    );
  return value;
}

module.exports = { validSessionModel, parseSessionModel };
