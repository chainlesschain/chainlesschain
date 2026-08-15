"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIdeCapabilities } = require("./ide-capabilities");

test("capability manifest is derived from registered tools", () => {
  const manifest = buildIdeCapabilities([
    { name: "getActiveFile" },
    { name: "getContextCenter" },
    { name: "openDiff" },
    { name: "getProjectModel" },
    { name: "getTestResults" },
    { name: "getCoverage" },
    { name: "getDebugState" },
    { name: "unknown_optional_tool" },
  ]);

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.tools, [
    "getActiveFile",
    "getContextCenter",
    "getCoverage",
    "getDebugState",
    "getProjectModel",
    "getTestResults",
    "openDiff",
    "unknown_optional_tool",
  ]);
  assert.deepEqual(manifest.features, [
    "active_file",
    "context_center",
    "coverage",
    "debug_state",
    "native_diff",
    "project_model",
    "test_results",
  ]);
});

test("missing optional tools do not imply unsupported capabilities", () => {
  const manifest = buildIdeCapabilities([{ name: "getSelection" }]);
  assert.deepEqual(manifest.features, ["selection"]);
  assert.equal(manifest.tools.includes("executeCode"), false);
});
