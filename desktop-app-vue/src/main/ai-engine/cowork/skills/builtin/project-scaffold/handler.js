/**
 * Project Scaffold Skill Handler
 *
 * Generates boilerplate code for new skills, Vue pages, IPC modules,
 * following established project conventions.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[ProjectScaffold] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[ProjectScaffold] Action: ${action}`, { options });

    try {
      switch (action) {
        case "skill":
          return handleScaffoldSkill(options);
        case "page":
          return handleScaffoldPage(options);
        case "ipc-module":
          return handleScaffoldIPC(options);
        default:
          return {
            success: false,
            message:
              "Usage: /project-scaffold <skill|page|ipc-module> <name> [options]",
          };
      }
    } catch (error) {
      logger.error(`[ProjectScaffold] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Scaffold failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    name: null,
    category: "general",
    withHandler: false,
    withStore: false,
    route: null,
    handlers: 3,
    workspacePath: context.workspacePath || process.cwd(),
  };
  let action = null;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "skill" || p === "page" || p === "ipc-module") {
      action = p;
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) {
        options.name = parts[++i].replace(/['"]/g, "");
      }
    } else if (p === "--category") {
      options.category = parts[++i];
    } else if (p === "--with-handler") {
      options.withHandler = true;
    } else if (p === "--store") {
      options.withStore = true;
    } else if (p === "--route") {
      options.route = parts[++i];
    } else if (p === "--handlers") {
      options.handlers = parseInt(parts[++i]) || 3;
    } else if (!action && !p.startsWith("-")) {
      action = p;
    }
  }

  return { action, options };
}

function handleScaffoldSkill(options) {
  if (!options.name) {
    return {
      success: false,
      message:
        "Usage: /project-scaffold skill <name> [--category <cat>] [--with-handler]",
    };
  }

  const name = options.name;
  const displayName = name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const skillMd = `---
name: ${name}
display-name: ${displayName}
description: ${displayName} skill
version: 1.0.0
category: ${options.category}
user-invocable: true
tags: [${name}]
capabilities: [${name}]
tools:
  - file_reader
  - file_writer
${options.withHandler ? "handler: ./handler.js" : ""}instructions: |
  Use this skill when the user wants to ${name.replace(/-/g, " ")}.
  Provide clear, actionable results.
examples:
  - input: "/${name} --help"
    output: "Available commands: ..."
os: [win32, darwin, linux]
author: ChainlessChain
---

# ${displayName}

## Description

TODO: Add skill description.

## Usage

\`\`\`
/${name} [options]
\`\`\`

## Examples

\`\`\`
/${name} --help
\`\`\`
`;

  const files = [{ path: `builtin/${name}/SKILL.md`, content: skillMd }];

  if (options.withHandler) {
    const handlerJs = `/**
 * ${displayName} Skill Handler
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[${displayName.replace(/\s/g, "")}] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";

    logger.info(\`[${displayName.replace(/\s/g, "")}] Execute: \${input}\`);

    try {
      return {
        success: true,
        result: {},
        message: "${displayName} executed successfully.",
      };
    } catch (error) {
      logger.error(\`[${displayName.replace(/\s/g, "")}] Error: \${error.message}\`);
      return { success: false, error: error.message, message: \`${displayName} failed: \${error.message}\` };
    }
  },
};
`;
    files.push({ path: `builtin/${name}/handler.js`, content: handlerJs });
  }

  const report =
    `Skill Scaffold: ${name}\n${"=".repeat(30)}\n\n` +
    `Generated files:\n` +
    files
      .map((f) => `  ${f.path} (${f.content.split("\n").length} lines)`)
      .join("\n") +
    `\n\nSKILL.md content:\n\`\`\`yaml\n${skillMd.substring(0, 500)}...\n\`\`\`` +
    (options.withHandler
      ? `\n\nhandler.js content:\n\`\`\`javascript\n${files[1].content.substring(0, 400)}...\n\`\`\``
      : "") +
    `\n\nNote: Preview only. Copy to the appropriate directory to activate.`;

  return {
    success: true,
    result: {
      name,
      files: files.map((f) => ({
        path: f.path,
        lines: f.content.split("\n").length,
      })),
    },
    generatedFiles: files,
    message: report,
  };
}

function handleScaffoldPage(options) {
  if (!options.name) {
    return {
      success: false,
      message:
        "Usage: /project-scaffold page <name> [--store] [--route <path>]",
    };
  }

  const name = options.name;
  const pascalName = name.replace(/(^|[-_])(\w)/g, (_, __, c) =>
    c.toUpperCase(),
  );
  const kebabName = name
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
  const routePath = options.route || `/${kebabName}`;

  const vuePage = `<template>
  <div class="${kebabName}-page">
    <a-page-header title="${pascalName}" sub-title="TODO: Add description" />

    <a-card>
      <p>TODO: Implement ${pascalName} page content</p>
    </a-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
${options.withStore ? `import { use${pascalName}Store } from '../stores/${kebabName}';` : ""}

${options.withStore ? `const store = use${pascalName}Store();` : ""}

onMounted(() => {
  // TODO: Initialize page
});
</script>

<style scoped>
.${kebabName}-page {
  padding: 16px;
}
</style>
`;

  const files = [{ path: `pages/${pascalName}Page.vue`, content: vuePage }];

  if (options.withStore) {
    const store = `import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const use${pascalName}Store = defineStore('${kebabName}', () => {
  // State
  const loading = ref(false);
  const data = ref<any[]>([]);
  const error = ref<string | null>(null);

  // Getters
  const isEmpty = computed(() => data.value.length === 0);

  // Actions
  async function fetchData() {
    loading.value = true;
    error.value = null;
    try {
      // TODO: Implement data fetching
      // const result = await window.electronAPI.invoke('${kebabName}:get-all');
      // data.value = result;
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  return { loading, data, error, isEmpty, fetchData };
});
`;
    files.push({ path: `stores/${kebabName}.ts`, content: store });
  }

  const routerEntry = `  {\n    path: '${routePath}',\n    name: '${pascalName}',\n    component: () => import('../pages/${pascalName}Page.vue'),\n  },`;

  const report =
    `Page Scaffold: ${pascalName}\n${"=".repeat(30)}\n\n` +
    `Generated files:\n` +
    files
      .map((f) => `  ${f.path} (${f.content.split("\n").length} lines)`)
      .join("\n") +
    `\n\nRouter entry to add:\n\`\`\`javascript\n${routerEntry}\n\`\`\`` +
    `\n\nNote: Preview only. Copy to the appropriate directory and add router entry.`;

  return {
    success: true,
    result: {
      name: pascalName,
      files: files.map((f) => ({
        path: f.path,
        lines: f.content.split("\n").length,
      })),
      routerEntry,
    },
    generatedFiles: files,
    message: report,
  };
}

function handleScaffoldIPC(options) {
  if (!options.name) {
    return {
      success: false,
      message: "Usage: /project-scaffold ipc-module <name> [--handlers <n>]",
    };
  }

  const name = options.name;
  const camelName = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const pascalName = camelName.charAt(0).toUpperCase() + camelName.slice(1);
  const prefix = name.replace(/-/g, "");
  const handlerCount = options.handlers;

  // Main module
  const mainModule = `/**
 * ${pascalName}
 *
 * TODO: Add module description.
 */

const { logger } = require('../utils/logger.js');

class ${pascalName} {
  constructor() {
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;
    logger.info('[${pascalName}] Initializing...');
    this._initialized = true;
    logger.info('[${pascalName}] Initialized');
  }

${Array.from({ length: handlerCount }, (_, i) => {
  const method = i === 0 ? "getAll" : i === 1 ? "getById" : `action${i + 1}`;
  return `  async ${method}(${i === 1 ? "id" : "params = {}"}) {
    // TODO: Implement
    return { success: true };
  }`;
}).join("\n\n")}
}

module.exports = { ${pascalName} };
`;

  // IPC module
  const ipcModule = `/**
 * ${pascalName} IPC Handlers
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

function register${pascalName}IPC(${camelName}) {
${Array.from({ length: handlerCount }, (_, i) => {
  const channel =
    i === 0 ? "get-all" : i === 1 ? "get-by-id" : `action-${i + 1}`;
  const method = i === 0 ? "getAll" : i === 1 ? "getById" : `action${i + 1}`;
  const paramStr = i === 1 ? ", id" : i === 0 ? "" : ", params";
  return `  ipcMain.handle('${prefix}:${channel}', async (event${paramStr}) => {
    try {
      return await ${camelName}.${method}(${i === 1 ? "id" : i === 0 ? "" : "params"});
    } catch (error) {
      logger.error('[${pascalName}IPC] ${channel} failed:', error.message);
      return { success: false, error: error.message };
    }
  });`;
}).join("\n\n")}

  logger.info('[${pascalName}IPC] ${handlerCount} handlers registered');
}

module.exports = { register${pascalName}IPC };
`;

  const files = [
    { path: `src/main/${name}/${name}.js`, content: mainModule },
    { path: `src/main/${name}/${name}-ipc.js`, content: ipcModule },
  ];

  const registryEntry = `// In ipc-registry.js:\nconst { ${pascalName} } = require('../${name}/${name}.js');\nconst { register${pascalName}IPC } = require('../${name}/${name}-ipc.js');\nconst ${camelName} = new ${pascalName}();\nawait ${camelName}.initialize();\nregister${pascalName}IPC(${camelName});`;

  const report =
    `IPC Module Scaffold: ${name}\n${"=".repeat(30)}\n\n` +
    `Generated files:\n` +
    files
      .map((f) => `  ${f.path} (${f.content.split("\n").length} lines)`)
      .join("\n") +
    `\n\nRegistration entry:\n\`\`\`javascript\n${registryEntry}\n\`\`\`` +
    `\n\nIPC channels: ${Array.from({ length: handlerCount }, (_, i) => `${prefix}:${i === 0 ? "get-all" : i === 1 ? "get-by-id" : `action-${i + 1}`}`).join(", ")}` +
    `\n\nNote: Preview only. Copy to the appropriate directory and register in ipc-registry.js.`;

  return {
    success: true,
    result: {
      name,
      files: files.map((f) => ({
        path: f.path,
        lines: f.content.split("\n").length,
      })),
      registryEntry,
    },
    generatedFiles: files,
    message: report,
  };
}
