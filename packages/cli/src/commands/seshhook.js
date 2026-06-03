/**
 * `cc seshhook` — Session Hooks V2 governance overlay (in-memory, atop lib/session-hooks.js).
 */
import {
  SHOK_PROFILE_MATURITY_V2,
  SHOK_INVOCATION_LIFECYCLE_V2,
  setMaxActiveShokProfilesPerOwnerV2,
  getMaxActiveShokProfilesPerOwnerV2,
  setMaxPendingShokInvocationsPerProfileV2,
  getMaxPendingShokInvocationsPerProfileV2,
  setShokProfileIdleMsV2,
  getShokProfileIdleMsV2,
  setShokInvocationStuckMsV2,
  getShokInvocationStuckMsV2,
  registerShokProfileV2,
  activateShokProfileV2,
  disableShokProfileV2,
  retireShokProfileV2,
  touchShokProfileV2,
  getShokProfileV2,
  listShokProfilesV2,
  createShokInvocationV2,
  runningShokInvocationV2,
  completeShokInvocationV2,
  failShokInvocationV2,
  cancelShokInvocationV2,
  getShokInvocationV2,
  listShokInvocationsV2,
  autoDisableIdleShokProfilesV2,
  autoFailStuckShokInvocationsV2,
  getSessionHooksGovStatsV2,
  _resetStateSessionHooksV2,
} from "../lib/session-hooks.js";

export function registerSeshhookCommand(program) {
  const sh = program
    .command("seshhook")
    .description("Session Hooks V2 governance");
  sh.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: SHOK_PROFILE_MATURITY_V2,
          invocationLifecycle: SHOK_INVOCATION_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  sh.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveShokProfilesPerOwner: getMaxActiveShokProfilesPerOwnerV2(),
          maxPendingShokInvocationsPerProfile:
            getMaxPendingShokInvocationsPerProfileV2(),
          shokProfileIdleMs: getShokProfileIdleMsV2(),
          shokInvocationStuckMs: getShokInvocationStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  sh.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveShokProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  sh.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingShokInvocationsPerProfileV2(Number(n));
    console.log("ok");
  });
  sh.command("set-idle-ms-v2 <n>").action((n) => {
    setShokProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  sh.command("set-stuck-ms-v2 <n>").action((n) => {
    setShokInvocationStuckMsV2(Number(n));
    console.log("ok");
  });
  sh.command("register-profile-v2 <id> <owner>")
    .option("--event <e>", "event")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerShokProfileV2({ id, owner, event: o.event }),
          null,
          2,
        ),
      ),
    );
  sh.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateShokProfileV2(id), null, 2)),
  );
  sh.command("disable-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(disableShokProfileV2(id), null, 2)),
  );
  sh.command("retire-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(retireShokProfileV2(id), null, 2)),
  );
  sh.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchShokProfileV2(id), null, 2)),
  );
  sh.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getShokProfileV2(id), null, 2)),
  );
  sh.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listShokProfilesV2(), null, 2)),
  );
  sh.command("create-invocation-v2 <id> <profileId>")
    .option("--payload <p>", "payload")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(
          createShokInvocationV2({ id, profileId, payload: o.payload }),
          null,
          2,
        ),
      ),
    );
  sh.command("running-invocation-v2 <id>").action((id) =>
    console.log(JSON.stringify(runningShokInvocationV2(id), null, 2)),
  );
  sh.command("complete-invocation-v2 <id>").action((id) =>
    console.log(JSON.stringify(completeShokInvocationV2(id), null, 2)),
  );
  sh.command("fail-invocation-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failShokInvocationV2(id, reason), null, 2)),
  );
  sh.command("cancel-invocation-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelShokInvocationV2(id, reason), null, 2)),
  );
  sh.command("get-invocation-v2 <id>").action((id) =>
    console.log(JSON.stringify(getShokInvocationV2(id), null, 2)),
  );
  sh.command("list-invocations-v2").action(() =>
    console.log(JSON.stringify(listShokInvocationsV2(), null, 2)),
  );
  sh.command("auto-disable-idle-v2").action(() =>
    console.log(JSON.stringify(autoDisableIdleShokProfilesV2(), null, 2)),
  );
  sh.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckShokInvocationsV2(), null, 2)),
  );
  sh.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getSessionHooksGovStatsV2(), null, 2)),
  );
  sh.command("reset-state-v2").action(() => {
    _resetStateSessionHooksV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
