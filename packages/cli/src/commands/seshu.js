/**
 * `cc seshu` — Session Usage V2 governance overlay (in-memory, atop lib/session-usage.js).
 */
import {
  SUSE_BUDGET_MATURITY_V2,
  SUSE_RECORD_LIFECYCLE_V2,
  setMaxActiveSuseBudgetsPerOwnerV2,
  getMaxActiveSuseBudgetsPerOwnerV2,
  setMaxPendingSuseRecordsPerBudgetV2,
  getMaxPendingSuseRecordsPerBudgetV2,
  setSuseBudgetIdleMsV2,
  getSuseBudgetIdleMsV2,
  setSuseRecordStuckMsV2,
  getSuseRecordStuckMsV2,
  registerSuseBudgetV2,
  activateSuseBudgetV2,
  exhaustSuseBudgetV2,
  archiveSuseBudgetV2,
  touchSuseBudgetV2,
  getSuseBudgetV2,
  listSuseBudgetsV2,
  createSuseRecordV2,
  recordingSuseRecordV2,
  recordSuseRecordV2,
  rejectSuseRecordV2,
  cancelSuseRecordV2,
  getSuseRecordV2,
  listSuseRecordsV2,
  autoExhaustIdleSuseBudgetsV2,
  autoRejectStuckSuseRecordsV2,
  getSessionUsageGovStatsV2,
  _resetStateSessionUsageV2,
} from "../lib/session-usage.js";

export function registerSeshuCommand(program) {
  const su = program
    .command("seshu")
    .description("Session Usage V2 governance");
  su.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          budgetMaturity: SUSE_BUDGET_MATURITY_V2,
          recordLifecycle: SUSE_RECORD_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  su.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveSuseBudgetsPerOwner: getMaxActiveSuseBudgetsPerOwnerV2(),
          maxPendingSuseRecordsPerBudget: getMaxPendingSuseRecordsPerBudgetV2(),
          suseBudgetIdleMs: getSuseBudgetIdleMsV2(),
          suseRecordStuckMs: getSuseRecordStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  su.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveSuseBudgetsPerOwnerV2(Number(n));
    console.log("ok");
  });
  su.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingSuseRecordsPerBudgetV2(Number(n));
    console.log("ok");
  });
  su.command("set-idle-ms-v2 <n>").action((n) => {
    setSuseBudgetIdleMsV2(Number(n));
    console.log("ok");
  });
  su.command("set-stuck-ms-v2 <n>").action((n) => {
    setSuseRecordStuckMsV2(Number(n));
    console.log("ok");
  });
  su.command("register-budget-v2 <id> <owner>")
    .option("--limit <n>", "limit")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerSuseBudgetV2({
            id,
            owner,
            limit: o.limit ? Number(o.limit) : undefined,
          }),
          null,
          2,
        ),
      ),
    );
  su.command("activate-budget-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateSuseBudgetV2(id), null, 2)),
  );
  su.command("exhaust-budget-v2 <id>").action((id) =>
    console.log(JSON.stringify(exhaustSuseBudgetV2(id), null, 2)),
  );
  su.command("archive-budget-v2 <id>").action((id) =>
    console.log(JSON.stringify(archiveSuseBudgetV2(id), null, 2)),
  );
  su.command("touch-budget-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchSuseBudgetV2(id), null, 2)),
  );
  su.command("get-budget-v2 <id>").action((id) =>
    console.log(JSON.stringify(getSuseBudgetV2(id), null, 2)),
  );
  su.command("list-budgets-v2").action(() =>
    console.log(JSON.stringify(listSuseBudgetsV2(), null, 2)),
  );
  su.command("create-record-v2 <id> <budgetId>")
    .option("--amount <n>", "amount")
    .action((id, budgetId, o) =>
      console.log(
        JSON.stringify(
          createSuseRecordV2({
            id,
            budgetId,
            amount: o.amount ? Number(o.amount) : undefined,
          }),
          null,
          2,
        ),
      ),
    );
  su.command("recording-record-v2 <id>").action((id) =>
    console.log(JSON.stringify(recordingSuseRecordV2(id), null, 2)),
  );
  su.command("record-record-v2 <id>").action((id) =>
    console.log(JSON.stringify(recordSuseRecordV2(id), null, 2)),
  );
  su.command("reject-record-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(rejectSuseRecordV2(id, reason), null, 2)),
  );
  su.command("cancel-record-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelSuseRecordV2(id, reason), null, 2)),
  );
  su.command("get-record-v2 <id>").action((id) =>
    console.log(JSON.stringify(getSuseRecordV2(id), null, 2)),
  );
  su.command("list-records-v2").action(() =>
    console.log(JSON.stringify(listSuseRecordsV2(), null, 2)),
  );
  su.command("auto-exhaust-idle-v2").action(() =>
    console.log(JSON.stringify(autoExhaustIdleSuseBudgetsV2(), null, 2)),
  );
  su.command("auto-reject-stuck-v2").action(() =>
    console.log(JSON.stringify(autoRejectStuckSuseRecordsV2(), null, 2)),
  );
  su.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getSessionUsageGovStatsV2(), null, 2)),
  );
  su.command("reset-state-v2").action(() => {
    _resetStateSessionUsageV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
