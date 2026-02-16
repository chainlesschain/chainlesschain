/**
 * Web Scraping Skill Handler
 *
 * Data extraction from web pages via the browser engine.
 */

const { logger } = require("../../../../utils/logger.js");

let computerUseAgent = null;

module.exports = {
  async init(skill) {
    try {
      const agentModule = require("../../../../browser/computer-use-agent.js");
      computerUseAgent = agentModule.getInstance
        ? agentModule.getInstance()
        : agentModule;
      logger.info("[WebScraping] ComputerUseAgent loaded");
    } catch (error) {
      logger.warn(
        "[WebScraping] ComputerUseAgent not available:",
        error.message,
      );
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { type, url, selector } = parseInput(input);

    logger.info(`[WebScraping] Type: ${type}, URL: ${url || "current page"}`);

    try {
      // Navigate first if URL provided
      if (url) {
        await navigateIfNeeded(url);
      }

      switch (type) {
        case "tables":
        case "table":
          return await extractTables();

        case "links":
        case "link":
        case "urls":
          return await extractLinks();

        case "text":
        case "content":
          return await extractText();

        case "images":
        case "image":
        case "img":
          return await extractImages();

        case "custom":
        case "selector":
        case "css":
          return await extractCustom(selector);

        case "all":
        case "page":
          return await extractAll();

        default:
          // Treat as URL if it looks like one
          if (type && (type.startsWith("http") || type.includes("."))) {
            await navigateIfNeeded(type);
            return await extractAll();
          }
          return {
            success: false,
            error: `Unknown extraction type: ${type}. Use tables, links, text, images, or custom.`,
          };
      }
    } catch (error) {
      logger.error(`[WebScraping] Error:`, error);
      return { success: false, error: error.message, type };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { type: "all", url: "", selector: "" };
  }

  const parts = input.trim().split(/\s+/);
  const type = parts[0]?.toLowerCase() || "all";

  // Find URL in remaining parts
  let url = "";
  let selector = "";

  for (let i = 1; i < parts.length; i++) {
    if (
      parts[i].startsWith("http") ||
      parts[i].includes(".com") ||
      parts[i].includes(".org")
    ) {
      url = parts[i];
    } else if (
      parts[i].startsWith(".") ||
      parts[i].startsWith("#") ||
      parts[i].startsWith("[")
    ) {
      selector = parts.slice(i).join(" ");
      break;
    } else if (!url) {
      selector = parts.slice(i).join(" ");
    }
  }

  return { type, url, selector: selector.replace(/^["']|["']$/g, "") };
}

async function navigateIfNeeded(url) {
  if (!computerUseAgent || !url) {
    return;
  }

  const agent =
    typeof computerUseAgent.getInstance === "function"
      ? computerUseAgent.getInstance()
      : computerUseAgent;

  if (typeof agent.execute === "function") {
    await agent.execute({ type: "navigate", url });
  }
}

function getAgent() {
  if (!computerUseAgent) {
    return null;
  }
  return typeof computerUseAgent.getInstance === "function"
    ? computerUseAgent.getInstance()
    : computerUseAgent;
}

async function extractTables() {
  const agent = getAgent();
  if (!agent) {
    return { success: false, error: "Browser engine not available." };
  }

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: "tables",
    });
    return { success: true, type: "tables", data: result };
  }

  return { success: false, error: "Table extraction not supported." };
}

async function extractLinks() {
  const agent = getAgent();
  if (!agent) {
    return { success: false, error: "Browser engine not available." };
  }

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: "links",
    });
    return { success: true, type: "links", data: result };
  }

  return { success: false, error: "Link extraction not supported." };
}

async function extractText() {
  const agent = getAgent();
  if (!agent) {
    return { success: false, error: "Browser engine not available." };
  }

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: "text",
    });
    return { success: true, type: "text", data: result };
  }

  return { success: false, error: "Text extraction not supported." };
}

async function extractImages() {
  const agent = getAgent();
  if (!agent) {
    return { success: false, error: "Browser engine not available." };
  }

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: "images",
    });
    return { success: true, type: "images", data: result };
  }

  return { success: false, error: "Image extraction not supported." };
}

async function extractCustom(selector) {
  if (!selector) {
    return {
      success: false,
      error: 'No CSS selector provided. Example: custom ".product-card"',
    };
  }

  const agent = getAgent();
  if (!agent) {
    return { success: false, error: "Browser engine not available." };
  }

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: "custom",
      selector,
    });
    return { success: true, type: "custom", selector, data: result };
  }

  return { success: false, error: "Custom extraction not supported." };
}

async function extractAll() {
  const agent = getAgent();
  if (!agent) {
    return { success: false, error: "Browser engine not available." };
  }

  if (typeof agent.execute === "function") {
    const result = await agent.execute({
      type: "analyze_page",
      extractType: "all",
    });
    return { success: true, type: "all", data: result };
  }

  return { success: false, error: "Page analysis not supported." };
}
