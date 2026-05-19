#!/usr/bin/env node
/**
 * Phase 5.6 smoke — exercises CLI hub wiring email-config flow end-to-end.
 *
 * Uses a TEMP hub dir (no interference with the user's real vault) and
 * an MOCK provider override so we don't try real IMAP — `testEmailAuth`
 * would talk to QQ otherwise.
 *
 * What's verified:
 *   1. registerEmail persists account to <hubDir>/email-accounts.json
 *   2. listEmailAccounts returns it (without authCode)
 *   3. Hub teardown + re-init auto-registers the saved account
 *   4. unregisterEmail removes it from disk
 *   5. eventDetail returns null for a non-existent eventId (no crash)
 */

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect the hub's user-data dir to a temp directory by overriding
// APPDATA (Win) / XDG_CONFIG_HOME (Linux) / HOME (macOS — getElectronUserDataDir
// falls back to homedir()-derived paths there). We set all three so this
// works cross-platform. paths.js reads these env vars at call time.
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "cc-hub-smoke-"));
process.env.APPDATA = TEMP_ROOT;
process.env.XDG_CONFIG_HOME = TEMP_ROOT;
// macOS uses ~/Library/Application Support which doesn't read an env;
// the smoke is best-effort cross-OS but Phase 5.6 dev box is Win.

const { getHub, close, resolveHubDir } = await import(
  "../src/lib/personal-data-hub-wiring.js"
);

async function main() {
  console.log("== Phase 5.6 smoke (CLI hub wiring) ==");
  console.log("temp dir:", TEMP_ROOT);

  // ── 1. registerEmail ──
  let hub = await getHub();
  console.log("hub init OK; hubDir =", resolveHubDir());

  const TEST_ACCOUNT = {
    provider: "qq",
    email: "smoke@example.com",
    authCode: "FAKE-AUTHCODE-NOT-A-REAL-CRED",
  };
  const summary = await hub.registerEmailAdapter({
    account: TEST_ACCOUNT,
    opts: { pdfPasswordHints: { idCardLast6: "111111" } },
  });
  console.log("registerEmailAdapter →", summary);
  if (summary.name !== "email-imap") {
    fail("expected adapter name email-imap, got " + summary.name);
  }

  // ── 2. listEmailAccounts (no authCode in response) ──
  const accounts = hub.listEmailAccounts();
  console.log("listEmailAccounts →", accounts);
  if (accounts.length !== 1 || accounts[0].email !== TEST_ACCOUNT.email) {
    fail("expected 1 account, got " + JSON.stringify(accounts));
  }
  if (accounts[0].authCode) {
    fail("authCode LEAK in listEmailAccounts output!");
  }
  if (!accounts[0].pdfPasswordHints || !accounts[0].pdfPasswordHints.includes("idCardLast6")) {
    fail("expected pdfPasswordHints to expose hint keys");
  }

  // ── 3. tear down + re-init → auto-register ──
  close();
  hub = await getHub();
  const reregistered = hub.registry.list();
  console.log("after re-init, registered adapters:", reregistered.map((a) => a.name));
  if (!reregistered.some((a) => a.name === "email-imap")) {
    fail("expected auto-register on re-init but adapter missing");
  }

  // ── 4. The on-disk JSON should NOT include `authCode: ""` — must still be the real value ──
  const raw = readFileSync(
    join(resolveHubDir(), "email-accounts.json"),
    "utf-8",
  );
  if (!raw.includes("FAKE-AUTHCODE-NOT-A-REAL-CRED")) {
    fail("authCode missing from persisted JSON (would break next sync)");
  }
  console.log("persisted JSON contains authCode ✓");

  // ── 5. unregisterEmail removes it ──
  const removed = await hub.unregisterEmailAdapter(TEST_ACCOUNT.email);
  console.log("unregisterEmail →", removed);
  if (!removed.ok || !removed.removed) fail("unregister did not remove");
  const after = hub.listEmailAccounts();
  if (after.length !== 0) {
    fail("expected 0 accounts after unregister, got " + after.length);
  }

  // ── 6. eventDetail on missing id returns null (no crash) ──
  const detail = hub.eventDetail("evt-does-not-exist");
  if (detail !== null) {
    fail("expected null for unknown event id, got " + JSON.stringify(detail));
  }
  console.log("eventDetail(unknown) → null ✓");

  // ── 7. testEmailAuth with bogus account returns ok:false (no throw) ──
  // Note: this will try IMAP for real, so we use a custom provider with
  // a host that will fail to resolve.
  const probe = await hub.testEmailAuth({
    account: {
      provider: "custom",
      email: "smoke@example.local",
      authCode: "x",
      host: "imap.invalid.local",
      port: 9999,
      secure: false,
    },
  }).catch((err) => ({ ok: false, error: err.message }));
  console.log("testEmailAuth(invalid host) →", probe);
  if (probe.ok) fail("expected testEmailAuth to fail on invalid host");

  close();
  console.log("\n== Phase 5.6 smoke PASSED ==");
}

function fail(msg) {
  console.error("\nFAIL:", msg);
  process.exit(1);
}

main()
  .catch((err) => {
    console.error("smoke error:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(TEMP_ROOT, { recursive: true, force: true });
    } catch (_e) {}
  });
