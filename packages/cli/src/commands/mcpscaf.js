/**
 * `cc mcpscaf` — MCP Scaffold V2 governance overlay (in-memory, atop lib/mcp-scaffold.js).
 */
import {
  MSCAF_PROFILE_MATURITY_V2, MSCAF_GENERATION_LIFECYCLE_V2,
  setMaxActiveMscafProfilesPerOwnerV2, getMaxActiveMscafProfilesPerOwnerV2,
  setMaxPendingMscafGenerationsPerProfileV2, getMaxPendingMscafGenerationsPerProfileV2,
  setMscafProfileIdleMsV2, getMscafProfileIdleMsV2,
  setMscafGenerationStuckMsV2, getMscafGenerationStuckMsV2,
  registerMscafProfileV2, activateMscafProfileV2, staleMscafProfileV2, archiveMscafProfileV2, touchMscafProfileV2, getMscafProfileV2, listMscafProfilesV2,
  createMscafGenerationV2, generatingMscafGenerationV2, generateMscafGenerationV2, failMscafGenerationV2, cancelMscafGenerationV2, getMscafGenerationV2, listMscafGenerationsV2,
  autoStaleIdleMscafProfilesV2, autoFailStuckMscafGenerationsV2, getMcpScaffoldGovStatsV2, _resetStateMcpScaffoldV2,
} from "../lib/mcp-scaffold.js";

export function registerMcpscafCommand(program) {
  const ms = program.command("mcpscaf").description("MCP Scaffold V2 governance");
  ms.command("enums-v2").action(() => console.log(JSON.stringify({ profileMaturity: MSCAF_PROFILE_MATURITY_V2, generationLifecycle: MSCAF_GENERATION_LIFECYCLE_V2 }, null, 2)));
  ms.command("config-v2").action(() => console.log(JSON.stringify({ maxActiveMscafProfilesPerOwner: getMaxActiveMscafProfilesPerOwnerV2(), maxPendingMscafGenerationsPerProfile: getMaxPendingMscafGenerationsPerProfileV2(), mscafProfileIdleMs: getMscafProfileIdleMsV2(), mscafGenerationStuckMs: getMscafGenerationStuckMsV2() }, null, 2)));
  ms.command("set-max-active-v2 <n>").action((n) => { setMaxActiveMscafProfilesPerOwnerV2(Number(n)); console.log("ok"); });
  ms.command("set-max-pending-v2 <n>").action((n) => { setMaxPendingMscafGenerationsPerProfileV2(Number(n)); console.log("ok"); });
  ms.command("set-idle-ms-v2 <n>").action((n) => { setMscafProfileIdleMsV2(Number(n)); console.log("ok"); });
  ms.command("set-stuck-ms-v2 <n>").action((n) => { setMscafGenerationStuckMsV2(Number(n)); console.log("ok"); });
  ms.command("register-profile-v2 <id> <owner>").option("--transport <t>", "transport").action((id, owner, o) => console.log(JSON.stringify(registerMscafProfileV2({ id, owner, transport: o.transport }), null, 2)));
  ms.command("activate-profile-v2 <id>").action((id) => console.log(JSON.stringify(activateMscafProfileV2(id), null, 2)));
  ms.command("stale-profile-v2 <id>").action((id) => console.log(JSON.stringify(staleMscafProfileV2(id), null, 2)));
  ms.command("archive-profile-v2 <id>").action((id) => console.log(JSON.stringify(archiveMscafProfileV2(id), null, 2)));
  ms.command("touch-profile-v2 <id>").action((id) => console.log(JSON.stringify(touchMscafProfileV2(id), null, 2)));
  ms.command("get-profile-v2 <id>").action((id) => console.log(JSON.stringify(getMscafProfileV2(id), null, 2)));
  ms.command("list-profiles-v2").action(() => console.log(JSON.stringify(listMscafProfilesV2(), null, 2)));
  ms.command("create-generation-v2 <id> <profileId>").option("--target <t>", "target").action((id, profileId, o) => console.log(JSON.stringify(createMscafGenerationV2({ id, profileId, target: o.target }), null, 2)));
  ms.command("generating-generation-v2 <id>").action((id) => console.log(JSON.stringify(generatingMscafGenerationV2(id), null, 2)));
  ms.command("generate-generation-v2 <id>").action((id) => console.log(JSON.stringify(generateMscafGenerationV2(id), null, 2)));
  ms.command("fail-generation-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(failMscafGenerationV2(id, reason), null, 2)));
  ms.command("cancel-generation-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(cancelMscafGenerationV2(id, reason), null, 2)));
  ms.command("get-generation-v2 <id>").action((id) => console.log(JSON.stringify(getMscafGenerationV2(id), null, 2)));
  ms.command("list-generations-v2").action(() => console.log(JSON.stringify(listMscafGenerationsV2(), null, 2)));
  ms.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdleMscafProfilesV2(), null, 2)));
  ms.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckMscafGenerationsV2(), null, 2)));
  ms.command("gov-stats-v2").action(() => console.log(JSON.stringify(getMcpScaffoldGovStatsV2(), null, 2)));
  ms.command("reset-state-v2").action(() => { _resetStateMcpScaffoldV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
