/**
 * Response Cache V2 commands
 * `cc rcache ...` — in-memory governance layer for cache profiles
 * + refresh jobs, independent of SQLite llm_cache table.
 */

import { logger } from "../lib/logger.js";
import {
  PROFILE_MATURITY_V2,
  REFRESH_JOB_LIFECYCLE_V2,
  getMaxActiveProfilesPerOwnerV2,
  setMaxActiveProfilesPerOwnerV2,
  getMaxPendingRefreshJobsPerProfileV2,
  setMaxPendingRefreshJobsPerProfileV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getRefreshStuckMsV2,
  setRefreshStuckMsV2,
  registerProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileStatusV2,
  activateProfileV2,
  suspendProfileV2,
  archiveProfileV2,
  touchProfileV2,
  getActiveProfileCountV2,
  createRefreshJobV2,
  getRefreshJobV2,
  listRefreshJobsV2,
  setRefreshJobStatusV2,
  startRefreshJobV2,
  completeRefreshJobV2,
  failRefreshJobV2,
  cancelRefreshJobV2,
  getPendingRefreshJobCountV2,
  autoSuspendIdleProfilesV2,
  autoFailStuckRefreshJobsV2,
  getResponseCacheStatsV2,
} from "../lib/response-cache.js";

const out = (obj) => console.log(JSON.stringify(obj, null, 2));
const tryRun = (fn) => {
  try {
    fn();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
};

export function registerRCacheCommand(program) {
  const root = program
    .command("rcache")
    .description("Response cache V2 — profile maturity + refresh jobs");

  root
    .command("profile-maturities-v2")
    .description("List V2 profile maturity states")
    .action(() => out(Object.values(PROFILE_MATURITY_V2)));

  root
    .command("refresh-job-lifecycles-v2")
    .description("List V2 refresh-job lifecycle states")
    .action(() => out(Object.values(REFRESH_JOB_LIFECYCLE_V2)));

  root
    .command("stats-v2")
    .description("V2 response cache stats")
    .action(() => out(getResponseCacheStatsV2()));

  root
    .command("get-max-active-profiles-v2")
    .description("Get max active profiles per owner (V2)")
    .action(() =>
      out({ maxActiveProfilesPerOwner: getMaxActiveProfilesPerOwnerV2() }),
    );

  root
    .command("set-max-active-profiles-v2 <n>")
    .description("Set max active profiles per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveProfilesPerOwnerV2(Number(n));
        out({ maxActiveProfilesPerOwner: getMaxActiveProfilesPerOwnerV2() });
      }),
    );

  root
    .command("get-max-pending-refresh-jobs-v2")
    .description("Get max pending refresh jobs per profile (V2)")
    .action(() =>
      out({
        maxPendingRefreshJobsPerProfile: getMaxPendingRefreshJobsPerProfileV2(),
      }),
    );

  root
    .command("set-max-pending-refresh-jobs-v2 <n>")
    .description("Set max pending refresh jobs per profile (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingRefreshJobsPerProfileV2(Number(n));
        out({
          maxPendingRefreshJobsPerProfile:
            getMaxPendingRefreshJobsPerProfileV2(),
        });
      }),
    );

  root
    .command("get-profile-idle-ms-v2")
    .description("Get profile idle threshold (V2)")
    .action(() => out({ profileIdleMs: getProfileIdleMsV2() }));

  root
    .command("set-profile-idle-ms-v2 <ms>")
    .description("Set profile idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setProfileIdleMsV2(Number(ms));
        out({ profileIdleMs: getProfileIdleMsV2() });
      }),
    );

  root
    .command("get-refresh-stuck-ms-v2")
    .description("Get refresh-job stuck threshold (V2)")
    .action(() => out({ refreshStuckMs: getRefreshStuckMsV2() }));

  root
    .command("set-refresh-stuck-ms-v2 <ms>")
    .description("Set refresh-job stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setRefreshStuckMsV2(Number(ms));
        out({ refreshStuckMs: getRefreshStuckMsV2() });
      }),
    );

  root
    .command("active-profile-count-v2 <ownerId>")
    .description("Active profile count for owner (V2)")
    .action((ownerId) =>
      out({ ownerId, count: getActiveProfileCountV2(ownerId) }),
    );

  root
    .command("pending-refresh-job-count-v2 <profileId>")
    .description("Pending refresh-job count for profile (V2)")
    .action((profileId) =>
      out({ profileId, count: getPendingRefreshJobCountV2(profileId) }),
    );

  root
    .command("register-profile-v2 <id>")
    .description("Register a V2 profile")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-l, --label <label>", "profile label")
    .action((id, opts) =>
      tryRun(() =>
        out(registerProfileV2(id, { ownerId: opts.owner, label: opts.label })),
      ),
    );

  root
    .command("get-profile-v2 <id>")
    .description("Get a V2 profile")
    .action((id) => out(getProfileV2(id)));

  root
    .command("list-profiles-v2")
    .description("List V2 profiles")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listProfilesV2({ ownerId: opts.owner, status: opts.status })),
    );

  root
    .command("set-profile-status-v2 <id> <next>")
    .description("Set V2 profile status")
    .action((id, next) => tryRun(() => out(setProfileStatusV2(id, next))));

  root
    .command("activate-profile-v2 <id>")
    .description("Activate a V2 profile")
    .action((id) => tryRun(() => out(activateProfileV2(id))));

  root
    .command("suspend-profile-v2 <id>")
    .description("Suspend a V2 profile")
    .action((id) => tryRun(() => out(suspendProfileV2(id))));

  root
    .command("archive-profile-v2 <id>")
    .description("Archive a V2 profile")
    .action((id) => tryRun(() => out(archiveProfileV2(id))));

  root
    .command("touch-profile-v2 <id>")
    .description("Touch a V2 profile")
    .action((id) => tryRun(() => out(touchProfileV2(id))));

  root
    .command("create-refresh-job-v2 <id>")
    .description("Create a V2 refresh job")
    .requiredOption("-p, --profile <id>", "profile id")
    .option("-k, --kind <kind>", "job kind", "warm")
    .action((id, opts) =>
      tryRun(() =>
        out(
          createRefreshJobV2(id, { profileId: opts.profile, kind: opts.kind }),
        ),
      ),
    );

  root
    .command("get-refresh-job-v2 <id>")
    .description("Get a V2 refresh job")
    .action((id) => out(getRefreshJobV2(id)));

  root
    .command("list-refresh-jobs-v2")
    .description("List V2 refresh jobs")
    .option("-p, --profile <id>", "filter by profile")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(
        listRefreshJobsV2({
          profileId: opts.profile,
          status: opts.status,
        }),
      ),
    );

  root
    .command("set-refresh-job-status-v2 <id> <next>")
    .description("Set V2 refresh-job status")
    .action((id, next) => tryRun(() => out(setRefreshJobStatusV2(id, next))));

  root
    .command("start-refresh-job-v2 <id>")
    .description("Start a V2 refresh job")
    .action((id) => tryRun(() => out(startRefreshJobV2(id))));

  root
    .command("complete-refresh-job-v2 <id>")
    .description("Complete a V2 refresh job")
    .action((id) => tryRun(() => out(completeRefreshJobV2(id))));

  root
    .command("fail-refresh-job-v2 <id>")
    .description("Fail a V2 refresh job")
    .action((id) => tryRun(() => out(failRefreshJobV2(id))));

  root
    .command("cancel-refresh-job-v2 <id>")
    .description("Cancel a V2 refresh job")
    .action((id) => tryRun(() => out(cancelRefreshJobV2(id))));

  root
    .command("auto-suspend-idle-profiles-v2")
    .description("Auto-suspend idle V2 profiles")
    .action(() => out(autoSuspendIdleProfilesV2()));

  root
    .command("auto-fail-stuck-refresh-jobs-v2")
    .description("Auto-fail stuck V2 refresh jobs")
    .action(() => out(autoFailStuckRefreshJobsV2()));
}
