import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";
import {
  validateRecordedSkillDraft,
  validateRecordedSkillReplayReport,
  validateReviewedRecordedSkill,
} from "./skill-recorder.js";
import { createRecordedSkillNetworkPolicy } from "./browser-target-policy.js";

const STORE_SCHEMA = "chainlesschain.recorded-skill-store/v1";
const ENTRY_SCHEMA = "chainlesschain.recorded-skill-entry/v1";
const EXPORT_SCHEMA = "chainlesschain.recorded-skill-export/v1";
const POLICY_SCHEMA = "chainlesschain.recorded-skill-policy/v1";
const AUDIT_SCHEMA = "chainlesschain.recorded-skill-audit-event/v1";
const STORE_DIGEST_DOMAIN = "cc.record-replay.store/v1";
const ENTRY_DIGEST_DOMAIN = "cc.record-replay.store-entry/v1";
const EXPORT_DIGEST_DOMAIN = "cc.record-replay.export/v1";
const AUDIT_DIGEST_DOMAIN = "cc.record-replay.audit-event/v1";
const MAX_STORE_BYTES = 32 * 1024 * 1024;
const STATES = new Set([
  "draft",
  "approved",
  "validated",
  "enabled",
  "revoked",
]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const DEFAULT_RECORDED_SKILL_POLICY = Object.freeze({
  schema: POLICY_SCHEMA,
  retentionDays: 90,
  maxRecords: 500,
  maxActions: 256,
  maxAuditEvents: 20_000,
  allowedCapabilities: Object.freeze(["ui.interact", "ui.observe"]),
  allowGlobalInstall: true,
});

function storeError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RecordedSkillStoreError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertObject(value, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw storeError(code, `${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, keys, code, label) {
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw storeError(code, `${label} contains unsupported fields`);
  }
}

function assertName(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(name)) {
    throw storeError(
      "CC_RECORD_STORE_ARGUMENT_INVALID",
      "recorded skill name is invalid",
    );
  }
  return name;
}

function assertTimestamp(value, label) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text)) {
    throw storeError("CC_RECORD_STORE_CORRUPT", `${label} is invalid`);
  }
  return text;
}

function assertRevision(value, label = "revision") {
  if (!Number.isInteger(value) || value < 1) {
    throw storeError("CC_RECORD_STORE_CORRUPT", `${label} is invalid`);
  }
  return value;
}

function normalizePolicy(value) {
  assertObject(value, "CC_RECORD_POLICY_INVALID", "recorded skill policy");
  assertExactKeys(
    value,
    new Set([
      "schema",
      "retentionDays",
      "maxRecords",
      "maxActions",
      "maxAuditEvents",
      "allowedCapabilities",
      "allowGlobalInstall",
    ]),
    "CC_RECORD_POLICY_INVALID",
    "recorded skill policy",
  );
  const policy = {
    schema: POLICY_SCHEMA,
    retentionDays: Number(value.retentionDays),
    maxRecords: Number(value.maxRecords),
    maxActions: Number(value.maxActions),
    maxAuditEvents: Number(value.maxAuditEvents),
    allowedCapabilities: [...new Set(value.allowedCapabilities || [])].sort(),
    allowGlobalInstall: value.allowGlobalInstall === true,
  };
  if (
    value.schema !== POLICY_SCHEMA ||
    !Number.isInteger(policy.retentionDays) ||
    policy.retentionDays < 1 ||
    policy.retentionDays > 3_650 ||
    !Number.isInteger(policy.maxRecords) ||
    policy.maxRecords < 1 ||
    policy.maxRecords > 10_000 ||
    !Number.isInteger(policy.maxActions) ||
    policy.maxActions < 1 ||
    policy.maxActions > 256 ||
    !Number.isInteger(policy.maxAuditEvents) ||
    policy.maxAuditEvents < 100 ||
    policy.maxAuditEvents > 100_000 ||
    policy.allowedCapabilities.length < 1 ||
    policy.allowedCapabilities.some(
      (capability) => !["ui.interact", "ui.observe"].includes(capability),
    )
  ) {
    throw storeError(
      "CC_RECORD_POLICY_INVALID",
      "recorded skill policy is invalid",
    );
  }
  return deepFreeze(policy);
}

function normalizeSource(value) {
  assertObject(value, "CC_RECORD_STORE_CORRUPT", "recording source");
  assertExactKeys(
    value,
    new Set(["adapter", "targetDigest", "browserVersion"]),
    "CC_RECORD_STORE_CORRUPT",
    "recording source",
  );
  if (
    !["self-contained-html", "url-origin"].includes(value.adapter) ||
    !SHA256_PATTERN.test(String(value.targetDigest || ""))
  ) {
    throw storeError("CC_RECORD_STORE_CORRUPT", "recording source is invalid");
  }
  return {
    adapter: value.adapter,
    targetDigest: value.targetDigest,
    browserVersion: String(value.browserVersion || "unknown").slice(0, 128),
  };
}

function assertBrowserSourceBinding(
  skill,
  source,
  code = "CC_RECORD_STORE_CORRUPT",
) {
  const requirements = skill.environment.requirements;
  const policy = requirements.networkPolicy;
  let normalizedPolicy;
  try {
    normalizedPolicy = createRecordedSkillNetworkPolicy({
      mode: policy?.mode,
      allowedOrigins: policy?.allowedOrigins || [],
    });
  } catch {
    normalizedPolicy = null;
  }
  const storageStateDigest = requirements.storageStateDigest;
  const bindingValid =
    requirements.adapter === source.adapter &&
    requirements.targetDigest === source.targetDigest &&
    requirements.browser === "chromium" &&
    requirements.selectorContract === "record-replay-dom-v1" &&
    /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(
      String(requirements.identity || ""),
    ) &&
    (storageStateDigest == null ||
      SHA256_PATTERN.test(String(storageStateDigest))) &&
    normalizedPolicy?.digest === policy?.digest &&
    ((source.adapter === "self-contained-html" &&
      normalizedPolicy?.mode === "deny" &&
      storageStateDigest == null) ||
      (source.adapter === "url-origin" &&
        normalizedPolicy?.mode === "allowlist"));
  if (!bindingValid) {
    throw storeError(
      code,
      "recording source does not match its browser environment binding",
    );
  }
}

function normalizeLastReplay(value, skill) {
  if (value == null) return null;
  assertObject(value, "CC_RECORD_STORE_CORRUPT", "last replay");
  assertExactKeys(
    value,
    new Set(["report", "targetDigest", "browserVersion", "durationMs", "at"]),
    "CC_RECORD_STORE_CORRUPT",
    "last replay",
  );
  const report = validateRecordedSkillReplayReport(value.report, { skill });
  if (!SHA256_PATTERN.test(String(value.targetDigest || ""))) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "last replay target digest is invalid",
    );
  }
  const durationMs = Number(value.durationMs);
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > 86_400_000
  ) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "last replay duration is invalid",
    );
  }
  return {
    report,
    targetDigest: value.targetDigest,
    browserVersion: String(value.browserVersion || "unknown").slice(0, 128),
    durationMs,
    at: assertTimestamp(value.at, "last replay timestamp"),
  };
}

function normalizeInstallation(value) {
  if (value == null) return null;
  assertObject(value, "CC_RECORD_STORE_CORRUPT", "recorded skill installation");
  assertExactKeys(
    value,
    new Set(["scope", "packageDigest", "installedAt"]),
    "CC_RECORD_STORE_CORRUPT",
    "recorded skill installation",
  );
  if (
    !["project", "global"].includes(value.scope) ||
    !SHA256_PATTERN.test(String(value.packageDigest || ""))
  ) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill installation is invalid",
    );
  }
  return {
    scope: value.scope,
    packageDigest: value.packageDigest,
    installedAt: assertTimestamp(value.installedAt, "installation timestamp"),
  };
}

function entryBody(value) {
  return {
    schema: ENTRY_SCHEMA,
    name: value.name,
    revision: value.revision,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    source: value.source,
    skill: value.skill,
    lastReplay: value.lastReplay,
    installation: value.installation,
  };
}

function normalizeEntry(value) {
  assertObject(value, "CC_RECORD_STORE_CORRUPT", "recorded skill entry");
  assertExactKeys(
    value,
    new Set([
      "schema",
      "name",
      "revision",
      "state",
      "createdAt",
      "updatedAt",
      "expiresAt",
      "source",
      "skill",
      "lastReplay",
      "installation",
      "entryDigest",
    ]),
    "CC_RECORD_STORE_CORRUPT",
    "recorded skill entry",
  );
  const name = assertName(value.name);
  const state = String(value.state || "");
  if (value.schema !== ENTRY_SCHEMA || !STATES.has(state)) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill entry schema or state is invalid",
    );
  }
  const skill =
    state === "draft"
      ? validateRecordedSkillDraft(value.skill)
      : validateReviewedRecordedSkill(value.skill);
  if (skill.name !== name) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill entry name does not match its skill",
    );
  }
  const source = normalizeSource(value.source);
  assertBrowserSourceBinding(skill, source);
  const body = {
    schema: ENTRY_SCHEMA,
    name,
    revision: assertRevision(value.revision),
    state,
    createdAt: assertTimestamp(value.createdAt, "creation timestamp"),
    updatedAt: assertTimestamp(value.updatedAt, "update timestamp"),
    expiresAt: assertTimestamp(value.expiresAt, "expiry timestamp"),
    source,
    skill,
    lastReplay: normalizeLastReplay(value.lastReplay, skill),
    installation: normalizeInstallation(value.installation),
  };
  if (["validated", "enabled", "revoked"].includes(state) && !body.lastReplay) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "validated recorded skill is missing replay evidence",
    );
  }
  if (
    body.lastReplay &&
    body.lastReplay.targetDigest !== body.source.targetDigest
  ) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill replay target does not match its source",
    );
  }
  if (state === "enabled" && !body.installation) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "enabled recorded skill is missing installation evidence",
    );
  }
  if (state !== "enabled" && body.installation) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "inactive recorded skill retains active installation state",
    );
  }
  const expectedDigest = digest(body, ENTRY_DIGEST_DOMAIN);
  if (value.entryDigest !== expectedDigest) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill entry digest is invalid",
    );
  }
  return deepFreeze({ ...clone(body), entryDigest: expectedDigest });
}

function sealEntry(value) {
  const body = entryBody(value);
  return normalizeEntry({
    ...clone(body),
    entryDigest: digest(body, ENTRY_DIGEST_DOMAIN),
  });
}

function auditBody(value) {
  return {
    schema: AUDIT_SCHEMA,
    sequence: value.sequence,
    eventId: value.eventId,
    at: value.at,
    action: value.action,
    name: value.name,
    revision: value.revision,
    state: value.state,
    actor: value.actor,
    entryDigest: value.entryDigest,
    previousDigest: value.previousDigest,
  };
}

function normalizeAudit(events) {
  if (!Array.isArray(events)) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill audit log is invalid",
    );
  }
  let previousDigest = null;
  return events.map((value, index) => {
    assertObject(
      value,
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill audit event",
    );
    assertExactKeys(
      value,
      new Set([
        "schema",
        "sequence",
        "eventId",
        "at",
        "action",
        "name",
        "revision",
        "state",
        "actor",
        "entryDigest",
        "previousDigest",
        "eventDigest",
      ]),
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill audit event",
    );
    const body = auditBody({
      schema: value.schema,
      sequence: value.sequence,
      eventId: value.eventId,
      at: value.at,
      action: value.action,
      name: value.name,
      revision: value.revision,
      state: value.state,
      actor: value.actor,
      entryDigest: value.entryDigest,
      previousDigest: value.previousDigest,
    });
    if (
      value.schema !== AUDIT_SCHEMA ||
      value.sequence !== index + 1 ||
      !/^[a-f0-9-]{36}$/u.test(String(value.eventId || "")) ||
      !/^[a-z][a-z0-9_-]{1,63}$/u.test(String(value.action || "")) ||
      value.name !== assertName(value.name) ||
      !Number.isInteger(value.revision) ||
      value.revision < 0 ||
      ![...STATES, "deleted", "policy"].includes(value.state) ||
      typeof value.actor !== "string" ||
      value.actor.length < 1 ||
      value.actor.length > 128 ||
      (value.entryDigest !== null &&
        !SHA256_PATTERN.test(String(value.entryDigest))) ||
      value.previousDigest !== previousDigest ||
      value.eventDigest !== digest(body, AUDIT_DIGEST_DOMAIN)
    ) {
      throw storeError(
        "CC_RECORD_STORE_CORRUPT",
        "recorded skill audit chain is invalid",
      );
    }
    assertTimestamp(value.at, "audit timestamp");
    previousDigest = value.eventDigest;
    return deepFreeze({ ...body, eventDigest: value.eventDigest });
  });
}

function storeBody(value) {
  return {
    schema: STORE_SCHEMA,
    revision: value.revision,
    policy: value.policy,
    records: value.records,
    audit: value.audit,
  };
}

function normalizeStore(value) {
  assertObject(value, "CC_RECORD_STORE_CORRUPT", "recorded skill store");
  assertExactKeys(
    value,
    new Set([
      "schema",
      "revision",
      "policy",
      "records",
      "audit",
      "storeDigest",
    ]),
    "CC_RECORD_STORE_CORRUPT",
    "recorded skill store",
  );
  if (
    value.schema !== STORE_SCHEMA ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  ) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill store schema or revision is invalid",
    );
  }
  const policy = normalizePolicy(value.policy);
  assertObject(
    value.records,
    "CC_RECORD_STORE_CORRUPT",
    "recorded skill records",
  );
  const records = Object.fromEntries(
    Object.entries(value.records).map(([name, entry]) => {
      if (name !== assertName(name)) {
        throw storeError(
          "CC_RECORD_STORE_CORRUPT",
          "recorded skill record key is invalid",
        );
      }
      const normalized = normalizeEntry(entry);
      if (normalized.name !== name) {
        throw storeError(
          "CC_RECORD_STORE_CORRUPT",
          "recorded skill record key does not match entry",
        );
      }
      return [name, normalized];
    }),
  );
  if (
    Object.keys(records).length > policy.maxRecords ||
    Object.values(records).some(
      (entry) => entry.skill.actions.length > policy.maxActions,
    )
  ) {
    throw storeError(
      "CC_RECORD_POLICY_DENIED",
      "recorded skill store exceeds current policy",
    );
  }
  const audit = normalizeAudit(value.audit);
  if (audit.length > policy.maxAuditEvents) {
    throw storeError(
      "CC_RECORD_POLICY_DENIED",
      "recorded skill audit log exceeds current policy",
    );
  }
  const body = {
    schema: STORE_SCHEMA,
    revision: value.revision,
    policy,
    records,
    audit,
  };
  if (value.storeDigest !== digest(body, STORE_DIGEST_DOMAIN)) {
    throw storeError(
      "CC_RECORD_STORE_CORRUPT",
      "recorded skill store digest is invalid",
    );
  }
  return deepFreeze({ ...clone(body), storeDigest: value.storeDigest });
}

function emptyStore() {
  const body = {
    schema: STORE_SCHEMA,
    revision: 0,
    policy: DEFAULT_RECORDED_SKILL_POLICY,
    records: {},
    audit: [],
  };
  return normalizeStore({
    ...clone(body),
    storeDigest: digest(body, STORE_DIGEST_DOMAIN),
  });
}

function appendAudit(document, { action, entry, name, actor, at, state }) {
  if (document.audit.length >= document.policy.maxAuditEvents) {
    throw storeError(
      "CC_RECORD_POLICY_DENIED",
      "recorded skill audit event limit reached",
    );
  }
  const previousDigest = document.audit.at(-1)?.eventDigest || null;
  const body = {
    schema: AUDIT_SCHEMA,
    sequence: document.audit.length + 1,
    eventId: randomUUID(),
    at,
    action,
    name: assertName(name),
    revision: entry?.revision || 0,
    state: state || entry?.state || "deleted",
    actor: String(actor || "cli").slice(0, 128),
    entryDigest: entry?.entryDigest || null,
    previousDigest,
  };
  document.audit.push({
    ...body,
    eventDigest: digest(body, AUDIT_DIGEST_DOMAIN),
  });
}

function summary(entry) {
  return deepFreeze({
    name: entry.name,
    revision: entry.revision,
    state: entry.state,
    description: entry.skill.description,
    actionCount: entry.skill.actions.length,
    parameterCount: entry.skill.parameters.length,
    capabilities: clone(entry.skill.capabilityManifest),
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
    entryDigest: entry.entryDigest,
  });
}

export class RecordedSkillStore {
  constructor({
    rootDir = join(getHomeDir(), "record-replay"),
    now = () => new Date(),
    secure = true,
  } = {}) {
    this.rootDir = resolve(rootDir);
    this.filePath = join(this.rootDir, "state.json");
    this._now = now;
    this._secure = secure !== false;
    if (this._secure) {
      ensurePrivateDirectory(this.rootDir, { failIfUnavailable: true });
    } else {
      mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    }
  }

  _read() {
    if (!existsSync(this.filePath)) return emptyStore();
    const entry = lstatSync(this.filePath);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.size > MAX_STORE_BYTES
    ) {
      throw storeError(
        "CC_RECORD_STORE_CORRUPT",
        "recorded skill store file is unsafe",
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      throw storeError(
        "CC_RECORD_STORE_CORRUPT",
        "recorded skill store is not valid JSON",
      );
    }
    return normalizeStore(parsed);
  }

  _write(value) {
    const normalized = normalizeStore(value);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw storeError(
        "CC_RECORD_POLICY_DENIED",
        "recorded skill store size limit exceeded",
      );
    }
    const temporary = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    const handle = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(handle, serialized, "utf8");
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    try {
      renameSync(temporary, this.filePath);
      if (this._secure)
        ensurePrivateFile(this.filePath, { failIfUnavailable: true });
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    return normalized;
  }

  _transaction(mutator) {
    return withFileLock(
      this.filePath,
      () => {
        const current = this._read();
        const mutable = clone(current);
        delete mutable.storeDigest;
        const result = mutator(mutable);
        mutable.revision = current.revision + 1;
        const body = storeBody(mutable);
        const next = this._write({
          ...body,
          storeDigest: digest(body, STORE_DIGEST_DOMAIN),
        });
        return { result, store: next };
      },
      { failIfUnavailable: true, timeoutMs: 5_000 },
    );
  }

  get(name) {
    const entry = this._read().records[assertName(name)];
    if (!entry)
      throw storeError("CC_RECORD_NOT_FOUND", "recorded skill was not found");
    return entry;
  }

  list() {
    return Object.values(this._read().records)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(summary);
  }

  policy() {
    return this._read().policy;
  }

  setPolicy(policy, { actor = "cli" } = {}) {
    const normalizedPolicy = normalizePolicy(policy);
    return this._transaction((document) => {
      if (
        Object.keys(document.records).length > normalizedPolicy.maxRecords ||
        Object.values(document.records).some(
          (entry) => entry.skill.actions.length > normalizedPolicy.maxActions,
        ) ||
        document.audit.length + 1 > normalizedPolicy.maxAuditEvents
      ) {
        throw storeError(
          "CC_RECORD_POLICY_DENIED",
          "new policy is narrower than current retained data",
        );
      }
      document.policy = clone(normalizedPolicy);
      const at = this._now().toISOString();
      appendAudit(document, {
        action: "policy_updated",
        entry: null,
        name: "policy",
        actor,
        at,
        state: "policy",
      });
      return normalizedPolicy;
    }).result;
  }

  create({ draft, source, actor = "cli" }) {
    const skill = validateRecordedSkillDraft(draft);
    const normalizedSource = normalizeSource(source);
    assertBrowserSourceBinding(
      skill,
      normalizedSource,
      "CC_RECORD_SOURCE_MISMATCH",
    );
    return this._transaction((document) => {
      if (document.records[skill.name]) {
        throw storeError(
          "CC_RECORD_ALREADY_EXISTS",
          "recorded skill already exists",
        );
      }
      if (Object.keys(document.records).length >= document.policy.maxRecords) {
        throw storeError(
          "CC_RECORD_POLICY_DENIED",
          "recorded skill record limit reached",
        );
      }
      if (
        skill.actions.length > document.policy.maxActions ||
        skill.capabilityManifest.some(
          (capability) =>
            !document.policy.allowedCapabilities.includes(capability),
        )
      ) {
        throw storeError(
          "CC_RECORD_POLICY_DENIED",
          "recorded skill is outside policy",
        );
      }
      const at = this._now().toISOString();
      const entry = sealEntry({
        schema: ENTRY_SCHEMA,
        name: skill.name,
        revision: 1,
        state: "draft",
        createdAt: at,
        updatedAt: at,
        expiresAt: new Date(
          this._now().getTime() + document.policy.retentionDays * 86_400_000,
        ).toISOString(),
        source: normalizedSource,
        skill,
        lastReplay: null,
        installation: null,
      });
      document.records[entry.name] = clone(entry);
      appendAudit(document, {
        action: "created",
        entry,
        name: entry.name,
        actor,
        at,
      });
      return entry;
    }).result;
  }

  _update(name, expectedRevision, actor, action, update) {
    const safeName = assertName(name);
    return this._transaction((document) => {
      const current = document.records[safeName];
      if (!current)
        throw storeError("CC_RECORD_NOT_FOUND", "recorded skill was not found");
      if (current.revision !== Number(expectedRevision)) {
        throw storeError(
          "CC_RECORD_REVISION_CONFLICT",
          "recorded skill revision changed",
          {
            expectedRevision: Number(expectedRevision),
            actualRevision: current.revision,
          },
        );
      }
      const at = this._now().toISOString();
      const next = sealEntry({
        ...clone(current),
        ...update(normalizeEntry(current), document.policy, at),
        revision: current.revision + 1,
        updatedAt: at,
      });
      document.records[safeName] = clone(next);
      appendAudit(document, { action, entry: next, name: safeName, actor, at });
      return next;
    }).result;
  }

  approve({ name, expectedRevision, skill, actor }) {
    const approved = validateReviewedRecordedSkill(skill);
    return this._update(
      name,
      expectedRevision,
      actor,
      "approved",
      (current) => {
        if (
          current.state !== "draft" ||
          current.skill.draftDigest !== approved.draftDigest
        ) {
          throw storeError(
            "CC_RECORD_STATE_CONFLICT",
            "approval does not match the current draft",
          );
        }
        return {
          state: "approved",
          skill: approved,
          lastReplay: null,
          installation: null,
        };
      },
    );
  }

  recordReplay({
    name,
    expectedRevision,
    report,
    targetDigest,
    browserVersion,
    durationMs,
    actor = "cli",
  }) {
    return this._update(
      name,
      expectedRevision,
      actor,
      "replayed",
      (current, _policy, at) => {
        if (
          !["approved", "validated", "enabled", "revoked"].includes(
            current.state,
          )
        ) {
          throw storeError(
            "CC_RECORD_STATE_CONFLICT",
            "recorded skill must be approved before replay evidence is stored",
          );
        }
        const verifiedReport = validateRecordedSkillReplayReport(report, {
          skill: current.skill,
        });
        if (targetDigest !== current.source.targetDigest) {
          throw storeError(
            "CC_RECORD_TARGET_DRIFT",
            "replay target does not match the recording",
          );
        }
        return {
          state: current.state === "enabled" ? "enabled" : "validated",
          lastReplay: {
            report: verifiedReport,
            targetDigest,
            browserVersion: String(browserVersion || "unknown").slice(0, 128),
            durationMs: Number(durationMs),
            at,
          },
          installation:
            current.state === "enabled" ? current.installation : null,
        };
      },
    );
  }

  enable({ name, expectedRevision, scope, packageDigest, actor = "cli" }) {
    return this._update(
      name,
      expectedRevision,
      actor,
      "enabled",
      (current, policy, at) => {
        if (current.state !== "validated") {
          throw storeError(
            "CC_RECORD_STATE_CONFLICT",
            "recorded skill must pass replay before enablement",
          );
        }
        if (scope === "global" && !policy.allowGlobalInstall) {
          throw storeError(
            "CC_RECORD_POLICY_DENIED",
            "global recorded skill installation is denied by policy",
          );
        }
        return {
          state: "enabled",
          installation: { scope, packageDigest, installedAt: at },
        };
      },
    );
  }

  revoke({ name, expectedRevision, actor = "cli" }) {
    return this._update(name, expectedRevision, actor, "revoked", (current) => {
      if (current.state !== "enabled") {
        throw storeError(
          "CC_RECORD_STATE_CONFLICT",
          "recorded skill is not enabled",
        );
      }
      return { state: "revoked", installation: null };
    });
  }

  delete({ name, expectedRevision, actor = "cli" }) {
    const safeName = assertName(name);
    return this._transaction((document) => {
      const current = document.records[safeName];
      if (!current)
        throw storeError("CC_RECORD_NOT_FOUND", "recorded skill was not found");
      if (current.revision !== Number(expectedRevision)) {
        throw storeError(
          "CC_RECORD_REVISION_CONFLICT",
          "recorded skill revision changed",
        );
      }
      if (current.state === "enabled") {
        throw storeError(
          "CC_RECORD_STATE_CONFLICT",
          "revoke the recorded skill before deleting it",
        );
      }
      delete document.records[safeName];
      appendAudit(document, {
        action: "deleted",
        entry: null,
        name: safeName,
        actor,
        at: this._now().toISOString(),
      });
      return summary(current);
    }).result;
  }

  export(name, { actor = "cli" } = {}) {
    const safeName = assertName(name);
    return this._transaction((document) => {
      const entry = document.records[safeName];
      if (!entry)
        throw storeError("CC_RECORD_NOT_FOUND", "recorded skill was not found");
      const at = this._now().toISOString();
      const body = {
        schema: EXPORT_SCHEMA,
        exportedAt: at,
        entry: normalizeEntry(entry),
      };
      appendAudit(document, {
        action: "exported",
        entry,
        name: safeName,
        actor,
        at,
      });
      return deepFreeze({
        ...clone(body),
        exportDigest: digest(body, EXPORT_DIGEST_DOMAIN),
      });
    }).result;
  }

  import(value, { actor = "cli" } = {}) {
    assertObject(value, "CC_RECORD_IMPORT_INVALID", "recorded skill export");
    assertExactKeys(
      value,
      new Set(["schema", "exportedAt", "entry", "exportDigest"]),
      "CC_RECORD_IMPORT_INVALID",
      "recorded skill export",
    );
    const body = {
      schema: value.schema,
      exportedAt: assertTimestamp(value.exportedAt, "export timestamp"),
      entry: normalizeEntry(value.entry),
    };
    if (
      value.schema !== EXPORT_SCHEMA ||
      value.exportDigest !== digest(body, EXPORT_DIGEST_DOMAIN)
    ) {
      throw storeError(
        "CC_RECORD_IMPORT_INVALID",
        "recorded skill export digest is invalid",
      );
    }
    const imported = body.entry;
    const importedState = imported.lastReplay
      ? "validated"
      : imported.state === "draft"
        ? "draft"
        : "approved";
    const skill =
      importedState === "draft"
        ? validateRecordedSkillDraft(imported.skill)
        : validateReviewedRecordedSkill(imported.skill);
    return this._transaction((document) => {
      if (document.records[imported.name]) {
        throw storeError(
          "CC_RECORD_ALREADY_EXISTS",
          "recorded skill already exists",
        );
      }
      if (Object.keys(document.records).length >= document.policy.maxRecords) {
        throw storeError(
          "CC_RECORD_POLICY_DENIED",
          "recorded skill record limit reached",
        );
      }
      const at = this._now().toISOString();
      const entry = sealEntry({
        ...clone(imported),
        revision: 1,
        state: importedState,
        createdAt: at,
        updatedAt: at,
        expiresAt: new Date(
          this._now().getTime() + document.policy.retentionDays * 86_400_000,
        ).toISOString(),
        skill,
        installation: null,
      });
      document.records[entry.name] = clone(entry);
      appendAudit(document, {
        action: "imported",
        entry,
        name: entry.name,
        actor,
        at,
      });
      return entry;
    }).result;
  }

  audit({ name } = {}) {
    const safeName = name == null ? null : assertName(name);
    return this._read().audit.filter(
      (event) => !safeName || event.name === safeName,
    );
  }

  pruneExpired({ actor = "cli" } = {}) {
    const now = this._now();
    return this._transaction((document) => {
      const removed = [];
      for (const [name, entry] of Object.entries(document.records)) {
        if (
          entry.state === "enabled" ||
          Date.parse(entry.expiresAt) > now.getTime()
        )
          continue;
        delete document.records[name];
        removed.push(name);
        appendAudit(document, {
          action: "retention_pruned",
          entry: null,
          name,
          actor,
          at: now.toISOString(),
        });
      }
      return deepFreeze(removed.sort());
    }).result;
  }
}

export function recordedSkillStoreSchemas() {
  return Object.freeze({
    store: STORE_SCHEMA,
    entry: ENTRY_SCHEMA,
    export: EXPORT_SCHEMA,
    policy: POLICY_SCHEMA,
    audit: AUDIT_SCHEMA,
  });
}
