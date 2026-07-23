"use strict";

const assert = require("node:assert/strict");
const { formatBridgeReport } = require("../src/ide-doctor.js");

const report = formatBridgeReport({
  port: 43123,
  extensionVersion: "0.37.24",
  vscodeVersion: "1.129.1",
  cliVersionText: "0.162.176",
  workspaceTrusted: false,
  workspace: "C:\\workspace",
  statusText: "status ok",
  doctorText: "doctor ok",
});

assert.match(report, /Runtime compatibility/);
assert.match(report, /Extension: 0\.37\.24/);
assert.match(report, /VS Code: 1\.129\.1/);
assert.match(report, /CLI: 0\.162\.176/);
assert.match(report, /DEGRADED \(可降级运行\)/);
assert.match(report, /Workspace trust: restricted/);
assert.match(report, /Workspace: C:\\workspace/);
assert.match(report, /127\.0\.0\.1:43123/);
console.log("ide-doctor: 8 assertions passed");
