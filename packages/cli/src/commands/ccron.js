/**
 * Cowork Cron V2 governance commands — `cc ccron ...`
 * 在内存中治理 CCRON profile (pending/active/paused/archived) + tick 生命周期。
 */
import {
  CCRON_PROFILE_MATURITY_V2,
  CCRON_TICK_LIFECYCLE_V2,
  registerCcronProfileV2,
  activateCcronProfileV2,
  pauseCcronProfileV2,
  archiveCcronProfileV2,
  touchCcronProfileV2,
  getCcronProfileV2,
  listCcronProfilesV2,
  createCcronTickV2,
  runningCcronTickV2,
  completeCcronTickV2,
  failCcronTickV2,
  cancelCcronTickV2,
  getCcronTickV2,
  listCcronTicksV2,
  setMaxActiveCcronProfilesPerOwnerV2,
  getMaxActiveCcronProfilesPerOwnerV2,
  setMaxPendingCcronTicksPerProfileV2,
  getMaxPendingCcronTicksPerProfileV2,
  setCcronProfileIdleMsV2,
  getCcronProfileIdleMsV2,
  setCcronTickStuckMsV2,
  getCcronTickStuckMsV2,
  autoPauseIdleCcronProfilesV2,
  autoFailStuckCcronTicksV2,
  getCoworkCronGovStatsV2,
} from "../lib/cowork-cron.js";

export function registerCcronCommand(program) {
  const c = program
    .command("ccron")
    .description("Cowork Cron V2 governance (in-memory, CLI v0.143.0)");

  c.command("enums-v2").action(() => console.log(JSON.stringify({ CCRON_PROFILE_MATURITY_V2, CCRON_TICK_LIFECYCLE_V2 }, null, 2)));
  c.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--expr <expr>", "cron expression", "0 0 * * *")
    .action((o) => console.log(JSON.stringify(registerCcronProfileV2(o), null, 2)));
  c.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateCcronProfileV2(id), null, 2)));
  c.command("pause-profile-v2 <id>").action((id) => console.log(JSON.stringify(pauseCcronProfileV2(id), null, 2)));
  c.command("archive-profile-v2 <id>").action((id) => console.log(JSON.stringify(archiveCcronProfileV2(id), null, 2)));
  c.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchCcronProfileV2(id), null, 2)));
  c.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getCcronProfileV2(id), null, 2)));
  c.command("list-profiles-v2").action(() => console.log(JSON.stringify(listCcronProfilesV2(), null, 2)));

  c.command("create-tick-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--tick-at <ts>", "tick timestamp", "")
    .action((o) => console.log(JSON.stringify(createCcronTickV2({ id: o.id, profileId: o.profileId, tickAt: o.tickAt }), null, 2)));
  c.command("running-tick-v2 <id>").action((id) => console.log(JSON.stringify(runningCcronTickV2(id), null, 2)));
  c.command("complete-tick-v2 <id>").action((id) => console.log(JSON.stringify(completeCcronTickV2(id), null, 2)));
  c.command("fail-tick-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(failCcronTickV2(id, o.reason), null, 2)));
  c.command("cancel-tick-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(cancelCcronTickV2(id, o.reason), null, 2)));
  c.command("get-tick-v2 <id>").action((id) => console.log(JSON.stringify(getCcronTickV2(id), null, 2)));
  c.command("list-ticks-v2").action(() => console.log(JSON.stringify(listCcronTicksV2(), null, 2)));

  c.command("config-v2").action(() => console.log(JSON.stringify({
    maxActiveCcronProfilesPerOwner: getMaxActiveCcronProfilesPerOwnerV2(),
    maxPendingCcronTicksPerProfile: getMaxPendingCcronTicksPerProfileV2(),
    ccronProfileIdleMs: getCcronProfileIdleMsV2(),
    ccronTickStuckMs: getCcronTickStuckMsV2(),
  }, null, 2)));
  c.command("set-max-active-profiles-v2 <n>").action((n) => { setMaxActiveCcronProfilesPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActiveCcronProfilesPerOwner: getMaxActiveCcronProfilesPerOwnerV2() }, null, 2)); });
  c.command("set-max-pending-ticks-v2 <n>").action((n) => { setMaxPendingCcronTicksPerProfileV2(Number(n)); console.log(JSON.stringify({ maxPendingCcronTicksPerProfile: getMaxPendingCcronTicksPerProfileV2() }, null, 2)); });
  c.command("set-profile-idle-ms-v2 <ms>").action((ms) => { setCcronProfileIdleMsV2(Number(ms)); console.log(JSON.stringify({ ccronProfileIdleMs: getCcronProfileIdleMsV2() }, null, 2)); });
  c.command("set-tick-stuck-ms-v2 <ms>").action((ms) => { setCcronTickStuckMsV2(Number(ms)); console.log(JSON.stringify({ ccronTickStuckMs: getCcronTickStuckMsV2() }, null, 2)); });
  c.command("auto-pause-idle-v2").action(() => console.log(JSON.stringify(autoPauseIdleCcronProfilesV2(), null, 2)));
  c.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckCcronTicksV2(), null, 2)));
  c.command("gov-stats-v2").action(() => console.log(JSON.stringify(getCoworkCronGovStatsV2(), null, 2)));
}
