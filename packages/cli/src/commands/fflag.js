/**
 * Feature Flags V2 governance commands — `cc fflag ...`
 * 在内存中治理 FF profile（pending/active/paused/archived）+ eval 生命周期。
 */
import {
  FFLAG_PROFILE_MATURITY_V2,
  FFLAG_EVAL_LIFECYCLE_V2,
  registerFflagProfileV2,
  activateFflagProfileV2,
  pauseFflagProfileV2,
  archiveFflagProfileV2,
  touchFflagProfileV2,
  getFflagProfileV2,
  listFflagProfilesV2,
  createFflagEvalV2,
  evaluatingFflagEvalV2,
  evaluateFflagEvalV2,
  failFflagEvalV2,
  cancelFflagEvalV2,
  getFflagEvalV2,
  listFflagEvalsV2,
  setMaxActiveFflagProfilesPerOwnerV2,
  getMaxActiveFflagProfilesPerOwnerV2,
  setMaxPendingFflagEvalsPerProfileV2,
  getMaxPendingFflagEvalsPerProfileV2,
  setFflagProfileIdleMsV2,
  getFflagProfileIdleMsV2,
  setFflagEvalStuckMsV2,
  getFflagEvalStuckMsV2,
  autoPauseIdleFflagProfilesV2,
  autoFailStuckFflagEvalsV2,
  getFeatureFlagsGovStatsV2,
} from "../lib/feature-flags.js";

export function registerFflagCommand(program) {
  const fflag = program
    .command("fflag")
    .description("Feature Flags V2 governance (in-memory, CLI v0.143.0)");

  fflag
    .command("enums-v2")
    .description("Show V2 maturity + lifecycle enums")
    .action(() => {
      console.log(
        JSON.stringify(
          { FFLAG_PROFILE_MATURITY_V2, FFLAG_EVAL_LIFECYCLE_V2 },
          null,
          2,
        ),
      );
    });

  fflag
    .command("register-profile-v2")
    .description("Register a feature flag profile (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--scope <scope>", "scope tag", "*")
    .action((o) =>
      console.log(JSON.stringify(registerFflagProfileV2(o), null, 2)),
    );
  fflag
    .command("activate-profile-v2 <id>")
    .description("Transition profile to active")
    .action((id) =>
      console.log(JSON.stringify(activateFflagProfileV2(id), null, 2)),
    );
  fflag
    .command("pause-profile-v2 <id>")
    .description("Transition profile to paused")
    .action((id) =>
      console.log(JSON.stringify(pauseFflagProfileV2(id), null, 2)),
    );
  fflag
    .command("archive-profile-v2 <id>")
    .description("Transition profile to archived (terminal)")
    .action((id) =>
      console.log(JSON.stringify(archiveFflagProfileV2(id), null, 2)),
    );
  fflag
    .command("touch-profile-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) =>
      console.log(JSON.stringify(touchFflagProfileV2(id), null, 2)),
    );
  fflag
    .command("get-profile-v2 <id>")
    .description("Get a profile by id")
    .action((id) =>
      console.log(JSON.stringify(getFflagProfileV2(id), null, 2)),
    );
  fflag
    .command("list-profiles-v2")
    .description("List all profiles")
    .action(() => console.log(JSON.stringify(listFflagProfilesV2(), null, 2)));

  fflag
    .command("create-eval-v2")
    .description("Create an eval (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--key <key>", "flag key", "")
    .action((o) => console.log(JSON.stringify(createFflagEvalV2(o), null, 2)));
  fflag
    .command("evaluating-eval-v2 <id>")
    .description("Mark eval as evaluating")
    .action((id) =>
      console.log(JSON.stringify(evaluatingFflagEvalV2(id), null, 2)),
    );
  fflag
    .command("evaluate-eval-v2 <id>")
    .description("Mark eval as evaluated (terminal)")
    .action((id) =>
      console.log(JSON.stringify(evaluateFflagEvalV2(id), null, 2)),
    );
  fflag
    .command("fail-eval-v2 <id>")
    .description("Mark eval as failed (terminal)")
    .option("--reason <reason>")
    .action((id, o) =>
      console.log(JSON.stringify(failFflagEvalV2(id, o.reason), null, 2)),
    );
  fflag
    .command("cancel-eval-v2 <id>")
    .description("Mark eval as cancelled (terminal)")
    .option("--reason <reason>")
    .action((id, o) =>
      console.log(JSON.stringify(cancelFflagEvalV2(id, o.reason), null, 2)),
    );
  fflag
    .command("get-eval-v2 <id>")
    .description("Get an eval by id")
    .action((id) => console.log(JSON.stringify(getFflagEvalV2(id), null, 2)));
  fflag
    .command("list-evals-v2")
    .description("List all evals")
    .action(() => console.log(JSON.stringify(listFflagEvalsV2(), null, 2)));

  fflag
    .command("config-v2")
    .description("Show V2 config (caps + idle/stuck windows)")
    .action(() => {
      console.log(
        JSON.stringify(
          {
            maxActiveFflagProfilesPerOwner:
              getMaxActiveFflagProfilesPerOwnerV2(),
            maxPendingFflagEvalsPerProfile:
              getMaxPendingFflagEvalsPerProfileV2(),
            fflagProfileIdleMs: getFflagProfileIdleMsV2(),
            fflagEvalStuckMs: getFflagEvalStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  fflag
    .command("set-max-active-profiles-v2 <n>")
    .description("Set max active profiles per owner")
    .action((n) => {
      setMaxActiveFflagProfilesPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxActiveFflagProfilesPerOwner:
              getMaxActiveFflagProfilesPerOwnerV2(),
          },
          null,
          2,
        ),
      );
    });
  fflag
    .command("set-max-pending-evals-v2 <n>")
    .description("Set max pending evals per profile")
    .action((n) => {
      setMaxPendingFflagEvalsPerProfileV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxPendingFflagEvalsPerProfile:
              getMaxPendingFflagEvalsPerProfileV2(),
          },
          null,
          2,
        ),
      );
    });
  fflag
    .command("set-profile-idle-ms-v2 <ms>")
    .description("Set profile idle window")
    .action((ms) => {
      setFflagProfileIdleMsV2(Number(ms));
      console.log(
        JSON.stringify(
          { fflagProfileIdleMs: getFflagProfileIdleMsV2() },
          null,
          2,
        ),
      );
    });
  fflag
    .command("set-eval-stuck-ms-v2 <ms>")
    .description("Set eval stuck window")
    .action((ms) => {
      setFflagEvalStuckMsV2(Number(ms));
      console.log(
        JSON.stringify({ fflagEvalStuckMs: getFflagEvalStuckMsV2() }, null, 2),
      );
    });
  fflag
    .command("auto-pause-idle-v2")
    .description("Auto-pause idle active profiles")
    .action(() =>
      console.log(JSON.stringify(autoPauseIdleFflagProfilesV2(), null, 2)),
    );
  fflag
    .command("auto-fail-stuck-v2")
    .description("Auto-fail stuck evaluating evals")
    .action(() =>
      console.log(JSON.stringify(autoFailStuckFflagEvalsV2(), null, 2)),
    );
  fflag
    .command("gov-stats-v2")
    .description("Show V2 governance stats")
    .action(() =>
      console.log(JSON.stringify(getFeatureFlagsGovStatsV2(), null, 2)),
    );
}
