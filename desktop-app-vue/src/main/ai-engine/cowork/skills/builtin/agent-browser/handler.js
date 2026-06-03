/**
 * Agent Browser Skill Handler
 *
 * Advanced browser automation with snapshot-ref interaction pattern.
 */

const { logger } = require("../../../../../utils/logger.js");

let browserEngine = null;
let computerUseAgent = null;

// Session state
const sessions = new Map();
const currentSession = {
  id: "default",
  url: null,
  refs: new Map(),
  refCounter: 0,
};

module.exports = {
  async init(skill) {
    try {
      browserEngine = require("../../../../../browser/browser-engine.js");
      logger.info("[AgentBrowser] BrowserEngine loaded");
    } catch (error) {
      logger.warn("[AgentBrowser] BrowserEngine not available:", error.message);
    }

    try {
      computerUseAgent = require("../../../../../browser/computer-use-agent.js");
      logger.info("[AgentBrowser] ComputerUseAgent loaded");
    } catch (error) {
      logger.warn(
        "[AgentBrowser] ComputerUseAgent not available:",
        error.message,
      );
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseCommand(input);

    logger.info(
      `[AgentBrowser] Command: ${parsed.command}, Args: ${parsed.args}`,
    );

    try {
      switch (parsed.command) {
        case "open":
        case "navigate":
        case "goto":
          return await handleOpen(parsed.args);
        case "snapshot":
          return await handleSnapshot();
        case "click":
          return await handleClick(parsed.args);
        case "fill":
          return await handleFill(parsed.ref, parsed.value);
        case "type":
          return await handleType(parsed.ref, parsed.value);
        case "select":
          return await handleSelect(parsed.ref, parsed.value);
        case "screenshot":
          return await handleScreenshot(parsed.args);
        case "extract":
          return await handleExtract(parsed.args);
        case "wait":
          return await handleWait(parsed.args);
        case "session-save":
          return handleSessionSave(parsed.args);
        case "session-load":
          return handleSessionLoad(parsed.args);
        default:
          return {
            success: false,
            error: `Unknown command: ${parsed.command}. Use open, snapshot, click, fill, screenshot, extract, wait.`,
          };
      }
    } catch (error) {
      logger.error("[AgentBrowser] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseCommand(input) {
  if (!input || typeof input !== "string") {
    return { command: "snapshot", args: "", ref: null, value: "" };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const command = (parts[0] || "snapshot").toLowerCase();

  // Parse ref like @e1
  const refMatch = trimmed.match(/@e(\d+)/);
  const ref = refMatch ? `@e${refMatch[1]}` : null;

  // Parse quoted value
  const valueMatch = trimmed.match(/"([^"]*)"/);
  const value = valueMatch ? valueMatch[1] : "";

  const args = parts.slice(1).join(" ");

  return { command, args, ref, value };
}

async function handleOpen(url) {
  if (!url) {
    return { success: false, error: "No URL provided." };
  }

  // Clean URL
  let targetUrl = url.replace(/^["']|["']$/g, "").trim();
  if (!targetUrl.match(/^https?:\/\//)) {
    targetUrl = "https://" + targetUrl;
  }

  currentSession.url = targetUrl;
  currentSession.refs.clear();
  currentSession.refCounter = 0;

  if (browserEngine) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.navigate === "function") {
      await engine.navigate(targetUrl);
    } else if (typeof engine.goto === "function") {
      await engine.goto(targetUrl);
    }
  }

  return {
    success: true,
    command: "open",
    url: targetUrl,
    message: `Navigated to ${targetUrl}. Use 'snapshot' to get interactive elements.`,
  };
}

async function handleSnapshot() {
  currentSession.refs.clear();
  currentSession.refCounter = 0;

  const elements = [];

  if (browserEngine) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    let rawElements = [];
    if (typeof engine.getInteractiveElements === "function") {
      rawElements = await engine.getInteractiveElements();
    } else if (typeof engine.snapshot === "function") {
      rawElements = await engine.snapshot();
    }

    if (Array.isArray(rawElements)) {
      for (const el of rawElements) {
        currentSession.refCounter++;
        const ref = `@e${currentSession.refCounter}`;
        currentSession.refs.set(ref, el);
        elements.push({
          ref,
          tag: el.tag || el.tagName || "element",
          type: el.type || "",
          text: el.text || el.innerText || "",
          role: el.role || "",
        });
      }
    }
  }

  if (elements.length === 0) {
    // Generate sample refs when no browser engine
    return {
      success: true,
      command: "snapshot",
      url: currentSession.url,
      elements: [],
      elementCount: 0,
      message:
        "No interactive elements found. Browser engine may not be active.",
    };
  }

  return {
    success: true,
    command: "snapshot",
    url: currentSession.url,
    elements,
    elementCount: elements.length,
  };
}

async function handleClick(args) {
  const refMatch = args.match(/@e(\d+)/);
  if (!refMatch) {
    return {
      success: false,
      error: "No element ref provided. Use @e1, @e2, etc.",
    };
  }

  const ref = `@e${refMatch[1]}`;
  const element = currentSession.refs.get(ref);

  if (browserEngine && element) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.click === "function") {
      await engine.click(element.selector || element);
    }
  }

  return {
    success: true,
    command: "click",
    ref,
    message: `Clicked ${ref}. Re-snapshot to see updated elements.`,
  };
}

async function handleFill(ref, value) {
  if (!ref) {
    return { success: false, error: "No element ref provided." };
  }

  const element = currentSession.refs.get(ref);

  if (browserEngine && element) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.fill === "function") {
      await engine.fill(element.selector || element, value);
    } else if (typeof engine.type === "function") {
      await engine.type(element.selector || element, value, { clear: true });
    }
  }

  return {
    success: true,
    command: "fill",
    ref,
    value,
    message: `Filled ${ref} with "${value}".`,
  };
}

async function handleType(ref, value) {
  if (!ref) {
    return { success: false, error: "No element ref provided." };
  }

  const element = currentSession.refs.get(ref);

  if (browserEngine && element) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.type === "function") {
      await engine.type(element.selector || element, value);
    }
  }

  return {
    success: true,
    command: "type",
    ref,
    value,
    message: `Typed "${value}" into ${ref}.`,
  };
}

async function handleSelect(ref, value) {
  if (!ref) {
    return { success: false, error: "No element ref provided." };
  }

  const element = currentSession.refs.get(ref);

  if (browserEngine && element) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.select === "function") {
      await engine.select(element.selector || element, value);
    }
  }

  return {
    success: true,
    command: "select",
    ref,
    value,
    message: `Selected "${value}" in ${ref}.`,
  };
}

async function handleScreenshot(args) {
  let screenshotPath = null;

  if (browserEngine) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.screenshot === "function") {
      const result = await engine.screenshot({
        fullPage: args.includes("--full"),
      });
      screenshotPath =
        typeof result === "string" ? result : result?.path || null;
    }
  }

  return {
    success: true,
    command: "screenshot",
    screenshotPath,
    url: currentSession.url,
    message: screenshotPath
      ? `Screenshot saved to ${screenshotPath}`
      : "Screenshot captured.",
  };
}

async function handleExtract(args) {
  const refMatch = args.match(/@e(\d+)/);
  let text = "";

  if (browserEngine) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (refMatch) {
      const ref = `@e${refMatch[1]}`;
      const element = currentSession.refs.get(ref);
      if (element && typeof engine.getText === "function") {
        text = await engine.getText(element.selector || element);
      }
    } else if (typeof engine.getPageText === "function") {
      text = await engine.getPageText();
    }
  }

  return {
    success: true,
    command: "extract",
    text,
    url: currentSession.url,
    message: text
      ? `Extracted ${text.length} characters.`
      : "No text extracted.",
  };
}

async function handleWait(args) {
  const refMatch = args.match(/@e(\d+)/);
  const msMatch = args.match(/^(\d+)$/);

  if (msMatch) {
    const ms = Math.min(parseInt(msMatch[1], 10), 30000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return {
      success: true,
      command: "wait",
      waited: ms,
      message: `Waited ${ms}ms.`,
    };
  }

  if (browserEngine && refMatch) {
    const engine =
      typeof browserEngine.getInstance === "function"
        ? browserEngine.getInstance()
        : browserEngine;

    if (typeof engine.waitForElement === "function") {
      await engine.waitForElement(args);
    }
  }

  return { success: true, command: "wait", message: "Wait completed." };
}

function handleSessionSave(name) {
  const sessionName = name.replace(/[^a-zA-Z0-9._-]/g, "") || "default";
  sessions.set(sessionName, {
    url: currentSession.url,
    savedAt: new Date().toISOString(),
  });

  return {
    success: true,
    command: "session-save",
    name: sessionName,
    message: `Session saved as "${sessionName}".`,
  };
}

function handleSessionLoad(name) {
  const sessionName = name.replace(/[^a-zA-Z0-9._-]/g, "") || "default";
  const saved = sessions.get(sessionName);

  if (!saved) {
    return { success: false, error: `Session "${sessionName}" not found.` };
  }

  currentSession.url = saved.url;
  return {
    success: true,
    command: "session-load",
    name: sessionName,
    url: saved.url,
    message: `Session "${sessionName}" loaded.`,
  };
}
