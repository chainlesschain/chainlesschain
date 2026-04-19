/**
 * `cc webfetch` — Web Fetch V2 governance overlay (in-memory, atop lib/web-fetch.js).
 */
import {
  WFET_TARGET_MATURITY_V2,
  WFET_JOB_LIFECYCLE_V2,
  setMaxActiveWfetTargetsPerOwnerV2,
  getMaxActiveWfetTargetsPerOwnerV2,
  setMaxPendingWfetJobsPerTargetV2,
  getMaxPendingWfetJobsPerTargetV2,
  setWfetTargetIdleMsV2,
  getWfetTargetIdleMsV2,
  setWfetJobStuckMsV2,
  getWfetJobStuckMsV2,
  registerWfetTargetV2,
  activateWfetTargetV2,
  degradeWfetTargetV2,
  retireWfetTargetV2,
  touchWfetTargetV2,
  getWfetTargetV2,
  listWfetTargetsV2,
  createWfetJobV2,
  fetchingWfetJobV2,
  succeedWfetJobV2,
  failWfetJobV2,
  cancelWfetJobV2,
  getWfetJobV2,
  listWfetJobsV2,
  autoDegradeIdleWfetTargetsV2,
  autoFailStuckWfetJobsV2,
  getWebFetchGovStatsV2,
  _resetStateWebFetchV2,
} from "../lib/web-fetch.js";

export function registerWebfetchCommand(program) {
  const wf = program.command("webfetch").description("Web Fetch V2 governance");
  wf.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          targetMaturity: WFET_TARGET_MATURITY_V2,
          jobLifecycle: WFET_JOB_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  wf.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveWfetTargetsPerOwner: getMaxActiveWfetTargetsPerOwnerV2(),
          maxPendingWfetJobsPerTarget: getMaxPendingWfetJobsPerTargetV2(),
          wfetTargetIdleMs: getWfetTargetIdleMsV2(),
          wfetJobStuckMs: getWfetJobStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  wf.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveWfetTargetsPerOwnerV2(Number(n));
    console.log("ok");
  });
  wf.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingWfetJobsPerTargetV2(Number(n));
    console.log("ok");
  });
  wf.command("set-idle-ms-v2 <n>").action((n) => {
    setWfetTargetIdleMsV2(Number(n));
    console.log("ok");
  });
  wf.command("set-stuck-ms-v2 <n>").action((n) => {
    setWfetJobStuckMsV2(Number(n));
    console.log("ok");
  });
  wf.command("register-target-v2 <id> <owner>")
    .option("--baseUrl <u>", "baseUrl")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerWfetTargetV2({ id, owner, baseUrl: o.baseUrl }),
          null,
          2,
        ),
      ),
    );
  wf.command("activate-target-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateWfetTargetV2(id), null, 2)),
  );
  wf.command("degrade-target-v2 <id>").action((id) =>
    console.log(JSON.stringify(degradeWfetTargetV2(id), null, 2)),
  );
  wf.command("retire-target-v2 <id>").action((id) =>
    console.log(JSON.stringify(retireWfetTargetV2(id), null, 2)),
  );
  wf.command("touch-target-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchWfetTargetV2(id), null, 2)),
  );
  wf.command("get-target-v2 <id>").action((id) =>
    console.log(JSON.stringify(getWfetTargetV2(id), null, 2)),
  );
  wf.command("list-targets-v2").action(() =>
    console.log(JSON.stringify(listWfetTargetsV2(), null, 2)),
  );
  wf.command("create-job-v2 <id> <targetId>")
    .option("--kind <k>", "kind", "GET")
    .action((id, targetId, o) =>
      console.log(
        JSON.stringify(
          createWfetJobV2({ id, targetId, kind: o.kind }),
          null,
          2,
        ),
      ),
    );
  wf.command("fetching-job-v2 <id>").action((id) =>
    console.log(JSON.stringify(fetchingWfetJobV2(id), null, 2)),
  );
  wf.command("succeed-job-v2 <id>").action((id) =>
    console.log(JSON.stringify(succeedWfetJobV2(id), null, 2)),
  );
  wf.command("fail-job-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failWfetJobV2(id, reason), null, 2)),
  );
  wf.command("cancel-job-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelWfetJobV2(id, reason), null, 2)),
  );
  wf.command("get-job-v2 <id>").action((id) =>
    console.log(JSON.stringify(getWfetJobV2(id), null, 2)),
  );
  wf.command("list-jobs-v2").action(() =>
    console.log(JSON.stringify(listWfetJobsV2(), null, 2)),
  );
  wf.command("auto-degrade-idle-v2").action(() =>
    console.log(JSON.stringify(autoDegradeIdleWfetTargetsV2(), null, 2)),
  );
  wf.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckWfetJobsV2(), null, 2)),
  );
  wf.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getWebFetchGovStatsV2(), null, 2)),
  );
  wf.command("reset-state-v2").action(() => {
    _resetStateWebFetchV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
