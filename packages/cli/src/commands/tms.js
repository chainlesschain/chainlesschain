/**
 * `cc tms` — Task Model Selector V2 governance overlay.
 *
 * In-memory governance for selector profiles + selection lifecycle, layered atop
 * `lib/task-model-selector.js`. Independent of legacy heuristic selector helpers.
 */

import {
  TMS_PROFILE_MATURITY_V2, TMS_SELECTION_LIFECYCLE_V2,
  setMaxActiveTmsProfilesPerOwnerV2, getMaxActiveTmsProfilesPerOwnerV2,
  setMaxPendingTmsSelectionsPerProfileV2, getMaxPendingTmsSelectionsPerProfileV2,
  setTmsProfileIdleMsV2, getTmsProfileIdleMsV2,
  setTmsSelectionStuckMsV2, getTmsSelectionStuckMsV2,
  registerTmsProfileV2, activateTmsProfileV2, staleTmsProfileV2, decommissionTmsProfileV2, touchTmsProfileV2, getTmsProfileV2, listTmsProfilesV2,
  createTmsSelectionV2, scoreTmsSelectionV2, completeTmsSelectionV2, failTmsSelectionV2, cancelTmsSelectionV2, getTmsSelectionV2, listTmsSelectionsV2,
  autoStaleIdleTmsProfilesV2, autoFailStuckTmsSelectionsV2, getTaskModelSelectorGovStatsV2, _resetStateTaskModelSelectorV2,
} from "../lib/task-model-selector.js";

export function registerTmsCommand(program) {
  const tms = program.command("tms").description("Task Model Selector V2 governance");
  tms.command("enums-v2").action(() => console.log(JSON.stringify({ profileMaturity: TMS_PROFILE_MATURITY_V2, selectionLifecycle: TMS_SELECTION_LIFECYCLE_V2 }, null, 2)));
  tms.command("config-v2").action(() => console.log(JSON.stringify({ maxActiveTmsProfilesPerOwner: getMaxActiveTmsProfilesPerOwnerV2(), maxPendingTmsSelectionsPerProfile: getMaxPendingTmsSelectionsPerProfileV2(), tmsProfileIdleMs: getTmsProfileIdleMsV2(), tmsSelectionStuckMs: getTmsSelectionStuckMsV2() }, null, 2)));
  tms.command("set-max-active-v2 <n>").action((n) => { setMaxActiveTmsProfilesPerOwnerV2(Number(n)); console.log("ok"); });
  tms.command("set-max-pending-v2 <n>").action((n) => { setMaxPendingTmsSelectionsPerProfileV2(Number(n)); console.log("ok"); });
  tms.command("set-idle-ms-v2 <n>").action((n) => { setTmsProfileIdleMsV2(Number(n)); console.log("ok"); });
  tms.command("set-stuck-ms-v2 <n>").action((n) => { setTmsSelectionStuckMsV2(Number(n)); console.log("ok"); });
  tms.command("register-profile-v2 <id> <owner>").option("--strategy <s>", "strategy").action((id, owner, o) => console.log(JSON.stringify(registerTmsProfileV2({ id, owner, strategy: o.strategy }), null, 2)));
  tms.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateTmsProfileV2(id), null, 2)));
  tms.command("stale-profile-v2 <id>").action((id) => console.log(JSON.stringify(staleTmsProfileV2(id), null, 2)));
  tms.command("decommission-profile-v2 <id>").action((id) => console.log(JSON.stringify(decommissionTmsProfileV2(id), null, 2)));
  tms.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchTmsProfileV2(id), null, 2)));
  tms.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getTmsProfileV2(id), null, 2)));
  tms.command("list-profiles-v2").action(() => console.log(JSON.stringify(listTmsProfilesV2(), null, 2)));
  tms.command("create-selection-v2 <id> <profileId>").option("--task <t>", "task").action((id, profileId, o) => console.log(JSON.stringify(createTmsSelectionV2({ id, profileId, task: o.task }), null, 2)));
  tms.command("score-selection-v2 <id>").action((id) => console.log(JSON.stringify(scoreTmsSelectionV2(id), null, 2)));
  tms.command("complete-selection-v2 <id>").action((id) => console.log(JSON.stringify(completeTmsSelectionV2(id), null, 2)));
  tms.command("fail-selection-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(failTmsSelectionV2(id, reason), null, 2)));
  tms.command("cancel-selection-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(cancelTmsSelectionV2(id, reason), null, 2)));
  tms.command("get-selection-v2 <id>").action((id) => console.log(JSON.stringify(getTmsSelectionV2(id), null, 2)));
  tms.command("list-selections-v2").action(() => console.log(JSON.stringify(listTmsSelectionsV2(), null, 2)));
  tms.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdleTmsProfilesV2(), null, 2)));
  tms.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckTmsSelectionsV2(), null, 2)));
  tms.command("gov-stats-v2").action(() => console.log(JSON.stringify(getTaskModelSelectorGovStatsV2(), null, 2)));
  tms.command("reset-state-v2").action(() => { _resetStateTaskModelSelectorV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
