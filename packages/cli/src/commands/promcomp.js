/**
 * Prompt Compressor V2 governance commands — `cc promcomp ...`
 * 在内存中治理 PCOMP profile (pending/active/stale/archived) + run 生命周期。
 */
import {
  PCOMP_PROFILE_MATURITY_V2,
  PCOMP_RUN_LIFECYCLE_V2,
  registerPcompProfileV2,
  activatePcompProfileV2,
  stalePcompProfileV2,
  archivePcompProfileV2,
  touchPcompProfileV2,
  getPcompProfileV2,
  listPcompProfilesV2,
  createPcompRunV2,
  compressingPcompRunV2,
  compressPcompRunV2,
  failPcompRunV2,
  cancelPcompRunV2,
  getPcompRunV2,
  listPcompRunsV2,
  setMaxActivePcompProfilesPerOwnerV2,
  getMaxActivePcompProfilesPerOwnerV2,
  setMaxPendingPcompRunsPerProfileV2,
  getMaxPendingPcompRunsPerProfileV2,
  setPcompProfileIdleMsV2,
  getPcompProfileIdleMsV2,
  setPcompRunStuckMsV2,
  getPcompRunStuckMsV2,
  autoStaleIdlePcompProfilesV2,
  autoFailStuckPcompRunsV2,
  getPromptCompressorGovStatsV2,
} from "../lib/prompt-compressor.js";

export function registerPromcompCommand(program) {
  const pc = program
    .command("promcomp")
    .description("Prompt Compressor V2 governance (in-memory, CLI v0.143.0)");

  pc.command("enums-v2")
    .description("Show V2 enums")
    .action(() =>
      console.log(
        JSON.stringify(
          { PCOMP_PROFILE_MATURITY_V2, PCOMP_RUN_LIFECYCLE_V2 },
          null,
          2,
        ),
      ),
    );
  pc.command("register-profile-v2")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--variant <variant>", "compressor variant", "default")
    .action((o) =>
      console.log(JSON.stringify(registerPcompProfileV2(o), null, 2)),
    );
  pc.command("activate-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(activatePcompProfileV2(id), null, 2)),
  );
  pc.command("stale-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(stalePcompProfileV2(id), null, 2)),
  );
  pc.command("archive-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(archivePcompProfileV2(id), null, 2)),
  );
  pc.command("touch-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchPcompProfileV2(id), null, 2)),
  );
  pc.command("get-profile-v2 <id>").action((id) =>
    console.log(JSON.stringify(getPcompProfileV2(id), null, 2)),
  );
  pc.command("list-profiles-v2").action(() =>
    console.log(JSON.stringify(listPcompProfilesV2(), null, 2)),
  );

  pc.command("create-run-v2")
    .requiredOption("--id <id>")
    .requiredOption("--profile-id <profileId>")
    .option("--input <input>", "input prompt", "")
    .action((o) => console.log(JSON.stringify(createPcompRunV2(o), null, 2)));
  pc.command("compressing-run-v2 <id>").action((id) =>
    console.log(JSON.stringify(compressingPcompRunV2(id), null, 2)),
  );
  pc.command("compress-run-v2 <id>").action((id) =>
    console.log(JSON.stringify(compressPcompRunV2(id), null, 2)),
  );
  pc.command("fail-run-v2 <id>")
    .option("--reason <r>")
    .action((id, o) =>
      console.log(JSON.stringify(failPcompRunV2(id, o.reason), null, 2)),
    );
  pc.command("cancel-run-v2 <id>")
    .option("--reason <r>")
    .action((id, o) =>
      console.log(JSON.stringify(cancelPcompRunV2(id, o.reason), null, 2)),
    );
  pc.command("get-run-v2 <id>").action((id) =>
    console.log(JSON.stringify(getPcompRunV2(id), null, 2)),
  );
  pc.command("list-runs-v2").action(() =>
    console.log(JSON.stringify(listPcompRunsV2(), null, 2)),
  );

  pc.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActivePcompProfilesPerOwner: getMaxActivePcompProfilesPerOwnerV2(),
          maxPendingPcompRunsPerProfile: getMaxPendingPcompRunsPerProfileV2(),
          pcompProfileIdleMs: getPcompProfileIdleMsV2(),
          pcompRunStuckMs: getPcompRunStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  pc.command("set-max-active-profiles-v2 <n>").action((n) => {
    setMaxActivePcompProfilesPerOwnerV2(Number(n));
    console.log(
      JSON.stringify(
        {
          maxActivePcompProfilesPerOwner: getMaxActivePcompProfilesPerOwnerV2(),
        },
        null,
        2,
      ),
    );
  });
  pc.command("set-max-pending-runs-v2 <n>").action((n) => {
    setMaxPendingPcompRunsPerProfileV2(Number(n));
    console.log(
      JSON.stringify(
        { maxPendingPcompRunsPerProfile: getMaxPendingPcompRunsPerProfileV2() },
        null,
        2,
      ),
    );
  });
  pc.command("set-profile-idle-ms-v2 <ms>").action((ms) => {
    setPcompProfileIdleMsV2(Number(ms));
    console.log(
      JSON.stringify(
        { pcompProfileIdleMs: getPcompProfileIdleMsV2() },
        null,
        2,
      ),
    );
  });
  pc.command("set-run-stuck-ms-v2 <ms>").action((ms) => {
    setPcompRunStuckMsV2(Number(ms));
    console.log(
      JSON.stringify({ pcompRunStuckMs: getPcompRunStuckMsV2() }, null, 2),
    );
  });
  pc.command("auto-stale-idle-v2").action(() =>
    console.log(JSON.stringify(autoStaleIdlePcompProfilesV2(), null, 2)),
  );
  pc.command("auto-fail-stuck-v2").action(() =>
    console.log(JSON.stringify(autoFailStuckPcompRunsV2(), null, 2)),
  );
  pc.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getPromptCompressorGovStatsV2(), null, 2)),
  );
}
