/**
 * Durable, CLI-owned cross-session message fabric.
 *
 * The fabric deliberately owns only addressing, admission, receipts and inbox
 * durability. Transports (same-host processes, Remote Control, A2A or a future
 * relay) may all call the same API, so none of them can invent a broader
 * inbound policy. Every mutation is a strict cross-process locked, atomic JSON
 * transaction and every endpoint registration has a fresh epoch; a reused
 * name can therefore never inherit an earlier session's inbox.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureDir, getHomeDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";

export const SESSION_MESSAGE_FABRIC_SCHEMA =
  "chainlesschain.session-message-fabric/v1";
export const SESSION_MESSAGE_FABRIC_PROJECTION_SCHEMA =
  "chainlesschain.session-message-fabric-projection/v1";

export const SESSION_MESSAGE_POLICIES = Object.freeze([
  "accept",
  "hold",
  "refuse",
]);

export const SESSION_MESSAGE_RECEIPT_STATUSES = Object.freeze([
  "delivered",
  "held",
  "refused",
  "full",
  "expired",
]);

export const SESSION_MESSAGE_FABRIC_LIMITS = Object.freeze({
  maxMessageBytes: 256 * 1024,
  maxPendingPerRecipient: 100,
  maxReceiptHistory: 5_000,
  defaultTtlMs: 24 * 60 * 60 * 1000,
  maxTtlMs: 7 * 24 * 60 * 60 * 1000,
});

export const SESSION_MESSAGE_FABRIC_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "SESSION_MESSAGE_INVALID_ARGUMENT",
  ENDPOINT_NOT_FOUND: "SESSION_MESSAGE_ENDPOINT_NOT_FOUND",
  NAME_CONFLICT: "SESSION_MESSAGE_NAME_CONFLICT",
  MESSAGE_TOO_LARGE: "SESSION_MESSAGE_TOO_LARGE",
  MESSAGE_ID_CONFLICT: "SESSION_MESSAGE_ID_CONFLICT",
  STALE_REVISION: "SESSION_MESSAGE_STALE_REVISION",
  STATE_CORRUPT: "SESSION_MESSAGE_STATE_CORRUPT",
  STATE_UNAVAILABLE: "SESSION_MESSAGE_STATE_UNAVAILABLE",
});

const PENDING_STATUSES = new Set(["held", "delivered"]);
const RECEIPT_STATUSES = new Set(SESSION_MESSAGE_RECEIPT_STATUSES);
const POLICIES = new Set(SESSION_MESSAGE_POLICIES);
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const MESSAGE_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/u;

function fabricError(code, message, details = {}, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "SessionMessageFabricError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digestValue(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalName(value) {
  const name = String(value || "")
    .trim()
    .replace(/^@/u, "")
    .toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "Session message name must be 1-64 lowercase ASCII letters, digits, '.', '_' or '-'",
    );
  }
  return name;
}

function boundedId(value, label) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      `${label} must be a non-empty bounded string without control characters`,
    );
  }
  return id;
}

function messageId(value, create = randomUUID) {
  const id = value == null ? create() : String(value).trim();
  if (!MESSAGE_ID_PATTERN.test(id)) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "messageId must contain 1-128 safe identifier characters",
    );
  }
  return id;
}

function policyValue(value) {
  const policy = String(value || "accept")
    .trim()
    .toLowerCase();
  if (!POLICIES.has(policy)) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "Inbound policy must be accept, hold or refuse",
    );
  }
  return policy;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function emptyState(now) {
  const state = {
    schema: SESSION_MESSAGE_FABRIC_SCHEMA,
    version: 1,
    revision: 0,
    updatedAt: now,
    endpoints: [],
    channels: [],
    messages: [],
    receipts: [],
  };
  return { ...state, digest: digestValue(state) };
}

function stateWithoutDigest(state) {
  const { digest: _digest, ...rest } = state;
  return rest;
}

function authorityId(machineId, sessionId) {
  return `sha256:${createHash("sha256")
    .update(`${machineId}\0${sessionId}`)
    .digest("hex")}`;
}

function channelId(senderAuthority, recipientAuthority, recipientEpoch) {
  return digestValue({ senderAuthority, recipientAuthority, recipientEpoch });
}

function endpointAddress(endpoint) {
  return `cc-session://${encodeURIComponent(endpoint.machineId)}/@${endpoint.name}?epoch=${encodeURIComponent(endpoint.epoch)}`;
}

function parseAddress(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("cc-session://")) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "Session message address is malformed",
      {},
      cause,
    );
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\/@?/u, ""));
  const machineId = decodeURIComponent(parsed.hostname);
  const epoch = parsed.searchParams.get("epoch");
  if (!machineId || !epoch) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "Session message address must bind machine and endpoint epoch",
    );
  }
  return {
    name: canonicalName(name),
    machineId: boundedId(machineId, "address machineId"),
    epoch: boundedId(epoch, "address epoch"),
  };
}

function jsonBody(body) {
  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch (cause) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "Session message body must be JSON-serializable",
      {},
      cause,
    );
  }
  if (serialized === undefined) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
      "Session message body must be JSON-serializable",
    );
  }
  return { value: JSON.parse(serialized), serialized };
}

function receiptFor(state, senderAuthority, id) {
  return state.receipts.find(
    (receipt) =>
      receipt.senderAuthority === senderAuthority && receipt.messageId === id,
  );
}

function endpointFor(state, selector, { activeOnly = true } = {}) {
  const raw = String(selector || "").trim();
  const address = parseAddress(raw);
  const name = raw.startsWith("@") ? canonicalName(raw) : null;
  return state.endpoints.find((endpoint) => {
    if (activeOnly && endpoint.active !== true) return false;
    if (address) {
      return (
        endpoint.name === address.name &&
        endpoint.machineId === address.machineId &&
        endpoint.epoch === address.epoch
      );
    }
    return (
      endpoint.authorityId === raw ||
      endpoint.sessionId === raw ||
      (name != null && endpoint.name === name) ||
      endpoint.name === raw.toLowerCase()
    );
  });
}

function requireEndpoint(state, selector) {
  const endpoint = endpointFor(state, selector);
  if (!endpoint) {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.ENDPOINT_NOT_FOUND,
      `Session message endpoint was not found: ${String(selector || "")}`,
    );
  }
  return endpoint;
}

function channelFor(state, sender, recipient) {
  const id = channelId(
    sender.authorityId,
    recipient.authorityId,
    recipient.epoch,
  );
  let channel = state.channels.find((entry) => entry.id === id);
  if (!channel) {
    channel = {
      id,
      senderAuthority: sender.authorityId,
      recipientAuthority: recipient.authorityId,
      recipientEpoch: recipient.epoch,
      nextExpected: 1,
    };
    state.channels.push(channel);
  }
  return channel;
}

function pendingForRecipient(state, recipient) {
  return state.messages.filter(
    (message) =>
      message.recipientAuthority === recipient.authorityId &&
      message.recipientEpoch === recipient.epoch &&
      PENDING_STATUSES.has(message.status) &&
      message.acknowledgedAt == null,
  );
}

function updateReceipt(state, message, status, reason, now) {
  let receipt = receiptFor(state, message.senderAuthority, message.messageId);
  if (!receipt) {
    receipt = {
      messageId: message.messageId,
      senderAuthority: message.senderAuthority,
      recipientAuthority: message.recipientAuthority,
      recipientEpoch: message.recipientEpoch,
      sequence: message.sequence,
      payloadDigest: message.payloadDigest,
      status,
      reason,
      createdAt: now,
      updatedAt: now,
      idleNotifiedAt: null,
      readAt: null,
    };
    state.receipts.push(receipt);
  } else {
    receipt.status = status;
    receipt.reason = reason;
    receipt.updatedAt = now;
  }
  message.status = status;
  message.reason = reason;
  message.updatedAt = now;
  return receipt;
}

function trimReceiptHistory(state, limit) {
  if (state.receipts.length <= limit) return false;
  const protectedIds = new Set(
    state.messages.map(
      (message) => `${message.senderAuthority}\0${message.messageId}`,
    ),
  );
  const removable = state.receipts
    .filter(
      (receipt) =>
        !protectedIds.has(`${receipt.senderAuthority}\0${receipt.messageId}`),
    )
    .sort((left, right) => left.updatedAt - right.updatedAt);
  let changed = false;
  while (state.receipts.length > limit && removable.length > 0) {
    const target = removable.shift();
    const index = state.receipts.indexOf(target);
    if (index >= 0) {
      state.receipts.splice(index, 1);
      changed = true;
    }
  }
  return changed;
}

function compactSettledMessages(state) {
  const before = state.messages.length;
  state.messages = state.messages.filter((message) => {
    if (!PENDING_STATUSES.has(message.status)) return false;
    if (message.acknowledgedAt == null) return true;
    if (message.notifyWhenIdle !== true) return false;
    const receipt = receiptFor(
      state,
      message.senderAuthority,
      message.messageId,
    );
    return receipt?.idleNotifiedAt == null;
  });
  return state.messages.length !== before;
}

function applyExpectedMessage(state, channel, message, recipient, now) {
  if (recipient.policy === "refuse") {
    updateReceipt(state, message, "refused", "policy_refuse", now);
  } else if (recipient.policy === "hold") {
    updateReceipt(state, message, "held", "policy_hold", now);
    return false;
  } else if (recipient.online !== true) {
    // Durable admission is not delivery.  In particular, an offline target
    // must never produce a success-looking `delivered` receipt merely because
    // this host appended the payload to its local queue.  Reconnect promotes
    // the exact retained sequence through the same policy gate.
    updateReceipt(state, message, "held", "recipient_offline", now);
    return false;
  } else {
    const receipt = updateReceipt(state, message, "delivered", null, now);
    message.deliveredAt = now;
    if (message.notifyWhenIdle && recipient.idle === true) {
      receipt.idleNotifiedAt ??= now;
    }
  }
  channel.nextExpected += 1;
  return true;
}

function promoteChannel(state, channel, now) {
  const recipient = state.endpoints.find(
    (entry) =>
      entry.authorityId === channel.recipientAuthority &&
      entry.epoch === channel.recipientEpoch &&
      entry.active === true,
  );
  if (!recipient) return false;
  let changed = false;
  for (;;) {
    const message = state.messages.find(
      (entry) =>
        entry.channelId === channel.id &&
        entry.sequence === channel.nextExpected &&
        entry.status === "held",
    );
    if (!message) break;
    if (message.expiresAt <= now) {
      updateReceipt(state, message, "expired", "ttl_expired", now);
      channel.nextExpected += 1;
      changed = true;
      continue;
    }
    if (!applyExpectedMessage(state, channel, message, recipient, now)) break;
    changed = true;
  }
  return changed;
}

function sweepExpired(state, now) {
  let changed = false;
  for (const message of state.messages) {
    if (
      PENDING_STATUSES.has(message.status) &&
      message.acknowledgedAt == null &&
      message.expiresAt <= now
    ) {
      updateReceipt(state, message, "expired", "ttl_expired", now);
      const channel = state.channels.find(
        (entry) => entry.id === message.channelId,
      );
      if (channel && channel.nextExpected === message.sequence) {
        channel.nextExpected += 1;
      }
      changed = true;
    }
  }
  for (const channel of state.channels) {
    changed = promoteChannel(state, channel, now) || changed;
  }
  return changed;
}

function validateState(state) {
  const fail = (message) => {
    throw fabricError(
      SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_CORRUPT,
      `Session message state is corrupt: ${message}`,
    );
  };
  if (
    !state ||
    state.schema !== SESSION_MESSAGE_FABRIC_SCHEMA ||
    state.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.endpoints) ||
    !Array.isArray(state.channels) ||
    !Array.isArray(state.messages) ||
    !Array.isArray(state.receipts) ||
    typeof state.digest !== "string"
  ) {
    fail("invalid envelope");
  }
  if (digestValue(stateWithoutDigest(state)) !== state.digest) {
    fail("digest mismatch");
  }
  const authorityIds = new Set();
  const activeNames = new Set();
  for (const endpoint of state.endpoints) {
    if (
      typeof endpoint?.authorityId !== "string" ||
      authorityIds.has(endpoint.authorityId) ||
      !NAME_PATTERN.test(endpoint.name) ||
      !POLICIES.has(endpoint.policy) ||
      typeof endpoint.epoch !== "string" ||
      typeof endpoint.active !== "boolean" ||
      typeof endpoint.online !== "boolean" ||
      typeof endpoint.idle !== "boolean"
    ) {
      fail("invalid endpoint");
    }
    authorityIds.add(endpoint.authorityId);
    if (endpoint.active) {
      if (activeNames.has(endpoint.name)) fail("duplicate active name");
      activeNames.add(endpoint.name);
    }
  }
  const channelIds = new Set();
  for (const channel of state.channels) {
    if (
      typeof channel?.id !== "string" ||
      channelIds.has(channel.id) ||
      !Number.isSafeInteger(channel.nextExpected) ||
      channel.nextExpected < 1
    ) {
      fail("invalid channel");
    }
    channelIds.add(channel.id);
  }
  const messageKeys = new Set();
  for (const message of state.messages) {
    const key = `${message?.senderAuthority}\0${message?.messageId}`;
    if (
      messageKeys.has(key) ||
      !MESSAGE_ID_PATTERN.test(message?.messageId || "") ||
      !Number.isSafeInteger(message?.sequence) ||
      message.sequence < 1 ||
      !RECEIPT_STATUSES.has(message?.status) ||
      !channelIds.has(message?.channelId) ||
      typeof message?.payloadDigest !== "string"
    ) {
      fail("invalid message");
    }
    messageKeys.add(key);
  }
  for (const receipt of state.receipts) {
    if (
      !MESSAGE_ID_PATTERN.test(receipt?.messageId || "") ||
      !RECEIPT_STATUSES.has(receipt?.status) ||
      typeof receipt?.payloadDigest !== "string"
    ) {
      fail("invalid receipt");
    }
  }
  return state;
}

export function defaultSessionMessageFabricPath() {
  return path.join(getHomeDir(), "session-message-fabric", "state.json");
}

export class SessionMessageFabric {
  constructor({
    statePath = defaultSessionMessageFabricPath(),
    now = () => Date.now(),
    createId = randomUUID,
    lock = withFileLock,
    lockTimeoutMs = 10_000,
    maxMessageBytes = SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes,
    maxPendingPerRecipient = SESSION_MESSAGE_FABRIC_LIMITS.maxPendingPerRecipient,
    maxReceiptHistory = SESSION_MESSAGE_FABRIC_LIMITS.maxReceiptHistory,
    defaultTtlMs = SESSION_MESSAGE_FABRIC_LIMITS.defaultTtlMs,
    maxTtlMs = SESSION_MESSAGE_FABRIC_LIMITS.maxTtlMs,
  } = {}) {
    this.statePath = path.resolve(statePath);
    this._secureDefaultDirectory =
      this.statePath === path.resolve(defaultSessionMessageFabricPath());
    this._now = now;
    this._createId = createId;
    this._lock = lock;
    this._lockTimeoutMs = lockTimeoutMs;
    this._limits = {
      maxMessageBytes: positiveInteger(
        maxMessageBytes,
        SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes,
      ),
      maxPendingPerRecipient: positiveInteger(
        maxPendingPerRecipient,
        SESSION_MESSAGE_FABRIC_LIMITS.maxPendingPerRecipient,
      ),
      maxReceiptHistory: positiveInteger(
        maxReceiptHistory,
        SESSION_MESSAGE_FABRIC_LIMITS.maxReceiptHistory,
      ),
      defaultTtlMs: positiveInteger(
        defaultTtlMs,
        SESSION_MESSAGE_FABRIC_LIMITS.defaultTtlMs,
      ),
      maxTtlMs: positiveInteger(
        maxTtlMs,
        SESSION_MESSAGE_FABRIC_LIMITS.maxTtlMs,
      ),
    };
  }

  _ensureDirectory() {
    const directory = path.dirname(this.statePath);
    if (this._secureDefaultDirectory) {
      ensureDir(directory);
      return;
    }
    fs.mkdirSync(directory, {
      recursive: true,
      mode: 0o700,
    });
  }

  _readState() {
    try {
      return validateState(JSON.parse(fs.readFileSync(this.statePath, "utf8")));
    } catch (cause) {
      if (cause?.code === "ENOENT") return emptyState(this._now());
      if (cause?.code === SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_CORRUPT) {
        throw cause;
      }
      throw fabricError(
        SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_CORRUPT,
        "Could not read session message state",
        {},
        cause,
      );
    }
  }

  _writeState(state) {
    const directory = path.dirname(this.statePath);
    const temporary = path.join(
      directory,
      `.${path.basename(this.statePath)}.${process.pid}.${this._createId()}.tmp`,
    );
    let descriptor = null;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(
        descriptor,
        `${JSON.stringify(state, null, 2)}\n`,
        "utf8",
      );
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, this.statePath);
      if (process.platform !== "win32") {
        const directoryDescriptor = fs.openSync(directory, "r");
        try {
          fs.fsyncSync(directoryDescriptor);
        } finally {
          fs.closeSync(directoryDescriptor);
        }
      }
    } catch (cause) {
      if (descriptor != null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the original write failure.
        }
      }
      try {
        fs.unlinkSync(temporary);
      } catch {
        // The rename may already have committed, or no temporary was created.
      }
      throw fabricError(
        SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_UNAVAILABLE,
        "Could not atomically persist session message state",
        {},
        cause,
      );
    }
  }

  _transaction(mutator, { expectedRevision = null } = {}) {
    this._ensureDirectory();
    try {
      return this._lock(
        this.statePath,
        () => {
          const state = this._readState();
          if (
            expectedRevision != null &&
            Number(expectedRevision) !== state.revision
          ) {
            throw fabricError(
              SESSION_MESSAGE_FABRIC_ERROR_CODES.STALE_REVISION,
              "Session message fabric revision changed",
              { currentRevision: state.revision },
            );
          }
          const now = this._now();
          const swept = sweepExpired(state, now);
          const outcome = mutator(state, now) || { value: undefined };
          const compacted = compactSettledMessages(state);
          const trimmed = trimReceiptHistory(
            state,
            this._limits.maxReceiptHistory,
          );
          if (swept || compacted || trimmed || outcome.changed === true) {
            state.revision += 1;
            state.updatedAt = now;
            state.digest = digestValue(stateWithoutDigest(state));
            validateState(state);
            this._writeState(state);
          }
          return outcome.value;
        },
        {
          failIfUnavailable: true,
          timeoutMs: this._lockTimeoutMs,
          retryMs: 5,
          maxRetryMs: 50,
          retryJitterMs: 10,
          yieldAfterReleaseMs: 1,
        },
      );
    } catch (cause) {
      if (cause?.code?.startsWith?.("SESSION_MESSAGE_")) throw cause;
      throw fabricError(
        SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_UNAVAILABLE,
        "Session message state transaction failed",
        {},
        cause,
      );
    }
  }

  register({
    sessionId,
    name,
    machineId = "local",
    policy = "accept",
    idle = true,
  } = {}) {
    const safeSessionId = boundedId(sessionId, "sessionId");
    const safeMachineId = boundedId(machineId, "machineId").toLowerCase();
    const safeName = canonicalName(name || safeSessionId);
    const safePolicy = policyValue(policy);
    const id = authorityId(safeMachineId, safeSessionId);
    return this._transaction((state, now) => {
      const conflict = state.endpoints.find(
        (endpoint) =>
          endpoint.active &&
          endpoint.name === safeName &&
          endpoint.authorityId !== id,
      );
      if (conflict) {
        throw fabricError(
          SESSION_MESSAGE_FABRIC_ERROR_CODES.NAME_CONFLICT,
          `Session message name is already active: @${safeName}`,
        );
      }
      let endpoint = state.endpoints.find((entry) => entry.authorityId === id);
      if (endpoint) {
        if (!endpoint.active) {
          endpoint.epoch = this._createId();
          endpoint.registeredAt = now;
        }
        endpoint.sessionId = safeSessionId;
        endpoint.machineId = safeMachineId;
        endpoint.name = safeName;
        endpoint.policy = safePolicy;
        endpoint.idle = idle === true;
        endpoint.online = true;
        endpoint.active = true;
        endpoint.updatedAt = now;
      } else {
        endpoint = {
          authorityId: id,
          sessionId: safeSessionId,
          machineId: safeMachineId,
          name: safeName,
          epoch: this._createId(),
          policy: safePolicy,
          idle: idle === true,
          online: true,
          active: true,
          registeredAt: now,
          updatedAt: now,
        };
        state.endpoints.push(endpoint);
      }
      for (const channel of state.channels.filter(
        (entry) =>
          entry.recipientAuthority === endpoint.authorityId &&
          entry.recipientEpoch === endpoint.epoch,
      )) {
        promoteChannel(state, channel, now);
      }
      return {
        changed: true,
        value: { ...clone(endpoint), address: endpointAddress(endpoint) },
      };
    });
  }

  unregister(selector) {
    return this._transaction((state, now) => {
      const endpoint = requireEndpoint(state, selector);
      endpoint.active = false;
      endpoint.online = false;
      endpoint.idle = false;
      endpoint.updatedAt = now;
      for (const message of pendingForRecipient(state, endpoint)) {
        updateReceipt(state, message, "refused", "recipient_unregistered", now);
      }
      return { changed: true, value: true };
    });
  }

  reconnect(selector) {
    return this._transaction((state, now) => {
      const endpoint = requireEndpoint(state, selector);
      endpoint.online = true;
      endpoint.updatedAt = now;
      for (const channel of state.channels.filter(
        (entry) =>
          entry.recipientAuthority === endpoint.authorityId &&
          entry.recipientEpoch === endpoint.epoch,
      )) {
        promoteChannel(state, channel, now);
      }
      return {
        changed: true,
        value: { ...clone(endpoint), address: endpointAddress(endpoint) },
      };
    });
  }

  disconnect(selector) {
    return this._transaction((state, now) => {
      const endpoint = requireEndpoint(state, selector);
      endpoint.online = false;
      endpoint.updatedAt = now;
      return { changed: true, value: true };
    });
  }

  setPolicy(selector, policy, options = {}) {
    const safePolicy = policyValue(policy);
    return this._transaction((state, now) => {
      const endpoint = requireEndpoint(state, selector);
      endpoint.policy = safePolicy;
      endpoint.updatedAt = now;
      for (const channel of state.channels.filter(
        (entry) =>
          entry.recipientAuthority === endpoint.authorityId &&
          entry.recipientEpoch === endpoint.epoch,
      )) {
        promoteChannel(state, channel, now);
      }
      return {
        changed: true,
        value: { ...clone(endpoint), address: endpointAddress(endpoint) },
      };
    }, options);
  }

  setIdle(selector, idle, options = {}) {
    return this._transaction((state, now) => {
      const endpoint = requireEndpoint(state, selector);
      const becameIdle = endpoint.idle !== true && idle === true;
      endpoint.idle = idle === true;
      endpoint.updatedAt = now;
      let notifications = 0;
      if (becameIdle) {
        for (const message of state.messages) {
          if (
            message.recipientAuthority !== endpoint.authorityId ||
            message.recipientEpoch !== endpoint.epoch ||
            message.notifyWhenIdle !== true ||
            message.status !== "delivered"
          ) {
            continue;
          }
          const receipt = receiptFor(
            state,
            message.senderAuthority,
            message.messageId,
          );
          if (receipt && receipt.idleNotifiedAt == null) {
            receipt.idleNotifiedAt = now;
            receipt.updatedAt = now;
            notifications += 1;
          }
        }
      }
      return {
        changed: true,
        value: { idle: endpoint.idle, notifications },
      };
    }, options);
  }

  send({
    from,
    to,
    body,
    subject = null,
    messageId: requestedMessageId = null,
    sequence = null,
    ttlMs = this._limits.defaultTtlMs,
    notifyWhenIdle = false,
  } = {}) {
    const id = messageId(requestedMessageId, this._createId);
    const cleanSubject = subject == null ? null : String(subject).slice(0, 512);
    const cleanBody = jsonBody(body);
    const messageBytes = Buffer.byteLength(
      JSON.stringify({ subject: cleanSubject, body: cleanBody.value }),
      "utf8",
    );
    if (messageBytes > this._limits.maxMessageBytes) {
      throw fabricError(
        SESSION_MESSAGE_FABRIC_ERROR_CODES.MESSAGE_TOO_LARGE,
        `Session message is ${messageBytes} bytes; limit is ${this._limits.maxMessageBytes}`,
        {
          messageBytes,
          maxMessageBytes: this._limits.maxMessageBytes,
        },
      );
    }
    const safeTtlMs = positiveInteger(
      ttlMs,
      this._limits.defaultTtlMs,
      this._limits.maxTtlMs,
    );
    const requestedSequence =
      sequence == null ? null : positiveInteger(sequence, null);
    if (sequence != null && requestedSequence == null) {
      throw fabricError(
        SESSION_MESSAGE_FABRIC_ERROR_CODES.INVALID_ARGUMENT,
        "Session message sequence must be a positive integer",
      );
    }
    return this._transaction((state, now) => {
      const sender = requireEndpoint(state, from);
      const recipient = endpointFor(state, to);
      const payloadDigest = digestValue({
        body: cleanBody.value,
        subject: cleanSubject,
        to: String(to),
      });
      const duplicate = receiptFor(state, sender.authorityId, id);
      if (duplicate) {
        if (duplicate.payloadDigest !== payloadDigest) {
          throw fabricError(
            SESSION_MESSAGE_FABRIC_ERROR_CODES.MESSAGE_ID_CONFLICT,
            "messageId was already used with a different payload",
          );
        }
        return { value: clone(duplicate) };
      }
      if (!recipient) {
        const receipt = {
          messageId: id,
          senderAuthority: sender.authorityId,
          recipientAuthority: null,
          recipientEpoch: null,
          sequence: requestedSequence,
          payloadDigest,
          status: "refused",
          reason: "unknown_recipient",
          createdAt: now,
          updatedAt: now,
          idleNotifiedAt: null,
          readAt: null,
        };
        state.receipts.push(receipt);
        return { changed: true, value: clone(receipt) };
      }
      const channel = channelFor(state, sender, recipient);
      const pendingSequences = state.messages
        .filter(
          (message) =>
            message.channelId === channel.id &&
            PENDING_STATUSES.has(message.status),
        )
        .map((message) => message.sequence);
      const safeSequence =
        requestedSequence ??
        Math.max(
          channel.nextExpected,
          ...pendingSequences.map((value) => value + 1),
        );
      const message = {
        messageId: id,
        channelId: channel.id,
        senderAuthority: sender.authorityId,
        senderName: sender.name,
        recipientAuthority: recipient.authorityId,
        recipientName: recipient.name,
        recipientEpoch: recipient.epoch,
        sequence: safeSequence,
        subject: cleanSubject,
        body: cleanBody.value,
        messageBytes,
        payloadDigest,
        status: "held",
        reason: "out_of_order",
        notifyWhenIdle: notifyWhenIdle === true,
        createdAt: now,
        updatedAt: now,
        deliveredAt: null,
        acknowledgedAt: null,
        expiresAt: now + safeTtlMs,
      };
      if (
        safeSequence < channel.nextExpected ||
        state.messages.some(
          (entry) =>
            entry.channelId === channel.id &&
            entry.sequence === safeSequence &&
            PENDING_STATUSES.has(entry.status),
        )
      ) {
        updateReceipt(
          state,
          message,
          "refused",
          safeSequence < channel.nextExpected
            ? "stale_sequence"
            : "duplicate_sequence",
          now,
        );
        return {
          changed: true,
          value: clone(receiptFor(state, sender.authorityId, id)),
        };
      }
      if (
        recipient.policy !== "refuse" &&
        pendingForRecipient(state, recipient).length >=
          this._limits.maxPendingPerRecipient
      ) {
        updateReceipt(state, message, "full", "queue_capacity", now);
        return {
          changed: true,
          value: clone(receiptFor(state, sender.authorityId, id)),
        };
      }
      state.messages.push(message);
      updateReceipt(state, message, "held", "out_of_order", now);
      if (safeSequence === channel.nextExpected) {
        applyExpectedMessage(state, channel, message, recipient, now);
        promoteChannel(state, channel, now);
      }
      return {
        changed: true,
        value: clone(receiptFor(state, sender.authorityId, id)),
      };
    });
  }

  inbox(selector, { acknowledge = false } = {}) {
    return this._transaction((state, now) => {
      const endpoint = requireEndpoint(state, selector);
      const messages = pendingForRecipient(state, endpoint)
        .filter((message) => message.status === "delivered")
        .sort(
          (left, right) =>
            (left.senderAuthority === right.senderAuthority
              ? left.sequence - right.sequence
              : left.createdAt - right.createdAt) ||
            left.senderAuthority.localeCompare(right.senderAuthority),
        );
      if (acknowledge) {
        for (const message of messages) {
          message.acknowledgedAt = now;
          const receipt = receiptFor(
            state,
            message.senderAuthority,
            message.messageId,
          );
          if (receipt) {
            receipt.readAt = now;
            receipt.updatedAt = now;
          }
        }
      }
      return {
        changed: acknowledge && messages.length > 0,
        value: clone(messages),
      };
    });
  }

  receipts(selector) {
    return this._transaction((state) => {
      const endpoint = requireEndpoint(state, selector);
      return {
        value: clone(
          state.receipts
            .filter(
              (receipt) => receipt.senderAuthority === endpoint.authorityId,
            )
            .sort(
              (left, right) =>
                left.createdAt - right.createdAt ||
                left.messageId.localeCompare(right.messageId),
            ),
        ),
      };
    });
  }

  projection() {
    return this._transaction((state) => {
      const endpoints = state.endpoints
        .filter((endpoint) => endpoint.active)
        .map((endpoint) => {
          const pending = pendingForRecipient(state, endpoint);
          return {
            authorityId: endpoint.authorityId,
            sessionId: endpoint.sessionId,
            machineId: endpoint.machineId,
            name: endpoint.name,
            address: endpointAddress(endpoint),
            epoch: endpoint.epoch,
            policy: endpoint.policy,
            online: endpoint.online,
            idle: endpoint.idle,
            unread: pending.filter((message) => message.status === "delivered")
              .length,
            held: pending.filter((message) => message.status === "held").length,
            updatedAt: endpoint.updatedAt,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      return {
        value: {
          schema: SESSION_MESSAGE_FABRIC_PROJECTION_SCHEMA,
          version: 1,
          authority: "cli",
          revision: state.revision,
          digest: state.digest,
          limits: clone(this._limits),
          endpoints,
        },
      };
    });
  }
}
