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
}
