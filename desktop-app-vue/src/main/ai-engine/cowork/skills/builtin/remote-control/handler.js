/**
 * Remote Control Skill Handler
 *
 * Interfaces with the P2P mobile bridge for remote device management.
 */

const { logger } = require("../../../../../utils/logger.js");

let mobileBridge = null;

module.exports = {
  async init(skill) {
    try {
      mobileBridge = require("../../../../../p2p/mobile-bridge.js");
      logger.info("[RemoteControl] MobileBridge loaded");
    } catch (error) {
      logger.warn("[RemoteControl] MobileBridge not available:", error.message);
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, args } = parseInput(input);

    logger.info(`[RemoteControl] Action: ${action}`);

    try {
      switch (action) {
        case "list-devices":
        case "list":
        case "peers":
        case "devices":
          return await handleListDevices();

        case "execute":
        case "exec":
        case "run":
        case "command":
          return await handleExecute(args);

        case "file-transfer":
        case "transfer":
        case "send":
          return await handleFileTransfer(args);

        case "clipboard-sync":
        case "clipboard":
        case "clip":
          return await handleClipboardSync(args);

        case "system-info":
        case "sysinfo":
        case "info":
          return await handleSystemInfo(args);

        case "process-list":
        case "processes":
        case "ps":
          return await handleProcessList(args);

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use list-devices, execute, file-transfer, clipboard-sync, system-info, or process-list.`,
          };
      }
    } catch (error) {
      logger.error(`[RemoteControl] Error:`, error);
      return { success: false, error: error.message, action };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list-devices", args: "" };
  }

  const trimmed = input.trim();
  const spaceIndex = trimmed.indexOf(" ");

  if (spaceIndex === -1) {
    return { action: trimmed.toLowerCase(), args: "" };
  }

  return {
    action: trimmed.substring(0, spaceIndex).toLowerCase(),
    args: trimmed.substring(spaceIndex + 1).trim(),
  };
}

function getBridge() {
  if (!mobileBridge) {
    return null;
  }
  return typeof mobileBridge.getInstance === "function"
    ? mobileBridge.getInstance()
    : mobileBridge;
}

async function handleListDevices() {
  const bridge = getBridge();
  if (!bridge) {
    return {
      success: false,
      error:
        "P2P mobile bridge not available. Ensure signaling server is running.",
    };
  }

  let devices = [];
  if (typeof bridge.getPeers === "function") {
    devices = await bridge.getPeers();
  } else if (typeof bridge.getConnectedDevices === "function") {
    devices = await bridge.getConnectedDevices();
  } else if (typeof bridge.listDevices === "function") {
    devices = await bridge.listDevices();
  }

  return {
    success: true,
    action: "list-devices",
    devices: Array.isArray(devices) ? devices : [],
    deviceCount: Array.isArray(devices) ? devices.length : 0,
  };
}

async function handleExecute(command) {
  if (!command) {
    return {
      success: false,
      error: "No command provided. Example: exec ls -la",
    };
  }

  const bridge = getBridge();
  if (!bridge) {
    return { success: false, error: "P2P mobile bridge not available." };
  }

  if (typeof bridge.sendCommand === "function") {
    const result = await bridge.sendCommand(command);
    return { success: true, action: "execute", command, result };
  }
  if (typeof bridge.executeRemote === "function") {
    const result = await bridge.executeRemote(command);
    return { success: true, action: "execute", command, result };
  }

  return { success: false, error: "Remote command execution not supported." };
}

async function handleFileTransfer(args) {
  if (!args) {
    return {
      success: false,
      error: "No file path provided. Example: file-transfer send /path/to/file",
    };
  }

  const bridge = getBridge();
  if (!bridge) {
    return { success: false, error: "P2P mobile bridge not available." };
  }

  const parts = args.split(" ");
  const direction = parts[0] || "send";
  const filePath = parts.slice(1).join(" ") || parts[0];

  if (typeof bridge.transferFile === "function") {
    const result = await bridge.transferFile(filePath, { direction });
    return {
      success: true,
      action: "file-transfer",
      direction,
      filePath,
      result,
    };
  }

  return { success: false, error: "File transfer not supported." };
}

async function handleClipboardSync(args) {
  const bridge = getBridge();
  if (!bridge) {
    return { success: false, error: "P2P mobile bridge not available." };
  }

  if (typeof bridge.syncClipboard === "function") {
    const result = await bridge.syncClipboard(args);
    return { success: true, action: "clipboard-sync", result };
  }
  if (typeof bridge.getClipboard === "function") {
    const content = await bridge.getClipboard();
    return { success: true, action: "clipboard-sync", content };
  }

  return { success: false, error: "Clipboard sync not supported." };
}

async function handleSystemInfo(args) {
  const bridge = getBridge();
  if (!bridge) {
    return { success: false, error: "P2P mobile bridge not available." };
  }

  if (typeof bridge.getSystemInfo === "function") {
    const info = await bridge.getSystemInfo(args);
    return { success: true, action: "system-info", info };
  }

  return { success: false, error: "System info retrieval not supported." };
}

async function handleProcessList(args) {
  const bridge = getBridge();
  if (!bridge) {
    return { success: false, error: "P2P mobile bridge not available." };
  }

  if (typeof bridge.getProcessList === "function") {
    const processes = await bridge.getProcessList();
    return { success: true, action: "process-list", processes };
  }

  return { success: false, error: "Process list retrieval not supported." };
}
