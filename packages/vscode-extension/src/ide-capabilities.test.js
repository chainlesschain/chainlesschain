"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIdeCapabilities } = require("./ide-capabilities");

test("capability manifest is derived from registered tools", () => {
  const manifest = buildIdeCapabilities([
    { name: "getActiveFile" },
    { name: "openDiff" },
    { name: "getProjectModel" },
    { name: "unknown_optional_tool" },
  ]);

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.tools, [
    "getActiveFile",
    "getProjectModel",
    "openDiff",
    "unknown_optional_tool",
  ]);
  assert.deepEqual(manifest.features, [
    "active_file",
    "native_diff",
    "project_model",
  ]);
});

test("missing optional tools do not imply unsupported capabilities", () => {
  const manifest = buildIdeCapabilities([{ name: "getSelection" }]);
  assert.deepEqual(manifest.features, ["selection"]);
  assert.equal(manifest.tools.includes("executeCode"), false);
});
