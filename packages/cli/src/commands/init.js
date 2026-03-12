/**
 * Project initialization command
 * chainlesschain init [--template <name>] [--yes] [--bare]
 *
 * Creates .chainlesschain/ project structure in the current directory.
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import { isInsideProject, findProjectRoot } from "../lib/project-detector.js";

const TEMPLATES = {
  "code-project": {
    description:
      "Software development project with code review and refactoring skills",
    rules: `# Project Rules

## Code Style
- Follow the project's existing code style
- Use meaningful variable and function names
- Keep functions small and focused

## AI Assistant Guidelines
- Prefer editing existing files over creating new ones
- Run tests after making changes
- Use code-review skill before committing
`,
    skills: ["code-review", "refactor", "unit-test", "debug"],
  },
  "data-science": {
    description:
      "Data science / ML project with analysis and visualization skills",
    rules: `# Project Rules

## Data Handling
- Never commit raw data files
- Document data transformations
- Use reproducible random seeds

## AI Assistant Guidelines
- Use data-analysis skill for exploration
- Document findings in markdown
- Validate results before reporting
`,
    skills: ["data-analysis", "summarize", "explain-code"],
  },
  devops: {
    description:
      "DevOps / infrastructure project with deployment and monitoring skills",
    rules: `# Project Rules

## Infrastructure
- Use infrastructure as code
- Tag all resources appropriately
- Follow least-privilege principle

## AI Assistant Guidelines
- Always validate configs before applying
- Use dry-run when available
- Document infrastructure changes
`,
    skills: ["debug", "summarize", "code-review"],
  },
  empty: {
    description: "Bare project with minimal configuration",
    rules: `# Project Rules

Add your project-specific rules and conventions here.
The AI assistant will follow these guidelines when working in this project.
`,
    skills: [],
  },
};

export function registerInitCommand(program) {
  program
    .command("init")
    .description(
      "Initialize a .chainlesschain/ project in the current directory",
    )
    .option(
      "-t, --template <name>",
      "Project template (code-project, data-science, devops, empty)",
      "empty",
    )
    .option("-y, --yes", "Skip prompts, use defaults")
    .option(
      "--bare",
      "Create minimal structure (alias for --template empty --yes)",
    )
    .action(async (options) => {
      const cwd = process.cwd();
      const ccDir = path.join(cwd, ".chainlesschain");

      // Check if already initialized
      if (fs.existsSync(path.join(ccDir, "config.json"))) {
        const existingRoot = findProjectRoot(cwd);
        logger.error(
          `Already initialized at ${existingRoot || cwd}. Remove .chainlesschain/ to reinitialize.`,
        );
        process.exit(1);
      }

      // Determine template
      let template = options.bare ? "empty" : options.template;
      if (!TEMPLATES[template]) {
        logger.error(
          `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(", ")}`,
        );
        process.exit(1);
      }

      // Interactive selection if not --yes/--bare
      if (!options.yes && !options.bare) {
        try {
          const { select } = await import("@inquirer/prompts");
          template = await select({
            message: "Select a project template:",
            choices: Object.entries(TEMPLATES).map(([key, val]) => ({
              name: `${key} — ${val.description}`,
              value: key,
            })),
            default: template,
          });
        } catch {
          // Ctrl+C or non-interactive — use default
        }
      }

      const tmpl = TEMPLATES[template];
      const projectName = path.basename(cwd);

      // Create directory structure
      try {
        fs.mkdirSync(ccDir, { recursive: true });
        fs.mkdirSync(path.join(ccDir, "skills"), { recursive: true });

        // config.json
        const config = {
          name: projectName,
          template,
          version: "1.0.0",
          createdAt: new Date().toISOString(),
          skills: {
            workspace: "./skills",
          },
        };
        fs.writeFileSync(
          path.join(ccDir, "config.json"),
          JSON.stringify(config, null, 2),
          "utf-8",
        );

        // rules.md
        fs.writeFileSync(path.join(ccDir, "rules.md"), tmpl.rules, "utf-8");

        logger.success(
          `Initialized ChainlessChain project in ${chalk.cyan(cwd)}`,
        );
        logger.log("");
        logger.log(`  Template:  ${chalk.cyan(template)}`);
        logger.log(`  Config:    ${chalk.gray(".chainlesschain/config.json")}`);
        logger.log(`  Rules:     ${chalk.gray(".chainlesschain/rules.md")}`);
        logger.log(`  Skills:    ${chalk.gray(".chainlesschain/skills/")}`);
        logger.log("");
        logger.log(chalk.bold("Next steps:"));
        logger.log(
          `  ${chalk.cyan("chainlesschain skill add <name>")}  Create a custom project skill`,
        );
        logger.log(
          `  ${chalk.cyan("chainlesschain skill list")}        List all available skills`,
        );
        logger.log(
          `  ${chalk.cyan("chainlesschain agent")}             Start the AI agent`,
        );
        logger.log("");
      } catch (err) {
        logger.error(`Failed to initialize: ${err.message}`);
        process.exit(1);
      }
    });
}
