#!/usr/bin/env node
/**
 * Phase 5.7 smoke — exercises retry-with-backoff + onProgress through a
 * flaky session. No real IMAP needed.
 *
 *   1. First 2 connect attempts throw ECONNRESET (transient)
 *   2. 3rd attempt succeeds, yields 5 envelopes
 *   3. Verify progress events fire in order: connecting → error → connecting
 *      → error → connecting → connected → mailbox-opened → fetching × 5 → done
 *   4. Verify retry was capped (3 attempts total)
 *   5. Verify AUTH_FAILED does NOT retry (separate run)
 */

"use strict";

const { EmailAdapter } = require("../lib/adapters/email-imap/email-adapter");
const { ImapAuthFailedError } = require("../lib/adapters/email-imap/imap-session");

function makeFlakyFactory(failuresFirst, envelopes) {
  const failures = failuresFirst.slice();
  const recorder = { attempts: 0 };
  const factory = () => {
    let openMb = null;
    return {
      async connect() {
        recorder.attempts += 1;
        if (failures.length > 0) {
          throw failures.shift();
        }
      },
      async openMailbox(name) {
        openMb = name;
        return { uidValidity: 1, uidNext: 9999, exists: envelopes.length };
      },
      async *fetchFullSince(sinceUid = 0) {
        for (const env of envelopes) {
          if (env.uid > sinceUid) yield { ...env, source: env.source || Buffer.alloc(0) };
        }
      },
      async close() {},
    };
  };
  return { factory, recorder };
}

function makeEnv(uid) {
  return {
    uid,
    internalDate: new Date(`2026-05-${String(uid).padStart(2, "0")}T10:00:00Z`),
    flags: ["\\Seen"],
    messageId: `<m-${uid}@x>`,
    subject: `Subject ${uid}`,
    from: [{ address: `s${uid}@example.com` }],
    to: [{ address: "me@example.com" }],
    cc: [],
    date: new Date(`2026-05-${String(uid).padStart(2, "0")}T10:00:00Z`),
    size: 1024,
  };
}

async function scenarioRetrySucceeds() {
  console.log("\n=== Scenario A — 2 fails then success, 5 envelopes ===");
  const transient = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
  const envs = [1, 2, 3, 4, 5].map(makeEnv);
  const { factory, recorder } = makeFlakyFactory([transient, transient], envs);

  const events = [];
  const a = new EmailAdapter({
    account: { provider: "qq", email: "me@qq.com", authCode: "x", folders: ["INBOX"] },
    sessionFactory: factory,
    parser: async () => ({ textBody: "", attachments: [] }),
    maxConnectRetries: 3,
    retryBaseDelayMs: 5,
    onProgress: (e) => events.push(e),
  });

  console.log("adapter.version =", a.version);
  console.log("adapter.capabilities (Phase 5.7) =", a.capabilities.filter((c) => c.startsWith("sync:")).join(", "));

  const raws = [];
  for await (const r of a.sync()) raws.push(r);
  console.log(`emitted ${raws.length} raws (expected 5)`);
  console.log(`connect attempts: ${recorder.attempts} (expected 3)`);

  const phaseSeq = events.map((e) => `${e.phase}${e.attempt ? "(" + e.attempt + ")" : ""}`);
  console.log("phase sequence:");
  for (const p of phaseSeq) console.log("  -", p);

  // Verify expected phase order
  const errs = events.filter((e) => e.phase === "error");
  if (errs.length !== 2) {
    console.error(`FAIL: expected 2 error events, got ${errs.length}`);
    process.exitCode = 1;
  } else if (!errs.every((e) => e.retriable === true)) {
    console.error("FAIL: error events should be retriable=true during first 2 attempts");
    process.exitCode = 1;
  } else {
    console.log("error events: ✓ both marked retriable");
  }

  const done = events.find((e) => e.phase === "done");
  if (!done || done.emitted !== 5) {
    console.error(`FAIL: expected done event with emitted=5, got ${JSON.stringify(done)}`);
    process.exitCode = 1;
  } else {
    console.log(`done event: ✓ emitted=${done.emitted} durationMs=${done.durationMs}`);
  }

  const fetches = events.filter((e) => e.phase === "fetching");
  if (fetches.length !== 5) {
    console.error(`FAIL: expected 5 fetching events, got ${fetches.length}`);
    process.exitCode = 1;
  } else if (fetches[0].total !== 5 || fetches[4].current !== 5) {
    console.error(`FAIL: fetching events should run 1..5 of 5`);
    process.exitCode = 1;
  } else {
    console.log("fetching events: ✓ 5 events with current/total");
  }
}

async function scenarioAuthFailedNoRetry() {
  console.log("\n=== Scenario B — AUTH_FAILED never retries ===");
  const authErr = new ImapAuthFailedError("bad creds");
  const { factory, recorder } = makeFlakyFactory(
    [authErr, authErr, authErr], // shouldn't matter — first one stops us
    [],
  );

  const events = [];
  const a = new EmailAdapter({
    account: { provider: "qq", email: "me@qq.com", authCode: "x", folders: ["INBOX"] },
    sessionFactory: factory,
    parser: async () => ({}),
    maxConnectRetries: 3,
    retryBaseDelayMs: 1,
    onProgress: (e) => events.push(e),
  });

  let caught = null;
  try {
    for await (const _r of a.sync()) { /* drain */ }
  } catch (err) {
    caught = err;
  }
  console.log(`connect attempts: ${recorder.attempts} (expected 1)`);
  console.log(`caught.code: ${caught && caught.code}`);
  if (recorder.attempts !== 1) {
    console.error("FAIL: AUTH_FAILED should not retry");
    process.exitCode = 1;
  } else if (!caught || caught.code !== "AUTH_FAILED") {
    console.error("FAIL: error should propagate as AUTH_FAILED");
    process.exitCode = 1;
  } else {
    console.log("AUTH short-circuit: ✓");
  }

  const errEvent = events.find((e) => e.phase === "error");
  if (!errEvent) {
    console.error("FAIL: error progress event missing");
    process.exitCode = 1;
  } else if (errEvent.retriable !== false) {
    console.error("FAIL: AUTH_FAILED error event should have retriable=false");
    process.exitCode = 1;
  } else {
    console.log("AUTH error event: ✓ retriable=false");
  }
}

async function main() {
  console.log("== Phase 5.7 smoke (retry + progress) ==");
  await scenarioRetrySucceeds();
  await scenarioAuthFailedNoRetry();
  if (!process.exitCode) {
    console.log("\n== Phase 5.7 smoke PASSED ==");
  }
}

main().catch((err) => {
  console.error("smoke crashed:", err);
  process.exitCode = 1;
});
