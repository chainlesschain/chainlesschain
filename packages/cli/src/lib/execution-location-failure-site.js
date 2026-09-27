// Diagnostic locations are public source labels, never target paths, stack
// text or error messages. They do not grant authority or trigger a retry.
const SOURCES = Object.freeze({
  "commands/session-location.js": "session-location",
  "harness/jsonl-session-store.js": "session-store",
  "harness/session-index.js": "session-index",
  "harness/transcript-integrity.js": "transcript-integrity",
  "lib/secure-fs.js": "private-storage",
  "lib/secure-file-identity.js": "file-identity",
  "lib/session-anti-rollback-anchor.js": "session-anchor",
  "lib/with-file-lock.js": "file-lock",
  "lib/execution-location-local-supervisor.mjs": "local-supervisor",
  "lib/execution-location-contract.js": "location-contract",
});
const LABELS = new Set(Object.values(SOURCES));
const PREFIX = "CC_EXECUTION_LOCATION_FAILURE_SITE=";
const MAX_DIAGNOSTIC_CHARS = 8192;

// PowerShell diagnostics are deliberately bounded to fixed native operation
// labels and HRESULTs; neither paths nor exception text cross the boundary.
export function readExecutionLocationStorageFailure(stderr) {
  const match = String(stderr || "")
    .slice(0, MAX_DIAGNOSTIC_CHARS)
    .match(
      /\[windows-acl:(initialize|traversal|lookup|repair-lock|repair-inspect|repair-write|verify|timeout(?:-(?:startup|initialize|traversal|lookup|repair-lock|repair-inspect|repair-write|verify))?|spawn|output)(:0x[0-9a-f]{8})?\]/u,
    );
  return match ? `${match[1]}${match[2] || ""}` : null;
}

export function executionLocationFailureSite(error) {
  const stack = String(error?.stack || "").slice(0, MAX_DIAGNOSTIC_CHARS);
  for (const frame of stack.split(/\r?\n/u).slice(1)) {
    if (!/^\s+at /u.test(frame)) continue;
    const normalized = frame.replaceAll("\\", "/");
    for (const [source, label] of Object.entries(SOURCES)) {
      const suffix = `/packages/cli/src/${source}:`;
      const index = normalized.lastIndexOf(suffix);
      if (index < 0) continue;
      const position = normalized.slice(index + suffix.length);
      const line = position.match(/^([1-9][0-9]{0,5}):[0-9]+\)?$/u)?.[1];
      if (line) return `${label}:${line}`;
    }
  }
  return null;
}

export function formatExecutionLocationFailureSite(error) {
  const site = executionLocationFailureSite(error);
  return site === null ? "" : `${PREFIX}${site}\n`;
}

export function readExecutionLocationFailureSite(stderr) {
  const text = String(stderr || "").slice(0, MAX_DIAGNOSTIC_CHARS);
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith(PREFIX)) continue;
    const match = line
      .slice(PREFIX.length)
      .match(/^([a-z-]+):([1-9][0-9]{0,5})$/u);
    if (match && LABELS.has(match[1])) return `${match[1]}:${match[2]}`;
  }
  // An uncaught supervisor exception already has a stack on stderr.
  return executionLocationFailureSite({ stack: text });
}
