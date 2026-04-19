/**
 * `cc uprof` — User Profile V2 governance overlay.
 *
 * In-memory governance for user profile maturity + preference lifecycle, layered
 * atop `lib/user-profile.js`. Independent of legacy SQLite/file profile storage.
 */

import {
  USER_PROFILE_MATURITY_V2,
  USER_PREF_LIFECYCLE_V2,
  setMaxActiveUserProfilesPerOwnerV2,
  getMaxActiveUserProfilesPerOwnerV2,
  setMaxPendingUserPrefsPerProfileV2,
  getMaxPendingUserPrefsPerProfileV2,
  setUserProfileIdleMsV2,
  getUserProfileIdleMsV2,
  setUserPrefStuckMsV2,
  getUserPrefStuckMsV2,
  registerUserProfileV2,
  activateUserProfileV2,
  dormantUserProfileV2,
  archiveUserProfileV2,
  touchUserProfileV2,
  getUserProfileV2,
  listUserProfilesV2,
  createUserPrefV2,
  applyUserPrefV2,
  rejectUserPrefV2,
  supersedeUserPrefV2,
  cancelUserPrefV2,
  getUserPrefV2,
  listUserPrefsV2,
  autoDormantIdleUserProfilesV2,
  autoCancelStaleUserPrefsV2,
  getUserProfileGovStatsV2,
  _resetStateUserProfileV2,
} from "../lib/user-profile.js";

export function registerUprofCommand(program) {
  const up = program.command("uprof").description("User Profile V2 governance");
  up.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: USER_PROFILE_MATURITY_V2,
          prefLifecycle: USER_PREF_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  up.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveUserProfilesPerOwner: getMaxActiveUserProfilesPerOwnerV2(),
          maxPendingUserPrefsPerProfile: getMaxPendingUserPrefsPerProfileV2(),
          userProfileIdleMs: getUserProfileIdleMsV2(),
          userPrefStuckMs: getUserPrefStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  up.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveUserProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  up.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingUserPrefsPerProfileV2(Number(n));
    console.log("ok");
  });
  up.command("set-idle-ms-v2 <n>").action((n) => {
    setUserProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  up.command("set-stuck-ms-v2 <n>").action((n) => {
    setUserPrefStuckMsV2(Number(n));
    console.log("ok");
  });
  up.command("register-profile-v2 <id> <owner>")
    .option("--handle <h>", "handle")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerUserProfileV2({ id, owner, handle: o.handle }),
          null,
          2,
        ),
      ),
    );
  up.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateUserProfileV2(id), null, 2)),
  );
  up.command("dormant-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(dormantUserProfileV2(id), null, 2)),
  );
  up.command("archive-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(archiveUserProfileV2(id), null, 2)),
  );
  up.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchUserProfileV2(id), null, 2)),
  );
  up.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getUserProfileV2(id), null, 2)),
  );
  up.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listUserProfilesV2(), null, 2)),
  );
  up.command("create-pref-v2 <id> <profileId>")
    .option("--key <k>", "key")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(
          createUserPrefV2({ id, profileId, key: o.key }),
          null,
          2,
        ),
      ),
    );
  up.command("apply-pref-v2 <id>").action((id) =>
    console.log(JSON.stringify(applyUserPrefV2(id), null, 2)),
  );
  up.command("reject-pref-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(rejectUserPrefV2(id, reason), null, 2)),
  );
  up.command("supersede-pref-v2 <id>").action((id) =>
    console.log(JSON.stringify(supersedeUserPrefV2(id), null, 2)),
  );
  up.command("cancel-pref-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelUserPrefV2(id, reason), null, 2)),
  );
  up.command("get-pref-v2 <id>").action((id) =>
    console.log(JSON.stringify(getUserPrefV2(id), null, 2)),
  );
  up.command("list-prefs-v2").action(() =>
    console.log(JSON.stringify(listUserPrefsV2(), null, 2)),
  );
  up.command("auto-dormant-idle-v2").action(() =>
    console.log(JSON.stringify(autoDormantIdleUserProfilesV2(), null, 2)),
  );
  up.command("auto-cancel-stale-v2").action(() =>
    console.log(JSON.stringify(autoCancelStaleUserPrefsV2(), null, 2)),
  );
  up.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getUserProfileGovStatsV2(), null, 2)),
  );
  up.command("reset-state-v2").action(() => {
    _resetStateUserProfileV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
