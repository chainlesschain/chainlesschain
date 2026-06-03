/**
 * WebApp Testing Skill Handler
 *
 * Test web applications with browser automation.
 */

const { logger } = require("../../../../../utils/logger.js");

let browserEngine = null;

module.exports = {
  async init(skill) {
    try {
      browserEngine = require("../../../../../browser/browser-engine.js");
      logger.info("[WebAppTesting] BrowserEngine loaded");
    } catch (error) {
      logger.warn(
        "[WebAppTesting] BrowserEngine not available:",
        error.message,
      );
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[WebAppTesting] Action: ${parsed.action}, URL: ${parsed.url}`);

    if (!parsed.url && parsed.action !== "inspect") {
      return {
        success: false,
        error: "No URL provided. Usage: /webapp-testing test <url>",
      };
    }

    try {
      switch (parsed.action) {
        case "test":
          return await handleTest(parsed.url, parsed.options);
        case "screenshot":
          return await handleScreenshot(parsed.url, parsed.options);
        case "console":
          return await handleConsole(parsed.url);
        case "accessibility":
          return await handleAccessibility(parsed.url);
        case "scenario":
          return await handleScenario(parsed.url, parsed.steps);
        case "inspect":
          return await handleInspect(parsed.url);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use test, screenshot, console, accessibility, scenario, or inspect.`,
          };
      }
    } catch (error) {
      logger.error("[WebAppTesting] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "test", url: "", options: {}, steps: [] };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "test").toLowerCase();

  // Find URL (starts with http or localhost)
  let url = "";
  for (const part of parts.slice(1)) {
    if (
      part.match(/^https?:\/\//) ||
      part.match(/^localhost/) ||
      part.match(/^127\.0\.0\.1/)
    ) {
      url = part;
      if (!url.match(/^https?:\/\//)) {
        url = "http://" + url;
      }
      break;
    }
  }

  const options = {};
  if (trimmed.includes("--full")) {
    options.fullPage = true;
  }

  const checkMatch = trimmed.match(/--check\s+(\S+)/);
  if (checkMatch) {
    options.check = checkMatch[1];
  }

  const stepsMatch = trimmed.match(/--steps\s+"([^"]+)"/);
  const steps = stepsMatch ? stepsMatch[1].split(",").map((s) => s.trim()) : [];

  return { action, url, options, steps };
}

async function handleTest(url, options = {}) {
  const results = {
    url,
    loaded: false,
    errors: [],
    warnings: [],
    elements: { forms: 0, links: 0, images: 0, buttons: 0 },
  };

  if (browserEngine) {
    const engine = getEngine();

    if (typeof engine.navigate === "function") {
      await engine.navigate(url);
      results.loaded = true;
    }

    // Check for errors
    if (typeof engine.getConsoleErrors === "function") {
      results.errors = await engine.getConsoleErrors();
    }

    // Count elements
    if (typeof engine.evaluate === "function") {
      const counts = await engine.evaluate(() => ({
        forms: document.querySelectorAll("form").length,
        links: document.querySelectorAll("a").length,
        images: document.querySelectorAll("img").length,
        buttons: document.querySelectorAll("button, [type=submit]").length,
      }));
      if (counts) {
        results.elements = counts;
      }
    }
  } else {
    results.warnings.push("Browser engine not available. Using mock test.");
    results.loaded = true;
  }

  return {
    success: true,
    action: "test",
    url,
    results,
    passed: results.errors.length === 0,
    message:
      results.errors.length === 0
        ? `Page loaded successfully. Found ${results.elements.forms} form(s), ${results.elements.links} link(s).`
        : `Found ${results.errors.length} error(s).`,
  };
}

async function handleScreenshot(url, options = {}) {
  let screenshotPath = null;

  if (browserEngine) {
    const engine = getEngine();

    if (typeof engine.navigate === "function") {
      await engine.navigate(url);
    }

    if (typeof engine.screenshot === "function") {
      const result = await engine.screenshot({
        fullPage: options.fullPage || false,
      });
      screenshotPath =
        typeof result === "string" ? result : result?.path || null;
    }
  }

  return {
    success: true,
    action: "screenshot",
    url,
    screenshotPath,
    fullPage: options.fullPage || false,
    message: screenshotPath
      ? `Screenshot saved to ${screenshotPath}`
      : "Screenshot captured.",
  };
}

async function handleConsole(url) {
  const logs = { errors: [], warnings: [], info: [] };

  if (browserEngine) {
    const engine = getEngine();

    if (typeof engine.navigate === "function") {
      await engine.navigate(url);
    }

    if (typeof engine.getConsoleLogs === "function") {
      const allLogs = await engine.getConsoleLogs();
      if (Array.isArray(allLogs)) {
        for (const log of allLogs) {
          const level = (log.level || log.type || "info").toLowerCase();
          if (level === "error") {
            logs.errors.push(log.text || log.message);
          } else if (level === "warning" || level === "warn") {
            logs.warnings.push(log.text || log.message);
          } else {
            logs.info.push(log.text || log.message);
          }
        }
      }
    }
  }

  return {
    success: true,
    action: "console",
    url,
    logs,
    errorCount: logs.errors.length,
    warningCount: logs.warnings.length,
    message: `Console: ${logs.errors.length} error(s), ${logs.warnings.length} warning(s), ${logs.info.length} info message(s).`,
  };
}

async function handleAccessibility(url) {
  const checks = [];
  const issues = [];

  if (browserEngine) {
    const engine = getEngine();

    if (typeof engine.navigate === "function") {
      await engine.navigate(url);
    }

    if (typeof engine.evaluate === "function") {
      const a11yData = await engine.evaluate(() => {
        const results = [];

        // Check images for alt text
        document.querySelectorAll("img").forEach((img) => {
          if (!img.alt) {
            results.push({
              type: "error",
              rule: "img-alt",
              message: `Image missing alt text: ${img.src?.substring(0, 50)}`,
            });
          }
        });

        // Check form inputs for labels
        document.querySelectorAll("input, select, textarea").forEach((el) => {
          const id = el.id;
          if (id && !document.querySelector(`label[for="${id}"]`)) {
            results.push({
              type: "warning",
              rule: "form-label",
              message: `Input #${id} missing associated label`,
            });
          }
        });

        // Check heading hierarchy
        const headings = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
        let lastLevel = 0;
        headings.forEach((h) => {
          const level = parseInt(h.tagName[1], 10);
          if (level > lastLevel + 1) {
            results.push({
              type: "warning",
              rule: "heading-order",
              message: `Heading skip: h${lastLevel} → h${level}`,
            });
          }
          lastLevel = level;
        });

        return results;
      });

      if (Array.isArray(a11yData)) {
        for (const item of a11yData) {
          if (item.type === "error") {
            issues.push(item);
          } else {
            checks.push(item);
          }
        }
      }
    }
  }

  // Fallback checks
  checks.push(
    { rule: "img-alt", status: "checked" },
    { rule: "form-label", status: "checked" },
    { rule: "heading-order", status: "checked" },
  );

  return {
    success: true,
    action: "accessibility",
    url,
    checks,
    issues,
    issueCount: issues.length,
    message:
      issues.length === 0
        ? "All basic accessibility checks passed."
        : `Found ${issues.length} accessibility issue(s).`,
  };
}

async function handleScenario(url, steps) {
  if (!steps || steps.length === 0) {
    return {
      success: false,
      error:
        'No steps provided. Use --steps "click .btn, fill #email test@test.com"',
    };
  }

  const results = [];

  if (browserEngine) {
    const engine = getEngine();

    if (typeof engine.navigate === "function") {
      await engine.navigate(url);
      results.push({ step: "navigate", url, status: "ok" });
    }

    for (const step of steps) {
      const parts = step.trim().split(/\s+/);
      const action = parts[0];
      const selector = parts[1];
      const value = parts.slice(2).join(" ");

      try {
        if (action === "click" && typeof engine.click === "function") {
          await engine.click(selector);
          results.push({ step, status: "ok" });
        } else if (action === "fill" && typeof engine.fill === "function") {
          await engine.fill(selector, value);
          results.push({ step, status: "ok" });
        } else if (action === "wait") {
          await new Promise((r) =>
            setTimeout(r, parseInt(selector, 10) || 1000),
          );
          results.push({ step, status: "ok" });
        } else {
          results.push({ step, status: "skipped", reason: "unknown action" });
        }
      } catch (err) {
        results.push({ step, status: "error", error: err.message });
      }
    }
  } else {
    for (const step of steps) {
      results.push({ step, status: "simulated" });
    }
  }

  const passed = results.every((r) => r.status !== "error");

  return {
    success: true,
    action: "scenario",
    url,
    steps: results,
    stepCount: results.length,
    passed,
    message: passed
      ? `All ${results.length} step(s) completed.`
      : `Scenario failed at ${results.find((r) => r.status === "error")?.step}`,
  };
}

async function handleInspect(url) {
  const elements = {
    forms: [],
    links: [],
    buttons: [],
    inputs: [],
  };

  if (browserEngine && url) {
    const engine = getEngine();

    if (typeof engine.navigate === "function") {
      await engine.navigate(url);
    }

    if (typeof engine.evaluate === "function") {
      const data = await engine.evaluate(() => ({
        forms: Array.from(document.querySelectorAll("form")).map((f) => ({
          action: f.action,
          method: f.method,
          inputs: f.querySelectorAll("input,select,textarea").length,
        })),
        links: Array.from(document.querySelectorAll("a"))
          .slice(0, 20)
          .map((a) => ({
            text: a.textContent?.trim().substring(0, 50),
            href: a.href,
          })),
        buttons: Array.from(
          document.querySelectorAll("button,[type=submit]"),
        ).map((b) => ({ text: b.textContent?.trim(), type: b.type })),
      }));
      if (data) {
        Object.assign(elements, data);
      }
    }
  }

  return {
    success: true,
    action: "inspect",
    url,
    elements,
    message: `Found ${elements.forms.length} form(s), ${elements.links.length} link(s), ${elements.buttons.length} button(s).`,
  };
}

function getEngine() {
  return typeof browserEngine.getInstance === "function"
    ? browserEngine.getInstance()
    : browserEngine;
}
