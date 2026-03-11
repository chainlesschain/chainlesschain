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
}
