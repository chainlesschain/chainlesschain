/**
 * `cc seshsearch` — Session Search V2 governance overlay (in-memory, atop lib/session-search.js).
 */
import {
  SSCH_PROFILE_MATURITY_V2,
  SSCH_QUERY_LIFECYCLE_V2,
  setMaxActiveSschProfilesPerOwnerV2,
  getMaxActiveSschProfilesPerOwnerV2,
  setMaxPendingSschQueriesPerProfileV2,
  getMaxPendingSschQueriesPerProfileV2,
  setSschProfileIdleMsV2,
  getSschProfileIdleMsV2,
  setSschQueryStuckMsV2,
  getSschQueryStuckMsV2,
  registerSschProfileV2,
  activateSschProfileV2,
  staleSschProfileV2,
  archiveSschProfileV2,
  touchSschProfileV2,
  getSschProfileV2,
  listSschProfilesV2,
  createSschQueryV2,
  searchingSschQueryV2,
  completeSschQueryV2,
  failSschQueryV2,
  cancelSschQueryV2,
  getSschQueryV2,
  listSschQueriesV2,
  autoStaleIdleSschProfilesV2,
  autoFailStuckSschQueriesV2,
  getSessionSearchGovStatsV2,
  _resetStateSessionSearchV2,
} from "../lib/session-search.js";

export function registerSeshsearchCommand(program) {
  const ss = program
    .command("seshsearch")
    .description("Session Search V2 governance");
  ss.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          profileMaturity: SSCH_PROFILE_MATURITY_V2,
          queryLifecycle: SSCH_QUERY_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  ss.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveSschProfilesPerOwner: getMaxActiveSschProfilesPerOwnerV2(),
          maxPendingSschQueriesPerProfile:
            getMaxPendingSschQueriesPerProfileV2(),
          sschProfileIdleMs: getSschProfileIdleMsV2(),
          sschQueryStuckMs: getSschQueryStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  ss.command("set-max-active-v2 <n>").action((n) => {
    setMaxActiveSschProfilesPerOwnerV2(Number(n));
    console.log("ok");
  });
  ss.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingSschQueriesPerProfileV2(Number(n));
    console.log("ok");
  });
  ss.command("set-idle-ms-v2 <n>").action((n) => {
    setSschProfileIdleMsV2(Number(n));
    console.log("ok");
  });
  ss.command("set-stuck-ms-v2 <n>").action((n) => {
    setSschQueryStuckMsV2(Number(n));
    console.log("ok");
  });
  ss.command("register-profile-v2 <id> <owner>")
    .option("--scope <s>", "scope")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerSschProfileV2({ id, owner, scope: o.scope }),
          null,
          2,
        ),
      ),
    );
  ss.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateSschProfileV2(id), null, 2)),
  );
  ss.command("stale-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(staleSschProfileV2(id), null, 2)),
  );
  ss.command("archive-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(archiveSschProfileV2(id), null, 2)),
  );
  ss.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchSschProfileV2(id), null, 2)),
  );
  ss.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getSschProfileV2(id), null, 2)),
  );
  ss.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listSschProfilesV2(), null, 2)),
  );
  ss.command("create-query-v2 <id> <profileId>")
    .option("--q <q>", "query string")
    .action((id, profileId, o) =>
      console.log(
        JSON.stringify(createSschQueryV2({ id, profileId, q: o.q }), null, 2),
      ),
    );
  ss.command("searching-query-v2 <id>").action((id) =>
    console.log(JSON.stringify(searchingSschQueryV2(id), null, 2)),
  );
  ss.command("complete-query-v2 <id>").action((id) =>
    console.log(JSON.stringify(completeSschQueryV2(id), null, 2)),
  );
  ss.command("fail-query-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(failSschQueryV2(id, reason), null, 2)),
  );
  ss.command("cancel-query-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelSschQueryV2(id, reason), null, 2)),
  );
  ss.command("get-query-v2 <id>").action((id) =>
    console.log(JSON.stringify(getSschQueryV2(id), null, 2)),
  );
  ss.command("list-queries-v2").action(() =>
    console.log(JSON.stringify(listSschQueriesV2(), null, 2)),
  );
  ss.command("auto-stale-idle-v2").action(() =>
    console.log(JSON.stringify(autoStaleIdleSschProfilesV2(), null, 2)),
  );
  ss.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckSschQueriesV2(), null, 2)),
  );
  ss.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getSessionSearchGovStatsV2(), null, 2)),
  );
  ss.command("reset-state-v2").action(() => {
    _resetStateSessionSearchV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
