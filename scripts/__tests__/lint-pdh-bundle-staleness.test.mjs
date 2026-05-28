// Unit tests for scripts/lint-pdh-bundle-staleness.mjs (traps #27 + #28).
//
// Tests the pure functions only (classifyLibChanges, extractUsrVersion,
// checkUsrVersionBumped, checkWorkspaceVersionBumped). git diff / git show
// integration is exercised by the PR workflow + manual throwaway PR.
//
// Run: node --test scripts/__tests__/lint-pdh-bundle-staleness.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyLibChanges,
  extractUsrVersion,
  checkUsrVersionBumped,
  checkWorkspaceVersionBumped,
} from "../lint-pdh-bundle-staleness.mjs";

// ── classifyLibChanges ─────────────────────────────────────────────────────

test("classifyLibChanges: no relevant files → both false", () => {
  const r = classifyLibChanges(["README.md", "docs/foo.md"]);
  assert.equal(r.pdhLibChanged, false);
  assert.equal(r.cliLibChanged, false);
});

test("classifyLibChanges: PDH lib file → pdhLibChanged true only", () => {
  const r = classifyLibChanges(["packages/personal-data-hub/lib/analysis.js"]);
  assert.equal(r.pdhLibChanged, true);
  assert.equal(r.cliLibChanged, false);
});

test("classifyLibChanges: CLI lib file → cliLibChanged true only", () => {
  const r = classifyLibChanges(["packages/cli/lib/foo.js"]);
  assert.equal(r.pdhLibChanged, false);
  assert.equal(r.cliLibChanged, true);
});

test("classifyLibChanges: both → both true", () => {
  const r = classifyLibChanges([
    "packages/personal-data-hub/lib/x.js",
    "packages/cli/lib/y.js",
  ]);
  assert.equal(r.pdhLibChanged, true);
  assert.equal(r.cliLibChanged, true);
});

test("classifyLibChanges: PDH non-lib paths do NOT trigger", () => {
  // package.json, __tests__, top-level files are not lib/**.
  const r = classifyLibChanges([
    "packages/personal-data-hub/package.json",
    "packages/personal-data-hub/__tests__/vault.test.js",
    "packages/cli/package.json",
    "packages/cli/bin/chainlesschain.js",
  ]);
  assert.equal(r.pdhLibChanged, false);
  assert.equal(r.cliLibChanged, false);
});

// ── extractUsrVersion ──────────────────────────────────────────────────────

test("extractUsrVersion: canonical buildConfigField → captures number", () => {
  const src = `buildConfigField("String", "USR_VERSION", "\\"17\\"")`;
  assert.equal(extractUsrVersion(src), "17");
});

test("extractUsrVersion: with surrounding whitespace + comment", () => {
  const src = `
    // Phase 2 bootstrap version
    buildConfigField( "String" , "USR_VERSION" , "\\"42\\"" )
  `;
  assert.equal(extractUsrVersion(src), "42");
});

test("extractUsrVersion: missing → null", () => {
  const src = `minSdk = 28\nbuildConfigField("String", "OTHER", "\\"x\\"")`;
  assert.equal(extractUsrVersion(src), null);
});

test("extractUsrVersion: empty/null input → null", () => {
  assert.equal(extractUsrVersion(""), null);
  assert.equal(extractUsrVersion(null), null);
});

// ── checkUsrVersionBumped (trap #27) ───────────────────────────────────────

test("checkUsrVersionBumped: no lib change → 0 violations", () => {
  const v = checkUsrVersionBumped({
    pdhLibChanged: false,
    cliLibChanged: false,
    gradleBase: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
    gradleHead: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
  });
  assert.equal(v.length, 0);
});

test("checkUsrVersionBumped: PDH lib changed + USR not bumped → 1 violation", () => {
  const v = checkUsrVersionBumped({
    pdhLibChanged: true,
    cliLibChanged: false,
    gradleBase: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
    gradleHead: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-27-usr-version-not-bumped");
  assert.match(v[0].message, /still "17"/);
  assert.ok(v[0].fix.length >= 4, "fix chain should list 4 steps");
});

test("checkUsrVersionBumped: PDH lib changed + USR bumped → 0 violations", () => {
  const v = checkUsrVersionBumped({
    pdhLibChanged: true,
    cliLibChanged: false,
    gradleBase: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
    gradleHead: `buildConfigField("String", "USR_VERSION", "\\"18\\"")`,
  });
  assert.equal(v.length, 0);
});

test("checkUsrVersionBumped: CLI lib changed alone also triggers", () => {
  const v = checkUsrVersionBumped({
    pdhLibChanged: false,
    cliLibChanged: true,
    gradleBase: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
    gradleHead: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-27-usr-version-not-bumped");
});

test("checkUsrVersionBumped: USR_VERSION absent at HEAD → 1 violation", () => {
  const v = checkUsrVersionBumped({
    pdhLibChanged: true,
    cliLibChanged: false,
    gradleBase: `buildConfigField("String", "USR_VERSION", "\\"17\\"")`,
    gradleHead: `// USR_VERSION line accidentally deleted`,
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-27-usr-version-missing");
});

// ── checkWorkspaceVersionBumped (trap #28) ─────────────────────────────────

const pdhPkg = (v) => JSON.stringify({ name: "@chainlesschain/personal-data-hub", version: v });
const cliPkg = (depVer) =>
  JSON.stringify({
    name: "@chainlesschain/cli",
    version: "0.162.27",
    dependencies: { "@chainlesschain/personal-data-hub": depVer },
  });

test("checkWorkspaceVersionBumped: no PDH lib change → 0 violations", () => {
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: false,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: pdhPkg("0.3.9"),
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliPkg("0.3.9"),
  });
  assert.equal(v.length, 0);
});

test("checkWorkspaceVersionBumped: lib changed + PDH not bumped → trap-28-pdh-version-not-bumped", () => {
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: true,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: pdhPkg("0.3.9"),
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliPkg("0.3.9"),
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-28-pdh-version-not-bumped");
});

test("checkWorkspaceVersionBumped: PDH bumped but CLI dep not synced → trap-28-cli-dep-mismatch", () => {
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: true,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: pdhPkg("0.3.10"),
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliPkg("0.3.9"),
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-28-cli-dep-mismatch");
  assert.match(v[0].message, /"0\.3\.9".*"0\.3\.10"/s);
});

test("checkWorkspaceVersionBumped: PDH bumped + CLI dep synced → 0 violations", () => {
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: true,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: pdhPkg("0.3.10"),
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliPkg("0.3.10"),
  });
  assert.equal(v.length, 0);
});

test("checkWorkspaceVersionBumped: CLI dep missing entirely → trap-28-cli-dep-missing", () => {
  const cliHead = JSON.stringify({
    name: "@chainlesschain/cli",
    version: "0.162.27",
    dependencies: { "some-other-pkg": "1.0.0" },
  });
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: true,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: pdhPkg("0.3.10"),
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliHead,
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-28-cli-dep-missing");
});

test("checkWorkspaceVersionBumped: PDH package.json unparseable at HEAD → trap-28-pdh-package-unparseable", () => {
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: true,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: "{not valid json",
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliPkg("0.3.10"),
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "trap-28-pdh-package-unparseable");
});

test("checkWorkspaceVersionBumped: both #28 sub-violations stack", () => {
  // PDH version unchanged AND cli dep also unchanged AND they disagree at HEAD.
  // Expect both pdh-not-bumped + dep-mismatch in the same run.
  const v = checkWorkspaceVersionBumped({
    pdhLibChanged: true,
    pdhPkgBase: pdhPkg("0.3.9"),
    pdhPkgHead: pdhPkg("0.3.9"),
    cliPkgBase: cliPkg("0.3.9"),
    cliPkgHead: cliPkg("0.3.7"),
  });
  assert.equal(v.length, 2);
  const codes = v.map((x) => x.code).sort();
  assert.deepEqual(codes, ["trap-28-cli-dep-mismatch", "trap-28-pdh-version-not-bumped"]);
});
