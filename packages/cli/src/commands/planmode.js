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

// === Iter26 V2 governance overlay ===
export function registerPlannergovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "planmode");
  if (!parent) return;
  const L = async () => await import("../lib/interactive-planner.js");
  parent
    .command("plannergov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PLANNERGOV_PROFILE_MATURITY_V2,
            promptLifecycle: m.PLANNERGOV_PROMPT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("plannergov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePlannergovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPlannergovPromptsPerProfileV2(),
            idleMs: m.getPlannergovProfileIdleMsV2(),
            stuckMs: m.getPlannergovPromptStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("plannergov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePlannergovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("plannergov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPlannergovPromptsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("plannergov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPlannergovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("plannergov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPlannergovPromptStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("plannergov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--persona <v>", "persona")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPlannergovProfileV2({ id, owner, persona: o.persona }),
          null,
          2,
        ),
      );
    });
  parent
    .command("plannergov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePlannergovProfileV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pausePlannergovProfileV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePlannergovProfileV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchPlannergovProfileV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getPlannergovProfileV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listPlannergovProfilesV2(), null, 2),
      );
    });
  parent
    .command("plannergov-create-prompt-v2 <id> <profileId>")
    .description("Create prompt")
    .option("--question <v>", "question")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPlannergovPromptV2({ id, profileId, question: o.question }),
          null,
          2,
        ),
      );
    });
  parent
    .command("plannergov-asking-prompt-v2 <id>")
    .description("Mark prompt as asking")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).askingPlannergovPromptV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-complete-prompt-v2 <id>")
    .description("Complete prompt")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completePromptPlannergovV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-fail-prompt-v2 <id> [reason]")
    .description("Fail prompt")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPlannergovPromptV2(id, reason), null, 2),
      );
    });
  parent
    .command("plannergov-cancel-prompt-v2 <id> [reason]")
    .description("Cancel prompt")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelPlannergovPromptV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("plannergov-get-prompt-v2 <id>")
    .description("Get prompt")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getPlannergovPromptV2(id), null, 2),
      );
    });
  parent
    .command("plannergov-list-prompts-v2")
    .description("List prompts")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listPlannergovPromptsV2(), null, 2),
      );
    });
  parent
    .command("plannergov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoPauseIdlePlannergovProfilesV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("plannergov-auto-fail-stuck-v2")
    .description("Auto-fail stuck prompts")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPlannergovPromptsV2(), null, 2),
      );
    });
  parent
    .command("plannergov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getInteractivePlannerGovStatsV2(), null, 2),
      );
    });
}

// === Iter28 V2 governance overlay: Pmodegov ===
export function registerPmodeV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "planmode");
  if (!parent) return;
  const L = async () => await import("../lib/plan-mode.js");
  parent
    .command("pmodegov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PMODEGOV_PROFILE_MATURITY_V2,
            planLifecycle: m.PMODEGOV_PLAN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pmodegov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePmodeProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPmodePlansPerProfileV2(),
            idleMs: m.getPmodeProfileIdleMsV2(),
            stuckMs: m.getPmodePlanStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pmodegov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePmodeProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmodegov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPmodePlansPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmodegov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPmodeProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmodegov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPmodePlanStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmodegov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--template <v>", "template")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPmodeProfileV2({ id, owner, template: o.template }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pmodegov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePmodeProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmodegov-paused-v2 <id>")
    .description("Paused profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pausedPmodeProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmodegov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePmodeProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmodegov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchPmodeProfileV2(id), null, 2));
    });
  parent
    .command("pmodegov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPmodeProfileV2(id), null, 2));
    });
  parent
    .command("pmodegov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPmodeProfilesV2(), null, 2));
    });
  parent
    .command("pmodegov-create-plan-v2 <id> <profileId>")
    .description("Create plan")
    .option("--planId <v>", "planId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPmodePlanV2({ id, profileId, planId: o.planId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pmodegov-planning-plan-v2 <id>")
    .description("Mark plan as planning")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).planningPmodePlanV2(id), null, 2));
    });
  parent
    .command("pmodegov-complete-plan-v2 <id>")
    .description("Complete plan")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completePlanPmodeV2(id), null, 2));
    });
  parent
    .command("pmodegov-fail-plan-v2 <id> [reason]")
    .description("Fail plan")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPmodePlanV2(id, reason), null, 2),
      );
    });
  parent
    .command("pmodegov-cancel-plan-v2 <id> [reason]")
    .description("Cancel plan")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPmodePlanV2(id, reason), null, 2),
      );
    });
  parent
    .command("pmodegov-get-plan-v2 <id>")
    .description("Get plan")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPmodePlanV2(id), null, 2));
    });
  parent
    .command("pmodegov-list-plans-v2")
    .description("List plans")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPmodePlansV2(), null, 2));
    });
  parent
    .command("pmodegov-auto-paused-idle-v2")
    .description("Auto-paused idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPausedIdlePmodeProfilesV2(), null, 2),
      );
    });
  parent
    .command("pmodegov-auto-fail-stuck-v2")
    .description("Auto-fail stuck plans")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPmodePlansV2(), null, 2),
      );
    });
  parent
    .command("pmodegov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getPmodegovStatsV2(), null, 2));
    });
}
