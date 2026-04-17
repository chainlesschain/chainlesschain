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

  program.addCommand(cc);
}
