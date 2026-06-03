/**
 * `cc agent-network` (alias `anet`) — CLI port of Phase 24 去中心化Agent网络.
 *
 * Ed25519 Agent DIDs, W3C VC credentials, federated registry (Kademlia
 * k-bucket simulation), challenge-response auth, and cross-org task
 * routing with reputation-weighted agent selection.
 */

import { Command } from "commander";

import {
  DID_STATUS,
  REG_STATUS,
  AUTH_STATUS,
  CRED_STATUS,
  TASK_STATUS,
  REPUTATION_DIMENSIONS,
  ensureAgentNetworkTables,
  createAgentDID,
  resolveAgentDID,
  listAgentDIDs,
  deactivateAgentDID,
  signWithAgent,
  verifyWithAgent,
  registerAgent,
  unregisterAgent,
  heartbeatAgent,
  discoverAgents,
  sweepStaleAgents,
  addPeer,
  removePeer,
  listPeers,
  startAuth,
  completeAuth,
  validateSession,
  listSessions,
  issueCredential,
  getCredential,
  verifyCredential,
  revokeCredential,
  listCredentials,
  routeTask,
  getTask,
  updateTaskStatus,
  cancelTask,
  listTasks,
  updateReputation,
  getReputation,
  getReputationHistory,
  getTopAgents,
  getNetworkStats,
  getNetworkConfig,
  AGENT_MATURITY_V2,
  TASK_LIFECYCLE_V2,
  getMaxActiveAgentsPerNetworkV2,
  setMaxActiveAgentsPerNetworkV2,
  getMaxPendingTasksPerAgentV2,
  setMaxPendingTasksPerAgentV2,
  getAgentIdleMsV2,
  setAgentIdleMsV2,
  getTaskStuckMsV2,
  setTaskStuckMsV2,
  registerAgentV2,
  getAgentV2,
  listAgentsV2,
  setAgentStatusV2,
  activateAgentV2,
  suspendAgentV2,
  revokeAgentV2,
  touchAgentV2,
  createTaskV2,
  getTaskV2,
  listTasksV2,
  setTaskStatusV2,
  startTaskV2,
  completeTaskV2,
  failTaskV2,
  cancelTaskV2,
  getActiveAgentCountV2,
  getPendingTaskCountV2,
  autoSuspendIdleAgentsV2,
  autoFailStuckTasksV2,
  getAgentNetworkStatsV2,
} from "../lib/agent-network.js";

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

export function registerAgentNetworkCommand(program) {
  const anet = new Command("agent-network")
    .alias("anet")
    .description(
      "Decentralized Agent Network (Phase 24) — DID / registry / credentials / task routing",
    )
    .hook("preAction", (thisCmd, actionCommand) => {
      if (actionCommand && actionCommand.name().endsWith("-v2")) return;
      const db = _dbFromCtx(thisCmd);
      if (db) ensureAgentNetworkTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  anet
    .command("config")
    .description("Show network constants & reputation weights")
    .option("--json", "JSON output")
    .action((opts) => {
      const cfg = getNetworkConfig();
      if (opts.json) return _json(cfg);
      console.log(`Kademlia: ${cfg.kademliaBits} bits, k=${cfg.kademliaK}`);
      console.log(
        `Session TTL: ${cfg.sessionTtlMs}ms  Heartbeat timeout: ${cfg.heartbeatTimeoutMs}ms`,
      );
      console.log(`Reputation dimensions:`);
      for (const d of cfg.reputationDimensions) {
        console.log(`  ${d.padEnd(12)} weight=${cfg.reputationWeights[d]}`);
      }
      console.log(
        `Reputation range: [${cfg.reputationRange[0]}, ${cfg.reputationRange[1]}]` +
          `  weekly decay: ${cfg.reputationDecayWeekly}`,
      );
    });

  anet
    .command("dimensions")
    .description("List reputation dimensions")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json) return _json(REPUTATION_DIMENSIONS);
      for (const d of REPUTATION_DIMENSIONS) console.log(`  ${d}`);
    });

  anet
    .command("task-statuses")
    .description("List task lifecycle statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const rows = Object.values(TASK_STATUS);
      if (opts.json) return _json(rows);
      for (const r of rows) console.log(`  ${r}`);
    });

  /* ── DID management ──────────────────────────────── */

  anet
    .command("did-create")
    .description("Create an Agent DID (Ed25519 + DID document)")
    .option("-n, --name <displayName>", "Display name")
    .option(
      "-m, --metadata <json>",
      "Extra metadata (JSON object)",
      (v) => _parseJsonArg(v, {}),
      {},
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const r = createAgentDID(db, {
        displayName: opts.name,
        metadata: opts.metadata,
      });
      if (opts.json) return _json(r);
      console.log(`Created ${r.did}`);
      console.log(`  publicKey: ${r.publicKey}`);
    });

  anet
    .command("did-resolve")
    .argument("<did>", "Agent DID")
    .description("Resolve DID → DID document")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const r = resolveAgentDID(db, did);
      if (!r) {
        console.error(`Unknown DID: ${did}`);
        process.exit(1);
      }
      if (opts.json) return _json(r);
      console.log(`DID: ${r.did}  status=${r.status}`);
      console.log(`publicKey: ${r.publicKey}`);
      console.log(`metadata: ${JSON.stringify(r.metadata)}`);
    });

  anet
    .command("dids")
    .description("List Agent DIDs")
    .option("-s, --status <status>", "Filter by status (active|deactivated)")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = listAgentDIDs(db, {
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(`  ${r.did}  [${r.status}]  ${JSON.stringify(r.metadata)}`);
      console.log(`(${rows.length} DIDs)`);
    });

  anet
    .command("did-deactivate")
    .argument("<did>", "Agent DID")
    .description("Deactivate a DID (also forces registry offline)")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const r = deactivateAgentDID(db, did);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error(`DID not found: ${did}`);
        process.exit(1);
      }
      console.log(`Deactivated ${did}`);
    });

  anet
    .command("sign")
    .argument("<did>", "Agent DID")
    .argument("<data>", "Data to sign (UTF-8 string)")
    .description("Sign data with agent's Ed25519 key")
    .option("--json", "JSON output")
    .action((did, data, opts) => {
      const db = _dbFromCtx(anet);
      const sig = signWithAgent(db, did, data);
      if (opts.json) return _json({ did, signature: sig });
      console.log(sig);
    });

  anet
    .command("verify")
    .argument("<did>", "Agent DID")
    .argument("<data>", "Signed data (UTF-8 string)")
    .argument("<signature>", "Signature hex")
    .description("Verify a signature from an agent")
    .option("--json", "JSON output")
    .action((did, data, sig, opts) => {
      const db = _dbFromCtx(anet);
      const ok = verifyWithAgent(db, did, data, sig);
      if (opts.json) return _json({ valid: ok });
      console.log(ok ? "valid" : "invalid");
      if (!ok) process.exit(1);
    });

  /* ── Federated registry ──────────────────────────── */

  anet
    .command("register")
    .argument("<did>", "Agent DID")
    .argument("<orgId>", "Owning org id")
    .description("Register an Agent in the federated registry")
    .option(
      "-c, --capabilities <json>",
      "Capabilities (JSON array)",
      (v) => _parseJsonArg(v, []),
      [],
    )
    .option("-e, --endpoint <url>", "Service endpoint")
    .option("--json", "JSON output")
    .action((did, orgId, opts) => {
      const db = _dbFromCtx(anet);
      const r = registerAgent(db, {
        did,
        orgId,
        capabilities: opts.capabilities,
        endpoint: opts.endpoint,
      });
      if (opts.json) return _json(r);
      console.log(`Registered ${r.did} → org=${r.orgId}`);
      console.log(`  caps=${JSON.stringify(r.capabilities)}`);
    });

  anet
    .command("unregister")
    .argument("<did>", "Agent DID")
    .description("Remove an Agent from the registry")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const r = unregisterAgent(db, did);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error(`Agent not registered: ${did}`);
        process.exit(1);
      }
      console.log(`Unregistered ${did}`);
    });

  anet
    .command("heartbeat")
    .argument("<did>", "Agent DID")
    .description("Bump last_heartbeat (forces online)")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const r = heartbeatAgent(db, did);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error(`Agent not registered: ${did}`);
        process.exit(1);
      }
      console.log(`Heartbeat ${did} @ ${_fmtTs(r.heartbeatAt)}`);
    });

  anet
    .command("discover")
    .description("Discover agents (capability / org / status)")
    .option("-c, --capability <cap>", "Required capability")
    .option("-o, --org <orgId>", "Filter by org")
    .option("-s, --status <status>", "Filter by status", REG_STATUS.ONLINE)
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = discoverAgents(db, {
        capability: opts.capability,
        orgId: opts.org,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${r.agentDid}  [${r.status}]  org=${r.orgId}  caps=${JSON.stringify(r.capabilities)}`,
        );
      console.log(`(${rows.length} agents)`);
    });

  anet
    .command("sweep")
    .description("Mark stale online agents offline")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const r = sweepStaleAgents(db);
      if (opts.json) return _json(r);
      console.log(`Swept ${r.swept} stale agents`);
    });

  /* ── Peer (Kademlia) bookkeeping ─────────────────── */

  anet
    .command("peer-add")
    .argument("<peerId>", "Peer id")
    .description("Add/update a Kademlia peer (k-bucket auto-computed)")
    .option("-e, --endpoint <url>", "Peer endpoint")
    .option("-d, --did <did>", "Agent DID served by peer")
    .option("--json", "JSON output")
    .action((peerId, opts) => {
      const db = _dbFromCtx(anet);
      const r = addPeer(db, {
        peerId,
        endpoint: opts.endpoint,
        agentDid: opts.did,
      });
      if (opts.json) return _json(r);
      console.log(`Peer ${peerId}  kBucket=${r.kBucket}`);
    });

  anet
    .command("peer-remove")
    .argument("<peerId>", "Peer id")
    .description("Remove a peer")
    .option("--json", "JSON output")
    .action((peerId, opts) => {
      const db = _dbFromCtx(anet);
      const r = removePeer(db, peerId);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error(`Peer not found: ${peerId}`);
        process.exit(1);
      }
      console.log(`Removed ${peerId}`);
    });

  anet
    .command("peers")
    .description("List peers (optionally by k-bucket)")
    .option("-b, --bucket <n>", "k-bucket index", (v) => parseInt(v, 10))
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = listPeers(db, { kBucket: opts.bucket, limit: opts.limit });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${r.peerId}  bucket=${r.kBucket}  endpoint=${r.endpoint || "—"}  did=${r.agentDid || "—"}`,
        );
      console.log(`(${rows.length} peers)`);
    });

  /* ── Authentication ──────────────────────────────── */

  anet
    .command("auth-start")
    .argument("<did>", "Agent DID")
    .description("Issue an auth challenge for a DID")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const r = startAuth(db, did);
      if (opts.json) return _json(r);
      console.log(`session=${r.sessionId}`);
      console.log(`challenge=${r.challenge}`);
      console.log(`expiresAt=${_fmtTs(r.expiresAt)}`);
    });

  anet
    .command("auth-complete")
    .argument("<sessionId>", "Session id from auth-start")
    .argument("<signature>", "Ed25519 signature over challenge (hex)")
    .description("Complete auth with signature over challenge")
    .option("--json", "JSON output")
    .action((sessionId, signature, opts) => {
      const db = _dbFromCtx(anet);
      const r = completeAuth(db, sessionId, signature);
      if (opts.json) return _json(r);
      console.log(`token=${r.token}`);
      console.log(`agentDid=${r.agentDid}`);
      console.log(`expiresAt=${_fmtTs(r.expiresAt)}`);
    });

  anet
    .command("auth-validate")
    .argument("<token>", "Session token")
    .description("Validate a session token (returns agentDid or exits 1)")
    .option("--json", "JSON output")
    .action((token, opts) => {
      const db = _dbFromCtx(anet);
      const r = validateSession(db, token);
      if (opts.json) return _json(r);
      if (!r) {
        console.error("invalid or expired");
        process.exit(1);
      }
      console.log(`agentDid=${r.agentDid}  expiresAt=${_fmtTs(r.expiresAt)}`);
    });

  anet
    .command("auth-sessions")
    .description("List auth sessions")
    .option("-d, --did <did>", "Filter by DID")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = listSessions(db, {
        agentDid: opts.did,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${r.sessionId}  [${r.status}]  did=${r.agentDid}  exp=${_fmtTs(r.expiresAt)}`,
        );
      console.log(`(${rows.length} sessions)`);
    });

  /* ── Credentials (W3C VC) ────────────────────────── */

  anet
    .command("credential-issue")
    .argument("<issuerDid>", "Issuer DID")
    .argument("<subjectDid>", "Subject DID")
    .description("Issue a VC with HMAC/Ed25519 proof")
    .option("-t, --type <type>", "Credential type", "AgentCapabilityCredential")
    .option(
      "-c, --claims <json>",
      "Claims (JSON object)",
      (v) => _parseJsonArg(v, {}),
      {},
    )
    .option("--expires-at <ms>", "Expiry (epoch ms)", (v) => parseInt(v, 10))
    .option("--json", "JSON output")
    .action((issuerDid, subjectDid, opts) => {
      const db = _dbFromCtx(anet);
      const r = issueCredential(db, {
        issuerDid,
        subjectDid,
        type: opts.type,
        claims: opts.claims,
        expiresAt: opts.expiresAt,
      });
      if (opts.json) return _json(r);
      console.log(`Issued ${r.id} (${r.type})`);
      console.log(`  issuer=${r.issuer}  subject=${r.subject}`);
    });

  anet
    .command("credential-verify")
    .argument("<id>", "Credential id")
    .description("Verify a VC (signature + expiry + revocation)")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(anet);
      const r = verifyCredential(db, id);
      if (opts.json) return _json(r);
      if (r.valid) {
        console.log(`valid  type=${r.credential.type}`);
      } else {
        console.log(`invalid (${r.reason})`);
        process.exit(1);
      }
    });

  anet
    .command("credential-revoke")
    .argument("<id>", "Credential id")
    .description("Revoke a credential")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(anet);
      const r = revokeCredential(db, id);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error("No change (unknown or already revoked)");
        process.exit(1);
      }
      console.log(`Revoked ${id}`);
    });

  anet
    .command("credential-show")
    .argument("<id>", "Credential id")
    .description("Show a credential")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(anet);
      const c = getCredential(db, id);
      if (!c) {
        console.error(`Not found: ${id}`);
        process.exit(1);
      }
      if (opts.json) return _json(c);
      console.log(`Credential ${c.id}  type=${c.type}  status=${c.status}`);
      console.log(`  issuer=${c.issuer}  subject=${c.subject}`);
      console.log(
        `  issuedAt=${_fmtTs(c.issuedAt)}  expiresAt=${_fmtTs(c.expiresAt)}`,
      );
      console.log(`  claims=${JSON.stringify(c.claims)}`);
    });

  anet
    .command("credentials")
    .description("List credentials (filter by subject/issuer/status/type)")
    .option("-s, --subject <did>", "Filter by subject DID")
    .option("-i, --issuer <did>", "Filter by issuer DID")
    .option("--status <status>", "Filter by status")
    .option("-t, --type <type>", "Filter by type")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = listCredentials(db, {
        subjectDid: opts.subject,
        issuerDid: opts.issuer,
        status: opts.status,
        type: opts.type,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${r.id}  [${r.status}]  type=${r.type}  subject=${r.subject}`,
        );
      console.log(`(${rows.length} credentials)`);
    });

  /* ── Cross-org task routing ──────────────────────── */

  anet
    .command("task-route")
    .argument("<sourceOrg>", "Source org id")
    .argument("<taskType>", "Task type")
    .description("Route task → pick best-rep agent matching capability")
    .option("-t, --target <orgId>", "Target org (optional)")
    .option(
      "-r, --requirements <json>",
      "Requirements (JSON, supports {capability})",
      (v) => _parseJsonArg(v, {}),
      {},
    )
    .option("-p, --payload <json>", "Task payload (JSON)", (v) =>
      _parseJsonArg(v, null),
    )
    .option("--json", "JSON output")
    .action((sourceOrg, taskType, opts) => {
      const db = _dbFromCtx(anet);
      const r = routeTask(db, {
        sourceOrg,
        targetOrg: opts.target,
        taskType,
        requirements: opts.requirements,
        payload: opts.payload,
      });
      if (opts.json) return _json(r);
      console.log(`task=${r.taskId}  status=${r.status}`);
      console.log(`  agentDid=${r.agentDid || "—"}  score=${r.score ?? "—"}`);
    });

  anet
    .command("task-show")
    .argument("<taskId>", "Task id")
    .description("Show a task")
    .option("--json", "JSON output")
    .action((taskId, opts) => {
      const db = _dbFromCtx(anet);
      const t = getTask(db, taskId);
      if (!t) {
        console.error(`Not found: ${taskId}`);
        process.exit(1);
      }
      if (opts.json) return _json(t);
      console.log(
        `Task ${t.taskId}  [${t.status}]  type=${t.taskType}  source=${t.sourceOrg}`,
      );
      console.log(
        `  agentDid=${t.agentDid || "—"}  targetOrg=${t.targetOrg || "—"}`,
      );
      console.log(
        `  createdAt=${_fmtTs(t.createdAt)}  completedAt=${_fmtTs(t.completedAt)}`,
      );
    });

  anet
    .command("task-status")
    .argument("<taskId>", "Task id")
    .argument(
      "<status>",
      "New status (pending|routed|running|completed|failed|cancelled)",
    )
    .description("Update task status (terminal states set completedAt)")
    .option("-r, --result <json>", "Result payload (JSON)", (v) =>
      _parseJsonArg(v, null),
    )
    .option("--json", "JSON output")
    .action((taskId, status, opts) => {
      const db = _dbFromCtx(anet);
      const r = updateTaskStatus(db, taskId, status, opts.result);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error(`Unknown task: ${taskId}`);
        process.exit(1);
      }
      console.log(`${taskId} → ${status}`);
    });

  anet
    .command("task-cancel")
    .argument("<taskId>", "Task id")
    .description("Cancel a task (sets CANCELLED + reason)")
    .option("-r, --reason <reason>", "Cancellation reason")
    .option("--json", "JSON output")
    .action((taskId, opts) => {
      const db = _dbFromCtx(anet);
      const r = cancelTask(db, taskId, opts.reason);
      if (opts.json) return _json(r);
      if (!r.changed) {
        console.error(`Unknown task: ${taskId}`);
        process.exit(1);
      }
      console.log(`${taskId} cancelled`);
    });

  anet
    .command("tasks")
    .description("List tasks")
    .option("-o, --org <orgId>", "Filter by source org")
    .option("-d, --did <did>", "Filter by agent DID")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = listTasks(db, {
        orgId: opts.org,
        agentDid: opts.did,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${r.taskId}  [${r.status}]  type=${r.taskType}  agent=${r.agentDid || "—"}`,
        );
      console.log(`(${rows.length} tasks)`);
    });

  /* ── Reputation ─────────────────────────────────── */

  anet
    .command("rep-update")
    .argument("<did>", "Agent DID")
    .argument(
      "<dimension>",
      "Dimension (reliability|quality|speed|cooperation)",
    )
    .argument("<score>", "Score (0..5)")
    .description("Record a reputation observation")
    .option("-e, --evidence <text>", "Evidence note")
    .option("--json", "JSON output")
    .action((did, dimension, scoreStr, opts) => {
      const db = _dbFromCtx(anet);
      const score = Number(scoreStr);
      const r = updateReputation(db, {
        agentDid: did,
        dimension,
        score,
        evidence: opts.evidence,
      });
      if (opts.json) return _json(r);
      console.log(
        `${r.agentDid}  ${r.dimension}=${r.score}  (${_fmtTs(r.createdAt)})`,
      );
    });

  anet
    .command("rep-show")
    .argument("<did>", "Agent DID")
    .description("Show reputation summary (weighted total + per-dim avg)")
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const r = getReputation(db, did);
      if (opts.json) return _json(r);
      console.log(`${did}  total=${r.total.toFixed(3)}  samples=${r.samples}`);
      for (const d of REPUTATION_DIMENSIONS) {
        const info = r.dimensions[d];
        if (!info) continue;
        console.log(
          `  ${d.padEnd(12)} avg=${info.score.toFixed(3)} samples=${info.samples}`,
        );
      }
    });

  anet
    .command("rep-history")
    .argument("<did>", "Agent DID")
    .description("Show reputation history (newest first)")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 20)
    .option("--json", "JSON output")
    .action((did, opts) => {
      const db = _dbFromCtx(anet);
      const rows = getReputationHistory(db, did, opts.limit);
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${_fmtTs(r.createdAt)}  ${r.dimension.padEnd(12)} ${r.score.toFixed(2)}  ${r.evidence || ""}`,
        );
      console.log(`(${rows.length} observations)`);
    });

  anet
    .command("rep-top")
    .description("Top agents by dimension (or total)")
    .option("-d, --dimension <dim>", "Dimension to rank by")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 10)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const rows = getTopAgents(db, {
        dimension: opts.dimension,
        limit: opts.limit,
      });
      if (opts.json) return _json(rows);
      for (const r of rows)
        console.log(
          `  ${r.agentDid}  score=${r.score.toFixed(3)}  samples=${r.samples}`,
        );
    });

  /* ── Stats ──────────────────────────────────────── */

  anet
    .command("stats")
    .description("Network-level statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(anet);
      const s = getNetworkStats(db);
      if (opts.json) return _json(s);
      console.log(`DIDs: ${JSON.stringify(s.dids)}`);
      console.log(`Registry: ${JSON.stringify(s.registry)}`);
      console.log(`Tasks: ${JSON.stringify(s.tasks)}`);
      console.log(`Credentials: ${JSON.stringify(s.credentials)}`);
      console.log(`Sessions: ${JSON.stringify(s.sessions)}`);
      console.log(`Peers: ${s.peers}`);
    });

  // ─── V2 Governance Layer ──────────────────────────────────────────
  const out = (obj) => console.log(JSON.stringify(obj, null, 2));
  const tryRun = (fn) => {
    try {
      fn();
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  };

  anet
    .command("agent-maturities-v2")
    .description("List V2 agent maturity states")
    .action(() => out(Object.values(AGENT_MATURITY_V2)));

  anet
    .command("task-lifecycles-v2")
    .description("List V2 task lifecycle states")
    .action(() => out(Object.values(TASK_LIFECYCLE_V2)));

  anet
    .command("stats-v2")
    .description("V2 agent-network stats")
    .action(() => out(getAgentNetworkStatsV2()));

  anet
    .command("get-max-active-agents-v2")
    .description("Get max active agents per network (V2)")
    .action(() =>
      out({ maxActiveAgentsPerNetwork: getMaxActiveAgentsPerNetworkV2() }),
    );

  anet
    .command("set-max-active-agents-v2 <n>")
    .description("Set max active agents per network (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveAgentsPerNetworkV2(Number(n));
        out({ maxActiveAgentsPerNetwork: getMaxActiveAgentsPerNetworkV2() });
      }),
    );

  anet
    .command("get-max-pending-tasks-v2")
    .description("Get max pending tasks per agent (V2)")
    .action(() =>
      out({ maxPendingTasksPerAgent: getMaxPendingTasksPerAgentV2() }),
    );

  anet
    .command("set-max-pending-tasks-v2 <n>")
    .description("Set max pending tasks per agent (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingTasksPerAgentV2(Number(n));
        out({ maxPendingTasksPerAgent: getMaxPendingTasksPerAgentV2() });
      }),
    );

  anet
    .command("get-agent-idle-ms-v2")
    .description("Get agent idle threshold (V2)")
    .action(() => out({ agentIdleMs: getAgentIdleMsV2() }));

  anet
    .command("set-agent-idle-ms-v2 <ms>")
    .description("Set agent idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setAgentIdleMsV2(Number(ms));
        out({ agentIdleMs: getAgentIdleMsV2() });
      }),
    );

  anet
    .command("get-task-stuck-ms-v2")
    .description("Get task stuck threshold (V2)")
    .action(() => out({ taskStuckMs: getTaskStuckMsV2() }));

  anet
    .command("set-task-stuck-ms-v2 <ms>")
    .description("Set task stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setTaskStuckMsV2(Number(ms));
        out({ taskStuckMs: getTaskStuckMsV2() });
      }),
    );

  anet
    .command("active-agent-count-v2 <networkId>")
    .description("Active agent count for network (V2)")
    .action((networkId) =>
      out({ networkId, count: getActiveAgentCountV2(networkId) }),
    );

  anet
    .command("pending-task-count-v2 <agentId>")
    .description("Pending task count for agent (V2)")
    .action((agentId) =>
      out({ agentId, count: getPendingTaskCountV2(agentId) }),
    );

  anet
    .command("register-agent-v2 <id>")
    .description("Register a V2 agent")
    .requiredOption("-n, --network <id>", "network id")
    .requiredOption("-d, --did <did>", "agent DID")
    .option("--display <name>", "display name")
    .action((id, opts) =>
      tryRun(() =>
        out(
          registerAgentV2(id, {
            networkId: opts.network,
            did: opts.did,
            displayName: opts.display,
          }),
        ),
      ),
    );

  anet
    .command("get-agent-v2 <id>")
    .description("Get a V2 agent")
    .action((id) => out(getAgentV2(id)));

  anet
    .command("list-agents-v2")
    .description("List V2 agents")
    .option("-n, --network <id>", "filter by network")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listAgentsV2({ networkId: opts.network, status: opts.status })),
    );

  anet
    .command("set-agent-status-v2 <id> <next>")
    .description("Set V2 agent status")
    .action((id, next) => tryRun(() => out(setAgentStatusV2(id, next))));

  anet
    .command("activate-agent-v2 <id>")
    .description("Activate a V2 agent")
    .action((id) => tryRun(() => out(activateAgentV2(id))));

  anet
    .command("suspend-agent-v2 <id>")
    .description("Suspend a V2 agent")
    .action((id) => tryRun(() => out(suspendAgentV2(id))));

  anet
    .command("revoke-agent-v2 <id>")
    .description("Revoke a V2 agent")
    .action((id) => tryRun(() => out(revokeAgentV2(id))));

  anet
    .command("touch-agent-v2 <id>")
    .description("Touch a V2 agent")
    .action((id) => tryRun(() => out(touchAgentV2(id))));

  anet
    .command("create-task-v2 <id>")
    .description("Create a V2 task")
    .requiredOption("-a, --agent <id>", "agent id")
    .option("-k, --kind <kind>", "task kind", "invoke")
    .action((id, opts) =>
      tryRun(() =>
        out(createTaskV2(id, { agentId: opts.agent, kind: opts.kind })),
      ),
    );

  anet
    .command("get-task-v2 <id>")
    .description("Get a V2 task")
    .action((id) => out(getTaskV2(id)));

  anet
    .command("list-tasks-v2")
    .description("List V2 tasks")
    .option("-a, --agent <id>", "filter by agent")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listTasksV2({ agentId: opts.agent, status: opts.status })),
    );

  anet
    .command("set-task-status-v2 <id> <next>")
    .description("Set V2 task status")
    .action((id, next) => tryRun(() => out(setTaskStatusV2(id, next))));

  anet
    .command("start-task-v2 <id>")
    .description("Start a V2 task")
    .action((id) => tryRun(() => out(startTaskV2(id))));

  anet
    .command("complete-task-v2 <id>")
    .description("Complete a V2 task")
    .action((id) => tryRun(() => out(completeTaskV2(id))));

  anet
    .command("fail-task-v2 <id>")
    .description("Fail a V2 task")
    .action((id) => tryRun(() => out(failTaskV2(id))));

  anet
    .command("cancel-task-v2 <id>")
    .description("Cancel a V2 task")
    .action((id) => tryRun(() => out(cancelTaskV2(id))));

  anet
    .command("auto-suspend-idle-agents-v2")
    .description("Auto-suspend idle V2 agents")
    .action(() => out(autoSuspendIdleAgentsV2()));

  anet
    .command("auto-fail-stuck-tasks-v2")
    .description("Auto-fail stuck V2 tasks")
    .action(() => out(autoFailStuckTasksV2()));

  program.addCommand(anet);
  return anet;
}

// === Iter20 V2 governance overlay ===
export function registerAnetgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent-network");
  if (!parent) return;
  const L = async () => await import("../lib/agent-network.js");
  parent
    .command("anetgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.ANETGOV_PROFILE_MATURITY_V2,
            dispatchLifecycle: m.ANETGOV_DISPATCH_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("anetgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveAnetgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingAnetgovDispatchsPerProfileV2(),
            idleMs: m.getAnetgovProfileIdleMsV2(),
            stuckMs: m.getAnetgovDispatchStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("anetgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveAnetgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("anetgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingAnetgovDispatchsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("anetgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setAnetgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("anetgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setAnetgovDispatchStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("anetgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--role <v>", "role")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAnetgovProfileV2({ id, owner, role: o.role }),
          null,
          2,
        ),
      );
    });
  parent
    .command("anetgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateAnetgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendAnetgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveAnetgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchAnetgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getAnetgovProfileV2(id), null, 2));
    });
  parent
    .command("anetgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listAnetgovProfilesV2(), null, 2));
    });
  parent
    .command("anetgov-create-dispatch-v2 <id> <profileId>")
    .description("Create dispatch")
    .option("--target <v>", "target")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAnetgovDispatchV2({ id, profileId, target: o.target }),
          null,
          2,
        ),
      );
    });
  parent
    .command("anetgov-dispatching-dispatch-v2 <id>")
    .description("Mark dispatch as dispatching")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).dispatchingAnetgovDispatchV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-complete-dispatch-v2 <id>")
    .description("Complete dispatch")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeDispatchAnetgovV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-fail-dispatch-v2 <id> [reason]")
    .description("Fail dispatch")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failAnetgovDispatchV2(id, reason), null, 2),
      );
    });
  parent
    .command("anetgov-cancel-dispatch-v2 <id> [reason]")
    .description("Cancel dispatch")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelAnetgovDispatchV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("anetgov-get-dispatch-v2 <id>")
    .description("Get dispatch")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getAnetgovDispatchV2(id), null, 2),
      );
    });
  parent
    .command("anetgov-list-dispatchs-v2")
    .description("List dispatchs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listAnetgovDispatchsV2(), null, 2),
      );
    });
  parent
    .command("anetgov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleAnetgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("anetgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck dispatchs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckAnetgovDispatchsV2(), null, 2),
      );
    });
  parent
    .command("anetgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getAgentNetworkGovStatsV2(), null, 2),
      );
    });
}
