/** Minimal, owner-only audit trail for security posture changes. */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { getHomeDir } from "./paths.js";
import { redactConfigObject } from "./config-redaction.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "./secure-fs.js";

export const _deps = {
  appendFileSync,
  ensurePrivateDirectory,
  ensurePrivateFile,
  now: () => new Date(),
};

export function appendSecurityAuditEvent(event, options = {}) {
  const deps = { ..._deps, ...(options.deps || {}) };
  const home = options.home || getHomeDir();
  const auditDir = options.auditDir || path.join(home, "audit");
  const auditPath =
    options.auditPath || path.join(auditDir, "security-events.jsonl");
  deps.ensurePrivateDirectory(home, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  deps.ensurePrivateDirectory(auditDir, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  const record = redactConfigObject({
    ...(options.details || {}),
    // Reserved audit identity fields are authoritative and cannot be replaced
    // by caller-provided details.
    version: 1,
    timestamp: deps.now().toISOString(),
    event: String(event || "unknown"),
  });
  // Preflight an existing destination before appendFileSync can follow it.
  // The owner-only parent DACL/mode then closes the create-vs-symlink race to
  // other users; the post-write check verifies the newly created file too.
  deps.ensurePrivateFile(auditPath, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  deps.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: PRIVATE_FILE_MODE,
  });
  deps.ensurePrivateFile(auditPath, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  return { path: auditPath, record };
}
