#!/usr/bin/env node
/**
 * Phase 6 smoke — exercise the AlipayBillAdapter end-to-end through the
 * CLI hub wiring with a temp hub dir + synthetic CSV.
 *
 * No real ZIP needed — we drop a CSV directly via `csvPath`. ZIP
 * extraction is covered by adapter unit tests (mocked admZipImpl).
 *
 * Verifies:
 *   1. registerAlipay persists account; listAlipayAccounts redacts password
 *   2. importAlipayBill with csvPath ingests 5 transactions
 *   3. vault.queryEvents returns the right 5 by adapter
 *   4. Re-import of same CSV adds 0 new events (originalId dedup)
 *   5. Hub teardown + re-init auto-registers the saved account
 *   6. unregisterAlipay removes account + adapter from registry
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMP_ROOT = mkdtempSync(join(tmpdir(), "cc-hub-alipay-smoke-"));
process.env.APPDATA = TEMP_ROOT;
process.env.XDG_CONFIG_HOME = TEMP_ROOT;

const { getHub, close, resolveHubDir } = await import(
  "../src/lib/personal-data-hub-wiring.js"
);

const SAMPLE_CSV = [
  "支付宝交易记录明细查询",
  "账号:[smoke@example.com]",
  "起始日期:[2024-04-01 00:00:00]    终止日期:[2024-05-01 00:00:00]",
  "---------------------------------交易记录明细列表------------------------------",
  "交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态",
  "2024040122001112345678,T20240401XXXX,2024-04-01 09:23:11,2024-04-01 09:23:13,2024-04-01 09:23:13,支付宝网站,即时到账交易,美团,美团外卖订单,38.50,支出,交易成功,0.00,0.00,,已支出",
  "2024040522001112345679,,2024-04-05 14:00:00,2024-04-05 14:00:02,2024-04-05 14:00:02,客户端,转账,张三,生日礼物,500.00,支出,交易成功,0.00,0.00,生日快乐,已支出",
  "2024041022001112345680,REFUND123,2024-04-10 10:00:00,2024-04-10 10:00:05,2024-04-10 10:00:05,支付宝网站,退款,淘宝,运动鞋退款,299.00,收入,退款成功,0.00,299.00,,已收入",
  "2024041522001112345681,JD2024004,2024-04-15 11:30:00,2024-04-15 11:30:05,2024-04-15 11:30:05,客户端,即时到账交易,京东,iPhone 17 256GB,9999.00,支出,交易成功,0.00,0.00,生日自买,已支出",
  "2024042022001112345682,,2024-04-20 08:00:00,2024-04-20 08:00:02,2024-04-20 08:00:02,客户端,缴费,国家电网,4月电费,156.78,支出,交易成功,0.00,0.00,,已支出",
  "---------------------------------交易记录明细列表结束------------------------------",
  "导出时间:[2024-05-02 09:00:00]    用户姓名:[张三]",
].join("\n");

const TEST_EMAIL = "smoke@example.com";

function fail(msg) {
  console.error("\nFAIL:", msg);
  process.exit(1);
}

async function main() {
  console.log("== Phase 6 smoke (Alipay bill import) ==");
  console.log("temp dir:", TEMP_ROOT);

  // ── 1. Setup: write a synthetic CSV to temp ──
  const hubDir = (await getHub()).hubDir;
  const csvPath = join(hubDir, "test-bill.csv");
  writeFileSync(csvPath, SAMPLE_CSV, "utf-8");
  console.log("hub init OK; wrote CSV at", csvPath);

  // ── 2. registerAlipay + listAlipayAccounts ──
  let hub = await getHub();
  const reg = await hub.registerAlipayAdapter({
    account: { email: TEST_EMAIL, zipPassword: "FAKE-PASSWORD-NOT-REAL" },
  });
  console.log("registerAlipayAdapter →", reg);
  if (reg.name !== "alipay-bill") fail(`expected name alipay-bill, got ${reg.name}`);

  const accounts = hub.listAlipayAccounts();
  console.log("listAlipayAccounts →", accounts);
  if (accounts.length !== 1) fail("expected 1 account");
  if (accounts[0].email !== TEST_EMAIL) fail("email mismatch");
  if (accounts[0].zipPassword) fail("zipPassword LEAK in listAlipayAccounts!");
  if (!accounts[0].hasZipPassword) fail("hasZipPassword should be true");

  // ── 3. importAlipayBill with csvPath ──
  const report = await hub.importAlipayBill({ csvPath });
  console.log("importAlipayBill →", {
    status: report.status,
    rawCount: report.rawCount,
    events: report.entityCounts?.events,
    persons: report.entityCounts?.persons,
    items: report.entityCounts?.items,
    durationMs: report.durationMs,
  });
  if (report.status !== "ok") fail(`import status=${report.status}, error=${report.error}`);
  if (report.rawCount !== 5) fail(`expected 5 raws, got ${report.rawCount}`);
  if (report.entityCounts?.events !== 5) fail(`expected 5 events, got ${report.entityCounts?.events}`);

  // ── 4. queryEvents returns the right 5 ──
  const events = hub.vault.queryEvents({ adapter: "alipay-bill", limit: 100 });
  console.log(`vault.queryEvents(adapter=alipay-bill) → ${events.length} events`);
  if (events.length !== 5) fail(`expected 5 events in vault, got ${events.length}`);

  // ── 5. Re-import same CSV → 0 new events (dedup via originalId) ──
  const report2 = await hub.importAlipayBill({ csvPath });
  console.log("re-import →", {
    rawCount: report2.rawCount,
    events: report2.entityCounts?.events,
  });
  // rawCount = 5 (parser re-reads CSV) but the deduped DB count stays at 5
  const eventsAfter = hub.vault.queryEvents({ adapter: "alipay-bill", limit: 100 });
  if (eventsAfter.length !== 5) {
    fail(`re-import created duplicates: expected 5 events still, got ${eventsAfter.length}`);
  }
  console.log("dedup ✓ — still 5 events after re-import");

  // ── 6. Tear down + re-init → auto-register ──
  close();
  hub = await getHub();
  const adaptersAfter = hub.registry.list();
  console.log("after re-init, adapters:", adaptersAfter.map((a) => a.name));
  if (!adaptersAfter.some((a) => a.name === "alipay-bill")) {
    fail("Alipay adapter not auto-registered on re-init");
  }

  // ── 7. unregisterAlipay removes account ──
  const removed = await hub.unregisterAlipayAdapter(TEST_EMAIL);
  console.log("unregisterAlipayAdapter →", removed);
  if (!removed.ok || !removed.removed) fail("unregister did not remove");
  const after = hub.listAlipayAccounts();
  if (after.length !== 0) fail("expected 0 accounts after unregister");

  // Verify vault data is preserved (events stay even after unregister)
  const eventsAfterUnregister = hub.vault.queryEvents({ adapter: "alipay-bill", limit: 100 });
  if (eventsAfterUnregister.length !== 5) {
    fail(`unregister wiped vault data! Expected 5, got ${eventsAfterUnregister.length}`);
  }
  console.log("vault data preserved after unregister ✓");

  // ── 8. spot check: an event has the right shape ──
  const meituanEvent = events.find((e) => e.content?.title?.includes("美团"));
  if (!meituanEvent) fail("Meituan event missing");
  console.log("Meituan event:", {
    subtype: meituanEvent.subtype,
    direction: meituanEvent.content.amount.direction,
    value: meituanEvent.content.amount.value,
    counterpartyKind: meituanEvent.extra.counterpartyKind,
  });
  if (meituanEvent.subtype !== "payment") fail(`expected subtype=payment, got ${meituanEvent.subtype}`);
  if (meituanEvent.content.amount.direction !== "out") fail("Meituan should be 'out'");
  if (meituanEvent.extra.counterpartyKind !== "merchant") fail("Meituan should be merchant");

  // ── 9. Authcode-style leak check: vault content shouldn't contain the password ──
  const dumpJson = JSON.stringify(events);
  if (dumpJson.includes("FAKE-PASSWORD-NOT-REAL")) {
    fail("ZIP password leaked into vault contents!");
  }
  console.log("password redaction in vault ✓");

  close();
  console.log("\n== Phase 6 smoke PASSED ==");
}

main()
  .catch((err) => {
    console.error("smoke crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(TEMP_ROOT, { recursive: true, force: true });
    } catch (_e) {}
  });
