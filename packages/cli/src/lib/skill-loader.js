/**
 * Multi-layer skill loader for CLI
 *
 * 4-layer priority system (highest wins on name collision):
 *   0 (lowest)  bundled     — desktop-app-vue/.../skills/builtin/
 *   1           marketplace — <userData>/marketplace/skills/
 *   2           managed     — <userData>/skills/
 *   3 (highest) workspace   — <projectRoot>/.chainlesschain/skills/
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getElectronUserDataDir } from "./paths.js";
import { findProjectRoot } from "./project-detector.js";
import { parseSkillMcpServers } from "./skill-mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Layer names in priority order (lowest → highest) */
export const LAYER_NAMES = ["bundled", "marketplace", "managed", "workspace"];

/**
 * Simple YAML frontmatter parser (no dependencies)
 * Shared utility extracted from skill.js
 */
export function parseSkillMd(content) {
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { data: {}, body: content };

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) return { data: {}, body: content };

  const yamlLines = lines.slice(1, endIndex);
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();
  const data = {};

  let currentKey = null;
  let currentArray = null;

  for (const line of yamlLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      const value = trimmed
        .slice(2)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (currentArray) currentArray.push(value);
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Convert kebab-case to camelCase
      const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

      if (value === "") {
        currentKey = camelKey;
        currentArray = null;
        continue;
      }

      // Handle inline arrays [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        data[camelKey] = value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
        currentArray = null;
        currentKey = null;
        continue;
      }

      // Handle booleans and numbers
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^\d+(\.\d+)?$/.test(value)) value = parseFloat(value);
      else value = value.replace(/^['"]|['"]$/g, "");

      data[camelKey] = value;

      if (Array.isArray(data[camelKey])) {
        currentArray = data[camelKey];
      } else {
        currentArray = null;
      }
      currentKey = camelKey;
    }
  }

  return { data, body };
}

/**
 * Multi-layer CLI skill loader
 */
export class CLISkillLoader {
  constructor() {
    this._cache = null;
  }

  /**
   * Get paths for each layer
   * @returns {{ layer: string, path: string, exists: boolean }[]}
   */
  getLayerPaths() {
    const layers = [];

    // Layer 0: bundled — desktop-app-vue builtin skills
    const bundledCandidates = [
      path.resolve(
        __dirname,
        "../../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
      ),
      path.resolve(
        process.cwd(),
        "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin",
      ),
    ];
    let bundledPath = null;
    for (const c of bundledCandidates) {
      if (fs.existsSync(c)) {
        bundledPath = c;
        break;
      }
    }
    layers.push({
      layer: "bundled",
      path: bundledPath || bundledCandidates[0],
      exists: bundledPath !== null,
    });

    // Layer 1: marketplace — <userData>/marketplace/skills/
    const userData = getElectronUserDataDir();
    const marketplacePath = path.join(userData, "marketplace", "skills");
    layers.push({
      layer: "marketplace",
      path: marketplacePath,
      exists: fs.existsSync(marketplacePath),
    });

    // Layer 2: managed — <userData>/skills/
    const managedPath = path.join(userData, "skills");
    layers.push({
      layer: "managed",
      path: managedPath,
      exists: fs.existsSync(managedPath),
    });

    // Layer 3: workspace — <projectRoot>/.chainlesschain/skills/
    const projectRoot = findProjectRoot();
    if (projectRoot) {
      const workspacePath = path.join(projectRoot, ".chainlesschain", "skills");
      layers.push({
        layer: "workspace",
        path: workspacePath,
        exists: fs.existsSync(workspacePath),
      });
    } else {
      layers.push({
        layer: "workspace",
        path: null,
        exists: false,
      });
    }

    return layers;
  }

  /**
   * Load skills from a single directory
   * @param {string} dir - Directory to scan
   * @param {string} layer - Layer name for source tracking
   * @returns {object[]} Array of skill metadata
   */
  _loadFromDir(dir, layer) {
    const skills = [];
    if (!dir || !fs.existsSync(dir)) return skills;

    try {
      const dirs = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;

        const skillMd = path.join(dir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;

        try {
          const content = fs.readFileSync(skillMd, "utf-8");
          const { data, body } = parseSkillMd(content);

          skills.push({
            id: data.name || entry.name,
            displayName: data.displayName || entry.name,
            description: data.description || "",
            version: data.version || "1.0.0",
            category: data.category || "uncategorized",
            activation: data.activation || "manual",
            tags: data.tags || [],
            userInvocable: data.userInvocable !== false,
            handler: data.handler || null,
            capabilities: data.capabilities || [],
            os: data.os || [],
            // CLI pack extended fields
            executionMode: data.executionMode || null,
            cliDomain: data.cliDomain || null,
            cliVersionHash: data.cliVersionHash || null,
            dirName: entry.name,
            hasHandler: fs.existsSync(path.join(dir, entry.name, "handler.js")),
            body,
            // Skill-Embedded MCP: inline server declarations in a
            // ```mcp-servers fenced code block. Empty array if absent.
            mcpServers: parseSkillMcpServers(body),
            source: layer,
            skillDir: path.join(dir, entry.name),
          });
        } catch {
          // Skip malformed skill files
        }
      }
    } catch {
      // Directory unreadable
    }

    return skills;
  }

  /**
   * Load all skills from all layers, applying priority override
   * Higher-priority layers override same-name skills from lower layers.
   * @returns {object[]} Resolved skill list
   */
  loadAll() {
    const layers = this.getLayerPaths();
    const skillMap = new Map();

    // Process in priority order (lowest first, so higher layers overwrite)
    for (const { layer, path: layerPath, exists } of layers) {
      if (!exists) continue;
      const skills = this._loadFromDir(layerPath, layer);
      for (const skill of skills) {
        skillMap.set(skill.id, skill);
      }
    }

    this._cache = Array.from(skillMap.values());
    return this._cache;
  }

  /**
   * Get resolved skills (uses cache if available)
   * @returns {object[]}
   */
  getResolvedSkills() {
    if (this._cache) return this._cache;
    return this.loadAll();
  }

  /**
   * Get auto-activated persona skills
   * @returns {object[]} skills with category "persona" and activation "auto"
   */
  getAutoActivatedPersonas() {
    return this.getResolvedSkills().filter(
      (s) => s.category === "persona" && s.activation === "auto",
    );
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this._cache = null;
  }
}
