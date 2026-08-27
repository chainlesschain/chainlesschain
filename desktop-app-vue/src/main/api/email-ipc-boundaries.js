"use strict";

const DEFAULT_EMAIL_IPC_LIMITS = Object.freeze({
  maxAccounts: 100,
  maxMailboxes: 200,
  maxEmails: 200,
  maxDrafts: 100,
  maxAttachments: 50,
  maxLabels: 100,
  maxClients: 16,
  maxSyncIntervals: 16,
  maxConcurrentFetches: 4,
  maxMailboxDepth: 16,
  maxQueryOffset: 10_000,
  maxIdBytes: 256,
  maxAddressBytes: 8 * 1024,
  maxSubjectBytes: 16 * 1024,
  maxTextBytes: 2 * 1024 * 1024,
  maxHtmlBytes: 4 * 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
  maxPasswordBytes: 16 * 1024,
  maxOutgoingAttachments: 10,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxOutgoingAttachmentBytes: 25 * 1024 * 1024,
  maxRawMessageBytes: 10 * 1024 * 1024,
  maxRawBatchBytes: 50 * 1024 * 1024,
  minSyncSeconds: 60,
  maxSyncSeconds: 24 * 60 * 60,
});

const HARD_EMAIL_IPC_LIMITS = Object.freeze({
  maxAccounts: 500,
  maxMailboxes: 1_000,
  maxEmails: 1_000,
  maxDrafts: 500,
  maxAttachments: 200,
  maxLabels: 500,
  maxClients: 64,
  maxSyncIntervals: 64,
  maxConcurrentFetches: 16,
  maxMailboxDepth: 64,
  maxQueryOffset: 100_000,
  maxIdBytes: 2_048,
  maxAddressBytes: 64 * 1024,
  maxSubjectBytes: 256 * 1024,
  maxTextBytes: 16 * 1024 * 1024,
  maxHtmlBytes: 32 * 1024 * 1024,
  maxMetadataBytes: 1024 * 1024,
  maxPasswordBytes: 64 * 1024,
  maxOutgoingAttachments: 25,
  maxAttachmentBytes: 32 * 1024 * 1024,
  maxOutgoingAttachmentBytes: 64 * 1024 * 1024,
  maxRawMessageBytes: 32 * 1024 * 1024,
  maxRawBatchBytes: 128 * 1024 * 1024,
  minSyncSeconds: 60,
  maxSyncSeconds: 7 * 24 * 60 * 60,
});

const EMAIL_ACCOUNT_UPDATE_FIELDS = Object.freeze({
  email: "email",
  displayName: "display_name",
  imapHost: "imap_host",
  imapPort: "imap_port",
  imapTls: "imap_tls",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpSecure: "smtp_secure",
  status: "status",
  syncFrequency: "sync_frequency",
});

class EmailIPCBoundaryError extends Error {
  constructor(code, scope, message, details = {}) {
    super(message);
    this.name = "EmailIPCBoundaryError";
    this.code = code;
    this.scope = scope;
    Object.assign(this, details);
  }
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function boundedPositiveInteger(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return Math.min(fallback, hardLimit);
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return Math.min(fallback, hardLimit);
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function createEmailIPCLimits(options = {}) {
  const limits = Object.fromEntries(
    Object.keys(DEFAULT_EMAIL_IPC_LIMITS).map((key) => [
      key,
      boundedPositiveInteger(
        options[key],
        DEFAULT_EMAIL_IPC_LIMITS[key],
        HARD_EMAIL_IPC_LIMITS[key],
      ),
    ]),
  );
  limits.maxSyncSeconds = Math.max(
    limits.minSyncSeconds,
    limits.maxSyncSeconds,
  );
  limits.maxOutgoingAttachmentBytes = Math.max(
    limits.maxAttachmentBytes,
    limits.maxOutgoingAttachmentBytes,
  );
  return Object.freeze(limits);
}

function assertPlainObject(value, scope) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `${scope} must be an object`,
    );
  }
  return value;
}

function assertBoundedString(
  value,
  scope,
  maxBytes,
  { allowEmpty = false, nullable = false } = {},
) {
  if (nullable && value == null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    byteLength(value) > maxBytes
  ) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `Invalid or oversized ${scope}`,
      { limit: { maxBytes } },
    );
  }
  return value;
}

function optionalBoundedString(value, scope, maxBytes) {
  if (value == null || value === "") {
    return "";
  }
  return assertBoundedString(value, scope, maxBytes);
}

function boundedQueryLimit(value, fallback, hardLimit) {
  return boundedPositiveInteger(value, fallback, hardLimit);
}

function boundedQueryOffset(value, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return 0;
  }
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function boundedSyncSeconds(value, limits) {
  const seconds = boundedPositiveInteger(value, 300, limits.maxSyncSeconds);
  return Math.max(limits.minSyncSeconds, seconds);
}

function normalizePort(value, fallback, scope) {
  const candidate = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65_535) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `Invalid ${scope}`,
    );
  }
  return candidate;
}

function normalizeEmailAddress(value, scope, limits) {
  const email = assertBoundedString(
    value,
    scope,
    limits.maxAddressBytes,
  ).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `Invalid ${scope}`,
    );
  }
  return email;
}

function defaultHost(prefix, email) {
  const domain = email.split("@")[1];
  return `${prefix}.${domain}`;
}

function normalizeAccountConfig(config, limits, options = {}) {
  assertPlainObject(config, "email_account_config");
  const passwordRequired = options.passwordRequired !== false;
  const email = normalizeEmailAddress(
    config.email,
    "email_account_email",
    limits,
  );
  const password = optionalBoundedString(
    config.password,
    "email_account_password",
    limits.maxPasswordBytes,
  );
  if (passwordRequired && !password) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      "email_account_password",
      "Email account password is required",
    );
  }
  return {
    email,
    displayName:
      optionalBoundedString(
        config.displayName,
        "email_account_display_name",
        limits.maxSubjectBytes,
      ) || email,
    imapHost:
      optionalBoundedString(
        config.imapHost,
        "email_account_imap_host",
        limits.maxAddressBytes,
      ) || defaultHost("imap", email),
    imapPort: normalizePort(config.imapPort, 993, "email_account_imap_port"),
    imapTls: config.imapTls !== false,
    smtpHost:
      optionalBoundedString(
        config.smtpHost,
        "email_account_smtp_host",
        limits.maxAddressBytes,
      ) || defaultHost("smtp", email),
    smtpPort: normalizePort(config.smtpPort, 587, "email_account_smtp_port"),
    smtpSecure: config.smtpSecure === true,
    password,
    syncFrequency: boundedSyncSeconds(config.syncFrequency, limits),
    autoSync: config.autoSync !== false,
  };
}

function normalizeAccountUpdates(updates, limits) {
  assertPlainObject(updates, "email_account_updates");
  const normalized = [];
  let password;
  let autoSync;

  for (const [key, value] of Object.entries(updates)) {
    if (key === "password") {
      if (value != null && value !== "") {
        password = assertBoundedString(
          value,
          "email_account_password",
          limits.maxPasswordBytes,
        );
      }
      continue;
    }
    if (key === "autoSync") {
      if (typeof value !== "boolean") {
        throw new EmailIPCBoundaryError(
          "INVALID_ARGUMENT",
          "email_account_auto_sync",
          "autoSync must be a boolean",
        );
      }
      autoSync = value;
      continue;
    }

    const column = EMAIL_ACCOUNT_UPDATE_FIELDS[key];
    if (!column) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        "email_account_update_field",
        `Unsupported email account update field: ${key}`,
      );
    }

    switch (key) {
      case "email":
        normalized.push([
          column,
          normalizeEmailAddress(value, "email_account_email", limits),
        ]);
        break;
      case "displayName":
      case "imapHost":
      case "smtpHost":
        normalized.push([
          column,
          assertBoundedString(
            value,
            `email_account_${key}`,
            limits.maxAddressBytes,
          ),
        ]);
        break;
      case "imapPort":
        normalized.push([
          column,
          normalizePort(value, 993, "email_account_imap_port"),
        ]);
        break;
      case "smtpPort":
        normalized.push([
          column,
          normalizePort(value, 587, "email_account_smtp_port"),
        ]);
        break;
      case "imapTls":
      case "smtpSecure":
        if (typeof value !== "boolean") {
          throw new EmailIPCBoundaryError(
            "INVALID_ARGUMENT",
            `email_account_${key}`,
            `${key} must be a boolean`,
          );
        }
        normalized.push([column, value ? 1 : 0]);
        break;
      case "status":
        if (!new Set(["active", "paused"]).has(value)) {
          throw new EmailIPCBoundaryError(
            "INVALID_ARGUMENT",
            "email_account_status",
            "Unsupported email account status",
          );
        }
        normalized.push([column, value]);
        break;
      case "syncFrequency":
        normalized.push([column, boundedSyncSeconds(value, limits)]);
        break;
      default:
        break;
    }
  }

  if (
    normalized.length === 0 &&
    password === undefined &&
    autoSync === undefined
  ) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      "email_account_updates",
      "Email account updates cannot be empty",
    );
  }
  return Object.freeze({ normalized, password, autoSync });
}

function normalizeFetchOptions(options, limits) {
  const value =
    options == null ? {} : assertPlainObject(options, "email_fetch_options");
  let since = null;
  if (value.since != null && value.since !== "") {
    const date = new Date(value.since);
    if (!Number.isFinite(date.getTime())) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        "email_fetch_since",
        "Invalid email fetch date",
      );
    }
    since = date;
  }
  return {
    mailbox:
      optionalBoundedString(
        value.mailbox,
        "email_fetch_mailbox",
        limits.maxAddressBytes,
      ) || "INBOX",
    limit: boundedQueryLimit(value.limit, 50, limits.maxEmails),
    unseen: value.unseen === true,
    since,
  };
}

function normalizeEmailListOptions(options, limits) {
  const value =
    options == null ? {} : assertPlainObject(options, "email_list_options");
  const result = {
    limit: boundedQueryLimit(value.limit, 100, limits.maxEmails),
    offset: boundedQueryOffset(value.offset, limits.maxQueryOffset),
  };
  for (const key of ["accountId", "mailboxId"]) {
    if (value[key] != null && value[key] !== "") {
      result[key] = assertBoundedString(
        value[key],
        `email_list_${key}`,
        limits.maxIdBytes,
      );
    }
  }
  for (const key of ["isRead", "isStarred", "isArchived"]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") {
        throw new EmailIPCBoundaryError(
          "INVALID_ARGUMENT",
          `email_list_${key}`,
          `${key} must be a boolean`,
        );
      }
      result[key] = value[key];
    }
  }
  return result;
}

function toBuffer(content, scope) {
  if (Buffer.isBuffer(content)) {
    return Buffer.from(content);
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  throw new EmailIPCBoundaryError(
    "INVALID_ARGUMENT",
    scope,
    "Attachment content must be binary data",
  );
}

function normalizeOutgoingAttachments(attachments, limits) {
  if (attachments == null) {
    return [];
  }
  if (!Array.isArray(attachments)) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      "email_attachments",
      "Email attachments must be an array",
    );
  }
  if (attachments.length > limits.maxOutgoingAttachments) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      "email_attachments",
      "Too many email attachments",
      { limit: { maxItems: limits.maxOutgoingAttachments } },
    );
  }

  let totalBytes = 0;
  return attachments.map((attachment, index) => {
    assertPlainObject(attachment, `email_attachment_${index}`);
    if ("path" in attachment) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        `email_attachment_${index}_path`,
        "Renderer-supplied attachment paths are not allowed",
      );
    }
    const content = toBuffer(
      attachment.content,
      `email_attachment_${index}_content`,
    );
    if (content.byteLength > limits.maxAttachmentBytes) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        `email_attachment_${index}_content`,
        "Email attachment is too large",
        { limit: { maxBytes: limits.maxAttachmentBytes } },
      );
    }
    totalBytes += content.byteLength;
    if (totalBytes > limits.maxOutgoingAttachmentBytes) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        "email_attachments_total",
        "Email attachments exceed the total byte limit",
        { limit: { maxBytes: limits.maxOutgoingAttachmentBytes } },
      );
    }
    return {
      filename: assertBoundedString(
        attachment.filename,
        `email_attachment_${index}_filename`,
        limits.maxMetadataBytes,
      ),
      contentType:
        optionalBoundedString(
          attachment.contentType,
          `email_attachment_${index}_content_type`,
          limits.maxMetadataBytes,
        ) || undefined,
      content,
    };
  });
}

function normalizeAddressField(value, scope, limits, required = false) {
  const serialized = Array.isArray(value) ? value.join(", ") : value;
  return assertBoundedString(
    serialized == null ? "" : serialized,
    scope,
    limits.maxAddressBytes,
    { allowEmpty: !required },
  );
}

function normalizeMailOptions(mailOptions, limits) {
  assertPlainObject(mailOptions, "email_mail_options");
  return {
    to: normalizeAddressField(mailOptions.to, "email_mail_to", limits, true),
    cc: normalizeAddressField(mailOptions.cc, "email_mail_cc", limits),
    bcc: normalizeAddressField(mailOptions.bcc, "email_mail_bcc", limits),
    subject: assertBoundedString(
      mailOptions.subject == null ? "" : mailOptions.subject,
      "email_mail_subject",
      limits.maxSubjectBytes,
      { allowEmpty: true },
    ),
    text: assertBoundedString(
      mailOptions.text == null ? "" : mailOptions.text,
      "email_mail_text",
      limits.maxTextBytes,
      { allowEmpty: true },
    ),
    html: assertBoundedString(
      mailOptions.html == null ? "" : mailOptions.html,
      "email_mail_html",
      limits.maxHtmlBytes,
      { allowEmpty: true },
    ),
    attachments: normalizeOutgoingAttachments(mailOptions.attachments, limits),
  };
}

function normalizeStringArray(value, scope, limits) {
  if (value == null) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length > limits.maxOutgoingAttachments * 10
  ) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `Invalid ${scope}`,
    );
  }
  const result = value.map((item, index) =>
    assertBoundedString(item, `${scope}_${index}`, limits.maxAddressBytes),
  );
  if (byteLength(JSON.stringify(result)) > limits.maxMetadataBytes) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      scope,
      `Oversized ${scope}`,
    );
  }
  return result;
}

function normalizeDraftData(draftData, limits) {
  assertPlainObject(draftData, "email_draft");
  const attachments = draftData.attachments || [];
  if (
    !Array.isArray(attachments) ||
    attachments.length > limits.maxOutgoingAttachments
  ) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      "email_draft_attachments",
      "Invalid draft attachments",
    );
  }
  const attachmentMetadata = attachments.map((attachment, index) => {
    assertPlainObject(attachment, `email_draft_attachment_${index}`);
    const size = Number(attachment.size || 0);
    if (
      !Number.isFinite(size) ||
      size < 0 ||
      size > limits.maxAttachmentBytes
    ) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        `email_draft_attachment_${index}_size`,
        "Invalid draft attachment size",
      );
    }
    return {
      filename: assertBoundedString(
        attachment.filename || attachment.name,
        `email_draft_attachment_${index}_filename`,
        limits.maxMetadataBytes,
      ),
      size: Math.floor(size),
      contentType: optionalBoundedString(
        attachment.contentType || attachment.type,
        `email_draft_attachment_${index}_content_type`,
        limits.maxMetadataBytes,
      ),
    };
  });
  if (
    byteLength(JSON.stringify(attachmentMetadata)) > limits.maxMetadataBytes
  ) {
    throw new EmailIPCBoundaryError(
      "INVALID_ARGUMENT",
      "email_draft_attachments",
      "Oversized draft attachment metadata",
    );
  }
  return {
    id:
      draftData.id == null
        ? null
        : assertBoundedString(
            draftData.id,
            "email_draft_id",
            limits.maxIdBytes,
          ),
    to: normalizeStringArray(draftData.to, "email_draft_to", limits),
    cc: normalizeStringArray(draftData.cc, "email_draft_cc", limits),
    bcc: normalizeStringArray(draftData.bcc, "email_draft_bcc", limits),
    subject: assertBoundedString(
      draftData.subject || "",
      "email_draft_subject",
      limits.maxSubjectBytes,
      { allowEmpty: true },
    ),
    text: assertBoundedString(
      draftData.text || "",
      "email_draft_text",
      limits.maxTextBytes,
      { allowEmpty: true },
    ),
    html: assertBoundedString(
      draftData.html || "",
      "email_draft_html",
      limits.maxHtmlBytes,
      { allowEmpty: true },
    ),
    attachments: attachmentMetadata,
    replyToId:
      draftData.replyToId == null
        ? null
        : assertBoundedString(
            draftData.replyToId,
            "email_draft_reply_to_id",
            limits.maxIdBytes,
          ),
    forwardId:
      draftData.forwardId == null
        ? null
        : assertBoundedString(
            draftData.forwardId,
            "email_draft_forward_id",
            limits.maxIdBytes,
          ),
  };
}

function truncateUtf8(value, maxBytes) {
  const text = value == null ? "" : String(value);
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return text;
  }
  return encoded
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
}

module.exports = {
  DEFAULT_EMAIL_IPC_LIMITS,
  EMAIL_ACCOUNT_UPDATE_FIELDS,
  EmailIPCBoundaryError,
  HARD_EMAIL_IPC_LIMITS,
  assertBoundedString,
  assertPlainObject,
  boundedPositiveInteger,
  boundedQueryLimit,
  boundedQueryOffset,
  boundedSyncSeconds,
  createEmailIPCLimits,
  normalizeAccountConfig,
  normalizeAccountUpdates,
  normalizeDraftData,
  normalizeEmailListOptions,
  normalizeFetchOptions,
  normalizeMailOptions,
  normalizeOutgoingAttachments,
  truncateUtf8,
};
