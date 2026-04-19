/**
 * `cc did-v2` (alias `didv2`) — CLI port of Phase 55 去中心化身份2.0.
 *
 * W3C DID v2.0 with did:key / did:web / did:chain methods, Verifiable
 * Presentations with selective disclosure, social recovery via k-of-n
 * guardian shards, identity roaming, and multi-source reputation
 * aggregation.
 */

import { Command } from "commander";

import {
  DID_METHOD,
  CREDENTIAL_STATUS,
  RECOVERY_STATUS,
  DID_STATUS,
  ensureDIDv2Tables,
  createDID,
  resolveDID,
  listDIDs,
  updateDIDStatus,
  issueCredential,
  getCredential,
  listCredentials,
  revokeCredential,
  createPresentation,
  getPresentation,
  listPresentations,
  verifyPresentation,
  startRecovery,
  completeRecovery,
  getRecovery,
  listRecoveries,
  roamIdentity,
  listRoamingLog,
  recordReputationSource,
  aggregateReputation,
  exportDID,
  getStats,
  getConfig,
} from "../lib/did-v2-manager.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _json(v) {
  console.log(JSON.stringify(v, null, 2));
}

function _fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts).toISOString();
}

function _parseJsonArg(s, fallback) {
  if (s == null) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function registerDIDv2Command(program) {
  const didv2 = new Command("did-v2")
    .alias("didv2")
    .description(
      "Decentralized Identity 2.0 (Phase 55) — W3C DID v2.0 + VP + social recovery + roaming",
    )
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureDIDv2Tables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  didv2
    .command("config")
    .description("Show DID v2.0 constants and defaults")
    .option("--json", "JSON output")
    .action((opts) => {
      const cfg = getConfig();
      if (opts.json) return _json(cfg);
      console.log(`Methods: ${cfg.methods.join(", ")}`);
      console.log(
        `Default recovery threshold: ${cfg.defaultRecoveryThreshold} of ${cfg.defaultGuardianCount}`,
      );
      console.log(`VP default TTL: ${cfg.vpDefaultTTLMs}ms`);
      console.log("Reputation source weights:");
      for (const [source, weight] of Object.entries(
        cfg.reputationSourceWeights,
      )) {
        console.log(`  ${source.padEnd(14)} ${weight}`);
      }
    });

  didv2
    .command("methods")
    .description("List supported DID methods")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = Object.values(DID_METHOD);
      if (opts.json) return _json(rows);
      for (const m of rows) console.log(`  ${m}`);
    });

  didv2
    .command("cred-statuses")
    .description("List credential statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = Object.values(CREDENTIAL_STATUS);
      if (opts.json) return _json(rows);
      for (const s of rows) console.log(`  ${s}`);
    });

  didv2
    .command("recovery-statuses")
    .description("List recovery lifecycle statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = Object.values(RECOVERY_STATUS);
      if (opts.json) return _json(rows);
      for (const s of rows) console.log(`  ${s}`);
    });

  /* ── DID lifecycle ───────────────────────────────── */

  didv2
    .command("create")
    .description("Create a new DID v2.0 (Ed25519 keypair + document)")
    .option("-m, --method <method>", "did:key | did:web | did:chain", "key")
    .option("-d, --domain <domain>", "Domain for did:web")
    .option(
      "-s, --services <json>",
      "Service endpoints JSON array",
      (v) => _parseJsonArg(v, []),
      [],
    )
    .option(
      "-g, --guardians <json>",
      "Guardian DIDs JSON array for social recovery",
      (v) => _parseJsonArg(v, []),
      [],
    )
    .option(
      "-t, --threshold <n>",
      "Recovery threshold",
      (v) => parseInt(v, 10),
      3,
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const r = createDID(db, {
        method: opts.method,
        domain: opts.domain,
        services: opts.services,
        guardians: opts.guardians,
        threshold: opts.threshold,
      });
      if (opts.json) return _json(r);
      console.log(`Created ${r.did}`);
      console.log(`  method: ${r.method}`);
      console.log(`  publicKey: ${r.publicKey}`);
    });

  didv2
    .command("resolve")
    .argument("<did>", "DID URI")
    .description("Resolve DID → DID document")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(didv2);
      const r = resolveDID(db, did);
      if (!r) {
        console.error(`Unknown DID: ${did}`);
        process.exit(1);
      }
      if (opts.json) return _json(r);
      console.log(`DID: ${r.did}  method=${r.method}  status=${r.status}`);
      console.log(`  publicKey: ${r.publicKey}`);
      console.log(`  reputation: ${r.reputationScore.toFixed(3)}`);
      console.log(
        `  guardians: ${r.recoveryGuardians.length} (threshold ${r.recoveryThreshold})`,
      );
      console.log(`  services: ${r.serviceEndpoints.length}`);
    });

  didv2
    .command("list")
    .description("List all DIDs")
    .option("-m, --method <method>", "Filter by method")
    .option("-s, --status <status>", "Filter by status")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const rows = listDIDs(db, { method: opts.method, status: opts.status });
      if (opts.json) return _json(rows);
      for (const r of rows) {
        console.log(
          `  ${r.did}  [${r.status}]  method=${r.method}  rep=${r.reputationScore.toFixed(2)}`,
        );
      }
      console.log(`(${rows.length} DIDs)`);
    });

  didv2
    .command("revoke")
    .argument("<did>", "DID URI")
    .description("Revoke a DID (sets status=revoked)")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(didv2);
      const changed = updateDIDStatus(db, did, DID_STATUS.REVOKED);
      if (opts.json) return _json({ changed });
      console.log(changed ? `Revoked ${did}` : `No change for ${did}`);
    });

  /* ── Credentials ─────────────────────────────────── */

  didv2
    .command("cred-issue")
    .description("Issue a Verifiable Credential")
    .requiredOption("-h, --holder <did>", "Holder DID")
    .requiredOption("-i, --issuer <did>", "Issuer DID")
    .requiredOption("-t, --type <type>", "Credential type")
    .option(
      "-s, --subject <json>",
      "credentialSubject JSON",
      (v) => _parseJsonArg(v, {}),
      {},
    )
    .option("-e, --expires-in <ms>", "Expires in ms", (v) => parseInt(v, 10))
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const r = issueCredential(db, {
        holderDid: opts.holder,
        issuerDid: opts.issuer,
        type: opts.type,
        credentialSubject: opts.subject,
        expiresInMs: opts.expiresIn,
      });
      if (opts.json) return _json(r);
      console.log(`Issued ${r.id}`);
      console.log(`  type: ${opts.type}`);
      console.log(`  issuer → holder: ${opts.issuer} → ${opts.holder}`);
    });

  didv2
    .command("cred-show")
    .argument("<id>", "Credential id")
    .description("Show a credential")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(didv2);
      const r = getCredential(db, id);
      if (!r) {
        console.error(`Unknown credential: ${id}`);
        process.exit(1);
      }
      if (opts.json) return _json(r);
      console.log(`${r.id}  [${r.status}]  ${r.type}`);
      console.log(`  holder:  ${r.holderDid}`);
      console.log(`  issuer:  ${r.issuerDid}`);
      console.log(`  issued:  ${_fmtTs(r.issuanceDate)}`);
      console.log(`  expires: ${_fmtTs(r.expirationDate)}`);
    });

  didv2
    .command("creds")
    .description("List credentials")
    .option("-h, --holder <did>", "Filter by holder")
    .option("-i, --issuer <did>", "Filter by issuer")
    .option("-s, --status <status>", "Filter by status")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const rows = listCredentials(db, {
        holderDid: opts.holder,
        issuerDid: opts.issuer,
        status: opts.status,
      });
      if (opts.json) return _json(rows);
      for (const r of rows) {
        console.log(
          `  ${r.id}  [${r.status}]  ${r.type}  holder=${r.holderDid}`,
        );
      }
      console.log(`(${rows.length} credentials)`);
    });

  didv2
    .command("cred-revoke")
    .argument("<id>", "Credential id")
    .description("Revoke a credential")
    .option("-r, --reason <reason>", "Revocation reason")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(didv2);
      const changed = revokeCredential(db, id, opts.reason);
      if (opts.json) return _json({ changed });
      console.log(changed ? `Revoked ${id}` : `No change for ${id}`);
    });

  /* ── Verifiable Presentations ────────────────────── */

  didv2
    .command("present")
    .description("Build a Verifiable Presentation from credentials")
    .requiredOption("-h, --holder <did>", "Holder DID")
    .requiredOption("-c, --creds <csv>", "Credential ids CSV", (v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .option("-r, --recipient <did>", "Recipient DID")
    .option(
      "-d, --disclose <csv>",
      "Fields to selectively disclose (CSV)",
      (v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      [],
    )
    .option("--ttl <ms>", "TTL in ms", (v) => parseInt(v, 10))
    .option("--zkp", "Enable ZKP proof placeholder")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const r = createPresentation(db, {
        holderDid: opts.holder,
        credentialIds: opts.creds,
        recipientDid: opts.recipient,
        disclosedFields: opts.disclose,
        ttlMs: opts.ttl,
        zkpEnabled: !!opts.zkp,
      });
      if (opts.json) return _json(r);
      console.log(`VP ${r.id}`);
      console.log(`  credentials: ${r.credentialIds.length}`);
      console.log(`  expiresAt: ${_fmtTs(r.expiresAt)}`);
      if (r.zkpProofId) console.log(`  zkpProofId: ${r.zkpProofId}`);
    });

  didv2
    .command("verify")
    .argument("<id>", "Presentation id")
    .description("Verify a Verifiable Presentation")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(didv2);
      const r = verifyPresentation(db, id);
      if (opts.json) return _json(r);
      if (r.ok) {
        console.log(`✓ VP ${id} valid  (${r.verificationTimeMs}ms)`);
      } else {
        console.log(`✗ VP ${id} invalid: ${r.reason}`);
        process.exitCode = 1;
      }
    });

  didv2
    .command("vp-show")
    .argument("<id>", "Presentation id")
    .description("Show a presentation")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(didv2);
      const r = getPresentation(db, id);
      if (!r) {
        console.error(`Unknown presentation: ${id}`);
        process.exit(1);
      }
      if (opts.json) return _json(r);
      console.log(`VP ${r.id}`);
      console.log(`  holder:      ${r.holderDid}`);
      console.log(`  recipient:   ${r.recipientDid || "—"}`);
      console.log(`  credentials: ${r.credentialIds.length}`);
      console.log(`  disclosed:   ${r.disclosedFields.join(", ") || "(all)"}`);
      console.log(
        `  verified:    ${r.verified}  (${r.verificationTimeMs ?? 0}ms)`,
      );
      console.log(`  expiresAt:   ${_fmtTs(r.expiresAt)}`);
    });

  didv2
    .command("presentations")
    .description("List presentations")
    .option("-h, --holder <did>", "Filter by holder")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const rows = listPresentations(db, { holderDid: opts.holder });
      if (opts.json) return _json(rows);
      for (const r of rows) {
        console.log(
          `  ${r.id}  verified=${r.verified}  holder=${r.holderDid}  expires=${_fmtTs(r.expiresAt)}`,
        );
      }
      console.log(`(${rows.length} presentations)`);
    });

  /* ── Social recovery ─────────────────────────────── */

  didv2
    .command("recover-start")
    .description("Start social recovery (submit guardian shares)")
    .requiredOption("-d, --did <did>", "DID to recover")
    .requiredOption(
      "-s, --shares <json>",
      "Shares JSON array of {guardian, share}",
      (v) => _parseJsonArg(v, []),
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const r = startRecovery(db, { did: opts.did, shares: opts.shares });
      if (opts.json) return _json(r);
      console.log(`Recovery ${r.id}  status=${r.status}`);
      console.log(`  valid shares: ${r.validShares}/${r.threshold}`);
    });

  didv2
    .command("recover-complete")
    .argument("<recoveryId>", "Recovery attempt id")
    .description("Complete recovery (rotate keypair when threshold met)")
    .option("--json", "JSON output")
    .action((recoveryId, opts) => {
      const db = _dbFromCtx(didv2);
      const r = completeRecovery(db, recoveryId);
      if (opts.json) return _json(r);
      console.log(`Recovered ${r.did}`);
      console.log(`  new publicKey: ${r.newPublicKey}`);
    });

  didv2
    .command("recoveries")
    .description("List recovery attempts")
    .option("-d, --did <did>", "Filter by DID")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const rows = listRecoveries(db, { did: opts.did });
      if (opts.json) return _json(rows);
      for (const r of rows) {
        console.log(
          `  ${r.id}  [${r.status}]  did=${r.did}  shares=${r.sharesSubmitted.length}/${r.threshold}`,
        );
      }
      console.log(`(${rows.length} attempts)`);
    });

  didv2
    .command("recovery-show")
    .argument("<id>", "Recovery id")
    .description("Show a recovery attempt")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(didv2);
      const r = getRecovery(db, id);
      if (!r) {
        console.error(`Unknown recovery: ${id}`);
        process.exit(1);
      }
      if (opts.json) return _json(r);
      console.log(`Recovery ${r.id}  status=${r.status}`);
      console.log(`  did:       ${r.did}`);
      console.log(`  threshold: ${r.threshold}`);
      console.log(`  shares:    ${r.sharesSubmitted.length}`);
      if (r.newPublicKey) console.log(`  new pubkey: ${r.newPublicKey}`);
    });

  /* ── Identity roaming ────────────────────────────── */

  didv2
    .command("roam")
    .description("Roam identity to a new platform (cross-platform migration)")
    .requiredOption("-d, --did <did>", "DID URI")
    .requiredOption("-t, --target <platform>", "Target platform identifier")
    .option("-s, --source <platform>", "Source platform identifier")
    .option("-p, --proof <proof>", "Migration proof (opaque)")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const r = roamIdentity(db, {
        did: opts.did,
        targetPlatform: opts.target,
        sourcePlatform: opts.source,
        migrationProof: opts.proof,
      });
      if (opts.json) return _json(r);
      console.log(`Roamed ${r.did} → ${r.targetPlatform}`);
      console.log(`  credentials migrated: ${r.credentialsMigrated}`);
      console.log(
        `  reputation transferred: ${r.reputationTransferred.toFixed(3)}`,
      );
    });

  didv2
    .command("roaming-log")
    .description("List roaming log entries")
    .option("-d, --did <did>", "Filter by DID")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const rows = listRoamingLog(db, { did: opts.did });
      if (opts.json) return _json(rows);
      for (const r of rows) {
        console.log(
          `  ${r.id}  ${r.did}  ${r.sourcePlatform || "?"} → ${r.targetPlatform}  creds=${r.credentialsMigrated}`,
        );
      }
      console.log(`(${rows.length} entries)`);
    });

  /* ── Reputation aggregation ──────────────────────── */

  didv2
    .command("rep-record")
    .description("Record a reputation sample from a source")
    .requiredOption("-d, --did <did>", "DID")
    .requiredOption(
      "-s, --source <source>",
      "on-chain | social | marketplace | custom",
    )
    .requiredOption("--score <n>", "Score", (v) => parseFloat(v))
    .option(
      "-e, --evidence <json>",
      "Evidence JSON",
      (v) => _parseJsonArg(v, null),
      null,
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const r = recordReputationSource(db, {
        did: opts.did,
        source: opts.source,
        score: opts.score,
        evidence: opts.evidence,
      });
      if (opts.json) return _json(r);
      console.log(
        `Recorded ${opts.source} score=${opts.score} (weight ${r.weight})`,
      );
    });

  didv2
    .command("rep-aggregate")
    .argument("<did>", "DID URI")
    .description("Aggregate reputation across sources")
    .option("-s, --sources <csv>", "Filter to these sources (CSV)", (v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(didv2);
      const r = aggregateReputation(db, did, { sources: opts.sources });
      if (opts.json) return _json(r);
      console.log(
        `Aggregated score: ${r.aggregatedScore.toFixed(3)}  (${r.sourceCount} samples)`,
      );
      for (const s of r.sources) {
        console.log(
          `  ${s.source.padEnd(14)} avg=${s.avgScore.toFixed(2)} weight=${s.weight} n=${s.sampleCount}`,
        );
      }
    });

  /* ── Export ──────────────────────────────────────── */

  didv2
    .command("export")
    .argument("<did>", "DID URI")
    .description("Export DID document + credentials")
    .option("-f, --format <format>", "json-ld | jwt", "json-ld")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(didv2);
      const r = exportDID(db, did, { format: opts.format });
      if (opts.json || opts.format === "jwt") return _json(r);
      console.log(`Format: ${r.format}`);
      console.log(`Document: ${JSON.stringify(r.document, null, 2)}`);
      console.log(`Credentials: ${r.credentials.length}`);
      console.log(`Reputation: ${r.reputationScore}  Status: ${r.status}`);
    });

  /* ── Stats ───────────────────────────────────────── */

  didv2
    .command("stats")
    .description("DID v2.0 stats")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(didv2);
      const s = getStats(db);
      if (opts.json) return _json(s);
      console.log(`DIDs:           ${s.didCount} (${s.activeDIDs} active)`);
      console.log(
        `Credentials:    ${s.credentialCount} (${s.activeCredentials} active)`,
      );
      console.log(
        `Presentations:  ${s.presentationCount} (${s.verifiedPresentations} verified)`,
      );
      console.log(`Recoveries:     ${s.recoveryCount}`);
      console.log(`Roaming log:    ${s.roamingCount}`);
    });

  program.addCommand(didv2);
}

// === Iter22 V2 governance overlay ===
export function registerDv2govV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "did-v2");
  if (!parent) return;
  const L = async () => await import("../lib/did-v2-manager.js");
  parent
    .command("dv2gov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.DV2GOV_PROFILE_MATURITY_V2,
            credentialLifecycle: m.DV2GOV_CREDENTIAL_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("dv2gov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveDv2govProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingDv2govCredentialsPerProfileV2(),
            idleMs: m.getDv2govProfileIdleMsV2(),
            stuckMs: m.getDv2govCredentialStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("dv2gov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveDv2govProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dv2gov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingDv2govCredentialsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dv2gov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setDv2govProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dv2gov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setDv2govCredentialStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dv2gov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--method <v>", "method")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerDv2govProfileV2({ id, owner, method: o.method }),
          null,
          2,
        ),
      );
    });
  parent
    .command("dv2gov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateDv2govProfileV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendDv2govProfileV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveDv2govProfileV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchDv2govProfileV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDv2govProfileV2(id), null, 2));
    });
  parent
    .command("dv2gov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDv2govProfilesV2(), null, 2));
    });
  parent
    .command("dv2gov-create-credential-v2 <id> <profileId>")
    .description("Create credential")
    .option("--subject <v>", "subject")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createDv2govCredentialV2({ id, profileId, subject: o.subject }),
          null,
          2,
        ),
      );
    });
  parent
    .command("dv2gov-issuing-credential-v2 <id>")
    .description("Mark credential as issuing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).issuingDv2govCredentialV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-complete-credential-v2 <id>")
    .description("Complete credential")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeCredentialDv2govV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-fail-credential-v2 <id> [reason]")
    .description("Fail credential")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failDv2govCredentialV2(id, reason), null, 2),
      );
    });
  parent
    .command("dv2gov-cancel-credential-v2 <id> [reason]")
    .description("Cancel credential")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelDv2govCredentialV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("dv2gov-get-credential-v2 <id>")
    .description("Get credential")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getDv2govCredentialV2(id), null, 2),
      );
    });
  parent
    .command("dv2gov-list-credentials-v2")
    .description("List credentials")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listDv2govCredentialsV2(), null, 2),
      );
    });
  parent
    .command("dv2gov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleDv2govProfilesV2(), null, 2),
      );
    });
  parent
    .command("dv2gov-auto-fail-stuck-v2")
    .description("Auto-fail stuck credentials")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckDv2govCredentialsV2(), null, 2),
      );
    });
  parent
    .command("dv2gov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getDidV2ManagerGovStatsV2(), null, 2),
      );
    });
}
