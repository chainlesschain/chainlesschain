/**
 * `cc infra` — CLI surface for Phase 74-75 Decentralized Infrastructure.
 */

import { Command } from "commander";

import {
  DEAL_STATUS,
  ROUTE_TYPE,
  ROUTE_STATUS,
  ensureDecentralInfraTables,
  createDeal,
  updateDealStatus,
  renewDeal,
  getDeal,
  listDeals,
  addContentVersion,
  getContentVersion,
  listContentVersions,
  cacheVersion,
  addRoute,
  updateRouteStatus,
  removeRoute,
  getRoute,
  listRoutes,
  getConnectivityReport,
  getInfraStats,

  // Phase 74-75 V2
  PROVIDER_MATURITY_V2,
  DEAL_LIFECYCLE_V2,
  getDefaultMaxActiveProvidersPerOperatorV2,
  getMaxActiveProvidersPerOperatorV2,
  setMaxActiveProvidersPerOperatorV2,
  getDefaultMaxActiveDealsPerProviderV2,
  getMaxActiveDealsPerProviderV2,
  setMaxActiveDealsPerProviderV2,
  getDefaultProviderIdleMsV2,
  getProviderIdleMsV2,
  setProviderIdleMsV2,
  getDefaultDealStuckMsV2,
  getDealStuckMsV2,
  setDealStuckMsV2,
  registerProviderV2,
  getProviderV2,
  setProviderMaturityV2,
  activateProvider,
  degradeProvider,
  offlineProvider,
  retireProvider,
  touchProviderHeartbeat,
  enqueueDealV2,
  getDealV2,
  setDealStatusV2,
  activateDeal,
  completeDeal,
  failDeal,
  cancelDeal,
  getActiveProviderCount,
  getActiveDealCount,
  autoOfflineStaleProviders,
  autoFailStuckActiveDeals,
  getDecentralInfraStatsV2,
} from "../lib/decentral-infra.js";

function _parseMetaV2(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("--metadata must be valid JSON");
  }
}

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerInfraCommand(program) {
  const inf = new Command("infra")
    .description("Decentralized infrastructure (Phase 74-75)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureDecentralInfraTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  inf
    .command("deal-statuses")
    .description("List deal statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(DEAL_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  inf
    .command("route-types")
    .description("List route types")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(ROUTE_TYPE);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types) console.log(`  ${t}`);
    });

  /* ── Filecoin Storage (Phase 74) ��────────────────── */

  inf
    .command("deal-create")
    .description("Create Filecoin storage deal")
    .requiredOption("-c, --cid <cid>", "Content CID")
    .requiredOption("-s, --size <bytes>", "Size in bytes", parseInt)
    .option("-m, --miner <id>", "Miner ID")
    .option("-p, --price <fil>", "Price in FIL", parseFloat)
    .option("-d, --duration <epochs>", "Duration in epochs", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const result = createDeal(db, {
        cid: opts.cid,
        minerId: opts.miner,
        sizeBytes: opts.size,
        priceFil: opts.price,
        durationEpochs: opts.duration,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.dealId) console.log(`Deal created: ${result.dealId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  inf
    .command("deal-status <id> <status>")
    .description("Update deal status")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(inf);
      const result = updateDealStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Status updated." : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("deal-renew <id>")
    .description("Renew a storage deal")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const result = renewDeal(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.renewed)
        console.log(`Renewed (count: ${result.renewalCount})`);
      else console.log(`Failed: ${result.reason}`);
    });

  inf
    .command("deal-show <id>")
    .description("Show deal details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const d = getDeal(db, id);
      if (!d) return console.log("Deal not found.");
      if (opts.json) return console.log(JSON.stringify(d, null, 2));
      console.log(`ID:       ${d.id}`);
      console.log(`CID:      ${d.cid}`);
      if (d.miner_id) console.log(`Miner:    ${d.miner_id}`);
      console.log(`Size:     ${d.size_bytes} bytes`);
      console.log(`Price:    ${d.price_fil} FIL`);
      console.log(`Status:   ${d.status}`);
      console.log(`Renewals: ${d.renewal_count}`);
    });

  inf
    .command("deals")
    .description("List storage deals")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const deals = listDeals(db, {
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(deals, null, 2));
      if (deals.length === 0) return console.log("No deals.");
      for (const d of deals) {
        console.log(
          `  ${d.status.padEnd(10)} ${d.cid.slice(0, 20).padEnd(22)} ${d.size_bytes}B  ${d.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Content Versions ────────────────────────────── */

  inf
    .command("version-add")
    .description("Add content version")
    .requiredOption("-c, --cid <cid>", "Content CID")
    .option("-p, --parent <cid>", "Parent CID")
    .option("-d, --dag <json>", "DAG structure")
    .option("-n, --peers <n>", "Peer count", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const result = addContentVersion(db, {
        contentCid: opts.cid,
        parentCid: opts.parent,
        dagStructure: opts.dag,
        peerCount: opts.peers,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.versionId)
        console.log(`Version ${result.version}: ${result.versionId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  inf
    .command("version-show <id>")
    .description("Show content version")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const v = getContentVersion(db, id);
      if (!v) return console.log("Version not found.");
      if (opts.json) return console.log(JSON.stringify(v, null, 2));
      console.log(`ID:      ${v.id}`);
      console.log(`CID:     ${v.content_cid}`);
      console.log(`Version: ${v.version}`);
      if (v.parent_cid) console.log(`Parent:  ${v.parent_cid}`);
      console.log(`Cached:  ${v.cached ? "YES" : "NO"}`);
      console.log(`Peers:   ${v.peer_count}`);
    });

  inf
    .command("versions")
    .description("List content versions")
    .option("-c, --cid <cid>", "Filter by content CID")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const vers = listContentVersions(db, {
        contentCid: opts.cid,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(vers, null, 2));
      if (vers.length === 0) return console.log("No versions.");
      for (const v of vers) {
        console.log(
          `  v${String(v.version).padEnd(4)} ${v.content_cid.slice(0, 20).padEnd(22)} ${v.cached ? "cached" : "      "}  ${v.id.slice(0, 8)}`,
        );
      }
    });

  inf
    .command("version-cache <id>")
    .description("Mark content version as cached")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const result = cacheVersion(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.cached ? "Version cached." : `Failed: ${result.reason}`,
      );
    });

  /* ── Anti-Censorship Routes (Phase 75) ───────────── */

  inf
    .command("route-add")
    .description("Add anti-censorship route")
    .requiredOption(
      "-t, --type <type>",
      "Route type (tor/domain_front/mesh_ble/mesh_wifi/direct)",
    )
    .option("-e, --endpoint <url>", "Endpoint URL")
    .option("-l, --latency <ms>", "Latency in ms", parseInt)
    .option("-r, --reliability <0-1>", "Reliability score", parseFloat)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const result = addRoute(db, {
        routeType: opts.type,
        endpoint: opts.endpoint,
        latencyMs: opts.latency,
        reliability: opts.reliability,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.routeId) console.log(`Route added: ${result.routeId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  inf
    .command("route-status <id> <status>")
    .description("Update route status")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(inf);
      const result = updateRouteStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Status updated." : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("route-remove <id>")
    .description("Remove route")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const result = removeRoute(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.removed ? "Route removed." : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("route-show <id>")
    .description("Show route details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const r = getRoute(db, id);
      if (!r) return console.log("Route not found.");
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`ID:          ${r.id}`);
      console.log(`Type:        ${r.route_type}`);
      if (r.endpoint) console.log(`Endpoint:    ${r.endpoint}`);
      console.log(`Status:      ${r.status}`);
      if (r.latency_ms != null) console.log(`Latency:     ${r.latency_ms}ms`);
      console.log(`Reliability: ${r.reliability}`);
    });

  inf
    .command("routes")
    .description("List anti-censorship routes")
    .option("-t, --type <type>", "Filter by route type")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const routes = listRoutes(db, {
        routeType: opts.type,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(routes, null, 2));
      if (routes.length === 0) return console.log("No routes.");
      for (const r of routes) {
        console.log(
          `  ${r.status.padEnd(10)} ${r.route_type.padEnd(14)} ${(r.endpoint || "").slice(0, 30).padEnd(32)} ${r.id.slice(0, 8)}`,
        );
      }
    });

  inf
    .command("connectivity")
    .description("Connectivity report")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const r = getConnectivityReport(db);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`Total:       ${r.totalRoutes}`);
      console.log(`Active:      ${r.activeRoutes}`);
      console.log(`Avg Latency: ${r.avgLatencyMs}ms`);
      console.log(`Avg Reliability: ${r.avgReliability}`);
      for (const [type, count] of Object.entries(r.byType)) {
        console.log(`  ${type.padEnd(14)} ${count}`);
      }
    });

  /* ── Stats ────────────────────────────────────��──── */

  inf
    .command("stats")
    .description("Infrastructure statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const s = getInfraStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Storage:  ${s.storage.totalDeals} deals  (${s.storage.active} active, ${s.storage.totalSizeBytes}B, ${s.storage.totalPriceFil} FIL)`,
      );
      console.log(
        `Content:  ${s.content.totalVersions} versions  (${s.content.cached} cached, ${s.content.uniqueCids} unique CIDs)`,
      );
      console.log(
        `Routes:   ${s.connectivity.totalRoutes}  (${s.connectivity.activeRoutes} active, avg ${s.connectivity.avgLatencyMs}ms)`,
      );
    });

  /* ═══════════════════════════════════════════════════ *
   *  Phase 74-75 V2
   * ═══════════════════════════════════════════════════ */

  inf
    .command("provider-maturities-v2")
    .description("List V2 provider maturity states")
    .option("--json", "JSON")
    .action((opts) => {
      const xs = Object.values(PROVIDER_MATURITY_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  inf
    .command("deal-lifecycles-v2")
    .description("List V2 deal lifecycle states")
    .option("--json", "JSON")
    .action((opts) => {
      const xs = Object.values(DEAL_LIFECYCLE_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  inf
    .command("default-max-active-providers-per-operator")
    .action(() => console.log(getDefaultMaxActiveProvidersPerOperatorV2()));
  inf
    .command("max-active-providers-per-operator")
    .action(() => console.log(getMaxActiveProvidersPerOperatorV2()));
  inf
    .command("set-max-active-providers-per-operator <n>")
    .action((n) => console.log(setMaxActiveProvidersPerOperatorV2(n)));

  inf
    .command("default-max-active-deals-per-provider")
    .action(() => console.log(getDefaultMaxActiveDealsPerProviderV2()));
  inf
    .command("max-active-deals-per-provider")
    .action(() => console.log(getMaxActiveDealsPerProviderV2()));
  inf
    .command("set-max-active-deals-per-provider <n>")
    .action((n) => console.log(setMaxActiveDealsPerProviderV2(n)));

  inf
    .command("default-provider-idle-ms")
    .action(() => console.log(getDefaultProviderIdleMsV2()));
  inf
    .command("provider-idle-ms")
    .action(() => console.log(getProviderIdleMsV2()));
  inf
    .command("set-provider-idle-ms <ms>")
    .action((ms) => console.log(setProviderIdleMsV2(ms)));

  inf
    .command("default-deal-stuck-ms")
    .action(() => console.log(getDefaultDealStuckMsV2()));
  inf.command("deal-stuck-ms").action(() => console.log(getDealStuckMsV2()));
  inf
    .command("set-deal-stuck-ms <ms>")
    .action((ms) => console.log(setDealStuckMsV2(ms)));

  inf
    .command("active-provider-count")
    .option("-o, --operator <id>")
    .action((opts) => console.log(getActiveProviderCount(opts.operator)));
  inf
    .command("active-deal-count")
    .option("-p, --provider <id>")
    .action((opts) => console.log(getActiveDealCount(opts.provider)));

  inf
    .command("register-provider-v2 <provider-id>")
    .requiredOption("-o, --operator <id>")
    .requiredOption("-k, --kind <kind>")
    .option("-i, --initial-status <s>")
    .option("--metadata <json>")
    .action((id, opts) => {
      const r = registerProviderV2(null, {
        providerId: id,
        operatorId: opts.operator,
        kind: opts.kind,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  inf.command("provider-v2 <provider-id>").action((id) => {
    const r = getProviderV2(id);
    if (!r) {
      console.error(`Unknown provider: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

  inf
    .command("set-provider-maturity-v2 <provider-id> <status>")
    .option("-r, --reason <text>")
    .option("--metadata <json>")
    .action((id, status, opts) => {
      const r = setProviderMaturityV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["activate-provider", activateProvider],
    ["degrade-provider", degradeProvider],
    ["offline-provider", offlineProvider],
    ["retire-provider", retireProvider],
  ]) {
    inf
      .command(`${name} <provider-id>`)
      .option("-r, --reason <text>")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  inf
    .command("touch-provider-heartbeat <provider-id>")
    .action((id) =>
      console.log(JSON.stringify(touchProviderHeartbeat(id), null, 2)),
    );

  inf
    .command("enqueue-deal-v2 <deal-id>")
    .requiredOption("-p, --provider <id>")
    .requiredOption("-o, --owner <id>")
    .option("--metadata <json>")
    .action((id, opts) => {
      const r = enqueueDealV2(null, {
        dealId: id,
        providerId: opts.provider,
        ownerId: opts.owner,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  inf.command("deal-v2 <deal-id>").action((id) => {
    const r = getDealV2(id);
    if (!r) {
      console.error(`Unknown deal: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });

  inf
    .command("set-deal-status-v2 <deal-id> <status>")
    .option("-r, --reason <text>")
    .option("--metadata <json>")
    .action((id, status, opts) => {
      const r = setDealStatusV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["activate-deal", activateDeal],
    ["complete-deal", completeDeal],
    ["fail-deal", failDeal],
    ["cancel-deal", cancelDeal],
  ]) {
    inf
      .command(`${name} <deal-id>`)
      .option("-r, --reason <text>")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  inf
    .command("auto-offline-stale-providers")
    .action(() =>
      console.log(JSON.stringify(autoOfflineStaleProviders(null), null, 2)),
    );
  inf
    .command("auto-fail-stuck-active-deals")
    .action(() =>
      console.log(JSON.stringify(autoFailStuckActiveDeals(null), null, 2)),
    );
  inf
    .command("stats-v2")
    .action(() =>
      console.log(JSON.stringify(getDecentralInfraStatsV2(), null, 2)),
    );

  program.addCommand(inf);
}

// === Iter23 V2 governance overlay ===
export function registerDigovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "infra");
  if (!parent) return;
  const L = async () => await import("../lib/decentral-infra.js");
  parent
    .command("digov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.DIGOV_PROFILE_MATURITY_V2,
            dealLifecycle: m.DIGOV_DEAL_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("digov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveDigovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingDigovDealsPerProfileV2(),
            idleMs: m.getDigovProfileIdleMsV2(),
            stuckMs: m.getDigovDealStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("digov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveDigovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("digov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingDigovDealsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("digov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setDigovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("digov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setDigovDealStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("digov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--region <v>", "region")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerDigovProfileV2({ id, owner, region: o.region }),
          null,
          2,
        ),
      );
    });
  parent
    .command("digov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateDigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("digov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleDigovProfileV2(id), null, 2));
    });
  parent
    .command("digov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveDigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("digov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchDigovProfileV2(id), null, 2));
    });
  parent
    .command("digov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDigovProfileV2(id), null, 2));
    });
  parent
    .command("digov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDigovProfilesV2(), null, 2));
    });
  parent
    .command("digov-create-deal-v2 <id> <profileId>")
    .description("Create deal")
    .option("--provider <v>", "provider")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createDigovDealV2({ id, profileId, provider: o.provider }),
          null,
          2,
        ),
      );
    });
  parent
    .command("digov-negotiating-deal-v2 <id>")
    .description("Mark deal as negotiating")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).negotiatingDigovDealV2(id), null, 2),
      );
    });
  parent
    .command("digov-complete-deal-v2 <id>")
    .description("Complete deal")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeDealDigovV2(id), null, 2));
    });
  parent
    .command("digov-fail-deal-v2 <id> [reason]")
    .description("Fail deal")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failDigovDealV2(id, reason), null, 2),
      );
    });
  parent
    .command("digov-cancel-deal-v2 <id> [reason]")
    .description("Cancel deal")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelDigovDealV2(id, reason), null, 2),
      );
    });
  parent
    .command("digov-get-deal-v2 <id>")
    .description("Get deal")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDigovDealV2(id), null, 2));
    });
  parent
    .command("digov-list-deals-v2")
    .description("List deals")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDigovDealsV2(), null, 2));
    });
  parent
    .command("digov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleDigovProfilesV2(), null, 2),
      );
    });
  parent
    .command("digov-auto-fail-stuck-v2")
    .description("Auto-fail stuck deals")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckDigovDealsV2(), null, 2),
      );
    });
  parent
    .command("digov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getDecentralInfraGovStatsV2(), null, 2),
      );
    });
}
