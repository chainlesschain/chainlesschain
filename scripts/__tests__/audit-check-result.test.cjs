"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");
const { parseAuditResult } = require("../audit-check-result.cjs");

const parent = fs.realpathSync.native(os.tmpdir());
const root = fs.mkdtempSync(path.join(parent, "cc-audit-response-"));
after(() => {
  assert.equal(path.dirname(root), parent);
  assert(path.basename(root).startsWith("cc-audit-response-"));
  fs.rmSync(root, { recursive: true, force: true });
});
function report(vulnerabilities = {}) {
  const counts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };
  for (const value of Object.values(vulnerabilities)) {
    counts[value.severity]++;
    counts.total++;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: counts },
  };
}
function run(
  payload,
  { failed = false, severity = "critical", timedOut = false } = {},
) {
  const directory = fs.mkdtempSync(path.join(root, "case-"));
  const hook = path.join(directory, "npm-response.cjs");
  const called = path.join(directory, "called");
  fs.writeFileSync(
    hook,
    `const Module=require('node:module'),fs=require('node:fs');
const original=Module._load;
Module._load=function(id,...args){
 if(id==='child_process')return {execSync(command,options){
  fs.writeFileSync(${JSON.stringify(called)},JSON.stringify({command,options}));
  const output=${JSON.stringify(payload)};
  if(${failed})throw Object.assign(new Error('network failure'),{stdout:output,...(${timedOut}?{code:'ETIMEDOUT',signal:'SIGTERM'}:{})});
  return output;
 }};
 return Reflect.apply(original,this,[id,...args]);
};`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      hook,
      path.resolve(__dirname, "../audit-check.js"),
      `--audit-level=${severity}`,
    ],
    { encoding: "utf8", timeout: 5000, windowsHide: true },
  );
  assert.equal(result.error, undefined);
  return {
    ...result,
    called: fs.existsSync(called)
      ? JSON.parse(fs.readFileSync(called, "utf8"))
      : null,
  };
}

test("valid zero-vulnerability report is the only empty audit success", () => {
  const clean = report();
  assert.deepEqual(parseAuditResult(JSON.stringify(clean)), clean);
  const result = run(JSON.stringify(clean));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No vulnerabilities found/u);
  assert.equal(result.called.options.timeout, 60_000);
});
test("critical mongoose remains blocking while the existing decompression exception remains explicit", () => {
  const mongoose = run(
    JSON.stringify(report({ mongoose: { severity: "critical", via: [] } })),
    { failed: true },
  );
  assert.equal(mongoose.status, 1);
  assert.match(mongoose.stdout, /mongoose/u);
  const decompress = run(
    JSON.stringify(report({ decompress: { severity: "critical", via: [] } })),
    { failed: true },
  );
  assert.equal(decompress.status, 0);
  assert.match(decompress.stdout, /decompress/u);
});
for (const [name, payload] of [
  ["missing output", ""],
  ["missing vulnerability body", "{}"],
  ["registry failure", JSON.stringify({ error: { code: "E503" } })],
  [
    "incomplete counters",
    JSON.stringify({ vulnerabilities: {}, metadata: {} }),
  ],
  ["invalid JSON", "{partial"],
  [
    "contradictory empty body",
    JSON.stringify({
      ...report(),
      metadata: {
        vulnerabilities: { ...report().metadata.vulnerabilities, total: 1 },
      },
    }),
  ],
])
  test(`CLI refuses ${name} instead of reporting a clean audit`, () => {
    const result = run(payload, { failed: true });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /No vulnerabilities found/u);
  });
test("unknown severity is rejected before any audit shell invocation", () => {
  const result = run(JSON.stringify(report()), { severity: "unknown" });
  assert.equal(result.status, 1);
  assert.equal(result.called, null);
});

test("a timed-out audit fails even if it already printed valid clean JSON", () => {
  const result = run(JSON.stringify(report()), {
    failed: true,
    timedOut: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deadline/u);
  assert.doesNotMatch(result.stdout, /No vulnerabilities found/u);
});
