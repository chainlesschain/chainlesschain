import { createHash } from "node:crypto";
import { validateAppServerDefinition } from "./app-server/protocol.js";

export const APPROVAL_GRANTS_EVENT = "approval_grants";
export const APPROVAL_GRANTS_SCHEMA = "chainlesschain.approval-grants/v1";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function boundedScope(value) {
  const serialized = stableJson(value);
  if (serialized.length <= 1024) return serialized;
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function boundedCapability(tool) {
  const candidate = `tool:${String(tool || "unknown")}`;
  if (candidate.length <= 128) return candidate;
  return `tool:sha256:${createHash("sha256").update(candidate).digest("hex")}`;
}

export function approvalPermissionForContext(ctx = {}, { cwd = null } = {}) {
  const tool = ctx.tool || ctx.toolName || ctx.name || "unknown";
  const args =
    ctx.args ?? (ctx.command != null ? { command: ctx.command } : null);
  const policy = ctx.rule || ctx.riskLevel || ctx.risk || null;
  return Object.freeze({
    capability: boundedCapability(tool),
    scope: boundedScope({ cwd: cwd || ctx.cwd || null, args, policy }),
  });
}

function permissionKey(permission) {
  return `${permission.capability}\0${permission.scope}`;
}

function livePermission(permission, now) {
  const validation = validateAppServerDefinition("PermissionGrant", permission);
  if (!validation.ok) return false;
  return !permission.expiresAt || Date.parse(permission.expiresAt) > now;
}

function samePermission(left, right) {
  return permissionKey(left) === permissionKey(right);
}

function normalizePersistedEntry(entry, now) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (!livePermission(entry.permission, now)) return null;
  if (
    typeof entry.binding !== "string" ||
    !entry.binding ||
    typeof entry.grantedAt !== "string" ||
    Number.isNaN(Date.parse(entry.grantedAt))
  ) {
    return null;
  }
  return Object.freeze({
    permission: Object.freeze({ ...entry.permission }),
    binding: entry.binding,
    grantedAt: entry.grantedAt,
  });
}

export class ApprovalGrantLedger {
  constructor({ sessionId, now = () => Date.now() } = {}) {
    if (!sessionId) throw new TypeError("approval grant sessionId is required");
    this.sessionId = String(sessionId);
    this.now = now;
    this.turnId = null;
    this.turnGrants = new Map();
    this.sessionGrants = new Map();
    this.revision = 0;
  }

  beginTurn(turnId) {
    this.turnId = String(turnId);
    this.turnGrants.clear();
  }

  allows(permission) {
    const now = this.now();
    const key = permissionKey(permission);
    for (const grants of [this.turnGrants, this.sessionGrants]) {
      const entry = grants.get(key);
      if (!entry) continue;
      if (livePermission(entry.permission, now)) return true;
      grants.delete(key);
    }
    return false;
  }

  applyDecision(decision, requiredPermission, binding) {
    if (
      decision?.kind !== "acceptForTurn" &&
      decision?.kind !== "acceptForSession"
    ) {
      return Object.freeze({
        decision,
        granted: Object.freeze([]),
        persistedScope: false,
      });
    }
    const candidates =
      decision.permissions === undefined
        ? [requiredPermission]
        : decision.permissions;
    const target =
      decision.kind === "acceptForSession"
        ? this.sessionGrants
        : this.turnGrants;
    const granted = candidates
      .filter(
        (permission) =>
          livePermission(permission, this.now()) &&
          samePermission(permission, requiredPermission) &&
          (target.has(permissionKey(permission)) || target.size < 64),
      )
      .slice(0, 1)
      .map((permission) => Object.freeze({ ...permission }));
    const grantedAt = new Date(this.now()).toISOString();
    for (const permission of granted) {
      target.set(
        permissionKey(permission),
        Object.freeze({ permission, binding, grantedAt }),
      );
    }
    if (granted.length) this.revision += 1;
    return Object.freeze({
      decision: Object.freeze({ ...decision, permissions: granted }),
      granted: Object.freeze(granted),
      persistedScope:
        decision.kind === "acceptForSession" && granted.length > 0,
    });
  }

  toJSON() {
    return {
      schema: APPROVAL_GRANTS_SCHEMA,
      sessionId: this.sessionId,
      revision: this.revision,
      grants: [...this.sessionGrants.values()].map((entry) => ({
        permission: { ...entry.permission },
        binding: entry.binding,
        grantedAt: entry.grantedAt,
      })),
    };
  }

  static fromJSON(value, { sessionId, now = () => Date.now() } = {}) {
    const ledger = new ApprovalGrantLedger({ sessionId, now });
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.schema !== APPROVAL_GRANTS_SCHEMA ||
      value.sessionId !== ledger.sessionId ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Array.isArray(value.grants) ||
      value.grants.length > 64
    ) {
      throw new TypeError("invalid persisted approval grant ledger");
    }
    for (const candidate of value.grants) {
      const entry = normalizePersistedEntry(candidate, now());
      if (!entry) {
        throw new TypeError("invalid persisted approval grant entry");
      }
      ledger.sessionGrants.set(permissionKey(entry.permission), entry);
    }
    ledger.revision = value.revision;
    return ledger;
  }
}
