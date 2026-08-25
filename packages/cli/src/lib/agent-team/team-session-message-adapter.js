/**
 * Team mailbox compatibility surface backed by SessionMessageFabric.
 *
 * The adapter intentionally keeps TeamRunner's narrow synchronous API while
 * moving durable admission, ordering, TTL, offline holding, receipts and
 * sender-rate buckets into one cross-process locked authority. A logical Team
 * broadcast expands to recipient-scoped fabric records with one stable Team id.
 */

import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  SessionMessageFabric,
  SESSION_MESSAGE_FABRIC_ERROR_CODES,
} from "../session-message-fabric.js";
import {
  DEFAULT_TEAM_MAILBOX_LIMITS,
  TEAM_MAILBOX_ERROR_CODES,
  TeamMailbox,
  TeamMailboxError,
} from "./team-mailbox.js";

export const TEAM_SESSION_MESSAGE_ADAPTER_SCHEMA =
  "chainlesschain.team-session-message-adapter/v1";

const ENVELOPE_SCHEMA = "chainlesschain.team-message-envelope/v1";
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeName(value, label) {
  const name = String(value || "").trim();
  if (!name || name === "*" || name.length > 64) {
    throw new TeamMailboxError(
      TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      `${label} must be a non-empty endpoint name of at most 64 characters`,
    );
  }
  return name;
}

function jsonValue(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("not JSON data");
    return JSON.parse(serialized);
  } catch (cause) {
    throw new TeamMailboxError(
      TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      `${label} must be JSON-serializable`,
      { cause },
    );
  }
}

function logicalId(stableToken) {
  // 13 hexadecimal digits stay below Number.MAX_SAFE_INTEGER. Collision is
  // checked against retained authority before admission and fails closed.
  return Number.parseInt(digest(stableToken).slice(0, 13), 16) + 1;
}

function physicalId(stableToken, recipient) {
  return `tm-${digest(stableToken).slice(0, 32)}-${digest(recipient).slice(0, 12)}`;
}

function teamError(
  error,
  fallbackCode = TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
) {
  if (error instanceof TeamMailboxError) return error;
  const code =
    error?.code === SESSION_MESSAGE_FABRIC_ERROR_CODES.MESSAGE_TOO_LARGE
      ? TEAM_MAILBOX_ERROR_CODES.MESSAGE_TOO_LARGE
      : error?.code === SESSION_MESSAGE_FABRIC_ERROR_CODES.MESSAGE_ID_CONFLICT
        ? TEAM_MAILBOX_ERROR_CODES.ACK_CONFLICT
        : fallbackCode;
  return new TeamMailboxError(code, error?.message || "Team message failed", {
    cause: error,
    ...(Number.isSafeInteger(error?.retryAfterMs)
      ? { retryAfterMs: error.retryAfterMs }
      : {}),
  });
}

function envelopeFor(record, teamId) {
  const envelope = record?.body;
  return envelope?.schema === ENVELOPE_SCHEMA && envelope.teamId === teamId
    ? envelope
    : null;
}

export class TeamSessionMessageAdapter {
  constructor({
    statePath,
    teamId,
    recipients = [],
    now = () => Date.now(),
    createId = randomUUID,
    maxMessageBytes = DEFAULT_TEAM_MAILBOX_LIMITS.maxMessageBytes,
    maxMessages = DEFAULT_TEAM_MAILBOX_LIMITS.maxMessages,
    maxReceiptHistory = DEFAULT_TEAM_MAILBOX_LIMITS.maxReceiptHistory,
    maxMessagesPerSenderWindow,
    senderRateWindowMs,
    defaultTtlMs,
    maxTtlMs,
  } = {}) {
    if (!statePath) throw new TypeError("team message statePath is required");
    this.statePath = String(statePath);
    this.teamId = safeName(teamId, "teamId");
    this._now = typeof now === "function" ? now : () => now;
    this._createId = createId;
    this._recipients = new Set();
    this._limits = {
      maxMessageBytes,
      maxMessages,
      maxReceiptHistory,
    };
    this.fabric = new SessionMessageFabric({
      statePath: this.statePath,
      now: this._now,
      createId,
      maxMessageBytes,
      maxPendingPerRecipient: maxMessages,
      maxReceiptHistory,
      ...(maxMessagesPerSenderWindow == null
        ? {}
        : { maxMessagesPerSenderWindow }),
      ...(senderRateWindowMs == null ? {} : { senderRateWindowMs }),
      ...(defaultTtlMs == null ? {} : { defaultTtlMs }),
      ...(maxTtlMs == null ? {} : { maxTtlMs }),
    });
    this._ensureEndpoint("coordinator");
    this.registerRecipients(recipients);
  }

  _sessionId(name) {
    return `${this.teamId}:${name}`;
  }

  _endpoint(name) {
    return this.fabric
      .projection()
      .endpoints.find((endpoint) => endpoint.name === name);
  }

  _ensureEndpoint(value) {
    const name = safeName(value || "coordinator", "endpoint").toLowerCase();
    const existing = this._endpoint(name);
    if (existing) return existing;
    return this.fabric.register({
      sessionId: this._sessionId(name),
      name,
      idle: name !== "coordinator",
    });
  }

  registerRecipients(recipients = []) {
    const values =
      typeof recipients === "string"
        ? [recipients]
        : Array.from(recipients || []);
    for (const value of values) {
      const recipient = safeName(value, "recipient").toLowerCase();
      if (recipient === "coordinator") continue;
      this._ensureEndpoint(recipient);
      this._recipients.add(recipient);
    }
    return [...this._recipients];
  }

  setRecipientState(value, state) {
    const recipient = safeName(value, "recipient").toLowerCase();
    this._ensureEndpoint(recipient);
    if (state === "running") {
      this.fabric.reconnect(recipient);
      this.fabric.setIdle(recipient, false);
    } else {
      this.fabric.setIdle(recipient, true);
      this.fabric.disconnect(recipient);
    }
    return this._endpoint(recipient);
  }

  _records(authority = this.fabric.auditSnapshot()) {
    return authority.messages
      .map((record) => ({ record, envelope: envelopeFor(record, this.teamId) }))
      .filter((entry) => entry.envelope);
  }

  _logicalMessage(envelope, delivery = null) {
    return {
      ...clone(envelope.message),
      ...(delivery
        ? {
            delivery: {
              recipient: envelope.recipient,
              messageId: envelope.message.id,
              status: delivery.status,
              deliveryCount: delivery.deliveryCount || 0,
              deliveredAt: delivery.deliveredAt || null,
              readAt: delivery.readAt || null,
              processedAt: delivery.processedAt || null,
              deadLetteredAt: delivery.deadLetteredAt || null,
              consumerKey: delivery.consumerKey || null,
              reason: delivery.reason || null,
              recipientAttempt: delivery.recipientAttempt || null,
            },
          }
        : {}),
    };
  }

  _existingMessages(id) {
    return this._records().filter(({ envelope }) => envelope.message.id === id);
  }

  send({
    from = "coordinator",
    to,
    subject = null,
    body = null,
    mode = "send",
    idempotencyKey = null,
    causationId = null,
    correlationId = null,
    senderAttempt = null,
    ttlMs = undefined,
  } = {}) {
    const sender = safeName(from || "coordinator", "sender").toLowerCase();
    const target = String(to || "")
      .trim()
      .toLowerCase();
    if (target !== "*") safeName(target, "recipient");
    this._ensureEndpoint(sender);
    const recipients =
      target === "*"
        ? [...this._recipients].filter((recipient) => recipient !== sender)
        : [target];
    if (recipients.length === 0) {
      throw new TeamMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        "Team broadcast has no registered recipients",
      );
    }
    for (const recipient of recipients) {
      if (recipient !== "coordinator" && !this._recipients.has(recipient)) {
        throw new TeamMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          `Unknown team message recipient: ${recipient}`,
        );
      }
      this._ensureEndpoint(recipient);
    }
    const senderTaskKey = String(senderAttempt?.taskKey || "");
    const stableKey =
      idempotencyKey == null
        ? this._createId()
        : `${sender}\0${senderTaskKey}\0${String(idempotencyKey)}`;
    const stableToken = `${this.teamId}\0${stableKey}`;
    const id = logicalId(stableToken);
    let serializedPayload;
    try {
      serializedPayload = JSON.stringify({
        from: sender,
        to: target,
        subject,
        body,
        mode: mode === "followup" ? "followup" : "send",
        causationId,
        correlationId,
      });
    } catch (error) {
      throw teamError(error);
    }
    const payloadDigest = digest(serializedPayload);
    const existing = this._existingMessages(id);
    for (const entry of existing) {
      if (entry.envelope.message.payloadDigest !== `sha256:${payloadDigest}`) {
        throw new TeamMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          "Team logical message id collided with different content",
        );
      }
    }
    const existingRecipients = new Set(
      existing.map(({ envelope }) => envelope.recipient),
    );
    const message = existing[0]
      ? clone(existing[0].envelope.message)
      : jsonValue(
          {
            id,
            from: sender,
            to: target,
            subject,
            body,
            ts: this._now(),
            ...(mode === "followup" ? { mode: "followup" } : {}),
            ...(idempotencyKey == null
              ? {}
              : { idempotencyKey: String(idempotencyKey) }),
            ...(causationId == null ? {} : { causationId }),
            ...(correlationId == null ? {} : { correlationId }),
            ...(senderAttempt == null ? {} : { senderAttempt }),
            payloadDigest: `sha256:${payloadDigest}`,
          },
          "team message",
        );
    try {
      for (const recipient of recipients) {
        if (existingRecipients.has(recipient)) continue;
        const receipt = this.fabric.send({
          from: sender,
          to: recipient,
          subject,
          body: {
            schema: ENVELOPE_SCHEMA,
            teamId: this.teamId,
            recipient,
            message,
          },
          messageId: physicalId(stableToken, recipient),
          retainAfterAck: true,
          ...(ttlMs == null ? {} : { ttlMs }),
        });
        if (!["delivered", "held"].includes(receipt.status)) {
          const code =
            receipt.status === "full"
              ? TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED
              : TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID;
          throw new TeamMailboxError(
            code,
            `Team message admission ${receipt.status}: ${receipt.reason || "unknown"}`,
            { receipt, retryAfterMs: receipt.retryAfterMs || null },
          );
        }
      }
      return clone(message);
    } catch (error) {
      throw teamError(error);
    }
  }

  _inbox(recipient, { receive = false, limit = 100, markRead = false } = {}) {
    const target = safeName(recipient, "recipient").toLowerCase();
    this._ensureEndpoint(target);
    const records = receive
      ? this.fabric.receive(target, { limit, markRead })
      : this.fabric.inbox(target).slice(0, limit);
    return records
      .map((record) => {
        const envelope = envelopeFor(record, this.teamId);
        return envelope
          ? this._logicalMessage(envelope, record.delivery || null)
          : null;
      })
      .filter(Boolean);
  }

  peek(recipient) {
    return this._inbox(recipient);
  }

  receive(recipient, options = {}) {
    return this._inbox(recipient, { ...options, receive: true });
  }

  drain(recipient) {
    const messages = this.receive(recipient, { limit: 100, markRead: true });
    if (messages.length > 0) {
      this.acknowledge(recipient, {
        messageIds: messages.map((message) => message.id),
        consumerKey: `legacy-drain:${recipient}`,
        status: "processed",
      });
    }
    return messages.map((message) => {
      const result = clone(message);
      delete result.delivery;
      return result;
    });
  }

  acknowledge(
    recipient,
    {
      messageIds = [],
      consumerKey,
      status = "processed",
      reason = null,
      recipientAttempt = null,
    } = {},
  ) {
    const target = safeName(recipient, "recipient").toLowerCase();
    if (
      !Array.isArray(messageIds) ||
      messageIds.length === 0 ||
      messageIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    ) {
      throw new TeamMailboxError(
        TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
        "Team message ids must be positive integers",
      );
    }
    const records = this._records();
    const physicalIds = messageIds.map((id) => {
      const match = records.find(
        ({ record, envelope }) =>
          envelope.recipient === target &&
          envelope.message.id === id &&
          record.recipientName === target,
      );
      if (!match) {
        throw new TeamMailboxError(
          TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
          `Team message ${id} is not addressed to ${target}`,
        );
      }
      return match.record.messageId;
    });
    try {
      const receipts = this.fabric.acknowledge(target, {
        messageIds: physicalIds,
        consumerKey,
        status,
        reason,
        recipientAttempt,
      });
      return {
        receipts: receipts.map((receipt, index) => ({
          recipient: target,
          messageId: messageIds[index],
          status: receipt.status,
          deliveryCount: receipt.deliveryCount || 0,
          deliveredAt: receipt.deliveredAt || null,
          readAt: receipt.readAt || null,
          processedAt: receipt.processedAt || null,
          deadLetteredAt: receipt.deadLetteredAt || null,
          consumerKey: receipt.consumerKey || null,
          reason: receipt.reason || null,
          recipientAttempt: receipt.recipientAttempt || null,
        })),
        cursor: null,
      };
    } catch (error) {
      throw teamError(error, TEAM_MAILBOX_ERROR_CODES.ACK_INVALID);
    }
  }

  pendingCount(recipient) {
    return this.peek(recipient).length;
  }

  log() {
    return this._logFromRecords(this._records());
  }

  _logFromRecords(records) {
    const messages = new Map();
    for (const { envelope } of records) {
      messages.set(envelope.message.id, clone(envelope.message));
    }
    return [...messages.values()].sort(
      (left, right) => left.ts - right.ts || left.id - right.id,
    );
  }

  size() {
    return this.log().length;
  }

  _teamReceipts(authority = this.fabric.auditSnapshot()) {
    const records = this._records(authority);
    const byPhysicalId = new Map(
      records.map((entry) => [entry.record.messageId, entry]),
    );
    const receipts = [];
    for (const receipt of authority.receipts) {
      const entry = byPhysicalId.get(receipt.messageId);
      if (!entry || receipt.status === "held") continue;
      const recipient = entry.envelope.recipient;
      const mappedStatus = ["read", "processed", "dead_letter"].includes(
        receipt.status,
      )
        ? receipt.status
        : "delivered";
      receipts.push([
        `${recipient}\0${entry.envelope.message.id}`,
        {
          recipient,
          messageId: entry.envelope.message.id,
          status: mappedStatus,
          deliveryCount: receipt.deliveryCount || 0,
          deliveredAt: receipt.deliveredAt || null,
          readAt: receipt.readAt || null,
          processedAt: receipt.processedAt || null,
          deadLetteredAt: receipt.deadLetteredAt || null,
          consumerKey: receipt.consumerKey || null,
          reason: receipt.reason || null,
          recipientAttempt: receipt.recipientAttempt || null,
        },
      ]);
    }
    return receipts;
  }

  _pressureFromAuthority(authority) {
    const counts = new Map();
    for (const message of authority.messages) {
      if (
        !["delivered", "held"].includes(message.status) ||
        message.acknowledgedAt != null
      ) {
        continue;
      }
      counts.set(
        message.recipientAuthority,
        (counts.get(message.recipientAuthority) || 0) + 1,
      );
    }
    const pending = Math.max(0, ...counts.values());
    const ratio = pending / Math.max(1, this._limits.maxMessages);
    return {
      ratio,
      messageRatio: ratio,
      byteRatio: 0,
      level:
        ratio >= 1
          ? "full"
          : ratio >= 0.95
            ? "critical"
            : ratio >= 0.8
              ? "high"
              : "normal",
      full: ratio >= 1,
    };
  }

  pressure() {
    return this._pressureFromAuthority(this.fabric.auditSnapshot());
  }

  status() {
    const authority = this.fabric.auditSnapshot();
    const log = this._logFromRecords(this._records(authority));
    const receipts = this._teamReceipts(authority).map(
      ([, receipt]) => receipt,
    );
    const totalBytes = Buffer.byteLength(JSON.stringify(log), "utf8");
    return {
      messages: log.length,
      totalBytes,
      limits: { ...this._limits },
      recipients: [...this._recipients],
      registeredRecipients: this._recipients.size,
      pressure: this._pressureFromAuthority(authority),
      counters: {
        acceptedMessages: log.length,
        acceptedBytes: totalBytes,
        rejectedMessages: 0,
        rejectedBytes: 0,
        compactionRuns: 0,
        compactedMessages: 0,
        compactedBytes: 0,
        deliveryAttempts: receipts.reduce(
          (sum, receipt) => sum + (receipt.deliveryCount || 0),
          0,
        ),
        processedMessages: receipts.filter(
          (receipt) => receipt.status === "processed",
        ).length,
        deadLetteredMessages: receipts.filter(
          (receipt) => receipt.status === "dead_letter",
        ).length,
        idempotentReplays: 0,
      },
      receipts: receipts.length,
      idempotencyRecords: 0,
      authority: "session-message-fabric",
      fabric: {
        revision: authority.revision,
        digest: authority.digest,
      },
    };
  }

  snapshot() {
    const authority = this.fabric.auditSnapshot();
    const log = this._logFromRecords(this._records(authority));
    const receipts = this._teamReceipts(authority);
    const receiptValues = receipts.map(([, receipt]) => receipt);
    const totalBytes = Buffer.byteLength(JSON.stringify(log), "utf8");
    const counters = {
      acceptedMessages: log.length,
      acceptedBytes: totalBytes,
      rejectedMessages: 0,
      rejectedBytes: 0,
      compactionRuns: 0,
      compactedMessages: 0,
      compactedBytes: 0,
      deliveryAttempts: receiptValues.reduce(
        (sum, receipt) => sum + (receipt.deliveryCount || 0),
        0,
      ),
      processedMessages: receiptValues.filter(
        (receipt) => receipt.status === "processed",
      ).length,
      deadLetteredMessages: receiptValues.filter(
        (receipt) => receipt.status === "dead_letter",
      ).length,
      idempotentReplays: 0,
    };
    return {
      version: 4,
      authority: "session-message-fabric",
      adapterSchema: TEAM_SESSION_MESSAGE_ADAPTER_SCHEMA,
      statePath: this.statePath,
      teamId: this.teamId,
      fabricRevision: authority.revision,
      fabricDigest: authority.digest,
      limits: { ...this._limits },
      log,
      seq: 0,
      delivered: [],
      recipients: [...this._recipients],
      totalBytes,
      counters,
      receipts,
      idempotency: [],
    };
  }

  static restore(snapshot, options = {}) {
    if (
      snapshot?.authority !== "session-message-fabric" ||
      snapshot?.adapterSchema !== TEAM_SESSION_MESSAGE_ADAPTER_SCHEMA
    ) {
      throw new TeamMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        "Team message snapshot is not a SessionMessageFabric authority",
      );
    }
    const statePath = options.statePath || snapshot.statePath;
    if (!fs.existsSync(statePath)) {
      throw new TeamMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        `Team message authority not found: ${statePath}`,
      );
    }
    return new TeamSessionMessageAdapter({
      ...options,
      statePath,
      teamId: options.teamId || snapshot.teamId,
      recipients: snapshot.recipients || [],
      ...(snapshot.limits || {}),
    });
  }

  static migrateLegacy(snapshot, options = {}) {
    const legacy = TeamMailbox.restore(snapshot, { now: options.now });
    const adapter = new TeamSessionMessageAdapter({
      ...options,
      recipients: legacy.status().recipients,
    });
    for (const message of legacy.log()) {
      adapter._importLegacyMessage(message);
    }
    for (const [, receipt] of snapshot.receipts || []) {
      if (!["read", "processed", "dead_letter"].includes(receipt.status)) {
        continue;
      }
      adapter.acknowledge(receipt.recipient, {
        messageIds: [receipt.messageId],
        consumerKey: receipt.consumerKey || `legacy:${receipt.messageId}`,
        status: receipt.status,
        reason: receipt.reason,
        recipientAttempt: receipt.recipientAttempt,
      });
    }
    return adapter;
  }

  _importLegacyMessage(message) {
    const recipients =
      message.to === "*"
        ? [...this._recipients].filter(
            (recipient) => recipient !== message.from,
          )
        : [message.to];
    this._ensureEndpoint(message.from || "coordinator");
    for (const recipient of recipients) {
      this._ensureEndpoint(recipient);
      const token = `${this.teamId}\0legacy\0${message.id}`;
      this.fabric.send({
        from: message.from || "coordinator",
        to: recipient,
        subject: message.subject,
        body: {
          schema: ENVELOPE_SCHEMA,
          teamId: this.teamId,
          recipient,
          message: clone(message),
        },
        messageId: physicalId(token, recipient),
        retainAfterAck: true,
      });
    }
  }
}
