/**
 * Browser automation commands
 * chainlesschain browse <url> | browse scrape <url> | browse screenshot <url>
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import {
  fetchPage,
  extractText,
  extractTitle,
  extractMeta,
  querySelectorAll,
  extractLinks,
  takeScreenshot,
} from "../lib/browser-automation.js";

export function registerBrowseCommand(program) {
  const browse = program
    .command("browse")
    .description("Headless browser automation and web scraping");

  // browse fetch — fetch and display page content
  browse
    .command("fetch")
    .description("Fetch a URL and display text content")
    .argument("<url>", "URL to fetch")
    .option("--html", "Show raw HTML instead of text")
    .option("--links", "Extract links only")
    .option("--json", "Output as JSON")
    .action(async (url, options) => {
      try {
        const spinner = ora(`Fetching ${url}...`).start();
        const result = await fetchPage(url);
        spinner.stop();

        const title = extractTitle(result.html);
        const text = extractText(result.html);
        const description = extractMeta(result.html);

        if (options.json) {
          const output = {
            url: result.url,
            status: result.status,
            title,
            description,
            size: result.size,
          };
          if (options.html) output.html = result.html;
          else if (options.links)
            output.links = extractLinks(result.html, result.url);
          else output.text = text;
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        if (options.links) {
          const links = extractLinks(result.html, result.url);
          logger.log(
            chalk.bold(`Links from ${title || url} (${links.length}):\n`),
          );
          for (const link of links.slice(0, 50)) {
            logger.log(
              `  ${chalk.cyan(link.text.substring(0, 60).padEnd(62))} ${chalk.gray(link.href)}`,
            );
          }
          if (links.length > 50)
            logger.log(chalk.gray(`  ... and ${links.length - 50} more`));
          return;
        }

        if (options.html) {
          console.log(result.html);
          return;
        }

        logger.log(chalk.bold(title || url));
        if (description) logger.log(chalk.gray(description));
        logger.log(
          chalk.gray(`${result.size} bytes | ${result.contentType}\n`),
        );
        logger.log(text.substring(0, 5000));
        if (text.length > 5000) {
          logger.log(
            chalk.gray(`\n... truncated (${text.length} chars total)`),
          );
        }
      } catch (err) {
        logger.error(`Fetch failed: ${err.message}`);
        process.exit(1);
      }
    });

  // browse scrape — scrape elements matching a CSS selector
  browse
    .command("scrape")
    .description("Scrape elements from a URL using CSS selector")
    .argument("<url>", "URL to scrape")
    .requiredOption("-s, --selector <css>", "CSS selector (tag, .class, #id)")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (url, options) => {
      try {
        const spinner = ora(`Scraping ${url}...`).start();
        const result = await fetchPage(url);
        const elements = querySelectorAll(result.html, options.selector);
        spinner.stop();

        const limit = parseInt(options.limit) || 20;
        const limited = elements.slice(0, limit);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                url: result.url,
                selector: options.selector,
                count: elements.length,
                results: limited.map((e) => ({ text: e.text })),
              },
              null,
              2,
            ),
          );
          return;
        }

        if (elements.length === 0) {
          logger.info(`No elements matching "${options.selector}"`);
        } else {
          logger.log(
            chalk.bold(
              `Scraped ${elements.length} elements matching "${options.selector}":\n`,
            ),
          );
          for (let i = 0; i < limited.length; i++) {
            const text = limited[i].text.substring(0, 200).replace(/\n/g, " ");
            logger.log(`  ${chalk.gray(`[${i + 1}]`)} ${text}`);
          }
          if (elements.length > limit) {
            logger.log(chalk.gray(`  ... ${elements.length - limit} more`));
          }
        }
      } catch (err) {
        logger.error(`Scrape failed: ${err.message}`);
        process.exit(1);
      }
    });

  // browse screenshot — take a screenshot (requires playwright)
  browse
    .command("screenshot")
    .description("Take a screenshot of a URL (requires playwright)")
    .argument("<url>", "URL to screenshot")
    .option("-o, --output <path>", "Output file path", "screenshot.png")
    .option("--width <n>", "Viewport width", "1280")
    .option("--height <n>", "Viewport height", "720")
    .option("--full-page", "Capture full page")
    .option("--json", "Output as JSON")
    .action(async (url, options) => {
      try {
        const spinner = ora(`Taking screenshot of ${url}...`).start();
        const result = await takeScreenshot(url, options.output, {
          width: parseInt(options.width),
          height: parseInt(options.height),
          fullPage: !!options.fullPage,
        });
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          logger.success(`Screenshot saved: ${chalk.cyan(result.path)}`);
        } else {
          logger.error(result.error);
          logger.info("Install playwright: npm install -g playwright");
        }
      } catch (err) {
        logger.error(`Screenshot failed: ${err.message}`);
        process.exit(1);
      }
    });

  registerBrowseV2Command(browse);
}

import {
  BROWSE_TARGET_MATURITY_V2,
  BROWSE_ACTION_LIFECYCLE_V2,
  registerBrowseTargetV2,
  activateBrowseTargetV2,
  degradeBrowseTargetV2,
  retireBrowseTargetV2,
  touchBrowseTargetV2,
  getBrowseTargetV2,
  listBrowseTargetsV2,
  createBrowseActionV2,
  startBrowseActionV2,
  completeBrowseActionV2,
  failBrowseActionV2,
  cancelBrowseActionV2,
  getBrowseActionV2,
  listBrowseActionsV2,
  setMaxActiveBrowseTargetsPerOwnerV2,
  getMaxActiveBrowseTargetsPerOwnerV2,
  setMaxPendingBrowseActionsPerTargetV2,
  getMaxPendingBrowseActionsPerTargetV2,
  setBrowseTargetIdleMsV2,
  getBrowseTargetIdleMsV2,
  setBrowseActionStuckMsV2,
  getBrowseActionStuckMsV2,
  autoDegradeIdleBrowseTargetsV2,
  autoFailStuckBrowseActionsV2,
  getBrowserAutomationStatsV2,
} from "../lib/browser-automation.js";

export function registerBrowseV2Command(browse) {
  browse
    .command("enums-v2")
    .description("Show V2 enums")
    .action(() => {
      console.log(
        JSON.stringify(
          { BROWSE_TARGET_MATURITY_V2, BROWSE_ACTION_LIFECYCLE_V2 },
          null,
          2,
        ),
      );
    });
  browse
    .command("register-target-v2")
    .description("Register a browse target (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--url <url>")
    .action((o) => {
      console.log(JSON.stringify(registerBrowseTargetV2(o), null, 2));
    });
  browse
    .command("activate-target-v2 <id>")
    .description("Activate target")
    .action((id) => {
      console.log(JSON.stringify(activateBrowseTargetV2(id), null, 2));
    });
  browse
    .command("degrade-target-v2 <id>")
    .description("Degrade target")
    .action((id) => {
      console.log(JSON.stringify(degradeBrowseTargetV2(id), null, 2));
    });
  browse
    .command("retire-target-v2 <id>")
    .description("Retire target (terminal)")
    .action((id) => {
      console.log(JSON.stringify(retireBrowseTargetV2(id), null, 2));
    });
  browse
    .command("touch-target-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) => {
      console.log(JSON.stringify(touchBrowseTargetV2(id), null, 2));
    });
  browse
    .command("get-target-v2 <id>")
    .description("Get a target")
    .action((id) => {
      console.log(JSON.stringify(getBrowseTargetV2(id), null, 2));
    });
  browse
    .command("list-targets-v2")
    .description("List targets")
    .action(() => {
      console.log(JSON.stringify(listBrowseTargetsV2(), null, 2));
    });
  browse
    .command("create-action-v2")
    .description("Create a browse action (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--target-id <targetId>")
    .option("--kind <kind>", "fetch/scrape/screenshot", "fetch")
    .action((o) => {
      console.log(
        JSON.stringify(
          createBrowseActionV2({
            id: o.id,
            targetId: o.targetId,
            kind: o.kind,
          }),
          null,
          2,
        ),
      );
    });
  browse
    .command("start-action-v2 <id>")
    .description("Start action")
    .action((id) => {
      console.log(JSON.stringify(startBrowseActionV2(id), null, 2));
    });
  browse
    .command("complete-action-v2 <id>")
    .description("Complete action")
    .action((id) => {
      console.log(JSON.stringify(completeBrowseActionV2(id), null, 2));
    });
  browse
    .command("fail-action-v2 <id>")
    .description("Fail action")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(failBrowseActionV2(id, o.reason), null, 2));
    });
  browse
    .command("cancel-action-v2 <id>")
    .description("Cancel action")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(cancelBrowseActionV2(id, o.reason), null, 2));
    });
  browse
    .command("get-action-v2 <id>")
    .description("Get action")
    .action((id) => {
      console.log(JSON.stringify(getBrowseActionV2(id), null, 2));
    });
  browse
    .command("list-actions-v2")
    .description("List actions")
    .action(() => {
      console.log(JSON.stringify(listBrowseActionsV2(), null, 2));
    });
  browse
    .command("set-max-active-targets-v2 <n>")
    .description("Set per-owner active cap")
    .action((n) => {
      setMaxActiveBrowseTargetsPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxActiveBrowseTargetsPerOwner:
              getMaxActiveBrowseTargetsPerOwnerV2(),
          },
          null,
          2,
        ),
      );
    });
  browse
    .command("set-max-pending-actions-v2 <n>")
    .description("Set per-target pending cap")
    .action((n) => {
      setMaxPendingBrowseActionsPerTargetV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxPendingBrowseActionsPerTarget:
              getMaxPendingBrowseActionsPerTargetV2(),
          },
          null,
          2,
        ),
      );
    });
  browse
    .command("set-target-idle-ms-v2 <n>")
    .description("Set idle threshold")
    .action((n) => {
      setBrowseTargetIdleMsV2(Number(n));
      console.log(
        JSON.stringify(
          { browseTargetIdleMs: getBrowseTargetIdleMsV2() },
          null,
          2,
        ),
      );
    });
  browse
    .command("set-action-stuck-ms-v2 <n>")
    .description("Set stuck threshold")
    .action((n) => {
      setBrowseActionStuckMsV2(Number(n));
      console.log(
        JSON.stringify(
          { browseActionStuckMs: getBrowseActionStuckMsV2() },
          null,
          2,
        ),
      );
    });
  browse
    .command("auto-degrade-idle-targets-v2")
    .description("Auto-degrade idle targets")
    .action(() => {
      console.log(JSON.stringify(autoDegradeIdleBrowseTargetsV2(), null, 2));
    });
  browse
    .command("auto-fail-stuck-actions-v2")
    .description("Auto-fail stuck actions")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckBrowseActionsV2(), null, 2));
    });
  browse
    .command("stats-v2")
    .description("V2 aggregate stats")
    .action(() => {
      console.log(JSON.stringify(getBrowserAutomationStatsV2(), null, 2));
    });
}
