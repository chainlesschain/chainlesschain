/**
 * `cc topiccls` — Topic Classifier V2 governance overlay.
 *
 * In-memory governance for classifier profiles + job lifecycle, layered atop
 * `lib/topic-classifier.js`.
 */

import {
  TOPIC_CLS_PROFILE_MATURITY_V2,
  TOPIC_CLS_JOB_LIFECYCLE_V2,
  setMaxActiveTopicClsProfilesPerOwnerV2,
  getMaxActiveTopicClsProfilesPerOwnerV2,
  setMaxPendingTopicClsJobsPerProfileV2,
  getMaxPendingTopicClsJobsPerProfileV2,
  setTopicClsProfileIdleMsV2,
  getTopicClsProfileIdleMsV2,
  setTopicClsJobStuckMsV2,
  getTopicClsJobStuckMsV2,
  registerTopicClsProfileV2,
  activateTopicClsProfileV2,
  staleTopicClsProfileV2,
  archiveTopicClsProfileV2,
  touchTopicClsProfileV2,
  getTopicClsProfileV2,
  listTopicClsProfilesV2,
  createTopicClsJobV2,
  startTopicClsJobV2,
  completeTopicClsJobV2,
  failTopicClsJobV2,
  cancelTopicClsJobV2,
  getTopicClsJobV2,
  listTopicClsJobsV2,
  autoStaleIdleTopicClsProfilesV2,
  autoFailStuckTopicClsJobsV2,
  getTopicClassifierGovStatsV2,
  _resetStateTopicClsV2,
} from "../lib/topic-classifier.js";

export function registerTopicClsCommand(program) {
  const tc = program
    .command("topiccls")
    .description("Topic Classifier V2 governance");
  tc.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: TOPIC_CLS_PROFILE_MATURITY_V2,
          jobLifecycle: TOPIC_CLS_JOB_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  tc.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveTopicClsProfilesPerOwner:
            getMaxActiveTopicClsProfilesPerOwnerV2(),
          maxPendingTopicClsJobsPerProfile:
            getMaxPendingTopicClsJobsPerProfileV2(),
          topicClsProfileIdleMs: getTopicClsProfileIdleMsV2(),
          topicClsJobStuckMs: getTopicClsJobStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  tc.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveTopicClsProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  tc.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingTopicClsJobsPerProfileV2(Number(n));
    console.log("ok");
  });
  tc.command("set-idle-ms-v2 <n>").action((n) => {
    setTopicClsProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  tc.command("set-stuck-ms-v2 <n>").action((n) => {
    setTopicClsJobStuckMsV2(Number(n));
    console.log("ok");
  });
  tc.command("register-profile-v2 <id> <owner>")
    .option("--model <m>", "model")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerTopicClsProfileV2({ id, owner, model: o.model }),
          null,
          2,
        ),
      ),
    );
  tc.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateTopicClsProfileV2(id), null, 2)),
  );
  tc.command("stale-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(staleTopicClsProfileV2(id), null, 2)),
  );
  tc.command("archive-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(archiveTopicClsProfileV2(id), null, 2)),
  );
  tc.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchTopicClsProfileV2(id), null, 2)),
  );
  tc.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getTopicClsProfileV2(id), null, 2)),
  );
  tc.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listTopicClsProfilesV2(), null, 2)),
  );
  tc.command("create-job-v2 <id> <profileId>")
    .option("--text <t>", "text")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(
          createTopicClsJobV2({ id, profileId, text: o.text }),
          null,
          2,
        ),
      ),
    );
  tc.command("start-job-v2 <id>").action((id) =>
    console.log(JSON.stringify(startTopicClsJobV2(id), null, 2)),
  );
  tc.command("complete-job-v2 <id>").action((id) =>
    console.log(JSON.stringify(completeTopicClsJobV2(id), null, 2)),
  );
  tc.command("fail-job-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failTopicClsJobV2(id, reason), null, 2)),
  );
  tc.command("cancel-job-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelTopicClsJobV2(id, reason), null, 2)),
  );
  tc.command("get-job-v2 <id>").action((id) =>
    console.log(JSON.stringify(getTopicClsJobV2(id), null, 2)),
  );
  tc.command("list-jobs-v2").action(() =>
    console.log(JSON.stringify(listTopicClsJobsV2(), null, 2)),
  );
  tc.command("auto-stale-idle-v2").action(() =>
    console.log(JSON.stringify(autoStaleIdleTopicClsProfilesV2(), null, 2)),
  );
  tc.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckTopicClsJobsV2(), null, 2)),
  );
  tc.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getTopicClassifierGovStatsV2(), null, 2)),
  );
  tc.command("reset-state-v2").action(() => {
    _resetStateTopicClsV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
