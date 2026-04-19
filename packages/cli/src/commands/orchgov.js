/**
 * `cc orchgov` — Orchestrator V2 governance overlay.
 *
 * In-memory governance for orchestrator profiles + task lifecycle, layered atop
 * `lib/orchestrator.js`. Independent of the legacy `cc orchestrate` command.
 */

import {
  ORCH_PROFILE_MATURITY_V2, ORCH_TASK_LIFECYCLE_V2,
  setMaxActiveOrchProfilesPerOwnerV2, getMaxActiveOrchProfilesPerOwnerV2,
  setMaxPendingOrchTasksPerProfileV2, getMaxPendingOrchTasksPerProfileV2,
  setOrchProfileIdleMsV2, getOrchProfileIdleMsV2,
  setOrchTaskStuckMsV2, getOrchTaskStuckMsV2,
  registerOrchProfileV2, activateOrchProfileV2, pauseOrchProfileV2, retireOrchProfileV2, touchOrchProfileV2, getOrchProfileV2, listOrchProfilesV2,
  createOrchTaskV2, dispatchOrchTaskV2, completeOrchTaskV2, failOrchTaskV2, cancelOrchTaskV2, getOrchTaskV2, listOrchTasksV2,
  autoPauseIdleOrchProfilesV2, autoFailStuckOrchTasksV2, getOrchestratorGovStatsV2, _resetStateOrchestratorV2,
} from "../lib/orchestrator.js";

export function registerOrchGovCommand(program) {
  const og = program.command("orchgov").description("Orchestrator V2 governance");
  og.command("enums-v2").action(() => console.log(JSON.stringify({ profileMaturity: ORCH_PROFILE_MATURITY_V2, taskLifecycle: ORCH_TASK_LIFECYCLE_V2 }, null, 2)));
  og.command("config-v2").action(() => console.log(JSON.stringify({ maxActiveOrchProfilesPerOwner: getMaxActiveOrchProfilesPerOwnerV2(), maxPendingOrchTasksPerProfile: getMaxPendingOrchTasksPerProfileV2(), orchProfileIdleMs: getOrchProfileIdleMsV2(), orchTaskStuckMs: getOrchTaskStuckMsV2() }, null, 2)));
  og.command("set-max-active-v2 <n>").action((n) => { setMaxActiveOrchProfilesPerOwnerV2(Number(n)); console.log("ok"); });
  og.command("set-max-pending-v2 <n>").action((n) => { setMaxPendingOrchTasksPerProfileV2(Number(n)); console.log("ok"); });
  og.command("set-idle-ms-v2 <n>").action((n) => { setOrchProfileIdleMsV2(Number(n)); console.log("ok"); });
  og.command("set-stuck-ms-v2 <n>").action((n) => { setOrchTaskStuckMsV2(Number(n)); console.log("ok"); });
  og.command("register-profile-v2 <id> <owner>").option("--source <s>", "source").action((id, owner, o) => console.log(JSON.stringify(registerOrchProfileV2({ id, owner, source: o.source }), null, 2)));
  og.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateOrchProfileV2(id), null, 2)));
  og.command("pause-profile-v2 <id>").action((id) => console.log(JSON.stringify(pauseOrchProfileV2(id), null, 2)));
  og.command("retire-profile-v2 <id>").action((id) => console.log(JSON.stringify(retireOrchProfileV2(id), null, 2)));
  og.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchOrchProfileV2(id), null, 2)));
  og.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getOrchProfileV2(id), null, 2)));
  og.command("list-profiles-v2").action(() => console.log(JSON.stringify(listOrchProfilesV2(), null, 2)));
  og.command("create-task-v2 <id> <profileId>").option("--prompt <p>", "prompt").action((id, profileId, o) => console.log(JSON.stringify(createOrchTaskV2({ id, profileId, prompt: o.prompt }), null, 2)));
  og.command("dispatch-task-v2 <id>").action((id) => console.log(JSON.stringify(dispatchOrchTaskV2(id), null, 2)));
  og.command("complete-task-v2 <id>").action((id) => console.log(JSON.stringify(completeOrchTaskV2(id), null, 2)));
  og.command("fail-task-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(failOrchTaskV2(id, reason), null, 2)));
  og.command("cancel-task-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(cancelOrchTaskV2(id, reason), null, 2)));
  og.command("get-task-v2 <id>").action((id) => console.log(JSON.stringify(getOrchTaskV2(id), null, 2)));
  og.command("list-tasks-v2").action(() => console.log(JSON.stringify(listOrchTasksV2(), null, 2)));
  og.command("auto-pause-idle-v2").action(() => console.log(JSON.stringify(autoPauseIdleOrchProfilesV2(), null, 2)));
  og.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckOrchTasksV2(), null, 2)));
  og.command("gov-stats-v2").action(() => console.log(JSON.stringify(getOrchestratorGovStatsV2(), null, 2)));
  og.command("reset-state-v2").action(() => { _resetStateOrchestratorV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
