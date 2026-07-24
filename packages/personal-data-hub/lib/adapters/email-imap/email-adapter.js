/**
 * EmailAdapter — Phase 5.1 of the Personal Data Hub.
 *
 * Connects to a user's IMAP mailbox (QQ / 189 / 163 / Outlook / Gmail /
 * custom), incrementally syncs new envelopes since the last watermark,
 * and emits one RawEvent per email. Body parsing + LLM classification +
 * 6-template extraction land in Phase 5.2–5.4; this phase just gets the
 * envelope flow working end-to-end with proper UIDVALIDITY-change
 * handling.
 *
 * Watermark format `<uidValidity>:<lastUid>`:
 *   - Same UIDVALIDITY  →  fetch UID > lastUid    (incremental)
 *   - Changed           →  reset lastUid = 0; vault dedupes via Message-ID
 */

"use strict";

const fs = require("node:fs");
const {
  EVENT_SUBTYPES,
  PERSON_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { newId } = require("../../ids");
const { createAccountScope } = require("../../account-scope");
const { resolveProvider } = require("./providers");
const {
  ImapSession,
  ImapAuthFailedError,
  ImapConnectionFailedError,
} = require("./imap-session");
const { parseRawEmail } = require("./email-parser");
const { classifyEmail, CATEGORIES } = require("./classifier");
const { extractFields } = require("./templates");
const { extractPdfText, passwordsFromHints } = require("./pdf-extractor");
const { extractTransactions } = require("./transactions");

const NAME = "email-imap";
// v0.8.0: healthCheck now validates sync-time snapshot input instead of
// discarding it, allowing Registry.syncAdapter(..., { inputPath }) to proceed.
const VERSION = "0.8.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const MAILBOX_WATERMARK_PREFIX = "imap-v2:";

class EmailAdapter {
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("EmailAdapter: opts required");
    }

    // Phase 5.8 — snapshot mode: Android EmailLocalCollector ships pre-fetched
    // {records:[]} JSON via ccRunner.syncAdapter("email-imap", path). When
    // snapshotMode=true: skip IMAP-account validation (no IMAP login needed)
    // and switch authenticate/sync to the snapshot path. The single registered
    // instance handles every Android vendor; each snapshot file carries its
    // own vendor + user, no per-account constructor needed (mirror of
    // travel-12306 / travel-baidu-map / social-bilibili snapshot mode).
    this._snapshotMode = !!opts.snapshotMode;

    if (!this._snapshotMode) {
      const account = opts.account;
      if (!account || typeof account !== "object") {
        throw new Error("EmailAdapter: opts.account required");
      }
      if (typeof account.email !== "string" || !account.email.includes("@")) {
        throw new Error("EmailAdapter: account.email must be a full address");
      }
      if (
        typeof account.authCode !== "string" ||
        account.authCode.length === 0
      ) {
        throw new Error(
          "EmailAdapter: account.authCode required (provider authorization code)",
        );
      }
      this.account = account;
      this._provider = resolveProvider(account);
    } else {
      // Snapshot-mode stub: account fields used by _envelopeToRawEvent/
      // normalize fall back to "(snapshot)" placeholders. Real per-record
      // vendor + user surface in the snapshot envelope payload instead.
      this.account = opts.account || {
        email: "(snapshot)",
        authCode: "(snapshot)",
      };
      this._provider = null;
    }

    this._sessionFactory =
      typeof opts.sessionFactory === "function"
        ? opts.sessionFactory
        : (cfg) => new ImapSession(cfg);

    // Phase 5.2: opt-out hook for tests that don't want to depend on
    // mailparser. parser must be `async (rawBuffer) => ParsedEmail`.
    this._parser =
      typeof opts.parser === "function" ? opts.parser : parseRawEmail;
    // Soft cap on bodies stored in vault content.text — long newsletter
    // HTML can be megabytes; trimming keeps `events` row + KG triple
    // + RAG embed budgets sane.
    this._maxBodyChars =
      Number.isFinite(opts.maxBodyChars) && opts.maxBodyChars > 0
        ? opts.maxBodyChars
        : 8000;

    // Phase 5.3: classifier configuration.
    // - opts.llm: optional LLMClient for Layer 2 + Phase-5.4 `other`-template
    //   summarization; absent → Layer 1 + regex-only extractors.
    // - opts.classifier: custom orchestrator (override for tests).
    // - opts.minLayer1Confidence: short-circuit threshold (default 0.85).
    // - opts.disableClassification: skip both layers entirely.
    this._llm =
      opts.llm && typeof opts.llm.chat === "function" ? opts.llm : null;
    this._classifier =
      typeof opts.classifier === "function" ? opts.classifier : classifyEmail;
    this._minLayer1Confidence = Number.isFinite(opts.minLayer1Confidence)
      ? opts.minLayer1Confidence
      : 0.85;
    this._disableClassification = !!opts.disableClassification;

    // Phase 5.4: template field extractor (regex-first, LLM-optional).
    // - opts.extractor: custom dispatcher (test seam).
    // - opts.disableExtraction: skip the per-email field-extraction call
    //   (e.g. when the registry only needs envelope+classification).
    this._extractor =
      typeof opts.extractor === "function" ? opts.extractor : extractFields;
    this._disableExtraction = !!opts.disableExtraction;

    // Phase 5.5: PDF attachment decryption + transactions extraction.
    // See pdf-extractor.js + transactions.js. Test seam: opts.pdfExtractor.
    this._pdfExtractor =
      typeof opts.pdfExtractor === "function"
        ? opts.pdfExtractor
        : extractPdfText;
    this._transactionsExtractor =
      typeof opts.transactionsExtractor === "function"
        ? opts.transactionsExtractor
        : extractTransactions;
    const hintsList = passwordsFromHints(opts.pdfPasswordHints || {});
    const userList = Array.isArray(opts.pdfPasswords)
      ? opts.pdfPasswords.filter((p) => typeof p === "string")
      : [];
    this._pdfPasswords = [...userList, ...hintsList].filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );
    this._disablePdfExtraction = !!opts.disablePdfExtraction;

    // Phase 5.7: connection retry + progress streaming.
    // - opts.maxConnectRetries (default 3): total attempts including first.
    //   Set to 1 to disable retry. Retries fire ONLY on transient errors
    //   (ECONNRESET / ETIMEDOUT / EPIPE / socket disconnects); AUTH_FAILED
    //   and MAILBOX_NOT_FOUND short-circuit.
    // - opts.retryBaseDelayMs (default 200): exponential backoff base.
    //   Actual delays: 200ms → 600ms → 1800ms for 3 attempts.
    // - opts.onProgress (callback): receives {phase, ...payload} events
    //   throughout sync(). Registry forwards via onSyncEvent so the WS/IPC
    //   layer can stream to UI. Phases:
    //     "connecting"   {attempt}
    //     "connected"
    //     "mailbox-opened" {mailbox, exists}
    //     "fetching"     {mailbox, current, total}
    //     "decrypting-pdf" {filename}
    //     "done"         {emitted, durationMs}
    //     "error"        {phase, message, retriable?}
    this._maxConnectRetries =
      Number.isFinite(opts.maxConnectRetries) && opts.maxConnectRetries > 0
        ? opts.maxConnectRetries
        : 3;
    this._retryBaseDelayMs =
      Number.isFinite(opts.retryBaseDelayMs) && opts.retryBaseDelayMs > 0
        ? opts.retryBaseDelayMs
        : 200;
    this._onProgress =
      typeof opts.onProgress === "function" ? opts.onProgress : null;

    this.name = NAME;
    this.watermarkStrategy = "explicit";
    // Android EmailLocalCollector writes the address as top-level `user`
    // rather than `account.email`. Use raw-value hashing to match the direct
    // IMAP adapter's createAccountScope(NAME, email) convention.
    this.snapshotScopeIdentityFields = ["email"];
    this.snapshotScopeTopLevelFields = ["user"];
    this.snapshotScopeIdentityIncludesField = false;
    if (!this._snapshotMode) {
      this.defaultScope = createAccountScope(NAME, this.account.email);
    }
    this.version = VERSION;
    this.capabilities = [
      ...(this._snapshotMode ? ["sync:snapshot"] : ["sync:imap"]),
      ...(this._snapshotMode ? [] : ["auth:authcode"]),
      "parse:mime-body",
      "parse:attachment-metadata",
      "classify:layer1-rules",
      ...(this._llm ? ["classify:layer2-llm"] : []),
      "extract:6-templates",
      ...(this._disablePdfExtraction ? [] : ["decrypt:pdf-bills"]),
      ...(this._snapshotMode
        ? []
        : ["sync:retry-backoff", "sync:progress-stream"]),
    ];
    this.rateLimits = { perMinute: 60 };
    this.dataDisclosure = {
      fields: [
        "email:headers (from/to/subject/date/messageId)",
        "email:flags + uid + internalDate",
        "email:body (text + html, capped to ~8k chars)",
        "email:attachment-metadata (filename, contentType, size, sha256; no file bytes saved in v0)",
        "classification:layer-1-rule-or-layer-2-llm-category (bill_bank/order/travel/etc.)",
        ...(this._disablePdfExtraction
          ? []
          : [
              "bill-transactions:date+description+amount+balance (extracted from decrypted PDF attachments; PDF bytes themselves never persist)",
            ]),
      ],
      sensitivity: "high",
      legalGate: false,
    };
  }

  async authenticate(ctx = {}) {
    // Readiness probe — cheap, NO IMAP network login. Report configured-ness
    // only so AdapterRegistry.readiness() never opens a live IMAP session on
    // every UI adapter-list load. Snapshot stub (no account) → NO_INPUT;
    // a per-account adapter → "configured" (the real sync surfaces auth
    // errors, and lastError carries the last live result).
    if (ctx && ctx.readinessOnly) {
      if (this._snapshotMode) {
        return {
          ok: false,
          reason: "NO_INPUT",
          message: "email-imap (snapshot mode): 需手机端采集邮件快照",
        };
      }
      return { ok: true, mode: "configured" };
    }

    // Phase 5.8 — snapshot mode authenticate: validate ctx.inputPath is
    // readable; no IMAP login. Snapshot mode WITHOUT inputPath in ctx
    // returns NO_INPUT (parallel to travel-12306 / travel-baidu-map shape).
    if (
      this._snapshotMode ||
      (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0)
    ) {
      if (
        !ctx ||
        typeof ctx.inputPath !== "string" ||
        ctx.inputPath.length === 0
      ) {
        return {
          ok: false,
          reason: "NO_INPUT",
          message: "email-imap (snapshot mode): ctx.inputPath required",
        };
      }
      try {
        fs.accessSync(ctx.inputPath, fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `snapshot not readable at ${ctx.inputPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }

    const session = this._sessionFactory(this._sessionConfig());
    try {
      await session.connect();
      return {
        ok: true,
        account: this.account.email,
        provider: this._provider.providerId,
      };
    } catch (err) {
      if (err instanceof ImapAuthFailedError) {
        return { ok: false, reason: "AUTH_FAILED", error: err.message };
      }
      if (err instanceof ImapConnectionFailedError) {
        return { ok: false, reason: "CONNECTION_FAILED", error: err.message };
      }
      return {
        ok: false,
        reason: "UNKNOWN",
        error: err && err.message ? err.message : String(err),
      };
    } finally {
      try {
        await session.close();
      } catch (_e) {}
    }
  }

  async healthCheck(opts = {}) {
    const r = await this.authenticate(opts);
    if (r.ok) return { ok: true, lastChecked: Date.now() };
    return { ok: false, reason: r.reason || "unknown", error: r.error };
  }

  async *sync(opts = {}) {
    // Phase 5.8 — snapshot mode: bypass IMAP session entirely, read Android
    // EmailLocalCollector's staging JSON, yield one raw event per record.
    // Classification + extraction reused on envelope-only data (bodyPreview
    // is the only text we get; PDF decryption skipped since attachment
    // buffers never crossed the Android → desktop boundary).
    if (
      this._snapshotMode ||
      (typeof opts.inputPath === "string" && opts.inputPath.length > 0)
    ) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    const folders =
      Array.isArray(opts.folders) && opts.folders.length > 0
        ? opts.folders
        : this._provider.folders;
    const maxPerFolder =
      Number.isFinite(opts.maxPerFolder) && opts.maxPerFolder > 0
        ? opts.maxPerFolder
        : 5000;
    const watermark =
      opts.sinceWatermark == null ? "" : String(opts.sinceWatermark);
    const watermarkState = parseMailboxWatermarks(watermark);

    // Phase 5.7: per-sync progress hook is the union of constructor + opts.
    // Callers (registry / tests) can pass a fresh callback per sync without
    // mutating the adapter instance.
    const syncOnProgress =
      typeof opts.onProgress === "function"
        ? opts.onProgress
        : this._onProgress;
    const emitProgress = (phase, payload = {}) => {
      if (!syncOnProgress) return;
      try {
        syncOnProgress({ phase, adapter: NAME, ...payload });
      } catch (_e) {
        // Listener errors must NOT abort the sync.
      }
    };

    const syncStart = Date.now();
    const session = this._sessionFactory(this._sessionConfig());
    let totalEmitted = 0;
    try {
      // Phase 5.7: connect with retry on transient errors.
      await this._connectWithRetry(session, emitProgress);

      for (const folder of folders) {
        const mb = await session.openMailbox(folder);
        emitProgress("mailbox-opened", {
          mailbox: folder,
          exists: mb.exists,
          uidValidity: mb.uidValidity,
        });
        const hasMailboxCursor = Object.prototype.hasOwnProperty.call(
          watermarkState.mailboxes,
          folder,
        );
        // A v1 cursor carried no folder identity. Reusing it for multiple
        // folders can skip lower UIDs in another mailbox, so migrate that
        // ambiguous case through a safe full re-scan (vault IDs dedupe it).
        const previous = hasMailboxCursor
          ? watermarkState.mailboxes[folder]
          : folders.length === 1
            ? watermarkState.legacy
            : { uidValidity: null, lastUid: 0 };
        const uvChanged =
          previous.uidValidity !== null &&
          String(previous.uidValidity) !== String(mb.uidValidity);
        const since = uvChanged ? 0 : previous.lastUid;

        let emitted = 0;
        let lastUid = since;
        for await (const env of session.fetchFullSince(since)) {
          emitProgress("fetching", {
            mailbox: folder,
            current: emitted + 1,
            total: mb.exists,
            uid: env.uid,
          });
          // Parse the body in the adapter (not the session) so the
          // session stays a thin IMAP wrapper. Parse failures degrade
          // gracefully — emit the raw event without parsedBody so the
          // registry's invalidCount tracker isn't tripped by every
          // weird MIME structure we hit in the wild.
          let parsedBody = null;
          try {
            if (env.source && env.source.length > 0) {
              // Phase 5.5: ask parser to keep attachment buffers when
              // we may need to decrypt PDFs. Buffers are stripped from
              // the emitted RawEvent (in _envelopeToRawEvent) so the
              // vault doesn't archive megabytes of PDF bytes.
              parsedBody = await this._parser(env.source, {
                keepAttachmentBuffers: !this._disablePdfExtraction,
              });
            }
          } catch (parseErr) {
            // Layer 1 classifier rules can still fire on envelope-only
            // facts; we just lose body text + attachments for this email.
            parsedBody = {
              parseError:
                parseErr && parseErr.message
                  ? parseErr.message
                  : String(parseErr),
            };
          }

          // Phase 5.3: classify. Layer 1 runs synchronously on
          // (from, subject, headers, attachment hints). If under the
          // confidence threshold AND we have an LLM, Layer 2 fires.
          // Classifier errors degrade to OTHER (never abort sync).
          let classification = null;
          if (!this._disableClassification) {
            try {
              classification = await this._classifier(
                this._classifierInput(env, parsedBody),
                {
                  llm: this._llm,
                  minLayer1Confidence: this._minLayer1Confidence,
                },
              );
            } catch (err) {
              classification = {
                category: CATEGORIES.OTHER,
                confidence: 0,
                layer: "error",
                error: err && err.message ? err.message : String(err),
              };
            }
          }

          // Phase 5.4: per-category template extraction.
          // Dispatcher routes via classification.category, so a missing
          // classification (disableClassification=true) maps to "other".
          let extraction = null;
          if (!this._disableExtraction) {
            try {
              extraction = await this._extractor(
                this._classifierInput(env, parsedBody),
                classification || { category: CATEGORIES.OTHER },
                { llm: this._llm },
              );
            } catch (err) {
              extraction = {
                template: "other",
                fields: {},
                confidence: 0,
                warnings: [
                  `extractor threw: ${err && err.message ? err.message : err}`,
                ],
              };
            }
          }

          // Phase 5.5: PDF attachment decryption + transactions extraction.
          // Runs only when the email was classified as a bill / travel AND
          // has at least one PDF attachment whose buffer is available.
          // Errors captured per-attachment, never thrown.
          if (
            !this._disablePdfExtraction &&
            extraction &&
            (extraction.template === "bill" ||
              extraction.template === "travel") &&
            parsedBody &&
            Array.isArray(parsedBody.attachments) &&
            parsedBody.attachments.some((a) => isPdfAttachment(a))
          ) {
            await this._runPdfExtraction(parsedBody, extraction);
          }

          yield this._envelopeToRawEvent(
            env,
            folder,
            parsedBody,
            classification,
            extraction,
          );
          emitted += 1;
          totalEmitted += 1;
          const uid = Number(env.uid);
          if (Number.isFinite(uid) && uid > lastUid) lastUid = uid;
          if (emitted >= maxPerFolder) break;
        }
        setMailboxCursor(watermarkState.mailboxes, folder, {
          uidValidity: mb.uidValidity == null ? null : String(mb.uidValidity),
          lastUid,
        });
        if (typeof opts.updateWatermark === "function") {
          opts.updateWatermark(
            formatMailboxWatermarks(watermarkState.mailboxes),
          );
        }
      }
      emitProgress("done", {
        emitted: totalEmitted,
        durationMs: Date.now() - syncStart,
      });
    } finally {
      try {
        await session.close();
      } catch (_e) {}
    }
  }

  /**
   * Phase 5.8 — snapshot path: read Android EmailLocalCollector's staging
   * JSON, convert each record to an IMAP-shaped envelope, run classifier +
   * extractor (no PDF — Android only ships bodyPreview), yield raw events.
   *
   * Expected snapshot shape (matches EmailLocalCollector.kt:135-156):
   *   {vendor, user, fetchedAt, records: [{
   *     messageNumber, subject, from, to, sentDateMs, bodyPreview,
   *     hasAttachments
   *   }]}
   *
   * Lossy compared to IMAP path:
   *   - No HTML body (Android Jakarta Mail only ships text/plain or
   *     stripped-html as bodyPreview, capped 8KB).
   *   - No attachment buffers → no PDF decryption / transaction extraction
   *     even for bill-template matches. `hasAttachments` boolean only.
   *   - No real Message-ID → originalId synthesized from
   *     `android-snapshot:<vendor>:<user>:<messageNumber>` (stable per device).
   *   - No flags / cc / size; UID = Android messageNumber (per-folder).
   */
  async *_syncViaSnapshot(opts) {
    const raw = fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `email-imap.sync (snapshot): bad JSON at ${opts.inputPath}: ${err.message}`,
      );
    }
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error(
        `email-imap.sync (snapshot): expected object, got ${typeof snapshot}`,
      );
    }
    if (!Array.isArray(snapshot.records)) {
      throw new Error(
        "email-imap.sync (snapshot): expected {records: [...]} shape (Android EmailLocalCollector writes this)",
      );
    }
    const vendor =
      typeof snapshot.vendor === "string" ? snapshot.vendor : "unknown";
    const user =
      typeof snapshot.user === "string" ? snapshot.user : "unknown@snapshot";
    const fallbackCapturedAt =
      Number.isFinite(snapshot.fetchedAt) && snapshot.fetchedAt > 0
        ? Math.floor(snapshot.fetchedAt)
        : Date.now();

    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    let emitted = 0;

    for (const r of snapshot.records) {
      if (emitted >= limit) return;
      if (!r || typeof r !== "object") continue;
      const env = this._androidRecordToEnvelope(
        r,
        vendor,
        user,
        fallbackCapturedAt,
      );
      // bodyPreview is the only text we have — wrap as a thin parsedBody so
      // the classifier sees the same shape it does for IMAP-fetched mail.
      const parsedBody = {
        textBody: typeof r.bodyPreview === "string" ? r.bodyPreview : "",
        htmlBody: "",
        attachments: r.hasAttachments
          ? [
              {
                filename: "(unknown)",
                contentType: "application/octet-stream",
                size: 0,
              },
            ]
          : [],
        headers: {},
      };

      let classification = null;
      if (!this._disableClassification) {
        try {
          classification = await this._classifier(
            this._classifierInput(env, parsedBody),
            { llm: this._llm, minLayer1Confidence: this._minLayer1Confidence },
          );
        } catch (err) {
          classification = {
            category: CATEGORIES.OTHER,
            confidence: 0,
            layer: "error",
            error: err && err.message ? err.message : String(err),
          };
        }
      }

      let extraction = null;
      if (!this._disableExtraction) {
        try {
          extraction = await this._extractor(
            this._classifierInput(env, parsedBody),
            classification || { category: CATEGORIES.OTHER },
            { llm: this._llm },
          );
        } catch (err) {
          extraction = {
            template: null,
            fields: null,
            warnings: [
              `extractor threw: ${err && err.message ? err.message : err}`,
            ],
          };
        }
      }

      // PDF extraction intentionally skipped — attachment buffers never crossed
      // the Android → desktop boundary. Bill-template extractions on snapshot
      // records get extraction.fields but no transactions list.
      yield this._envelopeToRawEvent(
        env,
        "INBOX",
        parsedBody,
        classification,
        extraction,
      );
      emitted += 1;
    }
  }

  /**
   * Convert Android EmailLocalCollector record → IMAP-shaped envelope.
   * Address strings ("Name <addr@x>" / "addr@x" / "addr@x, addr2@y") parse
   * into {address, name} objects matching mailparser's output. Multi-recipient
   * `to` strings split on comma.
   */
  _androidRecordToEnvelope(r, vendor, user, fallbackCapturedAt) {
    const messageNumber = Number.isInteger(r.messageNumber)
      ? r.messageNumber
      : 0;
    const sentDate =
      Number.isFinite(r.sentDateMs) && r.sentDateMs > 0
        ? new Date(r.sentDateMs)
        : new Date(fallbackCapturedAt);
    return {
      uid: messageNumber,
      messageId: `android-snapshot:${vendor}:${user}:${messageNumber}`,
      folder: "INBOX",
      subject: typeof r.subject === "string" ? r.subject : "(no subject)",
      from:
        typeof r.from === "string" && r.from.length > 0
          ? [parseSnapshotAddress(r.from)]
          : [],
      to:
        typeof r.to === "string" && r.to.length > 0
          ? r.to
              .split(",")
              .map((s) => parseSnapshotAddress(s.trim()))
              .filter(Boolean)
          : [],
      cc: [],
      flags: [],
      size: 0,
      internalDate: sentDate,
      date: sentDate,
    };
  }

  /**
   * Phase 5.7: connect with retry on transient errors. Auth failures
   * (AUTH_FAILED) and mailbox-not-found (MAILBOX_NOT_FOUND) bypass retry —
   * those are user errors that won't fix themselves. Network blips
   * (ECONNRESET / ETIMEDOUT / EPIPE / socket errors / generic
   * CONNECTION_FAILED) get up to `_maxConnectRetries` attempts with
   * exponential backoff.
   */
  async _connectWithRetry(session, emitProgress) {
    const maxAttempts = this._maxConnectRetries;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      emitProgress("connecting", { attempt, maxAttempts });
      try {
        await session.connect();
        emitProgress("connected", { attempt });
        return;
      } catch (err) {
        lastErr = err;
        const transient = isTransientImapError(err);
        emitProgress("error", {
          failingPhase: "connecting",
          attempt,
          retriable: transient && attempt < maxAttempts,
          code: err && err.code,
          message: err && err.message ? err.message : String(err),
        });
        if (!transient || attempt >= maxAttempts) {
          throw err;
        }
        // Exponential backoff: base * 3^(attempt-1)
        const delay = this._retryBaseDelayMs * Math.pow(3, attempt - 1);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  normalize(raw) {
    if (!raw || typeof raw !== "object" || !raw.payload) {
      throw new Error("EmailAdapter.normalize: missing raw or raw.payload");
    }
    const env = raw.payload;
    const ingestedAt = Date.now();
    const occurredAt =
      (env.internalDate instanceof Date ? env.internalDate.getTime() : 0) ||
      (env.date instanceof Date ? env.date.getTime() : 0) ||
      raw.capturedAt ||
      ingestedAt;

    const persons = [];
    let actorId = "person-self";
    if (Array.isArray(env.from) && env.from.length > 0 && env.from[0].address) {
      const senderAddr = env.from[0].address.toLowerCase();
      const senderId = `person-email-${senderAddr}`;
      const senderName = env.from[0].name || senderAddr;
      persons.push({
        id: senderId,
        type: "person",
        subtype: PERSON_SUBTYPES.CONTACT,
        names: [senderName],
        identifiers: { email: [senderAddr] },
        ingestedAt,
        source: this._source(senderAddr, env.internalDate),
      });
      actorId = senderId;
    }

    const participants = ["person-self"];
    if (actorId !== "person-self") participants.push(actorId);

    const subject = env.subject || "(no subject)";

    // Phase 5.2: prefer the parsed text body over the envelope-only
    // placeholder. Falls back to the recipient prose when body parsing
    // failed or the email was envelope-only fetched.
    const parsedBody = env.parsedBody || null;
    let contentText;
    if (
      parsedBody &&
      typeof parsedBody.textBody === "string" &&
      parsedBody.textBody.length > 0
    ) {
      contentText = trim(parsedBody.textBody, this._maxBodyChars);
    } else if (
      parsedBody &&
      typeof parsedBody.htmlBody === "string" &&
      parsedBody.htmlBody.length > 0
    ) {
      // For HTML-only newsletters where the text/plain part is empty,
      // keep a crude strip — analysis prompts handle HTML fine, but
      // BM25 tokenization works better on stripped text.
      contentText = trim(stripHtml(parsedBody.htmlBody), this._maxBodyChars);
    } else {
      contentText = `From: ${env.from && env.from[0] ? formatAddr(env.from[0]) : "?"}; To: ${formatRecipients(env.to)}; subject: ${subject}`;
    }

    const event = {
      id: newId(),
      type: "event",
      subtype: EVENT_SUBTYPES.MESSAGE,
      occurredAt,
      actor: actorId,
      participants,
      content: {
        title: subject,
        text: contentText,
      },
      ingestedAt,
      source: this._source(env.messageId, env.internalDate),
      extra: {
        emailFolder: env.folder,
        messageId: env.messageId,
        from: env.from || [],
        to: env.to || [],
        cc: env.cc || [],
        flags: env.flags || [],
        uid: env.uid,
        size: env.size,
        accountEmail: this.account.email,
        ...(parsedBody && parsedBody.attachments
          ? {
              attachments: parsedBody.attachments.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                contentDisposition: a.contentDisposition,
                size: a.size,
                sha256: a.sha256,
                isInline: a.isInline,
                isEncrypted: a.isEncrypted,
              })),
            }
          : {}),
        ...(parsedBody && parsedBody.contentSha256
          ? { rawSha256: parsedBody.contentSha256 }
          : {}),
        ...(parsedBody && parsedBody.parseError
          ? { parseError: parsedBody.parseError }
          : {}),
        // List-Unsubscribe + other indicator headers will fuel Phase 5.3
        // classification — stash a small allowlist now.
        ...(parsedBody && parsedBody.headers
          ? {
              indicatorHeaders: pickIndicatorHeaders(parsedBody.headers),
            }
          : {}),
        // Phase 5.3: per-email category + which layer / rule decided it.
        // Phase 5.4 template extractors dispatched on `.classified`.
        ...(env.classification
          ? {
              classified: env.classification.category,
              classification: {
                category: env.classification.category,
                confidence: env.classification.confidence,
                layer: env.classification.layer,
                ...(env.classification.ruleName
                  ? { ruleName: env.classification.ruleName }
                  : {}),
                ...(env.classification.reason
                  ? { reason: env.classification.reason }
                  : {}),
              },
            }
          : {}),
        // Phase 5.4: structured fields from the per-category template.
        // Stored at top of extra so analysis prompts + KG ingestors can
        // see them without spelunking through `extraction.fields`.
        ...(env.extraction && env.extraction.fields
          ? {
              fields: env.extraction.fields,
              extractionTemplate: env.extraction.template,
              extractionConfidence: env.extraction.confidence,
              ...(env.extraction.warnings && env.extraction.warnings.length > 0
                ? { extractionWarnings: env.extraction.warnings }
                : {}),
              // Phase 5.5: per-attachment decrypt+extract summary so the
              // UI can flag "could not unlock this bill" + transactions
              // count. Actual transactions list lives at fields.transactions.
              ...(env.extraction.pdfExtraction
                ? { pdfExtraction: env.extraction.pdfExtraction }
                : {}),
            }
          : {}),
      },
    };

    // Phase 5.4 compliance redaction: emails containing verification
    // codes (OTP / 2FA) must NEVER persist their body in vault — even
    // an "expired" OTP is sensitive evidence of session activity.
    // Adapter_Email_IMAP.md §9.2 mandates "verificationCodePresent =
    // store metadata only".
    if (
      env.extraction &&
      env.extraction.template === "register" &&
      env.extraction.fields &&
      env.extraction.fields.verificationCodePresent
    ) {
      event.content.text = "(redacted: verification code email)";
    }

    return { events: [event], persons, places: [], items: [], topics: [] };
  }

  _sessionConfig() {
    return {
      host: this._provider.host,
      port: this._provider.port,
      secure: this._provider.secure,
      user: this.account.email,
      authCode: this.account.authCode,
    };
  }

  _envelopeToRawEvent(env, folder, parsedBody, classification, extraction) {
    const originalId =
      env.messageId && env.messageId.length > 0
        ? env.messageId
        : `mid-fallback:${this.account.email}:${folder}:${env.uid}`;
    const capturedAt =
      env.internalDate instanceof Date && env.internalDate.getTime() > 0
        ? env.internalDate.getTime()
        : Date.now();
    // Strip the raw `source` Buffer from payload — keeping it would
    // bloat the vault's raw_events archive 100x (raw is in worst case
    // hundreds of KB per email; the parsed body alone is enough for
    // re-derive). The source is recoverable by re-syncing if absolutely
    // needed.
    const { source: _src, ...envNoSource } = env;
    // Phase 5.5: also strip attachment buffers from parsedBody. Buffers
    // are loaded for PDF decryption then discarded — vault keeps only
    // metadata (filename / contentType / size / sha256).
    const safeBody = parsedBody ? stripAttachmentBuffers(parsedBody) : null;
    return {
      adapter: NAME,
      originalId,
      capturedAt,
      payload: {
        ...envNoSource,
        folder,
        ...(safeBody ? { parsedBody: safeBody } : {}),
        ...(classification ? { classification } : {}),
        ...(extraction ? { extraction } : {}),
      },
    };
  }

  /**
   * Phase 5.5 helper: for each PDF attachment with a buffer, try to
   * decrypt + extract text + parse transactions. Merges results into
   * `extraction.fields.transactions` and stamps `pdfExtraction` metadata
   * on the extraction so UI can surface failures.
   *
   * Side effects: mutates `extraction.fields` + adds `extraction.pdfExtraction`.
   * Errors captured, never thrown — preserves the "sync never aborts on
   * a single bad email" invariant.
   */
  async _runPdfExtraction(parsedBody, extraction) {
    const pdfAtts = parsedBody.attachments.filter((a) => isPdfAttachment(a));
    const results = [];
    const allTxns = [];

    for (const a of pdfAtts) {
      if (!Buffer.isBuffer(a.buffer)) {
        results.push({
          filename: a.filename,
          decrypted: false,
          attempted: 0,
          error: "no buffer (parser keepAttachmentBuffers=false?)",
        });
        continue;
      }
      try {
        const r = await this._pdfExtractor(a.buffer, {
          passwords: this._pdfPasswords,
        });
        const summary = {
          filename: a.filename,
          decrypted: r.decrypted,
          attempted: r.attempted,
          wasEncrypted: r.wasEncrypted,
          pageCount: r.pageCount,
          ...(r.password !== undefined ? { passwordUsed: "***" } : {}), // never persist the real password
          ...(r.error ? { error: r.error } : {}),
        };
        if (r.decrypted && typeof r.text === "string" && r.text.length > 0) {
          const txns = this._transactionsExtractor(r.text);
          if (Array.isArray(txns) && txns.length > 0) {
            for (const t of txns) {
              t.attachmentSha256 = a.sha256;
              allTxns.push(t);
            }
            summary.transactionsExtracted = txns.length;
          } else {
            summary.transactionsExtracted = 0;
          }
        }
        results.push(summary);
      } catch (err) {
        results.push({
          filename: a.filename,
          decrypted: false,
          attempted: 0,
          error: err && err.message ? err.message : String(err),
        });
      }
    }

    if (allTxns.length > 0) {
      extraction.fields = extraction.fields || {};
      extraction.fields.transactions = allTxns;
    }
    extraction.pdfExtraction = results;
  }

  _classifierInput(env, parsedBody) {
    return {
      from: env.from,
      subject: env.subject,
      attachments:
        parsedBody && Array.isArray(parsedBody.attachments)
          ? parsedBody.attachments
          : [],
      textBody: (parsedBody && parsedBody.textBody) || "",
      htmlBody: (parsedBody && parsedBody.htmlBody) || "",
      headers: parsedBody && parsedBody.headers ? parsedBody.headers : {},
    };
  }

  _source(originalId, internalDate) {
    return {
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt:
        internalDate instanceof Date && internalDate.getTime() > 0
          ? internalDate.getTime()
          : Date.now(),
      capturedBy: CAPTURED_BY.API,
      originalId:
        typeof originalId === "string" && originalId.length > 0
          ? originalId
          : undefined,
    };
  }
}

function parseWatermark(s) {
  if (typeof s !== "string" || s.length === 0) {
    return { uidValidity: null, lastUid: 0 };
  }
  const idx = s.indexOf(":");
  if (idx < 0) return { uidValidity: null, lastUid: 0 };
  const uv = s.slice(0, idx);
  const uid = parseInt(s.slice(idx + 1), 10);
  return {
    uidValidity: uv,
    lastUid: Number.isFinite(uid) && uid > 0 ? uid : 0,
  };
}

function formatWatermark(uidValidity, lastUid) {
  const uv = uidValidity == null ? "" : String(uidValidity);
  const uid = Number.isFinite(lastUid) && lastUid > 0 ? lastUid : 0;
  return `${uv}:${uid}`;
}

/**
 * Parse the per-mailbox v2 IMAP cursor while retaining support for the
 * original single `<uidValidity>:<lastUid>` watermark. A legacy cursor is
 * applied only when syncing one configured folder. For multiple folders its
 * origin is ambiguous, so the adapter safely re-scans and lets vault IDs
 * deduplicate before the successful run writes v2.
 */
function parseMailboxWatermarks(s) {
  const empty = {
    mailboxes: {},
    legacy: { uidValidity: null, lastUid: 0 },
  };
  if (typeof s !== "string" || !s.startsWith(MAILBOX_WATERMARK_PREFIX)) {
    return { ...empty, legacy: parseWatermark(s) };
  }
  try {
    const parsed = JSON.parse(s.slice(MAILBOX_WATERMARK_PREFIX.length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return empty;
    }
    const mailboxes = {};
    for (const [folder, cursor] of Object.entries(parsed)) {
      if (
        typeof folder !== "string" ||
        !cursor ||
        typeof cursor !== "object" ||
        Array.isArray(cursor)
      ) {
        continue;
      }
      const uid = Number(cursor.lastUid);
      setMailboxCursor(mailboxes, folder, {
        uidValidity:
          cursor.uidValidity == null ? null : String(cursor.uidValidity),
        lastUid: Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : 0,
      });
    }
    return { mailboxes, legacy: empty.legacy };
  } catch (_err) {
    // A malformed opaque cursor must fail safe by re-reading and relying on
    // vault deduplication, never by skipping data.
    return empty;
  }
}

function formatMailboxWatermarks(mailboxes) {
  const stable = {};
  for (const folder of Object.keys(mailboxes || {}).sort()) {
    const cursor = mailboxes[folder];
    if (!cursor || typeof cursor !== "object") continue;
    const uid = Number(cursor.lastUid);
    setMailboxCursor(stable, folder, {
      uidValidity:
        cursor.uidValidity == null ? null : String(cursor.uidValidity),
      lastUid: Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : 0,
    });
  }
  return MAILBOX_WATERMARK_PREFIX + JSON.stringify(stable);
}

function setMailboxCursor(target, folder, cursor) {
  Object.defineProperty(target, folder, {
    value: cursor,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function formatAddr(a) {
  if (!a || !a.address) return "?";
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/**
 * Phase 5.8 — snapshot mode address parser. Android records ship address
 * fields as strings like "Name <addr@x.com>" or "addr@x.com". Convert to
 * mailparser-compatible {address, name} shape. Returns null for blank input.
 */
function parseSnapshotAddress(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length === 0) return null;
  // "Name <addr@x>" form
  const m = t.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, "");
    return { address: m[2].trim(), name: name.length > 0 ? name : undefined };
  }
  // Bare address form
  return { address: t, name: undefined };
}

function formatRecipients(list) {
  if (!Array.isArray(list) || list.length === 0) return "?";
  const head = list.slice(0, 3).map(formatAddr).join(", ");
  return list.length > 3 ? `${head} (+${list.length - 3} more)` : head;
}

function trim(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[truncated ${s.length - max} chars]`;
}

/**
 * Quick HTML→plaintext for cases where text/plain part is missing.
 * Phase 5.4 templating may upgrade to cheerio if structure matters,
 * but for BM25 tokenization + LLM prompt prose, a basic strip is fine.
 */
function stripHtml(html) {
  return String(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pick the small set of headers Phase 5.3 classifier rules actually use,
 * so we don't bloat each Event row with the full header bag.
 */
const INDICATOR_HEADERS = [
  "list-unsubscribe",
  "list-id",
  "x-mailer",
  "x-priority",
  "auto-submitted",
  "precedence",
  "x-amazon-mail-relay-type",
  "feedback-id",
  "x-campaign",
  "x-mc-user",
];
function pickIndicatorHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const h of INDICATOR_HEADERS) {
    if (headers[h] !== undefined) out[h] = headers[h];
  }
  return out;
}

/**
 * Phase 5.7: decide if an IMAP error is worth retrying. Transient
 * network blips (ECONNRESET / ETIMEDOUT / EPIPE / connect-failed / socket-
 * disconnect / "connection lost") get a retry; auth failures / mailbox
 * misconfig do NOT.
 */
function isTransientImapError(err) {
  if (!err) return false;
  if (err.code === "AUTH_FAILED" || err.code === "MAILBOX_NOT_FOUND")
    return false;
  if (err.code === "CONNECTION_FAILED") return true;
  // Node-level network error codes
  const networkCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "ECONNREFUSED",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ENOTFOUND", // DNS can be transient on flaky networks
  ]);
  if (err.code && networkCodes.has(err.code)) return true;
  if (err.cause && err.cause.code && networkCodes.has(err.cause.code))
    return true;
  const msg = (err.message || "").toLowerCase();
  if (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("socket disconnect") ||
    msg.includes("connection lost") ||
    msg.includes("connection reset") ||
    msg.includes("write after end")
  ) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 5.5: detect PDF attachments. Goes by contentType first, falls
 * back to filename extension for senders that omit the MIME type.
 */
function isPdfAttachment(a) {
  if (!a || typeof a !== "object") return false;
  if (
    typeof a.contentType === "string" &&
    a.contentType.toLowerCase().includes("pdf")
  )
    return true;
  if (typeof a.filename === "string" && /\.pdf$/i.test(a.filename)) return true;
  return false;
}

/**
 * Phase 5.5: drop Buffer fields from each attachment before the parsed
 * body lands in the emitted RawEvent. Vault row size + WS-gateway
 * serialization cost would be dominated by attachment bytes otherwise.
 */
function stripAttachmentBuffers(parsedBody) {
  if (!parsedBody || !Array.isArray(parsedBody.attachments)) return parsedBody;
  return {
    ...parsedBody,
    attachments: parsedBody.attachments.map((a) => {
      if (!a || a.buffer == null) return a;
      const { buffer: _b, ...rest } = a;
      return rest;
    }),
  };
}

module.exports = {
  EmailAdapter,
  parseWatermark,
  formatWatermark,
  parseMailboxWatermarks,
  formatMailboxWatermarks,
  NAME,
  VERSION,
};
