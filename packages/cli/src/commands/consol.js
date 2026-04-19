/**
 * Session Consolidator V2 governance commands — `cc consol ...`
 *
 * V2 surface layered atop session-consolidator.js, independent of
 * legacy `buildTraceStoreFromJsonl`/`consolidateJsonlSession` helpers.
 */

import {
  CONSOL_PROFILE_MATURITY_V2,
  CONSOL_JOB_LIFECYCLE_V2,
  registerConsolProfileV2,
  activateConsolProfileV2,
  pauseConsolProfileV2,
  archiveConsolProfileV2,
  touchConsolProfileV2,
  getConsolProfileV2,
  listConsolProfilesV2,
  createConsolJobV2,
  startConsolJobV2,
  completeConsolJobV2,
  failConsolJobV2,
  cancelConsolJobV2,
  getConsolJobV2,
  listConsolJobsV2,
  setMaxActiveConsolProfilesPerOwnerV2,
  getMaxActiveConsolProfilesPerOwnerV2,
  setMaxPendingConsolJobsPerProfileV2,
  getMaxPendingConsolJobsPerProfileV2,
  setConsolProfileIdleMsV2,
  getConsolProfileIdleMsV2,
  setConsolJobStuckMsV2,
  getConsolJobStuckMsV2,
  autoPauseIdleConsolProfilesV2,
  autoFailStuckConsolJobsV2,
  getSessionConsolidatorStatsV2,
} from "../lib/session-consolidator.js";

export function registerConsolCommand(program) {
  const consol = program
    .command("consol")
    .description(
      "Session Consolidator V2 governance (in-memory, CLI v0.134.0)",
    );

  consol
    .command("enums-v2")
    .description("Show V2 maturity + lifecycle enums")
    .action(() => {
      console.log(
        JSON.stringify(
          {
            CONSOL_PROFILE_MATURITY_V2,
            CONSOL_JOB_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });

  consol
    .command("register-profile-v2")
    .description("Register a consolidation profile (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--scope <scope>", "agent|session|global", "agent")
    .action((o) => {
      console.log(JSON.stringify(registerConsolProfileV2(o), null, 2));
    });
  consol
    .command("activate-profile-v2 <id>")
    .description("Transition profile to active")
    .action((id) => {
      console.log(JSON.stringify(activateConsolProfileV2(id), null, 2));
    });
  consol
    .command("pause-profile-v2 <id>")
    .description("Transition profile to paused")
    .action((id) => {
      console.log(JSON.stringify(pauseConsolProfileV2(id), null, 2));
    });
  consol
    .command("archive-profile-v2 <id>")
    .description("Transition profile to archived (terminal)")
    .action((id) => {
      console.log(JSON.stringify(archiveConsolProfileV2(id), null, 2));
    });
  consol
    .command("touch-profile-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) => {
      console.log(JSON.stringify(touchConsolProfileV2(id), null, 2));
    });
  consol
    .command("get-profile-v2 <id>")
    .description("Get a profile by id")
    .action((id) => {
      console.log(JSON.stringify(getConsolProfileV2(id), null, 2));
    });
  consol
    .command("list-profiles-v2")
    .description("List all profiles")
    .action(() => {
      console.log(JSON.stringify(listConsolProfilesV2(), null, 2));
    });

  consol
    .command("create-job-v2")
    .description("Create a consolidation job (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--session-id <sessionId>")
    .action((o) => {
      console.log(
        JSON.stringify(
          createConsolJobV2({
            id: o.id,
            profileId: o.profileId,
            sessionId: o.sessionId,
          }),
          null,
          2,
        ),
      );
    });
  consol
    .command("start-job-v2 <id>")
    .description("Transition job to running")
    .action((id) => {
      console.log(JSON.stringify(startConsolJobV2(id), null, 2));
    });
  consol
    .command("complete-job-v2 <id>")
    .description("Transition job to completed")
    .action((id) => {
      console.log(JSON.stringify(completeConsolJobV2(id), null, 2));
    });
  consol
    .command("fail-job-v2 <id>")
    .description("Transition job to failed")
    .option("--reason <reason>")
    .action((id, o) => {
      console.log(JSON.stringify(failConsolJobV2(id, o.reason), null, 2));
    });
  consol
    .command("cancel-job-v2 <id>")
    .description("Transition job to cancelled")
    .option("--reason <reason>")
    .action((id, o) => {
      console.log(JSON.stringify(cancelConsolJobV2(id, o.reason), null, 2));
    });
  consol
    .command("get-job-v2 <id>")
    .description("Get a job by id")
    .action((id) => {
      console.log(JSON.stringify(getConsolJobV2(id), null, 2));
    });
  consol
    .command("list-jobs-v2")
    .description("List all jobs")
    .action(() => {
      console.log(JSON.stringify(listConsolJobsV2(), null, 2));
    });

  consol
    .command("set-max-active-profiles-v2 <n>")
    .description("Set per-owner active profile cap")
    .action((n) => {
      setMaxActiveConsolProfilesPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          { maxActiveConsolProfilesPerOwner: getMaxActiveConsolProfilesPerOwnerV2() },
          null,
          2,
        ),
      );
    });
  consol
    .command("set-max-pending-jobs-v2 <n>")
    .description("Set per-profile pending job cap")
    .action((n) => {
      setMaxPendingConsolJobsPerProfileV2(Number(n));
      console.log(
        JSON.stringify(
          { maxPendingConsolJobsPerProfile: getMaxPendingConsolJobsPerProfileV2() },
          null,
          2,
        ),
      );
    });
  consol
    .command("set-profile-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action((n) => {
      setConsolProfileIdleMsV2(Number(n));
      console.log(
        JSON.stringify(
          { consolProfileIdleMs: getConsolProfileIdleMsV2() },
          null,
          2,
        ),
      );
    });
  consol
    .command("set-job-stuck-ms-v2 <n>")
    .description("Set job stuck threshold (ms)")
    .action((n) => {
      setConsolJobStuckMsV2(Number(n));
      console.log(
        JSON.stringify({ consolJobStuckMs: getConsolJobStuckMsV2() }, null, 2),
      );
    });
  consol
    .command("auto-pause-idle-profiles-v2")
    .description("Auto-pause idle active profiles")
    .action(() => {
      console.log(JSON.stringify(autoPauseIdleConsolProfilesV2(), null, 2));
    });
  consol
    .command("auto-fail-stuck-jobs-v2")
    .description("Auto-fail stuck running jobs")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckConsolJobsV2(), null, 2));
    });
  consol
    .command("stats-v2")
    .description("Show V2 aggregate stats")
    .action(() => {
      console.log(JSON.stringify(getSessionConsolidatorStatsV2(), null, 2));
    });
}
