#!/usr/bin/env node
/**
 * Custom npm audit checker that allows exceptions for known unfixable vulnerabilities
 *
 * Usage: node scripts/audit-check.js [--omit=dev] [--audit-level=critical]
 */

const { execSync } = require("child_process");

// Known unfixable vulnerabilities (no upstream fix available)
// Update this list as fixes become available
const KNOWN_UNFIXABLE = [
  // parse-url - via stun, used for WebRTC NAT traversal
  // Multiple vulnerabilities with no fix in stun@2.1.0 (latest)
  "GHSA-q6wq-5p59-983w", // XSS in parse-url
  "GHSA-7f3x-x4pr-wqhj", // ReDoS in parse-url
  "GHSA-jpp7-7chh-cf67", // XSS in parse-url
  "GHSA-4p35-cfcx-8653", // Bypass in parse-url
  "GHSA-pqw5-jmp5-px4v", // SSRF in parse-url
  "GHSA-j9fq-vwqv-2fm2", // Bypass in parse-url
];

// Packages with known unfixable transitive vulnerabilities
const KNOWN_UNFIXABLE_PACKAGES = [
  "parse-url", // stun depends on this, no fix available
];

// Parse command line args
const args = process.argv.slice(2);
const omitDev = args.includes("--omit=dev");
const auditLevel =
  args.find((a) => a.startsWith("--audit-level="))?.split("=")[1] || "critical";

try {
  // Run npm audit with JSON output
  const cmd = `npm audit --json ${omitDev ? "--omit=dev" : ""} --audit-level=${auditLevel}`;
  let result;

  try {
    result = execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    // npm audit exits with non-zero when vulnerabilities found
    result = e.stdout || "{}";
  }

  const audit = JSON.parse(result);

  if (!audit.vulnerabilities) {
    console.log("No vulnerabilities found");
    process.exit(0);
  }

  // Filter out known unfixable vulnerabilities
  const severityLevels = ["critical", "high", "moderate", "low", "info"];
  const minLevel = severityLevels.indexOf(auditLevel);

  let hasBlockingVulns = false;
  const blocking = [];
  const skipped = [];

  for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
    const sevIndex = severityLevels.indexOf(vuln.severity);
    if (sevIndex > minLevel) continue; // Below threshold

    // Check if all via entries are in known unfixable list
    const viaIds = (vuln.via || [])
      .filter((v) => typeof v === "object")
      .map((v) => v.url?.split("/").pop());

    // Also check if via is a string (package name) that we know is unfixable
    const viaPackages = (vuln.via || []).filter((v) => typeof v === "string");

    const isKnownUnfixable =
      (viaIds.length > 0 &&
        viaIds.every((id) => KNOWN_UNFIXABLE.includes(id))) ||
      viaPackages.some((p) => KNOWN_UNFIXABLE_PACKAGES.includes(p));

    if (isKnownUnfixable) {
      skipped.push({ name, severity: vuln.severity, ids: viaIds });
    } else {
      hasBlockingVulns = true;
      blocking.push({ name, severity: vuln.severity, via: vuln.via });
    }
  }

  // Report results
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} known unfixable vulnerabilities:`);
    skipped.forEach((v) => {
      console.log(`  - ${v.name} (${v.severity}): ${v.ids.join(", ")}`);
    });
  }

  if (blocking.length > 0) {
    console.log(`\n Found ${blocking.length} blocking vulnerabilities:`);
    blocking.forEach((v) => {
      console.log(`  - ${v.name} (${v.severity})`);
    });
    process.exit(1);
  }

  console.log(
    "\n All vulnerabilities either below threshold or known unfixable",
  );
  process.exit(0);
} catch (error) {
  console.error("Audit check failed:", error.message);
  process.exit(1);
}
