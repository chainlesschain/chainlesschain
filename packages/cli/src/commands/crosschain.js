/**
 * `cc crosschain` — CLI surface for Phase 89 Cross-Chain Interoperability.
 *
 * #21 B.5 Layer 1 PR1 (2026-05-15): `cc crosschain bridge --require-multisig`
 * opt-in routes outbound bridge through m-of-n multisig (domain
 * `crosschain.bridge.outbound`); `cc crosschain bridge-consume <proposalId>`
 * finalizes after threshold is reached. Mirrors marketplace purchase/consume.
 */

import fs from "node:fs";

import { Command } from "commander";

import { bootstrap } from "../runtime/bootstrap.js";
import { getHomeDir } from "../lib/paths.js";
import {
  openMultisigManager,
  defaultMultisigDbPath,
  defaultMultisigLogPath,
  readSecretKey,
} from "../lib/multisig-runtime.js";

const MULTISIG_BRIDGE_OUTBOUND_DOMAIN = "crosschain.bridge.outbound";
import {
  getCrossChainMtcDir,
  getBridgeMtcStatus,
  loadCrossChainMtcConfig,
  addTrustAnchor,
  listTrustAnchors,
  removeTrustAnchor,
  verifyBridgeEnvelope,
  assembleBridgeBatch,
  stageBridgeOp,
  closeBatch,
  buildMultiHopBridgeEnvelope,
  verifyMultiHopBridgeEnvelope,
  shouldCloseBatchGasAware,
  getBridgeMtcSlaMetrics,
} from "../lib/cross-chain-mtc.js";
import mtcLib from "@chainlesschain/core-mtc";

import {
  SUPPORTED_CHAINS,
  BRIDGE_STATUS,
  SWAP_STATUS,
  MESSAGE_STATUS,
  DEFAULT_CONFIG,
  ensureCrossChainTables,
  bridgeAsset,
  updateBridgeStatus,
  getBridge,
  listBridges,
  initiateSwap,
  claimSwap,
  refundSwap,
  getSwap,
  revealSecret,
  listSwaps,
  sendMessage,
  updateMessageStatus,
  getMessage,
  listMessages,
  estimateFee,
  getCrossChainStats,
  // V2
  BRIDGE_STATUS_V2,
  SWAP_STATUS_V2,
  MESSAGE_STATUS_V2,
  CHAIN_ID_V2,
  CROSSCHAIN_DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS,
  setMaxActiveBridgesPerAddress,
  getMaxActiveBridgesPerAddress,
  getActiveBridgeCount,
  configureChainV2,
  getChainConfigV2,
  listChainsV2,
  bridgeAssetV2,
  setBridgeStatusV2,
  setSwapStatusV2,
  setMessageStatusV2,
  autoExpireSwapsV2,
  getCrossChainStatsV2,
} from "../lib/cross-chain.js";

function _dbFromCtx(cmd) {
  // cmd is typically the action subcommand (e.g. `bridge`).
  // _db may be wired onto cmd itself, the parent (`cc crosschain` group),
  // or the root program — return the first one we find.
  return cmd?._db ?? cmd?.parent?._db ?? cmd?.parent?.parent?._db ?? null;
}

/**
 * Bootstrap a real DB when the crosschain command is invoked headless
 * (e.g. via spawnSync in integration tests). Falls back to whatever the
 * REPL/runtime already wired into _dbFromCtx if present.
 */
async function _ensureDb(thisCmd) {
  const existing = _dbFromCtx(thisCmd);
  if (existing) {
    ensureCrossChainTables(existing);
    return existing;
  }
  const ctx = await bootstrap({ verbose: false });
  if (!ctx.db) return null;
  const db = ctx.db.getDatabase();
  ensureCrossChainTables(db);
  thisCmd._db = db;
  return db;
}

/**
 * --mtc opt-in hook: when caller passes --mtc and the action succeeded,
 * stage one bridge op for the next batch close. Silent best-effort —
 * an MTC failure must not break the existing crosschain flow.
 */
function _maybeStageMtc(opts, opBuilder) {
  if (!opts || !opts.mtc) return null;
  try {
    const home = opts.mtcConfigDir || getHomeDir();
    const dir = getCrossChainMtcDir(home);
    return stageBridgeOp(dir, opBuilder(), { requireEnabled: false });
  } catch (err) {
    return { staged: false, path: null, reason: `STAGE_ERROR: ${err.message}` };
  }
}

/**
 * #21 B.5 Layer 1 — open a multisig proposal for an outbound bridge.
 * Does NOT insert into cc_bridges yet; bridge-consume does that after
 * the proposal reaches threshold. Mirrors marketplace.purchase.
 */
async function _bridgePropose({
  fromChain,
  toChain,
  amount,
  asset,
  sender,
  recipient,
  initiator,
  alg,
  key,
  multisigDb,
  multisigLog,
  json,
}) {
  if (!initiator) {
    const out = {
      status: "blocked",
      reason: "missing_initiator",
      path: "multisig",
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else
      console.error(
        "✗ --initiator <did> required when --require-multisig is set",
      );
    process.exitCode = 2;
    return out;
  }
  if (!key) {
    const out = {
      status: "blocked",
      reason: "missing_key",
      path: "multisig",
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else
      console.error(
        "✗ --key <hex|path> required when --require-multisig is set",
      );
    process.exitCode = 2;
    return out;
  }

  const { store, mgr, close } = await openMultisigManager(
    multisigDb,
    multisigLog,
  );
  try {
    const policy = store.getPolicy(MULTISIG_BRIDGE_OUTBOUND_DOMAIN);
    if (!policy) {
      const out = {
        status: "blocked",
        reason: "no_policy",
        path: "multisig",
        domain: MULTISIG_BRIDGE_OUTBOUND_DOMAIN,
      };
      if (json) console.log(JSON.stringify(out, null, 2));
      else
        console.error(
          `✗ No multisig policy for domain "${MULTISIG_BRIDGE_OUTBOUND_DOMAIN}". Run: cc multisig policy set ${MULTISIG_BRIDGE_OUTBOUND_DOMAIN} --m <M> --members <json>`,
        );
      process.exitCode = 2;
      return out;
    }

    const secretKey = readSecretKey(key);
    const payload = {
      fromChain,
      toChain,
      asset: asset || "native",
      amount,
      sender: sender || null,
      recipient: recipient || null,
    };
    const result = mgr.propose({
      domain: MULTISIG_BRIDGE_OUTBOUND_DOMAIN,
      payload,
      policy,
      initiator: { did: initiator, alg: alg || "Ed25519", secretKey },
    });
    const out = {
      status: "needs_co_sign",
      path: "multisig",
      proposalId: result.proposal.id,
      reachedThreshold: result.reachedThreshold,
      requiredSigs: policy.m,
      memberCount: policy.members.length,
      payload,
    };
    if (json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(
        `↪ Routed through multisig (domain ${MULTISIG_BRIDGE_OUTBOUND_DOMAIN})`,
      );
      console.log(`  proposalId: ${result.proposal.id}`);
      console.log(`  needs ${policy.m} of ${policy.members.length} signatures`);
      if (result.reachedThreshold)
        console.log(
          `  ✓ threshold reached on first signature — run: cc crosschain bridge-consume ${result.proposal.id}`,
        );
    }
    return out;
  } finally {
    close();
  }
}

/**
 * #21 B.5 Layer 1 — finalize an outbound bridge after multisig threshold.
 * Reads the proposal's payload, executes the actual bridgeAsset() insert,
 * then marks the proposal consumed. Mirrors marketplace.consume.
 *
 * PR4 — when `mtc=true`, additionally stage the bridge op with multisig
 * provenance via `_maybeStageMtc` so closeBatch carries it into the MTC
 * envelope leaf (and downstream wrapper attachment / Layer 3 broadcast).
 */
async function _bridgeConsume({
  db,
  proposalId,
  multisigDb,
  multisigLog,
  json,
  mtc,
  mtcConfigDir,
}) {
  const { mgr, close } = await openMultisigManager(multisigDb, multisigLog);
  try {
    const got = mgr.get(proposalId);
    if (!got) {
      const out = { status: "error", reason: "proposal_not_found" };
      if (json) console.log(JSON.stringify(out, null, 2));
      else console.error(`✗ No proposal: ${proposalId}`);
      process.exitCode = 2;
      return out;
    }
    if (got.proposal.domain !== MULTISIG_BRIDGE_OUTBOUND_DOMAIN) {
      const out = {
        status: "error",
        reason: "wrong_domain",
        expected: MULTISIG_BRIDGE_OUTBOUND_DOMAIN,
        actual: got.proposal.domain,
      };
      if (json) console.log(JSON.stringify(out, null, 2));
      else
        console.error(
          `✗ Proposal domain "${got.proposal.domain}" is not "${MULTISIG_BRIDGE_OUTBOUND_DOMAIN}" — use the matching consume command for that domain instead.`,
        );
      process.exitCode = 2;
      return out;
    }
    if (got.proposal.state !== "reached") {
      const out = {
        status: "error",
        reason: `proposal_state_${got.proposal.state}`,
      };
      if (json) console.log(JSON.stringify(out, null, 2));
      else
        console.error(
          `✗ Proposal state is "${got.proposal.state}", need "reached" — sign more before consume.`,
        );
      process.exitCode = 2;
      return out;
    }

    const payload = JSON.parse(got.proposal.payloadJcs);

    // #21 B.5 Layer 2 PR1 — extract m-of-n provenance from the reached
    // proposal and persist it alongside the bridge row. signatures are
    // returned sorted by signer_did ASC (store.getSignatures), so the array
    // ordering is canonical for any downstream onchain verifier.
    const signatures = got.signatures || [];
    // PR4 adds thresholdM + memberCountN so the carry-forward MTC staging
    // can build the canonical multisig_provenance shape required by
    // attachMultisigProvenance / verifyMultisigProvenance.
    const multisigContext = {
      proposalId: got.proposal.id,
      thresholdM: got.proposal.thresholdM,
      memberCountN: Array.isArray(got.proposal.memberSet)
        ? got.proposal.memberSet.length
        : signatures.length,
      signers: signatures.map((s) => s.signerDid),
      partialSigs: signatures.map((s) => ({
        did: s.signerDid,
        alg: s.alg,
        sig: Buffer.isBuffer(s.sig) ? s.sig.toString("hex") : String(s.sig),
      })),
    };

    const bridgeResult = bridgeAsset(
      db,
      {
        fromChain: payload.fromChain,
        toChain: payload.toChain,
        asset: payload.asset,
        amount: payload.amount,
        senderAddress: payload.sender,
        recipientAddress: payload.recipient,
      },
      multisigContext,
    );
    if (!bridgeResult.bridgeId) {
      const out = {
        status: "error",
        reason: `bridge_insert_failed_${bridgeResult.reason}`,
        proposalId,
      };
      if (json) console.log(JSON.stringify(out, null, 2));
      else
        console.error(
          `✗ Bridge insert failed: ${bridgeResult.reason} — proposal left in "reached" state`,
        );
      process.exitCode = 1;
      return out;
    }
    const finalizeRes = mgr.finalize(proposalId);
    if (!finalizeRes.ok) {
      const out = {
        status: "error",
        reason: finalizeRes.reason,
        proposalId,
        bridgeId: bridgeResult.bridgeId,
      };
      if (json) console.log(JSON.stringify(out, null, 2));
      else
        console.error(
          `✗ Finalize failed: ${finalizeRes.reason} (bridge row ${bridgeResult.bridgeId} already inserted)`,
        );
      process.exitCode = 1;
      return out;
    }

    // PR4 — opt-in MTC staging carries the multisig provenance forward into
    // closeBatch / wrapper envelope. Same `_maybeStageMtc` helper as the
    // legacy direct-bridge path, just with an enriched op shape including
    // the canonical `multisig_provenance` field.
    const mtcStaged = _maybeStageMtc({ mtc, mtcConfigDir }, () => ({
      bridge_op: "lock",
      src_chain: payload.fromChain,
      dst_chain: payload.toChain,
      src_tx_hash: bridgeResult.bridgeId,
      amount: String(payload.amount),
      asset: payload.asset || "native",
      src_did: payload.sender || null,
      dst_did: payload.recipient || null,
      issued_at: new Date().toISOString(),
      multisig_provenance: {
        proposal_id: multisigContext.proposalId,
        threshold_m: multisigContext.thresholdM,
        member_count_n: multisigContext.memberCountN,
        signers: multisigContext.signers,
        partial_sigs: multisigContext.partialSigs,
      },
    }));

    const out = {
      status: "consumed",
      proposalId,
      bridgeId: bridgeResult.bridgeId,
      fee: bridgeResult.fee,
      payload,
      // Layer 2 provenance — surface what was persisted on the bridge row.
      signers: multisigContext.signers,
      partialSigCount: multisigContext.partialSigs.length,
      // PR4 — surface MTC staging result when --mtc was passed.
      mtc: mtcStaged,
    };
    if (json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(
        `✓ Bridge consumed — ${payload.fromChain} → ${payload.toChain}, amount ${payload.amount} ${payload.asset}`,
      );
      console.log(
        `  bridgeId: ${bridgeResult.bridgeId} (fee ${bridgeResult.fee})`,
      );
      console.log(`  proposalId: ${proposalId}`);
      if (mtcStaged?.staged)
        console.log(`  MTC envelope staged: ${mtcStaged.path}`);
      else if (mtcStaged && !mtcStaged.staged)
        console.log(`  MTC stage skipped: ${mtcStaged.reason}`);
    }
    return out;
  } finally {
    close();
  }
}

export function registerCrossChainCommand(program) {
  const cc = new Command("crosschain")
    .description("Cross-chain interoperability (Phase 89)")
    .hook("preAction", async (thisCmd, actionCommand) => {
      // Skip db bootstrap for MTC-only subcommands that don't touch the
      // crosschain DB — keeps `cc crosschain mtc-status` etc. usable on
      // a fresh box where the SQLite store hasn't been initialized.
      const name = actionCommand?.name?.() || "";
      if (
        name.startsWith("mtc-") ||
        name === "chains" ||
        name === "bridge-statuses" ||
        name === "swap-statuses"
      ) {
        return;
      }
      await _ensureDb(thisCmd);
    });

  /* ── Catalogs ────────────────────────────────────── */

  cc.command("chains")
    .description("List supported chains")
    .option("--json", "JSON output")
    .action((opts) => {
      const chains = Object.values(SUPPORTED_CHAINS);
      if (opts.json) return console.log(JSON.stringify(chains, null, 2));
      for (const c of chains)
        console.log(
          `  ${c.id.padEnd(12)} ${c.name.padEnd(18)} ${c.symbol}  chainId=${c.chainId}`,
        );
    });

  cc.command("bridge-statuses")
    .description("List bridge statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(BRIDGE_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  cc.command("swap-statuses")
    .description("List swap statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(SWAP_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  /* ── Asset Bridge ────────────────────────────────── */

  cc.command("bridge <from-chain> <to-chain> <amount>")
    .description("Bridge asset between chains")
    .option("-a, --asset <asset>", "Asset name", "native")
    .option("-s, --sender <address>", "Sender address")
    .option("-r, --recipient <address>", "Recipient address")
    .option(
      "--mtc",
      "On success, stage an MTC bridge envelope (requires cc crosschain mtc-batch to close)",
    )
    .option("--mtc-config-dir <dir>", "Override MTC config root")
    .option(
      "--require-multisig",
      "Route through m-of-n multisig (domain crosschain.bridge.outbound). Requires --initiator + --key + policy set.",
    )
    .option(
      "--initiator <did>",
      "Initiator DID for multisig proposal (required when --require-multisig)",
    )
    .option("--alg <alg>", "Initiator signing alg", "Ed25519")
    .option(
      "--key <hex|path>",
      "Initiator secret key hex or path to hex file (required when --require-multisig)",
    )
    .option(
      "--multisig-db <path>",
      "Multisig SQLite DB path (default ~/.chainlesschain/multisig.db)",
    )
    .option(
      "--multisig-log <path>",
      "Multisig governance log path (default ~/.chainlesschain/multisig.governance.log)",
    )
    .option("--json", "JSON output")
    .action(async (fromChain, toChain, amount, opts) => {
      const db = _dbFromCtx(cc);

      if (opts.requireMultisig) {
        return _bridgePropose({
          db,
          fromChain,
          toChain,
          amount: parseFloat(amount),
          asset: opts.asset,
          sender: opts.sender,
          recipient: opts.recipient,
          initiator: opts.initiator,
          alg: opts.alg,
          key: opts.key,
          multisigDb: opts.multisigDb || defaultMultisigDbPath(),
          multisigLog: opts.multisigLog || defaultMultisigLogPath(),
          json: opts.json,
        });
      }

      const result = bridgeAsset(db, {
        fromChain,
        toChain,
        asset: opts.asset,
        amount: parseFloat(amount),
        senderAddress: opts.sender,
        recipientAddress: opts.recipient,
      });
      const mtc =
        result.bridgeId &&
        _maybeStageMtc(opts, () => ({
          bridge_op: "lock",
          src_chain: fromChain,
          dst_chain: toChain,
          src_tx_hash: result.bridgeId,
          amount: String(amount),
          asset: opts.asset || "native",
          src_did: opts.sender || null,
          dst_did: opts.recipient || null,
          issued_at: new Date().toISOString(),
        }));
      if (opts.json)
        return console.log(JSON.stringify({ ...result, mtc }, null, 2));
      if (result.bridgeId)
        console.log(`Bridge created: ${result.bridgeId} (fee: ${result.fee})`);
      else console.log(`Failed: ${result.reason}`);
      if (mtc?.staged) console.log(`MTC envelope staged: ${mtc.path}`);
      else if (mtc && !mtc.staged)
        console.log(`MTC stage skipped: ${mtc.reason}`);
    });

  cc.command("bridge-consume <proposalId>")
    .description(
      "Finalize a multisig-gated bridge after threshold reached — performs the SQLite insert and marks proposal consumed",
    )
    .option(
      "--multisig-db <path>",
      "Multisig SQLite DB path (default ~/.chainlesschain/multisig.db)",
    )
    .option(
      "--multisig-log <path>",
      "Multisig governance log path (default ~/.chainlesschain/multisig.governance.log)",
    )
    .option(
      "--mtc",
      "On success, stage an MTC bridge envelope carrying the multisig provenance (requires cc crosschain mtc-batch to close)",
    )
    .option("--mtc-config-dir <dir>", "Override MTC config root")
    .option("--json", "JSON output")
    .action(async (proposalId, opts) => {
      const db = _dbFromCtx(cc);
      return _bridgeConsume({
        db,
        proposalId,
        multisigDb: opts.multisigDb || defaultMultisigDbPath(),
        multisigLog: opts.multisigLog || defaultMultisigLogPath(),
        json: opts.json,
        mtc: opts.mtc,
        mtcConfigDir: opts.mtcConfigDir,
      });
    });

  cc.command("bridge-status <bridge-id> <status>")
    .description("Update bridge status")
    .option("-t, --tx-hash <hash>", "Transaction hash")
    .option("-e, --error <message>", "Error message")
    .option("--json", "JSON output")
    .action((bridgeId, status, opts) => {
      const db = _dbFromCtx(cc);
      const result = updateBridgeStatus(db, bridgeId, status, {
        txHash: opts.txHash,
        errorMessage: opts.error,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Bridge status updated." : `Failed: ${result.reason}`,
      );
    });

  cc.command("bridge-show <bridge-id>")
    .description("Show bridge details")
    .option("--json", "JSON output")
    .action((bridgeId, opts) => {
      const db = _dbFromCtx(cc);
      const b = getBridge(db, bridgeId);
      if (!b) return console.log("Bridge not found.");
      if (opts.json) return console.log(JSON.stringify(b, null, 2));
      console.log(`ID:        ${b.id}`);
      console.log(`Route:     ${b.from_chain} → ${b.to_chain}`);
      console.log(`Asset:     ${b.asset}`);
      console.log(`Amount:    ${b.amount}`);
      console.log(`Fee:       ${b.fee_amount}`);
      console.log(`Status:    ${b.status}`);
      if (b.lock_tx_hash) console.log(`Lock TX:   ${b.lock_tx_hash}`);
      if (b.mint_tx_hash) console.log(`Mint TX:   ${b.mint_tx_hash}`);
      if (b.error_message) console.log(`Error:     ${b.error_message}`);
      // #21 B.5 Layer 2 PR1 — surface m-of-n provenance when present.
      if (b.multisig_proposal_id) {
        console.log(`Multisig:  ${b.multisig_proposal_id}`);
        try {
          const signers = b.signers_did_json
            ? JSON.parse(b.signers_did_json)
            : [];
          const sigs = b.partial_sigs_json
            ? JSON.parse(b.partial_sigs_json)
            : [];
          console.log(
            `Signers:   ${signers.length} — ${signers.join(", ") || "(none)"}`,
          );
          if (sigs.length) {
            const algs = [...new Set(sigs.map((s) => s.alg))].join("+");
            console.log(`Sigs:      ${sigs.length} partial (${algs})`);
          }
        } catch (_err) {
          /* malformed provenance JSON — show raw cell content */
          if (b.signers_did_json)
            console.log(`Signers:   ${b.signers_did_json}`);
          if (b.partial_sigs_json)
            console.log(`Sigs:      ${b.partial_sigs_json}`);
        }
      }
    });

  cc.command("bridges")
    .description("List bridge transactions")
    .option("-f, --from <chain>", "Filter by source chain")
    .option("-t, --to <chain>", "Filter by destination chain")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cc);
      const bridges = listBridges(db, {
        fromChain: opts.from,
        toChain: opts.to,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(bridges, null, 2));
      if (bridges.length === 0) return console.log("No bridges.");
      for (const b of bridges) {
        console.log(
          `  ${b.status.padEnd(12)} ${b.from_chain}→${b.to_chain}  ${b.amount} ${b.asset}  ${b.id.slice(0, 8)}`,
        );
      }
    });

  /* ── HTLC Atomic Swap ────────────────────────────── */

  cc.command("swap <from-chain> <to-chain> <amount>")
    .description("Initiate HTLC atomic swap")
    .option("-a, --from-asset <asset>", "Source asset", "native")
    .option("-b, --to-asset <asset>", "Target asset", "native")
    .option("-c, --counterparty <address>", "Counterparty address")
    .option("-t, --timeout <ms>", "Timeout in ms", parseInt)
    .option("--mtc", "On success, stage an MTC swap-init envelope")
    .option("--mtc-config-dir <dir>", "Override MTC config root")
    .option("--json", "JSON output")
    .action((fromChain, toChain, amount, opts) => {
      const db = _dbFromCtx(cc);
      const result = initiateSwap(db, {
        fromChain,
        toChain,
        fromAsset: opts.fromAsset,
        toAsset: opts.toAsset,
        amount: parseFloat(amount),
        counterpartyAddress: opts.counterparty,
        timeoutMs: opts.timeout,
      });
      const mtc =
        result.swapId &&
        _maybeStageMtc(opts, () => ({
          bridge_op: "swap-init",
          src_chain: fromChain,
          dst_chain: toChain,
          swap_id: result.swapId,
          amount: String(amount),
          asset: opts.fromAsset || "native",
          issued_at: new Date().toISOString(),
        }));
      if (opts.json)
        return console.log(JSON.stringify({ ...result, mtc }, null, 2));
      if (result.swapId) {
        console.log(`Swap initiated: ${result.swapId}`);
        console.log(`Hash lock: ${result.hashLock}`);
        console.log(`Expires:   ${new Date(result.expiresAt).toISOString()}`);
      } else console.log(`Failed: ${result.reason}`);
      if (mtc?.staged) console.log(`MTC envelope staged: ${mtc.path}`);
      else if (mtc && !mtc.staged)
        console.log(`MTC stage skipped: ${mtc.reason}`);
    });

  cc.command("swap-claim <swap-id>")
    .description("Claim a swap with secret")
    .option("-s, --secret <hex>", "HTLC secret")
    .option("-t, --tx-hash <hash>", "Claim transaction hash")
    .option("--json", "JSON output")
    .action((swapId, opts) => {
      const db = _dbFromCtx(cc);
      const result = claimSwap(db, swapId, {
        secret: opts.secret,
        txHash: opts.txHash,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.claimed ? "Swap claimed." : `Failed: ${result.reason}`,
      );
    });

  cc.command("swap-refund <swap-id>")
    .description("Refund a swap")
    .option("-t, --tx-hash <hash>", "Refund transaction hash")
    .option("--json", "JSON output")
    .action((swapId, opts) => {
      const db = _dbFromCtx(cc);
      const result = refundSwap(db, swapId, { txHash: opts.txHash });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.refunded ? "Swap refunded." : `Failed: ${result.reason}`,
      );
    });

  cc.command("swap-show <swap-id>")
    .description("Show swap details")
    .option("--json", "JSON output")
    .action((swapId, opts) => {
      const db = _dbFromCtx(cc);
      const s = getSwap(db, swapId);
      if (!s) return console.log("Swap not found.");
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`ID:          ${s.id}`);
      console.log(`Route:       ${s.from_chain} → ${s.to_chain}`);
      console.log(`Assets:      ${s.from_asset} → ${s.to_asset}`);
      console.log(`Amount:      ${s.amount}`);
      console.log(`Hash lock:   ${s.hash_lock}`);
      console.log(`Status:      ${s.status}`);
      console.log(`Expires:     ${new Date(s.expires_at).toISOString()}`);
    });

  cc.command("swap-secret <swap-id>")
    .description("Reveal swap secret (only after claim)")
    .option("--json", "JSON output")
    .action((swapId, opts) => {
      const db = _dbFromCtx(cc);
      const result = revealSecret(db, swapId);
      if (!result)
        return console.log("Secret unavailable (swap must be claimed).");
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Secret:    ${result.secret}`);
      console.log(`Hash lock: ${result.hashLock}`);
    });

  cc.command("swaps")
    .description("List swaps")
    .option("-f, --from <chain>", "Filter by source chain")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cc);
      const swaps = listSwaps(db, {
        fromChain: opts.from,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(swaps, null, 2));
      if (swaps.length === 0) return console.log("No swaps.");
      for (const s of swaps) {
        console.log(
          `  ${s.status.padEnd(14)} ${s.from_chain}→${s.to_chain}  ${s.amount} ${s.from_asset}→${s.to_asset}  ${s.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Cross-Chain Messages ────────────────────────── */

  cc.command("send <from-chain> <to-chain>")
    .description("Send cross-chain message")
    .option("-p, --payload <text>", "Message payload")
    .option("-c, --contract <address>", "Target contract address")
    .option("--mtc", "On success, stage an MTC msg-send envelope")
    .option("--mtc-config-dir <dir>", "Override MTC config root")
    .option("--json", "JSON output")
    .action((fromChain, toChain, opts) => {
      const db = _dbFromCtx(cc);
      const result = sendMessage(db, {
        fromChain,
        toChain,
        payload: opts.payload,
        targetContract: opts.contract,
      });
      const mtc =
        result.messageId &&
        _maybeStageMtc(opts, () => ({
          bridge_op: "msg-send",
          src_chain: fromChain,
          dst_chain: toChain,
          src_tx_hash: result.messageId,
          msg_payload: opts.payload
            ? Buffer.from(opts.payload, "utf-8").toString("base64url")
            : null,
          issued_at: new Date().toISOString(),
        }));
      if (opts.json)
        return console.log(JSON.stringify({ ...result, mtc }, null, 2));
      if (result.messageId) console.log(`Message sent: ${result.messageId}`);
      else console.log(`Failed: ${result.reason}`);
      if (mtc?.staged) console.log(`MTC envelope staged: ${mtc.path}`);
      else if (mtc && !mtc.staged)
        console.log(`MTC stage skipped: ${mtc.reason}`);
    });

  cc.command("msg-status <message-id> <status>")
    .description("Update message status")
    .option("-t, --tx-hash <hash>", "Transaction hash")
    .option("--json", "JSON output")
    .action((messageId, status, opts) => {
      const db = _dbFromCtx(cc);
      const result = updateMessageStatus(db, messageId, status, {
        txHash: opts.txHash,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Message status updated." : `Failed: ${result.reason}`,
      );
    });

  cc.command("msg-show <message-id>")
    .description("Show message details")
    .option("--json", "JSON output")
    .action((messageId, opts) => {
      const db = _dbFromCtx(cc);
      const m = getMessage(db, messageId);
      if (!m) return console.log("Message not found.");
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`ID:        ${m.id}`);
      console.log(`Route:     ${m.from_chain} → ${m.to_chain}`);
      console.log(`Payload:   ${m.payload}`);
      console.log(`Status:    ${m.status}`);
      console.log(`Retries:   ${m.retries}`);
      if (m.target_contract) console.log(`Contract:  ${m.target_contract}`);
    });

  cc.command("messages")
    .description("List cross-chain messages")
    .option("-f, --from <chain>", "Filter by source chain")
    .option("-t, --to <chain>", "Filter by destination chain")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cc);
      const msgs = listMessages(db, {
        fromChain: opts.from,
        toChain: opts.to,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(msgs, null, 2));
      if (msgs.length === 0) return console.log("No messages.");
      for (const m of msgs) {
        console.log(
          `  ${m.status.padEnd(12)} ${m.from_chain}→${m.to_chain}  ${m.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Fee Estimation ──────────────────────────────── */

  cc.command("estimate-fee <from-chain> <to-chain> <amount>")
    .description("Estimate cross-chain bridge fee")
    .option("--json", "JSON output")
    .action((fromChain, toChain, amount, opts) => {
      const result = estimateFee({
        fromChain,
        toChain,
        amount: parseFloat(amount),
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.fee === null) return console.log(`Failed: ${result.reason}`);
      console.log(`Estimated fee: $${result.fee} USD`);
      console.log(`  Source chain:  $${result.breakdown.sourceFee}`);
      console.log(`  Dest chain:    $${result.breakdown.destFee}`);
      console.log(`  Bridge fee:    $${result.breakdown.bridgeFee}`);
    });

  /* ── Stats ───────────────────────────────────────── */

  cc.command("stats")
    .description("Cross-chain statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(cc);
      const stats = getCrossChainStats(db);
      if (opts.json) return console.log(JSON.stringify(stats, null, 2));
      console.log(
        `Bridges:   ${stats.bridges.total}  (volume: ${stats.bridges.totalVolume}, fees: ${stats.bridges.totalFees})`,
      );
      console.log(`Swaps:     ${stats.swaps.total}`);
      console.log(`Messages:  ${stats.messages.total}`);
    });

  /* ══════════════════════════════════════════════════
   * Cross-chain bridge MTC integration (跨链桥设计 v0.1)
   * Design: docs/design/MTC_跨链桥_v1.md
   * Status: opt-in. Default config.enabled = false. Read commands work
   * regardless; envelope generation requires enabled=true.
   * ══════════════════════════════════════════════════ */

  registerCrossChainMtcSubcommands(cc);

  /* ══════════════════════════════════════════════════
   * Phase 89 — Cross-Chain V2 subcommands
   * ══════════════════════════════════════════════════ */

  cc.command("bridge-statuses-v2")
    .description("List V2 bridge statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const values = Object.values(BRIDGE_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(values, null, 2));
      for (const v of values) console.log(`  ${v}`);
    });

  cc.command("swap-statuses-v2")
    .description("List V2 swap statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const values = Object.values(SWAP_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(values, null, 2));
      for (const v of values) console.log(`  ${v}`);
    });

  cc.command("message-statuses-v2")
    .description("List V2 message statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const values = Object.values(MESSAGE_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(values, null, 2));
      for (const v of values) console.log(`  ${v}`);
    });

  cc.command("chain-ids-v2")
    .description("List V2 chain IDs")
    .option("--json", "JSON output")
    .action((opts) => {
      const values = Object.values(CHAIN_ID_V2);
      if (opts.json) return console.log(JSON.stringify(values, null, 2));
      for (const v of values) console.log(`  ${v}`);
    });

  cc.command("default-max-active-bridges")
    .description("Show default max active bridges per address")
    .action(() => {
      console.log(`  ${CROSSCHAIN_DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS}`);
    });

  cc.command("max-active-bridges")
    .description("Show current max active bridges per address")
    .action(() => {
      console.log(`  ${getMaxActiveBridgesPerAddress()}`);
    });

  cc.command("active-bridge-count [address]")
    .description("Active (non-terminal) bridge count, optionally by address")
    .action((address) => {
      console.log(`  ${getActiveBridgeCount(address)}`);
    });

  cc.command("set-max-active-bridges <n>")
    .description("Set max active bridges per address (positive integer)")
    .action((n) => {
      setMaxActiveBridgesPerAddress(parseFloat(n));
      console.log(
        `  Max active bridges per address = ${getMaxActiveBridgesPerAddress()}`,
      );
    });

  cc.command("configure-chain <chain-id>")
    .description("Configure a supported chain (rpcUrl, contract, enabled)")
    .option("--rpc-url <url>", "RPC URL")
    .option("--contract <addr>", "Contract address")
    .option("--disabled", "Set enabled=false")
    .option("--json", "JSON output")
    .action((chainId, opts) => {
      const cfg = configureChainV2({
        chainId,
        rpcUrl: opts.rpcUrl,
        contractAddress: opts.contract,
        enabled: !opts.disabled,
      });
      if (opts.json) return console.log(JSON.stringify(cfg, null, 2));
      console.log(`  Configured ${cfg.chainId} (enabled=${cfg.enabled})`);
    });

  cc.command("chain-config <chain-id>")
    .description("Show chain config (or 'not configured')")
    .option("--json", "JSON output")
    .action((chainId, opts) => {
      const cfg = getChainConfigV2(chainId);
      if (opts.json) return console.log(JSON.stringify(cfg, null, 2));
      if (!cfg) return console.log("  not configured");
      console.log(
        `  ${cfg.chainId}  enabled=${cfg.enabled}  rpc=${cfg.rpcUrl ?? "-"}  contract=${cfg.contractAddress ?? "-"}`,
      );
    });

  cc.command("list-chains-v2")
    .description("List chains enriched with V2 config")
    .option("--json", "JSON output")
    .action((opts) => {
      const chains = listChainsV2();
      if (opts.json) return console.log(JSON.stringify(chains, null, 2));
      for (const c of chains) {
        console.log(
          `  ${c.id.padEnd(12)} ${c.symbol.padEnd(6)} enabled=${c.enabled}  rpc=${c.rpcUrl ?? "-"}`,
        );
      }
    });

  cc.command("bridge-v2 <from-chain> <to-chain> <amount>")
    .description(
      "Create a bridge (V2: throws on error, enforces per-address cap)",
    )
    .option("--asset <name>", "Asset symbol", "native")
    .option("--sender <addr>", "Sender address")
    .option("--recipient <addr>", "Recipient address")
    .option("--json", "JSON output")
    .action((fromChain, toChain, amount, opts) => {
      const r = bridgeAssetV2(_dbFromCtx(cc), {
        fromChain,
        toChain,
        asset: opts.asset,
        amount: parseFloat(amount),
        senderAddress: opts.sender,
        recipientAddress: opts.recipient,
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`  Bridge created: ${r.bridgeId}  fee=${r.fee}`);
    });

  cc.command("set-bridge-status <bridge-id> <status>")
    .description("Set bridge status with state-machine guard")
    .option("--lock-tx <hash>", "Lock tx hash")
    .option("--mint-tx <hash>", "Mint tx hash")
    .option("--message <msg>", "Error message")
    .option("--json", "JSON output")
    .action((bridgeId, status, opts) => {
      const b = setBridgeStatusV2(_dbFromCtx(cc), bridgeId, status, {
        lockTxHash: opts.lockTx,
        mintTxHash: opts.mintTx,
        errorMessage: opts.message,
      });
      if (opts.json) return console.log(JSON.stringify(b, null, 2));
      console.log(`  ${b.id}  ${b.status}`);
    });

  cc.command("set-swap-status <swap-id> <status>")
    .description("Set swap status with state-machine guard")
    .option("--claim-tx <hash>", "Claim tx hash")
    .option("--refund-tx <hash>", "Refund tx hash")
    .option("--json", "JSON output")
    .action((swapId, status, opts) => {
      const s = setSwapStatusV2(_dbFromCtx(cc), swapId, status, {
        claimTxHash: opts.claimTx,
        refundTxHash: opts.refundTx,
      });
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`  ${s.id}  ${s.status}`);
    });

  cc.command("set-message-status <message-id> <status>")
    .description("Set message status with state-machine guard")
    .option("--source-tx <hash>", "Source tx hash")
    .option("--dest-tx <hash>", "Destination tx hash")
    .option("--json", "JSON output")
    .action((messageId, status, opts) => {
      const m = setMessageStatusV2(_dbFromCtx(cc), messageId, status, {
        sourceTxHash: opts.sourceTx,
        destinationTxHash: opts.destTx,
      });
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`  ${m.id}  ${m.status}  retries=${m.retries}`);
    });

  cc.command("auto-expire-swaps")
    .description("Bulk-flip past-deadline swaps to EXPIRED")
    .option("--json", "JSON output")
    .action((opts) => {
      const expired = autoExpireSwapsV2(_dbFromCtx(cc));
      if (opts.json) return console.log(JSON.stringify(expired, null, 2));
      console.log(`  Expired ${expired.length} swap(s)`);
    });

  cc.command("stats-v2")
    .description("V2 cross-chain statistics (all-enum-key)")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getCrossChainStatsV2();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `  Bridges:  ${s.totalBridges} (active ${s.activeBridges}, volume ${s.totalBridgeVolume}, fees ${s.totalFees})`,
      );
      console.log(`  Swaps:    ${s.totalSwaps}`);
      console.log(`  Messages: ${s.totalMessages}`);
      console.log(`  Configured chains: ${s.configuredChains}`);
      console.log(
        `  Max active bridges / addr: ${s.maxActiveBridgesPerAddress}`,
      );
    });

  program.addCommand(cc);
  registerCrossChainV2Command(cc);
}

function _resolveBridgeMtcDir(opts) {
  const home = (opts && opts.configDir) || getHomeDir();
  return getCrossChainMtcDir(home);
}

function registerCrossChainMtcSubcommands(cc) {
  cc.command("mtc-status")
    .description("Show cross-chain bridge MTC config + trust anchors + batches")
    .option(
      "--config-dir <dir>",
      "Override config root (default: ~/.chainlesschain)",
    )
    .option("--json", "JSON output")
    .action((opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const s = getBridgeMtcStatus(dir);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Enabled:        ${s.enabled ? "yes" : "no (opt-in via config.enabled=true)"}`,
      );
      console.log(`Mode:           ${s.mode}`);
      console.log(`Algorithm:      ${s.alg}`);
      console.log(`Batch interval: ${s.batch_interval_seconds}s`);
      console.log(`Issuer:         ${s.issuer}`);
      console.log(
        `Trust anchors:  ${s.trust_anchors.total} across ${s.trust_anchors.chain_count} chain(s)`,
      );
      for (const [chain, count] of Object.entries(s.trust_anchors.by_chain)) {
        console.log(`                ${chain}: ${count}`);
      }
      console.log(
        `Batches:        ${s.batches.total}${s.batches.latest ? ` (latest: ${s.batches.latest})` : ""}`,
      );
    });

  cc.command("mtc-serve")
    .description(
      "Run a daemon that periodically closes staged bridge ops into batches",
    )
    .option("--config-dir <dir>", "Override config root")
    .option(
      "--interval <seconds>",
      "Batch close interval (default: config.batch_interval_seconds)",
      parseInt,
    )
    .option("--once", "Close once and exit (no daemon loop)")
    .option("--alg <alg>", "Override config alg")
    .option("--issuer <issuer>", "Override config issuer")
    .option("--json", "Emit per-tick JSON results to stdout")
    .action(async (opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const cfg = loadCrossChainMtcConfig(dir);
      const intervalSec = opts.interval || cfg.batch_interval_seconds;
      const tick = () => {
        try {
          const result = closeBatch(dir, {
            alg: opts.alg,
            issuer: opts.issuer,
          });
          const stamp = new Date().toISOString();
          if (opts.json) {
            console.log(JSON.stringify({ tick_at: stamp, ...result }, null, 2));
          } else if (!result.skipped) {
            console.log(
              `[${stamp}] closed ${result.batches.length} batch(es): ${result.batches
                .map((b) => `${b.pair}#${b.seq}(${b.count})`)
                .join(", ")}`,
            );
          } else {
            console.log(`[${stamp}] (idle: ${result.skipped.reason})`);
          }
        } catch (err) {
          console.error(
            `[${new Date().toISOString()}] tick error: ${err.message}`,
          );
        }
      };

      tick();
      if (opts.once) return;

      console.log(
        `mtc-serve: closing every ${intervalSec}s (config-dir: ${dir}). Ctrl-C to stop.`,
      );
      const handle = setInterval(tick, intervalSec * 1000);
      // Graceful shutdown
      const stop = () => {
        clearInterval(handle);
        console.log("mtc-serve: stopped.");
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      // Keep the event loop alive forever (until signal)
      await new Promise(() => {});
    });

  cc.command("mtc-batch")
    .description(
      "Close currently-staged bridge ops into batches (one per chain-pair)",
    )
    .option("--config-dir <dir>", "Override config root")
    .option("--alg <alg>", "Override config alg (ed25519 | slh-dsa-128f)")
    .option("--issuer <issuer>", "Override config issuer")
    .option("--json", "JSON output")
    .action((opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const result = closeBatch(dir, {
        alg: opts.alg,
        issuer: opts.issuer,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.skipped) {
        console.log(`(no batch closed: ${result.skipped.reason})`);
        return;
      }
      for (const b of result.batches) {
        console.log(
          `✓ Closed ${b.pair}#${b.seq}  ${b.count} op(s)  treeHead=${b.treeHeadId}`,
        );
        console.log(`  → ${b.dir}`);
      }
    });

  cc.command("mtc-envelope")
    .description("Build a bridge MTC envelope from a JSON file of bridge ops")
    .requiredOption("-i, --input <path>", "JSON file: array of bridge ops")
    .requiredOption("--src-chain <chain>", "Source chain")
    .requiredOption("--dst-chain <chain>", "Destination chain")
    .requiredOption("--batch-seq <n>", "Batch sequence number", parseInt)
    .option("--issuer <issuer>", "MTCA issuer (default from config)")
    .option("--alg <alg>", "ed25519 | slh-dsa-128f")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "JSON output (full landmark + envelopes)")
    .action((opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const cfg = loadCrossChainMtcConfig(dir);
      const ops = JSON.parse(fs.readFileSync(opts.input, "utf-8"));
      if (!Array.isArray(ops)) {
        console.error("Input file must contain a JSON array of bridge ops.");
        process.exit(2);
      }
      const alg = opts.alg || cfg.alg;
      const signer = alg === "slh-dsa-128f" ? mtcLib.slhDsa : mtcLib.ed25519;
      const keys = signer.generateKeyPair();
      const result = assembleBridgeBatch(ops, keys, {
        src_chain: opts.srcChain,
        dst_chain: opts.dstChain,
        batch_seq: opts.batchSeq,
        issuer: opts.issuer || cfg.issuer,
        signer,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Namespace:    ${result.namespace}`);
      console.log(`Tree head id: ${result.treeHeadId}`);
      console.log(`Tree size:    ${result.envelopes.length}`);
      console.log(`Algorithm:    ${alg}`);
      console.log(`(JSON envelope + landmark omitted; pass --json to emit)`);
    });

  cc.command("mtc-verify <envelope-path> <landmark-path>")
    .description("Verify a bridge MTC envelope against a landmark file")
    .option("--json", "JSON output")
    .action((envPath, lmPath, opts) => {
      const envelope = JSON.parse(fs.readFileSync(envPath, "utf-8"));
      const landmark = JSON.parse(fs.readFileSync(lmPath, "utf-8"));
      const cache = new mtcLib.LandmarkCache({
        signatureVerifier: mtcLib.alwaysAcceptSignatureVerifier,
      });
      try {
        cache.ingest(landmark);
      } catch (err) {
        const out = {
          ok: false,
          code: err.code || "LANDMARK_REJECT",
          error: err.message,
        };
        if (opts.json) return console.log(JSON.stringify(out, null, 2));
        console.log(`✗ Landmark ingest failed: ${err.message}`);
        process.exit(2);
      }
      const result = verifyBridgeEnvelope(envelope, cache);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exit(2);
        return;
      }
      if (result.ok) {
        console.log(`✓ Envelope verified.`);
        console.log(`  Bridge op: ${result.bridge_op}`);
        console.log(`  Tree size: ${result.treeHead?.tree_size}`);
        console.log(`  Issuer:    ${result.treeHead?.issuer}`);
      } else {
        console.log(`✗ Verification failed: ${result.code}`);
        process.exit(2);
      }
    });

  // v0.2 — Multi-hop bridge envelope (envelope-of-envelope)
  cc.command("mtc-multihop-build")
    .description(
      "Build a multi-hop bridge envelope from a JSON file of leg envelopes",
    )
    .requiredOption(
      "-i, --input <path>",
      "JSON file: array of single-hop bridge envelopes (≥ 2)",
    )
    .option("--route-id <id>", "Optional route id (default: auto-generated)")
    .option("--total-amount <amount>", "Optional cumulative amount string")
    .option("--asset <asset>", "Optional asset symbol")
    .option("--out <path>", "Write multi-hop envelope to file")
    .option("--json", "JSON output (default unless --out given)")
    .action((opts) => {
      try {
        const legs = JSON.parse(fs.readFileSync(opts.input, "utf-8"));
        const wrapper = buildMultiHopBridgeEnvelope(legs, {
          route_id: opts.routeId,
          total_amount: opts.totalAmount,
          asset: opts.asset,
        });
        const json = JSON.stringify(wrapper, null, 2);
        if (opts.out) {
          fs.writeFileSync(opts.out, json, "utf-8");
          if (opts.json) console.log(json);
          else
            console.log(
              `✓ Multi-hop envelope written: ${opts.out} (${wrapper.leg_count} legs, route: ${wrapper.chain_path.join(" → ")})`,
            );
        } else {
          console.log(json);
        }
      } catch (err) {
        console.error(`mtc-multihop-build failed: ${err.message}`);
        process.exit(1);
      }
    });

  cc.command("mtc-multihop-verify <wrapper-path>")
    .description(
      "Verify a multi-hop bridge envelope against per-leg landmark files",
    )
    .requiredOption(
      "--landmarks <path>",
      "JSON file: array of {landmark} entries, one per leg in order",
    )
    .option("--json", "JSON output")
    .action((wrapperPath, opts) => {
      try {
        const wrapper = JSON.parse(fs.readFileSync(wrapperPath, "utf-8"));
        const lmEntries = JSON.parse(fs.readFileSync(opts.landmarks, "utf-8"));
        const result = verifyMultiHopBridgeEnvelope(wrapper, lmEntries);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.ok) process.exit(2);
          return;
        }
        if (result.ok) {
          console.log(
            `✓ Multi-hop verified (${wrapper.leg_count} legs, route: ${wrapper.chain_path.join(" → ")})`,
          );
        } else {
          console.log(
            `✗ Multi-hop verification failed: ${result.code || "LEG_FAIL"}`,
          );
          process.exit(2);
        }
      } catch (err) {
        console.error(`mtc-multihop-verify failed: ${err.message}`);
        process.exit(1);
      }
    });

  // v0.2 — Gas-aware batch trigger advisor
  cc.command("mtc-gas-check <target-chain>")
    .description(
      "Heuristic: should the bridge MTCA close its batch now given current gas + staged ops?",
    )
    .requiredOption("--staged-count <n>", "Currently staged ops", parseInt)
    .option(
      "--current-gas-usd <usd>",
      "Observed gas cost in USD (default: chain baseline)",
      parseFloat,
    )
    .option(
      "--hard-close-floor <n>",
      "Always close at or above this staged count (default: 50)",
      parseInt,
    )
    .option(
      "--defer-multiplier <m>",
      "Defer when current_gas > baseline * this (default: 1.5)",
      parseFloat,
    )
    .option("--json", "JSON output")
    .action((targetChain, opts) => {
      try {
        const r = shouldCloseBatchGasAware({
          target_chain: targetChain,
          staged_count: opts.stagedCount,
          current_gas_usd: opts.currentGasUsd,
          hard_close_floor: opts.hardCloseFloor,
          defer_multiplier: opts.deferMultiplier,
        });
        if (opts.json) return console.log(JSON.stringify(r, null, 2));
        console.log(
          `${r.close ? "✓ CLOSE" : "✗ DEFER"}  reason=${r.reason}  baseline=$${r.baseline_usd}  current=$${r.current_usd}  staged=${r.staged_count}`,
        );
      } catch (err) {
        console.error(`mtc-gas-check failed: ${err.message}`);
        process.exit(1);
      }
    });

  // v0.2 — SLA Manager integration: emit SLA-shaped metrics
  cc.command("mtc-sla")
    .description(
      "Emit cc sla-compatible operational metrics for the bridge MTCA",
    )
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "JSON output")
    .action((opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const m = getBridgeMtcSlaMetrics(dir);
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`SLA Status:        ${m.sla_status}`);
      console.log(`Enabled:           ${m.enabled}`);
      console.log(`Mode:              ${m.mode}`);
      console.log(`Staged pending:    ${m.staged_pending_count}`);
      console.log(`Batches total:     ${m.batches_total}`);
      console.log(`Batches last hour: ${m.batches_last_hour}`);
      console.log(
        `Last batch:        ${m.seconds_since_last_batch !== null ? `${m.seconds_since_last_batch}s ago` : "—"}`,
      );
    });

  const taParent = cc
    .command("mtc-trust-anchor")
    .description("Manage Independent-mode trust anchors (per source chain)");

  taParent
    .command("add <chain> <pubkey-id>")
    .description("Add a trust anchor for a source chain")
    .requiredOption("--alg <alg>", "ed25519 | slh-dsa-128f")
    .requiredOption("--issuer <issuer>", "MTCA issuer string for this anchor")
    .option("--jwk <path>", "Optional JWK file for the public key")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "JSON output")
    .action((chain, pubkeyId, opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      let pubkeyJwk = null;
      if (opts.jwk) {
        pubkeyJwk = JSON.parse(fs.readFileSync(opts.jwk, "utf-8"));
      }
      const r = addTrustAnchor(dir, chain, {
        pubkey_id: pubkeyId,
        alg: opts.alg,
        issuer: opts.issuer,
        pubkey_jwk: pubkeyJwk,
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (r.added) {
        console.log(`✓ Added trust anchor for ${chain}: ${pubkeyId}`);
      } else {
        console.log(`(already exists for ${chain}: ${pubkeyId})`);
      }
      console.log(`Total anchors for ${chain}: ${r.total_for_chain}`);
    });

  taParent
    .command("list [chain]")
    .description("List trust anchors (optionally filter by chain)")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "JSON output")
    .action((chain, opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const result = listTrustAnchors(dir, chain);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (chain) {
        if (!result || result.length === 0) {
          console.log(`(no trust anchors for ${chain})`);
          return;
        }
        for (const a of result) {
          console.log(
            `  ${a.pubkey_id}  alg=${a.alg}  issuer=${a.issuer}  added=${a.added_at}`,
          );
        }
      } else {
        const chains = Object.keys(result);
        if (chains.length === 0) {
          console.log("(no trust anchors)");
          return;
        }
        for (const c of chains) {
          console.log(`${c}:`);
          for (const a of result[c]) {
            console.log(`  ${a.pubkey_id}  alg=${a.alg}  issuer=${a.issuer}`);
          }
        }
      }
    });

  taParent
    .command("remove <chain> <pubkey-id>")
    .description("Remove a trust anchor by pubkey-id")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "JSON output")
    .action((chain, pubkeyId, opts) => {
      const dir = _resolveBridgeMtcDir(opts);
      const r = removeTrustAnchor(dir, chain, pubkeyId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (r.removed) {
        console.log(`✓ Removed trust anchor for ${chain}: ${pubkeyId}`);
      } else {
        console.log(`(no matching trust anchor for ${chain}: ${pubkeyId})`);
      }
      console.log(`Remaining anchors for ${chain}: ${r.total_for_chain}`);
    });
}

import {
  XCHAIN_CHANNEL_MATURITY_V2,
  XCHAIN_TRANSFER_LIFECYCLE_V2,
  registerXchainChannelV2,
  activateXchainChannelV2,
  pauseXchainChannelV2,
  decommissionXchainChannelV2,
  touchXchainChannelV2,
  getXchainChannelV2,
  listXchainChannelsV2,
  createXchainTransferV2,
  startXchainTransferV2,
  confirmXchainTransferV2,
  failXchainTransferV2,
  cancelXchainTransferV2,
  getXchainTransferV2,
  listXchainTransfersV2,
  setMaxActiveXchainChannelsPerOwnerV2,
  getMaxActiveXchainChannelsPerOwnerV2,
  setMaxPendingXchainTransfersPerChannelV2,
  getMaxPendingXchainTransfersPerChannelV2,
  setXchainChannelIdleMsV2,
  getXchainChannelIdleMsV2,
  setXchainTransferStuckMsV2,
  getXchainTransferStuckMsV2,
  autoPauseIdleXchainChannelsV2,
  autoFailStuckXchainTransfersV2,
  getCrossChainGovStatsV2,
} from "../lib/cross-chain.js";

export function registerCrossChainV2Command(cc) {
  cc.command("enums-v2")
    .description("Show V2 governance enums")
    .action(() => {
      console.log(
        JSON.stringify(
          { XCHAIN_CHANNEL_MATURITY_V2, XCHAIN_TRANSFER_LIFECYCLE_V2 },
          null,
          2,
        ),
      );
    });
  cc.command("register-channel-v2")
    .description("Register an xchain channel profile (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--from-chain <fromChain>")
    .option("--to-chain <toChain>")
    .action((o) => {
      console.log(
        JSON.stringify(
          registerXchainChannelV2({
            id: o.id,
            owner: o.owner,
            fromChain: o.fromChain,
            toChain: o.toChain,
          }),
          null,
          2,
        ),
      );
    });
  cc.command("activate-channel-v2 <id>")
    .description("Activate channel")
    .action((id) => {
      console.log(JSON.stringify(activateXchainChannelV2(id), null, 2));
    });
  cc.command("pause-channel-v2 <id>")
    .description("Pause channel")
    .action((id) => {
      console.log(JSON.stringify(pauseXchainChannelV2(id), null, 2));
    });
  cc.command("decommission-channel-v2 <id>")
    .description("Decommission channel (terminal)")
    .action((id) => {
      console.log(JSON.stringify(decommissionXchainChannelV2(id), null, 2));
    });
  cc.command("touch-channel-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) => {
      console.log(JSON.stringify(touchXchainChannelV2(id), null, 2));
    });
  cc.command("get-channel-v2 <id>")
    .description("Get channel")
    .action((id) => {
      console.log(JSON.stringify(getXchainChannelV2(id), null, 2));
    });
  cc.command("list-channels-v2")
    .description("List channels")
    .action(() => {
      console.log(JSON.stringify(listXchainChannelsV2(), null, 2));
    });
  cc.command("create-transfer-v2")
    .description("Create an xchain transfer (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--channel-id <channelId>")
    .option("--amount <amount>")
    .action((o) => {
      console.log(
        JSON.stringify(
          createXchainTransferV2({
            id: o.id,
            channelId: o.channelId,
            amount: o.amount,
          }),
          null,
          2,
        ),
      );
    });
  cc.command("start-transfer-v2 <id>")
    .description("Transition transfer to relaying")
    .action((id) => {
      console.log(JSON.stringify(startXchainTransferV2(id), null, 2));
    });
  cc.command("confirm-transfer-v2 <id>")
    .description("Transition transfer to confirmed")
    .action((id) => {
      console.log(JSON.stringify(confirmXchainTransferV2(id), null, 2));
    });
  cc.command("fail-transfer-v2 <id>")
    .description("Fail transfer")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(failXchainTransferV2(id, o.reason), null, 2));
    });
  cc.command("cancel-transfer-v2 <id>")
    .description("Cancel transfer")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(
        JSON.stringify(cancelXchainTransferV2(id, o.reason), null, 2),
      );
    });
  cc.command("get-transfer-v2 <id>")
    .description("Get transfer")
    .action((id) => {
      console.log(JSON.stringify(getXchainTransferV2(id), null, 2));
    });
  cc.command("list-transfers-v2")
    .description("List transfers")
    .action(() => {
      console.log(JSON.stringify(listXchainTransfersV2(), null, 2));
    });
  cc.command("set-max-active-channels-v2 <n>")
    .description("Set per-owner active cap")
    .action((n) => {
      setMaxActiveXchainChannelsPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxActiveXchainChannelsPerOwner:
              getMaxActiveXchainChannelsPerOwnerV2(),
          },
          null,
          2,
        ),
      );
    });
  cc.command("set-max-pending-transfers-v2 <n>")
    .description("Set per-channel pending cap")
    .action((n) => {
      setMaxPendingXchainTransfersPerChannelV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxPendingXchainTransfersPerChannel:
              getMaxPendingXchainTransfersPerChannelV2(),
          },
          null,
          2,
        ),
      );
    });
  cc.command("set-channel-idle-ms-v2 <n>")
    .description("Set idle threshold")
    .action((n) => {
      setXchainChannelIdleMsV2(Number(n));
      console.log(
        JSON.stringify(
          { xchainChannelIdleMs: getXchainChannelIdleMsV2() },
          null,
          2,
        ),
      );
    });
  cc.command("set-transfer-stuck-ms-v2 <n>")
    .description("Set stuck threshold")
    .action((n) => {
      setXchainTransferStuckMsV2(Number(n));
      console.log(
        JSON.stringify(
          { xchainTransferStuckMs: getXchainTransferStuckMsV2() },
          null,
          2,
        ),
      );
    });
  cc.command("auto-pause-idle-channels-v2")
    .description("Auto-pause idle channels")
    .action(() => {
      console.log(JSON.stringify(autoPauseIdleXchainChannelsV2(), null, 2));
    });
  cc.command("auto-fail-stuck-transfers-v2")
    .description("Auto-fail stuck relaying transfers")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckXchainTransfersV2(), null, 2));
    });
  cc.command("gov-stats-v2")
    .description("V2 governance aggregate stats")
    .action(() => {
      console.log(JSON.stringify(getCrossChainGovStatsV2(), null, 2));
    });
}

// === Iter28 V2 governance overlay: Crchgov ===
export function registerCrchV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "crosschain");
  if (!parent) return;
  const L = async () => await import("../lib/cross-chain.js");
  parent
    .command("crchgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CRCHGOV_PROFILE_MATURITY_V2,
            transferLifecycle: m.CRCHGOV_TRANSFER_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("crchgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCrchProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCrchTransfersPerProfileV2(),
            idleMs: m.getCrchProfileIdleMsV2(),
            stuckMs: m.getCrchTransferStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("crchgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCrchProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crchgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCrchTransfersPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crchgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCrchProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crchgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCrchTransferStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crchgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--bridge <v>", "bridge")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCrchProfileV2({ id, owner, bridge: o.bridge }),
          null,
          2,
        ),
      );
    });
  parent
    .command("crchgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCrchProfileV2(id), null, 2),
      );
    });
  parent
    .command("crchgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleCrchProfileV2(id), null, 2));
    });
  parent
    .command("crchgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveCrchProfileV2(id), null, 2),
      );
    });
  parent
    .command("crchgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchCrchProfileV2(id), null, 2));
    });
  parent
    .command("crchgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCrchProfileV2(id), null, 2));
    });
  parent
    .command("crchgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCrchProfilesV2(), null, 2));
    });
  parent
    .command("crchgov-create-transfer-v2 <id> <profileId>")
    .description("Create transfer")
    .option("--transferId <v>", "transferId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCrchTransferV2({ id, profileId, transferId: o.transferId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("crchgov-transferring-transfer-v2 <id>")
    .description("Mark transfer as transferring")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).transferringCrchTransferV2(id), null, 2),
      );
    });
  parent
    .command("crchgov-complete-transfer-v2 <id>")
    .description("Complete transfer")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeTransferCrchV2(id), null, 2),
      );
    });
  parent
    .command("crchgov-fail-transfer-v2 <id> [reason]")
    .description("Fail transfer")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCrchTransferV2(id, reason), null, 2),
      );
    });
  parent
    .command("crchgov-cancel-transfer-v2 <id> [reason]")
    .description("Cancel transfer")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCrchTransferV2(id, reason), null, 2),
      );
    });
  parent
    .command("crchgov-get-transfer-v2 <id>")
    .description("Get transfer")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCrchTransferV2(id), null, 2));
    });
  parent
    .command("crchgov-list-transfers-v2")
    .description("List transfers")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCrchTransfersV2(), null, 2));
    });
  parent
    .command("crchgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleCrchProfilesV2(), null, 2),
      );
    });
  parent
    .command("crchgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck transfers")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCrchTransfersV2(), null, 2),
      );
    });
  parent
    .command("crchgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getCrchgovStatsV2(), null, 2));
    });
}
