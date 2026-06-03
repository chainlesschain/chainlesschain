/**
 * MCPSkillGenerator — Auto-generate SkillManifestEntry from MCP server connections
 *
 * When an MCP server connects, this generator creates a SkillManifestEntry
 * with Agent Skills metadata (instructions, examples, toolNames).
 *
 * @module MCPSkillGenerator
 */

const { logger } = require("../utils/logger.js");

class MCPSkillGenerator {
  /**
   * Generate a SkillManifestEntry from an MCP server
   * @param {string} serverName - MCP server name (e.g., "filesystem")
   * @param {Object|null} catalogEntry - Entry from BUILTIN_CATALOG (may have skillInstructions/skillExamples)
   * @param {Array} tools - Array of MCP tool objects { toolId, name, originalToolName, description, inputSchema }
   * @returns {Object} SkillManifestEntry
   */
  generateSkillFromMCPServer(serverName, catalogEntry, tools) {
    const toolNames = tools
      .map((t) => {
        const name =
          t.toolId ||
          t.name ||
          (t.originalToolName ? `mcp_${serverName}_${t.originalToolName}` : "");
        return name ? name.replace(/-/g, "_") : "";
      })
      .filter(Boolean);

    const displayName = catalogEntry?.displayName || `${serverName} (MCP)`;
    const category =
      catalogEntry?.skillCategory || catalogEntry?.category || "mcp";

    // Use catalog-provided instructions if available, otherwise auto-generate
    const instructions =
      catalogEntry?.skillInstructions ||
      this._generateInstructions(serverName, displayName, tools);

    // Use catalog-provided examples if available, otherwise auto-generate
    const examples =
      catalogEntry?.skillExamples || this._generateExamples(serverName, tools);

    const manifest = {
      name: `mcp-${serverName}`,
      displayName,
      description: catalogEntry?.description || `MCP server: ${serverName}`,
      category,
      instructions,
      examples,
      toolNames,
      source: "mcp-auto",
      version: catalogEntry?.version || "1.0.0",
      tags: ["mcp", serverName, ...(catalogEntry?.tags || [])],
    };

    logger.info(
      '[MCPSkillGenerator] Generated skill "%s" with %d tools',
      manifest.name,
      toolNames.length,
    );

    return manifest;
  }

  /**
   * Auto-generate instructions from tool list
   * @private
   */
  _generateInstructions(serverName, displayName, tools) {
    const toolList = tools
      .map(
        (t) =>
          `- ${t.originalToolName || t.name}: ${t.description || "No description"}`,
      )
      .join("\n");

    return `Use the ${displayName} MCP server for ${serverName}-related operations.\n\nAvailable tools:\n${toolList}`;
  }

  /**
   * Auto-generate examples from tool inputSchema
   * @private
   */
  _generateExamples(serverName, tools) {
    const examples = [];

    for (const tool of tools.slice(0, 3)) {
      const toolName = tool.originalToolName || tool.name;
      const schema = tool.inputSchema || {};
      const params = {};

      // Generate example params from schema properties
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (examples.length >= 3) {
            break;
          }
          if (prop.type === "string") {
            params[key] = prop.example || prop.default || `example_${key}`;
          } else if (prop.type === "number" || prop.type === "integer") {
            params[key] = prop.example || prop.default || 1;
          } else if (prop.type === "boolean") {
            params[key] = prop.example !== undefined ? prop.example : true;
          }
        }
      }

      examples.push({
        input: `Use ${toolName}`,
        tool: `mcp_${serverName}_${toolName}`,
        params,
      });
    }

    return examples;
  }
}

module.exports = { MCPSkillGenerator };
