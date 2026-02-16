/**
 * Computer Use Skill Handler
 *
 * Desktop-level automation via DesktopAction, CoordinateAction, and VisionAction.
 */

const { logger } = require("../../../../utils/logger.js");

let desktopAction = null;
let coordinateAction = null;
let visionAction = null;

module.exports = {
  async init(skill) {
    try {
      desktopAction = require("../../../../browser/actions/desktop-action.js");
      logger.info("[ComputerUse] DesktopAction loaded");
    } catch (error) {
      logger.warn("[ComputerUse] DesktopAction not available:", error.message);
    }

    try {
      coordinateAction = require("../../../../browser/actions/coordinate-action.js");
      logger.info("[ComputerUse] CoordinateAction loaded");
    } catch (error) {
      logger.warn(
        "[ComputerUse] CoordinateAction not available:",
        error.message,
      );
    }

    try {
      visionAction = require("../../../../browser/actions/vision-action.js");
      logger.info("[ComputerUse] VisionAction loaded");
    } catch (error) {
      logger.warn("[ComputerUse] VisionAction not available:", error.message);
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, args } = parseInput(input);

    logger.info(
      `[ComputerUse] Action: ${action}, Args: ${JSON.stringify(args)}`,
    );

    try {
      switch (action) {
        case "screenshot":
        case "capture":
          return await handleScreenshot();

        case "click":
          return await handleClick(args);

        case "type":
        case "text":
          return await handleType(args);

        case "visual-click":
        case "vclick":
          return await handleVisualClick(args);

        case "analyze":
        case "vision":
          return await handleAnalyze(args);

        case "key":
        case "press":
        case "hotkey":
          return await handleKeyPress(args);

        case "move":
        case "mouse":
          return await handleMouseMove(args);

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use screenshot, click, type, visual-click, analyze, key, or move.`,
          };
      }
    } catch (error) {
      logger.error(`[ComputerUse] Error:`, error);
      return { success: false, error: error.message, action };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "screenshot", args: {} };
  }

  const trimmed = input.trim();
  const spaceIndex = trimmed.indexOf(" ");

  if (spaceIndex === -1) {
    return { action: trimmed.toLowerCase(), args: {} };
  }

  const action = trimmed.substring(0, spaceIndex).toLowerCase();
  const rest = trimmed.substring(spaceIndex + 1).trim();

  // Parse coordinates (e.g., "500 300")
  const coordMatch = rest.match(/^(d+)s+(d+)$/);
  if (coordMatch) {
    return {
      action,
      args: { x: parseInt(coordMatch[1]), y: parseInt(coordMatch[2]) },
    };
  }

  // Parse quoted text
  const quotedMatch = rest.match(/^["'](.*)["']$/);
  if (quotedMatch) {
    return { action, args: { text: quotedMatch[1] } };
  }

  return { action, args: { text: rest } };
}
function getInstance(module) {
  if (!module) {
    return null;
  }
  return typeof module.getInstance === "function"
    ? module.getInstance()
    : module;
}

async function handleScreenshot() {
  const da = getInstance(desktopAction);
  if (!da) {
    return { success: false, error: "Desktop action module not available." };
  }

  if (typeof da.captureScreen === "function") {
    const result = await da.captureScreen();
    return { success: true, action: "screenshot", result };
  }
  if (typeof da.execute === "function") {
    const result = await da.execute({ type: "screenshot" });
    return { success: true, action: "screenshot", result };
  }

  return { success: false, error: "Screenshot not supported." };
}

async function handleClick(args) {
  if (!args.x || !args.y) {
    return {
      success: false,
      error: "Click requires x y coordinates. Example: click 500 300",
    };
  }

  const ca = getInstance(coordinateAction);
  if (!ca) {
    return { success: false, error: "Coordinate action module not available." };
  }

  if (typeof ca.clickAt === "function") {
    const result = await ca.clickAt(args.x, args.y);
    return { success: true, action: "click", x: args.x, y: args.y, result };
  }
  if (typeof ca.execute === "function") {
    const result = await ca.execute({ type: "click", x: args.x, y: args.y });
    return { success: true, action: "click", x: args.x, y: args.y, result };
  }

  return { success: false, error: "Click not supported." };
}

async function handleType(args) {
  const text = args.text;
  if (!text) {
    return {
      success: false,
      error: 'No text provided. Example: type "Hello World"',
    };
  }

  const da = getInstance(desktopAction);
  if (!da) {
    return { success: false, error: "Desktop action module not available." };
  }

  if (typeof da.typeText === "function") {
    const result = await da.typeText(text);
    return { success: true, action: "type", text, result };
  }
  if (typeof da.execute === "function") {
    const result = await da.execute({ type: "type", text });
    return { success: true, action: "type", text, result };
  }

  return { success: false, error: "Type not supported." };
}

async function handleVisualClick(args) {
  const description = args.text;
  if (!description) {
    return {
      success: false,
      error:
        'No element description provided. Example: visual-click "Settings button"',
    };
  }

  const va = getInstance(visionAction);
  if (!va) {
    return { success: false, error: "Vision action module not available." };
  }

  if (typeof va.visualClick === "function") {
    const result = await va.visualClick(description);
    return { success: true, action: "visual-click", description, result };
  }
  if (typeof va.execute === "function") {
    const result = await va.execute({ type: "visual_click", description });
    return { success: true, action: "visual-click", description, result };
  }

  return { success: false, error: "Visual click not supported." };
}

async function handleAnalyze(args) {
  const prompt = args.text || "Describe what is on the screen";

  const va = getInstance(visionAction);
  if (!va) {
    return { success: false, error: "Vision action module not available." };
  }

  if (typeof va.analyze === "function") {
    const result = await va.analyze(prompt);
    return { success: true, action: "analyze", prompt, result };
  }
  if (typeof va.execute === "function") {
    const result = await va.execute({ type: "analyze", prompt });
    return { success: true, action: "analyze", prompt, result };
  }

  return { success: false, error: "Analyze not supported." };
}

async function handleKeyPress(args) {
  const key = args.text;
  if (!key) {
    return { success: false, error: "No key specified. Example: key ctrl+c" };
  }

  const da = getInstance(desktopAction);
  if (!da) {
    return { success: false, error: "Desktop action module not available." };
  }

  if (typeof da.pressKey === "function") {
    const result = await da.pressKey(key);
    return { success: true, action: "key", key, result };
  }
  if (typeof da.execute === "function") {
    const result = await da.execute({ type: "key", key });
    return { success: true, action: "key", key, result };
  }

  return { success: false, error: "Key press not supported." };
}

async function handleMouseMove(args) {
  if (!args.x || !args.y) {
    return {
      success: false,
      error: "Move requires x y coordinates. Example: move 400 200",
    };
  }

  const ca = getInstance(coordinateAction);
  if (!ca) {
    return { success: false, error: "Coordinate action module not available." };
  }

  if (typeof ca.moveTo === "function") {
    const result = await ca.moveTo(args.x, args.y);
    return { success: true, action: "move", x: args.x, y: args.y, result };
  }
  if (typeof ca.execute === "function") {
    const result = await ca.execute({ type: "move", x: args.x, y: args.y });
    return { success: true, action: "move", x: args.x, y: args.y, result };
  }

  return { success: false, error: "Mouse move not supported." };
}
