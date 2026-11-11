"use strict";

const SEVERITIES = Object.freeze([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);

/** A registry/network error or incomplete response is not a clean audit. */
function parseAuditResult(text) {
  const audit = JSON.parse(text);
  const record = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const counts = audit?.metadata?.vulnerabilities;
  if (
    !record(audit) ||
    Object.hasOwn(audit, "error") ||
    !record(audit.vulnerabilities) ||
    !record(counts) ||
    ![...SEVERITIES, "total"].every(
      (key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0,
    ) ||
    Object.values(audit.vulnerabilities).some(
      (row) =>
        !record(row) ||
        !SEVERITIES.includes(row.severity) ||
        !Array.isArray(row.via),
    ) ||
    (Object.keys(audit.vulnerabilities).length === 0) !== (counts.total === 0)
  ) {
    throw new Error("npm audit did not return a complete vulnerability report");
  }
  return audit;
}

module.exports = { parseAuditResult };
