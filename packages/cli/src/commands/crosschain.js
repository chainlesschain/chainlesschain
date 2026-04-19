/**
 * `cc crosschain` — CLI surface for Phase 89 Cross-Chain Interoperability.
 */

import { Command } from "commander";

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
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerCrossChainCommand(program) {
  const cc = new Command("crosschain")
    .description("Cross-chain interoperability (Phase 89)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureCrossChainTables(db);
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
    .option("--json", "JSON output")
    .action((fromChain, toChain, amount, opts) => {
      const db = _dbFromCtx(cc);
      const result = bridgeAsset(db, {
        fromChain,
        toChain,
        asset: opts.asset,
        amount: parseFloat(amount),
        senderAddress: opts.sender,
        recipientAddress: opts.recipient,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.bridgeId)
        console.log(`Bridge created: ${result.bridgeId} (fee: ${result.fee})`);
      else console.log(`Failed: ${result.reason}`);
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
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.swapId) {
        console.log(`Swap initiated: ${result.swapId}`);
        console.log(`Hash lock: ${result.hashLock}`);
        console.log(`Expires:   ${new Date(result.expiresAt).toISOString()}`);
      } else console.log(`Failed: ${result.reason}`);
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
    .option("--json", "JSON output")
    .action((fromChain, toChain, opts) => {
      const db = _dbFromCtx(cc);
      const result = sendMessage(db, {
        fromChain,
        toChain,
        payload: opts.payload,
        targetContract: opts.contract,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.messageId) console.log(`Message sent: ${result.messageId}`);
      else console.log(`Failed: ${result.reason}`);
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
