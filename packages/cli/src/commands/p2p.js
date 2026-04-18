/**
 * P2P commands
 * chainlesschain p2p peers|send|inbox|pair|unpair|devices|status
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  registerPeer,
  getAllPeers,
  getOnlinePeers,
  sendMessage,
  getInbox,
  markMessageRead,
  getMessageCount,
  pairDevice,
  confirmPairing,
  getPairedDevices,
  unpairDevice,
  generatePeerId,
  P2PBridge,
  PEER_MATURITY_V2,
  MESSAGE_LIFECYCLE_V2,
  getMaxActivePeersPerNetworkV2,
  setMaxActivePeersPerNetworkV2,
  getMaxPendingMessagesPerPeerV2,
  setMaxPendingMessagesPerPeerV2,
  getPeerIdleMsV2,
  setPeerIdleMsV2,
  getMessageStuckMsV2,
  setMessageStuckMsV2,
  registerPeerV2,
  getPeerV2,
  listPeersV2,
  activatePeerV2,
  offlinePeerV2,
  archivePeerV2,
  touchPeerV2,
  createMessageV2,
  getMessageV2,
  listMessagesV2,
  startMessageV2,
  deliverMessageV2,
  failMessageV2,
  cancelMessageV2,
  getActivePeerCountV2,
  getPendingMessageCountV2,
  autoOfflineIdlePeersV2,
  autoFailStuckMessagesV2,
  getP2pManagerStatsV2,
} from "../lib/p2p-manager.js";

export function registerP2pCommand(program) {
  const p2p = program
    .command("p2p")
    .description("Peer-to-peer messaging and device management");

  // p2p status
  p2p
    .command("status", { isDefault: true })
    .description("Show P2P connection status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peers = getAllPeers(db);
        const devices = getPairedDevices(db);
        const bridge = new P2PBridge();
        const bridgeAvailable = await bridge.checkBridge();

        if (options.json) {
          console.log(
            JSON.stringify(
              { peers: peers.length, devices: devices.length, bridgeAvailable },
              null,
              2,
            ),
          );
        } else {
          logger.log(chalk.bold("P2P Status:\n"));
          logger.log(`  ${chalk.bold("Peers:")}    ${peers.length}`);
          logger.log(`  ${chalk.bold("Devices:")}  ${devices.length}`);
          logger.log(
            `  ${chalk.bold("Bridge:")}   ${bridgeAvailable ? chalk.green("connected") : chalk.gray("not available")}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // p2p peers
  p2p
    .command("peers")
    .description("List known peers")
    .option("--online", "Show only online peers")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peers = options.online ? getOnlinePeers(db) : getAllPeers(db);

        if (options.json) {
          console.log(JSON.stringify(peers, null, 2));
        } else if (peers.length === 0) {
          logger.info("No peers found");
        } else {
          logger.log(chalk.bold(`Peers (${peers.length}):\n`));
          for (const p of peers) {
            const status =
              p.status === "online"
                ? chalk.green("online")
                : chalk.gray(p.status);
            const name = p.display_name ? ` (${p.display_name})` : "";
            logger.log(`  ${chalk.cyan(p.peer_id)}${name} [${status}]`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // p2p send
  p2p
    .command("send")
    .description("Send a message to a peer")
    .argument("<peer>", "Peer ID to send to")
    .argument("<message>", "Message content")
    .action(async (peer, message) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const myPeerId = generatePeerId();
        registerPeer(db, myPeerId, "CLI User", null, null, "cli");
        const msg = sendMessage(db, myPeerId, peer, message);
        logger.success(`Message sent (${msg.id})`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // p2p inbox
  p2p
    .command("inbox")
    .description("Show received messages")
    .option("--unread", "Show only unread messages")
    .option("--peer-id <id>", "Your peer ID")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peerId = options.peerId || "cli-user";
        const messages = getInbox(db, peerId, { unreadOnly: options.unread });

        if (options.json) {
          console.log(JSON.stringify(messages, null, 2));
        } else if (messages.length === 0) {
          logger.info("No messages");
        } else {
          logger.log(chalk.bold(`Inbox (${messages.length}):\n`));
          for (const m of messages) {
            const read = m.read ? chalk.gray("[read]") : chalk.yellow("[new]");
            logger.log(`  ${read} ${chalk.cyan(m.from_peer)}: ${m.content}`);
            logger.log(`    ${chalk.gray(m.created_at)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // p2p pair
  p2p
    .command("pair")
    .description("Pair a new device")
    .argument("<device-name>", "Device name")
    .option("--type <type>", "Device type (desktop/mobile/tablet)", "unknown")
    .action(async (deviceName, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const device = pairDevice(db, deviceName, options.type);

        logger.success("Device pairing initiated");
        logger.log(
          `  ${chalk.bold("Device ID:")}    ${chalk.cyan(device.deviceId)}`,
        );
        logger.log(
          `  ${chalk.bold("Pairing Code:")} ${chalk.yellow(device.pairingCode)}`,
        );
        logger.log(
          `\n  Enter this code on the other device to complete pairing.`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // p2p devices
  p2p
    .command("devices")
    .description("List paired devices")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const devices = getPairedDevices(db);

        if (options.json) {
          console.log(JSON.stringify(devices, null, 2));
        } else if (devices.length === 0) {
          logger.info("No paired devices");
        } else {
          logger.log(chalk.bold(`Paired Devices (${devices.length}):\n`));
          for (const d of devices) {
            const status =
              d.status === "active"
                ? chalk.green("active")
                : chalk.gray(d.status);
            logger.log(
              `  ${chalk.cyan(d.device_id)} - ${d.device_name} [${status}]`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // p2p unpair
  p2p
    .command("unpair")
    .description("Unpair a device")
    .argument("<device-id>", "Device ID to unpair")
    .action(async (deviceId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = unpairDevice(db, deviceId);

        if (ok) {
          logger.success("Device unpaired");
        } else {
          logger.error(`Device not found: ${deviceId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ===== V2 in-memory governance surface (no DB, no bootstrap) =====

  p2p
    .command("peer-maturities-v2")
    .description("[V2] List peer maturity states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const states = Object.values(PEER_MATURITY_V2);
      if (options.json) console.log(JSON.stringify(states, null, 2));
      else for (const s of states) logger.log(s);
    });

  p2p
    .command("message-lifecycles-v2")
    .description("[V2] List message lifecycle states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const states = Object.values(MESSAGE_LIFECYCLE_V2);
      if (options.json) console.log(JSON.stringify(states, null, 2));
      else for (const s of states) logger.log(s);
    });

  p2p
    .command("config-v2")
    .description("[V2] Show governance config")
    .option("--json", "Output as JSON")
    .action((options) => {
      const cfg = {
        maxActivePeersPerNetwork: getMaxActivePeersPerNetworkV2(),
        maxPendingMessagesPerPeer: getMaxPendingMessagesPerPeerV2(),
        peerIdleMs: getPeerIdleMsV2(),
        messageStuckMs: getMessageStuckMsV2(),
      };
      if (options.json) console.log(JSON.stringify(cfg, null, 2));
      else for (const [k, v] of Object.entries(cfg)) logger.log(`${k}: ${v}`);
    });

  p2p
    .command("set-max-active-peers-per-network-v2 <n>")
    .description("[V2] Set per-network active peer cap")
    .action((n) => {
      try {
        setMaxActivePeersPerNetworkV2(Number(n));
        logger.success(
          `max active peers/network = ${getMaxActivePeersPerNetworkV2()}`,
        );
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("set-max-pending-messages-per-peer-v2 <n>")
    .description("[V2] Set per-peer pending message cap")
    .action((n) => {
      try {
        setMaxPendingMessagesPerPeerV2(Number(n));
        logger.success(
          `max pending messages/peer = ${getMaxPendingMessagesPerPeerV2()}`,
        );
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("set-peer-idle-ms-v2 <ms>")
    .description("[V2] Set peer idle threshold (ms)")
    .action((ms) => {
      try {
        setPeerIdleMsV2(Number(ms));
        logger.success(`peer idle ms = ${getPeerIdleMsV2()}`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("set-message-stuck-ms-v2 <ms>")
    .description("[V2] Set message stuck threshold (ms)")
    .action((ms) => {
      try {
        setMessageStuckMsV2(Number(ms));
        logger.success(`message stuck ms = ${getMessageStuckMsV2()}`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("register-peer-v2 <id>")
    .description("[V2] Register a peer profile (PENDING)")
    .requiredOption("-n, --network <id>", "Network ID")
    .option("-d, --device-name <name>", "Device name")
    .option("-t, --device-type <type>", "Device type", "desktop")
    .action((id, opts) => {
      try {
        const peer = registerPeerV2(id, {
          networkId: opts.network,
          deviceName: opts.deviceName,
          deviceType: opts.deviceType,
        });
        logger.success(`peer ${peer.id} registered (status=${peer.status})`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("activate-peer-v2 <id>")
    .description("[V2] Activate a peer (pending|offline -> active)")
    .action((id) => {
      try {
        const p = activatePeerV2(id);
        logger.success(`peer ${p.id} active`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("offline-peer-v2 <id>")
    .description("[V2] Mark peer offline (active -> offline)")
    .action((id) => {
      try {
        const p = offlinePeerV2(id);
        logger.success(`peer ${p.id} offline`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("archive-peer-v2 <id>")
    .description("[V2] Archive peer (terminal)")
    .action((id) => {
      try {
        const p = archivePeerV2(id);
        logger.success(`peer ${p.id} archived`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("touch-peer-v2 <id>")
    .description("[V2] Bump peer lastSeenAt")
    .action((id) => {
      try {
        const p = touchPeerV2(id);
        logger.success(`peer ${p.id} touched`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("get-peer-v2 <id>")
    .description("[V2] Show peer profile")
    .option("--json", "Output as JSON")
    .action((id, opts) => {
      try {
        const p = getPeerV2(id);
        if (!p) {
          logger.info("peer not found");
          return;
        }
        if (opts.json) console.log(JSON.stringify(p, null, 2));
        else logger.log(JSON.stringify(p, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("list-peers-v2")
    .description("[V2] List peer profiles")
    .option("-n, --network <id>", "Filter by network")
    .option("-s, --status <s>", "Filter by status")
    .option("-t, --device-type <t>", "Filter by device type")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = listPeersV2({
        networkId: opts.network,
        status: opts.status,
        deviceType: opts.deviceType,
      });
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const p of list)
          logger.log(`${p.id}\t${p.networkId}\t${p.status}\t${p.deviceType}`);
    });

  p2p
    .command("create-message-v2 <id>")
    .description("[V2] Create a queued V2 message")
    .requiredOption("-p, --peer <peerId>", "Peer ID")
    .option("-k, --kind <kind>", "Message kind", "text")
    .action((id, opts) => {
      try {
        const m = createMessageV2(id, { peerId: opts.peer, kind: opts.kind });
        logger.success(
          `message ${m.id} queued (peer=${m.peerId} kind=${m.kind})`,
        );
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("start-message-v2 <id>")
    .description("[V2] Mark message sending (queued -> sending)")
    .action((id) => {
      try {
        const m = startMessageV2(id);
        logger.success(`message ${m.id} sending`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("deliver-message-v2 <id>")
    .description("[V2] Mark message delivered (sending -> delivered)")
    .action((id) => {
      try {
        const m = deliverMessageV2(id);
        logger.success(`message ${m.id} delivered`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("fail-message-v2 <id>")
    .description("[V2] Mark message failed (queued|sending -> failed)")
    .action((id) => {
      try {
        const m = failMessageV2(id);
        logger.success(`message ${m.id} failed`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("cancel-message-v2 <id>")
    .description("[V2] Cancel message (queued|sending -> cancelled)")
    .action((id) => {
      try {
        const m = cancelMessageV2(id);
        logger.success(`message ${m.id} cancelled`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("get-message-v2 <id>")
    .description("[V2] Show message")
    .option("--json", "Output as JSON")
    .action((id, opts) => {
      try {
        const m = getMessageV2(id);
        if (!m) {
          logger.info("message not found");
          return;
        }
        if (opts.json) console.log(JSON.stringify(m, null, 2));
        else logger.log(JSON.stringify(m, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  p2p
    .command("list-messages-v2")
    .description("[V2] List V2 messages")
    .option("-p, --peer <peerId>", "Filter by peer")
    .option("-s, --status <s>", "Filter by status")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = listMessagesV2({ peerId: opts.peer, status: opts.status });
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const m of list)
          logger.log(`${m.id}\t${m.peerId}\t${m.status}\t${m.kind}`);
    });

  p2p
    .command("active-peer-count-v2")
    .description("[V2] Count active peers (optional --network filter)")
    .option("-n, --network <id>", "Filter by network")
    .action((opts) => {
      const n = getActivePeerCountV2(opts.network);
      logger.log(String(n));
    });

  p2p
    .command("pending-message-count-v2")
    .description(
      "[V2] Count pending messages (queued+sending) (optional --peer filter)",
    )
    .option("-p, --peer <peerId>", "Filter by peer")
    .action((opts) => {
      const n = getPendingMessageCountV2(opts.peer);
      logger.log(String(n));
    });

  p2p
    .command("auto-offline-idle-peers-v2")
    .description("[V2] Mark idle active peers offline")
    .option("--now <ms>", "Override current time (ms)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = autoOfflineIdlePeersV2(
        opts.now ? { now: Number(opts.now) } : undefined,
      );
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`offlined ${list.length} peer(s)`);
    });

  p2p
    .command("auto-fail-stuck-messages-v2")
    .description("[V2] Fail stuck sending messages")
    .option("--now <ms>", "Override current time (ms)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = autoFailStuckMessagesV2(
        opts.now ? { now: Number(opts.now) } : undefined,
      );
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`failed ${list.length} message(s)`);
    });

  p2p
    .command("stats-v2")
    .description("[V2] Show governance stats")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const s = getP2pManagerStatsV2();
      if (opts.json) console.log(JSON.stringify(s, null, 2));
      else logger.log(JSON.stringify(s, null, 2));
    });
}
