/**
 * BM25 Search V2 governance commands — `cc bm25 ...`
 * 在内存中治理 BM25 profile (pending/active/stale/archived) + query 生命周期。
 */
import {
  BM25_PROFILE_MATURITY_V2,
  BM25_QUERY_LIFECYCLE_V2,
  registerBm25ProfileV2,
  activateBm25ProfileV2,
  staleBm25ProfileV2,
  archiveBm25ProfileV2,
  touchBm25ProfileV2,
  getBm25ProfileV2,
  listBm25ProfilesV2,
  createBm25QueryV2,
  searchingBm25QueryV2,
  completeBm25QueryV2,
  failBm25QueryV2,
  cancelBm25QueryV2,
  getBm25QueryV2,
  listBm25QueriesV2,
  setMaxActiveBm25ProfilesPerOwnerV2,
  getMaxActiveBm25ProfilesPerOwnerV2,
  setMaxPendingBm25QueriesPerProfileV2,
  getMaxPendingBm25QueriesPerProfileV2,
  setBm25ProfileIdleMsV2,
  getBm25ProfileIdleMsV2,
  setBm25QueryStuckMsV2,
  getBm25QueryStuckMsV2,
  autoStaleIdleBm25ProfilesV2,
  autoFailStuckBm25QueriesV2,
  getBm25SearchGovStatsV2,
} from "../lib/bm25-search.js";

export function registerBm25Command(program) {
  const b = program
    .command("bm25")
    .description("BM25 Search V2 governance (in-memory, CLI v0.143.0)");

  b.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        { BM25_PROFILE_MATURITY_V2, BM25_QUERY_LIFECYCLE_V2 },
        null,
        2,
      ),
    ),
  );
  b.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--field <field>", "indexed field", "content")
    .action((o) =>
      console.log(JSON.stringify(registerBm25ProfileV2(o), null, 2)),
    );
  b.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activateBm25ProfileV2(id), null, 2)),
  );
  b.command("stale-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(staleBm25ProfileV2(id), null, 2)),
  );
  b.command("archive-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(archiveBm25ProfileV2(id), null, 2)),
  );
  b.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchBm25ProfileV2(id), null, 2)),
  );
  b.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getBm25ProfileV2(id), null, 2)),
  );
  b.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listBm25ProfilesV2(), null, 2)),
  );

  b.command("create-query-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--q <q>", "query text", "")
    .action((o) => console.log(JSON.stringify(createBm25QueryV2(o), null, 2)));
  b.command("searching-query-v2 <id>").action((id) =>
    console.log(JSON.stringify(searchingBm25QueryV2(id), null, 2)),
  );
  b.command("complete-query-v2 <id>").action((id) =>
    console.log(JSON.stringify(completeBm25QueryV2(id), null, 2)),
  );
  b.command("fail-query-v2 <id>")
    .option("--reason <r>")
    .action((id, o) =>
      console.log(JSON.stringify(failBm25QueryV2(id, o.reason), null, 2)),
    );
  b.command("cancel-query-v2 <id>")
    .option("--reason <r>")
    .action((id, o) =>
      console.log(JSON.stringify(cancelBm25QueryV2(id, o.reason), null, 2)),
    );
  b.command("get-query-v2 <id>").action((id) =>
    console.log(JSON.stringify(getBm25QueryV2(id), null, 2)),
  );
  b.command("list-queries-v2").action(() =>
    console.log(JSON.stringify(listBm25QueriesV2(), null, 2)),
  );

  b.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActiveBm25ProfilesPerOwner: getMaxActiveBm25ProfilesPerOwnerV2(),
          maxPendingBm25QueriesPerProfile:
            getMaxPendingBm25QueriesPerProfileV2(),
          bm25ProfileIdleMs: getBm25ProfileIdleMsV2(),
          bm25QueryStuckMs: getBm25QueryStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  b.command("set-max-active-profiles-v2 <n>").action((n) => {
    setMaxActiveBm25ProfilesPerOwnerV2(Number(n));
    console.log(
      JSON.stringify(
        { maxActiveBm25ProfilesPerOwner: getMaxActiveBm25ProfilesPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  b.command("set-max-pending-queries-v2 <n>").action((n) => {
    setMaxPendingBm25QueriesPerProfileV2(Number(n));
    console.log(
      JSON.stringify(
        {
          maxPendingBm25QueriesPerProfile:
            getMaxPendingBm25QueriesPerProfileV2(),
        },
        null,
        2,
      ),
    );
  });
  b.command("set-profile-idle-ms-v2 <ms>").action((ms) => {
    setBm25ProfileIdleMsV2(Number(ms));
    console.log(
      JSON.stringify({ bm25ProfileIdleMs: getBm25ProfileIdleMsV2() }, null, 2),
    );
  });
  b.command("set-query-stuck-ms-v2 <ms>").action((ms) => {
    setBm25QueryStuckMsV2(Number(ms));
    console.log(
      JSON.stringify({ bm25QueryStuckMs: getBm25QueryStuckMsV2() }, null, 2),
    );
  });
  b.command("auto-stale-idle-v2").action(() =>
    console.log(JSON.stringify(autoStaleIdleBm25ProfilesV2(), null, 2)),
  );
  b.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckBm25QueriesV2(), null, 2)),
  );
  b.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getBm25SearchGovStatsV2(), null, 2)),
  );
}
