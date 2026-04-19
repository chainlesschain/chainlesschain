/**
 * Version Checker V2 governance commands — `cc vcheck ...`
 * 在内存中治理 VCHK profile (pending/active/stale/archived) + check 生命周期。
 */
import {
  VCHK_PROFILE_MATURITY_V2,
  VCHK_CHECK_LIFECYCLE_V2,
  registerVchkProfileV2,
  activateVchkProfileV2,
  staleVchkProfileV2,
  archiveVchkProfileV2,
  touchVchkProfileV2,
  getVchkProfileV2,
  listVchkProfilesV2,
  createVchkCheckV2,
  checkingVchkCheckV2,
  completeVchkCheckV2,
  failVchkCheckV2,
  cancelVchkCheckV2,
  getVchkCheckV2,
  listVchkChecksV2,
  setMaxActiveVchkProfilesPerOwnerV2,
  getMaxActiveVchkProfilesPerOwnerV2,
  setMaxPendingVchkChecksPerProfileV2,
  getMaxPendingVchkChecksPerProfileV2,
  setVchkProfileIdleMsV2,
  getVchkProfileIdleMsV2,
  setVchkCheckStuckMsV2,
  getVchkCheckStuckMsV2,
  autoStaleIdleVchkProfilesV2,
  autoFailStuckVchkChecksV2,
  getVersionCheckerGovStatsV2,
} from "../lib/version-checker.js";

export function registerVcheckCommand(program) {
  const v = program
    .command("vcheck")
    .description("Version Checker V2 governance (in-memory, CLI v0.143.0)");

  v.command("enums-v2").action(() => console.log(JSON.stringify({ VCHK_PROFILE_MATURITY_V2, VCHK_CHECK_LIFECYCLE_V2 }, null, 2)));
  v.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--channel <channel>", "release channel", "stable")
    .action((o) => console.log(JSON.stringify(registerVchkProfileV2(o), null, 2)));
  v.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateVchkProfileV2(id), null, 2)));
  v.command("stale-profile-v2 <id>").action((id) => console.log(JSON.stringify(staleVchkProfileV2(id), null, 2)));
  v.command("archive-profile-v2 <id>").action((id) => console.log(JSON.stringify(archiveVchkProfileV2(id), null, 2)));
  v.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchVchkProfileV2(id), null, 2)));
  v.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getVchkProfileV2(id), null, 2)));
  v.command("list-profiles-v2").action(() => console.log(JSON.stringify(listVchkProfilesV2(), null, 2)));

  v.command("create-check-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--current-version <ver>", "current version", "")
    .action((o) => console.log(JSON.stringify(createVchkCheckV2({ id: o.id, profileId: o.profileId, currentVersion: o.currentVersion }), null, 2)));
  v.command("checking-check-v2 <id>").action((id) => console.log(JSON.stringify(checkingVchkCheckV2(id), null, 2)));
  v.command("complete-check-v2 <id>").action((id) => console.log(JSON.stringify(completeVchkCheckV2(id), null, 2)));
  v.command("fail-check-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(failVchkCheckV2(id, o.reason), null, 2)));
  v.command("cancel-check-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(cancelVchkCheckV2(id, o.reason), null, 2)));
  v.command("get-check-v2 <id>").action((id) => console.log(JSON.stringify(getVchkCheckV2(id), null, 2)));
  v.command("list-checks-v2").action(() => console.log(JSON.stringify(listVchkChecksV2(), null, 2)));

  v.command("config-v2").action(() => console.log(JSON.stringify({
    maxActiveVchkProfilesPerOwner: getMaxActiveVchkProfilesPerOwnerV2(),
    maxPendingVchkChecksPerProfile: getMaxPendingVchkChecksPerProfileV2(),
    vchkProfileIdleMs: getVchkProfileIdleMsV2(),
    vchkCheckStuckMs: getVchkCheckStuckMsV2(),
  }, null, 2)));
  v.command("set-max-active-profiles-v2 <n>").action((n) => { setMaxActiveVchkProfilesPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActiveVchkProfilesPerOwner: getMaxActiveVchkProfilesPerOwnerV2() }, null, 2)); });
  v.command("set-max-pending-checks-v2 <n>").action((n) => { setMaxPendingVchkChecksPerProfileV2(Number(n)); console.log(JSON.stringify({ maxPendingVchkChecksPerProfile: getMaxPendingVchkChecksPerProfileV2() }, null, 2)); });
  v.command("set-profile-idle-ms-v2 <ms>").action((ms) => { setVchkProfileIdleMsV2(Number(ms)); console.log(JSON.stringify({ vchkProfileIdleMs: getVchkProfileIdleMsV2() }, null, 2)); });
  v.command("set-check-stuck-ms-v2 <ms>").action((ms) => { setVchkCheckStuckMsV2(Number(ms)); console.log(JSON.stringify({ vchkCheckStuckMs: getVchkCheckStuckMsV2() }, null, 2)); });
  v.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdleVchkProfilesV2(), null, 2)));
  v.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckVchkChecksV2(), null, 2)));
  v.command("gov-stats-v2").action(() => console.log(JSON.stringify(getVersionCheckerGovStatsV2(), null, 2)));
}
