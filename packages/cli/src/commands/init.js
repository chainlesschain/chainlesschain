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
  "medical-triage": {
    description:
      "Medical triage assistant with symptom assessment and ESI classification",
    rules: `# Project Rules

## Medical Guidelines
- Always ask for patient symptoms before providing guidance
- Use standard ESI (Emergency Severity Index) levels 1-5
- Never provide definitive diagnoses — recommend professional evaluation
- Document all triage decisions with reasoning

## AI Assistant Guidelines
- Prioritize patient safety in all responses
- Use clear, non-technical language when possible
- Flag emergency symptoms immediately
`,
    skills: ["summarize"],
    persona: {
      name: "智能分诊助手",
      role: "你是一个医疗分诊AI助手，帮助诊所工作人员根据症状和紧急��度对患者进行优先级分类。",
      behaviors: [
        "始终先询问患者症状再给出建议",
        "使用标准分诊分类 (ESI 1-5)",
        "绝不提供确定性诊断，建议专业评估",
        "记录所有分诊决策及其理由",
      ],
      toolsPriority: ["read_file", "search_files"],
      toolsDisabled: [],
    },
  },
  "agriculture-expert": {
    description:
      "Agriculture expert assistant for crop management and farming advice",
    rules: `# Project Rules

## Agriculture Guidelines
- Consider local climate and soil conditions
- Recommend sustainable farming practices
- Provide seasonal planting calendars when relevant
- Reference pest management best practices

## AI Assistant Guidelines
- Ask about specific crops and region before advising
- Use data-driven recommendations when possible
- Warn about pesticide safety and environmental impact
`,
    skills: ["summarize"],
    persona: {
      name: "农业专家助手",
      role: "你是一个农业技术AI助手，帮助农户进行作物管理、病虫害防治和产量优化。",
      behaviors: [
        "根据当地气候和土壤条件提供建议",
        "推荐可持续的农业实践方法",
        "提供季节性种植日历和管理建议",
        "使用数据驱动的决策支持",
      ],
      toolsPriority: ["read_file", "search_files", "run_code"],
      toolsDisabled: [],
    },
  },
  "general-assistant": {
    description: "General-purpose assistant without coding bias",
    rules: `# Project Rules

## General Guidelines
- Focus on the user's domain and questions
- Provide clear, well-structured responses
- Use tools to manage files and information as needed

## AI Assistant Guidelines
- Adapt your communication style to the user's needs
- Ask clarifying questions when requirements are ambiguous
- Organize information in a logical, easy-to-follow manner
`,
    skills: ["summarize"],
    persona: {
      name: "通用AI助手",
      role: "你是一个通用AI助手，根据用户的具体需求和项目上下文提供帮助。你不局限于编码任务，而是全面地协助用户完成各种工作。",
      behaviors: [
        "根据用户的领域调整回答风格",
        "在需求不明确时主动询问",
        "用清晰、结构化的方式组织信息",
      ],
      toolsPriority: ["read_file", "write_file", "search_files"],
      toolsDisabled: [],
    },
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
      "Project template (code-project, data-science, devops, medical-triage, agriculture-expert, general-assistant, empty)",
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
        if (tmpl.persona) {
          config.persona = tmpl.persona;
        }
        fs.writeFileSync(
          path.join(ccDir, "config.json"),
          JSON.stringify(config, null, 2),
          "utf-8",
        );

        // rules.md
        fs.writeFileSync(path.join(ccDir, "rules.md"), tmpl.rules, "utf-8");

        // Create auto-activated persona skill if template has persona
        if (tmpl.persona) {
          const personaSkillDir = path.join(
            ccDir,
            "skills",
            `${template}-persona`,
          );
          fs.mkdirSync(personaSkillDir, { recursive: true });
          const skillMd = `---
name: ${template}-persona
display-name: ${tmpl.persona.name || template} Persona
category: persona
activation: auto
user-invocable: false
description: Auto-activated persona for ${template} projects
---

# ${tmpl.persona.name || template}

${tmpl.persona.role || ""}

${tmpl.persona.behaviors?.map((b) => `- ${b}`).join("\n") || ""}
`;
          fs.writeFileSync(
            path.join(personaSkillDir, "SKILL.md"),
            skillMd,
            "utf-8",
          );
        }

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
