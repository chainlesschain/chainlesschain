/**
 * `cc svccont` — Service Container V2 governance overlay.
 *
 * In-memory governance for service containers + resolution lifecycle, layered
 * atop `lib/service-container.js`. Independent of legacy DI/registry helpers.
 */

import {
  SVC_CONTAINER_MATURITY_V2, SVC_RESOLUTION_LIFECYCLE_V2,
  setMaxActiveSvcContainersPerOwnerV2, getMaxActiveSvcContainersPerOwnerV2,
  setMaxPendingSvcResolutionsPerContainerV2, getMaxPendingSvcResolutionsPerContainerV2,
  setSvcContainerIdleMsV2, getSvcContainerIdleMsV2,
  setSvcResolutionStuckMsV2, getSvcResolutionStuckMsV2,
  registerSvcContainerV2, activateSvcContainerV2, degradeSvcContainerV2, decommissionSvcContainerV2, touchSvcContainerV2, getSvcContainerV2, listSvcContainersV2,
  createSvcResolutionV2, resolvingSvcResolutionV2, resolveSvcResolutionV2, failSvcResolutionV2, cancelSvcResolutionV2, getSvcResolutionV2, listSvcResolutionsV2,
  autoDegradeIdleSvcContainersV2, autoFailStuckSvcResolutionsV2, getServiceContainerGovStatsV2, _resetStateServiceContainerV2,
} from "../lib/service-container.js";

export function registerSvcContCommand(program) {
  const sc = program.command("svccont").description("Service Container V2 governance");
  sc.command("enums-v2").action(() => console.log(JSON.stringify({ containerMaturity: SVC_CONTAINER_MATURITY_V2, resolutionLifecycle: SVC_RESOLUTION_LIFECYCLE_V2 }, null, 2)));
  sc.command("config-v2").action(() => console.log(JSON.stringify({ maxActiveSvcContainersPerOwner: getMaxActiveSvcContainersPerOwnerV2(), maxPendingSvcResolutionsPerContainer: getMaxPendingSvcResolutionsPerContainerV2(), svcContainerIdleMs: getSvcContainerIdleMsV2(), svcResolutionStuckMs: getSvcResolutionStuckMsV2() }, null, 2)));
  sc.command("set-max-active-v2 <n>").action((n) => { setMaxActiveSvcContainersPerOwnerV2(Number(n)); console.log("ok"); });
  sc.command("set-max-pending-v2 <n>").action((n) => { setMaxPendingSvcResolutionsPerContainerV2(Number(n)); console.log("ok"); });
  sc.command("set-idle-ms-v2 <n>").action((n) => { setSvcContainerIdleMsV2(Number(n)); console.log("ok"); });
  sc.command("set-stuck-ms-v2 <n>").action((n) => { setSvcResolutionStuckMsV2(Number(n)); console.log("ok"); });
  sc.command("register-container-v2 <id> <owner>").option("--scope <s>", "scope").action((id, owner, o) => console.log(JSON.stringify(registerSvcContainerV2({ id, owner, scope: o.scope }), null, 2)));
  sc.command("activate-container-v2 <id>").action((id) => console.log(JSON.stringify(activateSvcContainerV2(id), null, 2)));
  sc.command("degrade-container-v2 <id>").action((id) => console.log(JSON.stringify(degradeSvcContainerV2(id), null, 2)));
  sc.command("decommission-container-v2 <id>").action((id) => console.log(JSON.stringify(decommissionSvcContainerV2(id), null, 2)));
  sc.command("touch-container-v2 <id>").action((id) => console.log(JSON.stringify(touchSvcContainerV2(id), null, 2)));
  sc.command("get-container-v2 <id>").action((id) => console.log(JSON.stringify(getSvcContainerV2(id), null, 2)));
  sc.command("list-containers-v2").action(() => console.log(JSON.stringify(listSvcContainersV2(), null, 2)));
  sc.command("create-resolution-v2 <id> <containerId>").option("--token <t>", "token").action((id, containerId, o) => console.log(JSON.stringify(createSvcResolutionV2({ id, containerId, token: o.token }), null, 2)));
  sc.command("resolving-resolution-v2 <id>").action((id) => console.log(JSON.stringify(resolvingSvcResolutionV2(id), null, 2)));
  sc.command("resolve-resolution-v2 <id>").action((id) => console.log(JSON.stringify(resolveSvcResolutionV2(id), null, 2)));
  sc.command("fail-resolution-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(failSvcResolutionV2(id, reason), null, 2)));
  sc.command("cancel-resolution-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(cancelSvcResolutionV2(id, reason), null, 2)));
  sc.command("get-resolution-v2 <id>").action((id) => console.log(JSON.stringify(getSvcResolutionV2(id), null, 2)));
  sc.command("list-resolutions-v2").action(() => console.log(JSON.stringify(listSvcResolutionsV2(), null, 2)));
  sc.command("auto-degrade-idle-v2").action(() => console.log(JSON.stringify(autoDegradeIdleSvcContainersV2(), null, 2)));
  sc.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckSvcResolutionsV2(), null, 2)));
  sc.command("gov-stats-v2").action(() => console.log(JSON.stringify(getServiceContainerGovStatsV2(), null, 2)));
  sc.command("reset-state-v2").action(() => { _resetStateServiceContainerV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
