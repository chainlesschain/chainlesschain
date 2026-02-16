/**
 * Browser Automation Skill Handler
 *
 * Interfaces with ComputerUseAgent and BrowserEngine for browser automation.
 */

const { logger } = require("../../../../../utils/logger.js");

let computerUseAgent = null;
let templateActions = null;

module.exports = {
  async init(skill) {
    try {
      const agentModule = require("../../../../../browser/computer-use-agent.js");
      computerUseAgent = agentModule.getInstance
        ? agentModule.getInstance()
        : agentModule;
      logger.info("[BrowserAutomation] ComputerUseAgent loaded");
    } catch (error) {
      logger.warn(
        "[BrowserAutomation] ComputerUseAgent not available:",
        error.message,
      );
    }

    try {
      templateActions = require("../../../../../browser/actions/template-actions.js");
      logger.info("[BrowserAutomation] TemplateActions loaded");
    } catch (error) {
      logger.warn(
        "[BrowserAutomation] TemplateActions not available:",
        error.message,
      );
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, target, options } = parseInput(input);

    logger.info(`[BrowserAutomation] Action: ${action}, Target: ${target}`);

    try {
      switch (action) {
        case "navigate":
        case "goto":
        case "open":
          return await handleNavigate(target);

        case "click":
        case "press":
          return await handleClick(target, options);

        case "type":
        case "input":
        case "text":
          return await handleType(target, options);

        case "screenshot":
        case "capture":
          return await handleScreenshot(options);

        case "fill-form":
        case "fill":
        case "form":
          return await handleFillForm(target, options);

        case "extract":
        case "scrape":
          return await handleExtract(target, options);

        case "scroll":
          return await handleScroll(target, options);

        default:
          if (target && target.startsWith("http")) {
            return await handleNavigate(target);
          }
          return {
            success: false,
            error: `Unknown action: ${action}. Use navigate, click, type, screenshot, fill-form, or extract.`,
          };
      }
    } catch (error) {
      logger.error(`[BrowserAutomation] Error:`, error);
      return { success: false, error: error.message, action };
    }
  },
};
function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "screenshot", target: "", options: {} };
  }

  const trimmed = input.trim();
  const parts = trimmed.match(/^(S+)s*(.*)/);

  if (!parts) {
    return { action: trimmed, target: "", options: {} };
  }

  const action = parts[1].toLowerCase();
  const rest = parts[2] || "";

  // Parse key=value options from rest
  const options = {};
  const keyValueRegex = /(w+)=("[^"]*"|'[^']*'|S+)/g;
  let match;
  let target = rest;

  while ((match = keyValueRegex.exec(rest)) !== null) {
    options[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    target = target.replace(match[0], "").trim();
  }

  // Remove surrounding quotes from target
  target = target.replace(/^['"]|['"]$/g, "").trim();

  return { action, target, options };
}

async function handleNavigate(url) {
  if (!url) {
    return { success: false, error: "No URL provided." };
  }

  if (!computerUseAgent) {
    return { success: false, error: "Browser engine not available." };
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  if (typeof agent.execute === "function") {
    const result = await agent.execute({ type: "navigate", url });
    return { success: true, action: "navigate", url, result };
  }

  return { success: false, error: "Navigate not supported." };
}

async function handleClick(target, options) {
  if (!target && !options.x) {
    return { success: false, error: "No click target specified." };
  }

  if (!computerUseAgent) {
    return { success: false, error: "Browser engine not available." };
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  const params =
    options.x && options.y
      ? {
          type: "click",
          coordinate: { x: parseInt(options.x), y: parseInt(options.y) },
        }
      : { type: "click", target };

  if (typeof agent.execute === "function") {
    const result = await agent.execute(params);
    return { success: true, action: "click", target, result };
  }

  return { success: false, error: "Click not supported." };
}

async function handleType(text, options) {
  if (!text) {
    return { success: false, error: "No text provided to type." };
  }

  if (!computerUseAgent) {
    return { success: false, error: "Browser engine not available." };
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "type",
      text,
      target: options.target,
    });
    return { success: true, action: "type", text, result };
  }

  return { success: false, error: "Type not supported." };
}
async function handleScreenshot(options) {
  if (!computerUseAgent) {
    return { success: false, error: "Browser engine not available." };
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "screenshot",
      fullPage: options.fullPage === "true",
    });
    return { success: true, action: "screenshot", result };
  }

  return { success: false, error: "Screenshot not supported." };
}

async function handleFillForm(target, options) {
  if (!computerUseAgent && !templateActions) {
    return { success: false, error: "Browser engine not available." };
  }

  // Use template actions for form filling if available
  if (templateActions) {
    const ta =
      typeof templateActions.getInstance === "function"
        ? templateActions.getInstance()
        : templateActions;

    if (typeof ta.execute === "function") {
      const result = await ta.execute("form:fill", { fields: options, target });
      return { success: true, action: "fill-form", fields: options, result };
    }
  }

  return {
    success: true,
    action: "fill-form",
    message:
      "Form fill template not available. Please use click and type actions instead.",
    fields: options,
  };
}

async function handleExtract(target, options) {
  if (!computerUseAgent) {
    return { success: false, error: "Browser engine not available." };
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: target || "all",
    });
    return { success: true, action: "extract", extractType: target, result };
  }

  return { success: false, error: "Data extraction not supported." };
}

async function handleScroll(direction, options) {
  if (!computerUseAgent) {
    return { success: false, error: "Browser engine not available." };
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "scroll",
      direction: direction || "down",
      amount: parseInt(options.amount) || 300,
    });
    return { success: true, action: "scroll", direction, result };
  }

  return { success: false, error: "Scroll not supported." };
}
