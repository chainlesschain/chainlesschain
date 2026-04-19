/**
 * Social Graph Analytics V2 governance commands — `cc sganal ...`
 * 在内存中治理 SGAN profile (pending/active/stale/archived) + run 生命周期。
 */
import {
  SGAN_PROFILE_MATURITY_V2,
  SGAN_RUN_LIFECYCLE_V2,
  registerSganProfileV2,
  activateSganProfileV2,
  staleSganProfileV2,
  archiveSganProfileV2,
  touchSganProfileV2,
  getSganProfileV2,
  listSganProfilesV2,
  createSganRunV2,
  runningSganRunV2,
  completeSganRunV2,
  failSganRunV2,
  cancelSganRunV2,
  getSganRunV2,
  listSganRunsV2,
  setMaxActiveSganProfilesPerOwnerV2,
  getMaxActiveSganProfilesPerOwnerV2,
  setMaxPendingSganRunsPerProfileV2,
  getMaxPendingSganRunsPerProfileV2,
  setSganProfileIdleMsV2,
  getSganProfileIdleMsV2,
  setSganRunStuckMsV2,
  getSganRunStuckMsV2,
  autoStaleIdleSganProfilesV2,
  autoFailStuckSganRunsV2,
  getSocialGraphAnalyticsGovStatsV2,
} from "../lib/social-graph-analytics.js";

export function registerSganalCommand(program) {
  const s = program
    .command("sganal")
    .description("Social Graph Analytics V2 governance (in-memory, CLI v0.143.0)");

  s.command("enums-v2").action(() => console.log(JSON.stringify({ SGAN_PROFILE_MATURITY_V2, SGAN_RUN_LIFECYCLE_V2 }, null, 2)));
  s.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--algorithm <algorithm>", "graph algorithm", "centrality")
    .action((o) => console.log(JSON.stringify(registerSganProfileV2(o), null, 2)));
  s.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateSganProfileV2(id), null, 2)));
  s.command("stale-profile-v2 <id>").action((id) => console.log(JSON.stringify(staleSganProfileV2(id), null, 2)));
  s.command("archive-profile-v2 <id>").action((id) => console.log(JSON.stringify(archiveSganProfileV2(id), null, 2)));
  s.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchSganProfileV2(id), null, 2)));
  s.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getSganProfileV2(id), null, 2)));
  s.command("list-profiles-v2").action(() => console.log(JSON.stringify(listSganProfilesV2(), null, 2)));

  s.command("create-run-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--snapshot-id <sid>", "graph snapshot id", "")
    .action((o) => console.log(JSON.stringify(createSganRunV2({ id: o.id, profileId: o.profileId, snapshotId: o.snapshotId }), null, 2)));
  s.command("running-run-v2 <id>").action((id) => console.log(JSON.stringify(runningSganRunV2(id), null, 2)));
  s.command("complete-run-v2 <id>").action((id) => console.log(JSON.stringify(completeSganRunV2(id), null, 2)));
  s.command("fail-run-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(failSganRunV2(id, o.reason), null, 2)));
  s.command("cancel-run-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(cancelSganRunV2(id, o.reason), null, 2)));
  s.command("get-run-v2 <id>").action((id) => console.log(JSON.stringify(getSganRunV2(id), null, 2)));
  s.command("list-runs-v2").action(() => console.log(JSON.stringify(listSganRunsV2(), null, 2)));

  s.command("config-v2").action(() => console.log(JSON.stringify({
    maxActiveSganProfilesPerOwner: getMaxActiveSganProfilesPerOwnerV2(),
    maxPendingSganRunsPerProfile: getMaxPendingSganRunsPerProfileV2(),
    sganProfileIdleMs: getSganProfileIdleMsV2(),
    sganRunStuckMs: getSganRunStuckMsV2(),
  }, null, 2)));
  s.command("set-max-active-profiles-v2 <n>").action((n) => { setMaxActiveSganProfilesPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActiveSganProfilesPerOwner: getMaxActiveSganProfilesPerOwnerV2() }, null, 2)); });
  s.command("set-max-pending-runs-v2 <n>").action((n) => { setMaxPendingSganRunsPerProfileV2(Number(n)); console.log(JSON.stringify({ maxPendingSganRunsPerProfile: getMaxPendingSganRunsPerProfileV2() }, null, 2)); });
  s.command("set-profile-idle-ms-v2 <ms>").action((ms) => { setSganProfileIdleMsV2(Number(ms)); console.log(JSON.stringify({ sganProfileIdleMs: getSganProfileIdleMsV2() }, null, 2)); });
  s.command("set-run-stuck-ms-v2 <ms>").action((ms) => { setSganRunStuckMsV2(Number(ms)); console.log(JSON.stringify({ sganRunStuckMs: getSganRunStuckMsV2() }, null, 2)); });
  s.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdleSganProfilesV2(), null, 2)));
  s.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckSganRunsV2(), null, 2)));
  s.command("gov-stats-v2").action(() => console.log(JSON.stringify(getSocialGraphAnalyticsGovStatsV2(), null, 2)));
}
