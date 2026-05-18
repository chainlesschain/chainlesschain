/**
 * Permanent Memory V2 commands
 * `cc permmem ...` — in-memory governance layer for cross-session
 * pinned knowledge entries + retention jobs.
 */

import { logger } from "../lib/logger.js";
import {
  PIN_MATURITY_V2,
  RETENTION_JOB_LIFECYCLE_V2,
  getMaxActivePinsPerOwnerV2,
  setMaxActivePinsPerOwnerV2,
  getMaxPendingJobsPerPinV2,
  setMaxPendingJobsPerPinV2,
  getPinIdleMsV2,
  setPinIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerPinV2,
  getPinV2,
  listPinsV2,
  setPinStatusV2,
  activatePinV2,
  dormantPinV2,
  archivePinV2,
  touchPinV2,
  getActivePinCountV2,
  createRetentionJobV2,
  getRetentionJobV2,
  listRetentionJobsV2,
  setRetentionJobStatusV2,
  startRetentionJobV2,
  completeRetentionJobV2,
  failRetentionJobV2,
  cancelRetentionJobV2,
  getPendingJobCountV2,
  autoDormantIdlePinsV2,
  autoFailStuckJobsV2,
  getPermanentMemoryStatsV2,
} from "../lib/permanent-memory.js";

const out = (obj) => console.log(JSON.stringify(obj, null, 2));
const tryRun = (fn) => {
  try {
    fn();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
};

export function registerPermMemCommand(program) {
  const root = program
    .command("permmem")
    .description("Permanent memory V2 — pin maturity + retention jobs");

  root
    .command("pin-maturities-v2")
    .description("List V2 pin maturity states")
    .action(() => out(Object.values(PIN_MATURITY_V2)));

  root
    .command("retention-job-lifecycles-v2")
    .description("List V2 retention job lifecycle states")
    .action(() => out(Object.values(RETENTION_JOB_LIFECYCLE_V2)));

  root
    .command("stats-v2")
    .description("V2 permanent memory stats")
    .action(() => out(getPermanentMemoryStatsV2()));

  root
    .command("get-max-active-pins-v2")
    .description("Get max active pins per owner (V2)")
    .action(() => out({ maxActivePinsPerOwner: getMaxActivePinsPerOwnerV2() }));

  root
    .command("set-max-active-pins-v2 <n>")
    .description("Set max active pins per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActivePinsPerOwnerV2(Number(n));
        out({ maxActivePinsPerOwner: getMaxActivePinsPerOwnerV2() });
      }),
    );

  root
    .command("get-max-pending-jobs-v2")
    .description("Get max pending jobs per pin (V2)")
    .action(() => out({ maxPendingJobsPerPin: getMaxPendingJobsPerPinV2() }));

  root
    .command("set-max-pending-jobs-v2 <n>")
    .description("Set max pending jobs per pin (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingJobsPerPinV2(Number(n));
        out({ maxPendingJobsPerPin: getMaxPendingJobsPerPinV2() });
      }),
    );

  root
    .command("get-pin-idle-ms-v2")
    .description("Get pin idle threshold (V2)")
    .action(() => out({ pinIdleMs: getPinIdleMsV2() }));

  root
    .command("set-pin-idle-ms-v2 <ms>")
    .description("Set pin idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setPinIdleMsV2(Number(ms));
        out({ pinIdleMs: getPinIdleMsV2() });
      }),
    );

  root
    .command("get-job-stuck-ms-v2")
    .description("Get retention-job stuck threshold (V2)")
    .action(() => out({ jobStuckMs: getJobStuckMsV2() }));

  root
    .command("set-job-stuck-ms-v2 <ms>")
    .description("Set retention-job stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setJobStuckMsV2(Number(ms));
        out({ jobStuckMs: getJobStuckMsV2() });
      }),
    );

  root
    .command("active-pin-count-v2 <ownerId>")
    .description("Active pin count for owner (V2)")
    .action((ownerId) => out({ ownerId, count: getActivePinCountV2(ownerId) }));

  root
    .command("pending-job-count-v2 <pinId>")
    .description("Pending retention-job count for pin (V2)")
    .action((pinId) => out({ pinId, count: getPendingJobCountV2(pinId) }));

  root
    .command("register-pin-v2 <id>")
    .description("Register a V2 pin")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-l, --label <label>", "pin label")
    .action((id, opts) =>
      tryRun(() =>
        out(registerPinV2(id, { ownerId: opts.owner, label: opts.label })),
      ),
    );

  root
    .command("get-pin-v2 <id>")
    .description("Get a V2 pin")
    .action((id) => out(getPinV2(id)));

  root
    .command("list-pins-v2")
    .description("List V2 pins")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listPinsV2({ ownerId: opts.owner, status: opts.status })),
    );

  root
    .command("set-pin-status-v2 <id> <next>")
    .description("Set V2 pin status")
    .action((id, next) => tryRun(() => out(setPinStatusV2(id, next))));

  root
    .command("activate-pin-v2 <id>")
    .description("Activate a V2 pin")
    .action((id) => tryRun(() => out(activatePinV2(id))));

  root
    .command("dormant-pin-v2 <id>")
    .description("Mark V2 pin dormant")
    .action((id) => tryRun(() => out(dormantPinV2(id))));

  root
    .command("archive-pin-v2 <id>")
    .description("Archive a V2 pin")
    .action((id) => tryRun(() => out(archivePinV2(id))));

  root
    .command("touch-pin-v2 <id>")
    .description("Touch a V2 pin")
    .action((id) => tryRun(() => out(touchPinV2(id))));

  root
    .command("create-retention-job-v2 <id>")
    .description("Create a V2 retention job")
    .requiredOption("-p, --pin <id>", "pin id")
    .option("-k, --kind <kind>", "job kind", "review")
    .action((id, opts) =>
      tryRun(() =>
        out(createRetentionJobV2(id, { pinId: opts.pin, kind: opts.kind })),
      ),
    );

  root
    .command("get-retention-job-v2 <id>")
    .description("Get a V2 retention job")
    .action((id) => out(getRetentionJobV2(id)));

  root
    .command("list-retention-jobs-v2")
    .description("List V2 retention jobs")
    .option("-p, --pin <id>", "filter by pin")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listRetentionJobsV2({ pinId: opts.pin, status: opts.status })),
    );

  root
    .command("set-retention-job-status-v2 <id> <next>")
    .description("Set V2 retention job status")
    .action((id, next) => tryRun(() => out(setRetentionJobStatusV2(id, next))));

  root
    .command("start-retention-job-v2 <id>")
    .description("Start a V2 retention job")
    .action((id) => tryRun(() => out(startRetentionJobV2(id))));

  root
    .command("complete-retention-job-v2 <id>")
    .description("Complete a V2 retention job")
    .action((id) => tryRun(() => out(completeRetentionJobV2(id))));

  root
    .command("fail-retention-job-v2 <id>")
    .description("Fail a V2 retention job")
    .action((id) => tryRun(() => out(failRetentionJobV2(id))));

  root
    .command("cancel-retention-job-v2 <id>")
    .description("Cancel a V2 retention job")
    .action((id) => tryRun(() => out(cancelRetentionJobV2(id))));

  root
    .command("auto-dormant-idle-pins-v2")
    .description("Auto-mark dormant idle V2 pins")
    .action(() => out(autoDormantIdlePinsV2()));

  root
    .command("auto-fail-stuck-jobs-v2")
    .description("Auto-fail stuck V2 retention jobs")
    .action(() => out(autoFailStuckJobsV2()));
}

// === Iter23 V2 governance overlay ===
export function registerPmgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "permmem");
  if (!parent) return;
  const L = async () => await import("../lib/permanent-memory.js");
  parent
    .command("pmgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PMGOV_PROFILE_MATURITY_V2,
            pinLifecycle: m.PMGOV_PIN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePmgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPmgovPinsPerProfileV2(),
            idleMs: m.getPmgovProfileIdleMsV2(),
            stuckMs: m.getPmgovPinStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePmgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPmgovPinsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPmgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPmgovPinStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--bucket <v>", "bucket")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPmgovProfileV2({ id, owner, bucket: o.bucket }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgov-dormant-v2 <id>")
    .description("Dormant profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).dormantPmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePmgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchPmgovProfileV2(id), null, 2));
    });
  parent
    .command("pmgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPmgovProfileV2(id), null, 2));
    });
  parent
    .command("pmgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPmgovProfilesV2(), null, 2));
    });
  parent
    .command("pmgov-create-pin-v2 <id> <profileId>")
    .description("Create pin")
    .option("--key <v>", "key")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPmgovPinV2({ id, profileId, key: o.key }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgov-pinning-pin-v2 <id>")
    .description("Mark pin as pinning")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).pinningPmgovPinV2(id), null, 2));
    });
  parent
    .command("pmgov-complete-pin-v2 <id>")
    .description("Complete pin")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completePinPmgovV2(id), null, 2));
    });
  parent
    .command("pmgov-fail-pin-v2 <id> [reason]")
    .description("Fail pin")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPmgovPinV2(id, reason), null, 2),
      );
    });
  parent
    .command("pmgov-cancel-pin-v2 <id> [reason]")
    .description("Cancel pin")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPmgovPinV2(id, reason), null, 2),
      );
    });
  parent
    .command("pmgov-get-pin-v2 <id>")
    .description("Get pin")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPmgovPinV2(id), null, 2));
    });
  parent
    .command("pmgov-list-pins-v2")
    .description("List pins")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPmgovPinsV2(), null, 2));
    });
  parent
    .command("pmgov-auto-dormant-idle-v2")
    .description("Auto-dormant idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDormantIdlePmgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("pmgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck pins")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPmgovPinsV2(), null, 2),
      );
    });
  parent
    .command("pmgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getPermanentMemoryGovStatsV2(), null, 2),
      );
    });
}
