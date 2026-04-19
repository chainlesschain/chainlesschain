/**
 * Compression Telemetry V2 governance commands — `cc compt ...`
 * 在内存中治理 COMPT profile (pending/active/stale/archived) + sample 生命周期。
 */
import {
  COMPT_PROFILE_MATURITY_V2,
  COMPT_SAMPLE_LIFECYCLE_V2,
  registerComptProfileV2,
  activateComptProfileV2,
  staleComptProfileV2,
  archiveComptProfileV2,
  touchComptProfileV2,
  getComptProfileV2,
  listComptProfilesV2,
  createComptSampleV2,
  recordingComptSampleV2,
  recordComptSampleV2,
  failComptSampleV2,
  cancelComptSampleV2,
  getComptSampleV2,
  listComptSamplesV2,
  setMaxActiveComptProfilesPerOwnerV2,
  getMaxActiveComptProfilesPerOwnerV2,
  setMaxPendingComptSamplesPerProfileV2,
  getMaxPendingComptSamplesPerProfileV2,
  setComptProfileIdleMsV2,
  getComptProfileIdleMsV2,
  setComptSampleStuckMsV2,
  getComptSampleStuckMsV2,
  autoStaleIdleComptProfilesV2,
  autoFailStuckComptSamplesV2,
  getCompressionTelemetryGovStatsV2,
} from "../lib/compression-telemetry.js";

export function registerComptCommand(program) {
  const c = program
    .command("compt")
    .description("Compression Telemetry V2 governance (in-memory, CLI v0.143.0)");

  c.command("enums-v2").action(() => console.log(JSON.stringify({ COMPT_PROFILE_MATURITY_V2, COMPT_SAMPLE_LIFECYCLE_V2 }, null, 2)));
  c.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--kind <kind>", "telemetry kind", "default")
    .action((o) => console.log(JSON.stringify(registerComptProfileV2(o), null, 2)));
  c.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateComptProfileV2(id), null, 2)));
  c.command("stale-profile-v2 <id>").action((id) => console.log(JSON.stringify(staleComptProfileV2(id), null, 2)));
  c.command("archive-profile-v2 <id>").action((id) => console.log(JSON.stringify(archiveComptProfileV2(id), null, 2)));
  c.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchComptProfileV2(id), null, 2)));
  c.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getComptProfileV2(id), null, 2)));
  c.command("list-profiles-v2").action(() => console.log(JSON.stringify(listComptProfilesV2(), null, 2)));

  c.command("create-sample-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--metric <metric>", "metric name", "")
    .action((o) => console.log(JSON.stringify(createComptSampleV2(o), null, 2)));
  c.command("recording-sample-v2 <id>").action((id) => console.log(JSON.stringify(recordingComptSampleV2(id), null, 2)));
  c.command("record-sample-v2 <id>").action((id) => console.log(JSON.stringify(recordComptSampleV2(id), null, 2)));
  c.command("fail-sample-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(failComptSampleV2(id, o.reason), null, 2)));
  c.command("cancel-sample-v2 <id>").option("--reason <r>").action((id, o) => console.log(JSON.stringify(cancelComptSampleV2(id, o.reason), null, 2)));
  c.command("get-sample-v2 <id>").action((id) => console.log(JSON.stringify(getComptSampleV2(id), null, 2)));
  c.command("list-samples-v2").action(() => console.log(JSON.stringify(listComptSamplesV2(), null, 2)));

  c.command("config-v2").action(() => console.log(JSON.stringify({
    maxActiveComptProfilesPerOwner: getMaxActiveComptProfilesPerOwnerV2(),
    maxPendingComptSamplesPerProfile: getMaxPendingComptSamplesPerProfileV2(),
    comptProfileIdleMs: getComptProfileIdleMsV2(),
    comptSampleStuckMs: getComptSampleStuckMsV2(),
  }, null, 2)));
  c.command("set-max-active-profiles-v2 <n>").action((n) => { setMaxActiveComptProfilesPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActiveComptProfilesPerOwner: getMaxActiveComptProfilesPerOwnerV2() }, null, 2)); });
  c.command("set-max-pending-samples-v2 <n>").action((n) => { setMaxPendingComptSamplesPerProfileV2(Number(n)); console.log(JSON.stringify({ maxPendingComptSamplesPerProfile: getMaxPendingComptSamplesPerProfileV2() }, null, 2)); });
  c.command("set-profile-idle-ms-v2 <ms>").action((ms) => { setComptProfileIdleMsV2(Number(ms)); console.log(JSON.stringify({ comptProfileIdleMs: getComptProfileIdleMsV2() }, null, 2)); });
  c.command("set-sample-stuck-ms-v2 <ms>").action((ms) => { setComptSampleStuckMsV2(Number(ms)); console.log(JSON.stringify({ comptSampleStuckMs: getComptSampleStuckMsV2() }, null, 2)); });
  c.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdleComptProfilesV2(), null, 2)));
  c.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckComptSamplesV2(), null, 2)));
  c.command("gov-stats-v2").action(() => console.log(JSON.stringify(getCompressionTelemetryGovStatsV2(), null, 2)));
}
