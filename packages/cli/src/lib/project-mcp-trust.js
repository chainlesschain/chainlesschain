/**
 * Project `.mcp.json` fingerprint trust (gap-analysis 2026-07-11 P1 "MCP 生命
 * 周期" — 配置指纹变化后重新信任).
 *
 * `--project-mcp` opts a run into a checked-in `.mcp.json`, which can spawn
 * arbitrary commands. That consent is for the file AS THE USER SAW IT — a
 * later commit (or a compromised dependency's postinstall) editing the file
 * must not ride the standing opt-in. So the first successful load records a
 * sha256 fingerprint per absolute file path; a later load whose content no
 * longer matches is REFUSED (fail-closed) until the user re-trusts via
 * `CC_PROJECT_MCP_TRUST=1` (one-shot) or `cc mcp trust-project`.
 *
 * Store: ~/.chainlesschain/trusted-project-mcp.json  { [absPath]: {fingerprint, trustedAt} }
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "./paths.js";

export const _deps = { fs };

function storePath(opts = {}) {
  return (
    opts.storePath ||
    process.env.CC_PROJECT_MCP_TRUST_STORE ||
    path.join(getHomeDir(), "trusted-project-mcp.json")
  );
}

export function projectMcpFingerprint(content) {
  return createHash("sha256").update(String(content), "utf-8").digest("hex");
}

function readStore(opts) {
  try {
    const raw = _deps.fs.readFileSync(storePath(opts), "utf-8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/**
 * Check a project .mcp.json against the trust store.
 * @returns {{status:"first-use"|"trusted"|"changed", fingerprint:string}}
 */
export function checkProjectMcpTrust(file, content, opts = {}) {
  const fingerprint = projectMcpFingerprint(content);
  const record = readStore(opts)[path.resolve(file)];
  if (!record || !record.fingerprint) {
    return { status: "first-use", fingerprint };
  }
  return {
    status: record.fingerprint === fingerprint ? "trusted" : "changed",
    fingerprint,
  };
}

/** Record (or re-record) the trusted fingerprint for a file. */
export function recordProjectMcpTrust(file, content, opts = {}) {
  const target = storePath(opts);
  const store = readStore(opts);
  store[path.resolve(file)] = {
    fingerprint: projectMcpFingerprint(content),
    trustedAt: new Date(
      typeof opts.now === "number" ? opts.now : Date.now(),
    ).toISOString(),
  };
  try {
    _deps.fs.mkdirSync(path.dirname(target), { recursive: true });
    _deps.fs.writeFileSync(target, JSON.stringify(store, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    return true;
  } catch {
    return false; // best-effort — a failed record just re-prompts next run
  }
}

/** Truthy CC_PROJECT_MCP_TRUST → the user explicitly re-trusts this run. */
export function projectMcpRetrustRequested(env = process.env) {
  const raw = String(env.CC_PROJECT_MCP_TRUST || "").toLowerCase();
  return raw === "1" || raw === "true";
}
