/**
 * Durable consent for workspace-local MCP headers helpers.
 *
 * A local MCP row is visible by path, but path visibility alone must never
 * authorize command execution. Consent is bound to the canonical workspace,
 * server identity, endpoint, transport, and exact helper command. Any change
 * invalidates the grant and fails closed until the user records it again.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";

const STORE_LABEL = "local MCP headersHelper trust";

export const _deps = { withFileLock };

function trustError(message) {
  const error = new Error(message);
  error.code = "CC_MCP_HEADERS_HELPER_TRUST_INVALID";
  return error;
}

function storePath(opts = {}) {
  return (
    opts.storePath ||
    process.env.CC_LOCAL_MCP_HEADERS_HELPER_TRUST_STORE ||
    path.join(getHomeDir(), "trusted-local-mcp-headers-helpers.json")
  );
}

function canonicalWorkspaceRoot(value, opts = {}) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw trustError("Local MCP headersHelper trust requires a workspace root");
  }
  const realpath = opts.realpath || fs.realpathSync.native;
  try {
    return realpath(path.resolve(value));
  } catch {
    throw trustError(
      "Local MCP headersHelper trust requires an available workspace root",
    );
  }
}

function normalizedSpec(spec = {}, opts = {}) {
  const workspaceRoot = canonicalWorkspaceRoot(spec.workspaceRoot, opts);
  const serverName =
    typeof spec.serverName === "string" ? spec.serverName : "";
  const headersHelper =
    typeof spec.headersHelper === "string" && spec.headersHelper.trim()
      ? spec.headersHelper
      : "";
  if (!serverName.trim() || !headersHelper) {
    throw trustError(
      "Local MCP headersHelper trust requires a server name and command",
    );
  }
  return {
    workspaceRoot,
    serverName,
    url: typeof spec.url === "string" ? spec.url : "",
    transport: typeof spec.transport === "string" ? spec.transport : "",
    headersHelper,
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function recordKey(spec) {
  return sha256(`${spec.workspaceRoot}\0${spec.serverName}`);
}

export function localMcpHeadersHelperFingerprint(spec, opts = {}) {
  const normalized = normalizedSpec(spec, opts);
  return sha256(
    JSON.stringify({
      workspaceRoot: normalized.workspaceRoot,
      serverName: normalized.serverName,
      url: normalized.url,
      transport: normalized.transport,
      headersHelper: normalized.headersHelper,
    }),
  );
}

/** @returns {{status:"first-use"|"trusted"|"changed", fingerprint:string}} */
export function checkLocalMcpHeadersHelperTrust(spec, opts = {}) {
  const normalized = normalizedSpec(spec, opts);
  const fingerprint = localMcpHeadersHelperFingerprint(normalized, opts);
  const record = readSecurityStore(storePath(opts), STORE_LABEL)[
    recordKey(normalized)
  ];
  if (!record?.fingerprint) return { status: "first-use", fingerprint };
  return {
    status: record.fingerprint === fingerprint ? "trusted" : "changed",
    fingerprint,
  };
}

export function recordLocalMcpHeadersHelperTrust(spec, opts = {}) {
  const normalized = normalizedSpec(spec, opts);
  const fingerprint = localMcpHeadersHelperFingerprint(normalized, opts);
  const target = storePath(opts);
  return mutateSecurityStore(
    target,
    STORE_LABEL,
    (store) => {
      store[recordKey(normalized)] = {
        workspaceRoot: normalized.workspaceRoot,
        serverName: normalized.serverName,
        fingerprint,
        trustedAt: new Date(
          typeof opts.now === "number" ? opts.now : Date.now(),
        ).toISOString(),
      };
      return true;
    },
    { lock: _deps.withFileLock },
  );
}

export function revokeLocalMcpHeadersHelperTrust(spec, opts = {}) {
  const normalized = normalizedSpec(spec, opts);
  const target = storePath(opts);
  return mutateSecurityStore(
    target,
    STORE_LABEL,
    (store) => delete store[recordKey(normalized)],
    { lock: _deps.withFileLock },
  );
}
