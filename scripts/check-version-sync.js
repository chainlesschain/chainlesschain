#!/usr/bin/env node
/**
 * Verify version-string consistency across all 5 release surfaces.
 *
 * Single source of truth: package.json.productVersion (format: vX.Y.Z.N)
 *
 * Surfaces checked:
 *   1. package.json.productVersion             (SoT, e.g. "v5.0.3.56")
 *   2. desktop-app-vue/package.json.version    (must be "X.Y.Z-alpha.N")
 *   3. ios-app/.../Info.plist CFBundleShortVersionString  (must be "X.Y.Z")
 *   4. ios-app/.../Info.plist CFBundleVersion             (must be "N")
 *
 * Independent tracks (not enforced, reported only):
 *   - packages/cli/package.json.version          (CLI alpha-prerelease, decoupled)
 *   - package.json.version                       (monorepo aggregate, decoupled)
 *
 * Exit 0 = all in sync. Exit 1 = at least one mismatch.
 * Usage: node scripts/check-version-sync.js
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
/* eslint-enable @typescript-eslint/no-require-imports */

const REPO_ROOT = path.resolve(__dirname, "..");

function read(p) {
  return fs.readFileSync(path.join(REPO_ROOT, p), "utf-8");
}

function parseProductVersion(v) {
  // "v5.0.3.56" -> { major: "5", minor: "0", patch: "3", build: "56" }
  const m = /^v(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) {
    throw new Error(
      `productVersion "${v}" does not match required format vX.Y.Z.N`,
    );
  }
  return { major: m[1], minor: m[2], patch: m[3], build: m[4] };
}

function readPlistKey(plistXml, key) {
  const re = new RegExp(
    `<key>${key}</key>\\s*<string>([^<]*)</string>`,
    "i",
  );
  const m = re.exec(plistXml);
  return m ? m[1] : null;
}

const failures = [];
const warnings = [];

// 1. Read SoT
const rootPkg = JSON.parse(read("package.json"));
if (!rootPkg.productVersion) {
  console.error("FATAL: package.json is missing productVersion field");
  process.exit(2);
}
const sot = rootPkg.productVersion;
const parts = parseProductVersion(sot);
const xyz = `${parts.major}.${parts.minor}.${parts.patch}`;
const expectedDesktop = `${xyz}-alpha.${parts.build}`;

console.log(`Source of truth: package.json.productVersion = ${sot}`);
console.log(`Expected derivations: desktop=${expectedDesktop}, ios.short=${xyz}, ios.build=${parts.build}`);
console.log();

// 2. desktop-app-vue/package.json
const desktopPkg = JSON.parse(read("desktop-app-vue/package.json"));
if (desktopPkg.version !== expectedDesktop) {
  failures.push(
    `desktop-app-vue/package.json version = "${desktopPkg.version}", expected "${expectedDesktop}"`,
  );
} else {
  console.log(`  OK  desktop-app-vue/package.json = ${desktopPkg.version}`);
}

// 3 + 4. iOS Info.plist
const iosPlistPath = "ios-app/ChainlessChain/Resources/Info.plist";
let iosPlist;
try {
  iosPlist = read(iosPlistPath);
} catch (err) {
  failures.push(`cannot read ${iosPlistPath}: ${err.message}`);
}
if (iosPlist) {
  const shortVer = readPlistKey(iosPlist, "CFBundleShortVersionString");
  const bundleVer = readPlistKey(iosPlist, "CFBundleVersion");
  if (shortVer !== xyz) {
    failures.push(
      `${iosPlistPath} CFBundleShortVersionString = "${shortVer}", expected "${xyz}"`,
    );
  } else {
    console.log(`  OK  ios Info.plist CFBundleShortVersionString = ${shortVer}`);
  }
  if (bundleVer !== parts.build) {
    failures.push(
      `${iosPlistPath} CFBundleVersion = "${bundleVer}", expected "${parts.build}"`,
    );
  } else {
    console.log(`  OK  ios Info.plist CFBundleVersion = ${bundleVer}`);
  }
}

// Reporting-only: independent tracks
let cliVersion = null;
let rootVersion = null;
try {
  cliVersion = JSON.parse(read("packages/cli/package.json")).version;
} catch (err) {
  warnings.push(`could not read packages/cli/package.json: ${err.message}`);
}
rootVersion = rootPkg.version;

console.log();
console.log(`Independent tracks (informational, not enforced):`);
console.log(`  packages/cli/package.json    = ${cliVersion ?? "n/a"}`);
console.log(`  package.json (monorepo root) = ${rootVersion ?? "n/a"}`);

if (warnings.length) {
  console.log();
  console.log("Warnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (failures.length === 0) {
  console.log();
  console.log("✓ All enforced surfaces in sync with productVersion.");
  process.exit(0);
}

console.error();
console.error("✗ Version sync FAILED:");
for (const f of failures) console.error(`  ${f}`);
console.error();
console.error(
  `Fix: bump package.json.productVersion (SoT) and sync derived surfaces.`,
);
console.error(`     See docs/releases/RELEASE_GUIDE.md "Version Management".`);
process.exit(1);
