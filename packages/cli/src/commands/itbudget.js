/**
 * `cc itbudget` — Iteration Budget V2 governance overlay.
 *
 * In-memory governance for iteration budget profiles + run lifecycle, layered
 * atop `lib/iteration-budget.js`.
 */

import {
  ITER_BUDGET_PROFILE_MATURITY_V2,
  ITER_RUN_LIFECYCLE_V2,
  setMaxActiveIterBudgetProfilesPerOwnerV2,
  getMaxActiveIterBudgetProfilesPerOwnerV2,
  setMaxPendingIterRunsPerProfileV2,
  getMaxPendingIterRunsPerProfileV2,
  setIterBudgetProfileIdleMsV2,
  getIterBudgetProfileIdleMsV2,
  setIterRunStuckMsV2,
  getIterRunStuckMsV2,
  registerIterBudgetProfileV2,
  activateIterBudgetProfileV2,
  pauseIterBudgetProfileV2,
  exhaustIterBudgetProfileV2,
  touchIterBudgetProfileV2,
  getIterBudgetProfileV2,
  listIterBudgetProfilesV2,
  createIterRunV2,
  startIterRunV2,
  completeIterRunV2,
  failIterRunV2,
  cancelIterRunV2,
  getIterRunV2,
  listIterRunsV2,
  autoPauseIdleIterBudgetProfilesV2,
  autoFailStuckIterRunsV2,
  getIterationBudgetGovStatsV2,
  _resetStateIterationBudgetV2,
} from "../lib/iteration-budget.js";

export function registerItBudgetCommand(program) {
  const ib = program
    .command("itbudget")
    .description("Iteration Budget V2 governance");
  ib.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: ITER_BUDGET_PROFILE_MATURITY_V2,
          runLifecycle: ITER_RUN_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  ib.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveIterBudgetProfilesPerOwner:
            getMaxActiveIterBudgetProfilesPerOwnerV2(),
          maxPendingIterRunsPerProfile: getMaxPendingIterRunsPerProfileV2(),
          iterBudgetProfileIdleMs: getIterBudgetProfileIdleMsV2(),
          iterRunStuckMs: getIterRunStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  ib.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveIterBudgetProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  ib.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingIterRunsPerProfileV2(Number(n));
    console.log("ok");
  });
  ib.command("set-idle-ms-v2 <n>").action((n) => {
    setIterBudgetProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  ib.command("set-stuck-ms-v2 <n>").action((n) => {
    setIterRunStuckMsV2(Number(n));
    console.log("ok");
  });
  ib.command("register-profile-v2 <id> <owner>")
    .option("--budget <n>", "budget")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerIterBudgetProfileV2({
            id,
            owner,
            budget: o.budget ? Number(o.budget) : undefined,
          }),
          null,
          2,
        ),
      ),
    );
  ib.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateIterBudgetProfileV2(id), null, 2)),
  );
  ib.command("pause-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(pauseIterBudgetProfileV2(id), null, 2)),
  );
  ib.command("exhaust-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(exhaustIterBudgetProfileV2(id), null, 2)),
  );
  ib.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchIterBudgetProfileV2(id), null, 2)),
  );
  ib.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getIterBudgetProfileV2(id), null, 2)),
  );
  ib.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listIterBudgetProfilesV2(), null, 2)),
  );
  ib.command("create-run-v2 <id> <profileId>")
    .option("--goal <g>", "goal")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(
          createIterRunV2({ id, profileId, goal: o.goal }),
          null,
          2,
        ),
      ),
    );
  ib.command("start-run-v2 <id>").action((id) =>
    console.log(JSON.stringify(startIterRunV2(id), null, 2)),
  );
  ib.command("complete-run-v2 <id>").action((id) =>
    console.log(JSON.stringify(completeIterRunV2(id), null, 2)),
  );
  ib.command("fail-run-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failIterRunV2(id, reason), null, 2)),
  );
  ib.command("cancel-run-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelIterRunV2(id, reason), null, 2)),
  );
  ib.command("get-run-v2 <id>").action((id) =>
    console.log(JSON.stringify(getIterRunV2(id), null, 2)),
  );
  ib.command("list-runs-v2").action(() =>
    console.log(JSON.stringify(listIterRunsV2(), null, 2)),
  );
  ib.command("auto-pause-idle-v2").action(() =>
    console.log(JSON.stringify(autoPauseIdleIterBudgetProfilesV2(), null, 2)),
  );
  ib.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckIterRunsV2(), null, 2)),
  );
  ib.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getIterationBudgetGovStatsV2(), null, 2)),
  );
  ib.command("reset-state-v2").action(() => {
    _resetStateIterationBudgetV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
