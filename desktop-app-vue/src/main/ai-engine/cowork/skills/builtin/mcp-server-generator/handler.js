/**
 * MCP Server Generator Skill Handler
 *
 * Generates MCP server boilerplate code using the MCPServerBuilder SDK.
 * Supports stdio and HTTP+SSE transports with auth configuration.
 */

const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[MCPServerGenerator] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { description, options } = parseInput(input);

    logger.info(`[MCPServerGenerator] Generating: ${description}`, { options });

    try {
      if (!description) {
        return {
          success: false,
          message:
            "Usage: /mcp-server-generator '<description>' [--transport stdio|http] [--auth none|bearer|api-key]",
        };
      }

      return generateMCPServer(description, options);
    } catch (error) {
      logger.error(`[MCPServerGenerator] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `MCP server generation failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input) {
  const options = { transport: "stdio", auth: "none", output: null };

  // Extract quoted description
  let description = "";
  const quotedMatch = input.match(/['"]([^'"]+)['"]/);
  if (quotedMatch) {
    description = quotedMatch[1];
  } else {
    // Take first non-flag argument
    const parts = input.split(/\s+/);
    const descParts = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("--")) {
        i++; // skip value
      } else {
        descParts.push(parts[i]);
      }
    }
    description = descParts.join(" ").trim();
  }

  // Parse flags
  const transportMatch = input.match(/--transport\s+(\w+)/);
  if (transportMatch) {
    options.transport = transportMatch[1];
  }

  const authMatch = input.match(/--auth\s+([\w-]+)/);
  if (authMatch) {
    options.auth = authMatch[1];
  }

  const outputMatch = input.match(/--output\s+(\S+)/);
  if (outputMatch) {
    options.output = outputMatch[1];
  }

  return { description, options };
}

function inferTools(description) {
  const tools = [];
  const desc = description.toLowerCase();

  // Common CRUD patterns
  const crudTargets =
    desc.match(
      /(?:manage|query|read|write|create|update|delete|list|get|search|monitor)\s+(\w+)/g,
    ) || [];

  for (const match of crudTargets) {
    const parts = match.split(/\s+/);
    const action = parts[0];
    const target = parts.slice(1).join("_");

    switch (action) {
      case "list":
        tools.push({
          name: `list_${target}`,
          description: `List all ${target}`,
          params: {},
        });
        break;
      case "get":
      case "read":
      case "query":
        tools.push({
          name: `get_${target}`,
          description: `Get ${target} by ID`,
          params: { id: { type: "string", required: true } },
        });
        break;
      case "create":
      case "write":
        tools.push({
          name: `create_${target}`,
          description: `Create a new ${target}`,
          params: { data: { type: "object", required: true } },
        });
        break;
      case "update":
        tools.push({
          name: `update_${target}`,
          description: `Update an existing ${target}`,
          params: {
            id: { type: "string", required: true },
            data: { type: "object", required: true },
          },
        });
        break;
      case "delete":
        tools.push({
          name: `delete_${target}`,
          description: `Delete ${target}`,
          params: { id: { type: "string", required: true } },
        });
        break;
      case "search":
        tools.push({
          name: `search_${target}`,
          description: `Search ${target}`,
          params: { query: { type: "string", required: true } },
        });
        break;
      case "manage":
        tools.push(
          {
            name: `list_${target}`,
            description: `List all ${target}`,
            params: {},
          },
          {
            name: `get_${target}`,
            description: `Get ${target} by ID`,
            params: { id: { type: "string", required: true } },
          },
          {
            name: `create_${target}`,
            description: `Create a new ${target}`,
            params: { data: { type: "object", required: true } },
          },
        );
        break;
      case "monitor":
        tools.push(
          {
            name: `get_${target}_status`,
            description: `Get ${target} status`,
            params: {},
          },
          { name: `list_${target}`, description: `List ${target}`, params: {} },
        );
        break;
    }
  }

  // Deduplicate by name
  const seen = new Set();
  return tools.filter((t) => {
    if (seen.has(t.name)) {
      return false;
    }
    seen.add(t.name);
    return true;
  });
}

function inferServerName(description) {
  // Extract key nouns for the server name
  const keywords = description
    .toLowerCase()
    .replace(/(?:an?\s+)?mcp\s+server\s+(?:that|for|to)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-");

  return `mcp-server-${keywords || "custom"}`;
}

function generateMCPServer(description, options) {
  const serverName = inferServerName(description);
  const tools = inferTools(description);

  if (tools.length === 0) {
    // Fallback: generate a basic tool
    tools.push({
      name: "execute",
      description: `Execute action based on: ${description}`,
      params: { input: { type: "string", required: true } },
    });
  }

  const camelName = serverName
    .replace(/-(\w)/g, (_, c) => c.toUpperCase())
    .replace(/^mcp-server-/, "");

  // Generate index.js
  const indexJs = `/**
 * ${serverName}
 * Generated by MCP Server Generator
 * Description: ${description}
 */

const { MCPServerBuilder } = require('@chainlesschain/mcp-sdk');

const server = new MCPServerBuilder()
  .name('${camelName}')
  .description('${description}')
  .version('1.0.0')
${tools
  .map((t) => {
    const paramsStr =
      Object.keys(t.params).length > 0
        ? JSON.stringify(t.params, null, 4)
            .split("\n")
            .map((l, i) => (i === 0 ? l : "      " + l))
            .join("\n")
        : "{}";
    return `  .tool('${t.name}', {
    description: '${t.description}',
    parameters: ${paramsStr},
    handler: async (${Object.keys(t.params).length > 0 ? "params" : ""}) => {
      // TODO: Implement ${t.name}
      return { success: true, data: {} };
    },
  })`;
  })
  .join("\n")}
  .transport('${options.transport}')${options.auth !== "none" ? `\n  .auth('${options.auth}')` : ""}
  .build();

server.start();
console.error('${serverName} started (${options.transport})');
`;

  // Generate package.json
  const packageJson = `{
  "name": "${serverName}",
  "version": "1.0.0",
  "description": "${description}",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@chainlesschain/mcp-sdk": "^0.34.0"
  }
}
`;

  // Generate config.json
  const configJson = `{
  "transport": "${options.transport}",
  "auth": "${options.auth}"${options.transport === "http" ? ',\n  "port": 3100,\n  "cors": true' : ""}
}
`;

  // Generate README.md
  const readmeMd = `# ${serverName}

${description}

## Tools

${tools.map((t) => `- \`${t.name}\` - ${t.description}`).join("\n")}

## Setup

\`\`\`bash
npm install
npm start
\`\`\`

## Transport

- Type: ${options.transport}
- Auth: ${options.auth}
`;

  const files = [
    { path: `${serverName}/index.js`, content: indexJs },
    { path: `${serverName}/package.json`, content: packageJson },
    { path: `${serverName}/config.json`, content: configJson },
    { path: `${serverName}/README.md`, content: readmeMd },
  ];

  const report =
    `MCP Server Generated: ${serverName}\n${"=".repeat(40)}\n\n` +
    `Description: ${description}\n` +
    `Transport: ${options.transport}\n` +
    `Auth: ${options.auth}\n` +
    `Tools: ${tools.length}\n\n` +
    `Generated files:\n` +
    files
      .map((f) => `  ${f.path} (${f.content.split("\n").length} lines)`)
      .join("\n") +
    `\n\nTools:\n` +
    tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n") +
    `\n\nindex.js preview:\n\`\`\`javascript\n${indexJs.substring(0, 600)}...\n\`\`\`` +
    `\n\nNote: Preview only. Copy to target directory to use.`;

  return {
    success: true,
    result: {
      serverName,
      tools: tools.length,
      files: files.map((f) => f.path),
    },
    generatedFiles: files,
    message: report,
  };
}
