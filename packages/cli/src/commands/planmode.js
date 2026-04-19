/**
 * `cc planmode` — Plan Mode V2 governance overlay.
 *
 * In-memory governance for plan profiles + step lifecycle, layered atop
 * `lib/plan-mode.js`. Independent of any legacy plan invocation.
 */

import {
  PLAN_PROFILE_MATURITY_V2,
  PLAN_STEP_LIFECYCLE_V2,
  setMaxActivePlanProfilesPerOwnerV2,
  getMaxActivePlanProfilesPerOwnerV2,
  setMaxPendingPlanStepsPerProfileV2,
  getMaxPendingPlanStepsPerProfileV2,
  setPlanProfileIdleMsV2,
  getPlanProfileIdleMsV2,
  setPlanStepStuckMsV2,
  getPlanStepStuckMsV2,
  registerPlanProfileV2,
  activatePlanProfileV2,
  pausePlanProfileV2,
  archivePlanProfileV2,
  touchPlanProfileV2,
  getPlanProfileV2,
  listPlanProfilesV2,
  createPlanStepV2,
  startPlanStepV2,
  completePlanStepV2,
  failPlanStepV2,
  cancelPlanStepV2,
  getPlanStepV2,
  listPlanStepsV2,
  autoPauseIdlePlanProfilesV2,
  autoFailStuckPlanStepsV2,
  getPlanModeGovStatsV2,
  _resetStatePlanModeV2,
} from "../lib/plan-mode.js";

export function registerPlanModeCommand(program) {
  const pm = program.command("planmode").description("Plan Mode V2 governance");
  pm.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: PLAN_PROFILE_MATURITY_V2,
          stepLifecycle: PLAN_STEP_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  pm.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActivePlanProfilesPerOwner: getMaxActivePlanProfilesPerOwnerV2(),
          maxPendingPlanStepsPerProfile: getMaxPendingPlanStepsPerProfileV2(),
          planProfileIdleMs: getPlanProfileIdleMsV2(),
          planStepStuckMs: getPlanStepStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  pm.command("set-max-active-v2 <n>").action((n) => {
    setMaxActivePlanProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  pm.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingPlanStepsPerProfileV2(Number(n));
    console.log("ok");
  });
  pm.command("set-idle-ms-v2 <n>").action((n) => {
    setPlanProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  pm.command("set-stuck-ms-v2 <n>").action((n) => {
    setPlanStepStuckMsV2(Number(n));
    console.log("ok");
  });
  pm.command("register-profile-v2 <id> <owner>")
    .option("--goal <g>", "goal")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerPlanProfileV2({ id, owner, goal: o.goal }),
          null,
          2,
        ),
      ),
    );
  pm.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activatePlanProfileV2(id), null, 2)),
  );
  pm.command("pause-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(pausePlanProfileV2(id), null, 2)),
  );
  pm.command("archive-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(archivePlanProfileV2(id), null, 2)),
  );
  pm.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchPlanProfileV2(id), null, 2)),
  );
  pm.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getPlanProfileV2(id), null, 2)),
  );
  pm.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listPlanProfilesV2(), null, 2)),
  );
  pm.command("create-step-v2 <id> <profileId>")
    .option("--action <a>", "action")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(
          createPlanStepV2({ id, profileId, action: o.action }),
          null,
          2,
        ),
      ),
    );
  pm.command("start-step-v2 <id>").action((id) =>
    console.log(JSON.stringify(startPlanStepV2(id), null, 2)),
  );
  pm.command("complete-step-v2 <id>").action((id) =>
    console.log(JSON.stringify(completePlanStepV2(id), null, 2)),
  );
  pm.command("fail-step-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failPlanStepV2(id, reason), null, 2)),
  );
  pm.command("cancel-step-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelPlanStepV2(id, reason), null, 2)),
  );
  pm.command("get-step-v2 <id>").action((id) =>
    console.log(JSON.stringify(getPlanStepV2(id), null, 2)),
  );
  pm.command("list-steps-v2").action(() =>
    console.log(JSON.stringify(listPlanStepsV2(), null, 2)),
  );
  pm.command("auto-pause-idle-v2").action(() =>
    console.log(JSON.stringify(autoPauseIdlePlanProfilesV2(), null, 2)),
  );
  pm.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckPlanStepsV2(), null, 2)),
  );
  pm.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getPlanModeGovStatsV2(), null, 2)),
  );
  pm.command("reset-state-v2").action(() => {
    _resetStatePlanModeV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
